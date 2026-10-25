// My Accounts for the screens (B4, B8). The kid reads through their login, the parent through
// their private link. Same list for both: "the parent sees exactly what the kid sees".
// Most important first (A8 `rank`, descending), then by name. During the import the list
// fills in and re-sorts live as accounts are saved.

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { accountCategory, accountSignal } from "./contract";
import { byRank } from "./lib/history";

const MAX_ACCOUNTS = 100;

const accountView = v.object({
  _id: v.id("accounts"),
  orgName: v.string(),
  category: accountCategory,
  officialDomains: v.array(v.string()),
  loginUrl: v.optional(v.string()), // no link when we don't know the org's sign-in page
  firstSeen: v.number(),
  messageCount: v.number(),
  rank: v.optional(v.number()),
  signals: v.optional(v.array(accountSignal)),
  lastActivity: v.optional(v.number()),
  loginUrlSource: v.optional(v.union(v.literal("curated"), v.literal("discovered"))),
});

async function accountsOf(ctx: QueryCtx, familyId: Id<"families">) {
  const rows = await ctx.db
    .query("accounts")
    .withIndex("by_family", (q) => q.eq("familyId", familyId))
    .take(MAX_ACCOUNTS);
  return rows
    .map((a) => ({
      _id: a._id,
      orgName: a.orgName,
      category: a.category,
      officialDomains: a.officialDomains,
      ...(a.loginUrl !== undefined && { loginUrl: a.loginUrl }),
      firstSeen: a.firstSeen,
      messageCount: a.messageCount,
      ...(a.rank !== undefined && { rank: a.rank }),
      ...(a.signals !== undefined && { signals: a.signals }),
      ...(a.lastActivity !== undefined && { lastActivity: a.lastActivity }),
      ...(a.loginUrlSource !== undefined && { loginUrlSource: a.loginUrlSource }),
    }))
    .sort(byRank);
}

/** The signed-in kid's family's accounts. Empty when signed out or not set up. */
export const myAccounts = query({
  args: {},
  returns: v.array(accountView),
  handler: async (ctx) => {
    const kidUserId = await getAuthUserId(ctx);
    if (kidUserId === null) return [];
    const family = await ctx.db
      .query("families")
      .withIndex("by_kid", (q) => q.eq("kidUserId", kidUserId))
      .unique();
    if (family === null || family.status === "off") return [];
    return accountsOf(ctx, family._id);
  },
});

/** The parent's big-text My Accounts page, by their private link. */
export const parentAccounts = query({
  args: { parentToken: v.string() },
  returns: v.array(accountView),
  handler: async (ctx, { parentToken }) => {
    if (parentToken.length === 0 || parentToken.length > 64) return [];
    const family = await ctx.db
      .query("families")
      .withIndex("by_parent_token", (q) => q.eq("parentToken", parentToken))
      .unique();
    if (family === null || family.status === "off") return [];
    return accountsOf(ctx, family._id);
  },
});
