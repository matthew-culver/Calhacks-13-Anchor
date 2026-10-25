"use client";

import { useQuery } from "convex/react";
import { ParentAccountList } from "@/components/AccountList";
import { ParentRecapCard } from "@/components/RecapCard";
import { useClientNow } from "@/components/TimeAgo";
import { TurnOff } from "@/components/TurnOff";
import { Screen } from "@/components/ui";
import { api } from "../../../../convex/_generated/api";

const MIN = 60 * 1000;

// The parent's page, opened from the link in their Gmail note. Big text: this week's recap,
// their accounts, the right words for every state of their protection, and "Turn it off".
export function ParentScreen({ token, justConnected }: { token: string; justConnected?: boolean }) {
  const view = useQuery(api.families.getParentView, { parentToken: token });
  const accounts = useQuery(api.accounts.parentAccounts, justConnected ? "skip" : { parentToken: token });
  // Rounded to the minute so the recap subscription isn't recreated on every render.
  const now = useClientNow();
  const recap = useQuery(
    api.feed.parentWeeklyRecap,
    justConnected || now === null ? "skip" : { parentToken: token, now: Math.floor(now / MIN) * MIN },
  );
  const family = view?.kidName ?? "your family";

  // Person A's /gmail/callback lands here with ?connected=1 after Google says yes.
  if (justConnected) {
    return (
      <Screen title="You're done">
        <p className="text-xl">You don&apos;t need to do anything else.</p>
        <p className="text-lg text-muted">
          {`We'll quietly set aside scam emails, and ${family} hears about anything we're not sure of.`}
        </p>
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
        <TurnOff parentToken={token} kidName={kidName} />
      </Screen>
    );
  }
  if (accounts.length === 0) {
    // While the history is read ("learning"), or a connected inbox with nothing to list yet.
    // A different title from the list's, so focus moves (and is announced) when it fills in.
    return (
      <Screen focusTitle title="Getting your accounts ready">
        <p className="text-xl">
          We&apos;re still learning which places you deal with. This page fills in on its own.
        </p>
        <TurnOff parentToken={token} kidName={kidName} />
      </Screen>
    );
  }

  return (
    <Screen focusTitle title="Your accounts">
      <p className="text-xl">
        {`Hi ${parentName}. These are the real websites you use. To sign in, tap a button here instead of a link in an email.`}
      </p>
      {recap && <ParentRecapCard recap={recap} kidName={kidName} />}
      <ParentAccountList accounts={accounts} />
      <p className="text-lg text-muted">{`${kidName} sees only this list and the emails we set aside.`}</p>
      <TurnOff parentToken={token} kidName={kidName} />
    </Screen>
  );
}
