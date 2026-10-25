"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { LoadingScreen } from "@/components/LoadingScreen";
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
    return <LoadingScreen />;
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
      <Card>
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-action text-2xl font-bold text-on-action">
            {kidName.charAt(0).toUpperCase()}
          </span>
          <p className="text-xl">
            <strong>{kidName}</strong>
            {kidEmail ? ` (${kidEmail})` : ""}
            {" wants to help keep scam emails away from you."}
          </p>
        </div>
      </Card>
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
      <p className="flex gap-3 text-lg text-muted">
        <Icon name="lock" className="mt-1 h-6 w-6" />
        Anchor never sends email as you and never deletes anything. You can turn it off any time.
      </p>
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
      <h2 className="mb-4 text-xl font-bold">What happens next</h2>
      <ol className="flex flex-col gap-4 text-lg">
        {[
          "Tap the button below.",
          "Google asks if Anchor can sort your email. Tap Continue.",
          "That's it. You don't need to do anything else.",
        ].map((step, i) => (
          <li key={step} className="flex items-start gap-3">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-action-tint font-bold text-action">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
