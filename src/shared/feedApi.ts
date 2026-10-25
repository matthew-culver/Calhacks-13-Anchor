// The kid's feed. Live from Person A's api.feed.myFeed (A5), or the sample emails in demo mode.
// Only unsure or fake mail ever reaches the feed; the kid never sees real email.
//
// Answers: there's no api.feed.answer yet (A6). Until it lands, answers are kept in this
// browser and laid over the feed, so the screens behave as they will. Then swap the body of
// useAnswerFeedItem for `return useMutation(api.feed.answer)` and drop the overlay.

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useSyncExternalStore } from "react";
import { api } from "../../convex/_generated/api";
import { useDemoMode } from "./demoMode";
import { mockFeed, mockVerdicts } from "./mock";

/** One feed card, exactly as api.feed.myFeed returns it. */
export type FeedEntry = FunctionReturnType<typeof api.feed.myFeed>[number];
type KidAnswer = NonNullable<FeedEntry["kidAnswer"]>;

export type Answer = { feedItemId: FeedEntry["_id"]; answer: "fine" | "scam"; note?: string };

export const MAX_NOTE = 280;

/** The sample emails, trimmed to the same shape myFeed returns. */
function sampleFeed(): FeedEntry[] {
  return mockFeed.flatMap((item) => {
    const v = mockVerdicts.find((x) => x._id === item.verdictId);
    if (!v) return [];
    const { level, receivedAt, fromName, fromAddress, subject, claimedOrg, checks } = v;
    const { explanationForParent, explanationForKid } = v;
    return [
      {
        _id: item._id,
        kind: item.kind,
        createdAt: item.createdAt,
        ...(item.kidAnswer && { kidAnswer: item.kidAnswer }),
        verdict: { level, receivedAt, fromName, fromAddress, subject, claimedOrg, checks, explanationForParent, explanationForKid },
      },
    ];
  });
}
export const SAMPLE_FEED = sampleFeed();

// Answers given in this browser, by feed item id.
let answers: Record<string, KidAnswer> = {};
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getAnswers = () => answers;

/** Newest first. `undefined` while loading, like useQuery. */
export function useFeed(): FeedEntry[] | undefined {
  const demo = useDemoMode();
  const live = useQuery(api.feed.myFeed, demo ? "skip" : {});
  const local = useSyncExternalStore(subscribe, getAnswers, getAnswers);
  const base = demo ? SAMPLE_FEED : live;
  if (base === undefined) return undefined;
  return base.map((e) => (e.kidAnswer || !local[e._id] ? e : { ...e, kidAnswer: local[e._id] }));
}

/** Records the kid's answer. The real mutation will also release or hold the email and tell the parent. */
export function useAnswerFeedItem(): (args: Answer) => Promise<null> {
  return async ({ feedItemId, answer, note }) => {
    if (answers[feedItemId]) return null; // the first answer stands
    const trimmed = note?.trim().slice(0, MAX_NOTE);
    answers = { ...answers, [feedItemId]: { answer, ...(trimmed ? { note: trimmed } : {}), answeredAt: Date.now() } };
    listeners.forEach((l) => l());
    return null;
  };
}

/** Tests only: forget answers given in this browser. */
export function resetMockFeed() {
  answers = {};
  listeners.forEach((l) => l());
}
