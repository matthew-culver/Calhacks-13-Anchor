// A5: every minute, check each active family's Gmail for new mail and turn each new email
// into a verdict. The body is read in memory to run the checks and never stored.
//
// Flow per email: Gmail raw → parseEml (A1) → link intel (domain age, Safe Browsing) →
// A1's five checks + the relationship check (A4 history) → rule level (the floor) →
// Claude explains flagged mail (can raise, never lower) → verdict + kid feed item.
// Moving or labeling mail in Gmail and the parent note are A6.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { BRANDS } from "./checks/brands";
import { speaksAsCompany } from "./checks/claimedIdentity";
import { gatherLinkIntel, parseEml, ruleLevel, runChecks } from "./checks/index";
import { type HistoryContext, relationship } from "./checks/relationship";
import { checkResult, verdictLevel } from "./contract";
import { accessTokenFor } from "./googleAuth";
import { actionsEnabled } from "./gmailActions";
import { atLeast, explain, templateExplanation } from "./lib/explain";
import { contactName, displayName, isAutomatedMailbox, keyFor, looksLikeAddress, MAX_CONTACTS, mailboxId } from "./lib/history";
import { pressureSignals, SCAM_SIGNALS } from "./checks/pressure";
import { cleanUrl, probeLink } from "./lib/linkProbe";
import { classifySite, linkIsRisky, linkTarget } from "./lib/sites";
import { GOOGLE_TIMEOUT_MS } from "./lib/oauth";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
/** Per poll. More than this waits for the next minute, so one burst can't stall a run. */
const MAX_PER_POLL = 20;
const MAX_FAMILIES = 200;
/** Bigger emails aren't downloaded (attachments could exhaust the action's memory). */
const MAX_RAW_BYTES = 5 * 1024 * 1024;
/** Claude explanations per family per hour; beyond that the fixed template is used. */
const CLAUDE_PER_HOUR = 30;
/** After this many failed tries an email becomes "unsure: we couldn't check it". */
const MAX_FAILURES = 3;
/** Stop starting new emails after this long, well inside the action time limit. */
const TIME_BUDGET_MS = 4 * 60 * 1000;
/** One poll per family at a time. Long enough to cover a run, short enough to recover a crash. */
const LEASE_MS = 5 * 60 * 1000;
/** After a too-old cursor (e.g. a week offline), re-check this much recent inbox mail. */
const CATCH_UP_QUERY = "in:inbox newer_than:2d";
const CATCH_UP_MAX = 50;

class GmailError extends Error {
  constructor(readonly status: number) {
    super(`Gmail API ${status}`);
  }
}

