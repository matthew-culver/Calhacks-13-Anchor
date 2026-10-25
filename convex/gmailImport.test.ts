/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 60 * 60 * 1000;
const PASS = "mx.google.com; spf=pass; dkim=pass; dmarc=pass (p=REJECT)";

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("CONVEX_SITE_URL", "https://some.convex.site");
  vi.stubEnv("ANCHOR_IMPORT_RATE", "100000"); // no pacing waits in tests
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A connected family: kid signed in, Gmail tokens stored, status learning. */
async function connected(opts: { expiresAt?: number } = {}) {
  const t = convexTest(schema, modules);
  const kidId: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { email: "lucas@example.com" }));
  const kid = t.withIdentity({ subject: `${kidId}|s` });
  const { familyId } = await kid.mutation(api.families.createFamily, {
    parentName: "Mom",
    parentEmail: "mom.culver@gmail.com",
    kidName: "Lucas",
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(familyId, { status: "learning", inviteToken: undefined, inviteExpiresAt: undefined });
    await ctx.db.insert("gmailTokens", {
      familyId,
      googleEmail: "mom.culver@gmail.com",
      refreshToken: "refresh-1",
      accessToken: "access-1",
      expiresAt: opts.expiresAt ?? Date.now() + 3600_000,
    });
  });
  const parentToken = (await t.run((ctx) => ctx.db.get(familyId)))!.parentToken;
  return { t, kid, familyId, parentToken };
}

type Msg = { id: string; from: string; to?: string; date: number; labels?: string[]; auth?: string; subject?: string };

type Fail = { status: number; body?: string; times: number };

/** Fake Gmail and Google token endpoints. Records every request. `fail` makes message gets fail first. */
function fakeGoogle(
  opts: {
    messages?: Msg[];
    refresh?: { status: number; body: object };
    failGets?: Fail;
    failProfile?: Fail;
    /** Which messages a search returns (default: all of them). */
    search?: (q: string, m: Msg) => boolean;
    /**
     * Called on each message search from this test's own import, before it answers. (Imports
     * scheduled by earlier tests can still be running against the same fake.)
     */
    onList?: (q: string) => Promise<void>;
  } = {},
) {
  const messages = opts.messages ?? [];
  const failures = { gets: opts.failGets?.times ?? 0, profile: opts.failProfile?.times ?? 0 };
  const calls: { url: string; auth: string | null; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const auth = new Headers(init?.headers).get("Authorization");
      calls.push({ url: url.toString(), auth, body: String(init?.body ?? "") });
      const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

      if (url.hostname === "oauth2.googleapis.com") {
        return json(opts.refresh?.body ?? { access_token: "access-2", expires_in: 3600 }, opts.refresh?.status ?? 200);
      }
      if (url.pathname.endsWith("/profile")) {
        if (failures.profile > 0) {
          failures.profile--;
          return new Response(opts.failProfile!.body ?? "{}", { status: opts.failProfile!.status });
        }
        return json({ emailAddress: "mom.culver@gmail.com", historyId: "98765" });
      }
      if (url.pathname.endsWith("/messages")) {
        const q = url.searchParams.get("q") ?? "";
        if (auth === "Bearer access-1") await opts.onList?.(q);
        const found = messages.filter((m) => opts.search?.(q, m) ?? true);
        const page = Number(url.searchParams.get("pageToken") ?? 0);
        const size = Number(url.searchParams.get("maxResults"));
        const slice = found.slice(page, page + size);
        const next = page + size < found.length ? String(page + size) : undefined;
        return json({ messages: slice.map((m) => ({ id: m.id })), nextPageToken: next });
      }
      if (failures.gets > 0) {
        failures.gets--;
        return new Response(opts.failGets!.body ?? "{}", { status: opts.failGets!.status });
      }
      const id = url.pathname.split("/").pop()!;
      const m = messages.find((x) => x.id === id);
      if (!m) return json({ error: "not found" }, 404);
      return json({
        id,
        internalDate: String(m.date),
        labelIds: m.labels ?? ["INBOX"],
        payload: {
          headers: [
            { name: "From", value: m.from },
            { name: "To", value: m.to ?? "mom.culver@gmail.com" },
            ...(m.subject !== undefined ? [{ name: "Subject", value: m.subject }] : []),
            { name: "Authentication-Results", value: m.auth ?? PASS },
          ],
        },
      });
    }),
  );
  return calls;
}

