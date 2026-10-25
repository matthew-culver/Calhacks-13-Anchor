"use client";

import { Screen } from "@/components/ui";
import { useRememberedKidName } from "@/shared/kidName";

// Where Person A's /gmail/callback sends the parent when connecting didn't work.
// One plain sentence and one next step per reason (wording from TASKS.md B2).
// The reason only picks the words; nothing else is read from the URL.

type Words = { title: string; body: (kid: string) => string };

const WORDS: Record<string, Words> = {
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

export function ConnectProblemScreen({ reason }: { reason: string | undefined }) {
  const kidName = useRememberedKidName();
  const words = (reason && Object.hasOwn(WORDS, reason) ? WORDS[reason] : undefined) ?? WORDS.google_error;
  return (
    <Screen title={words.title}>
      <p className="text-xl">{words.body(kidName ?? "the person who sent you the link")}</p>
    </Screen>
  );
}