async function gmail<T>(accessToken: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GMAIL}${path}`);
  for (const [k, value] of Object.entries(params)) url.searchParams.set(k, value);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  if (res.ok) return (await res.json()) as T;
  // Gmail signals "slow down" as 403 with a rateLimit reason: treat it like 429 (try later),
  // never as a broken email.
  if (res.status === 403 && /rateLimit/i.test(await res.text())) throw new GmailError(429);
  throw new GmailError(res.status);
}

function decodeRaw(raw: string): Uint8Array {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const newer = (a: string, b: string | undefined) => b === undefined || BigInt(a) > BigInt(b);

// ---------- scheduling ----------

/** Cron entry point: fan out one poll per active family. */
export const pollAll = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const families = await ctx.db
      .query("families")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(MAX_FAMILIES);
    for (const f of families) await ctx.scheduler.runAfter(0, internal.mailWatch.pollFamily, { familyId: f._id });
    return null;
  },
});

// ---------- database helpers ----------

export const familyForPoll = internalQuery({
  args: { familyId: v.id("families") },
  returns: v.union(
    v.null(),
    v.object({
      status: v.string(),
      parentName: v.string(),
      kidName: v.string(),
      historyId: v.optional(v.string()),
      googleEmail: v.optional(v.string()),
      noteLabelId: v.optional(v.string()),
      checkLabelId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { familyId }) => {
    const family = await ctx.db.get(familyId);
    if (!family) return null;
    const tokens = await ctx.db
      .query("gmailTokens")
      .withIndex("by_family", (q) => q.eq("familyId", familyId))
      .unique();
    return {
      status: family.status,
      parentName: family.parentName,
      kidName: family.kidName,
      historyId: tokens?.historyId,
      googleEmail: tokens?.googleEmail,
      noteLabelId: tokens?.noteLabelId,
      checkLabelId: tokens?.checkLabelId,
    };
  },
});

export const alreadySeen = internalQuery({
  args: { familyId: v.id("families"), gmailMessageId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { familyId, gmailMessageId }) => {
    const row = await ctx.db
      .query("verdicts")
      .withIndex("by_family_gmail_id", (q) => q.eq("familyId", familyId).eq("gmailMessageId", gmailMessageId))
      .first();
    if (row !== null) return true;
    // Anchor's own notes to the parent are never checked. Known by the id Gmail gave us when we
    // inserted them (a sender can't forge that), not by any header a scammer could copy.
    const note = await ctx.db
      .query("anchorNotes")
      .withIndex("by_family_message", (q) => q.eq("familyId", familyId).eq("gmailMessageId", gmailMessageId))
      .first();
    return note !== null;
  },
});

/** What the relationship check needs, looked up from A4's tables. */
export const historyFor = internalQuery({
  args: {
    familyId: v.id("families"),
    senderKey: v.string(),
    senderAddress: v.string(),
    senderName: v.optional(v.string()), // folded display name (contactName)
    claimedOrg: v.optional(v.string()),
  },
  returns: v.object({
    sender: v.optional(
      v.object({ messageCount: v.number(), parentSentCount: v.optional(v.number()), firstSeen: v.number(), authPassRate: v.number() }),
    ),
    claimedBrandHistory: v.optional(v.object({ messageCount: v.number(), firstSeen: v.number(), isAccount: v.boolean() })),
    trusted: v.optional(v.object({ who: v.string() })),
    knownNameElsewhere: v.optional(v.object({ who: v.string(), lookalike: v.boolean() })),
  }),
  handler: async (ctx, { familyId, senderKey, senderAddress, senderName, claimedOrg }) => {
    const rel = await ctx.db
      .query("relationships")
      .withIndex("by_family_key", (q) => q.eq("familyId", familyId).eq("key", senderKey))
      .first();
    const result: HistoryContext = {};
    // Family: the kid's own sign-in address, or a sender the kid marked "always trust".
    const family = await ctx.db.get(familyId);
    const address = senderAddress.toLowerCase();
    if (family && address.includes("@")) {
      const kid = await ctx.db.get(family.kidUserId);
      if (kid?.email && kid.email.toLowerCase() === address) {
        result.trusted = { who: family.kidName };
      } else {
        const marked = await ctx.db
          .query("trustedSenders")
          .withIndex("by_family_address", (q) => q.eq("familyId", familyId).eq("address", address))
          .first();
        if (marked) result.trusted = { who: "someone you trust" };
      }
    }
    if (rel) {
      result.sender = {
        messageCount: rel.messageCount,
        ...(rel.parentSentCount !== undefined && { parentSentCount: rel.parentSentCount }),
        firstSeen: rel.firstSeen,
        authPassRate: rel.authPassRate,
      };
    }
    // A stranger using the name of someone Mom corresponds with (never for family or familiar senders).
    const familiar = rel !== null && (rel.messageCount >= 2 || (rel.parentSentCount ?? 0) > 0);
    if (senderName && !result.trusted && !familiar && address.includes("@")) {
      const sameName = await ctx.db
        .query("contactNames")
        .withIndex("by_family_name", (q) => q.eq("familyId", familyId).eq("name", senderName))
        .take(10);
      const others = sameName.filter((c) => mailboxId(c.address) !== mailboxId(address));
      if (others.length > 0) {
        const lookalike = others.find((c) => looksLikeAddress(address, c.address));
        result.knownNameElsewhere = { who: (lookalike ?? others[0]).display, lookalike: lookalike !== undefined };
      }
    }
    const brand = claimedOrg ? BRANDS.find((b) => b.name === claimedOrg) : undefined;
    if (brand) {
      let messageCount = 0;
      let firstSeen = Number.POSITIVE_INFINITY;
      for (const domain of brand.officialDomains) {
        const r = await ctx.db
          .query("relationships")
          .withIndex("by_family_key", (q) => q.eq("familyId", familyId).eq("key", domain))
          .first();
        // Only mail that mostly authenticated counts as real history with the brand.
        if (r && r.authPassRate >= 0.5 && r.messageCount > 0) {
          messageCount += Math.round(r.messageCount * r.authPassRate);
          firstSeen = Math.min(firstSeen, r.firstSeen);
        }
      }
      const accounts = await ctx.db
        .query("accounts")
        .withIndex("by_family", (q) => q.eq("familyId", familyId))
        .take(100);
      const isAccount = accounts.some((a) => a.officialDomains.some((d) => brand.officialDomains.includes(d)));
      if (messageCount > 0) result.claimedBrandHistory = { messageCount, firstSeen, isAccount };
    }
    return result;
  },
});

/** Take the family's poll lease. False if another poll is running. */
export const claimPoll = internalMutation({
  args: { familyId: v.id("families") },
  returns: v.boolean(),
  handler: async (ctx, { familyId }) => {
    const tokens = await ctx.db
      .query("gmailTokens")
      .withIndex("by_family", (q) => q.eq("familyId", familyId))
      .unique();
    if (!tokens) return false;
    if (tokens.pollingUntil !== undefined && tokens.pollingUntil > Date.now()) return false;
    await ctx.db.patch(tokens._id, { pollingUntil: Date.now() + LEASE_MS });
    return true;
  },
});

export const releasePoll = internalMutation({
  args: { familyId: v.id("families"), checkedAt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { familyId, checkedAt }) => {
    const tokens = await ctx.db
      .query("gmailTokens")
      .withIndex("by_family", (q) => q.eq("familyId", familyId))
      .unique();
    if (tokens) await ctx.db.patch(tokens._id, { pollingUntil: undefined, ...(checkedAt !== undefined && { checkedAt }) });
    return null;
  },
});

/** Count one failed try. Returns the new count. */
export const recordFailure = internalMutation({
  args: { familyId: v.id("families"), gmailMessageId: v.string() },
  returns: v.number(),
  handler: async (ctx, { familyId, gmailMessageId }) => {
    const family = await ctx.db.get(familyId);
    if (!family || family.status === "off") return MAX_FAILURES; // turned off: stop retrying, write nothing
    const row = await ctx.db
      .query("pollFailures")
      .withIndex("by_family_message", (q) => q.eq("familyId", familyId).eq("gmailMessageId", gmailMessageId))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, { count: row.count + 1 });
      return row.count + 1;
    }
    await ctx.db.insert("pollFailures", { familyId, gmailMessageId, count: 1 });
    return 1;
  },
});

/** Flagged emails in the last hour, to cap Claude calls when someone floods the inbox. */
export const recentFlagged = internalQuery({
  args: { familyId: v.id("families"), since: v.number() },
  returns: v.number(),
  handler: async (ctx, { familyId, since }) => {
    const items = await ctx.db
      .query("feedItems")
      .withIndex("by_family_created", (q) => q.eq("familyId", familyId).gte("createdAt", since))
      .take(CLAUDE_PER_HOUR + 1);
    return items.length;
  },
});

/** Remember the name a known contact goes by (see checkOne). Once per name and address. */
export const learnName = internalMutation({
  args: { familyId: v.id("families"), name: v.string(), display: v.string(), address: v.string() },
  returns: v.null(),
  handler: async (ctx, { familyId, name, display, address }) => {
    const family = await ctx.db.get(familyId);
    if (!family || family.status === "off") return null; // turned off meanwhile: write nothing
    const same = await ctx.db
      .query("contactNames")
      .withIndex("by_family_name", (q) => q.eq("familyId", familyId).eq("name", name))
      .take(20);
    if (same.some((c) => mailboxId(c.address) === mailboxId(address)) || same.length >= 20) return null;
    const total = await ctx.db
      .query("contactNames")
      .withIndex("by_family_name", (q) => q.eq("familyId", familyId))
      .take(MAX_CONTACTS);
    if (total.length >= MAX_CONTACTS) return null;
    await ctx.db.insert("contactNames", { familyId, name, display, address });
    return null;
  },
});

export const saveHistoryId = internalMutation({
  args: { familyId: v.id("families"), historyId: v.string() },
  returns: v.null(),
  handler: async (ctx, { familyId, historyId }) => {
    const tokens = await ctx.db
      .query("gmailTokens")
      .withIndex("by_family", (q) => q.eq("familyId", familyId))
      .unique();
    // Overlapping polls: only ever move the cursor forward.
    if (tokens && newer(historyId, tokens.historyId)) await ctx.db.patch(tokens._id, { historyId });
    return null;
  },
});

/** Store one verdict (once per Gmail message) and, if flagged, a kid feed item. */
export const saveVerdict = internalMutation({
  args: {
    familyId: v.id("families"),
    gmailMessageId: v.string(),
    receivedAt: v.number(),
    level: verdictLevel,
    ruleLevel: verdictLevel,
    fromDomain: v.string(),
    fromName: v.string(),
    fromAddress: v.string(),
    subject: v.string(),
    claimedOrg: v.optional(v.string()),
    checks: v.array(checkResult),
    explanationForParent: v.string(),
    explanationForKid: v.string(),
    asked: v.optional(v.boolean()), // the parent put it in "Check with [kid]" herself
  },
  returns: v.union(v.null(), v.id("verdicts")),
  handler: async (ctx, a) => {
    const family = await ctx.db.get(a.familyId);
    if (!family || family.status === "off") return null;
    // Defense in depth: whatever the caller says, the stored level never drops below the rules.
    a.level = atLeast(a.ruleLevel, a.level);
    a.fromDomain = /^[a-z0-9.-]{1,253}$/i.test(a.fromDomain) ? a.fromDomain.toLowerCase() : "unknown";
    const dupe = await ctx.db
      .query("verdicts")
      .withIndex("by_family_gmail_id", (q) => q.eq("familyId", a.familyId).eq("gmailMessageId", a.gmailMessageId))
      .first();
    if (dupe) {
      // Mom asked about mail we had already found real: now (and only now, because she asked)
      // the kid sees who sent it and what we checked.
      if (!a.asked || dupe.askedAt !== undefined || dupe.action !== "none") return null;
      const level = atLeast(dupe.level, a.level);
      await ctx.db.patch(dupe._id, {
        level,
        fromName: Array.from(a.fromName).slice(0, 120).join(""),
        fromAddress: Array.from(a.fromAddress).slice(0, 254).join(""),
        subject: Array.from(a.subject).slice(0, 200).join(""),
        ...(a.claimedOrg !== undefined && { claimedOrg: a.claimedOrg }),
        checks: a.checks,
        explanationForParent: a.explanationForParent,
        explanationForKid: a.explanationForKid,
        askedAt: Date.now(),
        ...(level === "fake" && { action: "held" as const }),
      });
      await ctx.db.insert("feedItems", { familyId: a.familyId, verdictId: dupe._id, kind: "asked", createdAt: Date.now() });
      if (level === "fake") await ctx.scheduler.runAfter(0, internal.gmailActions.applyVerdict, { verdictId: dupe._id });
      return dupe._id;
    }

    if (a.level === "real" && !a.asked) {
      // Real mail stays private to the parent: keep only what the checks and counts need.
      await ctx.db.insert("verdicts", {
        familyId: a.familyId,
        gmailMessageId: a.gmailMessageId,
        receivedAt: a.receivedAt,
        level: "real",
        ruleLevel: a.ruleLevel,
        fromDomain: a.fromDomain,
        action: "none",
      });
      return null;
    }
    const verdictId = await ctx.db.insert("verdicts", {
      familyId: a.familyId,
      gmailMessageId: a.gmailMessageId,
      receivedAt: a.receivedAt,
      level: a.level,
      ruleLevel: a.ruleLevel,
      fromDomain: a.fromDomain,
      fromName: Array.from(a.fromName).slice(0, 120).join(""),
      fromAddress: Array.from(a.fromAddress).slice(0, 254).join(""),
      subject: Array.from(a.subject).slice(0, 200).join(""),
      ...(a.claimedOrg !== undefined && { claimedOrg: a.claimedOrg }),
      checks: a.checks,
      explanationForParent: a.explanationForParent,
      explanationForKid: a.explanationForKid,
      // A6 carries this out in Gmail. Mom's own "Check with" label is already on an asked email.
      action: a.level === "fake" ? "held" : a.asked ? "none" : "labeled_check",
      ...(a.asked && { askedAt: Date.now() }),
    });
    await ctx.db.insert("feedItems", {
      familyId: a.familyId,
      verdictId,
      kind: a.asked ? "asked" : a.level === "fake" ? "held" : "needs_answer",
      createdAt: Date.now(),
    });
    // Remember that this "Check with" label is Anchor's own, whatever happens to the verdict.
    if (a.level === "unsure" && !a.asked) {
      await ctx.db.insert("anchorLedger", { familyId: a.familyId, kind: "labeled", gmailId: a.gmailMessageId });
    }
    // A6: label or hold it in Gmail and tell the parent (no-op unless ANCHOR_GMAIL_ACTIONS is on).
    if (a.level !== "real" && !(a.asked && a.level === "unsure")) {
      await ctx.scheduler.runAfter(0, internal.gmailActions.applyVerdict, { verdictId });
    }
    return verdictId;
  },
});

// ---------- the poll ----------

type HistoryPage = {
  history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[];
  historyId?: string;
  nextPageToken?: string;
};

async function newMessageIds(
  accessToken: string,
  startHistoryId: string,
  noteLabelId?: string,
): Promise<{ ids: string[]; historyId?: string }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let historyId: string | undefined;
  do {
    const page = await gmail<HistoryPage>(accessToken, "/history", {
      startHistoryId,
      historyTypes: "messageAdded",
      labelId: "INBOX",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const h of page.history ?? []) {
      for (const added of h.messagesAdded ?? []) {
        const labels = added.message.labelIds ?? [];
        if (labels.includes("SENT") || labels.includes("DRAFT") || labels.includes("SPAM")) continue;
        if (noteLabelId && labels.includes(noteLabelId)) continue; // Anchor's own note to the parent
        ids.push(added.message.id);
      }
    }
    historyId = page.historyId ?? historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { ids: [...new Set(ids)], historyId };
}

type FamilyInfo = { parentName: string; kidName: string };

const header = (headers: { name: string; value: string }[] | undefined, name: string) =>
  headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/**
 * Save an "unsure" verdict for an email we couldn't check (too big, or failed repeatedly).
 * Fail closed: the kid is asked rather than the email silently passing.
 */
async function saveUnchecked(
  ctx: ActionCtx,
  familyId: Id<"families">,
  family: FamilyInfo,
  accessToken: string,
  id: string,
  why: string,
  opts: { asked?: boolean } = {},
) {
  let meta: { internalDate?: string; payload?: { headers?: { name: string; value: string }[] } } = {};
  try {
    meta = await gmail(accessToken, `/messages/${encodeURIComponent(id)}`, { format: "metadata", metadataHeaders: "From" });
  } catch {
    // Even the headers are unreadable: save what we can.
  }
  const from = header(meta.payload?.headers, "From");
  const address = /<([^<>@\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? /[^\s<>"]+@[^\s<>"]+/.exec(from)?.[0] ?? "";
  const checks = [{ id: "header_auth" as const, status: "unknown" as const, plainReason: "We couldn't check this email.", detail: why }];
  const t = templateExplanation({ ruleLevel: "unsure", checks, fromDomain: "", parentName: family.parentName, kidName: family.kidName }, "unsure");
  await ctx.runMutation(internal.mailWatch.saveVerdict, {
    familyId,
    gmailMessageId: id,
    receivedAt: Number(meta.internalDate ?? Date.now()),
    level: "unsure",
    ruleLevel: "unsure",
    fromDomain: address.split("@")[1] ?? "unknown",
    fromName: from.replace(/<[^>]*>/, "").replace(/"/g, "").trim(),
    fromAddress: address.toLowerCase(),
    subject: "",
    checks,
    explanationForParent: t.explanationForParent,
    explanationForKid: opts.asked
      ? `${family.parentName} asked you about this email. We couldn't check it (${why}), so please take a look.`
      : `We couldn't check this one (${why}), so please take a look.`,
    ...(opts.asked && { asked: true }),
  });
}

