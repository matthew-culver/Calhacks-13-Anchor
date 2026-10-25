// Before presenting: clear what Anchor recorded about a family's checked emails (verdicts,
// kid feed items, investigations), so "This week" starts at zero and old test emails don't
// show. Keeps everything else: My Accounts, the history, the Gmail connection, Anchor's own
// note records, and the emails themselves (held mail stays in "Anchor: Held" in Gmail).
// Terminal only (internal):
//   npx convex run demo:clearChecked '{"familyId":"<id>"}'
// Bounded per run; it says how many it cleared, so run it again if it hit the cap.

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const MAX_PER_TABLE = 2000;

export const clearChecked = internalMutation({
  args: { familyId: v.id("families") },
  returns: v.object({ verdicts: v.number(), feedItems: v.number(), investigations: v.number() }),
  handler: async (ctx, { familyId }) => {
    const feedItems = await ctx.db
      .query("feedItems")
      .withIndex("by_family_created", (q) => q.eq("familyId", familyId))
      .take(MAX_PER_TABLE);
    const investigations = await ctx.db
      .query("investigations")
      .withIndex("by_family", (q) => q.eq("familyId", familyId))
      .take(MAX_PER_TABLE);
    const verdicts = await ctx.db
      .query("verdicts")
      .withIndex("by_family_received", (q) => q.eq("familyId", familyId))
      .take(MAX_PER_TABLE);
    for (const row of [...feedItems, ...investigations, ...verdicts]) await ctx.db.delete(row._id);
    return { verdicts: verdicts.length, feedItems: feedItems.length, investigations: investigations.length };
  },
});
