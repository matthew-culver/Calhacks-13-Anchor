/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function familyWithMail(t: ReturnType<typeof convexTest>, n: number) {
  return t.run(async (ctx) => {
    const kidUserId: Id<"users"> = await ctx.db.insert("users", { email: `kid${n}@example.com` });
    const familyId = await ctx.db.insert("families", {
      kidUserId, parentName: "Mom", parentEmail: `mom${n}@gmail.com`, kidName: "Lucas", status: "active", parentToken: `token-${n}`,
    });
    const verdictId = await ctx.db.insert("verdicts", {
      familyId, gmailMessageId: `m${n}`, receivedAt: Date.now(), level: "fake", ruleLevel: "fake", fromDomain: "gmail.com", action: "held",
    });
    await ctx.db.insert("feedItems", { familyId, verdictId, kind: "held", createdAt: Date.now() });
    await ctx.db.insert("investigations", { familyId, verdictId, status: "done", startedAt: Date.now(), steps: [] });
    await ctx.db.insert("accounts", {
      familyId, orgName: "Wells Fargo", category: "bank", officialDomains: ["wellsfargo.com"], firstSeen: 0, messageCount: 3,
    });
    return familyId;
  });
}

test("clears a family's checked emails and nothing else", async () => {
  const t = convexTest(schema, modules);
  const familyId = await familyWithMail(t, 1);
  const other = await familyWithMail(t, 2);

  expect(await t.mutation(internal.demo.clearChecked, { familyId })).toEqual({ verdicts: 1, feedItems: 1, investigations: 1 });

  const count = (table: "verdicts" | "feedItems" | "investigations" | "accounts", id: Id<"families">) =>
    t.run(async (ctx) => (await ctx.db.query(table).collect()).filter((r) => r.familyId === id).length);
  for (const table of ["verdicts", "feedItems", "investigations"] as const) {
    expect(await count(table, familyId), table).toBe(0);
    expect(await count(table, other), `${table} of another family`).toBe(1);
  }
  expect(await count("accounts", familyId)).toBe(1); // My Accounts stays
  expect(await t.run((ctx) => ctx.db.get(familyId))).toMatchObject({ status: "active" });
});
