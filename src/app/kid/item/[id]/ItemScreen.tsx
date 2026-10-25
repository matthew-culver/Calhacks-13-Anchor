"use client";

import { ConvexError, type Infer } from "convex/values";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { InvestigationPanel } from "@/components/InvestigationPanel";
import { KidGate, SampleDataNote } from "@/components/KidGate";
import { TimeAgo } from "@/components/TimeAgo";
import { BigButton, Card, Screen } from "@/components/ui";
import { MAX_NOTE, useAnswerFeedItem, useFeed, type FeedEntry } from "@/shared/feedApi";
import { useInvestigation } from "@/shared/investigationApi";
import { claimedSender, senderText } from "@/shared/senderText";
import type { checkStatus } from "../../../../../convex/contract";

// One flagged email, up close (B3): what it claims, what we checked in plain words, and the
// kid's one-tap answer. The note goes to the parent in the kid's own words.

const STATUS: Record<Infer<typeof checkStatus>, { mark: string; label: string; className: string }> = {
  pass: { mark: "✓", label: "Looks right", className: "text-real" },
  warn: { mark: "!", label: "Odd", className: "text-unsure" },
  fail: { mark: "✗", label: "Problem", className: "text-fake" },
  unknown: { mark: "?", label: "Couldn't check", className: "text-muted" },
};

export function ItemScreen({ id }: { id: string }) {
  return (
    <KidGate>
      {(family, demo) => <Item id={id} parentName={family.parentName} demo={demo} />}
    </KidGate>
  );
}

function Item({ id, parentName, demo }: { id: string; parentName: string; demo: boolean }) {
  const feed = useFeed();
  // A7's investigator, live as it works (sample replay in demo mode until A7 lands).
  const investigation = useInvestigation(id);
  // Set when the kid answers on this visit, so focus moves to the result (not on a later visit).
  const [justAnswered, setJustAnswered] = useState(false);

  if (feed === undefined) return <Screen title="One moment..." />;
  const entry = feed.find((e) => e._id === id);
  if (!entry) {
    return (
      <Screen title="We couldn't find that email">
        <BigButton href="/kid">Back to this week</BigButton>
      </Screen>
    );
  }

  const { verdict, kidAnswer } = entry;
  const who = claimedSender(verdict);
  return (
    <Screen title={`Says it's from ${who}`}>
      <Link href="/kid" className="-mt-4 inline-flex min-h-tap items-center self-start text-lg font-bold text-action underline">
        ← Back to this week
      </Link>
      {demo && <SampleDataNote />}
      <Card>
        <div className="[overflow-wrap:anywhere]">
          {verdict.subject && <p className="text-xl font-bold">{`“${senderText(verdict.subject)}”`}</p>}
          <p className="text-lg">
            {`From ${verdict.fromName ? senderText(verdict.fromName) : who}`}
            {verdict.fromAddress && (
              <span className="text-muted">{` <${senderText(verdict.fromAddress)}>`}</span>
            )}
          </p>
          <p className="text-muted">
            <TimeAgo at={verdict.receivedAt} />
          </p>
        </div>
      </Card>

      {verdict.explanationForKid && <p className="text-xl">{verdict.explanationForKid}</p>}

      <InvestigationPanel investigation={investigation} />

      {verdict.checks && verdict.checks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold">{investigation ? "Our quick checks" : "What we checked"}</h2>
          <ul className="flex flex-col gap-3">
            {verdict.checks.map((c) => {
              const s = STATUS[c.status];
              return (
                <li key={c.id} className="flex gap-3 text-lg">
                  <span aria-hidden="true" className={`w-6 shrink-0 text-center font-bold ${s.className}`}>
                    {s.mark}
                  </span>
                  <span>
                    <span className={`font-bold ${s.className}`}>{`${s.label}: `}</span>
                    {c.plainReason}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {kidAnswer ? (
        <Answered kidAnswer={kidAnswer} parentName={parentName} takeFocus={justAnswered} />
      ) : (
        <AnswerForm entry={entry} parentName={parentName} onAnswered={() => setJustAnswered(true)} />
      )}
    </Screen>
  );
}

function Answered({
  kidAnswer,
  parentName,
  takeFocus,
}: {
  kidAnswer: NonNullable<FeedEntry["kidAnswer"]>;
  parentName: string;
  takeFocus: boolean;
}) {
  const { answer, note } = kidAnswer;
  // The buttons the kid just tapped are gone; put focus (and the screen reader) on the result.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (takeFocus) heading.current?.focus();
  }, [takeFocus]);

  return (
    <Card>
      <h2 ref={heading} tabIndex={-1} className="text-xl font-bold outline-none">
        {answer === "scam" ? "You said it's a scam." : "You said it's fine."}
      </h2>
      <p className="text-lg">
        {answer === "scam"
          ? `It stays out of ${parentName}'s inbox.`
          : `We put it back in ${parentName}'s inbox.`}
      </p>
      {note && <p className="mt-2 text-lg [overflow-wrap:anywhere]">{`Your note to ${parentName}: “${note}”`}</p>}
      <div className="mt-4">
        <BigButton href="/kid" secondary>Back to this week</BigButton>
      </div>
    </Card>
  );
}

function AnswerForm({
  entry,
  parentName,
  onAnswered,
}: {
  entry: FeedEntry;
  parentName: string;
  onAnswered: () => void;
}) {
  const answerFeedItem = useAnswerFeedItem();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (answer: "fine" | "scam") => {
    setBusy(true);
    setError(null);
    try {
      await answerFeedItem({ feedItemId: entry._id, answer, note });
      onAnswered();
    } catch (err) {
      // api.feed.answer's errors are already plain words ("You already answered this one.").
      const plain = err instanceof ConvexError && typeof err.data === "string";
      setError(plain ? err.data : "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">What do you think?</h2>
      {entry.kind === "held" && (
        <p className="text-lg text-muted">
          {`We already held this one. If it's a real email, tap “It's fine” and we'll put it back in ${parentName}'s inbox.`}
        </p>
      )}
      <label className="flex flex-col gap-2">
        <span className="text-lg font-bold">{`A note for ${parentName} (optional)`}</span>
        <textarea
          name="note"
          rows={3}
          maxLength={MAX_NOTE}
          placeholder={`Good catch, ${parentName}. That one's fake. Love you.`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="rounded-2xl border-2 border-line p-4 text-xl"
        />
      </label>
      {error && (
        <p role="alert" className="text-lg font-bold text-fake">
          {error}
        </p>
      )}
      <BigButton onClick={() => void send("scam")} disabled={busy}>
        It&apos;s a scam
      </BigButton>
      <BigButton onClick={() => void send("fine")} disabled={busy} secondary>
        It&apos;s fine
      </BigButton>
    </section>
  );
}