async function checkOne(
  ctx: ActionCtx,
  familyId: Id<"families">,
  family: FamilyInfo,
  accessToken: string,
  id: string,
  opts: { asked?: boolean } = {},
) {
  // Size first: never download a huge email into memory.
  const head = await gmail<{ sizeEstimate?: number; labelIds?: string[] }>(accessToken, `/messages/${encodeURIComponent(id)}`, {
    format: "minimal",
    fields: "sizeEstimate,labelIds",
  });
  if ((head.labelIds ?? []).includes("SENT")) return;
  if ((head.sizeEstimate ?? 0) > MAX_RAW_BYTES) {
    await saveUnchecked(ctx, familyId, family, accessToken, id, "too big to check", opts);
    return;
  }
  const msg = await gmail<{ raw?: string; internalDate?: string }>(accessToken, `/messages/${encodeURIComponent(id)}`, { format: "raw" });
  if (!msg.raw) return;

  const email = await parseEml(decodeRaw(msg.raw)); // in memory only, never stored
  const intel = await gatherLinkIntel(email);
  const base = runChecks(email, { intel });
  const claimStatus = base.checks.find((c) => c.id === "claimed_identity")?.status ?? "pass";
  const senderKey = email.fromAddress.includes("@")
    ? keyFor({ address: email.fromAddress, domain: email.fromDomain }).key
    : email.fromDomain || "unknown";
  const senderName = contactName(email.fromName);
  const history = await ctx.runQuery(internal.mailWatch.historyFor, {
    familyId,
    senderKey,
    senderAddress: email.fromAddress,
    ...(senderName !== null && { senderName }),
    ...(base.claimedOrg !== undefined && { claimedOrg: base.claimedOrg }),
  });
  const familiar =
    history.trusted !== undefined ||
    (history.sender !== undefined && (history.sender.messageCount >= 2 || (history.sender.parentSentCount ?? 0) > 0));

  // Each distinct link, judged by where it really points (redirect wrappers unwrapped).
  const seen = new Set<string>();
  const linkFacts: {
    shownText: string;
    href: string;
    site: string;
    cls: "established" | "user_content" | "unknown";
    ageDays?: number;
    listedDangerous?: boolean;
    risky: boolean;
  }[] = [];
  let probes = 0;
  for (const l of email.links) {
    const target = linkTarget(l.href);
    const href = cleanUrl(target.url) ?? "";
    if (!href || seen.has(href) || linkFacts.length >= 20) continue;
    seen.add(href);
    const c = classifySite(target.url);
    const cls = target.viaRedirect && c.cls === "established" ? "unknown" : c.cls;
    const intelFor = c.site ? intel[c.site] : undefined;
    const fact = {
      shownText: l.text.slice(0, 40),
      href,
      site: c.site,
      cls,
      ...(intelFor?.ageDays !== undefined && { ageDays: intelFor.ageDays }),
      ...(intelFor?.listed !== undefined && { listedDangerous: intelFor.listed }),
    };
    // For someone Mom knows, look at where a non-established link really goes before judging:
    // their link is only suspicious if our own checks find it dangerous.
    const probe = familiar && cls !== "established" && probes < 3 ? (probes++, await probeLink(target.url)) : undefined;
    linkFacts.push({ ...fact, risky: linkIsRisky({ ...fact, ...(probe && { probe }) }) });
  }

  // Ordinary money talk from family or familiar senders (bills, Venmo, "ASAP") isn't a scam
  // signal; gift cards, wires, crypto and secrecy are. Nor is naming a company in the subject
  // ("Can you pay the PG&E bill?") when every link goes to a big, known site and it talks about
  // the company rather than as it. Pretending to be a company (its name as the sender, a
  // look-alike address, "your account is locked") still counts, and so does a company's name
  // next to a link to some other site.
  const pressureCheck = base.checks.find((c) => c.id === "pressure");
  const signals = pressureSignals(pressureCheck?.detail);
  const scamPressure = signals.some((sig) => SCAM_SIGNALS.includes(sig));
  const baseChecks = base.checks.map((c) => {
    if (!familiar) return c;
    if (c.id === "pressure" && c.status === "fail" && !scamPressure) {
      return { ...c, status: "warn" as const, plainReason: "It mentions paying or a deadline, which is normal from someone you know." };
    }
    if (
      c.id === "claimed_identity" && c.status === "warn" && c.detail?.startsWith("mentions ") &&
      linkFacts.every((l) => l.cls === "established") && !speaksAsCompany(email)
    ) {
      return { ...c, status: "pass" as const, plainReason: "It mentions a company, which is normal from someone you know." };
    }
    return c;
  });
  const behavior = { riskySites: linkFacts.filter((l) => l.risky).map((l) => l.site), scamPressure };
  const checks = [...baseChecks, relationship(email, base.claimedOrg, history, claimStatus, behavior)];
  const floor = ruleLevel(checks);

  // Someone Mom knows wrote, it really came from their address, and nothing about it was odd:
  // remember the name they go by, so a stranger using it later stands out (the import learns
  // names too; this keeps up between imports).
  const authenticated = checks.some((c) => c.id === "header_auth" && c.status === "pass");
  if (familiar && floor === "real" && authenticated && senderName !== null && email.fromAddress.includes("@")) {
    const address = email.fromAddress.toLowerCase();
    const isPerson = keyFor({ address, domain: email.fromDomain }).kind === "person" && !isAutomatedMailbox(address);
    if (isPerson) {
      await ctx.runMutation(internal.mailWatch.learnName, {
        familyId,
        name: senderName,
        display: displayName(email.fromName),
        address: email.fromAddress.toLowerCase(),
      });
    }
  }

  // Claude only for flagged mail: it explains and may raise the level. Real mail stays private.
  // A flood of scam emails falls back to the template after CLAUDE_PER_HOUR in an hour.
  const overCap =
    floor !== "real" &&
    (await ctx.runQuery(internal.mailWatch.recentFlagged, { familyId, since: Date.now() - 3600_000 })) >= CLAUDE_PER_HOUR;
  const asked = opts.asked === true;
  const explained =
    floor === "real"
      ? asked
        ? {
            level: "real" as const,
            explanationForParent: "",
            explanationForKid: `${family.parentName} asked you about this email. Our quick checks didn't find anything wrong with it.`,
          }
        : null
      : await explain(
          {
            ruleLevel: floor,
            checks,
            claimedOrg: base.claimedOrg,
            fromDomain: email.fromDomain,
            subject: email.subject,
            parentName: family.parentName,
            kidName: family.kidName,
          },
          overCap ? undefined : process.env.ANTHROPIC_API_KEY,
        );

  const verdictId = await ctx.runMutation(internal.mailWatch.saveVerdict, {
    familyId,
    gmailMessageId: id,
    receivedAt: Number(msg.internalDate ?? Date.now()),
    level: explained?.level ?? "real",
    ruleLevel: floor,
    fromDomain: email.fromDomain || "unknown",
    fromName: email.fromName,
    fromAddress: email.fromAddress,
    subject: email.subject,
    ...(base.claimedOrg !== undefined && { claimedOrg: base.claimedOrg }),
    checks,
    explanationForParent: explained?.explanationForParent ?? "",
    explanationForKid: asked && explained?.level !== "real" && explained
      ? `${family.parentName} asked you about this email. ${explained.explanationForKid}`
      : (explained?.explanationForKid ?? ""),
    ...(asked && { asked: true }),
  });

  // A7: every suspicious email, and every email Mom asks about, gets the AI investigator
  // (facts only; never the body).
  if (verdictId && explained) {
    const brand = base.claimedOrg ? BRANDS.find((b) => b.name === base.claimedOrg) : undefined;
    await ctx.scheduler.runAfter(0, internal.investigations.investigate, {
      verdictId,
      facts: {
        ruleLevel: explained.level,
        sender: {
          name: email.fromName.slice(0, 120),
          address: email.fromAddress.slice(0, 254),
          domain: email.fromDomain || "unknown",
          ...(email.replyToAddress && { replyTo: email.replyToAddress.slice(0, 254) }),
        },
        ...(base.claimedOrg !== undefined && { claimedOrg: base.claimedOrg }),
        ...(brand && { officialDomains: brand.officialDomains }),
        familiar,
        ...(asked && { askedByParent: true }),
        checks,
        links: linkFacts.map((l) => ({
          shownText: l.shownText,
          href: l.href,
          site: l.site,
          cls: l.cls,
          ...(l.ageDays !== undefined && { ageDays: l.ageDays }),
          ...(l.listedDangerous !== undefined && { listedDangerous: l.listedDangerous }),
        })),
      },
    });
  }
}

