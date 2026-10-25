// A6: act on verdicts inside the parent's Gmail, and tell the parent in plain words.
//   fake   → "Anchor: Held" label, out of the inbox. Quietly: no note (A9).
//   unsure → "⚠ Check with [kid]" label (stays in the inbox). Quietly.
//   kid says "It's fine"   → back in the inbox, labels removed
//   kid says "It's a scam" → held
//   kid adds their own words → a short warm note to the parent with those words
//   once a week, if anything happened → one calm summary note (weeklyNotes cron)
//
// Safety switch: nothing touches Gmail unless the Convex env var ANCHOR_GMAIL_ACTIONS is "on"
//   npx convex env set ANCHOR_GMAIL_ACTIONS on
// With it off, verdicts and answers are still recorded; only the Gmail changes are skipped.
// Scope is gmail.modify: labels, archive and insert. Anchor never sends or deletes mail.
//
// Rules for the parent note: it never quotes anything the email's sender wrote (names,
// subjects), only our fixed sentences, the brand from our own list, and the kid's words with
// links, addresses and numbers removed.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { accessTokenFor } from "./googleAuth";
import { GmailError, gmailRequest } from "./lib/gmailApi";
import { buildNote, cleanKidNote, noteMessageId } from "./lib/parentNote";
import schema from "./schema";

const MAX_ATTEMPTS = 3;

export function actionsEnabled(): boolean {
  return process.env.ANCHOR_GMAIL_ACTIONS === "on";
}

const HELD_LABEL = "Anchor: Held";
const NOTE_LABEL = "Anchor";
const checkLabelName = (kidName: string) => `⚠ Check with ${kidName.replace(/[\u0000-\u001f\u007f/]/g, " ").trim().slice(0, 40)}`;

// ---------- database helpers ----------

const contextShape = v.union(
  v.null(),
  v.object({
    verdict: schema.doc("verdicts"),
    family: schema.doc("families"),
    labels: v.object({ held: v.optional(v.string()), check: v.optional(v.string()), note: v.optional(v.string()) }),
    feedItem: v.optional(schema.doc("feedItems")),
  }),
);

type LabelContext = {
  family: Doc<"families">;
  labels: { held?: string; check?: string; note?: string };
};

type Context = LabelContext & {
  verdict: Doc<"verdicts">;
  feedItem?: Doc<"feedItems">;
};

export const contextForVerdict = internalQuery({
  args: { verdictId: v.id("verdicts") },
  returns: contextShape,
  handler: async (ctx, { verdictId }) => {
    const verdict = await ctx.db.get(verdictId);
    if (!verdict) return null;
    const family = await ctx.db.get(verdict.familyId);
    if (!family) return null;
    const tokens = await ctx.db
      .query("gmailTokens")
      .withIndex("by_family", (q) => q.eq("familyId", family._id))
      .unique();
    const feedItem = await ctx.db
      .query("feedItems")
      .withIndex("by_verdict", (q) => q.eq("verdictId", verdictId))
      .first();
    return {
      verdict,
      family,
      labels: { held: tokens?.heldLabelId, check: tokens?.checkLabelId, note: tokens?.noteLabelId },
      ...(feedItem && { feedItem }),
    };
  },
});

export const contextForFeedItem = internalQuery({
  args: { feedItemId: v.id("feedItems") },
  returns: v.union(v.null(), v.object({ verdictId: v.id("verdicts") })),
  handler: async (ctx, { feedItemId }) => {
    const item = await ctx.db.get(feedItemId);
    return item ? { verdictId: item.verdictId } : null;
  },
});

/** Save label ids, or clear them (all undefined) when Gmail says they no longer exist. */
export const saveLabelIds = internalMutation({
  args: { familyId: v.id("families"), held: v.optional(v.string()), check: v.optional(v.string()), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { familyId, held, check, note }) => {
    const tokens = await ctx.db
      .query("gmailTokens")
      .withIndex("by_family", (q) => q.eq("familyId", familyId))
      .unique();
    if (tokens) await ctx.db.patch(tokens._id, { heldLabelId: held, checkLabelId: check, noteLabelId: note });
    return null;
  },
});

export const markActionApplied = internalMutation({
  args: { verdictId: v.id("verdicts") },
  returns: v.null(),
  handler: async (ctx, { verdictId }) => {
    if (await ctx.db.get(verdictId)) await ctx.db.patch(verdictId, { actionAppliedAt: Date.now() });
    return null;
  },
});