const inbox = (now = Date.now()): Msg[] => [
  { id: "1", from: "Kaiser <noreply@kp.org>", date: now - 500 * DAY, subject: "Your test results are ready" },
  { id: "1b", from: "Kaiser <noreply@kp.org>", date: now - 200 * DAY, subject: "Appointment reminder" },
  { id: "2", from: "Kaiser <alerts@mail.kaiserpermanente.org>", date: now - 3 * DAY, subject: "Appointment reminder" },
  { id: "3", from: "Wells Fargo <alerts@notify.wellsfargo.com>", date: now - 70 * DAY, subject: "Your statement is ready" },
  { id: "3b", from: "Wells Fargo <alerts@notify.wellsfargo.com>", date: now - 55 * DAY, subject: "Your statement is ready" },
  { id: "3c", from: "Wells Fargo <alerts@notify.wellsfargo.com>", date: now - 40 * DAY, subject: "Your statement is ready" },
  { id: "8", from: "Sutter Health <news@sutterhealth.org>", date: now - 30 * DAY, subject: "Healthy living tips" },
  { id: "8b", from: "Sutter Health <news@sutterhealth.org>", date: now - 15 * DAY, subject: "Healthy living tips" },
  { id: "8c", from: "Sutter Health <news@sutterhealth.org>", date: now - 2 * DAY, subject: "Healthy living tips" },
  { id: "7", from: "Mom <mom.culver@gmail.com>", to: "mom.culver@gmail.com", date: now - DAY, labels: ["DRAFT"] },
  { id: "4", from: "Aunt Sue <sue@gmail.com>", date: now - 2 * DAY },
  { id: "5", from: "Mom <mom.culver@gmail.com>", to: "sue@gmail.com", date: now - DAY, labels: ["SENT"] },
  { id: "6", from: "Chase <alerts@chase.com>", date: now - DAY, auth: "mx.google.com; dmarc=fail" },
];

