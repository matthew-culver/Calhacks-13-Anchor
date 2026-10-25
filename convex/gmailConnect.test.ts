/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  GMAIL_MODIFY,
  grantedScopeOk,
  normalizeEmail,
  pkceChallenge,
  readCookie,
  sameMailbox,
  STATE_COOKIE,
} from "./lib/oauth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const CLIENT_ID = "test-client.apps.googleusercontent.com";
const SITE = "http://localhost:3000";
const CONVEX_SITE = "https://some.convex.site";

// ---------- pure helpers ----------

describe("oauth helpers", () => {
  test("PKCE challenge is the RFC 7636 S256 value", async () => {
    // Example from RFC 7636 appendix B.
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  test("normalizes emails", () => {
    expect(normalizeEmail("  Mom.Culver@GoogleMail.com ")).toBe("mom.culver@gmail.com");
    expect(normalizeEmail("Mom@Example.org")).toBe("mom@example.org");
  });

  test("treats Gmail dots and +tags as the same mailbox, but only for gmail.com", () => {
    expect(sameMailbox("jane.doe+news@gmail.com", "JaneDoe@googlemail.com")).toBe(true);
    expect(sameMailbox("jane.doe@example.org", "janedoe@example.org")).toBe(false);
    expect(sameMailbox("jane@gmail.com", "john@gmail.com")).toBe(false);
  });

  test("accepts gmail.modify only, never broader Gmail access", () => {
    expect(grantedScopeOk(`openid ${GMAIL_MODIFY} https://www.googleapis.com/auth/userinfo.email`)).toBe(true);
    expect(grantedScopeOk("openid email")).toBe(false);
    expect(grantedScopeOk(`${GMAIL_MODIFY} https://mail.google.com/`)).toBe(false);
    expect(grantedScopeOk(`${GMAIL_MODIFY} https://www.googleapis.com/auth/gmail.send`)).toBe(false);
    expect(grantedScopeOk(undefined)).toBe(false);
  });

  test("reads one cookie", () => {
    expect(readCookie(`a=1; ${STATE_COOKIE}=abc; b=2`, STATE_COOKIE)).toBe("abc");
    expect(readCookie("a=1", STATE_COOKIE)).toBeNull();
    expect(readCookie(null, STATE_COOKIE)).toBeNull();
  });
});

// ---------- the connect flow ----------

function idToken(claims: Record<string, unknown>) {
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `${enc({ alg: "RS256" })}.${enc(claims)}.sig`;
}

type GoogleReply = { status?: number; body: Record<string, unknown> };

/** Fake Google: the token endpoint returns `reply`; revoke calls are recorded. */
function fakeGoogle(reply: GoogleReply) {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).startsWith("https://oauth2.googleapis.com/revoke")) return new Response("{}");
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }),
  );
  return calls;
}

