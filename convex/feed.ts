// The kid's feed and the weekly recap (B3, B5). Only flagged emails ever reach these:
// real mail stays private to the parent. The parent's link sees exactly the same.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { weeklyRecap } from "./contract";
import schema from "./schema";

const FEED_SIZE = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Cap on how many of a week's verdicts the recap reads. Plenty for one inbox. */
const RECAP_SCAN = 2000;

export const MAX_NOTE = 280;

/** One feed card: the feed item with its verdict attached (the shape the screens use). */
const feedEntry = schema.doc("feedItems").extend({ verdict: schema.doc("verdicts") });

/** Statuses whose feed the kid can see. Empty before the parent connects and after "off". */
const SHOWS_FEED = new Set(["learning", "active", "needs_reconnect"]);

async function kidFamily(ctx: QueryCtx): Promise<Doc<"families"> | null> {
  const kidUserId = await getAuthUserId(ctx);
  if (kidUserId === null) return null;
  const family = await ctx.db
    .query("families")
    .withIndex("by_kid", (q) => q.eq("kidUserId", kidUserId))
    .unique();
  return family && SHOWS_FEED.has(family.status) ? family : null;
}

async function parentFamily(ctx: QueryCtx, parentToken: string): Promise<Doc<"families"> | null> {
  if (parentToken.length === 0) return null;
  const family = await ctx.db
    .query("families")
    .withIndex("by_parent_token", (q) => q.eq("parentToken", parentToken))
    .unique();
  return family && SHOWS_FEED.has(family.status) ? family : null;
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
    out.push({ ...item, verdict });
  }
  return out;
}

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

/**
 * The kid's one-tap answer: "It's fine" or "It's a scam", with an optional note in their own
 * words. The first answer stands; a second one is refused. A6 then releases or holds the email
 * in Gmail and passes the note to the parent.
 */
export const answer = mutation({
  args: {
    feedItemId: v.id("feedItems"),
    answer: v.union(v.literal("fine"), v.literal("scam")),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const family = await kidFamily(ctx);
    if (!family) throw new ConvexError("Please sign in first.");
    const item = await ctx.db.get(args.feedItemId);
    if (!item || item.familyId !== family._id) throw new ConvexError("We couldn't find that message.");
    if (item.kidAnswer) throw new ConvexError("You already answered this one.");
    const verdict = await ctx.db.get(item.verdictId);
    if (!verdict || verdict.familyId !== family._id) throw new ConvexError("We couldn't find that message.");

    const note = Array.from(
      (args.note ?? "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
      .slice(0, MAX_NOTE)
      .join("");
    await ctx.db.patch(item._id, {
      kidAnswer: { answer: args.answer, ...(note && { note }), answeredAt: Date.now() },
    });
    await ctx.db.patch(verdict._id, { action: args.answer === "fine" ? "released" : "held" });
    await ctx.scheduler.runAfter(0, internal.gmailActions.applyAnswer, { feedItemId: item._id });
    return null;
  },
});
