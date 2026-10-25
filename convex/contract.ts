// THE DATA CONTRACT. Both halves build against this file.
//
// Person A (pipeline) writes these shapes into Convex.
// Person B (screens) reads them, and uses src/shared/mock.ts until real data flows.
//
// Validators are the single source of truth: convex/schema.ts uses them for the
// tables, and the TypeScript types below are derived from them, so the two can't drift.
// Change this file only together, and tell each other when you do.
//
// ACCESS RULES (privacy promises from CLAUDE.md; enforce them in every query):
// - The kid reads only through `feedItems` (then `db.get(verdictId)`) and `accounts`.
//   No public query returns `verdicts` by family, `relationships` or `gmailTokens`.
// - The parent reads through `parentToken`, and sees exactly what the kid sees.
// - `gmailTokens` and `relationships` are server-only: internalQuery or internalAction only.
// - Never store email bodies. `detail` fields name a pattern ("hidden instruction text
//   found"), never quote email text. Bodies may be read at check time, never persisted.
// - Claude-written text (the explanations) is plain text only: no HTML, and no links except
//   the app's own. The writer rejects it if it contains "safe", "secure" or any URL, and falls
//   back to a fixed template for that level. Cap it at 300 characters.

import { v, type Infer } from "convex/values";

// ---------- Shared building blocks ----------

/** Plain-language words only. "safe" is deliberately not an option. */
export const verdictLevel = v.union(
  v.literal("real"), // matches this person's history and passes the checks
  v.literal("unsure"), // a person should look at it: the kid is alerted
  v.literal("fake"), // looks like a scam: held
);

export const accountCategory = v.union(
  v.literal("bank"),
  v.literal("health"),
  v.literal("pharmacy"),
  v.literal("insurance"),
  v.literal("utility"),
  v.literal("government"),
  v.literal("shopping"),
  v.literal("other"),
);

export const checkId = v.union(
  v.literal("header_auth"), // SPF, DKIM and DMARC
  v.literal("claimed_identity"), // the brand it claims vs. the real sending domain
  v.literal("link_audit"), // display text vs. href, lookalikes, domain age, Safe Browsing
  v.literal("relationship"), // inbox history with this sender or organization
  v.literal("pressure"), // urgency, gift cards, wire transfers, secrecy
  v.literal("injection"), // hidden text trying to instruct the AI checker
);

export const checkStatus = v.union(
  v.literal("pass"),
  v.literal("warn"),
  v.literal("fail"),
  v.literal("unknown"), // the check couldn't run, for example a network error
);

// ---------- Family (one parent protected, one kid watching, for v1) ----------

export const familyStatus = v.union(
  v.literal("invited"), // the kid made the link, the parent hasn't tapped it yet
  v.literal("learning"), // Gmail connected, history import in progress
  v.literal("active"),
  v.literal("needs_reconnect"), // Google token revoked or expired: ask the kid to help reconnect
  v.literal("off"), // the parent turned it off: data deleted, Google access revoked
);

export const family = v.object({
  parentName: v.string(), // what the kid calls them in messages, e.g. "Mom"
  parentEmail: v.string(),
  kidName: v.string(), // used in "Not sure, ask Lucas"
  kidUserId: v.id("users"), // Convex Auth user who set it up
  status: familyStatus,
  // Invite link the kid texts to the parent. At least 128 random bits (crypto.getRandomValues).
  // Single use: accepted only while status is "invited" and before expiry, then cleared on
  // connect. Carried through the Google OAuth `state` parameter and checked on the callback.
  inviteToken: v.optional(v.string()),
  inviteExpiresAt: v.optional(v.number()),
  // The parent's long-lived link ("See what Lucas sees / Turn it off"), in the Gmail note footer.
  // Separate from the invite token, with the same randomness rule.
  parentToken: v.string(),
  connectedAt: v.optional(v.number()), // ms since epoch
});

// ---------- Relationship: who the parent deals with (server-only, built from history) ----------