export const markAnswerApplied = internalMutation({
  args: { feedItemId: v.id("feedItems") },
  returns: v.null(),
  handler: async (ctx, { feedItemId }) => {
    if (await ctx.db.get(feedItemId)) await ctx.db.patch(feedItemId, { answerAppliedAt: Date.now() });
    return null;
  },
});

/**
 * Record a note we put in the parent's inbox AND mark what it was for, in one transaction, so
 * a retry can never find "note sent" without the watcher also knowing to skip that message.
 */
export const recordNote = internalMutation({
  args: {
    familyId: v.id("families"),
    gmailMessageId: v.string(),
    verdictId: v.optional(v.id("verdicts")),
    feedItemId: v.optional(v.id("feedItems")),
  },
  returns: v.null(),
  handler: async (ctx, { familyId, gmailMessageId, verdictId, feedItemId }) => {
    const family = await ctx.db.get(familyId);
    if (!family || family.status === "off") return null; // turned off meanwhile: leave nothing behind
    const known = await ctx.db
      .query("anchorNotes")
      .withIndex("by_family_message", (q) => q.eq("familyId", familyId).eq("gmailMessageId", gmailMessageId))
      .first();
    if (!known) await ctx.db.insert("anchorNotes", { familyId, gmailMessageId });
    if (verdictId && (await ctx.db.get(verdictId))) await ctx.db.patch(verdictId, { parentNoteSentAt: Date.now() });
    if (feedItemId && (await ctx.db.get(feedItemId))) await ctx.db.patch(feedItemId, { answerAppliedAt: Date.now() });
    return null;
  },
});

// ---------- Gmail steps ----------

type Labels = { held: string; check: string; note: string };

async function listLabels(accessToken: string) {
  const res = await gmailRequest<{ labels?: { id: string; name: string }[] }>(accessToken, "/labels");
  // Gmail label names are unique ignoring case.
  return new Map((res.labels ?? []).map((l) => [l.name.toLowerCase(), l.id]));
}

async function ensureLabels(ctx: ActionCtx, c: LabelContext, accessToken: string): Promise<Labels> {
  if (c.labels.held && c.labels.check && c.labels.note) return c.labels as Labels;
  const wanted: Labels = { held: HELD_LABEL, check: checkLabelName(c.family.kidName), note: NOTE_LABEL };
  let byName = await listLabels(accessToken);
  const ids: Partial<Labels> = {};
  for (const key of Object.keys(wanted) as (keyof Labels)[]) {
    const name = wanted[key];
    let id = byName.get(name.toLowerCase());
    if (!id) {
      try {
        id = (
          await gmailRequest<{ id: string }>(accessToken, "/labels", {
            method: "POST",
            body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
          })
        ).id;
      } catch (e) {
        // 409: it exists after all (another action just made it, or different case). Use it.
        if (!(e instanceof GmailError && e.status === 409)) throw e;
        byName = await listLabels(accessToken);
        id = byName.get(name.toLowerCase());
        if (!id) throw e;
      }
    }
    ids[key] = id;
  }
  await ctx.runMutation(internal.gmailActions.saveLabelIds, { familyId: c.family._id, ...(ids as Labels) });
  c.labels = ids as Labels;
  return ids as Labels;
}

async function modify(accessToken: string, messageId: string, add: string[], remove: string[]) {
  try {
    await gmailRequest(accessToken, `/messages/${encodeURIComponent(messageId)}/modify`, {
      method: "POST",
      body: { addLabelIds: add, removeLabelIds: remove },
    });
  } catch (e) {
    if (!(e instanceof GmailError && e.status === 404)) throw e; // deleted meanwhile: nothing to move
  }
}

/** Run Gmail steps that use our labels; if Gmail says a cached label is gone (400), re-create once. */
async function withLabels(ctx: ActionCtx, c: LabelContext, token: string, steps: (labels: Labels) => Promise<void>) {
  const usedCache = c.labels.held !== undefined && c.labels.check !== undefined && c.labels.note !== undefined;
  try {
    await steps(await ensureLabels(ctx, c, token));
  } catch (e) {
    if (!(e instanceof GmailError && e.status === 400 && usedCache)) throw e;
    await ctx.runMutation(internal.gmailActions.saveLabelIds, { familyId: c.family._id });
    c.labels = {};
    await steps(await ensureLabels(ctx, c, token));
  }
}

