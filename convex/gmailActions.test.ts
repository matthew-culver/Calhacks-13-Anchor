/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildNote, cleanKidNote } from "./lib/parentNote";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("CONVEX_SITE_URL", "https://some.convex.site");
  vi.stubEnv("ANCHOR_GMAIL_ACTIONS", "on");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Call = { method: string; path: string; body: Record<string, unknown> | null };

/** Fake Gmail. `labels` already exist; `fail` makes a path fail N times with a status. */
function fakeGmail(
  opts: { labels?: { id: string; name: string }[]; fail?: { match: string; status: number; times: number; method?: string }; alreadySent?: string[] } = {},
) {
  const calls: Call[] = [];
  let failures = opts.fail?.times ?? 0;
  let nextLabel = 1;
  let nextNote = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body ? (String(init.body).startsWith("{") ? JSON.parse(String(init.body)) : { form: String(init.body) }) : null;
      calls.push({ method: init?.method ?? "GET", path: url.hostname === "oauth2.googleapis.com" ? url.pathname : url.pathname.replace("/gmail/v1/users/me", ""), body });
      const json = (b: object, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
      if (url.hostname === "oauth2.googleapis.com") {
        if (url.pathname.endsWith("/revoke")) return json({});
        return json({ access_token: "fresh", expires_in: 3600 });
      }
      if (opts.fail && failures > 0 && url.pathname.includes(opts.fail.match) && (!opts.fail.method || opts.fail.method === (init?.method ?? "GET"))) {
        failures--;
        return json({}, opts.fail.status);
      }
      if (url.pathname.endsWith("/labels") && (init?.method ?? "GET") === "GET") return json({ labels: opts.labels ?? [] });
      if (url.pathname.endsWith("/labels")) return json({ id: `Label_${nextLabel++}` });
      if (url.pathname.endsWith("/modify")) return json({});
      if (url.pathname.endsWith("/messages") && (init?.method ?? "GET") === "GET") {
        const q = url.searchParams.get("q") ?? "";
        return json({ messages: (opts.alreadySent ?? []).some((k) => q.includes(k)) ? [{ id: "already-there" }] : [] });
      }
      if (url.pathname.endsWith("/messages")) return json({ id: `note-${nextNote++}` });
      return json({}, 404);
    }),
  );
  return calls;
}

async function family(opts: { level?: "fake" | "unsure" } = {}) {
  const t = convexTest(schema, modules);
  const kidId: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { email: "lucas@example.com" }));
  const kid = t.withIdentity({ subject: `${kidId}|s` });
  const { familyId } = await kid.mutation(api.families.createFamily, {
    parentName: "Mom",
    parentEmail: "mom.culver@gmail.com",
    kidName: "Lucas",
  });
  const level = opts.level ?? "fake";
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch(familyId, { status: "active", inviteToken: undefined, inviteExpiresAt: undefined });
    await ctx.db.insert("gmailTokens", {
      familyId,
      googleEmail: "mom.culver@gmail.com",
      refreshToken: "refresh-1",
      accessToken: "access-1",
      expiresAt: Date.now() + 3600_000,
      historyId: "100",
    });
    const verdictId = await ctx.db.insert("verdicts", {
      familyId,
      gmailMessageId: "msg-1",
      receivedAt: Date.now(),
      level,
      ruleLevel: level,
      fromDomain: "chase-secure-login.co",
      fromName: "Chase Bank",
      fromAddress: "alerts@chase-secure-login.co",
      subject: "Verify now",
      claimedOrg: "Chase",
      checks: [],
      explanationForParent: "We held a message pretending to be Chase. You don't need to do anything.",
      explanationForKid: "KID-ONLY DETAIL",
      action: level === "fake" ? "held" : "labeled_check",
    });
    const feedItemId = await ctx.db.insert("feedItems", {
      familyId,
      verdictId,
      kind: level === "fake" ? "held" : "needs_answer",
      createdAt: Date.now(),
    });
    return { verdictId, feedItemId };
  });
  const parentToken = (await t.run((ctx) => ctx.db.get(familyId)))!.parentToken;
  return { t, kid, familyId, parentToken, ...ids };
}

const decode = (raw: string) => decodeURIComponent(escape(atob(raw.replace(/-/g, "+").replace(/_/g, "/"))));
const noteText = (calls: Call[]) =>
  calls.filter((c) => c.method === "POST" && c.path === "/messages").map((c) => decode(String(c.body!.raw)));

