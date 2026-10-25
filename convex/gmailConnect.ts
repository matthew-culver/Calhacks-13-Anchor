// A3: the parent's one tap. Invite page → POST /gmail/start → Google → GET /gmail/callback.
//
// Security rules (from the A2 and A3 reviews, see TASKS.md A3):
// - The invite token never goes to Google. Google only sees a one-time `state` nonce, which
//   is also kept in an HttpOnly cookie so the callback must come from the same browser.
// - /gmail/start only accepts form posts from our own website, so the parent always sees
//   the "who is asking" invite page first.
// - Exchange the code first, then check the account, then connect. Any failure before the
//   final mutation leaves the invite usable so the parent can try again.
// - The Google account must be the parent email the kid entered, and access must be
//   gmail.modify only. Otherwise the new grant is revoked and nothing is stored, unless that
//   mailbox is already connected (revoking would cut off its working protection).

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { acceptsInvite } from "./families";
import { type GoogleConfig, readGoogleConfig } from "./lib/env";
import {
  type ConnectProblem,
  GOOGLE_REVOKE_URL,
  GOOGLE_TIMEOUT_MS,
  GOOGLE_TOKEN_URL,
  googleAuthUrl,
  grantedScopeOk,
  idTokenOk,
  normalizeEmail,
  pkceChallenge,
  readCookie,
  readIdToken,
  sameMailbox,
  STATE_COOKIE,
  STATE_TTL_MS,
  stateCookie,
} from "./lib/oauth";
import { randomToken } from "./lib/tokens";

const problem = v.union(
  v.literal("invite_invalid"),
  v.literal("invite_expired"),
  v.literal("cancelled"),
  v.literal("session"),
  v.literal("wrong_account"),
  v.literal("missing_permission"),
  v.literal("already_protected"),
  v.literal("google_error"),
);

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function toProblemPage(cfg: GoogleConfig, reason: ConnectProblem, clearCookie = false): Response {
  return redirect(`${cfg.siteUrl}/connect-problem?reason=${reason}`, clearCookie ? stateCookie("", 0) : undefined);
}

function notConfigured(): Response {
  console.error("Gmail connect is missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or SITE_URL");
  return new Response("Anchor isn't set up yet. Please try again later.", { status: 500 });
}

const callbackUri = (cfg: GoogleConfig) => `${cfg.convexSiteUrl}/gmail/callback`;

// ---------- internal functions (the only code that touches the database) ----------

/** Check the invite and create this family's one live connect attempt. */
export const beginConnect = internalMutation({
  args: { inviteToken: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), state: v.string(), codeVerifier: v.string(), loginHint: v.string() }),
    v.object({ ok: v.literal(false), reason: problem }),
  ),
  handler: async (ctx, { inviteToken }) => {
    if (inviteToken.length === 0) return { ok: false as const, reason: "invite_invalid" as const };
    const family = await ctx.db
      .query("families")
      .withIndex("by_invite", (q) => q.eq("inviteToken", inviteToken))
      .unique();
    if (family === null || !acceptsInvite(family.status)) {
      return { ok: false as const, reason: "invite_invalid" as const };
    }
    if (family.inviteExpiresAt === undefined || family.inviteExpiresAt <= Date.now()) {
      return { ok: false as const, reason: "invite_expired" as const };
    }
    // A new tap replaces any earlier attempt, so rows can't pile up.
    for await (const old of ctx.db.query("oauthStates").withIndex("by_family", (q) => q.eq("familyId", family._id))) {
      await ctx.db.delete(old._id);
    }
    const state = randomToken();
    const codeVerifier = randomToken();
    await ctx.db.insert("oauthStates", {
      state,
      familyId: family._id,
      codeVerifier,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    return { ok: true as const, state, codeVerifier, loginHint: family.parentEmail };
  },
});

/** Use up a state. Returns null if it's unknown or older than 10 minutes. */
export const takeState = internalMutation({
  args: { state: v.string() },
  returns: v.union(v.null(), v.object({ familyId: v.id("families"), codeVerifier: v.string() })),
  handler: async (ctx, { state }) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (row === null) return null;
    await ctx.db.delete(row._id);
    if (row.expiresAt <= Date.now()) return null;
    return { familyId: row.familyId, codeVerifier: row.codeVerifier };
  },
});

/** True if this mailbox already has stored tokens (then a failed attempt must not revoke). */
export const isMailboxConnected = internalQuery({
  args: { googleEmail: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { googleEmail }) => {
    const row = await ctx.db
      .query("gmailTokens")
      .withIndex("by_google_email", (q) => q.eq("googleEmail", normalizeEmail(googleEmail)))
      .first();
    return row !== null;
  },
});

