"use client";

import { useState, type FormEvent } from "react";
import { BigButton, Screen, TextField } from "@/components/ui";
import { createFamily, signUp } from "@/shared/api";

// Kid setup in three screens: make an account, say who we're protecting,
// then send them the link. Mocked API until Checkpoint 1 (see src/shared/api.ts).

type Step =
  | { name: "account" }
  | { name: "parent"; kidName: string }
  | { name: "share"; kidName: string; parentName: string; inviteToken: string };

export function StartFlow() {
  const [step, setStep] = useState<Step>({ name: "account" });

  switch (step.name) {
    case "account":
      return (
        <AccountStep
          onDone={(kidName) => setStep({ name: "parent", kidName })}
        />
      );
    case "parent":
      return (
        <ParentStep
          kidName={step.kidName}
          onDone={(parentName, inviteToken) =>
            setStep({ ...step, name: "share", parentName, inviteToken })
          }
        />
      );
    case "share":
      return <ShareStep {...step} />;
  }
}

/** Runs a form submit with a busy flag and one plain error message. */
function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  };
  return { busy, error, onSubmit };
}

function ErrorText({ error }: { error: string | null }) {
  return (
    <p role="alert" className="text-lg font-bold text-fake">
      {error}
    </p>
  );
}

function AccountStep({ onDone }: { onDone: (kidName: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, onSubmit } = useSubmit(async () => {
    await signUp({ name: name.trim(), email: email.trim(), password });
    onDone(name.trim());
  });

  return (
    <Screen title="Let's get you set up">
      <p className="text-lg text-muted">It takes about two minutes.</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <TextField label="Your first name" name="name" autoComplete="given-name" value={name} onChange={setName} />
        <TextField label="Your email" name="email" type="email" autoComplete="email" value={email} onChange={setEmail} />
        <TextField
          label="Make a password (8 or more letters)"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={setPassword}
        />
        <ErrorText error={error} />
        <BigButton type="submit" disabled={busy}>
          {busy ? "One moment..." : "Next"}
        </BigButton>
      </form>
    </Screen>
  );
}

function ParentStep({
  kidName,
  onDone,
}: {
  kidName: string;
  onDone: (parentName: string, inviteToken: string) => void;
}) {
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const { busy, error, onSubmit } = useSubmit(async () => {
    const { inviteToken } = await createFamily({
      parentName: parentName.trim(),
      parentEmail: parentEmail.trim(),
      kidName,
    });
    onDone(parentName.trim(), inviteToken);
  });

  return (
    <Screen title="Who are we protecting?">
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <TextField
          label="What do you call them?"
          name="parentName"
          placeholder="Mom"
          value={parentName}
          onChange={setParentName}
        />
        <TextField
          label="Their Gmail address"
          name="parentEmail"
          type="email"
          placeholder="name@gmail.com"
          value={parentEmail}
          onChange={setParentEmail}
        />
        <ErrorText error={error} />
        <BigButton type="submit" disabled={busy}>
          {busy ? "One moment..." : "Make their link"}
        </BigButton>
      </form>
    </Screen>
  );
}

function ShareStep({
  kidName,
  parentName,
  inviteToken,
}: {
  kidName: string;
  parentName: string;
  inviteToken: string;
}) {
  const [copied, setCopied] = useState(false);
  // Rendered only after a submit, so window is always there.
  const link = `${window.location.origin}/invite/${inviteToken}`;
  const message = `Hi ${parentName}, it's ${kidName}. Tap this link so I can help keep scam emails away from you: ${link}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the link is on screen to copy by hand.
    }
  };

  return (
    <Screen title={`Send ${parentName} their link`}>
      <p className="text-lg text-muted">
        {`${parentName} taps it once and says yes. That's all they do.`}
      </p>
      <p className="rounded-2xl border-2 border-line p-4 text-lg break-all">
        {link}
      </p>
      <BigButton href={`sms:?&body=${encodeURIComponent(message)}`}>
        {`Text it to ${parentName}`}
      </BigButton>
      <BigButton secondary onClick={copy}>
        {copied ? "Copied!" : "Copy the link"}
      </BigButton>
      <p aria-live="polite" className="sr-only">
        {copied ? "Link copied" : ""}
      </p>
    </Screen>
  );
}
