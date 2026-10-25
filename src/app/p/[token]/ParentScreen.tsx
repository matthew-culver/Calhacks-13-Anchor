"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { ParentAccountList } from "@/components/AccountList";
import { Screen } from "@/components/ui";
import { api } from "../../../../convex/_generated/api";

// The parent's page, opened from the link in their Gmail note. B4: their accounts in big text.
// B5 adds the "Turn it off" button. No names here yet: there's no family lookup by parent
// token, and a wrong name would be a stranger's.
export function ParentScreen({ token, justConnected }: { token: string; justConnected?: boolean }) {
  const accounts = useQuery(api.accounts.parentAccounts, justConnected ? "skip" : { parentToken: token });
  const [now] = useState(() => Date.now());

  // Person A's /gmail/callback lands here with ?connected=1 after Google says yes.
  if (justConnected) {
    return (
      <Screen title="You're done">
        <p className="text-xl">You don&apos;t need to do anything else.</p>
        <p className="text-lg text-muted">
          We&apos;ll quietly set aside scam emails, and your family hears about anything
          we&apos;re not sure of.
        </p>
      </Screen>
    );
  }

  if (accounts === undefined) {
    return <Screen title="One moment..." />;
  }
  if (accounts.length === 0) {
    // Also what an unknown or turned-off link sees: nothing to reveal either way.
    return (
      <Screen title="Your accounts">
        <p role="status" className="text-xl">
          We&apos;re still learning which places you deal with. This page fills in on its own.
        </p>
      </Screen>
    );
  }

  return (
    <Screen title="Your accounts">
      <p className="text-xl">
        These are the real websites you use. To sign in, tap a button here instead of a link
        in an email.
      </p>
      <ParentAccountList accounts={accounts} now={now} />
      <p className="text-lg text-muted">
        Your family sees only this list and the emails we set aside.
      </p>
    </Screen>
  );
}
