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

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { accessTokenFor } from "./googleAuth";
import { GmailError, gmailRequest } from "./lib/gmailApi";
import { buildNote, cleanKidNote } from "./lib/parentNote";
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

export const saveLabelIds = internalMutation({
  args: { familyId: v.id("families"), held: v.string(), check: v.string(), note: v.string() },
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

export const markVerdict = internalMutation({
  args: { verdictId: v.id("verdicts"), actionApplied: v.optional(v.boolean()), noteSent: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { verdictId, actionApplied, noteSent }) => {
    const verdict = await ctx.db.get(verdictId);
    if (!verdict) return null;
    await ctx.db.patch(verdictId, {
      ...(actionApplied && { actionAppliedAt: Date.now() }),
      ...(noteSent && { parentNoteSentAt: Date.now() }),
    });
    return null;
  },
});

export const recordNote = internalMutation({
  args: { familyId: v.id("families"), gmailMessageId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("anchorNotes", args);
    return null;
  },
});

export const markAnswerApplied = internalMutation({
  args: { feedItemId: v.id("feedItems") },
  returns: v.null(),
  handler: async (ctx, { feedItemId }) => {
    const item = await ctx.db.get(feedItemId);
    if (item) await ctx.db.patch(feedItemId, { answerAppliedAt: Date.now() });
    return null;
  },
});

// ---------- Gmail steps ----------

type Labels = { held: string; check: string; note: string };

async function ensureLabels(ctx: ActionCtx, c: Context, accessToken: string): Promise<Labels> {
  if (c.labels.held && c.labels.check && c.labels.note) return c.labels as Labels;
  const wanted = { held: HELD_LABEL, check: checkLabelName(c.family.kidName), note: NOTE_LABEL };
  const existing = await gmailRequest<{ labels?: { id: string; name: string }[] }>(accessToken, "/labels");
  const byName = new Map((existing.labels ?? []).map((l) => [l.name, l.id]));
  const ids: Partial<Labels> = {};
  for (const [key, name] of Object.entries(wanted) as [keyof Labels, string][]) {
    ids[key] =
      byName.get(name) ??
      (
        await gmailRequest<{ id: string }>(accessToken, "/labels", {
          method: "POST",
          body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
        })
      ).id;
  }
  await ctx.runMutation(internal.gmailActions.saveLabelIds, { familyId: c.family._id, ...(ids as Labels) });
  return ids as Labels;
}

async function modify(accessToken: string, messageId: string, add: string[], remove: string[]) {
  await gmailRequest(accessToken, `/messages/${encodeURIComponent(messageId)}/modify`, {
    method: "POST",
    body: { addLabelIds: add, removeLabelIds: remove },
  });
}

async function insertNote(ctx: ActionCtx, accessToken: string, c: Context, labels: Labels, subject: string, lines: string[]) {
  const site = process.env.SITE_URL?.replace(/\/+$/, "") ?? "";
  const raw = buildNote({
    to: c.family.parentEmail,
    kidName: c.family.kidName,
    subject,
    lines,
    parentPageUrl: `${site}/p/${c.family.parentToken}`,
  });
  const inserted = await gmailRequest<{ id: string }>(accessToken, "/messages", {
    method: "POST",
    params: { internalDateSource: "dateHeader" },
    body: { raw, labelIds: ["INBOX", "UNREAD", labels.note] },
  });
  await ctx.runMutation(internal.gmailActions.recordNote, { familyId: c.family._id, gmailMessageId: inserted.id });
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

async function retryVerdict(ctx: ActionCtx, verdictId: Id<"verdicts">, attempt: number, why: string) {
  const delay = nextDelay(attempt, "applyVerdict", why);
  if (delay !== null) await ctx.scheduler.runAfter(delay, internal.gmailActions.applyVerdict, { verdictId, attempt: attempt + 1 });
}

async function retryAnswer(ctx: ActionCtx, feedItemId: Id<"feedItems">, attempt: number, why: string) {
  const delay = nextDelay(attempt, "applyAnswer", why);
  if (delay !== null) await ctx.scheduler.runAfter(delay, internal.gmailActions.applyAnswer, { feedItemId, attempt: attempt + 1 });
}

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
    if (c.feedItem?.kidAnswer) return null; // the kid already decided; applyAnswer handles it

    try {
      const ok = await withAccess(ctx, c.family._id, async (token) => {
        const labels = await ensureLabels(ctx, c, token);
        if (c.verdict.actionAppliedAt === undefined) {
          try {
            if (c.verdict.level === "fake") await modify(token, c.verdict.gmailMessageId, [labels.held], ["INBOX"]);
            else await modify(token, c.verdict.gmailMessageId, [labels.check], []);
          } catch (e) {
            if (!(e instanceof GmailError && e.status === 404)) throw e; // deleted meanwhile: nothing to move
          }
          await ctx.runMutation(internal.gmailActions.markVerdict, { verdictId, actionApplied: true });
        }
        if (c.verdict.parentNoteSentAt === undefined) {
          const subject =
            c.verdict.level === "fake"
              ? `We held a message pretending to be ${c.verdict.claimedOrg ?? "someone you know"}`
              : `We asked ${c.family.kidName} about a message`;
          await insertNote(ctx, token, c, labels, subject, [c.verdict.explanationForParent ?? ""]);
          await ctx.runMutation(internal.gmailActions.markVerdict, { verdictId, noteSent: true });
        }
      });
      if (!ok) await retryVerdict(ctx, verdictId, attempt, "no Gmail access right now");
    } catch (e) {
      await retryVerdict(ctx, verdictId, attempt, e instanceof Error ? e.message : "error");
    }
    return null;
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

/** After the kid answers: release or hold the email, then pass the kid's words to the parent. */
export const applyAnswer = internalAction({
  args: { feedItemId: v.id("feedItems"), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { feedItemId, attempt = 1 }) => {
    if (!actionsEnabled()) return null;
    const ref = await ctx.runQuery(internal.gmailActions.contextForFeedItem, { feedItemId });
    if (!ref) return null;
    const c: Context | null = await ctx.runQuery(internal.gmailActions.contextForVerdict, { verdictId: ref.verdictId });
    const answer = c?.feedItem?.kidAnswer;
    if (!c || !answer || c.family.status === "off" || c.feedItem?.answerAppliedAt !== undefined) return null;

    try {
      const ok = await withAccess(ctx, c.family._id, async (token) => {
        const labels = await ensureLabels(ctx, c, token);
        try {
          if (answer.answer === "fine") await modify(token, c.verdict.gmailMessageId, ["INBOX"], [labels.held, labels.check]);
          else await modify(token, c.verdict.gmailMessageId, [labels.held], ["INBOX", labels.check]);
        } catch (e) {
          if (!(e instanceof GmailError && e.status === 404)) throw e;
        }
        const from = c.verdict.fromName || c.verdict.claimedOrg || "a sender";
        const kidWords = cleanKidNote(answer.note);
        const subject = answer.answer === "fine" ? `${c.family.kidName} says that message is fine` : `${c.family.kidName} says that message is a scam`;
        const lines =
          answer.answer === "fine"
            ? [`${c.family.kidName} looked at the message from "${from}" and says it's fine. It's back in your inbox.`]
            : [`${c.family.kidName} looked at the message from "${from}" and says it's a scam. We moved it out of your inbox. You don't need to do anything.`];
        if (kidWords) lines.push(`${c.family.kidName} says: "${kidWords}"`);
        await insertNote(ctx, token, c, labels, subject, lines);
        await ctx.runMutation(internal.gmailActions.markAnswerApplied, { feedItemId });
      });
      if (!ok) await retryAnswer(ctx, feedItemId, attempt, "no Gmail access right now");
    } catch (e) {
      await retryAnswer(ctx, feedItemId, attempt, e instanceof Error ? e.message : "error");
    }
    return null;
  },
});