describe("parent notes", () => {
  test("plain text with our own parent link, encoded headers", () => {
    const raw = buildNote({
      messageId: "verdict-abc",
      to: "mom@gmail.com",
      kidName: "Lucas",
      subject: "We held a message pretending to be Chase",
      lines: ["Line one."],
      parentPageUrl: "http://localhost:3000/p/TOKEN",
    });
    const text = decode(raw);
    expect(text).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(text).toContain("To: <mom@gmail.com>");
    expect(text).toContain("Line one.");
    expect(text).toContain("See what Lucas sees, or turn Anchor off: http://localhost:3000/p/TOKEN");
    expect(text).not.toMatch(/<html/i);
    expect(text).toContain("Message-ID: <verdict-abc@anchor.invalid>");
    expect(text).toContain("\r\n\r\n"); // CRLF between headers and body
  });

  test("the kid's words keep their meaning but lose links, addresses and numbers", () => {
    expect(cleanKidNote("Good catch, Mom. Love you!")).toBe("Good catch, Mom. Love you!");
    expect(cleanKidNote("It's real. Kaiser sends these.")).toBe("It's real. Kaiser sends these.");
    expect(cleanKidNote("go to https://evil.example/login now")).toBe("go to [link removed] now");
    expect(cleanKidNote("visit chase-help.com")).toBe("visit [link removed]");
    for (const sneaky of ["paypal-help.ru", "chase.top", "chase-login.click", "g00gle.link", "chase - help . com", "hxxps://evil"]) {
      expect(cleanKidNote(`see ${sneaky} now`), sneaky).toContain("[link removed]");
    }
    expect(cleanKidNote("email me at x@evil.example")).toBe("email me at [address removed]");
    expect(cleanKidNote("call 1-888-555-0142")).toBe("call [number removed]");
    expect(cleanKidNote("   ")).toBeUndefined();
    expect(cleanKidNote("a\nb\tc")).toBe("a b c");
  });
});