/** Put a plain-text note in the parent's inbox, exactly once per key. */
async function sendNote(
  ctx: ActionCtx,
  token: string,
  c: LabelContext,
  labels: Labels,
  note: { key: string; subject: string; lines: string[]; verdictId?: Id<"verdicts">; feedItemId?: Id<"feedItems"> },
) {
  const site = process.env.SITE_URL?.replace(/\/+$/, "");
  if (!site) throw new Error("SITE_URL is not set");
  // Already sent by an earlier attempt that failed afterwards? Then just record it.
  const existing = await gmailRequest<{ messages?: { id: string }[] }>(token, "/messages", {
    // Gmail's search takes the Message-ID without angle brackets.
    params: { q: `rfc822msgid:${noteMessageId(note.key).slice(1, -1)}`, includeSpamTrash: "true", maxResults: "1" },
  });
  let id = existing.messages?.[0]?.id;
  if (!id) {
    const replyTo = await ctx.runQuery(internal.gmailActions.kidEmailFor, { familyId: c.family._id });
    const raw = buildNote({
      messageId: note.key,
      to: c.family.parentEmail,
      kidName: c.family.kidName,
      subject: note.subject,
      lines: note.lines,
      parentPageUrl: `${site}/p/${c.family.parentToken}`,
      ...(replyTo && { replyTo }),
    });
    id = (
      await gmailRequest<{ id: string }>(token, "/messages", {
        method: "POST",
        params: { internalDateSource: "dateHeader" },
        body: { raw, labelIds: ["INBOX", "UNREAD", labels.note] },
        retry: false, // a 5xx may still have stored it: the search above catches that next time
      })
    ).id;
  }
  await ctx.runMutation(internal.gmailActions.recordNote, {
    familyId: c.family._id,
    gmailMessageId: id,
    ...(note.verdictId && { verdictId: note.verdictId }),
    ...(note.feedItemId && { feedItemId: note.feedItemId }),
  });
}

/** Run a Gmail step with one forced token refresh on 401. Returns false if it can't run now. */
async function withAccess(ctx: ActionCtx, familyId: Id<"families">, step: (token: string) => Promise<void>): Promise<boolean> {
  let access = await accessTokenFor(ctx, familyId);
  if (!access.ok) return false;
  try {
    await step(access.accessToken);
    return true;
  } catch (e) {
    if (!(e instanceof GmailError && e.status === 401)) throw e;
    access = await accessTokenFor(ctx, familyId, { force: true });
    if (!access.ok) return false;
    await step(access.accessToken);
    return true;
  }
}

/** Backoff before the next attempt (30 s, then 60 s), or null to give up. */
function nextDelay(attempt: number, what: string, why: string): number | null {
  if (attempt >= MAX_ATTEMPTS) {
    console.error(`gmailActions.${what} gave up after ${attempt} attempts: ${why}`);
    return null;
  }
  return 30_000 * 2 ** (attempt - 1);
}

const errorText = (e: unknown) => (e instanceof GmailError ? e.message : e instanceof Error ? e.name : "error");

// ---------- actions ----------

