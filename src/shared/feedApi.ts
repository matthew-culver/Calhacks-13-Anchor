// Stand-ins for Person A's feed functions (A5/A6), backed by mock data until they exist.
// Each hook has the shape the real one will have, so swapping is one line per hook:
//   useFeed()           -> useQuery(api.feed.myFeed)
//   useAnswerFeedItem() -> useMutation(api.feed.answer)
// The real feed only ever holds unsure or fake mail; the kid never sees real email.

import { useSyncExternalStore } from "react";
import type { FeedItem, Verdict } from "../../convex/contract";
import { mockFeed, mockVerdicts, type Row } from "./mock";

/** One feed card: the feed item plus the verdict it points at. */
export type FeedEntry = Row<FeedItem, "feedItems"> & { verdict: Row<Verdict, "verdicts"> };

export type Answer = { feedItemId: FeedEntry["_id"]; answer: "fine" | "scam"; note?: string };

export const MAX_NOTE = 280;

function fromMock(): FeedEntry[] {
  return mockFeed.flatMap((item) => {
    const verdict = mockVerdicts.find((v) => v._id === item.verdictId);
    return verdict ? [{ ...item, verdict }] : [];
  });
}

let entries = fromMock();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getEntries = () => entries;

/** Newest first. `undefined` while loading, like useQuery. */
export function useFeed(): FeedEntry[] | undefined {
  return useSyncExternalStore(subscribe, getEntries, getEntries);
}

/** Records the kid's answer. The real mutation also releases or holds the email and tells the parent. */
export function useAnswerFeedItem(): (args: Answer) => Promise<null> {
  return async ({ feedItemId, answer, note }) => {
    const trimmed = note?.trim().slice(0, MAX_NOTE);
    entries = entries.map((e) =>
      e._id === feedItemId && !e.kidAnswer
        ? { ...e, kidAnswer: { answer, ...(trimmed ? { note: trimmed } : {}), answeredAt: Date.now() } }
        : e,
    );
    listeners.forEach((l) => l());
    return null;
  };
}

/** Tests only: put the mock feed back the way it started. */
export function resetMockFeed() {
  entries = fromMock();
  listeners.forEach((l) => l());
}
