// Self-healing (runs every 5 minutes): anything that should have happened but didn't gets
// another go. A Gmail outage, an expired token, or the safety switch being turned on later
// must not leave a scam sitting in the inbox while the screens say "held".
//   - flagged verdicts never applied in Gmail
//   - kid answers never applied in Gmail
//   - "off" families whose cleanup didn't finish

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { actionsEnabled } from "./gmailActions";

const LOOKBACK_MS = 48 * 60 * 60 * 1000; // older than this is left alone
const GRACE_MS = 5 * 60 * 1000; // longer than a full retry chain, so repair never races it
const MAX_FAMILIES = 200;
const MAX_PER_FAMILY = 50;

export const repairAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    if (actionsEnabled()) {
      // Not needs_reconnect: its Google access is dead until the parent reconnects.
      for (const status of ["active", "learning"] as const) {
        const families = await ctx.db
          .query("families")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(MAX_FAMILIES);
        for (const family of families) {
          const items = await ctx.db
            .query("feedItems")
            .withIndex("by_family_created", (q) => q.eq("familyId", family._id).gte("createdAt", now - LOOKBACK_MS))
            .order("desc") // newest first, so a flood can't starve recent items
            .take(MAX_PER_FAMILY);
          for (const item of items) {
            if (item.kidAnswer) {
              if (item.answerAppliedAt === undefined && now - item.kidAnswer.answeredAt > GRACE_MS) {
                await ctx.scheduler.runAfter(0, internal.gmailActions.applyAnswer, { feedItemId: item._id });
              }
              continue;
            }
            const verdict = await ctx.db.get(item.verdictId);
            if (!verdict || now - item.createdAt < GRACE_MS) continue;
            if (verdict.actionAppliedAt === undefined) {
              await ctx.scheduler.runAfter(0, internal.gmailActions.applyVerdict, { verdictId: verdict._id });
            }
          }
        }
      }
    }

    // An investigation stuck "running" (its action died): finish it so the kid isn't left waiting.
    const stuck = await ctx.db
      .query("investigations")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .take(MAX_FAMILIES);
    for (const inv of stuck) {
      if (now - inv.startedAt < 10 * 60 * 1000) continue;
      const verdict = await ctx.db.get(inv.verdictId);
      await ctx.db.patch(inv._id, {
        status: "failed",
        finishedAt: now,
        conclusion: {
          level: verdict?.level ?? "unsure",
          summary: "We couldn't finish checking this one, so please take a look.",
          sender: { verdict: "unverified", reason: "We couldn't finish the check." },
          links: [],
        },
      });
    }

    // Turned off, but a token or data is still around (the cleanup job died or is retrying).
    const off = await ctx.db
      .query("families")
      .withIndex("by_status", (q) => q.eq("status", "off"))
      .take(MAX_FAMILIES);
    for (const family of off) {
      const leftover =
        (await ctx.db.query("gmailTokens").withIndex("by_family", (q) => q.eq("familyId", family._id)).first()) ??
        (await ctx.db.query("verdicts").withIndex("by_family_received", (q) => q.eq("familyId", family._id)).first()) ??
        (await ctx.db.query("relationships").withIndex("by_family_key", (q) => q.eq("familyId", family._id)).first());
      if (leftover) await ctx.scheduler.runAfter(0, internal.turnOff.revokeAndDelete, { familyId: family._id });
    }
    return null;
  },
});
