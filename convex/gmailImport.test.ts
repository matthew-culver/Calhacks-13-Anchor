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

type Msg = { id: string; from: string; to?: string; date: number; labels?: string[]; auth?: string };

type Fail = { status: number; body?: string; times: number };

/** Fake Gmail and Google token endpoints. Records every request. `fail` makes message gets fail first. */
function fakeGoogle(
  opts: { messages?: Msg[]; refresh?: { status: number; body: object }; failGets?: Fail; failProfile?: Fail } = {},
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
        const page = Number(url.searchParams.get("pageToken") ?? 0);
        const size = Number(url.searchParams.get("maxResults"));
        const slice = messages.slice(page, page + size);
        const next = page + size < messages.length ? String(page + size) : undefined;
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
            { name: "Authentication-Results", value: m.auth ?? PASS },
          ],
        },
      });
    }),
  );
  return calls;
}

const inbox = (now = Date.now()): Msg[] => [
  { id: "1", from: "Kaiser <noreply@kp.org>", date: now - 500 * DAY },
  { id: "1b", from: "Kaiser <noreply@kp.org>", date: now - 200 * DAY },
  { id: "2", from: "Kaiser <alerts@mail.kaiserpermanente.org>", date: now - 3 * DAY },
  { id: "3", from: "Wells Fargo <alerts@notify.wellsfargo.com>", date: now - 40 * DAY },
  { id: "3b", from: "Wells Fargo <alerts@notify.wellsfargo.com>", date: now - 25 * DAY },
  { id: "3c", from: "Wells Fargo <alerts@notify.wellsfargo.com>", date: now - 10 * DAY },
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
    expect(gets.length).toBe(inbox().length); // both list passes, deduplicated
    for (const g of gets) {
      const p = new URL(g.url).searchParams;
      expect(p.get("format")).toBe("metadata");
      expect(p.getAll("metadataHeaders")).toEqual(["From", "To", "Authentication-Results"]);
      expect(p.get("fields")).toBe("internalDate,labelIds,payload/headers");
    }
    const lists = calls.filter((c) => new URL(c.url).pathname.endsWith("/messages"));
    expect(lists.some((c) => new URL(c.url).searchParams.get("q")!.includes("from:(") && c.url.includes("kp.org"))).toBe(true);
    expect(calls.every((c) => c.url.includes("oauth2") || c.auth === "Bearer access-1")).toBe(true);
    expect(new URL(calls.find((c) => c.url.includes("/messages?"))!.url).searchParams.get("q")).toContain("newer_than:2y");

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
  const many: Msg[] = Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, from: `Kaiser <x@kp.org>`, date: Date.now() - i * 3600_000 }));
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

  test("the kid sees their family's accounts, without internal ids", async () => {
    const { kid } = await withAccounts();
    const accounts = await kid.query(api.accounts.myAccounts, {});
    expect(accounts.map((a) => a.orgName)).toEqual(["Kaiser Permanente", "Wells Fargo"]);
    expect(accounts[0]).not.toHaveProperty("familyId");
    expect(accounts[0]).toMatchObject({ category: "health", loginUrl: "https://healthy.kaiserpermanente.org/" });
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