// ---------- Mom asks the kid ----------
// The parent can ask about any email herself: she moves it to the "⚠ Check with [kid]" label
// (the one Anchor uses for emails it isn't sure about). Each poll looks at that label; an email
// there that Anchor didn't label gets the full check and investigation, and goes to the kid's
// feed as "asked". The kid's answer comes back to her in their own words, like any other.

const MAX_ASKED_PER_POLL = 3;

/**
 * Of the conversations under the "Check with" label (one listed email each), the ones the parent
 * put there that nobody has handled: not Anchor's own label, not already asked about, not held
 * or answered, and not failing over and over.
 */
export const openAsks = internalQuery({
  args: { familyId: v.id("families"), threads: v.array(v.object({ threadId: v.string(), id: v.string() })) },
  returns: v.array(v.object({ threadId: v.string(), id: v.string() })),
  handler: async (ctx, { familyId, threads }) => {
    const ledger = (kind: "labeled" | "askedThread", gmailId: string) =>
      ctx.db
        .query("anchorLedger")
        .withIndex("by_family_kind_id", (q) => q.eq("familyId", familyId).eq("kind", kind).eq("gmailId", gmailId))
        .first();
    const out: { threadId: string; id: string }[] = [];
    for (const t of threads.slice(0, 50)) {
      if ((await ledger("askedThread", t.threadId)) || (await ledger("labeled", t.id))) continue;
      const verdict = await ctx.db
        .query("verdicts")
        .withIndex("by_family_gmail_id", (q) => q.eq("familyId", familyId).eq("gmailMessageId", t.id))
        .first();
      if (verdict && (verdict.askedAt !== undefined || verdict.action !== "none")) continue;
      const failures = await ctx.db
        .query("pollFailures")
        .withIndex("by_family_message", (q) => q.eq("familyId", familyId).eq("gmailMessageId", `ask:${t.threadId}`))
        .unique();
      if (failures && failures.count >= MAX_FAILURES) continue;
      out.push(t);
    }
    return out;
  },
});