export const relationship = v.object({
  familyId: v.id("families"),
  kind: v.union(
    v.literal("org"), // keyed by domain, e.g. "kp.org"
    v.literal("person"), // keyed by address: friends and family on gmail.com, yahoo.com...
  ),
  key: v.string(), // the domain for "org", the full address for "person"
  orgName: v.optional(v.string()), // resolved organization, e.g. "Kaiser Permanente"
  firstSeen: v.number(),
  lastSeen: v.number(),
  messageCount: v.number(),
  parentSentCount: v.optional(v.number()), // the parent has written to them: a strong trust signal
  authPassRate: v.number(), // 0..1, share of messages passing DMARC
});

// ---------- Account: one row on the "My Accounts" page (no secrets, ever) ----------

/** Kinds of email that show Mom really has and uses an account (A8 ranks by these). */
export const accountSignal = v.union(
  v.literal("sign_in"), // "new sign-in", "new device"
  v.literal("security"), // security alerts, account changes
  v.literal("password"), // password reset or change
  v.literal("code"), // verification / one-time codes
  v.literal("statement"), // statements, documents ready
  v.literal("bill"), // bills, payments due, autopay
  v.literal("order"), // orders, deliveries, prescriptions ready
  v.literal("appointment"), // appointments, visits, test results
);

export const account = v.object({
  familyId: v.id("families"),
  orgName: v.string(), // "Kaiser Permanente"
  category: accountCategory,
  // Every domain this organization really sends from, e.g. ["kp.org", "kaiserpermanente.org"].
  officialDomains: v.array(v.string()),
  // Verified official login page from our curated directory, never a link taken from an email.
  // Its host must be in officialDomains. If the org isn't in the directory, leave it empty and
  // the UI shows no link.
  loginUrl: v.optional(v.string()),
  firstSeen: v.number(), // earliest email in the imported history window
  messageCount: v.number(),
  // ----- v2 (A8): rank by real use, not by email volume. All optional until A8 fills them. -----
  rank: v.optional(v.number()), // higher = more important; screens sort by this, descending
  signals: v.optional(v.array(accountSignal)), // why we think Mom really uses it
  lastActivity: v.optional(v.number()), // newest account-type email (sign-in, statement, bill...)
  loginUrlSource: v.optional(v.union(v.literal("curated"), v.literal("discovered"))),
});

// ---------- Verdict: the result for one email ----------

export const checkResult = v.object({
  id: checkId,
  status: checkStatus,
  plainReason: v.string(), // one short sentence, no jargon: "This email did not come from Chase."
  detail: v.optional(v.string()), // technical detail, e.g. "DMARC=fail". Never quoted email text.
});

export const verdict = v.object({
  familyId: v.id("families"),
  gmailMessageId: v.string(),
  receivedAt: v.number(),
  level: verdictLevel,
  // Deterministic red flags set a floor: Claude may raise the level, never lower it.
  ruleLevel: verdictLevel, // the level from the checks alone
  fromDomain: v.string(), // always kept: the checks and the weekly counts need it
  // Filled in ONLY when level is not "real". Real mail stays private to the parent.
  fromName: v.optional(v.string()), // display name, e.g. "Chase Bank"
  fromAddress: v.optional(v.string()), // e.g. "alerts@chase-secure-login.co"
  subject: v.optional(v.string()),
  claimedOrg: v.optional(v.string()), // the brand the email claims to be, e.g. "Chase"
  checks: v.optional(v.array(checkResult)),
  // Written by Claude from the evidence (see the access rules above). Not set for real mail.
  explanationForParent: v.optional(v.string()), // "We held a message pretending to be Chase..."
  explanationForKid: v.optional(v.string()), // a bit more detail, still plain
  action: v.union(
    v.literal("none"), // real: left alone
    v.literal("labeled_check"), // unsure: "⚠ Check with [kid]" label added
    v.literal("held"), // fake: moved to the "Anchor: Held" label
    v.literal("released"), // held or unsure, then the kid said "It's fine": back in the inbox
  ),
  actionAppliedAt: v.optional(v.number()), // A6: the label/hold was applied in Gmail
  parentNoteSentAt: v.optional(v.number()), // so retries never send the parent note twice
});

