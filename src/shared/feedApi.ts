// The kid's feed. Live from Person A's api.feed.myFeed and api.feed.answer (A5, A6), or the
// sample emails in demo mode. Only unsure or fake mail ever reaches the feed; the kid never
// sees real email.

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useSyncExternalStore } from "react";
import { api } from "../../convex/_generated/api";
import { useDemoMode } from "./demoMode";
import { mockFeed, mockVerdicts } from "./mock";

/** One feed card, exactly as api.feed.myFeed returns it: the feed item with its verdict. */
export type FeedEntry = FunctionReturnType<typeof api.feed.myFeed>[number];
type KidAnswer = NonNullable<FeedEntry["kidAnswer"]>;

/** `trustSender` (with "fine"): always trust this sender, like family (A7). */
export type Answer = { feedItemId: FeedEntry["_id"]; answer: "fine" | "scam"; note?: string; trustSender?: boolean };

/** The note box's limit. The server trims and caps notes itself; this just matches it. */
export const MAX_NOTE = 280;

/** The sample emails, in the same shape myFeed returns. */
export const SAMPLE_FEED: FeedEntry[] = mockFeed.flatMap((item) => {
  const verdict = mockVerdicts.find((v) => v._id === item.verdictId);
  return verdict ? [{ ...item, verdict }] : [];
});

// Demo mode only: answers given in this tab, by feed item id, laid over the sample feed. Kept
// for the tab, so the parent's sample page (a full page load away) shows them too.
const ANSWERS_KEY = "anchor.demoAnswers";
const NO_ANSWERS: Record<string, KidAnswer> = {};
let demoAnswers: Record<string, KidAnswer> | null = null; // read from the tab on first use
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
function getDemoAnswers(): Record<string, KidAnswer> {
  if (demoAnswers === null) {
    try {
      demoAnswers = JSON.parse(sessionStorage.getItem(ANSWERS_KEY) ?? "{}") as Record<string, KidAnswer>;
    } catch {
      demoAnswers = {};
    }
  }
  return demoAnswers;
}
const noAnswers = () => NO_ANSWERS;

async function answerInDemo({ feedItemId, answer, note }: Answer): Promise<null> {
  const answers = getDemoAnswers();
  if (answers[feedItemId]) return null; // the first answer stands
  const trimmed = note?.trim().slice(0, MAX_NOTE);
  demoAnswers = { ...answers, [feedItemId]: { answer, ...(trimmed ? { note: trimmed } : {}), answeredAt: Date.now() } };
  try {
    sessionStorage.setItem(ANSWERS_KEY, JSON.stringify(demoAnswers));
  } catch {
    // Blocked storage: the answer lasts until the page reloads.
  }
  listeners.forEach((l) => l());
  return null;
}

const withAnswers = (answers: Record<string, KidAnswer>): FeedEntry[] =>
  SAMPLE_FEED.map((e) => (e.kidAnswer || !answers[e._id] ? e : { ...e, kidAnswer: answers[e._id] }));

/** Newest first. `undefined` while loading, like useQuery. */
export function useFeed(): FeedEntry[] | undefined {
  const demo = useDemoMode();
  const live = useQuery(api.feed.myFeed, demo ? "skip" : {});
  const local = useSyncExternalStore(subscribe, getDemoAnswers, noAnswers);
  return demo ? withAnswers(local) : live;
}

/** The sample emails with the answers given in this tab: what the parent's sample page shows. */
export function useSampleFeed(): FeedEntry[] {
  return withAnswers(useSyncExternalStore(subscribe, getDemoAnswers, noAnswers));
}

/**
 * Records the kid's answer. Live, api.feed.answer also releases or holds the email in Gmail
 * and sends the kid's note to the parent; its errors are ConvexErrors with plain messages
 * ("You already answered this one.").
 */
export function useAnswerFeedItem(): (args: Answer) => Promise<null> {
  const demo = useDemoMode();
  const live = useMutation(api.feed.answer);
  return demo ? answerInDemo : live;
}

/** Tests only: forget answers given in demo mode. */
export function resetMockFeed() {
  demoAnswers = {};
  sessionStorage.removeItem(ANSWERS_KEY);
  listeners.forEach((l) => l());
}