/** This conversation's ask is handled: never again, even if the label stays on it. */
export const markAsked = internalMutation({
  args: { familyId: v.id("families"), threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { familyId, threadId }) => {
    const family = await ctx.db.get(familyId);
    if (!family || family.status === "off") return null;
    const known = await ctx.db
      .query("anchorLedger")
      .withIndex("by_family_kind_id", (q) => q.eq("familyId", familyId).eq("kind", "askedThread").eq("gmailId", threadId))
      .first();
    if (!known) await ctx.db.insert("anchorLedger", { familyId, kind: "askedThread", gmailId: threadId });
    return null;
  },
});

async function checkAsked(ctx: ActionCtx, familyId: Id<"families">, family: FamilyInfo, accessToken: string, checkLabelId: string) {
  try {
    const listed = await gmail<{ messages?: { id: string; threadId?: string }[] }>(accessToken, "/messages", {
      labelIds: checkLabelId,
      maxResults: "50",
    });
    // Gmail labels whole conversations: one ask per conversation, about its newest email.
    const threads = new Map<string, string>();
    for (const m of listed.messages ?? []) if (!threads.has(m.threadId ?? m.id)) threads.set(m.threadId ?? m.id, m.id);
    if (threads.size === 0) return;
    const open = await ctx.runQuery(internal.mailWatch.openAsks, {
      familyId,
      threads: [...threads].map(([threadId, id]) => ({ threadId, id })),
    });
    for (const { threadId } of open.slice(0, MAX_ASKED_PER_POLL)) {
      try {
        const thread = await gmail<{ messages?: { id: string; labelIds?: string[]; internalDate?: string }[] }>(
          accessToken,
          `/threads/${encodeURIComponent(threadId)}`,
          { format: "minimal", fields: "messages(id,labelIds,internalDate)" },
        );
        // The newest email someone sent her: not her own replies or drafts.
        const theirs = (thread.messages ?? []).filter((m) => !(m.labelIds ?? []).some((l) => l === "SENT" || l === "DRAFT"));
        const newest = theirs.sort((a, b) => Number(b.internalDate ?? 0) - Number(a.internalDate ?? 0))[0];
        if (newest) await checkOne(ctx, familyId, family, accessToken, newest.id, { asked: true });
        await ctx.runMutation(internal.mailWatch.markAsked, { familyId, threadId });
      } catch (e) {
        if (isTransient(e)) return; // Gmail trouble: the next minute tries again
        // This one keeps failing: count it (given up on after a few), and go on to the next.
        await ctx.runMutation(internal.mailWatch.recordFailure, { familyId, gmailMessageId: `ask:${threadId}` });
      }
    }
  } catch (e) {
    // Never let an ask break the regular check; it's tried again next minute.
    console.error(`mailWatch.checkAsked failed: ${e instanceof Error ? e.message : "unknown"}`);
  }
}