// ---------- Investigation (A7): the AI agent's check of one suspicious email ----------
// The kid's screen shows `steps` live as they're appended, then the `conclusion`.
// Plain words only. Steps never quote the email's text.

export const investigationStep = v.object({
  at: v.number(),
  kind: v.union(
    v.literal("search"), // searched the web, e.g. "Looking up Chase's official email addresses"
    v.literal("visit"), // looked at a page or where a link really goes
    v.literal("check"), // a direct check: domain age, Google's danger list, Mom's history
    v.literal("finding"), // something it learned: "This domain was registered 3 days ago"
  ),
  text: v.string(), // one short plain sentence
});

export const linkFinding = v.object({
  site: v.string(), // registrable domain, e.g. "youtube.com"
  verdict: v.union(v.literal("safe"), v.literal("unknown"), v.literal("dangerous")),
  reason: v.string(), // plain sentence
});

export const investigation = v.object({
  familyId: v.id("families"),
  verdictId: v.id("verdicts"),
  status: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  steps: v.array(investigationStep), // capped at 40
  conclusion: v.optional(
    v.object({
      level: verdictLevel, // after the floor rule: never below the deterministic level
      summary: v.string(), // 1-2 plain sentences for the kid
      sender: v.object({
        verdict: v.union(v.literal("genuine"), v.literal("unverified"), v.literal("impostor")),
        reason: v.string(),
      }),
      links: v.array(linkFinding),
      suggestion: v.optional(v.string()), // e.g. "Aunt Sue's account may be hacked. Maybe text her?"
    }),
  ),
  // Official pages it relied on (only these can clear a brand email).
  sources: v.optional(v.array(v.object({ title: v.string(), url: v.string() }))),
});

// ---------- FeedItem: what shows up in the kid's feed ----------

export const kidAnswer = v.object({
  answer: v.union(v.literal("fine"), v.literal("scam")),
  note: v.optional(v.string()), // the kid's own words, sent to the parent: "Good catch, Mom. Love you."
  answeredAt: v.number(),
});

export const feedItem = v.object({
  familyId: v.id("families"),
  verdictId: v.id("verdicts"),
  // "needs_answer": unsure, so the kid's phone buzzes. "held": fake, informational, but the kid
  // may still answer, for example "It's fine" to release a real email that was held by mistake.
  kind: v.union(v.literal("needs_answer"), v.literal("held")),
  createdAt: v.number(),
  notifiedKidAt: v.optional(v.number()), // the phone buzzes once
  kidAnswer: v.optional(kidAnswer), // set once the kid taps "It's fine" or "It's a scam"
  answerAppliedAt: v.optional(v.number()), // Gmail updated (released or held) and the note sent to the parent
});

// ---------- WeeklyRecap: computed live by a query, not stored ----------
// "This week: 41 checked, 2 held, 0 need a call." The week is the last 7 days.

export const weeklyRecap = v.object({
  weekStart: v.number(),
  checked: v.number(), // verdicts received this week
  held: v.number(), // verdicts with action "held"
  needAnswer: v.number(), // needs_answer feed items still unanswered
  goodCatches: v.number(), // feed items the kid answered "scam" this week
});

// ---------- TypeScript types for app code ----------

export type VerdictLevel = Infer<typeof verdictLevel>;
export type AccountCategory = Infer<typeof accountCategory>;
export type CheckId = Infer<typeof checkId>;
export type CheckStatus = Infer<typeof checkStatus>;
export type FamilyStatus = Infer<typeof familyStatus>;
export type Family = Infer<typeof family>;
export type Relationship = Infer<typeof relationship>;
export type Account = Infer<typeof account>;
export type CheckResult = Infer<typeof checkResult>;
export type Verdict = Infer<typeof verdict>;
export type KidAnswer = Infer<typeof kidAnswer>;
export type FeedItem = Infer<typeof feedItem>;
export type WeeklyRecap = Infer<typeof weeklyRecap>;
export type AccountSignal = Infer<typeof accountSignal>;
export type InvestigationStep = Infer<typeof investigationStep>;
export type LinkFinding = Infer<typeof linkFinding>;
export type Investigation = Infer<typeof investigation>;
