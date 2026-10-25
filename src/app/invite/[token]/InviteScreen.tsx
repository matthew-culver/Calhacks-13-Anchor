"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { BigButton, Card, Screen } from "@/components/ui";
import { rememberKidName } from "@/shared/kidName";
import { api } from "../../../../convex/_generated/api";

// Person A's Gmail connect route (A3) lives on the Convex site URL. Prefer the
// explicit variable; otherwise derive it from the deployment URL (".cloud" -> ".site").
const convexSiteUrl =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
  (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(/\.cloud$/, ".site");

// B7 drops the setup video in here. Until then, the three steps say the same thing in words.
const INVITE_VIDEO_SRC: string | null = null;

/** The parent's one tap. Shows who is asking, then hands off to Google. */
export function InviteScreen({ token }: { token: string }) {
  const invite = useQuery(api.families.getInvite, { token });
  const [openedAt] = useState(() => Date.now());

  if (invite === undefined) {
    return <Screen title="One moment..." />;
  }
  if (invite === null) {
    return (
      <Screen title="This link was already used">
        <p className="text-lg text-muted">
          Or it&apos;s too old. Ask the person who sent it to you for a new one.
        </p>
      </Screen>
    );
  }
  const { parentName, kidName, kidEmail, inviteExpiresAt } = invite;
  if (inviteExpiresAt < openedAt) {
    return (
      <Screen title="This link is too old">
        <p className="text-lg text-muted">{`Ask ${kidName} to send you a new one.`}</p>
      </Screen>
    );
  }

  return (
    <Screen title={`Hi ${parentName}`}>
      {/* Anyone can sign up and claim to be someone's kid, so say exactly who is asking. */}
      <p className="text-xl">
        <strong>{kidName}</strong>
        {kidEmail ? ` (${kidEmail})` : ""}
        {` wants to help keep scam emails away from you. Only continue if ${kidName} asked you.`}
      </p>
      <WhatHappensNext />
      {/* A real form post, not fetch: the browser must follow the redirect to Google, and the
          invite stays out of every URL. /gmail/start only accepts posts from our own site. */}
      <form
        method="POST"
        action={`${convexSiteUrl}/gmail/start`}
        onSubmit={() => rememberKidName(kidName)}
      >
        <input type="hidden" name="invite" value={token} />
        <BigButton type="submit">Protect my email</BigButton>
      </form>
    </Screen>
  );
}

function WhatHappensNext() {
  if (INVITE_VIDEO_SRC) {
    return (
      <video controls playsInline className="w-full rounded-2xl" src={INVITE_VIDEO_SRC}>
        A short video of what happens next.
      </video>
    );
  }
  return (
    <Card>
      <h2 className="mb-3 text-xl font-bold">What happens next</h2>
      <ol className="flex list-decimal flex-col gap-2 pl-6 text-lg">
        <li>Tap the button below.</li>
        <li>Google asks if Anchor can sort your email. Say yes.</li>
        <li>That&apos;s it. You don&apos;t need to do anything else.</li>
      </ol>
    </Card>
  );
}
