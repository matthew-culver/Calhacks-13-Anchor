/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./checks/fixtures/${name}`, import.meta.url)), "utf8");
const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const DAY = 86_400_000;

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("CONVEX_SITE_URL", "https://some.convex.site");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("SAFE_BROWSING_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function activeFamily(opts: { kaiserHistory?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const kidId: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { email: "lucas@example.com" }));
  const kid = t.withIdentity({ subject: `${kidId}|s` });
  const { familyId } = await kid.mutation(api.families.createFamily, {
    parentName: "Mom",
    parentEmail: "mom.culver@gmail.com",
    kidName: "Lucas",
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(familyId, { status: "active", inviteToken: undefined, inviteExpiresAt: undefined });
    await ctx.db.insert("gmailTokens", {
      familyId,
      googleEmail: "mom.culver@gmail.com",
      refreshToken: "r",
      accessToken: "a",
      expiresAt: Date.now() + 3600_000,
      historyId: "100",
    });
    if (opts.kaiserHistory) {
      for (const key of ["kp.org", "kaiserpermanente.org"]) {
        await ctx.db.insert("relationships", {
          familyId,
          kind: "org",
          key,
          orgName: "Kaiser Permanente",
          firstSeen: Date.now() - 600 * DAY,
          lastSeen: Date.now() - DAY,
          messageCount: 40,
          authPassRate: 1,
        });
      }
    }
  });
  const parentToken = (await t.run((ctx) => ctx.db.get(familyId)))!.parentToken;
  return { t, kid, familyId, parentToken };
}

type Opts = {
  messages: Record<string, string>;
  historyStatus?: number;
  claude?: object;
  newHistoryId?: string;
  sizes?: Record<string, number>; // sizeEstimate per id
  rawStatus?: Record<string, number>; // make the raw download fail for an id
  recent?: string[]; // ids for the catch-up messages.list
  asked?: string[]; // ids under the "Check with" label (the parent asking the kid)
  historyIds?: string[]; // which messages show up as new mail (default: all of them)
  web?: (url: URL) => Response | undefined; // other sites: DNS, RDAP, link probes
};

/** Fake Gmail (history + raw messages), RDAP, Safe Browsing and Claude. */
function fakeWorld(opts: Opts) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      const json = (body: object, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      const site = opts.web?.(url);
      if (site) return site;
      if (url.hostname === "api.anthropic.com") {
        return json({
          id: "msg",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(opts.claude ?? { level: "real", explanationForParent: "", explanationForKid: "" }) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      }
      if (url.hostname === "rdap.org") return json({}, 404);
      if (url.pathname.endsWith("/history")) {
        if (opts.historyStatus) return json({}, opts.historyStatus);
        return json({
          historyId: opts.newHistoryId ?? "200",
          history: (opts.historyIds ?? Object.keys(opts.messages)).map((id) => ({ messagesAdded: [{ message: { id, labelIds: ["INBOX"] } }] })),
        });
      }
      if (url.pathname.endsWith("/profile")) return json({ historyId: "999" });
      if (url.pathname.endsWith("/messages")) {
        const ids = url.searchParams.get("labelIds") ? (opts.asked ?? []) : (opts.recent ?? []);
        return json({ messages: ids.map((id) => ({ id })) });
      }
      const id = url.pathname.split("/").pop()!;
      const raw = opts.messages[id];
      if (!raw) return json({}, 404);
      const format = url.searchParams.get("format");
      if (format === "minimal") return json({ sizeEstimate: opts.sizes?.[id] ?? raw.length, labelIds: ["INBOX"] });
      if (format === "metadata") return json({ internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "Big Sender <big@example.org>" }] } });
      if (opts.rawStatus?.[id]) return json({}, opts.rawStatus[id]);
      return json({ id, internalDate: String(Date.now()), labelIds: ["INBOX"], raw: b64url(raw) });
    }),
  );
  return calls;
}

const cursor = (t: Awaited<ReturnType<typeof activeFamily>>["t"]) =>
  t.run(async (ctx) => (await ctx.db.query("gmailTokens").first())!.historyId);

describe("pollFamily", () => {
  test("a fake Chase email becomes a held verdict in the kid's feed, with Claude's words", async () => {
    const { t, kid, familyId } = await activeFamily();
    fakeWorld({
      messages: { m1: fixture("chase-phish.eml") },
      claude: {
        level: "real", // a tricked Claude can't lower it
        explanationForKid: "Fake Chase email, and Mom has never had mail from Chase.",
      },
    });
    await t.action(internal.mailWatch.pollFamily, { familyId });

    const verdicts = await t.run((ctx) => ctx.db.query("verdicts").collect());
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ level: "fake", ruleLevel: "fake", action: "held", claimedOrg: "Chase" });
    expect(verdicts[0].checks!.find((c) => c.id === "relationship")).toMatchObject({ status: "fail" });

    const feed = await kid.query(api.feed.myFeed, {});
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ kind: "held", verdict: { level: "fake" } });
    expect(feed[0].verdict.explanationForKid).toContain("never had mail from Chase");
    expect(await cursor(t)).toBe("200");
  });

  test("a real Kaiser email with real Kaiser history stays private and skips Claude", async () => {
    const { t, kid, familyId } = await activeFamily({ kaiserHistory: true });
    const calls = fakeWorld({ messages: { k1: fixture("kaiser-real.eml") } });
    await t.action(internal.mailWatch.pollFamily, { familyId });

    const [v] = await t.run((ctx) => ctx.db.query("verdicts").collect());
    expect(v.level).toBe("real");
    expect(v.subject).toBeUndefined();
    expect(v.fromAddress).toBeUndefined();
    expect(v.checks).toBeUndefined();
    expect(calls.some((c) => c.includes("api.anthropic.com"))).toBe(false);
    expect(await kid.query(api.feed.myFeed, {})).toEqual([]);
  });

  test("the prompt-injection email is held, and the injection check fails", async () => {
    const { t, familyId } = await activeFamily();
    fakeWorld({ messages: { w1: fixture("wellsfargo-injection.eml") } });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    const [v] = await t.run((ctx) => ctx.db.query("verdicts").collect());
    expect(v.level).toBe("fake");
    expect(v.checks!.find((c) => c.id === "injection")?.status).toBe("fail");
  });

  test("never checks the same email twice", async () => {
    const { t, familyId } = await activeFamily();
    fakeWorld({ messages: { m1: fixture("chase-phish.eml") } });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("gmailTokens").first();
      await ctx.db.patch(row!._id, { historyId: "100" }); // pretend an overlapping poll
    });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(await t.run((ctx) => ctx.db.query("verdicts").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("feedItems").collect())).toHaveLength(1);
  });

  test("checks at most 20 new emails per run and doesn't skip the rest", async () => {
    const { t, familyId } = await activeFamily({ kaiserHistory: true });
    const messages: Record<string, string> = {};
    for (let i = 0; i < 25; i++) messages[`k${i}`] = fixture("kaiser-real.eml");
    fakeWorld({ messages });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(await t.run((ctx) => ctx.db.query("verdicts").collect())).toHaveLength(20);
    expect(await cursor(t)).toBe("100"); // not moved: 5 still waiting
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(await t.run((ctx) => ctx.db.query("verdicts").collect())).toHaveLength(25);
    expect(await cursor(t)).toBe("200");
  });

  test("a too-old cursor re-checks recent inbox mail, then starts fresh from now", async () => {
    const { t, familyId } = await activeFamily();
    fakeWorld({ messages: { m1: fixture("chase-phish.eml") }, historyStatus: 404, recent: ["m1"] });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(await t.run((ctx) => ctx.db.query("verdicts").collect())).toHaveLength(1);
    expect(await cursor(t)).toBe("999");
  });

  test("every test email gets its expected verdict through the whole pipeline", async () => {
    for (const name of ["chase-phish.eml", "kaiser-real.eml", "newsletter-real.eml", "usps-unsure.eml", "wellsfargo-injection.eml"]) {
      const raw = fixture(name);
      const expected = /^X-Anchor-Expected-Level: (\w+)/m.exec(raw)![1];
      const { t, familyId } = await activeFamily({ kaiserHistory: true });
      fakeWorld({ messages: { m: raw } });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      const [v] = await t.run((ctx) => ctx.db.query("verdicts").collect());
      expect(v.level, name).toBe(expected);
    }
  });

  test("an email over 5 MB isn't downloaded: it becomes unsure, and the next one is still checked", async () => {
    const { t, familyId } = await activeFamily({ kaiserHistory: true });
    const calls = fakeWorld({ messages: { big: fixture("kaiser-real.eml"), k1: fixture("kaiser-real.eml") }, sizes: { big: 20_000_000 } });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(calls.some((c) => c.includes("/big") && c.includes("format=raw"))).toBe(false);
    const verdicts = await t.run((ctx) => ctx.db.query("verdicts").collect());
    expect(verdicts.map((x) => [x.gmailMessageId, x.level]).sort()).toEqual([["big", "unsure"], ["k1", "real"]]);
    expect(verdicts.find((x) => x.gmailMessageId === "big")!.fromAddress).toBe("big@example.org");
  });

  test("an email that keeps failing is retried, then marked unsure, and doesn't block the rest", async () => {
    const { t, familyId } = await activeFamily({ kaiserHistory: true });
    fakeWorld({ messages: { bad: fixture("kaiser-real.eml"), k1: fixture("kaiser-real.eml") }, rawStatus: { bad: 400 } });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(await t.run((ctx) => ctx.db.query("verdicts").collect())).toHaveLength(0); // still retrying
    await t.action(internal.mailWatch.pollFamily, { familyId });
    const verdicts = await t.run((ctx) => ctx.db.query("verdicts").collect());
    expect(verdicts.map((x) => [x.gmailMessageId, x.level]).sort()).toEqual([["bad", "unsure"], ["k1", "real"]]);
    expect(await cursor(t)).toBe("200");
  });

  test("Gmail trouble (5xx) pauses the run without counting against the email", async () => {
    const { t, familyId } = await activeFamily();
    fakeWorld({ messages: { m1: fixture("chase-phish.eml") }, rawStatus: { m1: 503 } });
    for (let i = 0; i < 4; i++) await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(await t.run((ctx) => ctx.db.query("verdicts").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("pollFailures").collect())).toHaveLength(0);
  });

  test("Gmail's rate-limit 403 waits for the next minute and never counts against an email", async () => {
    const { t, familyId } = await activeFamily();
    fakeWorld({ messages: { m1: fixture("chase-phish.eml") }, rawStatus: { m1: 403 } });
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return new Response(JSON.stringify({ historyId: "200", history: [{ messagesAdded: [{ message: { id: "m1", labelIds: ["INBOX"] } }] }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }), { status: 403 });
    });
    for (let i = 0; i < 4; i++) await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(await t.run((ctx) => ctx.db.query("verdicts").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("pollFailures").collect())).toHaveLength(0);
    expect(await cursor(t)).toBe("100");
  });

  test("a rate-limited history call ends the run quietly", async () => {
    const { t, familyId } = await activeFamily();
    fakeWorld({ messages: {}, historyStatus: 429 });
    await expect(t.action(internal.mailWatch.pollFamily, { familyId })).resolves.toBeNull();
  });

  test("a finished check records the time (the kid's \"checked a minute ago\"); a failed one doesn't", async () => {
    const { t, kid, familyId, parentToken } = await activeFamily();
    fakeWorld({ messages: {}, historyStatus: 503 });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect((await kid.query(api.families.getMyFamily, {}))?.lastCheckedAt).toBeUndefined();

    fakeWorld({ messages: {} });
    const before = Date.now();
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect((await kid.query(api.families.getMyFamily, {}))?.lastCheckedAt).toBeGreaterThanOrEqual(before);
    expect((await t.query(api.families.getParentView, { parentToken }))?.lastCheckedAt).toBeGreaterThanOrEqual(before);
  });

  test("only one poll per family runs at a time", async () => {
    const { t, familyId } = await activeFamily();
    expect(await t.mutation(internal.mailWatch.claimPoll, { familyId })).toBe(true);
    expect(await t.mutation(internal.mailWatch.claimPoll, { familyId })).toBe(false);
    const calls = fakeWorld({ messages: { m1: fixture("chase-phish.eml") } });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(calls).toHaveLength(0); // skipped: the lease is held
    await t.mutation(internal.mailWatch.releasePoll, { familyId });
    expect(await t.mutation(internal.mailWatch.claimPoll, { familyId })).toBe(true);
  });

  test("saveVerdict never stores a level below the rules", async () => {
    const { t, familyId } = await activeFamily();
    await t.mutation(internal.mailWatch.saveVerdict, {
      familyId, gmailMessageId: "x", receivedAt: Date.now(), level: "real", ruleLevel: "fake",
      fromDomain: "Evil.CO", fromName: "", fromAddress: "", subject: "", checks: [], explanationForParent: "p", explanationForKid: "k",
    });
    const [v] = await t.run((ctx) => ctx.db.query("verdicts").collect());
    expect(v).toMatchObject({ level: "fake", fromDomain: "evil.co" });
  });

  test("the cursor only moves forward", async () => {
    const { t, familyId } = await activeFamily();
    await t.mutation(internal.mailWatch.saveHistoryId, { familyId, historyId: "500" });
    await t.mutation(internal.mailWatch.saveHistoryId, { familyId, historyId: "300" });
    expect(await cursor(t)).toBe("500");
  });

  test("skips families that aren't active or haven't finished learning", async () => {
    const { t, familyId } = await activeFamily();
    const calls = fakeWorld({ messages: { m1: fixture("chase-phish.eml") } });
    await t.run((ctx) => ctx.db.patch(familyId, { status: "off" }));
    await t.action(internal.mailWatch.pollFamily, { familyId });
    await t.run((ctx) => ctx.db.patch(familyId, { status: "learning" }));
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(calls).toHaveLength(0);
  });

  test("never checks Anchor's own notes: skipped by label and by recorded id", async () => {
    const { t, familyId } = await activeFamily();
    await t.run(async (ctx) => {
      const row = await ctx.db.query("gmailTokens").first();
      await ctx.db.patch(row!._id, { noteLabelId: "Label_Note" });
      await ctx.db.insert("anchorNotes", { familyId, gmailMessageId: "note-by-id" });
    });
    const calls: string[] = fakeWorld({ messages: { "note-by-id": fixture("chase-phish.eml") } });
    // Make the history report one note carrying our label and one recorded by id.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        calls.push(url.toString());
        if (url.pathname.endsWith("/history")) {
          return new Response(
            JSON.stringify({
              historyId: "200",
              history: [
                { messagesAdded: [{ message: { id: "note-by-label", labelIds: ["INBOX", "Label_Note"] } }] },
                { messagesAdded: [{ message: { id: "note-by-id", labelIds: ["INBOX"] } }] },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(calls.some((c) => c.includes("/messages/note-"))).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("verdicts").collect())).toHaveLength(0);
    expect(await cursor(t)).toBe("200");
  });

  test("a flagged verdict schedules the Gmail action", async () => {
    const { t, familyId } = await activeFamily();
    fakeWorld({ messages: { m1: fixture("chase-phish.eml") } });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((s) => s.name)).toContain("gmailActions:applyVerdict");
  });

  test("a flood of scam emails stops calling Claude after 30 in an hour", async () => {
    const { t, familyId } = await activeFamily();
    await t.run(async (ctx) => {
      for (let i = 0; i < 30; i++) {
        const verdictId = await ctx.db.insert("verdicts", {
          familyId, gmailMessageId: `old${i}`, receivedAt: Date.now(), level: "fake", ruleLevel: "fake", fromDomain: "x.co", action: "held",
        });
        await ctx.db.insert("feedItems", { familyId, verdictId, kind: "held", createdAt: Date.now() });
      }
    });
    const calls = fakeWorld({ messages: { m1: fixture("chase-phish.eml") } });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(calls.some((c) => c.includes("api.anthropic.com"))).toBe(false);
    const v = await t.run((ctx) => ctx.db.query("verdicts").withIndex("by_family_gmail_id", (q) => q.eq("familyId", familyId).eq("gmailMessageId", "m1")).first());
    expect(v).toMatchObject({ level: "fake" }); // still held, with the fixed explanation
    expect(v!.explanationForParent).toBe("We held a message pretending to be Chase. You don't need to do anything.");
  });

  test("your own email to your dad about rent, Venmo and a landlord portal is not flagged", async () => {
    const { t, kid, familyId } = await activeFamily();
    const raw = [
      "Authentication-Results: mx.google.com; dkim=pass header.i=@example.com; spf=pass smtp.mailfrom=lucas@example.com; dmarc=pass (p=NONE) header.from=example.com",
      "From: Lucas <lucas@example.com>",
      "To: mom.culver@gmail.com",
      "Subject: Rent this month",
      "Content-Type: text/plain",
      "",
      "Hi Dad, can you pay the rent via Venmo right away? It's due Friday. Here's the landlord portal: https://www.appfolio.com/connect/pay",
      "",
    ].join("\r\n");
    fakeWorld({ messages: { r1: raw } });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    const [v] = await t.run((ctx) => ctx.db.query("verdicts").collect());
    expect(v.level).toBe("real");
    expect(await kid.query(api.feed.myFeed, {})).toEqual([]);
  });

  test("someone Mom knows naming a company in the subject (\"Can you pay the PG&E bill?\") is not flagged", async () => {
    const { t, kid, familyId } = await activeFamily();
    await t.run((ctx) =>
      ctx.db.insert("relationships", {
        familyId, kind: "person", key: "matt.culver@gmail.com", firstSeen: Date.now() - 900 * DAY, lastSeen: Date.now() - 3 * DAY, messageCount: 0, parentSentCount: 4, authPassRate: 0,
      }),
    );
    const fromMatt = (id: string, subject: string, body: string) => [
      "Authentication-Results: mx.google.com; dkim=pass header.i=@gmail.com; spf=pass smtp.mailfrom=matt.culver@gmail.com; dmarc=pass (p=NONE) header.from=gmail.com",
      "From: Matt <matt.culver@gmail.com>",
      "To: mom.culver@gmail.com",
      `Subject: ${subject}`,
      `Message-ID: <${id}@mail.gmail.com>`,
      "Content-Type: text/plain",
      "",
      body,
      "",
    ].join("\r\n");
    fakeWorld({
      messages: {
        b1: fromMatt("b1", "Can you pay the PG&E bill?", "Hi Mom! It's $84.20, due Friday. You can pay at https://www.pge.com/ or just Venmo me. Love, Matt"),
        // A hacked account phishing with a company's name is still caught: the link gives it away,
        b2: fromMatt("b2", "Chase account alert", "Your Chase account is locked. Verify it here: https://chase-account-verify.top/login"),
        // even when the site looks harmless to our checks: Chase's name next to some other site.
        b3: fromMatt("b3", "Chase account alert", "Please review your account here: https://secure-account-review.com/start"),
        // and with no link at all, when it talks as the company would.
        b4: fromMatt("b4", "Chase account alert", "Your Chase account has been locked. Call 1-800-555-0100 to verify your identity."),
      },
    });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    const verdicts = await t.run((ctx) => ctx.db.query("verdicts").collect());
    const level = (id: string) => verdicts.find((v) => v.gmailMessageId === id)?.level;
    expect(level("b1")).toBe("real");
    expect(level("b2")).toBe("fake");
    expect(level("b3")).toBe("unsure");
    expect(level("b4")).not.toBe("real");
    const feed = await kid.query(api.feed.myFeed, {});
    expect(feed.map((f) => f.verdict?.gmailMessageId).sort()).toEqual(["b2", "b3", "b4"]);
  });

  test("someone Mom knows linking to a site she's never visited isn't flagged when the site is ordinary", async () => {
    const { t, kid, familyId } = await activeFamily();
    await t.run((ctx) =>
      ctx.db.insert("relationships", {
        familyId, kind: "person", key: "matt.culver@gmail.com", firstSeen: Date.now() - 900 * DAY, lastSeen: Date.now() - 3 * DAY, messageCount: 0, parentSentCount: 4, authPassRate: 0,
      }),
    );
    const raw = [
      "Authentication-Results: mx.google.com; dkim=pass header.i=@gmail.com; spf=pass smtp.mailfrom=matt.culver@gmail.com; dmarc=pass (p=NONE) header.from=gmail.com",
      "From: Matt <matt.culver@gmail.com>",
      "To: mom.culver@gmail.com",
      "Subject: you'll love this",
      "Content-Type: text/plain",
      "",
      "Mom, look at this cookie recipe, we should make it this weekend! https://www.kingarthurbaking.com/recipes/classic-chocolate-chip-cookies-recipe",
      "",
    ].join("\r\n");
    const probed: string[] = [];
    fakeWorld({
      messages: { k1: raw },
      web: (url) => {
        const json = (body: object) => new Response(JSON.stringify(body), { status: 200 });
        if (url.hostname === "cloudflare-dns.com") return json({ Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "151.101.1.1" }] : [] });
        if (url.hostname === "rdap.org") return json({ events: [{ eventAction: "registration", eventDate: "1999-03-02T00:00:00Z" }] });
        if (url.hostname === "www.kingarthurbaking.com") {
          probed.push(url.toString());
          return new Response("<html><title>Classic Chocolate Chip Cookies Recipe | King Arthur Baking</title></html>", { status: 200 });
        }
        return undefined;
      },
    });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    const [v] = await t.run((ctx) => ctx.db.query("verdicts").collect());
    expect(v.level).toBe("real");
    expect(probed).toHaveLength(1); // Anchor looked at the page itself, without Mom clicking
    expect(await kid.query(api.feed.myFeed, {})).toEqual([]);
  });

  describe("a stranger using the name of someone Mom knows", () => {
    const fromSue = (id: string, address: string, subject: string, body: string, name = "Sue Miller") => [
      `Authentication-Results: mx.google.com; dkim=pass header.i=@gmail.com; spf=pass smtp.mailfrom=${address}; dmarc=pass (p=NONE) header.from=gmail.com`,
      `From: ${name} <${address}>`,
      "To: mom.culver@gmail.com",
      `Subject: ${subject}`,
      `Message-ID: <${id}@mail.gmail.com>`,
      "Content-Type: text/plain",
      "",
      body,
      "",
    ].join("\r\n");
    const knowsSue = async (t: Awaited<ReturnType<typeof activeFamily>>["t"], familyId: Id<"families">) =>
      t.run(async (ctx) => {
        await ctx.db.insert("contactNames", { familyId, name: "sue miller", display: "Sue Miller", address: "sue.miller@gmail.com" });
        await ctx.db.insert("relationships", {
          familyId, kind: "person", key: "sue.miller@gmail.com", firstSeen: Date.now() - 900 * DAY, lastSeen: Date.now() - 5 * DAY, messageCount: 30, parentSentCount: 12, authPassRate: 1,
        });
      });
    const levelOf = async (t: Awaited<ReturnType<typeof activeFamily>>["t"], id: string) =>
      (await t.run((ctx) => ctx.db.query("verdicts").collect())).find((v) => v.gmailMessageId === id);

    test("from a new address: asks the kid, and says whose name it uses", async () => {
      const { t, familyId } = await activeFamily();
      await knowsSue(t, familyId);
      fakeWorld({ messages: { s1: fromSue("s1", "sue.miller.2026@gmail.com", "hi", "It's me, I got a new email address. Write back here!") } });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      const v = await levelOf(t, "s1");
      expect(v?.level).toBe("unsure");
      expect(v?.checks?.find((c) => c.id === "relationship")?.plainReason).toBe(
        "It uses the name Sue Miller, someone you know, but from an address they've never used with you.",
      );
    });

    test("even with look-alike letters in the name (a Cyrillic е)", async () => {
      const { t, familyId } = await activeFamily();
      await knowsSue(t, familyId);
      fakeWorld({ messages: { s2: fromSue("s2", "sue.miller.2026@gmail.com", "hi", "New address!", "Su\u0435 Miller") } });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      expect((await levelOf(t, "s2"))?.level).toBe("unsure");
    });

    test("asking for gift cards from a new address is held as fake", async () => {
      const { t, familyId } = await activeFamily();
      await knowsSue(t, familyId);
      fakeWorld({
        messages: { s3: fromSue("s3", "sue.miller.2026@gmail.com", "need a favor", "I'm stuck. Please buy two Google Play gift cards and send me the numbers. Don't tell anyone.") },
      });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      expect((await levelOf(t, "s3"))?.level).toBe("fake");
    });

    test("an address made to look like hers is held as fake", async () => {
      const { t, familyId } = await activeFamily();
      await knowsSue(t, familyId);
      fakeWorld({ messages: { s4: fromSue("s4", "sue.miiler@gmail.com", "hi", "Can you call me later?") } });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      const v = await levelOf(t, "s4");
      expect(v?.level).toBe("fake");
      expect(v?.checks?.find((c) => c.id === "relationship")?.plainReason).toContain("made to look like Sue Miller's");
    });

    test("Sue herself, however Gmail writes her address, is not an impostor", async () => {
      const { t, familyId } = await activeFamily();
      await knowsSue(t, familyId);
      fakeWorld({
        messages: {
          s5: fromSue("s5", "sue.miller@gmail.com", "lunch?", "Want to get lunch Tuesday?"),
          s6: fromSue("s6", "suemiller@gmail.com", "lunch?", "Same me, without the dot."),
        },
      });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      expect((await levelOf(t, "s5"))?.level).toBe("real");
      expect((await levelOf(t, "s6"))?.checks?.find((c) => c.id === "relationship")?.detail ?? "").not.toContain("known contact");
    });

    test("learns the name from Sue's own email, then catches a stranger using it", async () => {
      const { t, familyId } = await activeFamily();
      await t.run((ctx) =>
        ctx.db.insert("relationships", {
          familyId, kind: "person", key: "sue.miller@gmail.com", firstSeen: Date.now() - 900 * DAY, lastSeen: Date.now() - 5 * DAY, messageCount: 0, parentSentCount: 3, authPassRate: 1,
        }),
      );
      fakeWorld({ messages: { l1: fromSue("l1", "sue.miller@gmail.com", "photos", "Here are the photos from Sunday.") } });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      expect(await t.run((ctx) => ctx.db.query("contactNames").collect())).toEqual([
        expect.objectContaining({ name: "sue miller", display: "Sue Miller", address: "sue.miller@gmail.com" }),
      ]);
      fakeWorld({ messages: { l2: fromSue("l2", "sue.miller.help@gmail.com", "urgent", "I lost my phone, write me here.") } });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      expect((await levelOf(t, "l2"))?.level).toBe("unsure");
    });

    test("never learns a name from an odd email, even from someone Mom knows", async () => {
      const { t, familyId } = await activeFamily();
      await t.run((ctx) =>
        ctx.db.insert("relationships", {
          familyId, kind: "person", key: "sue.miller@gmail.com", firstSeen: Date.now() - 900 * DAY, lastSeen: Date.now() - 5 * DAY, messageCount: 0, parentSentCount: 3, authPassRate: 1,
        }),
      );
      fakeWorld({ messages: { l3: fromSue("l3", "sue.miller@gmail.com", "help", "Buy gift cards and send me the numbers. Don't tell anyone.", "Sue Miller") } });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      expect(await t.run((ctx) => ctx.db.query("contactNames").collect())).toEqual([]);
    });

    test("a stranger with a name nobody in Mom's mail uses is just a new sender", async () => {
      const { t, familyId } = await activeFamily();
      await knowsSue(t, familyId);
      fakeWorld({ messages: { s7: fromSue("s7", "new.neighbor@gmail.com", "hello", "Hi, I'm your new neighbor!", "Pat Lee") } });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      expect((await levelOf(t, "s7"))?.level).toBe("real");
    });
  });

  describe("Mom asks the kid about an email herself", () => {
    const withCheckLabel = async (t: Awaited<ReturnType<typeof activeFamily>>["t"]) =>
      t.run(async (ctx) => {
        const tokens = (await ctx.db.query("gmailTokens").first())!;
        await ctx.db.patch(tokens._id, { checkLabelId: "Label_check" });
      });
    const newsletter = [
      "Authentication-Results: mx.google.com; dkim=pass header.i=@kp.org; spf=pass smtp.mailfrom=news@kp.org; dmarc=pass (p=REJECT) header.from=kp.org",
      "From: Kaiser Permanente <news@kp.org>",
      "To: mom.culver@gmail.com",
      "Subject: Your flu shot is ready to schedule",
      "Content-Type: text/plain",
      "",
      "Schedule your flu shot at https://healthy.kaiserpermanente.org/",
      "",
    ].join("\r\n");

    test("an email Anchor found real goes to the kid as \"Mom asked\", with the investigation", async () => {
      const { t, kid, familyId } = await activeFamily({ kaiserHistory: true });
      await withCheckLabel(t);
      fakeWorld({ messages: { a1: newsletter } });
      await t.action(internal.mailWatch.pollFamily, { familyId }); // checked: real, private
      expect(await kid.query(api.feed.myFeed, {})).toEqual([]);

      fakeWorld({ messages: { a1: newsletter }, asked: ["a1"] }); // she moves it to "Check with Lucas"
      await t.action(internal.mailWatch.pollFamily, { familyId });
      const feed = await kid.query(api.feed.myFeed, {});
      expect(feed).toHaveLength(1);
      expect(feed[0]).toMatchObject({ kind: "asked", verdict: { gmailMessageId: "a1", subject: "Your flu shot is ready to schedule", fromName: "Kaiser Permanente" } });
      expect(feed[0].verdict!.explanationForKid).toContain("Mom asked you about this email");
      const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      const investigation = scheduled.find((s) => s.name === "investigations:investigate");
      expect((investigation?.args[0] as { facts: { askedByParent?: boolean } }).facts.askedByParent).toBe(true);

      // Asked once is enough: the next poll doesn't add it again.
      await t.action(internal.mailWatch.pollFamily, { familyId });
      expect(await kid.query(api.feed.myFeed, {})).toHaveLength(1);
    });

    test("an email she asks about that Anchor never saw gets the full check", async () => {
      const { t, kid, familyId } = await activeFamily({ kaiserHistory: true });
      await withCheckLabel(t);
      // It came before Anchor was connected: it's not new mail, only under her label.
      fakeWorld({ messages: { a2: newsletter }, asked: ["a2"], historyIds: [] });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      expect(await t.run((ctx) => ctx.db.query("verdicts").collect())).toEqual([
        expect.objectContaining({ gmailMessageId: "a2", level: "real", action: "none", subject: "Your flu shot is ready to schedule" }),
      ]);
      const feed = await kid.query(api.feed.myFeed, {});
      expect(feed.find((f) => f.verdict?.gmailMessageId === "a2")).toMatchObject({ kind: "asked" });
    });

    test("an email too big to check still reaches the kid when she asks", async () => {
      const { t, kid, familyId } = await activeFamily();
      await withCheckLabel(t);
      fakeWorld({ messages: { big: newsletter }, asked: ["big"], historyIds: [], sizes: { big: 6_000_000 } });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      const feed = await kid.query(api.feed.myFeed, {});
      expect(feed).toEqual([expect.objectContaining({ kind: "asked" })]);
      expect(feed[0].verdict!.explanationForKid).toContain("Mom asked you about this email. We couldn't check it");
    });

    test("Anchor's own \"Check with\" label isn't mistaken for Mom asking", async () => {
      const { t, kid, familyId } = await activeFamily();
      await withCheckLabel(t);
      await t.run(async (ctx) => {
        const verdictId = await ctx.db.insert("verdicts", {
          familyId, gmailMessageId: "u1", receivedAt: Date.now(), level: "unsure", ruleLevel: "unsure", fromDomain: "usps-track.co", action: "labeled_check",
        });
        await ctx.db.insert("feedItems", { familyId, verdictId, kind: "needs_answer", createdAt: Date.now() });
      });
      fakeWorld({ messages: {}, asked: ["u1"] });
      await t.action(internal.mailWatch.pollFamily, { familyId });
      const feed = await kid.query(api.feed.myFeed, {});
      expect(feed.map((f) => f.kind)).toEqual(["needs_answer"]);
    });
  });

  test("a stranger's first email asking for gift cards and secrecy is held; a newsletter warning about them isn't", async () => {
    const { t, familyId } = await activeFamily();
    const mail = (id: string, from: string, domain: string, subject: string, body: string) => [
      `Authentication-Results: mx.google.com; dkim=pass header.i=@${domain}; spf=pass smtp.mailfrom=x@${domain}; dmarc=pass (p=NONE) header.from=${domain}`,
      `From: ${from}`,
      "To: mom.culver@gmail.com",
      `Subject: ${subject}`,
      `Message-ID: <${id}@x>`,
      "Content-Type: text/plain",
      "",
      body,
      "",
    ].join("\r\n");
    fakeWorld({
      messages: {
        p1: mail("p1", "Pastor David <pastor.david.church@gmail.com>", "gmail.com", "Quick favor", "Can you buy 3 Google Play gift cards for a parishioner? Keep this between us."),
        p2: mail("p2", "AARP <member@email.aarp.org>", "email.aarp.org", "5 scams to watch for", "Scammers ask for gift cards and wire transfers. Never pay a stranger with a gift card."),
      },
    });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    const level = async (id: string) => (await t.run((ctx) => ctx.db.query("verdicts").collect())).find((v) => v.gmailMessageId === id)?.level;
    expect(await level("p1")).toBe("fake");
    expect(await level("p2")).toBe("real");
  });

  test("the same address asking for gift cards and secrecy is flagged as a hacked account", async () => {
    const { t, familyId } = await activeFamily();
    const raw = [
      "Authentication-Results: mx.google.com; dkim=pass header.i=@example.com; spf=pass smtp.mailfrom=lucas@example.com; dmarc=pass (p=NONE) header.from=example.com",
      "From: Lucas <lucas@example.com>",
      "To: mom.culver@gmail.com",
      "Subject: need help",
      "Content-Type: text/plain",
      "",
      "Dad I'm stuck, please buy two Google Play gift cards and send me the numbers on the back. Don't tell anyone, keep this between us.",
      "",
    ].join("\r\n");
    fakeWorld({ messages: { g1: raw } });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    const [v] = await t.run((ctx) => ctx.db.query("verdicts").collect());
    expect(v.level).not.toBe("real");
    expect(v.checks!.find((c) => c.id === "relationship")!.plainReason).toContain("Lucas's account may have been hacked");
  });

  test("pollAll schedules one poll per active family", async () => {
    const { t } = await activeFamily();
    await t.mutation(internal.mailWatch.pollAll, {});
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((s) => s.name === "mailWatch:pollFamily")).toHaveLength(1);
  });
});

describe("feed queries", () => {
  test("the parent's link sees the same feed; strangers see nothing", async () => {
    const { t, parentToken, familyId } = await activeFamily();
    fakeWorld({ messages: { m1: fixture("chase-phish.eml") } });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    expect(await t.query(api.feed.parentFeed, { parentToken })).toHaveLength(1);
    expect(await t.query(api.feed.parentFeed, { parentToken: "nope" })).toEqual([]);
    expect(await t.query(api.feed.myFeed, {})).toEqual([]);
  });

  test("the weekly recap counts checked, held and unanswered", async () => {
    const { t, kid, familyId } = await activeFamily({ kaiserHistory: true });
    fakeWorld({
      messages: { m1: fixture("chase-phish.eml"), k1: fixture("kaiser-real.eml"), u1: fixture("usps-unsure.eml") },
    });
    await t.action(internal.mailWatch.pollFamily, { familyId });
    const recap = await kid.query(api.feed.myWeeklyRecap, { now: Date.now() + 1000 });
    expect(recap).toMatchObject({ checked: 3, held: 1, needAnswer: 1, goodCatches: 0 }); // Chase held, USPS asks
  });
});