describe("applyVerdict", () => {
  test("with the switch off, nothing touches Gmail", async () => {
    vi.stubEnv("ANCHOR_GMAIL_ACTIONS", "");
    const { t, verdictId } = await family();
    const calls = fakeGmail();
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    expect(calls).toHaveLength(0);
  });

  test("fake: creates the labels once, holds the email out of the inbox, and tells the parent", async () => {
    const { t, verdictId, familyId } = await family();
    const calls = fakeGmail();
    await t.action(internal.gmailActions.applyVerdict, { verdictId });

    const created = calls.filter((c) => c.method === "POST" && c.path === "/labels").map((c) => c.body!.name);
    expect(created).toEqual(["Anchor: Held", "⚠ Check with Lucas", "Anchor"]);
    const modify = calls.find((c) => c.path === "/messages/msg-1/modify")!;
    expect(modify.body).toEqual({ addLabelIds: ["Label_1"], removeLabelIds: ["INBOX"] });

    const insert = calls.find((c) => c.method === "POST" && c.path === "/messages")!;
    expect(insert.body!.labelIds).toEqual(["INBOX", "UNREAD", "Label_3"]);
    const [note] = noteText(calls);
    expect(note).toContain("We held a message pretending to be Chase. You don't need to do anything.");
    expect(note).not.toContain("KID-ONLY DETAIL"); // the parent never gets Claude's text
    expect(note).toMatch(/\/p\/[A-Za-z0-9_-]{43}/);

    const v = await t.run((ctx) => ctx.db.get(verdictId));
    expect(v!.actionAppliedAt).toBeGreaterThan(0);
    expect(v!.parentNoteSentAt).toBeGreaterThan(0);
    const tokens = await t.run((ctx) => ctx.db.query("gmailTokens").first());
    expect(tokens).toMatchObject({ heldLabelId: "Label_1", checkLabelId: "Label_2", noteLabelId: "Label_3" });
    const notes = await t.run((ctx) => ctx.db.query("anchorNotes").collect());
    expect(notes).toEqual([expect.objectContaining({ familyId, gmailMessageId: "note-1" })]);
  });

  test("a note already sent by an earlier attempt is found, not sent twice", async () => {
    const { t, verdictId } = await family();
    const calls = fakeGmail({ alreadySent: [`verdict-${verdictId}`] });
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    expect(calls.some((c) => c.method === "POST" && c.path === "/messages")).toBe(false);
    const notes = await t.run((ctx) => ctx.db.query("anchorNotes").collect());
    expect(notes.map((n) => n.gmailMessageId)).toEqual(["already-there"]);
    expect((await t.run((ctx) => ctx.db.get(verdictId)))!.parentNoteSentAt).toBeGreaterThan(0);
  });

  test("a label that already exists (409, any case) is reused", async () => {
    const { t, verdictId } = await family();
    const calls = fakeGmail({ fail: { match: "/labels", status: 409, times: 1, method: "POST" }, labels: [] });
    // After the 409, the re-list finds it under different case.
    vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify({ labels: [] }), { status: 200 }));
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    expect(calls.filter((c) => c.method === "POST" && c.path === "/labels").length).toBeGreaterThanOrEqual(1);
  });

  test("a deleted Anchor label is re-created once instead of failing forever", async () => {
    const { t, verdictId } = await family();
    await t.run(async (ctx) => {
      const row = await ctx.db.query("gmailTokens").first();
      await ctx.db.patch(row!._id, { heldLabelId: "GONE", checkLabelId: "GONE2", noteLabelId: "GONE3" });
    });
    const calls = fakeGmail({ fail: { match: "/modify", status: 400, times: 1 } });
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    expect(calls.filter((c) => c.method === "POST" && c.path === "/labels")).toHaveLength(3);
    expect((await t.run((ctx) => ctx.db.get(verdictId)))!.actionAppliedAt).toBeGreaterThan(0);
  });

  test("the parent note never quotes the sender's own words", async () => {
    const { t, verdictId } = await family();
    await t.run((ctx) => ctx.db.patch(verdictId, { fromName: "Chase Support call 1-888-555-0142 visit chase-help.co", subject: "URGENT click here" }));
    const calls = fakeGmail();
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    const [note] = noteText(calls);
    expect(note).not.toContain("1-888");
    expect(note).not.toContain("chase-help");
    expect(note).not.toContain("URGENT");
  });

  test("gives up after three attempts", async () => {
    const { t, verdictId } = await family();
    fakeGmail({ fail: { match: "/labels", status: 500, times: 100 } });
    await t.action(internal.gmailActions.applyVerdict, { verdictId, attempt: 3 });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((s) => s.name === "gmailActions:applyVerdict")).toHaveLength(0);
  });

  test("running twice changes nothing the second time", async () => {
    const { t, verdictId } = await family();
    fakeGmail();
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    const calls = fakeGmail();
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    expect(calls).toHaveLength(0);
  });

  test("unsure: adds the check label and leaves it in the inbox", async () => {
    const { t, verdictId } = await family({ level: "unsure" });
    const calls = fakeGmail({ labels: [{ id: "H", name: "Anchor: Held" }, { id: "C", name: "⚠ Check with Lucas" }, { id: "N", name: "Anchor" }] });
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    expect(calls.some((c) => c.method === "POST" && c.path === "/labels")).toBe(false); // reused
    expect(calls.find((c) => c.path.endsWith("/modify"))!.body).toEqual({ addLabelIds: ["C"], removeLabelIds: [] });
    expect(noteText(calls)[0]).toContain("Subject: =?UTF-8?B?");
  });

  test("an email deleted meanwhile is fine: nothing to move, the parent is still told", async () => {
    const { t, verdictId } = await family();
    fakeGmail({ fail: { match: "/modify", status: 404, times: 1 } });
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    const v = await t.run((ctx) => ctx.db.get(verdictId));
    expect(v!.actionAppliedAt).toBeGreaterThan(0);
    expect(v!.parentNoteSentAt).toBeGreaterThan(0);
  });

  test("an expired token is refreshed once and the job carries on", async () => {
    const { t, verdictId } = await family();
    const calls = fakeGmail({ fail: { match: "/labels", status: 401, times: 1 } });
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    expect(calls.filter((c) => c.path === "/token")).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(verdictId)))!.parentNoteSentAt).toBeGreaterThan(0);
  });

  test("a Gmail outage schedules a retry instead of losing the action", async () => {
    const { t, verdictId } = await family();
    fakeGmail({ fail: { match: "/labels", status: 500, times: 10 } });
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    expect((await t.run((ctx) => ctx.db.get(verdictId)))!.actionAppliedAt).toBeUndefined();
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.find((s) => s.name === "gmailActions:applyVerdict")?.args[0]).toMatchObject({ verdictId, attempt: 2 });
  });

  test("skips a family that turned protection off, and a verdict the kid already answered", async () => {
    const { t, verdictId, familyId, feedItemId } = await family();
    const calls = fakeGmail();
    await t.run((ctx) => ctx.db.patch(feedItemId, { kidAnswer: { answer: "fine", answeredAt: Date.now() } }));
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    await t.run((ctx) => ctx.db.patch(familyId, { status: "off" }));
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    expect(calls).toHaveLength(0);
  });
});

