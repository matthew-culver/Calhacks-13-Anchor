/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { AccountRow } from "./lib/history";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 60 * 60 * 1000;
const D = "bayviewdental.com";
const LOGIN = "https://portal.bayviewdental.com/login";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("SAFE_BROWSING_API_KEY", "sb-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function claudeReply(answer: object, fetched: string[]) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [
      ...fetched.flatMap((url, i) => [
        { type: "server_tool_use", id: `srvtoolu_${i}`, name: "web_fetch", input: { url } },
        {
          type: "web_fetch_tool_result",
          tool_use_id: `srvtoolu_${i}`,
          content: { type: "web_fetch_result", url, retrieved_at: null, content: { type: "document", source: { type: "text", media_type: "text/plain", data: "Sign in" }, title: null, citations: null } },
        },
      ]),
      { type: "text", text: JSON.stringify(answer) },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

/** Fake RDAP (domain age), Claude and Safe Browsing. Records which hosts were called. */
function fakeWeb(opts: { ageDays?: number | null; answer?: object; fetched?: string[]; listed?: boolean; safeBrowsingDown?: boolean } = {}) {
  const hosts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      if (url.hostname === "rdap.org") {
        if (opts.ageDays === null) return new Response("{}", { status: 404 });
        const registered = new Date(Date.now() - (opts.ageDays ?? 3000) * DAY).toISOString();
        return new Response(JSON.stringify({ events: [{ eventAction: "registration", eventDate: registered }] }), { status: 200 });
      }
      if (url.hostname === "safebrowsing.googleapis.com") {
        if (opts.safeBrowsingDown) return new Response("{}", { status: 503 });
        return new Response(JSON.stringify(opts.listed ? { matches: [{ threat: { url: LOGIN } }] } : {}), { status: 200 });
      }
      const reply = claudeReply(opts.answer ?? { orgName: "Bayview Family Dental", category: "health", loginUrl: LOGIN }, opts.fetched ?? [LOGIN]);
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return hosts;
}

const dental = (rank = 20): AccountRow => ({
  orgName: "Bayview Family Dental",
  category: "other",
  officialDomains: [D],
  firstSeen: Date.now() - 300 * DAY,
  messageCount: 6,
  rank,
  signals: ["appointment"],
  lastActivity: Date.now() - 5 * DAY,
});

async function family() {
  const t = convexTest(schema, modules);
  const kidId: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { email: "lucas@example.com" }));
  const kid = t.withIdentity({ subject: `${kidId}|s` });
  const { familyId } = await kid.mutation(api.families.createFamily, { parentName: "Mom", parentEmail: "mom@gmail.com", kidName: "Lucas" });
  await t.run((ctx) => ctx.db.patch(familyId, { status: "learning" }));
  return { t, kid, familyId };
}

const scheduledLookups = async (t: ReturnType<typeof convexTest>) =>
  (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((s) => s.name === "signInPages:lookUp");

const lookUp = (t: ReturnType<typeof convexTest>, familyId: Id<"families">, attempt?: number) =>
  t.action(internal.signInPages.lookUp, { domain: D, familyId, nameHint: "Bayview Family Dental", ...(attempt && { attempt }) });
const entry = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("orgDirectory").unique());

