// A4: learn who the parent really deals with from ~2 years of email HEADERS (never bodies),
// then build My Accounts. Runs right after the first Gmail connect (and after a reconnect if
// the first import never finished). Demo mode builds the same thing from sample headers:
//   npx convex run gmailImport:importSample '{"familyId":"..."}'
//
// A8: two passes, so the screen fills in within seconds and keeps re-sorting live. First a
// Gmail search for account-type mail only (statements, bills, sign-in alerts, appointments...,
// up to MAX_FIRST_PASS), then the deeper pass (recent mail plus mail from known orgs). Accounts
// are saved in batches as they are found, matched by org, never wiped mid-import; the final
// save also replaces the relationships and drops accounts that no longer qualify. Subjects are
// read in memory to spot account mail and never stored.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { account, relationship } from "./contract";
import { accessTokenFor } from "./googleAuth";
import { type AccountRow, buildHistory, type HeaderRecord, sameAccount } from "./lib/history";
import { GOOGLE_TIMEOUT_MS } from "./lib/oauth";
import { ORGS } from "./lib/orgDirectory";
import { sampleRecords } from "./lib/sampleHistory";
import { queueLookups, withDirectory } from "./signInPages";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const WINDOW = "newer_than:2y -in:chats";
// First pass: account-type mail only, newest first, not Promotions.
const ACCOUNT_WORDS = [
  "statement", "bill", "payment", "autopay", "invoice", "password", "verification", "verify", "code",
  '"sign-in"', '"sign in"', '"signed in"', "login", "device", "security", "appointment", "visit",
  "results", "order", "shipped", "delivered", "prescription", "refill", "premium", "benefits",
];
const FIRST_PASS = `${WINDOW} -category:promotions subject:(${ACCOUNT_WORDS.join(" OR ")})`;
const MAX_FIRST_PASS = 300;
const FIRST_SAVE_EVERY = 60; // messages: about every two seconds, so accounts appear live
const DEEP_SAVE_EVERY = 300;
const MAX_QUERY_CHARS = 1500; // the from:(...) list is split into queries of about this size
/** Newest mail in general, plus older mail from known orgs (yearly senders like Medicare). */
const MAX_RECENT = 1500; // with MAX_FROM_ORGS, keeps a big inbox well under the 10-minute action limit
const MAX_FROM_ORGS = 1000;
const PAGE_SIZE = 500;
// Gmail allows ~250 quota units per user per second and messages.get costs 5, so about 50
// messages a second. Each request takes up to ~1 s, so many must be in flight at once to get
// near that; the pacing below keeps the rate just under it, so Gmail never answers "slow
// down" (each of those costs a retry wait). Override with ANCHOR_IMPORT_RATE (messages/second).
// Measured on a real ~2,500-message inbox: 8 in flight took 400+ s, 40 in flight 166 s. 20 keeps
// clear of Gmail's separate limit on simultaneous requests per user.
const CONCURRENCY = 20;
const DEFAULT_RATE = 30; // leaves quota for the watcher and Gmail actions running alongside
const MAX_RETRY_WAIT_MS = 10_000;
const MAX_TRIES = 4;
/** Whole-import retries after an unexpected failure: 1, 4, then 16 minutes later. */
const MAX_IMPORT_ATTEMPTS = 3;
/** Newest verdicts looked at for flagged mail to leave out (plenty: flagged mail is rare). */
const MAX_VERDICTS_SCANNED = 5000;
/** More than one import ever keeps (history.MAX_ACCOUNTS), so a re-import still finds every old row. */
const MAX_STORED_ACCOUNTS = 200;

