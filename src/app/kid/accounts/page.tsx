"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { KidAccountList } from "@/components/AccountList";
import { BigButton, Screen } from "@/components/ui";
import { api } from "../../../../convex/_generated/api";

// The kid's My Accounts (B4): the real places the parent deals with, learned from their inbox.
// Both queries are live, so "Learning..." turns into the list on its own when A4's import ends.
export default function KidAccounts() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const family = useQuery(api.families.getMyFamily, isAuthenticated ? {} : "skip");
  const accounts = useQuery(api.accounts.myAccounts, isAuthenticated ? {} : "skip");

  if (!isLoading && !isAuthenticated) {
    return (
      <Screen focusTitle title="Please sign in">
        <BigButton href="/start">Sign in</BigButton>
      </Screen>
    );
  }
  if (family === undefined || accounts === undefined) {
    return <Screen focusTitle title="One moment..." />;
  }
  if (family === null) {
    return (
      <Screen focusTitle title="Let's set up protection first">
        <BigButton href="/start">Get started</BigButton>
      </Screen>
    );
  }

  const { parentName, status } = family;
  if (status === "invited" || status === "needs_reconnect") {
    return (
      <Screen focusTitle title={`Waiting for ${parentName}`}>
        <p className="text-lg text-muted">
          {`${parentName}'s accounts show up here a minute after they tap the link you sent.`}
        </p>
        <BigButton href="/start">{`See ${parentName}'s link`}</BigButton>
      </Screen>
    );
  }
  if (status === "off") {
    return (
      <Screen focusTitle title={`${parentName} turned protection off`}>
        <p className="text-lg text-muted">We deleted everything we had learned.</p>
      </Screen>
    );
  }
  if (status === "learning") {
    return (
      <Screen focusTitle title={`${parentName}'s accounts`}>
        <p role="status" className="text-lg">
          {`Learning who ${parentName} really deals with… This takes about a minute.`}
        </p>
      </Screen>
    );
  }

  return (
    <Screen focusTitle title={`${parentName}'s accounts`}>
      <p className="text-lg text-muted">
        {`The places ${parentName} really gets email from. Each link goes to the real sign-in page.`}
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