/** After a new flagged verdict: label or hold the email, quietly (no note). Idempotent. */
export const applyVerdict = internalAction({
  args: { verdictId: v.id("verdicts"), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { verdictId, attempt = 1 }) => {
    if (!actionsEnabled()) return null;
    const c: Context | null = await ctx.runQuery(internal.gmailActions.contextForVerdict, { verdictId });
    if (!c || c.family.status === "off" || c.verdict.level === "real") return null;
    if (c.feedItem?.kidAnswer) {
      // The kid already decided; applyAnswer handles it. If our hold already landed, make sure
      // the kid's answer is re-applied on top so it wins in Gmail.
      if (c.verdict.actionAppliedAt !== undefined) {
        await ctx.scheduler.runAfter(0, internal.gmailActions.applyAnswer, { feedItemId: c.feedItem._id, labelsOnly: true });
      }
      return null;
    }
    if (c.verdict.actionAppliedAt !== undefined) return null; // already done

    try {
      const ok = await withAccess(ctx, c.family._id, (token) =>
        withLabels(ctx, c, token, async (labels) => {
          if (c.verdict.level === "fake") await modify(token, c.verdict.gmailMessageId, [labels.held], ["INBOX"]);
          else await modify(token, c.verdict.gmailMessageId, [labels.check], []);
          await ctx.runMutation(internal.gmailActions.markActionApplied, { verdictId });
        }),
      );
      if (!ok) {
        const delay = nextDelay(attempt, "applyVerdict", "no Gmail access right now");
        if (delay !== null) await ctx.scheduler.runAfter(delay, internal.gmailActions.applyVerdict, { verdictId, attempt: attempt + 1 });
        return null;
      }
      // The kid may have answered while we were holding it: their answer must win in Gmail.
      const after: Context | null = await ctx.runQuery(internal.gmailActions.contextForVerdict, { verdictId });
      if (after?.feedItem?.kidAnswer) {
        await ctx.scheduler.runAfter(0, internal.gmailActions.applyAnswer, { feedItemId: after.feedItem._id, labelsOnly: true });
      }
    } catch (e) {
      const delay = nextDelay(attempt, "applyVerdict", errorText(e));
      if (delay !== null) await ctx.scheduler.runAfter(delay, internal.gmailActions.applyVerdict, { verdictId, attempt: attempt + 1 });
      // Even on failure: if the hold landed and the kid has answered meanwhile, their answer wins.
      const after: Context | null = await ctx.runQuery(internal.gmailActions.contextForVerdict, { verdictId });
      if (after?.feedItem?.kidAnswer && after.verdict.actionAppliedAt !== undefined) {
        await ctx.scheduler.runAfter(0, internal.gmailActions.applyAnswer, { feedItemId: after.feedItem._id, labelsOnly: true });
      }
    }
    return null;
  },
});

/**
 * After the kid answers: release or hold the email. If the kid wrote something, pass their
 * words to the parent in a short note; otherwise it stays quiet.
 * `labelsOnly` re-applies just the Gmail labels (when a hold landed after the answer).
 */
export const applyAnswer = internalAction({
  args: { feedItemId: v.id("feedItems"), attempt: v.optional(v.number()), labelsOnly: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { feedItemId, attempt = 1, labelsOnly }) => {
    if (!actionsEnabled()) return null;
    const ref = await ctx.runQuery(internal.gmailActions.contextForFeedItem, { feedItemId });
    if (!ref) return null;
    const c: Context | null = await ctx.runQuery(internal.gmailActions.contextForVerdict, { verdictId: ref.verdictId });
    const answer = c?.feedItem?.kidAnswer;
    if (!c || !answer || c.family.status === "off") return null;
    if (!labelsOnly && c.feedItem?.answerAppliedAt !== undefined) return null;

    const retry = async (why: string) => {
      const delay = nextDelay(attempt, "applyAnswer", why);
      if (delay !== null) {
        await ctx.scheduler.runAfter(delay, internal.gmailActions.applyAnswer, { feedItemId, attempt: attempt + 1, ...(labelsOnly && { labelsOnly }) });
      }
    };
    try {
      const ok = await withAccess(ctx, c.family._id, (token) =>
        withLabels(ctx, c, token, async (labels) => {
          if (answer.answer === "fine") await modify(token, c.verdict.gmailMessageId, ["INBOX"], [labels.held, labels.check]);
          else await modify(token, c.verdict.gmailMessageId, [labels.held], ["INBOX", labels.check]);
          if (labelsOnly) return;
          const kidWords = cleanKidNote(answer.note);
          // Quiet mode: no note unless the kid wrote one. But when the parent asked, they always
          // hear back, even if it's only "Lucas says it's fine".
          const asked = c.verdict.askedAt !== undefined;
          if (!kidWords && !asked) {
            await ctx.runMutation(internal.gmailActions.markAnswerApplied, { feedItemId });
            return;
          }
          const kid = c.family.kidName;
          const what =
            c.verdict.askedAt !== undefined
              ? "the message you asked about"
              : c.verdict.claimedOrg
                ? `the message that said it was from ${c.verdict.claimedOrg}`
                : "the message we asked about";
          const lines = [
            answer.answer === "fine"
              ? `${kid} looked at ${what} and says it's fine. It's back in your inbox.`
              : `${kid} looked at ${what} and says it's a scam. We moved it out of your inbox. You don't need to do anything.`,
            ...(kidWords ? [`${kid} says: "${kidWords}"`] : []),
          ];
          await sendNote(ctx, token, c, labels, {
            key: `answer-${feedItemId}`,
            subject: answer.answer === "fine" ? `${kid} says that message is fine` : `${kid} says that message is a scam`,
            lines,
            feedItemId,
          });
        }),
      );
      if (!ok) await retry("no Gmail access right now");
    } catch (e) {
      await retry(errorText(e));
    }
    return null;
  },
});

