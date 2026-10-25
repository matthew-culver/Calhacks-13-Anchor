// "Turn it off" (B5): the parent's one tap stops everything at once, then this cleans up.
// The family row stays with status "off", so both the kid's and the parent's screens can say
// so, but every bit of email-derived data is deleted and Google access is revoked.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { GOOGLE_REVOKE_URL, GOOGLE_TIMEOUT_MS } from "./lib/oauth";

/** Rows deleted per table per mutation call; the job re-schedules itself until done. */
const BATCH = 200;

/** The parent's button. Takes effect immediately: the watcher and the feeds stop at "off". */
export const turnOff = mutation({
  args: { parentToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { parentToken }) => {
    if (parentToken.length === 0) return null;
    const family = await ctx.db
      .query("families")
      .withIndex("by_parent_token", (q) => q.eq("parentToken", parentToken))
      .unique();
    if (!family || family.status === "off") return null; // unknown link or already off: nothing to do
    await ctx.db.patch(family._id, { status: "off", inviteToken: undefined, inviteExpiresAt: undefined });
    await ctx.scheduler.runAfter(0, internal.turnOff.revokeAndDelete, { familyId: family._id });
    return null;
  },
});

export const tokenForRevoke = internalQuery({
  args: { familyId: v.id("families") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { familyId }) => {
    const tokens = await ctx.db
      .query("gmailTokens")
      .withIndex("by_family", (q) => q.eq("familyId", familyId))
      .unique();
    return tokens?.refreshToken ?? null;
  },
});

/** Revoke Google access first (while we still have the token), then delete the data. */
export const revokeAndDelete = internalAction({
  args: { familyId: v.id("families") },
  returns: v.null(),
  handler: async (ctx, { familyId }) => {
    const refreshToken = await ctx.runQuery(internal.turnOff.tokenForRevoke, { familyId });
    if (refreshToken) {
      try {
        const res = await fetch(GOOGLE_REVOKE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken }).toString(),
          signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
        });
        // 400 means the grant was already gone (e.g. the parent removed it in Google). Fine.
        if (!res.ok && res.status !== 400) console.error(`turnOff: Google revoke returned ${res.status}`);
      } catch {
        console.error("turnOff: Google revoke failed; deleting the token anyway");
      }
    }
    await ctx.runMutation(internal.turnOff.deleteFamilyData, { familyId });
    return null;
  },
});

/** Delete a batch of every table's rows for this family; re-schedule until nothing is left. */
export const deleteFamilyData = internalMutation({
  args: { familyId: v.id("families") },
  returns: v.null(),
  handler: async (ctx, { familyId }) => {
    const family = await ctx.db.get(familyId);
    if (!family || family.status !== "off") return null; // turned back on meanwhile: stop

    let more = false;
    const sweep = async (rows: { _id: Id<TableNames> }[]) => {
      for (const row of rows) await ctx.db.delete(row._id);
      if (rows.length === BATCH) more = true;
    };
    await sweep(await ctx.db.query("feedItems").withIndex("by_family_created", (q) => q.eq("familyId", familyId)).take(BATCH));
    await sweep(await ctx.db.query("verdicts").withIndex("by_family_received", (q) => q.eq("familyId", familyId)).take(BATCH));
    await sweep(await ctx.db.query("relationships").withIndex("by_family_key", (q) => q.eq("familyId", familyId)).take(BATCH));
    await sweep(await ctx.db.query("accounts").withIndex("by_family", (q) => q.eq("familyId", familyId)).take(BATCH));
    await sweep(await ctx.db.query("pollFailures").withIndex("by_family_message", (q) => q.eq("familyId", familyId)).take(BATCH));
    await sweep(await ctx.db.query("anchorNotes").withIndex("by_family_message", (q) => q.eq("familyId", familyId)).take(BATCH));
    await sweep(await ctx.db.query("oauthStates").withIndex("by_family", (q) => q.eq("familyId", familyId)).take(BATCH));
    await sweep(await ctx.db.query("gmailTokens").withIndex("by_family", (q) => q.eq("familyId", familyId)).take(BATCH));

    if (more) await ctx.scheduler.runAfter(0, internal.turnOff.deleteFamilyData, { familyId });
    return null;
  },
});
