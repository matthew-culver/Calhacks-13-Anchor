// The kid's feed and the weekly recap (B3, B5). Only flagged emails ever reach these:
// real mail stays private to the parent. The parent's link sees exactly the same.

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { checkResult, kidAnswer, verdictLevel, weeklyRecap } from "./contract";

const FEED_SIZE = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap on how many of a week's verdicts the recap reads. Plenty for one inbox. */
const RECAP_SCAN = 2000;

const feedEntry = v.object({
  _id: v.id("feedItems"),
  kind: v.union(v.literal("needs_answer"), v.literal("held")),
  createdAt: v.number(),
  kidAnswer: v.optional(kidAnswer),
  verdict: v.object({
    level: verdictLevel,
    receivedAt: v.number(),
    fromName: v.optional(v.string()),
    fromAddress: v.optional(v.string()),
    subject: v.optional(v.string()),
    claimedOrg: v.optional(v.string()),
    checks: v.optional(v.array(checkResult)),
    explanationForParent: v.optional(v.string()),
    explanationForKid: v.optional(v.string()),
  }),
});

async function kidFamily(ctx: QueryCtx): Promise<Doc<"families"> | null> {
  const kidUserId = await getAuthUserId(ctx);
  if (kidUserId === null) return null;
  const family = await ctx.db
    .query("families")
    .withIndex("by_kid", (q) => q.eq("kidUserId", kidUserId))
    .unique();
  return family && family.status !== "off" ? family : null;
}

async function parentFamily(ctx: QueryCtx, parentToken: string): Promise<Doc<"families"> | null> {
  if (parentToken.length === 0) return null;
  const family = await ctx.db
    .query("families")
    .withIndex("by_parent_token", (q) => q.eq("parentToken", parentToken))
    .unique();
  return family && family.status !== "off" ? family : null;
}

async function feedOf(ctx: QueryCtx, familyId: Id<"families">) {
  const items = await ctx.db
    .query("feedItems")
    .withIndex("by_family_created", (q) => q.eq("familyId", familyId))
    .order("desc")
    .take(FEED_SIZE);
  const out = [];
  for (const item of items) {
    const verdict = await ctx.db.get(item.verdictId);
    if (!verdict || verdict.familyId !== familyId) continue;
    out.push({
      _id: item._id,
      kind: item.kind,
      createdAt: item.createdAt,
      ...(item.kidAnswer !== undefined && { kidAnswer: item.kidAnswer }),
      verdict: {
        level: verdict.level,
        receivedAt: verdict.receivedAt,
        ...(verdict.fromName !== undefined && { fromName: verdict.fromName }),
        ...(verdict.fromAddress !== undefined && { fromAddress: verdict.fromAddress }),
        ...(verdict.subject !== undefined && { subject: verdict.subject }),
        ...(verdict.claimedOrg !== undefined && { claimedOrg: verdict.claimedOrg }),
        ...(verdict.checks !== undefined && { checks: verdict.checks }),
        ...(verdict.explanationForParent !== undefined && { explanationForParent: verdict.explanationForParent }),
        ...(verdict.explanationForKid !== undefined && { explanationForKid: verdict.explanationForKid }),
      },
    });
  }
  return out;
}

const HOUR_MS = 60 * 60 * 1000;

async function recapOf(ctx: QueryCtx, familyId: Id<"families">, now: number) {
  // Hour-aligned window: a caller picking `now` values can't time the parent's real mail.
  const weekEnd = Math.ceil(now / HOUR_MS) * HOUR_MS;
  const weekStart = weekEnd - WEEK_MS;
  const verdicts = await ctx.db
    .query("verdicts")
    .withIndex("by_family_received", (q) => q.eq("familyId", familyId).gte("receivedAt", weekStart).lt("receivedAt", weekEnd))
    .take(RECAP_SCAN);
  const items = await ctx.db
    .query("feedItems")
    .withIndex("by_family_created", (q) => q.eq("familyId", familyId).gte("createdAt", weekStart).lt("createdAt", weekEnd))
    .take(RECAP_SCAN);
  return {
    weekStart,
    checked: verdicts.length,
    held: verdicts.filter((x) => x.action === "held").length,
    needAnswer: items.filter((i) => i.kind === "needs_answer" && i.kidAnswer === undefined).length,
    goodCatches: items.filter((i) => i.kidAnswer?.answer === "scam").length,
  };
}

/** The signed-in kid's feed, newest first. */
export const myFeed = query({
  args: {},
  returns: v.array(feedEntry),
  handler: async (ctx) => {
    const family = await kidFamily(ctx);
    return family ? feedOf(ctx, family._id) : [];
  },
});

/** The parent's view of the same feed, by their private link. */
export const parentFeed = query({
  args: { parentToken: v.string() },
  returns: v.array(feedEntry),
  handler: async (ctx, { parentToken }) => {
    const family = await parentFamily(ctx, parentToken);
    return family ? feedOf(ctx, family._id) : [];
  },
});

/**
 * "This week: 41 checked, 2 held, 0 need an answer." Queries can't read the clock, so the
 * page passes `now`; round it to the minute so the subscription isn't recreated every render.
 */
export const myWeeklyRecap = query({
  args: { now: v.number() },
  returns: v.union(v.null(), weeklyRecap),
  handler: async (ctx, { now }) => {
    const family = await kidFamily(ctx);
    return family ? recapOf(ctx, family._id, now) : null;
  },
});

export const parentWeeklyRecap = query({
  args: { parentToken: v.string(), now: v.number() },
  returns: v.union(v.null(), weeklyRecap),
  handler: async (ctx, { parentToken, now }) => {
    const family = await parentFamily(ctx, parentToken);
    return family ? recapOf(ctx, family._id, now) : null;
  },
});
