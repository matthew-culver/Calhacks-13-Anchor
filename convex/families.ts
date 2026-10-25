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

// Letters (any language), spaces, apostrophes, periods and hyphens. Names appear in the note
// Anchor puts in the parent's inbox, in Gmail labels and in Claude prompts, so no digits, links
// or symbols: a stranger posing as a kid must not be able to put "Call 1-800..." there.
const NAME_CHARS = /^[\p{L}\p{M} '\u2019.-]+$/u;

/** "mom" → "Mom": names are shown in greetings ("Hi Mom."), so the first letter is a capital. */
export const capitalized = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

function cleanName(raw: string, label: string): string {
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > MAX_NAME) {
    throw new ConvexError(`${label} name must be 1 to ${MAX_NAME} characters.`);
  }
  if (!NAME_CHARS.test(name) || /\p{L}{2,}\.\p{L}{2,}/u.test(name)) {
    throw new ConvexError(`${label} name can only use letters, spaces, apostrophes, periods and hyphens.`);
  }
  return capitalized(name);
}

/** Real tokens are 43 characters; anything much longer is junk and isn't looked up. */
export const MAX_TOKEN = 64;

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
    const existing = await familyOf(ctx, kidUserId);
    if (existing !== null && existing.status !== "off") {
      throw new ConvexError("You've already set up protection for someone.");
    }
    // After the parent turned protection off, the kid can start over with a fresh family, but
    // only once turn-off has finished cleaning up (data deleted, Google access revoked).
    // Deleting the row earlier would orphan that cleanup and leave the token behind.
    if (existing !== null) {
      const leftover =
        (await ctx.db.query("gmailTokens").withIndex("by_family", (q) => q.eq("familyId", existing._id)).first()) ??
        (await ctx.db.query("verdicts").withIndex("by_family_received", (q) => q.eq("familyId", existing._id)).first()) ??
        (await ctx.db.query("relationships").withIndex("by_family_key", (q) => q.eq("familyId", existing._id)).first()) ??
        (await ctx.db.query("feedItems").withIndex("by_family_created", (q) => q.eq("familyId", existing._id)).first());
      if (leftover) throw new ConvexError("We're still switching things off. Please try again in a few minutes.");
      await ctx.db.delete(existing._id);
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
  // When Anchor last finished checking the parent's new mail ("checked 1 minute ago").
  lastCheckedAt: v.optional(v.number()),
});

/** When Anchor last finished checking this family's new mail. Just the time, nothing else. */
async function lastCheckedAt(ctx: QueryCtx, familyId: Id<"families">): Promise<number | undefined> {
  const tokens = await ctx.db
    .query("gmailTokens")
    .withIndex("by_family", (q) => q.eq("familyId", familyId))
    .unique();
  return tokens?.checkedAt;
}

/** The signed-in kid's family, or null. Never includes the parent token. */
export const getMyFamily = query({
  args: {},
  returns: v.union(v.null(), myFamily),
  handler: async (ctx) => {
    const kidUserId = await getAuthUserId(ctx);
    if (kidUserId === null) return null;
    const family = await familyOf(ctx, kidUserId);
    if (family === null) return null;
    const checked = await lastCheckedAt(ctx, family._id);
    return { ...toMyFamily(family), ...(checked !== undefined && { lastCheckedAt: checked }) };
  },
});

// Annotated so clients see the invite fields: without it, TypeScript folds the two return
// shapes into the one without them.
function toMyFamily(family: Doc<"families">): Infer<typeof myFamily> {
  const base = {
    _id: family._id,
    parentName: capitalized(family.parentName),
    parentEmail: family.parentEmail,
    kidName: capitalized(family.kidName),
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
    if (token.length === 0 || token.length > MAX_TOKEN) return null;
    const family = await ctx.db
      .query("families")
      .withIndex("by_invite", (q) => q.eq("inviteToken", token))
      .unique();
    if (family === null || !acceptsInvite(family.status) || family.inviteExpiresAt === undefined) {
      return null;
    }
    const kid = await ctx.db.get(family.kidUserId);
    return {
      parentName: capitalized(family.parentName),
      kidName: capitalized(family.kidName),
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
          ? `${capitalized(family.parentName)} turned protection off.`
          : `${capitalized(family.parentName)} is already connected.`,
      );
    }
    const inviteToken = randomToken();
    await ctx.db.patch(family._id, { inviteToken, inviteExpiresAt: Date.now() + INVITE_TTL_MS });
    return { inviteToken };
  },
});

/**
 * The parent's own page (/p/<parentToken>): who's watching and where things stand, so the page
 * can tell "still learning" from "turned off". Null for an unknown link. Never returns tokens.
 */
export const getParentView = query({
  args: { parentToken: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      parentName: v.string(),
      kidName: v.string(),
      status: familyStatus,
      lastCheckedAt: v.optional(v.number()),
      canAsk: v.optional(v.boolean()), // the "⚠ Check with [kid]" label exists in their Gmail
    }),
  ),
  handler: async (ctx, { parentToken }) => {
    if (parentToken.length === 0 || parentToken.length > MAX_TOKEN) return null;
    const family = await ctx.db
      .query("families")
      .withIndex("by_parent_token", (q) => q.eq("parentToken", parentToken))
      .unique();
    if (family === null) return null;
    const tokens = await ctx.db
      .query("gmailTokens")
      .withIndex("by_family", (q) => q.eq("familyId", family._id))
      .unique();
    return {
      parentName: capitalized(family.parentName),
      kidName: capitalized(family.kidName),
      status: family.status,
      ...(tokens?.checkedAt !== undefined && { lastCheckedAt: tokens.checkedAt }),
      canAsk: tokens?.checkLabelId !== undefined,
    };
  },
});