/** Errors that mean "stop this run and try again next minute", not "this email is bad". */
const isTransient = (e: unknown) => e instanceof GmailError && (e.status === 401 || e.status === 429 || e.status >= 500);

/**
 * Check a list of message ids, oldest first. Returns true if every one is done (checked,
 * already seen, deleted, or given up on), so the cursor may move.
 */
async function checkAll(ctx: ActionCtx, familyId: Id<"families">, family: FamilyInfo, accessToken: string, ids: string[], started: number) {
  let checked = 0;
  for (const id of ids) {
    if (await ctx.runQuery(internal.mailWatch.alreadySeen, { familyId, gmailMessageId: id })) continue;
    if (checked >= MAX_PER_POLL || Date.now() - started > TIME_BUDGET_MS) return false;
    checked++;
    try {
      await checkOne(ctx, familyId, family, accessToken, id);
    } catch (e) {
      if (e instanceof GmailError && e.status === 404) continue; // deleted meanwhile
      if (isTransient(e)) return false; // Gmail trouble: everything waits for the next minute
      // This email itself is the problem. Retry a few times, then fail closed and move on.
      const failures = await ctx.runMutation(internal.mailWatch.recordFailure, { familyId, gmailMessageId: id });
      if (failures < MAX_FAILURES) return false;
      try {
        await saveUnchecked(ctx, familyId, family, accessToken, id, "we couldn't read it");
      } catch {
        return false;
      }
    }
  }
  return true;
}