/** The investigator cleared an email (confirmed on the company's own site): put it back. */
export const releaseVerdict = internalAction({
  args: { verdictId: v.id("verdicts") },
  returns: v.null(),
  handler: async (ctx, { verdictId }) => {
    if (!actionsEnabled()) return null;
    const c: Context | null = await ctx.runQuery(internal.gmailActions.contextForVerdict, { verdictId });
    if (!c || c.family.status === "off" || c.feedItem?.kidAnswer || c.verdict.level !== "real") return null; // the kid's answer wins
    try {
      await withAccess(ctx, c.family._id, (token) =>
        withLabels(ctx, c, token, (labels) => modify(token, c.verdict.gmailMessageId, ["INBOX"], [labels.held, labels.check])),
      );
    } catch (e) {
      console.error(`gmailActions.releaseVerdict failed: ${errorText(e)}`);
    }
    return null;
  },
});

/** The kid's sign-in address, so the parent's reply to a note reaches them. */
export const kidEmailFor = internalQuery({
  args: { familyId: v.id("families") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { familyId }) => {
    const family = await ctx.db.get(familyId);
    const kid = family ? await ctx.db.get(family.kidUserId) : null;
    return kid?.email ?? null;
  },
});

// ---------- labels from day one ----------

export const labelsFor = internalQuery({
  args: { familyId: v.id("families") },
  returns: v.union(
    v.null(),
    v.object({ family: schema.doc("families"), labels: v.object({ held: v.optional(v.string()), check: v.optional(v.string()), note: v.optional(v.string()) }) }),
  ),
  handler: async (ctx, { familyId }) => {
    const family = await ctx.db.get(familyId);
    if (!family || family.status !== "active") return null;
    const tokens = await ctx.db.query("gmailTokens").withIndex("by_family", (q) => q.eq("familyId", familyId)).unique();
    return { family, labels: { held: tokens?.heldLabelId, check: tokens?.checkLabelId, note: tokens?.noteLabelId } };
  },
});

/**
 * Create the family's Gmail labels as soon as setup finishes, so "⚠ Check with [kid]" is there
 * for the parent to ask with from day one (not only after Anchor first flags an email).
 */
export const prepareLabels = internalAction({
  args: { familyId: v.id("families") },
  returns: v.null(),
  handler: async (ctx, { familyId }) => {
    if (!actionsEnabled()) return null;
    const found = await ctx.runQuery(internal.gmailActions.labelsFor, { familyId });
    if (!found || (found.labels.held && found.labels.check && found.labels.note)) return null;
    const c: LabelContext = { family: found.family, labels: found.labels };
    try {
      await withAccess(ctx, familyId, (token) => withLabels(ctx, c, token, async () => {}));
    } catch (e) {
      console.error(`gmailActions.prepareLabels failed: ${errorText(e)}`);
    }
    return null;
  },
});

// ---------- the weekly note (A9) ----------

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type HeldMail = { claimedOrg?: string; checks?: { id: string; detail?: string }[] };

/**
 * One plain thing to remember, from the tricks Anchor caught this week: the most dangerous
 * first (someone using a family member's name, then odd payments, then a company's name).
 * Fixed sentences, never model text, so it's always true and always calm.
 */
export function weeklyLesson(held: HeldMail[]): string | undefined {
  const details = held.flatMap((v) => (v.checks ?? []).map((c) => c.detail ?? ""));
  if (details.some((d) => d.startsWith("known contact's name") || d.startsWith("look-alike of a known contact"))) {
    return "if someone you know writes from a new address, call them on the number you already have before doing anything they ask.";
  }
  const signals = new Set(details.flatMap((d) => (/^signals: (.+)$/.exec(d)?.[1] ?? "").split(", ")));
  const paidIn = signals.has("gift_card") ? "gift cards" : signals.has("wire") ? "wire transfers" : signals.has("crypto") ? "cryptocurrency" : null;
  if (paidIn) return `no real person or company asks to be paid in ${paidIn}. If anyone does, it's a scam, even if it seems to come from family.`;
  const counts = new Map<string, number>();
  for (const v of held) if (v.claimedOrg) counts.set(v.claimedOrg, (counts.get(v.claimedOrg) ?? 0) + 1);
  const brand = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (brand) return `scammers pretended to be ${brand} this week. To check on an account, use the button on your Anchor page, not a link in an email.`;
  return undefined;
}

