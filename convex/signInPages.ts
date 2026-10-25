// A8: sign-in pages for companies outside the curated directory, found by Claude
// (lib/signInFinder.ts) once per company domain and shared by every family through the
// server-only `orgDirectory` table. The history import queues lookups as it saves accounts;
// a finished lookup fills in that family's account right away (the screen updates live),
// queues the family's next ones, and every later import of any family reuses it.
//
// Safety, on top of the finder's own checks and history.ts's rules for who counts as a
// company: fail closed. No link unless the domain is at least a year old by RDAP and Google
// Safe Browsing answered that the page isn't listed; if either can't be checked, the lookup
// counts as failed and is tried again later. A link is checked again after 90 days, and the
// latest lookup decides (a link that no longer passes is removed).
//
// Cost: one lookup per domain (cached), at most NEW_PER_SAVE per save, LOOKUPS_PER_FAMILY_HOUR
// per family and LOOKUPS_PER_HOUR in all, retries included. A failed attempt retries itself
// twice (10 minutes, then an hour later), then waits for a later save.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { lookupBlocklisted, lookupDomainAgeDays } from "./checks/intel";
import { accountCategory } from "./contract";
import { type AccountRow, accountFields, applyDiscovered, byRank, sameAccount } from "./lib/history";
import { orgForDomain } from "./lib/orgDirectory";
import { findSignInPage, type Found, lookupAllowed } from "./lib/signInFinder";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NEW_PER_SAVE = 5;
const LOOKUPS_PER_HOUR = 30;
const LOOKUPS_PER_FAMILY_HOUR = 10;
const SPACING_MS = 3000; // queued lookups start a few seconds apart, not all at once
const NOTHING_RETRY_MS = 30 * DAY; // found no sign-in page: look again after this
const RECHECK_MS = 90 * DAY; // found one: check it again after this
const FAILED_RETRY_MS = HOUR; // a lookup started (or last failed) this recently isn't queued again
const RETRY_DELAYS_MS = [10 * MINUTE, HOUR]; // a failed attempt's own retries
const MIN_DOMAIN_AGE_DAYS = 365;

async function entryFor(ctx: QueryCtx, domain: string): Promise<Doc<"orgDirectory"> | null> {
  return ctx.db
    .query("orgDirectory")
    .withIndex("by_domain", (q) => q.eq("domain", domain))
    .unique();
}

/** A company outside the curated list: its accounts are keyed by one sending domain. */
export function lookupDomainOf(a: AccountRow): string | null {
  const domain = a.officialDomains.length === 1 ? a.officialDomains[0] : null;
  return domain !== null && !orgForDomain(domain) ? domain : null;
}

/** Time for a new lookup of this domain? Never while one is running or just failed. */
function due(entry: Doc<"orgDirectory">, now: number): boolean {
  if (entry.lookupStartedAt !== undefined && now - entry.lookupStartedAt < FAILED_RETRY_MS) return false;
  if (entry.checkedAt === 0) return true; // never finished
  return now - entry.checkedAt >= (entry.loginUrl !== undefined ? RECHECK_MS : NOTHING_RETRY_MS);
}

/** The account with what the last finished lookup learned (name, group, sign-in page). */
export async function withDirectory(ctx: QueryCtx, a: AccountRow): Promise<AccountRow> {
  const domain = lookupDomainOf(a);
  if (domain === null) return a;
  const entry = await entryFor(ctx, domain);
  if (entry === null || entry.checkedAt === 0) return a;
  return applyDiscovered(a, entry);
}

/** Lookups started in the last hour, retries included: in all, and for this family. */
async function recentLookups(ctx: QueryCtx, familyId: Id<"families">, now: number) {
  const recent = await ctx.db.system.query("_scheduled_functions").order("desc").take(500);
  const lookups = recent.filter(
    (f) => f.name.replace(/\.js(?=:)/, "") === "signInPages:lookUp" && f.scheduledTime > now - HOUR,
  );
  return { all: lookups.length, family: lookups.filter((f) => f.args[0]?.familyId === familyId).length };
}

/** Queue lookups for this family's companies outside the list, most important first, within the caps. */
export async function queueLookups(ctx: MutationCtx, familyId: Id<"families">, accounts: AccountRow[]): Promise<void> {
  const now = Date.now();
  let queued = 0;
  let counts: { all: number; family: number } | undefined;
  for (const a of [...accounts].sort(byRank)) {
    if (queued >= NEW_PER_SAVE) return;
    const domain = lookupDomainOf(a);
    if (domain === null || !lookupAllowed(domain)) continue;
    const entry = await entryFor(ctx, domain);
    if (entry !== null && !due(entry, now)) continue;
    counts ??= await recentLookups(ctx, familyId, now);
    if (counts.all + queued >= LOOKUPS_PER_HOUR || counts.family + queued >= LOOKUPS_PER_FAMILY_HOUR) return;
    const delay = queued * SPACING_MS;
    if (entry === null) {
      await ctx.db.insert("orgDirectory", { domain, orgName: domain, category: "other", checkedAt: 0, lookupStartedAt: now + delay });
    } else {
      await ctx.db.patch(entry._id, { lookupStartedAt: now + delay });
    }
    await ctx.scheduler.runAfter(delay, internal.signInPages.lookUp, { domain, familyId, nameHint: a.orgName, attempt: 1 });
    queued++;
  }
}

