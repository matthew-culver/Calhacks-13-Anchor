// A4: learn who the parent really deals with from ~2 years of email HEADERS (never bodies),
// then build My Accounts. Runs right after the first Gmail connect (and after a reconnect if
// the first import never finished). Demo mode builds the same thing from sample headers:
//   npx convex run gmailImport:importSample '{"familyId":"..."}'

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalMutation } from "./_generated/server";
import { account, relationship } from "./contract";
import { accessTokenFor } from "./googleAuth";
import { buildHistory, type HeaderRecord } from "./lib/history";
import { GOOGLE_TIMEOUT_MS } from "./lib/oauth";
import { ORGS } from "./lib/orgDirectory";
import { sampleRecords } from "./lib/sampleHistory";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const WINDOW = "newer_than:2y -in:chats";
/** Newest mail in general, plus older mail from known orgs (yearly senders like Medicare). */
const MAX_RECENT = 1500; // with MAX_FROM_ORGS, keeps a big inbox well under the 10-minute action limit
const MAX_FROM_ORGS = 1000;
const PAGE_SIZE = 500;
// Gmail allows ~250 quota units per user per second and messages.get costs 5: stay well under.
const CONCURRENCY = 8;
const MAX_TRIES = 4;
/** Whole-import retries after an unexpected failure: 1, 4, then 16 minutes later. */
const MAX_IMPORT_ATTEMPTS = 3;

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
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 250 + Math.random() * 250);
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
  };
}

async function listIds(accessToken: string, q: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(accessToken, "/messages", {
      q,
      maxResults: String(PAGE_SIZE),
      includeSpamTrash: "false",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const m of page.messages ?? []) ids.push(m.id);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids.slice(0, max);
}

async function fetchHeaders(accessToken: string): Promise<{ records: HeaderRecord[]; historyId?: string }> {
  // Cursor first, so A5 starts from a point no later than what we import.
  const profile = await gmail<{ historyId?: string }>(accessToken, "/profile");

  const recent = await listIds(accessToken, WINDOW, MAX_RECENT);
  const orgDomains = ORGS.flatMap((o) => o.domains);
  const fromOrgs = await listIds(accessToken, `${WINDOW} from:(${orgDomains.join(" OR ")})`, MAX_FROM_ORGS);
  const ids = [...new Set([...recent, ...fromOrgs])];

  const records: HeaderRecord[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      ids.slice(i, i + CONCURRENCY).map((id) =>
        gmail<GmailMessage>(accessToken, `/messages/${encodeURIComponent(id)}`, {
          format: "metadata", // headers only: the body is never requested
          metadataHeaders: ["From", "To", "Authentication-Results"],
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
  }
  return { records, historyId: profile.historyId };
}

async function save(
  ctx: ActionCtx,
  familyId: Id<"families">,
  records: HeaderRecord[],
  opts: { historyId?: string; selfEmail?: string },
) {
  const { relationships, accounts } = buildHistory(records, Date.now(), { selfEmail: opts.selfEmail });
  await ctx.runMutation(internal.gmailImport.saveImport, { familyId, relationships, accounts, historyId: opts.historyId });
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
        const { records, historyId } = await fetchHeaders(access.accessToken);
        await save(ctx, familyId, records, { historyId, selfEmail: tokens?.googleEmail });
        return null;
      } catch (e) {
        if (e instanceof GmailError && e.status === 401 && tries === 0) {
          // The token may have expired mid-run: refresh once. Only a refused refresh
          // (invalid_grant) means the parent must reconnect, and accessTokenFor marks that.
          access = await accessTokenFor(ctx, familyId, { force: true });
          if (access.ok) continue;
          return access.reason === "unavailable" ? retryLater("token refresh unavailable") : null;
        }
        return retryLater(e instanceof Error ? e.message : "unknown error");
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
    await save(ctx, familyId, sampleRecords(), { selfEmail: "mom.culver@gmail.com" });
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
  },
  returns: v.null(),
  handler: async (ctx, { familyId, relationships, accounts, historyId }) => {
    const family = await ctx.db.get(familyId);
    if (family === null || family.status === "off") return null;

    for await (const r of ctx.db.query("relationships").withIndex("by_family_key", (q) => q.eq("familyId", familyId))) {
      await ctx.db.delete(r._id);
    }
    for await (const a of ctx.db.query("accounts").withIndex("by_family", (q) => q.eq("familyId", familyId))) {
      await ctx.db.delete(a._id);
    }
    for (const r of relationships) await ctx.db.insert("relationships", { ...r, familyId });
    for (const a of accounts) await ctx.db.insert("accounts", { ...a, familyId });

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