class GmailError extends Error {
  constructor(readonly status: number) {
    super(`Gmail API ${status}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One Gmail call, retrying rate limits and server errors with backoff (honors Retry-After). */
async function gmail<T>(accessToken: string, path: string, params: Record<string, string | string[]> = {}): Promise<T> {
  const url = new URL(`${GMAIL}${path}`);
  for (const [k, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(k, item);
  }
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (res.ok) return (await res.json()) as T;
    const rateLimited = res.status === 429 || (res.status === 403 && /rateLimit/i.test(await res.clone().text()));
    if ((rateLimited || res.status >= 500) && attempt < MAX_TRIES) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      await sleep(Math.min(MAX_RETRY_WAIT_MS, retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 250 + Math.random() * 250));
      continue;
    }
    throw new GmailError(res.status);
  }
}

type GmailMessage = {
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: { name: string; value: string }[] };
};

function toRecord(m: GmailMessage): HeaderRecord | null {
  const labels = m.labelIds ?? [];
  if (labels.includes("DRAFT")) return null;
  const headers = m.payload?.headers ?? [];
  const all = (name: string) => headers.filter((h) => h.name.toLowerCase() === name.toLowerCase()).map((h) => h.value);
  return {
    from: all("From").join(", "), // two From headers become two addresses: then we don't guess
    to: all("To").join(", "),
    authResults: all("Authentication-Results"), // Gmail returns them top first
    date: Number(m.internalDate ?? 0),
    sent: labels.includes("SENT"),
    subject: all("Subject")[0] ?? "", // in memory only, to spot account mail
    promotional: labels.includes("CATEGORY_PROMOTIONS"),
  };
}

async function listIds(accessToken: string, q: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(accessToken, "/messages", {
      q,
      maxResults: String(Math.min(PAGE_SIZE, max - ids.length)),
      includeSpamTrash: "false",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const m of page.messages ?? []) ids.push(m.id);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids.slice(0, max);
}

/** Mail from the directory's orgs, in queries of bounded length, sharing MAX_FROM_ORGS. */
async function listFromOrgs(accessToken: string): Promise<string[]> {
  const groups: string[][] = [[]];
  let length = 0;
  for (const domain of ORGS.flatMap((o) => o.domains)) {
    if (length + domain.length > MAX_QUERY_CHARS && groups[groups.length - 1].length > 0) {
      groups.push([]);
      length = 0;
    }
    groups[groups.length - 1].push(domain);
    length += domain.length + 4; // " OR "
  }
  const each = Math.ceil(MAX_FROM_ORGS / groups.length);
  const ids: string[] = [];
  for (const group of groups) ids.push(...(await listIds(accessToken, `${WINDOW} from:(${group.join(" OR ")})`, each)));
  return ids;
}

/** Fetch headers for `ids` into `records`, paced under Gmail's quota, calling `progress` every `every` messages. */
async function fetchRecords(
  accessToken: string,
  ids: string[],
  records: HeaderRecord[],
  every: number,
  progress: () => Promise<void>,
): Promise<void> {
  const rate = Number(process.env.ANCHOR_IMPORT_RATE) > 0 ? Number(process.env.ANCHOR_IMPORT_RATE) : DEFAULT_RATE;
  const minBatchMs = (CONCURRENCY * 1000) / rate;
  let sinceProgress = 0;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batchStarted = Date.now();
    const slice = ids.slice(i, i + CONCURRENCY);
    const batch = await Promise.all(
      slice.map((id) =>
        gmail<GmailMessage>(accessToken, `/messages/${encodeURIComponent(id)}`, {
          format: "metadata", // headers only: the body is never requested
          metadataHeaders: ["From", "To", "Subject", "Authentication-Results"],
          fields: "internalDate,labelIds,payload/headers", // and not even the snippet
        }).catch((e: unknown) => {
          // One unreadable message (deleted meanwhile, or still rate limited) is skipped;
          // a 401 means the token died and the whole run must stop.
          if (e instanceof GmailError && e.status !== 401) return null;
          throw e;
        }),
      ),
    );
    for (const m of batch) {
      const record = m && toRecord(m);
      if (record) records.push(record);
    }
    sinceProgress += slice.length;
    if (sinceProgress >= every) {
      sinceProgress = 0;
      await progress();
    }
    const spent = Date.now() - batchStarted;
    if (spent < minBatchMs) await sleep(minBatchMs - spent);
  }
}

/** Save the accounts found so far, so the screen fills in. Best effort: the final save decides. */
async function saveProgress(ctx: ActionCtx, familyId: Id<"families">, records: HeaderRecord[], selfEmail?: string) {
  const { accounts } = buildHistory(records, Date.now(), { selfEmail });
  if (accounts.length === 0) return;
  try {
    await ctx.runMutation(internal.gmailImport.saveAccounts, { familyId, accounts });
  } catch (e) {
    console.error(`History import: progress save failed (${e instanceof Error ? e.name : "unknown"})`);
  }
}

async function runImport(ctx: ActionCtx, familyId: Id<"families">, accessToken: string, selfEmail?: string) {
  const started = Date.now();
  // Cursor first, so A5 starts from a point no later than what we import.
  const profile = await gmail<{ historyId?: string }>(accessToken, "/profile");
  const records: HeaderRecord[] = [];
  const progress = () => saveProgress(ctx, familyId, records, selfEmail);
  // Mail Anchor flagged never counts as history: otherwise a scammer whose emails were held
  // would become a "familiar" sender on the next import, and get family-level trust.
  const flagged = new Set(await ctx.runQuery(internal.gmailImport.flaggedMessageIds, { familyId }));

  const firstIds = (await listIds(accessToken, FIRST_PASS, MAX_FIRST_PASS)).filter((id) => !flagged.has(id));
  await fetchRecords(accessToken, firstIds, records, FIRST_SAVE_EVERY, progress);
  await progress();
  console.log(`History import: first pass read ${firstIds.length} emails in ${Date.now() - started} ms`);

  const seen = new Set(firstIds);
  const recent = await listIds(accessToken, WINDOW, MAX_RECENT);
  const fromOrgs = await listFromOrgs(accessToken);
  const deepIds = [...new Set([...recent, ...fromOrgs])].filter((id) => !seen.has(id) && !flagged.has(id));
  await fetchRecords(accessToken, deepIds, records, DEEP_SAVE_EVERY, progress);

  await save(ctx, familyId, records, { historyId: profile.historyId, selfEmail });
  console.log(`History import: done, ${records.length} emails in ${Date.now() - started} ms`);
}

async function save(
  ctx: ActionCtx,
  familyId: Id<"families">,
  records: HeaderRecord[],
  opts: { historyId?: string; selfEmail?: string; lookUpSignIn?: boolean },
) {
  const { relationships, accounts } = buildHistory(records, Date.now(), { selfEmail: opts.selfEmail });
  await ctx.runMutation(internal.gmailImport.saveImport, {
    familyId,
    relationships,
    accounts,
    historyId: opts.historyId,
    ...(opts.lookUpSignIn === false && { lookUpSignIn: false }),
  });
}

export const importHistory = internalAction({
  args: { familyId: v.id("families"), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { familyId, attempt = 1 }) => {
    const tokens = await ctx.runQuery(internal.googleAuth.getTokens, { familyId });
    const retryLater = async (why: string) => {
      if (attempt >= MAX_IMPORT_ATTEMPTS) {
        console.error(`History import gave up after ${attempt} attempts: ${why}`);
        return null;
      }
      await ctx.scheduler.runAfter(4 ** (attempt - 1) * 60_000, internal.gmailImport.importHistory, {
        familyId,
        attempt: attempt + 1,
      });
      return null;
    };

    let access = await accessTokenFor(ctx, familyId);
    if (!access.ok) {
      // not_connected/off: nothing to do. reconnect: already marked needs_reconnect.
      return access.reason === "unavailable" ? retryLater("token refresh unavailable") : null;
    }
    for (let tries = 0; ; tries++) {
      try {
        await runImport(ctx, familyId, access.accessToken, tokens?.googleEmail);
        return null;
      } catch (e) {
        if (e instanceof GmailError && e.status === 401 && tries === 0) {
          // The token may have expired mid-run: refresh once. Only a refused refresh
          // (invalid_grant) means the parent must reconnect, and accessTokenFor marks that.
          access = await accessTokenFor(ctx, familyId, { force: true });
          if (access.ok) continue;
          return access.reason === "unavailable" ? retryLater("token refresh unavailable") : null;
        }
        return retryLater(e instanceof GmailError ? e.message : e instanceof Error ? e.name : "unknown error");
      }
    }
  },
});

/**
 * Demo mode: same pipeline, sample headers instead of Gmail. Refuses a family whose real
 * history was already imported, so it can't overwrite real data by accident.
 */
export const importSample = internalAction({
  args: { familyId: v.id("families"), replaceRealData: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { familyId, replaceRealData }) => {
    const tokens = await ctx.runQuery(internal.googleAuth.getTokens, { familyId });
    if (tokens?.historyId !== undefined && !replaceRealData) {
      throw new Error("This family has real Gmail history. Pass replaceRealData: true to overwrite it.");
    }
    // No sign-in page lookups: the sample's companies aren't real.
    await save(ctx, familyId, sampleRecords(), { selfEmail: "mom@example.com", lookUpSignIn: false });
    return null;
  },
});

/**
 * Upsert this family's accounts, matched by a shared domain or the same name, so rows keep
 * their ids while the list fills in. Only changed rows are written. With `replace`, rows not
 * in the list are deleted (the final save).
 */
async function upsertAccounts(
  ctx: MutationCtx,
  familyId: Id<"families">,
  incoming: AccountRow[],
  opts: { replace: boolean; lookUpSignIn: boolean },
) {
  const existing = await ctx.db
    .query("accounts")
    .withIndex("by_family", (q) => q.eq("familyId", familyId))
    .take(MAX_STORED_ACCOUNTS);
  const kept = new Set<Id<"accounts">>();
  const names = new Set<string>();
  const saved: AccountRow[] = [];
  for (const raw of incoming) {
    let a = await withDirectory(ctx, raw);
    if (names.has(a.orgName.toLowerCase())) a = { ...a, orgName: raw.orgName };
    names.add(a.orgName.toLowerCase());
    const open = existing.filter((e) => !kept.has(e._id));
    const match =
      open.find((e) => e.officialDomains.some((d) => a.officialDomains.includes(d))) ?? open.find((e) => e.orgName === a.orgName);
    if (match) {
      kept.add(match._id);
      if (!sameAccount(match, a)) await ctx.db.replace(match._id, { ...a, familyId });
    } else {
      await ctx.db.insert("accounts", { ...a, familyId });
    }
    saved.push(a);
  }
  if (opts.replace) {
    for (const e of existing) if (!kept.has(e._id)) await ctx.db.delete(e._id);
  }
  if (opts.lookUpSignIn) await queueLookups(ctx, familyId, saved);
}

/** Accounts found so far during the import (A8): upsert only, nothing removed. */
/** Gmail ids of mail Anchor flagged (fake or unsure) that the kid hasn't since called fine. */
export const flaggedMessageIds = internalQuery({
  args: { familyId: v.id("families") },
  returns: v.array(v.string()),
  handler: async (ctx, { familyId }) => {
    const verdicts = await ctx.db
      .query("verdicts")
      .withIndex("by_family_received", (q) => q.eq("familyId", familyId))
      .order("desc")
      .take(MAX_VERDICTS_SCANNED);
    return verdicts.filter((d) => d.level !== "real" && d.action !== "released").map((d) => d.gmailMessageId);
  },
});

export const saveAccounts = internalMutation({
  args: { familyId: v.id("families"), accounts: v.array(account.omit("familyId")) },
  returns: v.null(),
  handler: async (ctx, { familyId, accounts }) => {
    const family = await ctx.db.get(familyId);
    if (family === null || family.status === "off") return null;
    await upsertAccounts(ctx, familyId, accounts, { replace: false, lookUpSignIn: true });
    return null;
  },
});

/** Replace this family's relationships and accounts in one transaction, then go active. */
export const saveImport = internalMutation({
  args: {
    familyId: v.id("families"),
    relationships: v.array(relationship.omit("familyId")),
    accounts: v.array(account.omit("familyId")),
    historyId: v.optional(v.string()),
    lookUpSignIn: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { familyId, relationships, accounts, historyId, lookUpSignIn }) => {
    const family = await ctx.db.get(familyId);
    if (family === null || family.status === "off") return null;

    for await (const r of ctx.db.query("relationships").withIndex("by_family_key", (q) => q.eq("familyId", familyId))) {
      await ctx.db.delete(r._id);
    }
    for (const r of relationships) await ctx.db.insert("relationships", { ...r, familyId });
    await upsertAccounts(ctx, familyId, accounts, { replace: true, lookUpSignIn: lookUpSignIn !== false });

    if (historyId !== undefined) {
      const tokens = await ctx.db
        .query("gmailTokens")
        .withIndex("by_family", (q) => q.eq("familyId", familyId))
        .unique();
      if (tokens) await ctx.db.patch(tokens._id, { historyId });
    }
    if (family.status === "learning") await ctx.db.patch(familyId, { status: "active" });
    return null;
  },
});