describe("importHistory", () => {
  test("reads headers only, builds relationships and My Accounts, saves the cursor, goes active", async () => {
    const { t, familyId } = await connected();
    const calls = fakeGoogle({ messages: inbox() });

    await t.action(internal.gmailImport.importHistory, { familyId });

    // Only metadata requests: never the full message or its body.
    const gets = calls.filter((c) => /\/messages\/[^/]+$/.test(new URL(c.url).pathname));
    expect(gets.length).toBe(inbox().length); // every list pass, deduplicated
    for (const g of gets) {
      const p = new URL(g.url).searchParams;
      expect(p.get("format")).toBe("metadata");
      expect(p.getAll("metadataHeaders")).toEqual(["From", "To", "Subject", "Authentication-Results"]);
      expect(p.get("fields")).toBe("internalDate,labelIds,payload/headers");
    }
    const lists = calls.filter((c) => new URL(c.url).pathname.endsWith("/messages"));
    expect(lists.some((c) => new URL(c.url).searchParams.get("q")!.includes("from:(") && c.url.includes("kp.org"))).toBe(true);
    expect(calls.every((c) => c.url.includes("oauth2") || c.auth === "Bearer access-1")).toBe(true);
    expect(new URL(calls.find((c) => c.url.includes("/messages?"))!.url).searchParams.get("q")).toContain("newer_than:2y");

    // Sutter only sends newsletters: not an account Mom uses.
    const accounts = await t.run((ctx) => ctx.db.query("accounts").collect());
    expect(accounts.map((a) => a.orgName).sort()).toEqual(["Kaiser Permanente", "Wells Fargo"]);

    const rels = await t.run((ctx) => ctx.db.query("relationships").collect());
    expect(rels.find((r) => r.key === "sue@gmail.com")).toMatchObject({ kind: "person", parentSentCount: 1 });
    expect(rels.find((r) => r.key === "mom.culver@gmail.com")).toBeUndefined(); // self and drafts skipped
    expect(rels.find((r) => r.key === "chase.com")).toMatchObject({ authPassRate: 0 });

    const family = await t.run((ctx) => ctx.db.get(familyId));
    expect(family!.status).toBe("active");
    const tokens = await t.run((ctx) => ctx.db.query("gmailTokens").first());
    expect(tokens!.historyId).toBe("98765");
  });

  test("pages through the message list", async () => {
    const { t, familyId } = await connected();
    const many: Msg[] = Array.from({ length: 1200 }, (_, i) => ({
      id: `m${i}`,
      from: `Kaiser <x${i}@kp.org>`,
      date: Date.now() - i * 3600_000,
      subject: "Appointment reminder",
    }));
    fakeGoogle({ messages: many });
    await t.action(internal.gmailImport.importHistory, { familyId });
    const kaiser = await t.run((ctx) => ctx.db.query("accounts").first());
    expect(kaiser!.messageCount).toBe(1200);
  });

  test("running it again replaces the old results instead of doubling them", async () => {
    const { t, familyId } = await connected();
    fakeGoogle({ messages: inbox() });
    await t.action(internal.gmailImport.importHistory, { familyId });
    await t.action(internal.gmailImport.importHistory, { familyId });
    expect(await t.run((ctx) => ctx.db.query("accounts").collect())).toHaveLength(2);
    const rels = await t.run((ctx) => ctx.db.query("relationships").collect());
    expect(new Set(rels.map((r) => r.key)).size).toBe(rels.length);
  });

  test("mail Anchor flagged never counts as history, so a scammer can't become familiar by sending more", async () => {
    const { t, familyId } = await connected();
    const now = Date.now();
    const scams: Msg[] = ["s1", "s2", "s3"].map((id, i) => ({ id, from: "Chase Bank <chillyisbad@gmail.com>", date: now - (i + 1) * DAY, labels: ["Label_held"] }));
    const cleared: Msg = { id: "c1", from: "Aunt Sue <sue.new@gmail.com>", date: now - DAY };
    const calls = fakeGoogle({ messages: [...inbox(now), ...scams, cleared, { ...cleared, id: "c2", date: now - 2 * DAY }] });
    await t.run(async (ctx) => {
      const verdict = { familyId, receivedAt: now, ruleLevel: "fake" as const, fromDomain: "gmail.com" };
      for (const id of ["s1", "s2"]) await ctx.db.insert("verdicts", { ...verdict, gmailMessageId: id, level: "fake", action: "held" });
      await ctx.db.insert("verdicts", { ...verdict, gmailMessageId: "s3", level: "unsure", ruleLevel: "unsure", action: "labeled_check" });
      // The kid said "It's fine": that one is ordinary mail again.
      await ctx.db.insert("verdicts", { ...verdict, gmailMessageId: "c1", level: "unsure", ruleLevel: "unsure", action: "released" });
    });

    await t.action(internal.gmailImport.importHistory, { familyId });
    const rels = await t.run((ctx) => ctx.db.query("relationships").collect());
    expect(rels.find((r) => r.key === "chillyisbad@gmail.com")).toBeUndefined();
    expect(rels.find((r) => r.key === "sue.new@gmail.com")).toMatchObject({ messageCount: 2 });
    // Flagged mail isn't even fetched.
    expect(calls.some((c) => /\/messages\/s[123]$/.test(new URL(c.url).pathname))).toBe(false);
  });

  test("refreshes an expired access token first and saves it", async () => {
    const { t, familyId } = await connected({ expiresAt: Date.now() - 1 });
    const calls = fakeGoogle({ messages: inbox() });
    await t.action(internal.gmailImport.importHistory, { familyId });

    const refresh = calls.find((c) => c.url.startsWith("https://oauth2.googleapis.com/token"))!;
    expect(new URLSearchParams(refresh.body).get("grant_type")).toBe("refresh_token");
    expect(new URLSearchParams(refresh.body).get("refresh_token")).toBe("refresh-1");
    expect(calls.filter((c) => c.url.includes("gmail.googleapis.com")).every((c) => c.auth === "Bearer access-2")).toBe(true);
    const tokens = await t.run((ctx) => ctx.db.query("gmailTokens").first());
    expect(tokens).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-1" });
    expect(tokens!.expiresAt!).toBeGreaterThan(Date.now());
  });

  test("marks the family needs_reconnect when Google revoked or expired access", async () => {
    const { t, familyId } = await connected({ expiresAt: Date.now() - 1 });
    fakeGoogle({ refresh: { status: 400, body: { error: "invalid_grant" } } });
    await t.action(internal.gmailImport.importHistory, { familyId });
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("needs_reconnect");
    expect(await t.run((ctx) => ctx.db.query("accounts").collect())).toHaveLength(0);
  });

  test("waits out Gmail rate limits and server errors instead of failing", async () => {
    const { t, familyId } = await connected();
    fakeGoogle({ messages: inbox(), failGets: { status: 429, times: 2 } });
    await t.action(internal.gmailImport.importHistory, { familyId });
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("active");
    expect(await t.run((ctx) => ctx.db.query("accounts").collect())).toHaveLength(2);
  });

  test("a 401 mid-import refreshes once and carries on, without asking to reconnect", async () => {
    const { t, familyId } = await connected();
    const calls = fakeGoogle({ messages: inbox(), failProfile: { status: 401, times: 1 } });
    await t.action(internal.gmailImport.importHistory, { familyId });
    expect(calls.filter((c) => c.url.startsWith("https://oauth2.googleapis.com/token"))).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("active");
  });

  test("an unexpected failure schedules another try instead of getting stuck", async () => {
    const { t, familyId } = await connected();
    fakeGoogle({ messages: inbox(), failProfile: { status: 500, times: 10 } });
    await t.action(internal.gmailImport.importHistory, { familyId });
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("learning");
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.find((s) => s.name === "gmailImport:importHistory")?.args[0]).toMatchObject({ familyId, attempt: 2 });
  });

  test("does nothing for a family that turned protection off", async () => {
    const { t, familyId } = await connected();
    await t.run((ctx) => ctx.db.patch(familyId, { status: "off" }));
    const calls = fakeGoogle({ messages: inbox() });
    await t.action(internal.gmailImport.importHistory, { familyId });
    expect(calls).toHaveLength(0);
  });

  test("demo mode builds My Accounts from the sample history without calling Google", async () => {
    const { t, familyId } = await connected();
    const calls = fakeGoogle();
    await t.action(internal.gmailImport.importSample, { familyId });
    expect(calls).toHaveLength(0);
    const names = (await t.run((ctx) => ctx.db.query("accounts").collect())).map((a) => a.orgName);
    expect(names).toEqual(expect.arrayContaining(["Kaiser Permanente", "Wells Fargo", "Medicare"]));
    expect(names).not.toContain("Chase"); // the sample includes a fake Chase email
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("active");
  });

  test("demo mode won't overwrite a family's real Gmail history by accident", async () => {
    const { t, familyId } = await connected();
    fakeGoogle({ messages: inbox() });
    await t.action(internal.gmailImport.importHistory, { familyId });
    await expect(t.action(internal.gmailImport.importSample, { familyId })).rejects.toThrow(/real Gmail history/);
  });
});