export const weekStats = internalQuery({
  args: { familyId: v.id("families"), since: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      family: schema.doc("families"),
      labels: v.object({ held: v.optional(v.string()), check: v.optional(v.string()), note: v.optional(v.string()) }),
      checked: v.number(),
      held: v.number(),
      kidLooked: v.number(),
      lesson: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { familyId, since }) => {
    const family = await ctx.db.get(familyId);
    if (!family || family.status !== "active") return null;
    const tokens = await ctx.db.query("gmailTokens").withIndex("by_family", (q) => q.eq("familyId", familyId)).unique();
    const verdicts = await ctx.db
      .query("verdicts")
      .withIndex("by_family_received", (q) => q.eq("familyId", familyId).gte("receivedAt", since))
      .take(5000);
    const items = await ctx.db
      .query("feedItems")
      .withIndex("by_family_created", (q) => q.eq("familyId", familyId).gte("createdAt", since))
      .take(1000);
    const held = verdicts.filter((x) => x.action === "held");
    const lesson = weeklyLesson(held);
    return {
      family,
      labels: { held: tokens?.heldLabelId, check: tokens?.checkLabelId, note: tokens?.noteLabelId },
      checked: verdicts.length,
      held: held.length,
      kidLooked: items.filter((i) => i.kidAnswer).length,
      ...(lesson !== undefined && { lesson }),
    };
  },
});

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One calm summary for the parent, at most once per week (the note key dedupes). */
export const sendWeeklyNote = internalAction({
  args: { familyId: v.id("families") },
  returns: v.null(),
  handler: async (ctx, { familyId }) => {
    if (!actionsEnabled()) return null;
    const now = Date.now();
    const stats = await ctx.runQuery(internal.gmailActions.weekStats, { familyId, since: now - WEEK_MS });
    if (!stats || stats.checked === 0) return null; // nothing happened: say nothing
    const c: LabelContext = { family: stats.family, labels: stats.labels };
    const kid = stats.family.kidName;
    const lines = [
      stats.held > 0
        ? `This week Anchor checked ${plural(stats.checked, "email", "emails")} for you and kept ${plural(stats.held, "fake message", "fake messages")} out of your inbox. You didn't need to do anything.`
        : `This week Anchor checked ${plural(stats.checked, "email", "emails")} for you. Nothing fake got through, and you didn't need to do anything.`,
    ];
    if (stats.kidLooked > 0) lines.push(`${kid} looked at ${plural(stats.kidLooked, "message", "messages")} for you.`);
    if (stats.lesson) lines.push(`One thing to remember: ${stats.lesson}`);
    lines.push(`Not sure about an email? Move it to the "⚠ Check with ${kid}" folder, and ${kid} will look at it for you.`);
    if (stats.held > 0) lines.push(`If you ever want to see them, they're in the "Anchor: Held" folder.`);
    const week = Math.floor(now / WEEK_MS);
    try {
      await withAccess(ctx, familyId, (token) =>
        withLabels(ctx, c, token, (labels) =>
          sendNote(ctx, token, c, labels, {
            key: `weekly-${familyId}-${week}`,
            subject: stats.held > 0 ? `This week: ${plural(stats.held, "fake message", "fake messages")} kept away from you` : "Your week with Anchor",
            lines,
          }),
        ),
      );
    } catch (e) {
      console.error(`gmailActions.sendWeeklyNote failed: ${errorText(e)}`);
    }
    return null;
  },
});

/** Cron: once a week, schedule each active family's note. */
export const weeklyNotes = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!actionsEnabled()) return null;
    const families = await ctx.db.query("families").withIndex("by_status", (q) => q.eq("status", "active")).take(500);
    for (const f of families) await ctx.scheduler.runAfter(0, internal.gmailActions.sendWeeklyNote, { familyId: f._id });
    return null;
  },
});