describe("sign-in page lookups", () => {
  test("a found page fills in the account live: link, own name, group; the rank stays", async () => {
    const { t, kid, familyId } = await family();
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    const hosts = fakeWeb();
    await lookUp(t, familyId);

    const [account] = await kid.query(api.accounts.myAccounts, {});
    expect(account).toMatchObject({ orgName: "Bayview Family Dental", category: "health", loginUrl: LOGIN, loginUrlSource: "discovered", rank: 20 });
    expect(await entry(t)).toMatchObject({ domain: D, orgName: "Bayview Family Dental", category: "health", loginUrl: LOGIN });
    expect(hosts).toEqual(expect.arrayContaining(["rdap.org", "api.anthropic.com", "safebrowsing.googleapis.com"]));
  });

  test("the next save reuses it without asking Claude again", async () => {
    const { t, kid, familyId } = await family();
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    fakeWeb();
    await lookUp(t, familyId);
    const before = (await scheduledLookups(t)).length;
    // A fresh import builds the row without a link again; the save fills it from the directory.
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    expect(await kid.query(api.accounts.myAccounts, {})).toEqual([expect.objectContaining({ loginUrl: LOGIN, category: "health" })]);
    expect(await scheduledLookups(t)).toHaveLength(before);
  });

  test("fails closed: a young domain gets no link, and Claude isn't asked", async () => {
    const { t, kid, familyId } = await family();
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    const hosts = fakeWeb({ ageDays: 200 });
    await lookUp(t, familyId);
    expect(hosts).not.toContain("api.anthropic.com");
    expect((await kid.query(api.accounts.myAccounts, {}))[0].loginUrl).toBeUndefined();
    expect((await entry(t))!.checkedAt).toBeGreaterThan(0); // finished: nothing to find
  });

  test("fails closed: an age we can't learn, or Safe Browsing not answering, means no link and a retry", async () => {
    const { t, kid, familyId } = await family();
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    const hosts = fakeWeb({ ageDays: null });
    await lookUp(t, familyId);
    expect(hosts).not.toContain("api.anthropic.com");
    fakeWeb({ safeBrowsingDown: true });
    await lookUp(t, familyId);
    expect((await kid.query(api.accounts.myAccounts, {}))[0].loginUrl).toBeUndefined();
    expect((await entry(t))!.checkedAt).toBe(0);
    const retries = (await scheduledLookups(t)).filter((s) => (s.args[0] as { attempt: number }).attempt === 2);
    expect(retries.length).toBeGreaterThanOrEqual(1);
  });

  test("a page on Google's danger list gets no link", async () => {
    const { t, kid, familyId } = await family();
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    fakeWeb({ listed: true });
    await lookUp(t, familyId);
    expect((await kid.query(api.accounts.myAccounts, {}))[0].loginUrl).toBeUndefined();
  });

  test("a link off the company's domain is never stored", async () => {
    const { t, kid, familyId } = await family();
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    fakeWeb({ answer: { orgName: "Bayview", category: "health", loginUrl: "https://bayview-login.co/" }, fetched: ["https://bayview-login.co/"] });
    await lookUp(t, familyId);
    expect((await kid.query(api.accounts.myAccounts, {}))[0].loginUrl).toBeUndefined();
    expect((await entry(t))!.loginUrl).toBeUndefined();
  });

  test("a failed attempt retries itself twice, then waits for a later save", async () => {
    const { t, familyId } = await family();
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    fakeWeb({ ageDays: null });
    await lookUp(t, familyId, 1);
    await lookUp(t, familyId, 2);
    await lookUp(t, familyId, 3);
    const attempts = async () => (await scheduledLookups(t)).map((s) => (s.args[0] as { attempt: number }).attempt);
    // The first from the save, then two retries, then none.
    expect(new Set(await attempts())).toEqual(new Set([1, 2, 3]));
    const firsts = async () => (await attempts()).filter((a) => a === 1).length;
    // A save soon after doesn't queue it again; one an hour later does.
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    expect(await firsts()).toBe(1);
    const row = (await entry(t))!;
    await t.run((ctx) => ctx.db.patch(row._id, { lookupStartedAt: Date.now() - 2 * 60 * 60 * 1000 }));
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    expect(await firsts()).toBe(2);
  });

  test("without the API keys nothing is looked up, and the account just has no link", async () => {
    vi.stubEnv("SAFE_BROWSING_API_KEY", "");
    const { t, kid, familyId } = await family();
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    const hosts = fakeWeb();
    await lookUp(t, familyId);
    expect(hosts).toEqual([]);
    expect((await kid.query(api.accounts.myAccounts, {}))[0].loginUrl).toBeUndefined();
    expect((await scheduledLookups(t)).filter((s) => (s.args[0] as { attempt: number }).attempt === 2)).toEqual([]);
  });

  test("a found link is checked again after 90 days and removed if it no longer passes", async () => {
    const { t, kid, familyId } = await family();
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    fakeWeb();
    await lookUp(t, familyId);
    const row = (await entry(t))!;
    await t.run((ctx) => ctx.db.patch(row._id, { checkedAt: Date.now() - 91 * DAY }));
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [dental()] });
    expect(await scheduledLookups(t)).toHaveLength(2);
    // While the check runs, Mom still sees the link she had.
    expect((await kid.query(api.accounts.myAccounts, {}))[0].loginUrl).toBe(LOGIN);
    fakeWeb({ listed: true });
    await lookUp(t, familyId);
    expect((await kid.query(api.accounts.myAccounts, {}))[0]).not.toHaveProperty("loginUrl");
  });

  test("capped: a few per save, a limit per family, and one across all families", async () => {
    const { t, familyId } = await family();
    const many = (n: number) =>
      Array.from({ length: n }, (_, i): AccountRow => ({ ...dental(50 - i), orgName: `Clinic ${i}`, officialDomains: [`clinic${i}.com`] }));
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: many(12) });
    // The most important accounts first, a few seconds apart.
    const first = await scheduledLookups(t);
    expect(first.map((s) => (s.args[0] as { domain: string }).domain)).toEqual(["clinic0.com", "clinic1.com", "clinic2.com", "clinic3.com", "clinic4.com"]);
    for (let i = 0; i < 5; i++) await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: many(60) });
    expect(await scheduledLookups(t)).toHaveLength(10); // per family, per hour

    for (let f = 0; f < 4; f++) {
      const kidId: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { email: `k${f}@example.com` }));
      const kid = t.withIdentity({ subject: `${kidId}|s` });
      const { familyId: other } = await kid.mutation(api.families.createFamily, { parentName: "Mom", parentEmail: `m${f}@gmail.com`, kidName: "K" });
      const theirs = Array.from({ length: 12 }, (_, i): AccountRow => ({ ...dental(), orgName: `Shop ${f}-${i}`, officialDomains: [`shop${f}x${i}.com`] }));
      for (let i = 0; i < 3; i++) await t.mutation(internal.gmailImport.saveAccounts, { familyId: other, accounts: theirs });
    }
    expect(await scheduledLookups(t)).toHaveLength(30); // across all families, per hour
  });

  test("never for companies in our list, and nothing written for a family that turned it off", async () => {
    const { t, kid, familyId } = await family();
    const kaiser: AccountRow = { ...dental(), orgName: "Kaiser Permanente", category: "health", officialDomains: ["kp.org", "kaiserpermanente.org"] };
    await t.mutation(internal.gmailImport.saveAccounts, { familyId, accounts: [kaiser, dental()] });
    expect((await scheduledLookups(t)).map((s) => (s.args[0] as { domain: string }).domain)).toEqual([D]);

    await t.run((ctx) => ctx.db.patch(familyId, { status: "off" }));
    const hosts = fakeWeb();
    await lookUp(t, familyId);
    expect(hosts).toEqual([]); // not even asked
    const rows = await t.run((ctx) => ctx.db.query("accounts").collect());
    expect(rows.find((r) => r.officialDomains[0] === D)!.loginUrl).toBeUndefined();
    expect(await kid.query(api.accounts.myAccounts, {})).toEqual([]);
  });
});
