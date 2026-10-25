"use client";

import { useQuery } from "convex/react";
import { KidAccountList } from "@/components/AccountList";
import { useNewItemAlerts } from "@/components/Alerts";
import { KidGate, SampleDataNote, type KidFamily } from "@/components/KidGate";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/ui";
import { useFeed } from "@/shared/feedApi";
import { mockAccounts } from "@/shared/mock";
import { api } from "../../../../convex/_generated/api";

// The kid's My Accounts (B4): the real places the parent deals with, learned from their inbox.
// Live, so "Learning..." turns into the list on its own when A4's import ends.
export default function KidAccountsPage() {
  return <KidGate>{(family, demo) => <KidAccounts family={family} demo={demo} />}</KidGate>;
}

function KidAccounts({ family, demo }: { family: KidFamily; demo: boolean }) {
  const live = useQuery(api.accounts.myAccounts, demo ? "skip" : {});
  const accounts = demo ? mockAccounts : live;
  const { parentName, status } = family;
  useNewItemAlerts(useFeed(), parentName);

  if (accounts === undefined) {
    return <LoadingScreen />;
  }
  const learning = status === "learning";
  if (learning && accounts.length === 0) {
    // Its own title, so focus moves (and is announced) when the first accounts arrive.
    return (
      <Screen focusTitle title={`Learning ${parentName}'s accounts`}>
        <p role="status" className="text-lg">
          {`Learning who ${parentName} really deals with… This takes about a minute.`}
        </p>
      </Screen>
    );
  }

  // Accounts show the moment the import finds them, like on the parent's screen (A8, B10).
  return (
    <Screen focusTitle title={`${parentName}'s accounts`}>
      {demo && <SampleDataNote />}
      <p className="text-lg text-muted">
        {`The places ${parentName} really gets email from. Each link goes to the real sign-in page.`}
      </p>
      <p role="status" className="text-lg">
        {learning ? "Still finding more…" : ""}
      </p>
      {accounts.length === 0 ? (
        <p className="text-lg">
          {`Nothing yet. A place shows up here after it has sent ${parentName} several real emails.`}
        </p>
      ) : (
        <KidAccountList accounts={accounts} parentName={parentName} />
      )}
    </Screen>
  );
}