test("paces requests under Gmail's quota", async () => {
  vi.stubEnv("ANCHOR_IMPORT_RATE", "400"); // 8 per batch -> at least 20 ms per batch
  const { t, familyId } = await connected();
  const many: Msg[] = Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, from: `Kaiser <x@kp.org>`, date: Date.now() - i * 3600_000, subject: "Appointment reminder" }));
  fakeGoogle({ messages: many });
  const started = Date.now();
  await t.action(internal.gmailImport.importHistory, { familyId });
  expect(Date.now() - started).toBeGreaterThanOrEqual(180); // 10 batches x 20 ms, with slack
});

describe("My Accounts queries", () => {
  async function withAccounts() {
    const c = await connected();
    fakeGoogle({ messages: inbox() });
    await c.t.action(internal.gmailImport.importHistory, { familyId: c.familyId });
    return c;
  }

  test("the kid sees their family's accounts, most important first, without internal ids", async () => {
    const { kid } = await withAccounts();
    const accounts = await kid.query(api.accounts.myAccounts, {});
    expect(accounts.map((a) => a.orgName)).toEqual(["Kaiser Permanente", "Wells Fargo"]);
    expect(accounts[0]).not.toHaveProperty("familyId");
    expect(accounts[0]).toMatchObject({
      category: "health",
      loginUrl: expect.stringMatching(/^https:\/\/healthy\.kaiserpermanente\.org\//),
      loginUrlSource: "curated",
      signals: ["appointment"],
      lastActivity: expect.any(Number),
    });
    expect(accounts[0].rank!).toBeGreaterThan(accounts[1].rank!);
  });

  test("sorted by rank, highest first, then by name; rows from before ranking go last", async () => {
    const { t, kid, familyId } = await connected();
    await t.run(async (ctx) => {
      const row = { familyId, category: "other" as const, officialDomains: ["x.com"], firstSeen: 1, messageCount: 3 };
      await ctx.db.insert("accounts", { ...row, orgName: "Old row" });
      await ctx.db.insert("accounts", { ...row, orgName: "Beta", rank: 10 });
      await ctx.db.insert("accounts", { ...row, orgName: "Alpha", rank: 10 });
      await ctx.db.insert("accounts", { ...row, orgName: "Top", rank: 40 });
    });
    expect((await kid.query(api.accounts.myAccounts, {})).map((a) => a.orgName)).toEqual(["Top", "Alpha", "Beta", "Old row"]);
  });

  test("the parent sees the same list through their private link", async () => {
    const { t, parentToken } = await withAccounts();
    const accounts = await t.query(api.accounts.parentAccounts, { parentToken });
    expect(accounts.map((a) => a.orgName)).toEqual(["Kaiser Permanente", "Wells Fargo"]);
  });

  test("strangers, the signed-out, and wrong links see nothing", async () => {
    const { t } = await withAccounts();
    expect(await t.query(api.accounts.myAccounts, {})).toEqual([]);
    const stranger: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { email: "s@example.com" }));
    expect(await t.withIdentity({ subject: `${stranger}|s` }).query(api.accounts.myAccounts, {})).toEqual([]);
    expect(await t.query(api.accounts.parentAccounts, { parentToken: "nope" })).toEqual([]);
    expect(await t.query(api.accounts.parentAccounts, { parentToken: "" })).toEqual([]);
  });

  test("a parent who turned protection off sees nothing", async () => {
    const { t, familyId, parentToken } = await withAccounts();
    await t.run((ctx) => ctx.db.patch(familyId, { status: "off" }));
    expect(await t.query(api.accounts.parentAccounts, { parentToken })).toEqual([]);
  });
});

