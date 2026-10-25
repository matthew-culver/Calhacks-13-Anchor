"use client";

import { useQuery } from "convex/react";
import { ParentAccountList } from "@/components/AccountList";
import { SampleDataNote } from "@/components/KidGate";
import { ParentRecapCard } from "@/components/RecapCard";
import { useClientNow } from "@/components/TimeAgo";
import { TurnOff } from "@/components/TurnOff";
import { Screen } from "@/components/ui";
import { useDemoMode } from "@/shared/demoMode";
import { mockRecap } from "@/shared/mock";
import { useSampleImport } from "@/shared/sampleImport";
import { api } from "../../../../convex/_generated/api";

const MIN = 60 * 1000;
const SAMPLE_VIEW = { parentName: "Mom", kidName: "Lucas", status: "active" as const };

// The parent's "front door" (B8), opened from the link in their Gmail note. Big text: this
// week's recap, their accounts as big sign-in buttons grouped and most important first, the
// right words for every state of their protection, and "Turn it off". Demo mode replays a
// sample import so the accounts can be seen arriving and re-sorting.
export function ParentScreen({ token, justConnected }: { token: string; justConnected?: boolean }) {
  const demo = useDemoMode();
  const liveView = useQuery(api.families.getParentView, demo ? "skip" : { parentToken: token });
  // Also right after connecting: the done screen shows the accounts arriving live (B10).
  const liveAccounts = useQuery(api.accounts.parentAccounts, demo ? "skip" : { parentToken: token });
  // Rounded to the minute so the recap subscription isn't recreated on every render.
  const now = useClientNow();
  const liveRecap = useQuery(
    api.feed.parentWeeklyRecap,
    demo || justConnected || now === null ? "skip" : { parentToken: token, now: Math.floor(now / MIN) * MIN },
  );
  const sample = useSampleImport(demo);

  const view = demo ? SAMPLE_VIEW : liveView;
  const accounts = demo ? sample.accounts : liveAccounts;
  const recap = demo ? mockRecap : liveRecap;
  const family = view?.kidName ?? "your family";

  // Person A's /gmail/callback lands here with ?connected=1 after Google says yes. Below the
  // reassurance, Mom watches her accounts appear and sort themselves as the import runs (B10):
  // "we didn't type any of this".
  if (justConnected) {
    const found = accounts ?? [];
    // Still importing until the status says otherwise (and while it hasn't loaded yet).
    const finding = demo ? !sample.done : view === undefined || view?.status === "learning";
    return (
      <Screen title="You're done">
        <p className="text-xl">You don&apos;t need to do anything else.</p>
        <p className="text-lg text-muted">
          {`We'll quietly set aside scam emails, and ${family} hears about anything we're not sure of.`}
        </p>
        {demo && <SampleDataNote />}
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold">Your accounts</h2>
          <p role="status" className="text-lg">
            {finding
              ? found.length === 0
                ? "Finding the places you use…"
                : "Still finding more…"
              : found.length === 0
                ? "We didn't find any yet. We'll keep looking."
                : "These are the real websites you use. Whenever you need one, tap it to sign in."}
          </p>
          {found.length > 0 && <ParentAccountList accounts={found} />}
        </section>
      </Screen>
    );
  }

  if (view === undefined || accounts === undefined) {
    return <Screen focusTitle title="One moment..." />;
  }
  if (view === null) {
    return (
      <Screen focusTitle title="This link doesn't work">
        <p className="text-xl">Ask the person who set up Anchor for you to send a new one.</p>
      </Screen>
    );
  }

  const { parentName, kidName, status } = view;
  const turnOff = demo ? null : <TurnOff parentToken={token} kidName={kidName} />;
  if (status === "off") {
    return (
      <Screen focusTitle title="Protection is off">
        <p className="text-xl">
          Anchor isn&apos;t watching your email anymore, and we deleted what we had learned.
        </p>
      </Screen>
    );
  }
  if (status === "needs_reconnect" || status === "invited") {
    return (
      <Screen focusTitle title="Anchor needs your OK">
        <p className="text-xl">{`Tap the link ${kidName} sends you. It takes one tap.`}</p>
        {turnOff}
      </Screen>
    );
  }
  if (accounts.length === 0) {
    // While the history is read ("learning"), or a connected inbox with nothing to list yet.
    // A different title from the list's, so focus moves (and is announced) when it fills in.
    return (
      <Screen focusTitle title="Getting your accounts ready">
        {demo && <SampleDataNote />}
        <p className="text-xl">
          We&apos;re still learning which places you deal with. This page fills in on its own.
        </p>
        {turnOff}
      </Screen>
    );
  }

  // Accounts arrive in batches while the import runs (A8), so say it isn't finished yet.
  const stillFinding = demo ? !sample.done : status === "learning";
  return (
    <Screen focusTitle title="Your accounts">
      {demo && <SampleDataNote />}
      <p className="text-xl">
        {`Hi ${parentName}. These are the real websites you use. To sign in, tap a button here instead of a link in an email.`}
      </p>
      {recap && <ParentRecapCard recap={recap} kidName={kidName} />}
      <p role="status" className="text-lg text-muted">
        {stillFinding ? "Still finding more of your accounts…" : ""}
      </p>
      <ParentAccountList accounts={accounts} />
      <p className="text-lg text-muted">{`${kidName} sees only this list and the emails we set aside.`}</p>
      {turnOff}
    </Screen>
  );
}
