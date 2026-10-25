"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { BigButton, Card, Screen } from "@/components/ui";
import { convexSiteUrl } from "@/shared/convexSite";
import { rememberKidName } from "@/shared/kidName";
import { api } from "../../../../convex/_generated/api";

// B7 drops the setup video in here. Until then, the three steps say the same thing in words.
const INVITE_VIDEO_SRC: string | null = null;

/** The parent's one tap. Shows who is asking, then hands off to Google. */
export function InviteScreen({ token }: { token: string }) {
  const invite = useQuery(api.families.getInvite, { token });
  const [submitting, setSubmitting] = useState(false);

  // Coming back with the browser's Back button restores this page as it was left;
  // turn the button back on so it isn't stuck on "Opening Google...".
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setSubmitting(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (invite === undefined) {
    return <Screen focusTitle title="One moment..." />;
  }
  if (invite === null) {
    return (
      <Screen focusTitle title="This link was already used">
        <p className="text-lg text-muted">
          Or it&apos;s too old. Ask the person who sent it to you for a new one.
        </p>
      </Screen>
    );
  }
  // Expiry isn't checked here: a phone with a fast clock would turn away a good link.
  // /gmail/start checks it with the server's clock and sends "This link is too old".
  const { parentName, kidName, kidEmail } = invite;

  return (
    <Screen focusTitle title={`Hi ${parentName}`}>
      {/* Anyone can sign up and claim to be someone's kid, so say exactly who is asking. */}
      <p className="text-xl">
        <strong>{kidName}</strong>
        {kidEmail ? ` (${kidEmail})` : ""}
        {" wants to help keep scam emails away from you."}
      </p>
      <p className="text-xl font-bold">{`Only tap the button if ${kidName} asked you.`}</p>
      <WhatHappensNext />
      {/* A real form post, not fetch: the browser must follow the redirect to Google, and the
          invite stays out of every URL. /gmail/start only accepts posts from our own site. */}
      <form
        method="POST"
        action={`${convexSiteUrl()}/gmail/start`}
        onSubmit={(e) => {
          // Google can take a few seconds to load. A second tap would start over.
          if (submitting) {
            e.preventDefault();
            return;
          }
          setSubmitting(true);
          rememberKidName(kidName);
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="invite" value={token} />
        <BigButton type="submit" disabled={submitting}>
          {submitting ? "Opening Google..." : "Protect my email"}
        </BigButton>
        <p role="status" className="text-lg text-muted">
          {submitting ? "Taking you to Google. This can take a few seconds." : ""}
        </p>
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
        <li>Google asks if Anchor can sort your email. Tap Continue.</li>
        <li>That&apos;s it. You don&apos;t need to do anything else.</li>
      </ol>
    </Card>
  );
}