describe("connecting starts the import when needed", () => {
  async function connect(t: ReturnType<typeof convexTest>, familyId: Id<"families">) {
    await t.mutation(internal.gmailConnect.completeConnect, {
      familyId,
      googleEmail: "mom@gmail.com",
      scope: "gmail.modify",
      refreshToken: "r",
      accessToken: "a",
      expiresAt: Date.now() + 3600_000,
    });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    return scheduled.filter((s) => s.name === "gmailImport:importHistory").length;
  }

  async function family() {
    const t = convexTest(schema, modules);
    const kidId: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { email: "k@example.com" }));
    const kid = t.withIdentity({ subject: `${kidId}|s` });
    const { familyId } = await kid.mutation(api.families.createFamily, { parentName: "Mom", parentEmail: "mom@gmail.com", kidName: "K" });
    return { t, kid, familyId };
  }

  test("first connect schedules it", async () => {
    const { t, familyId } = await family();
    expect(await connect(t, familyId)).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("learning");
  });

  test("a reconnect after the first import never finished schedules it again", async () => {
    const { t, kid, familyId } = await family();
    await connect(t, familyId);
    await t.run((ctx) => ctx.db.patch(familyId, { status: "needs_reconnect" }));
    await kid.mutation(api.families.renewInvite, {});
    expect(await connect(t, familyId)).toBe(2);
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("learning");
  });

  test("a reconnect after a finished import goes straight back to active", async () => {
    const { t, kid, familyId } = await family();
    await connect(t, familyId);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("gmailTokens").first();
      await ctx.db.patch(row!._id, { historyId: "h1" });
      await ctx.db.patch(familyId, { status: "needs_reconnect" });
    });
    await kid.mutation(api.families.renewInvite, {});
    expect(await connect(t, familyId)).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("active");
  });
});