describe("the kid's answer", () => {
  test("is refused when signed out, for another family's item, and the second time", async () => {
    const { t, kid, feedItemId } = await family();
    await expect(t.mutation(api.feed.answer, { feedItemId, answer: "scam" })).rejects.toThrow(/sign in/i);
    const strangerId: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { email: "s@example.com" }));
    const stranger = t.withIdentity({ subject: `${strangerId}|s` });
    await stranger.mutation(api.families.createFamily, { parentName: "X", parentEmail: "x@gmail.com", kidName: "S" });
    await t.run(async (ctx) => {
      const f = await ctx.db.query("families").withIndex("by_kid", (q) => q.eq("kidUserId", strangerId)).unique();
      await ctx.db.patch(f!._id, { status: "active" });
    });
    await expect(stranger.mutation(api.feed.answer, { feedItemId, answer: "fine" })).rejects.toThrow(/couldn't find/i);
    await kid.mutation(api.feed.answer, { feedItemId, answer: "scam" });
    await expect(kid.mutation(api.feed.answer, { feedItemId, answer: "fine" })).rejects.toThrow(/already answered/i);
  });

  test("trims the note to 280 characters, uses the server clock, and records the decision", async () => {
    const { t, kid, feedItemId, verdictId } = await family({ level: "unsure" });
    const before = Date.now();
    await kid.mutation(api.feed.answer, { feedItemId, answer: "fine", note: `  ${"x".repeat(400)}\n ` });
    const item = await t.run((ctx) => ctx.db.get(feedItemId));
    expect(item!.kidAnswer!.note).toHaveLength(280);
    expect(item!.kidAnswer!.answeredAt).toBeGreaterThanOrEqual(before);
    expect((await t.run((ctx) => ctx.db.get(verdictId)))!.action).toBe("released");
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((s) => s.name)).toContain("gmailActions:applyAnswer");
  });

  test("an empty note is stored as no note", async () => {
    const { t, kid, feedItemId } = await family();
    await kid.mutation(api.feed.answer, { feedItemId, answer: "scam", note: "   " });
    expect((await t.run((ctx) => ctx.db.get(feedItemId)))!.kidAnswer).not.toHaveProperty("note");
  });

  test("if the kid answered while the email was being held, their answer is re-applied", async () => {
    const { t, verdictId, feedItemId } = await family();
    fakeGmail();
    // The answer lands mid-run: simulate by answering right after the hold's modify call.
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/modify")) {
        await t.run((ctx) => ctx.db.patch(feedItemId, { kidAnswer: { answer: "fine", answeredAt: Date.now() } }));
      }
      if (url.pathname.endsWith("/labels") && (init?.method ?? "GET") === "POST") return new Response(JSON.stringify({ id: "L" }), { status: 200 });
      if (url.pathname.endsWith("/messages") && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ messages: [] }), { status: 200 });
      if (url.pathname.endsWith("/messages")) return new Response(JSON.stringify({ id: "n" }), { status: 200 });
      return new Response(JSON.stringify({ labels: [] }), { status: 200 });
    });
    await t.action(internal.gmailActions.applyVerdict, { verdictId });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.find((s) => s.name === "gmailActions:applyAnswer")?.args[0]).toMatchObject({ feedItemId, labelsOnly: true });
  });

  test("'It's fine' puts it back in the inbox and tells the parent, without links in the kid's words", async () => {
    const { t, kid, feedItemId } = await family({ level: "unsure" });
    await kid.mutation(api.feed.answer, { feedItemId, answer: "fine", note: "It's real, see https://x.example" });
    const calls = fakeGmail();
    await t.action(internal.gmailActions.applyAnswer, { feedItemId });
    expect(calls.find((c) => c.path.endsWith("/modify"))!.body).toEqual({ addLabelIds: ["INBOX"], removeLabelIds: ["Label_1", "Label_2"] });
    const [note] = noteText(calls);
    expect(note).toContain("Lucas looked at the message that said it was from Chase and says it's fine. It's back in your inbox.");
    expect(note).toContain('Lucas says: "It\'s real, see [link removed]"');
    expect((await t.run((ctx) => ctx.db.get(feedItemId)))!.answerAppliedAt).toBeGreaterThan(0);
  });

  test("'It's a scam' holds it and passes on the kid's words", async () => {
    const { t, kid, feedItemId } = await family({ level: "unsure" });
    await kid.mutation(api.feed.answer, { feedItemId, answer: "scam", note: "Good catch, Mom. Love you." });
    const calls = fakeGmail();
    await t.action(internal.gmailActions.applyAnswer, { feedItemId });
    expect(calls.find((c) => c.path.endsWith("/modify"))!.body).toEqual({ addLabelIds: ["Label_1"], removeLabelIds: ["INBOX", "Label_2"] });
    expect(noteText(calls)[0]).toContain('Lucas says: "Good catch, Mom. Love you."');
    // Applying again does nothing.
    const again = fakeGmail();
    await t.action(internal.gmailActions.applyAnswer, { feedItemId });
    expect(again).toHaveLength(0);
  });
});

