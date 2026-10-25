"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { BigButton } from "@/components/ui";
import { api } from "../../convex/_generated/api";

// The parent's "Turn it off" (B5). Only ever from two deliberate taps: the button, then "Yes,
// turn it off". Never on page load or from a link, because email scanners open links on their
// own. Once it runs, getParentView says "off" and the parent page shows "Protection is off".

export function TurnOff({ parentToken, kidName }: { parentToken: string; kidName: string }) {
  const turnOff = useMutation(api.turnOff.turnOff);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The question replaces the button; put focus (and the screen reader) on it.
  const question = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (confirming) question.current?.focus();
  }, [confirming]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await turnOff({ parentToken });
    } catch {
      setError("That didn't work. Please try again.");
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <section className="flex flex-col gap-3 border-t-2 border-line pt-6">
        <p className="text-lg text-muted">You can turn Anchor off any time.</p>
        <BigButton secondary onClick={() => setConfirming(true)}>
          Turn off Anchor
        </BigButton>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border-2 border-fake bg-fake-tint p-6">
      <h2 ref={question} tabIndex={-1} className="text-2xl font-bold outline-none">
        Turn off Anchor?
      </h2>
      <p className="text-xl">
        {`We'll stop checking your email and delete everything we learned. ${kidName} will see that it's off.`}
      </p>
      {error && (
        <p role="alert" className="text-lg font-bold text-fake">
          {error}
        </p>
      )}
      <BigButton onClick={() => void confirm()} disabled={busy}>
        {busy ? "Turning off..." : "Yes, turn it off"}
      </BigButton>
      <BigButton secondary onClick={() => setConfirming(false)} disabled={busy}>
        Keep it on
      </BigButton>
    </section>
  );
}
