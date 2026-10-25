// Gmail access tokens for server-side work (A4 import, A5 polling, A6 labels).
// Everything here is internal: tokens never reach a client.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalMutation, internalQuery } from "./_generated/server";
import { readGoogleConfig } from "./lib/env";
import { refreshAccessToken } from "./lib/oauth";

/** Refresh this long before Google's expiry, so a token never dies mid-import. */
const EARLY_MS = 60_000;

export const getTokens = internalQuery({
  args: { familyId: v.id("families") },
  returns: v.union(
    v.null(),
    v.object({
      refreshToken: v.string(),
      accessToken: v.optional(v.string()),
      expiresAt: v.optional(v.number()),
      googleEmail: v.optional(v.string()),
      historyId: v.optional(v.string()),
      status: v.string(),
    }),
  ),
  handler: async (ctx, { familyId }) => {
    const family = await ctx.db.get(familyId);
    if (family === null) return null;
    const row = await ctx.db
      .query("gmailTokens")
      .withIndex("by_family", (q) => q.eq("familyId", familyId))
      .unique();
    if (row === null) return null;
    return {
      refreshToken: row.refreshToken,
      accessToken: row.accessToken,
      expiresAt: row.expiresAt,
      googleEmail: row.googleEmail,
      historyId: row.historyId,
      status: family.status,
    };
  },
});

export const saveAccessToken = internalMutation({
  args: { familyId: v.id("families"), accessToken: v.string(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { familyId, accessToken, expiresAt }) => {
    const row = await ctx.db
      .query("gmailTokens")
      .withIndex("by_family", (q) => q.eq("familyId", familyId))
      .unique();
    if (row !== null) await ctx.db.patch(row._id, { accessToken, expiresAt });
    return null;
  },
});

/** Google access is gone: the kid's screen offers a new link (renewInvite allows this status). */
export const markNeedsReconnect = internalMutation({
  args: { familyId: v.id("families") },
  returns: v.null(),
  handler: async (ctx, { familyId }) => {
    const family = await ctx.db.get(familyId);
    if (family && (family.status === "learning" || family.status === "active")) {
      await ctx.db.patch(familyId, { status: "needs_reconnect" });
    }
    return null;
  },
});

export type AccessResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "not_connected" | "reconnect" | "unavailable" };

/**
 * A working access token for this family, refreshing it if needed. For actions only.
 * `force` refreshes even if the stored one looks valid (after Gmail answered 401).
 */
export async function accessTokenFor(
  ctx: ActionCtx,
  familyId: Id<"families">,
  opts: { force?: boolean } = {},
): Promise<AccessResult> {
  const tokens = await ctx.runQuery(internal.googleAuth.getTokens, { familyId });
  if (tokens === null || tokens.status === "off") return { ok: false, reason: "not_connected" };
  if (!opts.force && tokens.accessToken && tokens.expiresAt && tokens.expiresAt - EARLY_MS > Date.now()) {
    return { ok: true, accessToken: tokens.accessToken };
  }
  const cfg = readGoogleConfig();
  if (cfg === null) {
    console.error("Gmail token refresh is missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or SITE_URL");
    return { ok: false, reason: "unavailable" };
  }
  const refreshed = await refreshAccessToken(cfg, tokens.refreshToken);
  if (!refreshed.ok) {
    if (refreshed.reconnect) {
      await ctx.runMutation(internal.googleAuth.markNeedsReconnect, { familyId });
      return { ok: false, reason: "reconnect" };
    }
    return { ok: false, reason: "unavailable" };
  }
  await ctx.runMutation(internal.googleAuth.saveAccessToken, {
    familyId,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  });
  return { ok: true, accessToken: refreshed.accessToken };
}