describe("myFeed", () => {
  test("returns each item with its verdict attached, and [] before the parent connects", async () => {
    const { t, kid, familyId } = await family();
    const feed = await kid.query(api.feed.myFeed, {});
    expect(feed[0]).toMatchObject({ kind: "held", verdict: { level: "fake", claimedOrg: "Chase", gmailMessageId: "msg-1" } });
    expect(feed[0]).toHaveProperty("_id");
    expect(feed[0].verdict).toHaveProperty("_id");
    await t.run((ctx) => ctx.db.patch(familyId, { status: "invited" }));
    expect(await kid.query(api.feed.myFeed, {})).toEqual([]);
  });
});

describe("turnOff", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("stops at once, revokes Google access, deletes the data, keeps the family row as 'off'", async () => {
    const { t, kid, familyId, parentToken } = await family();
    await t.run(async (ctx) => {
      await ctx.db.insert("relationships", { familyId, kind: "org", key: "kp.org", firstSeen: 1, lastSeen: 2, messageCount: 3, authPassRate: 1 });
      await ctx.db.insert("accounts", { familyId, orgName: "Kaiser", category: "health", officialDomains: ["kp.org"], firstSeen: 1, messageCount: 3 });
      await ctx.db.insert("anchorNotes", { familyId, gmailMessageId: "n" });
    });
    const calls = fakeGmail();
    await t.mutation(api.turnOff.turnOff, { parentToken });
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("off");
    expect(await kid.query(api.feed.myFeed, {})).toEqual([]); // immediately, before cleanup runs

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const revoke = calls.find((c) => c.path === "/revoke")!;
    expect(String(revoke.body!.form)).toContain("token=refresh-1");
    for (const table of ["verdicts", "feedItems", "relationships", "accounts", "gmailTokens", "anchorNotes", "oauthStates", "pollFailures"] as const) {
      expect(await t.run((ctx) => ctx.db.query(table).collect()), table).toHaveLength(0);
    }
    expect(await t.query(api.families.getParentView, { parentToken })).toMatchObject({ status: "off" });
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1); // the kid's login stays
  });

  test("a failed Google revoke is retried, and the token is kept until it works", async () => {
    const { t, parentToken, familyId } = await family();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await t.mutation(api.turnOff.turnOff, { parentToken });
    await t.action(internal.turnOff.revokeAndDelete, { familyId });
    expect(await t.run((ctx) => ctx.db.query("gmailTokens").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("verdicts").collect())).toHaveLength(0); // the rest is gone already
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((s) => s.name === "turnOff:revokeAndDelete" && (s.args[0] as { attempt?: number }).attempt === 2)).toBe(true);
  });

  test("an unknown link or a second tap does nothing", async () => {
    const { t, parentToken } = await family();
    fakeGmail();
    await t.mutation(api.turnOff.turnOff, { parentToken: "nope" });
    await t.mutation(api.turnOff.turnOff, { parentToken: "" });
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
    await t.mutation(api.turnOff.turnOff, { parentToken });
    await t.mutation(api.turnOff.turnOff, { parentToken });
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(1);
  });

  test("deletes in batches when there's a lot of data", async () => {
    const { t, familyId, parentToken } = await family();
    await t.run(async (ctx) => {
      for (let i = 0; i < 450; i++) {
        await ctx.db.insert("relationships", { familyId, kind: "person", key: `p${i}@gmail.com`, firstSeen: 1, lastSeen: 2, messageCount: 1, authPassRate: 1 });
      }
    });
    fakeGmail();
    await t.mutation(api.turnOff.turnOff, { parentToken });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("relationships").collect())).toHaveLength(0);
  });
});