const revokes = (calls: { url: string; body: string }[]) =>
  calls.filter((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke")).map((c) => new URLSearchParams(c.body).get("token"));

function goodTokens(email = "mom.culver@gmail.com", scope = `openid email ${GMAIL_MODIFY}`) {
  return {
    body: {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope,
      id_token: idToken({ email, email_verified: true, aud: CLIENT_ID, iss: "https://accounts.google.com" }),
    },
  };
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("SITE_URL", SITE);
  vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  const userId: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { email: "lucas@example.com" }));
  const kid = t.withIdentity({ subject: `${userId}|s` });
  const { familyId, inviteToken } = await kid.mutation(api.families.createFamily, {
    parentName: "Mom",
    parentEmail: "Mom.Culver@gmail.com",
    kidName: "Lucas",
  });
  return { t, familyId, inviteToken };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

function startRequest(t: T, inviteToken: string | null, origin: string | null = SITE) {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (origin !== null) headers.Origin = origin;
  return t.fetch("/gmail/start", {
    method: "POST",
    headers,
    body: inviteToken === null ? "" : new URLSearchParams({ invite: inviteToken }).toString(),
  });
}

/** Run /gmail/start and return the state Google would echo back plus the cookie. */
async function start(t: T, inviteToken: string) {
  const res = await startRequest(t, inviteToken);
  expect(res.status).toBe(303);
  const location = new URL(res.headers.get("Location")!);
  const state = location.searchParams.get("state")!;
  const cookie = res.headers.get("Set-Cookie")!.split(";")[0];
  return { res, location, state, cookie };
}

function callback(t: T, query: Record<string, string>, cookie?: string) {
  return t.fetch(`/gmail/callback?${new URLSearchParams(query)}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function problemOf(res: Response) {
  expect(res.status).toBe(303);
  const url = new URL(res.headers.get("Location")!);
  expect(url.origin + url.pathname).toBe(`${SITE}/connect-problem`);
  return url.searchParams.get("reason");
}

describe("POST /gmail/start", () => {
  test("sends the parent to Google with a one-time state, PKCE and gmail.modify, never the invite", async () => {
    const { t, inviteToken } = await setup();
    const { res, location, state } = await start(t, inviteToken);

    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = location.searchParams;
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(`${CONVEX_SITE}/gmail/callback`);
    expect(p.get("scope")).toBe(`openid email ${GMAIL_MODIFY}`);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("login_hint")).toBe("mom.culver@gmail.com");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(res.headers.get("Location")).not.toContain(inviteToken);

    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toContain(`${STATE_COOKIE}=${state}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  test("refuses an unknown, used or expired invite without contacting Google", async () => {
    const { t, familyId, inviteToken } = await setup();
    expect(problemOf(await startRequest(t, "nope"))).toBe("invite_invalid");

    await t.run((ctx) => ctx.db.patch(familyId, { inviteExpiresAt: Date.now() - 1 }));
    expect(problemOf(await startRequest(t, inviteToken))).toBe("invite_expired");

    await t.run((ctx) => ctx.db.patch(familyId, { status: "active", inviteExpiresAt: Date.now() + 1000 }));
    expect(problemOf(await startRequest(t, inviteToken))).toBe("invite_invalid");
  });

  test("refuses a missing invite field", async () => {
    const { t } = await setup();
    expect(problemOf(await startRequest(t, null))).toBe("invite_invalid");
  });

  test("refuses posts from other websites, so the invite page can't be skipped", async () => {
    const { t, inviteToken } = await setup();
    expect(problemOf(await startRequest(t, inviteToken, "https://evil.example"))).toBe("session");
    expect(problemOf(await startRequest(t, inviteToken, "null"))).toBe("session");
    expect(problemOf(await startRequest(t, inviteToken, null))).toBe("session");
    expect(await t.run((ctx) => ctx.db.query("oauthStates").collect())).toHaveLength(0);
  });

  test("a second tap replaces the first attempt", async () => {
    const { t, inviteToken } = await setup();
    await start(t, inviteToken);
    await start(t, inviteToken);
    expect(await t.run((ctx) => ctx.db.query("oauthStates").collect())).toHaveLength(1);
  });

  test("answers 500 without touching anything when not configured", async () => {
    const { t, inviteToken } = await setup();
    vi.stubEnv("SITE_URL", "");
    const res = await startRequest(t, inviteToken);
    expect(res.status).toBe(500);
    expect(await t.run((ctx) => ctx.db.query("oauthStates").collect())).toHaveLength(0);
  });

  test("does not accept GET with the invite in the URL", async () => {
    const { t, inviteToken } = await setup();
    const res = await t.fetch(`/gmail/start?invite=${inviteToken}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /gmail/callback", () => {
  test("connects: saves tokens, sets learning, clears the invite, lands on the parent page", async () => {
    const { t, familyId, inviteToken } = await setup();
    const { state, cookie, location } = await start(t, inviteToken);
    const calls = fakeGoogle(goodTokens());

    const res = await callback(t, { code: "auth-code", state }, cookie);
    const family = await t.run((ctx) => ctx.db.get(familyId));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`${SITE}/p/${family!.parentToken}?connected=1`);
    expect(res.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);

    // PKCE verifier and our redirect URI went to Google's token endpoint.
    const tokenCall = new URLSearchParams(calls[0].body);
    expect(tokenCall.get("code")).toBe("auth-code");
    expect(tokenCall.get("redirect_uri")).toBe(`${CONVEX_SITE}/gmail/callback`);
    expect(tokenCall.get("client_id")).toBe(CLIENT_ID);
    expect(tokenCall.get("client_secret")).toBe("test-secret");
    expect(tokenCall.get("grant_type")).toBe("authorization_code");
    // The verifier sent to Google matches the challenge it saw at the start.
    expect(await pkceChallenge(tokenCall.get("code_verifier")!)).toBe(location.searchParams.get("code_challenge"));
    expect(revokes(calls)).toHaveLength(0);

    expect(family).toMatchObject({ status: "learning" });
    expect(family!.connectedAt).toBeGreaterThan(0);
    expect(family!.inviteToken).toBeUndefined();
    expect(family!.inviteExpiresAt).toBeUndefined();

    const tokens = await t.run((ctx) =>
      ctx.db.query("gmailTokens").withIndex("by_family", (q) => q.eq("familyId", familyId)).collect(),
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      refreshToken: "refresh-1",
      accessToken: "access-1",
      googleEmail: "mom.culver@gmail.com",
    });
    // The state was used up.
    expect(await t.run((ctx) => ctx.db.query("oauthStates").collect())).toHaveLength(0);
  });

  test("the same state can't be used twice", async () => {
    const { t, inviteToken } = await setup();
    const { state, cookie } = await start(t, inviteToken);
    fakeGoogle(goodTokens());
    await callback(t, { code: "c", state }, cookie);
    expect(problemOf(await callback(t, { code: "c", state }, cookie))).toBe("session");
  });

  test("refuses without the matching cookie, and leaves the invite usable", async () => {
    const { t, familyId, inviteToken } = await setup();
    const { state } = await start(t, inviteToken);
    const calls = fakeGoogle(goodTokens());

    expect(problemOf(await callback(t, { code: "c", state }))).toBe("session");
    expect(problemOf(await callback(t, { code: "c", state }, `${STATE_COOKIE}=other`))).toBe("session");
    expect(calls).toHaveLength(0); // never reached Google
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.inviteToken).toBe(inviteToken);
  });

  test("refuses a state older than 10 minutes", async () => {
    const { t, inviteToken } = await setup();
    const { state, cookie } = await start(t, inviteToken);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("oauthStates").first();
      await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 });
    });
    fakeGoogle(goodTokens());
    expect(problemOf(await callback(t, { code: "c", state }, cookie))).toBe("session");
  });

  test("reports Cancel on Google's screen, but only from the same browser", async () => {
    const { t, inviteToken } = await setup();
    const { state, cookie } = await start(t, inviteToken);
    expect(problemOf(await callback(t, { error: "access_denied", state }, `${STATE_COOKIE}=other`))).toBe("session");
    expect(problemOf(await callback(t, { error: "access_denied", state }, cookie))).toBe("cancelled");
  });

  test("refuses a different Google account, revokes its access, and the invite still works", async () => {
    const { t, familyId, inviteToken } = await setup();
    let s = await start(t, inviteToken);
    const calls = fakeGoogle(goodTokens("someone.else@gmail.com"));

    expect(problemOf(await callback(t, { code: "c", state: s.state }, s.cookie))).toBe("wrong_account");
    expect(revokes(calls)).toEqual(["refresh-1"]);
    expect(await t.run((ctx) => ctx.db.query("gmailTokens").collect())).toHaveLength(0);

    // The parent taps the link again and picks the right account.
    s = await start(t, inviteToken);
    fakeGoogle(goodTokens());
    await callback(t, { code: "c2", state: s.state }, s.cookie);
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("learning");
  });

  test("matches Gmail addresses the way Gmail does (dots, +tags)", async () => {
    const { t, familyId, inviteToken } = await setup();
    const { state, cookie } = await start(t, inviteToken);
    fakeGoogle(goodTokens("momculver@gmail.com"));
    await callback(t, { code: "c", state }, cookie);
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("learning");
  });

  test("refuses a mailbox another family already protects, without revoking its access", async () => {
    const first = await setup();
    let s = await start(first.t, first.inviteToken);
    fakeGoogle(goodTokens());
    await callback(first.t, { code: "c", state: s.state }, s.cookie);

    // A second "kid" points an invite at the same mailbox.
    const t = first.t;
    const otherKid: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { email: "x@example.com" }));
    const { inviteToken } = await t
      .withIdentity({ subject: `${otherKid}|s` })
      .mutation(api.families.createFamily, { parentName: "Mom", parentEmail: "mom.culver@gmail.com", kidName: "X" });
    s = await start(t, inviteToken);
    const calls = fakeGoogle(goodTokens());
    expect(problemOf(await callback(t, { code: "c", state: s.state }, s.cookie))).toBe("already_protected");
    expect(revokes(calls)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("gmailTokens").collect())).toHaveLength(1);
  });

  test("accepts googlemail.com for a gmail.com parent", async () => {
    const { t, familyId, inviteToken } = await setup();
    const { state, cookie } = await start(t, inviteToken);
    fakeGoogle(goodTokens("Mom.Culver@googlemail.com"));
    await callback(t, { code: "c", state }, cookie);
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("learning");
  });

  test("refuses when the Gmail permission was unticked, or broader access came back", async () => {
    for (const scope of ["openid email", `openid email ${GMAIL_MODIFY} https://mail.google.com/`]) {
      const { t, inviteToken } = await setup();
      const { state, cookie } = await start(t, inviteToken);
      const calls = fakeGoogle(goodTokens("mom.culver@gmail.com", scope));
      expect(problemOf(await callback(t, { code: "c", state }, cookie))).toBe("missing_permission");
      expect(revokes(calls)).toEqual(["refresh-1"]);
    }
  });

  test("refuses an unverified email, wrong audience, or missing refresh token", async () => {
    const bad = [
      { ...goodTokens().body, id_token: idToken({ email: "mom.culver@gmail.com", email_verified: false, aud: CLIENT_ID, iss: "https://accounts.google.com" }) },
      { ...goodTokens().body, id_token: idToken({ email: "mom.culver@gmail.com", email_verified: true, aud: "other", iss: "https://accounts.google.com" }) },
      { ...goodTokens().body, refresh_token: undefined },
    ];
    for (const body of bad) {
      const { t, inviteToken } = await setup();
      const { state, cookie } = await start(t, inviteToken);
      const calls = fakeGoogle({ body });
      expect(problemOf(await callback(t, { code: "c", state }, cookie))).toBe("google_error");
      expect(revokes(calls)).toHaveLength(1);
    }
  });

  test("reports a Google token error", async () => {
    const { t, inviteToken } = await setup();
    const { state, cookie } = await start(t, inviteToken);
    fakeGoogle({ status: 400, body: { error: "invalid_grant" } });
    expect(problemOf(await callback(t, { code: "c", state }, cookie))).toBe("google_error");
  });

  test("refuses if the invite expired while the parent was on Google's screen", async () => {
    const { t, familyId, inviteToken } = await setup();
    const { state, cookie } = await start(t, inviteToken);
    await t.run((ctx) => ctx.db.patch(familyId, { inviteExpiresAt: Date.now() - 1 }));
    const calls = fakeGoogle(goodTokens());
    expect(problemOf(await callback(t, { code: "c", state }, cookie))).toBe("invite_expired");
    expect(revokes(calls)).toEqual(["refresh-1"]);
    expect(await t.run((ctx) => ctx.db.query("gmailTokens").collect())).toHaveLength(0);
  });

  test("reconnect replaces the tokens, keeps labels and history, and returns to active", async () => {
    const { t, familyId, inviteToken } = await setup();
    let s = await start(t, inviteToken);
    fakeGoogle(goodTokens());
    await callback(t, { code: "c", state: s.state }, s.cookie);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("gmailTokens").first();
      await ctx.db.patch(row!._id, { historyId: "h1", heldLabelId: "L1", checkLabelId: "L2" });
    });

    // Google access broke; the kid makes a new link.
    await t.run((ctx) => ctx.db.patch(familyId, { status: "needs_reconnect" }));
    const kidId = (await t.run((ctx) => ctx.db.get(familyId)))!.kidUserId;
    const { inviteToken: again } = await t
      .withIdentity({ subject: `${kidId}|s` })
      .mutation(api.families.renewInvite, {});
    s = await start(t, again);
    fakeGoogle({ body: { ...goodTokens().body, refresh_token: "refresh-2" } });
    await callback(t, { code: "c2", state: s.state }, s.cookie);

    const tokens = await t.run((ctx) => ctx.db.query("gmailTokens").collect());
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ refreshToken: "refresh-2", historyId: "h1", heldLabelId: "L1", checkLabelId: "L2" });
    const family = await t.run((ctx) => ctx.db.get(familyId));
    expect(family).toMatchObject({ status: "active" });
    expect(family!.inviteToken).toBeUndefined();
  });
});
