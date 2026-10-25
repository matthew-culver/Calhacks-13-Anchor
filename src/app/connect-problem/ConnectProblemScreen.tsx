"use client";

import { Screen } from "@/components/ui";
import { useRememberedKidName } from "@/shared/kidName";
import type { ConnectProblem } from "../../../convex/lib/oauth";

// Where Person A's /gmail/callback sends the parent when connecting didn't work.
// One plain sentence and one next step per reason (wording from TASKS.md B2).
// The reason only picks the words; nothing else is read from the URL.

type Words = { title: string; body: (kid: string) => string };

// Keyed by Person A's ConnectProblem, so a new reason doesn't compile until it has words.
const WORDS: Record<ConnectProblem, Words> = {
  invite_invalid: {
    title: "This link was already used",
    body: (kid) => `Ask ${kid} for a new one.`,
  },
  invite_expired: {
    title: "This link is too old",
    body: (kid) => `Ask ${kid} to send you a new one.`,
  },
  cancelled: {
    title: "No problem",
    body: () => "Nothing was changed. Tap the link again when you're ready.",
  },
  session: {
    title: "That took a little too long",
    body: () => "Please tap the link again.",
  },
  wrong_account: {
    title: "That was a different Google account",
    body: (kid) => `Tap the link again and pick the Gmail address ${kid} set up.`,
  },
  missing_permission: {
    title: "Anchor needs your OK to sort your email",
    body: () => "Tap the link again and leave the box checked.",
  },
  already_protected: {
    title: "This Gmail is already protected",
    body: () => "Anchor is already watching it. You don't need to do anything.",
  },
  google_error: {
    title: "Google had a hiccup",
    body: () => "Please try the link again in a minute.",
  },
};

export const PROBLEM_REASONS = Object.keys(WORDS) as ConnectProblem[];

const isProblem = (reason: string | undefined): reason is ConnectProblem =>
  reason !== undefined && Object.hasOwn(WORDS, reason);

export function ConnectProblemScreen({ reason }: { reason: string | undefined }) {
  const kidName = useRememberedKidName();
  const words = WORDS[isProblem(reason) ? reason : "google_error"];
  return (
    <Screen title={words.title}>
      <p className="text-xl">{words.body(kidName ?? "the person who sent you the link")}</p>
    </Screen>
  );
}
