"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState, type FormEvent } from "react";
import { BigButton, Screen, TextField } from "@/components/ui";
import { api } from "../../../convex/_generated/api";

// Kid setup in three screens: make an account, say who we're protecting,
// then send them the link. The screen comes from the kid's real state, so a
// reload or a later visit picks up where they left off.

export function StartFlow() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const family = useQuery(api.families.getMyFamily, isAuthenticated ? {} : "skip");
  // Remembered from sign-up so the next screen doesn't ask again.
  const [kidName, setKidName] = useState("");

  if (!isLoading && !isAuthenticated) {
    return <AccountStep onDone={setKidName} />;
  }
  if (family === undefined) {
    return <Screen title="One moment..." />;
  }
  if (family === null) {
    return <ParentStep kidName={kidName} />;
  }
  // The invite fields are there only while waiting for the parent to tap the link.
  if (family.inviteToken !== undefined) {
    return (
      <ShareStep
        kidName={family.kidName}
        parentName={family.parentName}
        inviteToken={family.inviteToken}
        inviteExpiresAt={family.inviteExpiresAt}
      />
    );
  }
  return (
    <Screen title="You're all set up">
      <BigButton href="/kid">{`See what's happening with ${family.parentName}`}</BigButton>
    </Screen>
  );
}

/** Runs a submit with a busy flag and one plain error message. */
function useSubmit(action: () => Promise<void>, fallbackError: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      // Server messages from Person A's functions are already plain words.
      setError(err instanceof ConvexError ? String(err.data) : fallbackError);
    } finally {
      setBusy(false);
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run();
  };
  return { busy, error, run, onSubmit };
}

function ErrorText({ error }: { error: string | null }) {
  return (
    <p role="alert" className="text-lg font-bold text-fake">
      {error}
    </p>
  );
}

function AccountStep({ onDone }: { onDone: (kidName: string) => void }) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signUp" | "signIn">("signUp");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, onSubmit } = useSubmit(
    async () => {
      onDone(name.trim());
      await signIn("password", { flow, email: email.trim(), password });
    },
    flow === "signUp"
      ? "We couldn't make that account. If you've signed up before, sign in instead."
      : "That email and password don't match.",
  );
  const isSignUp = flow === "signUp";

  return (
    <Screen title={isSignUp ? "Let's get you set up" : "Welcome back"}>
      {isSignUp && <p className="text-lg text-muted">It takes about two minutes.</p>}
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        {isSignUp && (
          <TextField label="Your first name" name="name" autoComplete="given-name" value={name} onChange={setName} />
        )}
        <TextField label="Your email" name="email" type="email" autoComplete="email" value={email} onChange={setEmail} />
        <TextField
          label={isSignUp ? "Make a password (8 or more letters)" : "Your password"}
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          minLength={8}
          value={password}
          onChange={setPassword}
        />
        <ErrorText error={error} />
        <BigButton type="submit" disabled={busy}>
          {busy ? "One moment..." : isSignUp ? "Next" : "Sign in"}
        </BigButton>
      </form>
      <button
        type="button"
        onClick={() => setFlow(isSignUp ? "signIn" : "signUp")}
        className="min-h-tap text-lg font-bold text-action underline"
      >
        {isSignUp ? "I already have an account" : "I'm new here"}
      </button>
    </Screen>
  );
}

function ParentStep({ kidName: knownKidName }: { kidName: string }) {
  const createFamily = useMutation(api.families.createFamily);
  // Empty after a sign-in or a reload, so ask for it here instead.
  const [kidName, setKidName] = useState(knownKidName);
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const { busy, error, onSubmit } = useSubmit(async () => {
    // getMyFamily updates on its own, which moves us to the share screen.
    await createFamily({
      parentName: parentName.trim(),
      parentEmail: parentEmail.trim(),
      kidName: kidName.trim(),
    });
  }, "Something went wrong. Please try again.");

  return (
    <Screen title="Who are we protecting?">
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        {knownKidName === "" && (
          <TextField label="Your first name" name="kidName" autoComplete="given-name" value={kidName} onChange={setKidName} />
        )}
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
  inviteExpiresAt,
}: {
  kidName: string;
  parentName: string;
  inviteToken: string;
  inviteExpiresAt?: number;
}) {
  const renewInvite = useMutation(api.families.renewInvite);
  const [copied, setCopied] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const renew = useSubmit(async () => {
    await renewInvite();
  }, "Something went wrong. Please try again.");

  if (inviteExpiresAt !== undefined && inviteExpiresAt < openedAt) {
    return (
      <Screen title={`${parentName}'s link ran out`}>
        <p className="text-lg text-muted">
          Links last a week. Make a new one and send it again.
        </p>
        <ErrorText error={renew.error} />
        <BigButton onClick={() => void renew.run()} disabled={renew.busy}>
          {renew.busy ? "One moment..." : "Make a new link"}
        </BigButton>
      </Screen>
    );
  }

  // Client-only: this screen renders after the auth state loads, never on the server.
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
