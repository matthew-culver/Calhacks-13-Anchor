// Puts the fake backend in the state most screen tests start from: a signed-in kid whose
// parent is connected, with A4's accounts and A5's feed and recap. Tests then change one thing.

import { ConvexError } from "convex/values";
import { vi } from "vitest";
import { SAMPLE_FEED, type Answer, type FeedEntry } from "@/shared/feedApi";
import { mockAccounts, mockRecap } from "@/shared/mock";
import { fakeBackend } from "./fakeBackend";

/** Behaves like A6's api.feed.answer: saves the answer on the live feed, refuses a second one. */
function fakeAnswer() {
  return vi.fn(async (args?: unknown) => {
    const { feedItemId, answer, note } = args as Answer;
    const feed = fakeBackend.state.queries["feed:myFeed"] as FeedEntry[];
    const item = feed.find((e) => e._id === feedItemId);
    if (!item) throw new ConvexError("We couldn't find that message.");
    if (item.kidAnswer) throw new ConvexError("You already answered this one.");
    const trimmed = note?.trim();
    const kidAnswer = { answer, ...(trimmed ? { note: trimmed } : {}), answeredAt: Date.now() };
    fakeBackend.setQuery("feed:myFeed", feed.map((e) => (e === item ? { ...e, kidAnswer } : e)));
    return null;
  });
}

export const kidFamily = (status = "active") => ({
  _id: "fam1",
  parentName: "Mom",
  parentEmail: "mom@gmail.com",
  kidName: "Lucas",
  status,
});

export function seedSignedInKid() {
  fakeBackend.set({ isAuthenticated: true });
  fakeBackend.setQuery("families:getMyFamily", kidFamily());
  fakeBackend.setQuery("accounts:myAccounts", mockAccounts);
  fakeBackend.setQuery("feed:myFeed", SAMPLE_FEED);
  fakeBackend.setQuery("feed:myWeeklyRecap", mockRecap);
  fakeBackend.mutations["feed:answer"] = fakeAnswer();
}

export function seedParent(status = "active") {
  fakeBackend.setQuery("families:getParentView", { parentName: "Mom", kidName: "Lucas", status });
  fakeBackend.setQuery("accounts:parentAccounts", mockAccounts);
}