/** The one atomic connect step: re-check the invite and account, store tokens, clear the invite. */
export const completeConnect = internalMutation({
  args: {
    familyId: v.id("families"),
    googleEmail: v.string(),
    scope: v.string(),
    refreshToken: v.string(),
    accessToken: v.string(),
    expiresAt: v.number(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), parentToken: v.string() }),
    v.object({ ok: v.literal(false), reason: problem }),
  ),
  handler: async (ctx, args) => {
    const family = await ctx.db.get(args.familyId);
    if (family === null || !acceptsInvite(family.status)) {
      return { ok: false as const, reason: "invite_invalid" as const };
    }
    if (family.inviteExpiresAt === undefined || family.inviteExpiresAt <= Date.now()) {
      return { ok: false as const, reason: "invite_expired" as const };
    }
    if (!sameMailbox(args.googleEmail, family.parentEmail)) {
      return { ok: false as const, reason: "wrong_account" as const };
    }
    const googleEmail = normalizeEmail(args.googleEmail);
    const elsewhere = await ctx.db
      .query("gmailTokens")
      .withIndex("by_google_email", (q) => q.eq("googleEmail", googleEmail))
      .first();
    if (elsewhere !== null && elsewhere.familyId !== family._id) {
      return { ok: false as const, reason: "already_protected" as const };
    }

    const tokens = {
      familyId: family._id,
      googleEmail,
      scope: args.scope,
      refreshToken: args.refreshToken,
      accessToken: args.accessToken,
      expiresAt: args.expiresAt,
    };
    const existing = await ctx.db
      .query("gmailTokens")
      .withIndex("by_family", (q) => q.eq("familyId", family._id))
      .unique();
    // Reconnect after a finished import: fresh tokens, keep the label ids and history cursor,
    // and go straight back to "active". Otherwise (first connect, or the first import never
    // finished) learn the history now.
    if (existing) await ctx.db.patch(existing._id, tokens);
    else await ctx.db.insert("gmailTokens", tokens);
    const needsImport = !existing || existing.historyId === undefined;

    await ctx.db.patch(family._id, {
      status: needsImport ? "learning" : "active",
      connectedAt: Date.now(),
      inviteToken: undefined,
      inviteExpiresAt: undefined,
    });
    for await (const s of ctx.db.query("oauthStates").withIndex("by_family", (q) => q.eq("familyId", family._id))) {
      await ctx.db.delete(s._id);
    }
    if (needsImport) await ctx.scheduler.runAfter(0, internal.gmailImport.importHistory, { familyId: family._id });
    return { ok: true as const, parentToken: family.parentToken };
  },
});

// ---------- HTTP actions ----------

/**
 * POST /gmail/start with form field `invite`, from our own website only.
 * Never GET: the invite stays out of URLs and logs.
 */
export const start = httpAction(async (ctx, req) => {
  const cfg = readGoogleConfig();
  if (cfg === null) return notConfigured();

  // Cross-site check: a hidden form on another site must not skip the invite page.
  // (The website must not use Referrer-Policy no-referrer, or browsers send Origin: null.)
  const origin = req.headers.get("Origin");
  if (origin === null || origin !== new URL(cfg.siteUrl).origin) return toProblemPage(cfg, "session");

  let inviteToken = "";
  try {
    inviteToken = new URLSearchParams(await req.text()).get("invite") ?? "";
  } catch {
    return toProblemPage(cfg, "invite_invalid");
  }

  const begun = await ctx.runMutation(internal.gmailConnect.beginConnect, { inviteToken });
  if (!begun.ok) return toProblemPage(cfg, begun.reason);

  const url = googleAuthUrl({
    clientId: cfg.clientId,
    redirectUri: callbackUri(cfg),
    state: begun.state,
    codeChallenge: await pkceChallenge(begun.codeVerifier),
    loginHint: begun.loginHint,
  });
  return redirect(url, stateCookie(begun.state, STATE_TTL_MS / 1000));
});

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
};

async function revoke(token: string | undefined) {
  if (!token) return;
  try {
    await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
  } catch {
    // Best effort: Google also expires unused grants.
  }
}

/** GET /gmail/callback?code&state (or ?error=access_denied&state). */
export const callback = httpAction(async (ctx, req) => {
  const cfg = readGoogleConfig();
  if (cfg === null) return notConfigured();

  const params = new URL(req.url).searchParams;
  const state = params.get("state") ?? "";
  const cookieState = readCookie(req.headers.get("Cookie"), STATE_COOKIE);

  // Same browser that started, and a state we issued, used once.
  if (!state || cookieState !== state) return toProblemPage(cfg, "session", true);
  const taken = await ctx.runMutation(internal.gmailConnect.takeState, { state });
  if (taken === null) return toProblemPage(cfg, "session", true);

  if (params.get("error")) return toProblemPage(cfg, "cancelled", true);
  const code = params.get("code");
  if (!code) return toProblemPage(cfg, "google_error", true);

  let tokens: TokenResponse;
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: callbackUri(cfg),
        grant_type: "authorization_code",
        code_verifier: taken.codeVerifier,
      }).toString(),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!res.ok) return toProblemPage(cfg, "google_error", true);
    tokens = (await res.json()) as TokenResponse;
  } catch {
    return toProblemPage(cfg, "google_error", true);
  }

  // Revoking a refresh token ends the whole grant for that Google account. If the mailbox
  // is already protected (by this or another family), keep its working connection.
  const claims = readIdToken(tokens.id_token);
  const fail = async (reason: ConnectProblem) => {
    const email = claims?.email;
    const connected = email ? await ctx.runQuery(internal.gmailConnect.isMailboxConnected, { googleEmail: email }) : false;
    if (!connected) await revoke(tokens.refresh_token ?? tokens.access_token);
    return toProblemPage(cfg, reason, true);
  };

  if (!tokens.access_token || !tokens.refresh_token || !idTokenOk(claims, cfg.clientId)) return fail("google_error");
  if (!grantedScopeOk(tokens.scope)) return fail("missing_permission");

  let done;
  try {
    done = await ctx.runMutation(internal.gmailConnect.completeConnect, {
      familyId: taken.familyId,
      googleEmail: claims.email,
      scope: tokens.scope!,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    });
  } catch {
    return fail("google_error");
  }
  if (!done.ok) return fail(done.reason);
  return redirect(`${cfg.siteUrl}/p/${done.parentToken}?connected=1`, stateCookie("", 0));
});
