import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { account, family, feedItem, relationship, verdict } from "./contract";

export default defineSchema({
  ...authTables,

  families: defineTable(family)
    .index("by_kid", ["kidUserId"])
    .index("by_invite", ["inviteToken"])
    .index("by_parent_token", ["parentToken"])
    .index("by_status", ["status"]), // the polling cron lists active families

  // Server-only (holds the parent's personal contacts).
  relationships: defineTable(relationship).index("by_family_key", [
    "familyId",
    "key",
  ]),

  accounts: defineTable(account)
    .index("by_family", ["familyId"])
    .index("by_family_org", ["familyId", "orgName"]), // upsert while building My Accounts

  verdicts: defineTable(verdict)
    .index("by_family_received", ["familyId", "receivedAt"]) // server-side counts only
    .index("by_family_gmail_id", ["familyId", "gmailMessageId"]), // dedupe per mailbox

  feedItems: defineTable(feedItem)
    .index("by_family_created", ["familyId", "createdAt"]) // the kid feed, newest first
    .index("by_verdict", ["verdictId"]), // idempotent retries

  // One row per "Protect my email" attempt. Single use, 10-minute life. Server-only.
  // Only `state` goes to Google; the invite token never does.
  oauthStates: defineTable({
    state: v.string(),
    familyId: v.id("families"),
    codeVerifier: v.string(), // PKCE secret, never leaves the server
    expiresAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_family", ["familyId"]), // at most one live attempt per family

  // A5: emails that failed to check, so one bad email can't block the rest forever.
  pollFailures: defineTable({
    familyId: v.id("families"),
    gmailMessageId: v.string(),
    count: v.number(),
  }).index("by_family_message", ["familyId", "gmailMessageId"]),

  // Gmail OAuth for the parent. Separate from the kid's Convex Auth login.
  // Server-only: internalQuery or internalAction, never a public query.
  gmailTokens: defineTable({
    familyId: v.id("families"),
    googleEmail: v.optional(v.string()), // check it matches family.parentEmail
    scope: v.optional(v.string()), // assert gmail.modify only
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    historyId: v.optional(v.string()), // Gmail history cursor, for fetching only new mail
    pollingUntil: v.optional(v.number()), // A5 lease: one poll per family at a time
    heldLabelId: v.optional(v.string()), // "Anchor: Held"
    checkLabelId: v.optional(v.string()), // "⚠ Check with [kid]"
  })
    .index("by_family", ["familyId"])
    .index("by_google_email", ["googleEmail"]), // one family per mailbox
});
