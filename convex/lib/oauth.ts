// Pure helpers for the parent's Google OAuth (A3). No database or network here.

export const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const STATE_COOKIE = "__Secure-anchor_oauth_state";
export const GOOGLE_TIMEOUT_MS = 10_000;
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Scopes we ask for. Gmail access is gmail.modify only: labels and archive, never send or delete. */
export const REQUESTED_SCOPES = ["openid", "email", GMAIL_MODIFY];

/** Scopes Google may report back that are fine to accept alongside gmail.modify. */
const ACCEPTABLE_SCOPES = new Set([
  "openid",
  "email",
  "https://www.googleapis.com/auth/userinfo.email",
  GMAIL_MODIFY,
]);

/** Why a connect attempt failed. The /connect-problem page maps each to plain words. */
export type ConnectProblem =
  | "invite_invalid" // unknown or already used
  | "invite_expired"
  | "cancelled" // the parent pressed Cancel on Google's screen
  | "session" // cookie missing or mismatched, or the attempt took over 10 minutes
  | "wrong_account" // signed in with a different Google account than the kid entered
  | "missing_permission" // unticked the Gmail permission
  | "already_protected" // this Gmail is already connected to another family
  | "google_error";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Lowercase and trim; googlemail.com and gmail.com are the same mailbox. Used for storing. */
export function normalizeEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  return lower.endsWith("@googlemail.com") ? lower.replace(/@googlemail\.com$/, "@gmail.com") : lower;
}

/**
 * For comparing only: Gmail ignores dots and "+tags", so jane.doe+x@gmail.com and
 * janedoe@gmail.com are one mailbox. Other domains are compared as normalized.
 */
export function sameMailbox(a: string, b: string): boolean {
  const canon = (email: string) => {
    const normalized = normalizeEmail(email);
    const [local, domain] = normalized.split("@");
    if (domain !== "gmail.com" || local === undefined) return normalized;
    return `${local.split("+")[0].replace(/\./g, "")}@gmail.com`;
  };
  return canon(a) === canon(b);
}

/** True when the granted scopes include gmail.modify and nothing broader. */
export function grantedScopeOk(scope: string | undefined): boolean {
  if (!scope) return false;
  const granted = scope.split(/\s+/).filter(Boolean);
  return granted.includes(GMAIL_MODIFY) && granted.every((s) => ACCEPTABLE_SCOPES.has(s));
}

/** Read one cookie from a Cookie header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export function stateCookie(value: string, maxAgeSeconds: number): string {
  return `${STATE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/gmail; Max-Age=${maxAgeSeconds}`;
}

export function googleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: REQUESTED_SCOPES.join(" "),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline", // we need a refresh token to keep watching new mail
    prompt: "consent", // always return a refresh token, even on reconnect
    login_hint: opts.loginHint,
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export type IdTokenClaims = { email?: string; email_verified?: boolean; aud?: string; iss?: string };

/**
 * Claims from an ID token received directly from Google's token endpoint over TLS.
 * OIDC allows skipping signature checks in that case; we still check audience and issuer.
 */
export function readIdToken(idToken: string | undefined): IdTokenClaims | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as IdTokenClaims;
  } catch {
    return null;
  }
}

export function idTokenOk(claims: IdTokenClaims | null, clientId: string): claims is IdTokenClaims & { email: string } {
  return (
    claims !== null &&
    typeof claims.email === "string" &&
    claims.email_verified === true &&
    claims.aud === clientId &&
    (claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com")
  );
}

export type RefreshResult =
  | { ok: true; accessToken: string; expiresAt: number }
  | { ok: false; reconnect: boolean }; // reconnect: Google revoked or expired the grant

/**
 * Trade the refresh token for a fresh access token. Google answers `invalid_grant` when the
 * parent removed access or (in testing mode) after 7 days: then the parent must reconnect.
 */
export async function refreshAccessToken(
  cfg: { clientId: string; clientSecret: string },
  refreshToken: string,
): Promise<RefreshResult> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) return { ok: false, reconnect: body.error === "invalid_grant" };
    return { ok: true, accessToken: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  } catch {
    return { ok: false, reconnect: false };
  }
}
