// Puts the fake backend in the state most screen tests start from: a signed-in kid whose
// parent is connected, with A4's accounts and A5's feed and recap. Tests then change one thing.

import { SAMPLE_FEED } from "@/shared/feedApi";
import { mockAccounts, mockRecap } from "@/shared/mock";
import { fakeBackend } from "./fakeBackend";

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
}

export function seedParent(status = "active") {
  fakeBackend.setQuery("families:getParentView", { parentName: "Mom", kidName: "Lucas", status });
  fakeBackend.setQuery("accounts:parentAccounts", mockAccounts);
}
