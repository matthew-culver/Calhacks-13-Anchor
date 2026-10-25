// Families: the kid sets one up, then texts the invite link to their parent.
// Access rules (see convex/contract.ts): the kid is always taken from the login, never
// from arguments; the parent token is never returned to anyone here; getInvite reveals
// only names and status to whoever holds the link.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { familyStatus } from "./contract";
import { randomToken } from "./lib/tokens";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NAME = 40;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireKid(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError("Please sign in first.");
  return userId;
}

function familyOf(ctx: QueryCtx | MutationCtx, kidUserId: Id<"users">) {
  return ctx.db
    .query("families")
    .withIndex("by_kid", (q) => q.eq("kidUserId", kidUserId))
    .unique();
}

/** Invite links work only before the first connection, or when Google access must be redone. */
export function acceptsInvite(status: Doc<"families">["status"]): boolean {
  return status === "invited" || status === "needs_reconnect";
}

function cleanName(raw: string, label: string): string {
  // Names later appear in Gmail labels, the parent note and Claude prompts: one plain line only.
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > MAX_NAME) {
    throw new ConvexError(`${label} name must be 1 to ${MAX_NAME} characters.`);
  }
  return name;
}

function cleanEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) {
    throw new ConvexError("That doesn't look like an email address.");
  }
  return email;
}

/** The kid creates their family. Returns the invite token for the share screen. */
export const createFamily = mutation({
  args: { parentName: v.string(), parentEmail: v.string(), kidName: v.string() },
  returns: v.object({ familyId: v.id("families"), inviteToken: v.string() }),
  handler: async (ctx, args) => {
    const kidUserId = await requireKid(ctx);
    // No unique constraint is needed: mutations are serializable, so two concurrent calls
    // can't both see an empty by_kid range.
    if ((await familyOf(ctx, kidUserId)) !== null) {
      throw new ConvexError("You've already set up protection for someone.");
    }
    const inviteToken = randomToken();
    const familyId = await ctx.db.insert("families", {
      parentName: cleanName(args.parentName, "Parent"),
      parentEmail: cleanEmail(args.parentEmail),
      kidName: cleanName(args.kidName, "Your"),
      kidUserId,
      status: "invited",
      inviteToken,
      inviteExpiresAt: Date.now() + INVITE_TTL_MS,
      parentToken: randomToken(),
    });
    return { familyId, inviteToken };
  },
});

const myFamily = v.object({
  _id: v.id("families"),
  parentName: v.string(),
  parentEmail: v.string(),
  kidName: v.string(),
  status: familyStatus,
  connectedAt: v.optional(v.number()),
  // Only while waiting for the parent to tap the link (status "invited" or "needs_reconnect").
  inviteToken: v.optional(v.string()),
  inviteExpiresAt: v.optional(v.number()),
});

/** The signed-in kid's family, or null. Never includes the parent token. */
export const getMyFamily = query({
  args: {},
  returns: v.union(v.null(), myFamily),
  handler: async (ctx) => {
    const kidUserId = await getAuthUserId(ctx);
    if (kidUserId === null) return null;
    const family = await familyOf(ctx, kidUserId);
    if (family === null) return null;
    return toMyFamily(family);
  },
});

// Annotated so clients see the invite fields: without it, TypeScript folds the two return
// shapes into the one without them.
function toMyFamily(family: Doc<"families">): Infer<typeof myFamily> {
  const base = {
    _id: family._id,
    parentName: family.parentName,
    parentEmail: family.parentEmail,
    kidName: family.kidName,
    status: family.status,
    ...(family.connectedAt !== undefined && { connectedAt: family.connectedAt }),
  };
  if (!acceptsInvite(family.status) || family.inviteToken === undefined) return base;
  return { ...base, inviteToken: family.inviteToken, inviteExpiresAt: family.inviteExpiresAt };
}

/**
 * What the parent's invite page shows. Public: anyone holding the link sees the names,
 * status, expiry, and the kid's sign-in email. The email is a deliberate disclosure so the
 * parent can see exactly who is asking ("Only continue if Lucas asked you"), because anyone
 * can sign up and claim to be someone's kid. The page compares `inviteExpiresAt` with its own clock for display;
 * A3 re-checks expiry with the server's clock before connecting. Null means the link is
 * unknown or already used: show "This link was used or expired, ask [kid] for a new one".
 */
export const getInvite = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      parentName: v.string(),
      kidName: v.string(),
      kidEmail: v.union(v.string(), v.null()),
      status: familyStatus,
      inviteExpiresAt: v.number(),
    }),
  ),
  handler: async (ctx, { token }) => {
    if (token.length === 0) return null;
    const family = await ctx.db
      .query("families")
      .withIndex("by_invite", (q) => q.eq("inviteToken", token))
      .unique();
    if (family === null || !acceptsInvite(family.status) || family.inviteExpiresAt === undefined) {
      return null;
    }
    const kid = await ctx.db.get(family.kidUserId);
    return {
      parentName: family.parentName,
      kidName: family.kidName,
      kidEmail: kid?.email ?? null,
      status: family.status,
      inviteExpiresAt: family.inviteExpiresAt,
    };
  },
});

/**
 * A fresh invite link, for when the old one expired or was lost, or when Google access broke
 * and the parent must reconnect. The old link stops working.
 */
export const renewInvite = mutation({
  args: {},
  returns: v.object({ inviteToken: v.string() }),
  handler: async (ctx) => {
    const kidUserId = await requireKid(ctx);
    const family = await familyOf(ctx, kidUserId);
    if (family === null) throw new ConvexError("You have no family set up yet.");
    if (!acceptsInvite(family.status)) {
      throw new ConvexError(
        family.status === "off"
          ? `${family.parentName} turned protection off.`
          : `${family.parentName} is already connected.`,
      );
    }
    const inviteToken = randomToken();
    await ctx.db.patch(family._id, { inviteToken, inviteExpiresAt: Date.now() + INVITE_TTL_MS });
    return { inviteToken };
  },
});
