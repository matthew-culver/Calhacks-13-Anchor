// A6: act on verdicts inside the parent's Gmail, and tell the parent in plain words.
//   fake   → "Anchor: Held" label, out of the inbox, plus a short note in the inbox
//   unsure → "⚠ Check with [kid]" label (stays in the inbox), plus a note
//   kid says "It's fine"   → back in the inbox, labels removed, note to the parent
//   kid says "It's a scam" → held, note to the parent with the kid's words
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

type Context = {
  verdict: Doc<"verdicts">;
  family: Doc<"families">;
  labels: { held?: string; check?: string; note?: string };
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

async function ensureLabels(ctx: ActionCtx, c: Context, accessToken: string): Promise<Labels> {
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
async function withLabels(ctx: ActionCtx, c: Context, token: string, steps: (labels: Labels) => Promise<void>) {
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
  c: Context,
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
    const raw = buildNote({
      messageId: note.key,
      to: c.family.parentEmail,
      kidName: c.family.kidName,
      subject: note.subject,
      lines: note.lines,
      parentPageUrl: `${site}/p/${c.family.parentToken}`,
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

/** After a new flagged verdict: label or hold the email, then tell the parent. Idempotent. */
export const applyVerdict = internalAction({
  args: { verdictId: v.id("verdicts"), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { verdictId, attempt = 1 }) => {
    if (!actionsEnabled()) return null;
    const c: Context | null = await ctx.runQuery(internal.gmailActions.contextForVerdict, { verdictId });
    if (!c || c.family.status === "off" || c.verdict.level === "real") return null;
    if (c.verdict.actionAppliedAt !== undefined && c.verdict.parentNoteSentAt !== undefined) return null;
    if (c.feedItem?.kidAnswer) {
      // The kid already decided; applyAnswer handles it. If our hold already landed, make sure
      // the kid's answer is re-applied on top so it wins in Gmail.
      if (c.verdict.actionAppliedAt !== undefined) {
        await ctx.scheduler.runAfter(0, internal.gmailActions.applyAnswer, { feedItemId: c.feedItem._id, labelsOnly: true });
      }
      return null;
    }

    try {
      const ok = await withAccess(ctx, c.family._id, (token) =>
        withLabels(ctx, c, token, async (labels) => {
          if (c.verdict.actionAppliedAt === undefined) {
            if (c.verdict.level === "fake") await modify(token, c.verdict.gmailMessageId, [labels.held], ["INBOX"]);
            else await modify(token, c.verdict.gmailMessageId, [labels.check], []);
            await ctx.runMutation(internal.gmailActions.markActionApplied, { verdictId });
          }
          if (c.verdict.parentNoteSentAt === undefined) {
            const org = c.verdict.claimedOrg; // from our own brand list, never the sender's text
            await sendNote(ctx, token, c, labels, {
              key: `verdict-${verdictId}`,
              subject: c.verdict.level === "fake" ? `We held a message pretending to be ${org ?? "someone you know"}` : `We asked ${c.family.kidName} about a message`,
              lines: [c.verdict.explanationForParent ?? ""],
              verdictId,
            });
          }
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
 * After the kid answers: release or hold the email, then pass the kid's words to the parent.
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
          const kid = c.family.kidName;
          const what = c.verdict.claimedOrg ? `the message that said it was from ${c.verdict.claimedOrg}` : "the message we asked about";
          const kidWords = cleanKidNote(answer.note);
          const lines =
            answer.answer === "fine"
              ? [`${kid} looked at ${what} and says it's fine. It's back in your inbox.`]
              : [`${kid} looked at ${what} and says it's a scam. We moved it out of your inbox. You don't need to do anything.`];
          if (kidWords) lines.push(`${kid} says: "${kidWords}"`);
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
    if (!c || c.family.status === "off") return null;
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