export const pollFamily = internalAction({
  args: { familyId: v.id("families") },
  returns: v.null(),
  handler: async (ctx, { familyId }) => {
    const family = await ctx.runQuery(internal.mailWatch.familyForPoll, { familyId });
    if (!family || family.status !== "active" || !family.historyId) return null;
    if (!(await ctx.runMutation(internal.mailWatch.claimPoll, { familyId }))) return null; // another poll is running
    const started = Date.now();
    let checked = false; // every new email was looked at: the kid sees "checked 1 minute ago"
    try {
      const access = await accessTokenFor(ctx, familyId);
      if (!access.ok) return null; // reconnect is marked by accessTokenFor; others retry next minute

      let found: { ids: string[]; historyId?: string };
      try {
        found = await newMessageIds(access.accessToken, family.historyId, family.noteLabelId);
      } catch (e) {
        if (e instanceof GmailError && e.status === 404) {
          // The cursor is too old (Gmail keeps about a week, e.g. after a reconnect). Don't
          // silently skip the gap: re-check recent inbox mail, then start fresh from now.
          const profile = await gmail<{ historyId?: string }>(access.accessToken, "/profile");
          const recent = await gmail<{ messages?: { id: string }[] }>(access.accessToken, "/messages", {
            q: CATCH_UP_QUERY,
            maxResults: String(CATCH_UP_MAX),
          });
          const ids = (recent.messages ?? []).map((m) => m.id).reverse(); // oldest first
          const done = await checkAll(ctx, familyId, family, access.accessToken, ids, started);
          if (done && profile.historyId) {
            await ctx.runMutation(internal.mailWatch.saveHistoryId, { familyId, historyId: profile.historyId });
          }
          checked = done;
          return null;
        }
        if (e instanceof GmailError && e.status === 401) {
          await accessTokenFor(ctx, familyId, { force: true }); // next poll uses the fresh token
          return null;
        }
        if (isTransient(e)) return null; // rate limited or Gmail trouble: next minute
        throw e;
      }

      const done = await checkAll(ctx, familyId, family, access.accessToken, found.ids, started);
      if (done && found.historyId) {
        await ctx.runMutation(internal.mailWatch.saveHistoryId, { familyId, historyId: found.historyId });
      }
      checked = done;
      if (done && family.checkLabelId) await checkAsked(ctx, familyId, family, access.accessToken, family.checkLabelId);
      // The parent asks with the "Check with" label: if setup couldn't create it, try again.
      if (done && !family.checkLabelId && actionsEnabled()) await ctx.scheduler.runAfter(0, internal.gmailActions.prepareLabels, { familyId });
      return null;
    } finally {
      await ctx.runMutation(internal.mailWatch.releasePoll, { familyId, ...(checked && { checkedAt: Date.now() }) });
    }
  },
});