export const familyWantsLookups = internalQuery({
  args: { familyId: v.id("families") },
  returns: v.boolean(),
  handler: async (ctx, { familyId }) => {
    const family = await ctx.db.get(familyId);
    return family !== null && family.status !== "off";
  },
});

export const lookUp = internalAction({
  args: { domain: v.string(), familyId: v.id("families"), nameHint: v.string(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { domain, familyId, nameHint, attempt = 1 }) => {
    const finish = async (result: { failed: boolean; final?: boolean; found?: Found }) => {
      await ctx.runMutation(internal.signInPages.saveLookup, {
        domain,
        familyId,
        nameHint,
        attempt,
        failed: result.failed,
        ...(result.final !== undefined && { final: result.final }),
        ...(result.found?.orgName !== undefined && { orgName: result.found.orgName }),
        ...(result.found?.category !== undefined && { category: result.found.category }),
        ...(result.found?.loginUrl !== undefined && { loginUrl: result.found.loginUrl }),
      });
      return null;
    };

    if (!lookupAllowed(domain)) return finish({ failed: false, found: {} });
    if (!(await ctx.runQuery(internal.signInPages.familyWantsLookups, { familyId }))) return null;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || !process.env.SAFE_BROWSING_API_KEY) {
      console.error("signInPages: ANTHROPIC_API_KEY or SAFE_BROWSING_API_KEY is not set, so no sign-in lookups");
      return finish({ failed: true, final: true });
    }
    // Scam sites are usually young. An age we can't learn is a failure, tried again later.
    const age = await lookupDomainAgeDays(domain);
    if (age === "unknown") return finish({ failed: true });
    if (age < MIN_DOMAIN_AGE_DAYS) return finish({ failed: false, found: {} });

    const found = await findSignInPage(domain, nameHint, apiKey);
    if (found === null) return finish({ failed: true });
    if (found.loginUrl !== undefined) {
      const listed = await lookupBlocklisted([found.loginUrl]);
      if (listed === "unknown") return finish({ failed: true });
      if (listed.size > 0) delete found.loginUrl;
    }
    return finish({ failed: false, found });
  },
});

/** Store the result for every family, fill in this family's account, and queue its next lookups. */
export const saveLookup = internalMutation({
  args: {
    domain: v.string(),
    familyId: v.id("families"),
    nameHint: v.string(),
    attempt: v.number(),
    failed: v.boolean(),
    final: v.optional(v.boolean()),
    orgName: v.optional(v.string()),
    category: v.optional(accountCategory),
    loginUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { domain, familyId, nameHint, attempt, failed, final, orgName, category, loginUrl }) => {
    const now = Date.now();
    const entry = await entryFor(ctx, domain);

    if (failed) {
      // Keep whatever an earlier lookup found. Retry this one a couple of times, then wait.
      const delay = final ? undefined : RETRY_DELAYS_MS[attempt - 1];
      const startAt = delay === undefined ? now : now + delay;
      if (entry === null) {
        await ctx.db.insert("orgDirectory", { domain, orgName: domain, category: "other", checkedAt: 0, lookupStartedAt: startAt });
      } else {
        await ctx.db.patch(entry._id, { lookupStartedAt: startAt });
      }
      if (delay !== undefined) {
        await ctx.scheduler.runAfter(delay, internal.signInPages.lookUp, { domain, familyId, nameHint, attempt: attempt + 1 });
      }
      return null;
    }

    // The latest finished lookup decides the link; name and group fall back to what we had.
    const fields = {
      domain,
      orgName: orgName ?? entry?.orgName ?? domain,
      category: category ?? entry?.category ?? "other",
      loginUrl,
      checkedAt: now,
    };
    if (entry === null) await ctx.db.insert("orgDirectory", fields);
    else await ctx.db.replace(entry._id, fields);

    const family = await ctx.db.get(familyId);
    if (family === null || family.status === "off") return null;
    const rows = await ctx.db
      .query("accounts")
      .withIndex("by_family", (q) => q.eq("familyId", familyId))
      .take(100);
    for (const row of rows) {
      if (lookupDomainOf(row) !== domain) continue;
      const next = applyDiscovered(accountFields(row), fields);
      // Names stay unique within a family (the import matches rows by name too).
      if (rows.some((r) => r._id !== row._id && r.orgName.toLowerCase() === next.orgName.toLowerCase())) next.orgName = row.orgName;
      if (!sameAccount(row, next)) await ctx.db.replace(row._id, { ...next, familyId });
    }
    await queueLookups(ctx, familyId, rows.map(accountFields));
    return null;
  },
});
