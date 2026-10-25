/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.stubEnv("ANCHOR_GMAIL_ACTIONS", "on"));
afterEach(() => vi.unstubAllEnvs());

async function familyWithItem(opts: { age: number; applied?: boolean; answered?: boolean; status?: "active" | "off" }) {
  const t = convexTest(schema, modules);
  const kidId: Id<"users"> = await t.run((ctx) => ctx.db.insert("users", { email: "k@example.com" }));
  const { familyId } = await t
    .withIdentity({ subject: `${kidId}|s` })
    .mutation(api.families.createFamily, { parentName: "Mom", parentEmail: "mom@gmail.com", kidName: "Lucas" });
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.patch(familyId, { status: opts.status ?? "active" });
    const verdictId = await ctx.db.insert("verdicts", {
      familyId,
      gmailMessageId: "m",
      receivedAt: now - opts.age,
      level: "fake",
      ruleLevel: "fake",
      fromDomain: "x.co",
      action: "held",
      ...(opts.applied && { actionAppliedAt: now, parentNoteSentAt: now }),
    });
    await ctx.db.insert("feedItems", {
      familyId,
      verdictId,
      kind: "held",
      createdAt: now - opts.age,
      ...(opts.answered && { kidAnswer: { answer: "fine" as const, answeredAt: now - opts.age } }),
    });
    if (opts.status === "off") await ctx.db.insert("gmailTokens", { familyId, refreshToken: "r" });
  });
  return { t, familyId };
}

const scheduledNames = async (t: Awaited<ReturnType<typeof familyWithItem>>["t"]) =>
  (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).map((s) => s.name);

test("re-tries a hold that never reached Gmail", async () => {
  const { t } = await familyWithItem({ age: 10 * 60_000 });
  await t.mutation(internal.repair.repairAll, {});
  expect(await scheduledNames(t)).toContain("gmailActions:applyVerdict");
});

test("leaves fresh and finished items alone", async () => {
  const fresh = await familyWithItem({ age: 10_000 });
  await fresh.t.mutation(internal.repair.repairAll, {});
  expect(await scheduledNames(fresh.t)).toEqual([]);
  const done = await familyWithItem({ age: 10 * 60_000, applied: true });
  await done.t.mutation(internal.repair.repairAll, {});
  expect(await scheduledNames(done.t)).toEqual([]);
});

test("re-tries a kid answer that never reached Gmail", async () => {
  const { t } = await familyWithItem({ age: 10 * 60_000, answered: true });
  await t.mutation(internal.repair.repairAll, {});
  expect(await scheduledNames(t)).toContain("gmailActions:applyAnswer");
});

test("does nothing in Gmail while the safety switch is off", async () => {
  vi.stubEnv("ANCHOR_GMAIL_ACTIONS", "");
  const { t } = await familyWithItem({ age: 10 * 60_000 });
  await t.mutation(internal.repair.repairAll, {});
  expect(await scheduledNames(t)).toEqual([]);
});

test("finishes a turn-off whose cleanup didn't complete", async () => {
  const { t } = await familyWithItem({ age: 10 * 60_000, status: "off" });
  await t.mutation(internal.repair.repairAll, {});
  expect(await scheduledNames(t)).toContain("turnOff:revokeAndDelete");
});