test("the kid sees nothing once the parent turned protection off", async () => {
  const c = await connected();
  fakeGoogle({ messages: inbox() });
  await c.t.action(internal.gmailImport.importHistory, { familyId: c.familyId });
  await c.t.run((ctx) => ctx.db.patch(c.familyId, { status: "off" }));
  expect(await c.kid.query(api.accounts.myAccounts, {})).toEqual([]);
});

describe("A8: fast first pass, live fill-in", () => {
  const ACCOUNT_MAIL = /statement|appointment|results|sign-in|bill|reminder/i;
  // Gmail's search, roughly: the first pass asks only for account-type subjects.
  const search = (q: string, m: Msg) => !q.includes("subject:(") || ACCOUNT_MAIL.test(m.subject ?? "");

  test("asks Gmail for account mail first: subject words, no promotions, at most 300", async () => {
    const { t, familyId } = await connected();
    const calls = fakeGoogle({ messages: inbox(), search });
    await t.action(internal.gmailImport.importHistory, { familyId });
    const lists = calls.filter((c) => new URL(c.url).pathname.endsWith("/messages")).map((c) => new URL(c.url).searchParams);
    const first = lists[0];
    expect(first.get("q")).toContain("newer_than:2y");
    expect(first.get("q")).toContain("-category:promotions");
    expect(first.get("q")).toMatch(/subject:\(statement OR bill/);
    expect(Number(first.get("maxResults"))).toBeLessThanOrEqual(300);
    // Then the deeper pass: recent mail, and known orgs in queries of bounded length.
    expect(lists.some((p) => p.get("q") === "newer_than:2y -in:chats")).toBe(true);
    const fromOrgs = lists.filter((p) => p.get("q")!.includes("from:("));
    expect(fromOrgs.length).toBeGreaterThanOrEqual(1);
    for (const p of fromOrgs) expect(p.get("q")!.length).toBeLessThan(1700);
  });

  test("accounts are on screen before the deeper pass starts", async () => {
    const { t, kid, familyId } = await connected();
    let duringDeepPass: string[] | undefined;
    let statusThen: string | undefined;
    fakeGoogle({
      messages: inbox(),
      search,
      onList: async (q) => {
        if (q !== "newer_than:2y -in:chats" || duringDeepPass) return;
        duringDeepPass = (await kid.query(api.accounts.myAccounts, {})).map((a) => a.orgName);
        statusThen = (await t.run((ctx) => ctx.db.get(familyId)))!.status;
      },
    });
    await t.action(internal.gmailImport.importHistory, { familyId });
    expect(duringDeepPass).toEqual(["Kaiser Permanente", "Wells Fargo"]);
    expect(statusThen).toBe("learning"); // still learning: the screen fills in meanwhile
    expect((await t.run((ctx) => ctx.db.get(familyId)))!.status).toBe("active");
  });

  test("saves in batches while reading, keeping each account's row", async () => {
    const { t, kid, familyId } = await connected();
    const many: Msg[] = Array.from({ length: 200 }, (_, i) => ({
      id: `b${i}`,
      from: i % 2 ? "Wells Fargo <alerts@notify.wellsfargo.com>" : "Kaiser <noreply@kp.org>",
      date: Date.now() - i * DAY,
      subject: i % 2 ? "Your statement is ready" : "Appointment reminder",
    }));
    const seen: string[][] = [];
    let gets = 0;
    const calls = fakeGoogle({ messages: many, search });
    const fakeFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    const inner = fakeFetch.getMockImplementation() as (input: string | URL, init?: RequestInit) => Promise<Response>;
    fakeFetch.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      if (/\/messages\/[^/]+$/.test(new URL(String(input)).pathname) && ++gets % 40 === 0) {
        seen.push((await kid.query(api.accounts.myAccounts, {})).map((a) => String(a._id)));
      }
      return inner(input, init);
    });
    await t.action(internal.gmailImport.importHistory, { familyId });
    expect(calls.length).toBeGreaterThan(0);
    // The list grew while the first pass was still reading, and rows kept their ids.
    expect(seen.some((ids) => ids.length > 0)).toBe(true);
    const final = (await kid.query(api.accounts.myAccounts, {})).map((a) => String(a._id));
    for (const ids of seen) for (const id of ids) expect(final).toContain(id);
    expect(final).toHaveLength(2);
  });

  test("reads subjects but never stores them anywhere", async () => {
    const { t, familyId } = await connected();
    const secret = "Statement for account ending 4417 ready";
    fakeGoogle({
      messages: [0, 20, 40].map((d, i) => ({ id: `s${i}`, from: "Wells Fargo <alerts@notify.wellsfargo.com>", date: Date.now() - d * DAY, subject: secret })),
    });
    await t.action(internal.gmailImport.importHistory, { familyId });
    const everything = await t.run(async (ctx) =>
      JSON.stringify(
        await Promise.all(
          (["accounts", "relationships", "orgDirectory", "families", "gmailTokens", "verdicts", "feedItems"] as const).map((n) =>
            ctx.db.query(n).collect(),
          ),
        ),
      ),
    );
    expect(everything).toContain("Wells Fargo");
    expect(everything).not.toContain("4417");
    expect(everything).not.toContain("ending");
  });

  test("an account the deeper pass shows is fake is gone at the end", async () => {
    const { t, kid, familyId } = await connected();
    const now = Date.now();
    const real = [0, 20, 40].map((d, i) => ({ id: `c${i}`, from: "Chase <alerts@chase.com>", date: now - d * DAY, subject: "Your statement is ready" }));
    const spoofs = Array.from({ length: 8 }, (_, i) => ({
      id: `x${i}`,
      from: "Chase <alerts@chase.com>",
      date: now - i * DAY,
      subject: "Hello",
      auth: "mx.google.com; dmarc=fail",
    }));
    let midway: string[] = [];
    fakeGoogle({
      messages: [...real, ...spoofs],
      search: (q, m) => !q.includes("subject:(") || m.subject !== "Hello",
      onList: async (q) => {
        if (q === "newer_than:2y -in:chats") midway = (await kid.query(api.accounts.myAccounts, {})).map((a) => a.orgName);
      },
    });
    await t.action(internal.gmailImport.importHistory, { familyId });
    expect(midway).toEqual(["Chase"]); // the first pass only saw real-looking Chase mail
    expect(await kid.query(api.accounts.myAccounts, {})).toEqual([]); // mostly failing: not Mom's account
  });

  test("a company outside our list gets one sign-in page lookup, then every import reuses it", async () => {
    const { t, kid, familyId } = await connected();
    const now = Date.now();
    // Half a year of appointment reminders from the dentist's own reminder mailbox.
    const dental: Msg[] = [5, 50, 95, 140, 185, 230].map((d, i) => ({
      id: `d${i}`,
      from: "Bayview Family Dental <reminders@bayviewdental.com>",
      date: now - d * DAY,
      subject: "Appointment reminder",
    }));
    fakeGoogle({ messages: [...inbox(), ...dental] });
    await t.action(internal.gmailImport.importHistory, { familyId });

    const dentist = async () => (await kid.query(api.accounts.myAccounts, {})).find((a) => a.officialDomains[0] === "bayviewdental.com");
    expect(await dentist()).toMatchObject({ orgName: "Bayview Family Dental", category: "other" });
    expect((await dentist())!.loginUrl).toBeUndefined();
    const lookups = async () =>
      (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((s) => s.name === "signInPages:lookUp");
    expect((await lookups()).map((s) => s.args[0])).toEqual([{ domain: "bayviewdental.com", familyId, nameHint: "Bayview Family Dental", attempt: 1 }]);

    // The lookup finds the dentist's portal (fake Claude, domain age and Safe Browsing).
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("SAFE_BROWSING_API_KEY", "sb-key");
    const portal = "https://portal.bayviewdental.com/login";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const host = new URL(String(input)).hostname;
        const json = (b: object) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
        if (host === "rdap.org") return json({ events: [{ eventAction: "registration", eventDate: "2009-01-01T00:00:00Z" }] });
        if (host === "safebrowsing.googleapis.com") return json({});
        return json({
          id: "m",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [
            { type: "server_tool_use", id: "s1", name: "web_fetch", input: { url: portal } },
            { type: "web_fetch_tool_result", tool_use_id: "s1", content: { type: "web_fetch_result", url: portal, retrieved_at: null, content: { type: "document", source: { type: "text", media_type: "text/plain", data: "Sign in" }, title: null, citations: null } } },
            { type: "text", text: JSON.stringify({ orgName: "Bayview Family Dental", category: "health", loginUrl: portal }) },
          ],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      }),
    );
    await t.action(internal.signInPages.lookUp, (await lookups())[0].args[0] as { domain: string; familyId: Id<"families">; nameHint: string });
    expect(await dentist()).toMatchObject({ loginUrl: portal, loginUrlSource: "discovered", category: "health" });

    // Importing again keeps the link and doesn't look it up again.
    fakeGoogle({ messages: [...inbox(), ...dental] });
    await t.action(internal.gmailImport.importHistory, { familyId });
    expect(await dentist()).toMatchObject({ loginUrl: portal, loginUrlSource: "discovered" });
    // No new lookup. (convex-test also runs the queued one in the background; if that run fails
    // against the fake Gmail it schedules its own retry, which is not a new lookup.)
    expect((await lookups()).filter((s) => s.args[0].attempt === 1)).toHaveLength(1);
  });

  test("demo mode looks nothing up", async () => {
    const { t, familyId } = await connected();
    fakeGoogle();
    await t.action(internal.gmailImport.importSample, { familyId });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((s) => s.name === "signInPages:lookUp")).toEqual([]);
    const names = (await t.run((ctx) => ctx.db.query("accounts").collect())).map((a) => a.orgName);
    for (const gone of ["AARP", "Sutter Health", "Apple", "Blue Shield of California", "Chase"]) expect(names).not.toContain(gone);
    expect(names).toContain("Bayview Family Dental");
  });
});
