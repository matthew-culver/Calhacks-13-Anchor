"use client";

import { ConvexError } from "convex/values";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { InvestigationPanel, QuickChecks } from "@/components/InvestigationPanel";
import { KidGate, SampleDataNote } from "@/components/KidGate";
import { TimeAgo } from "@/components/TimeAgo";
import { BigButton, Card, Pill, Screen } from "@/components/ui";
import { MAX_NOTE, useAnswerFeedItem, useFeed, type FeedEntry } from "@/shared/feedApi";
import { useInvestigation } from "@/shared/investigationApi";
import { claimedSender, senderText } from "@/shared/senderText";

// One flagged email, up close (B3): what it claims, what we found in plain words, and the
// kid's one-tap answer. The note goes to the parent in the kid's own words.

export function ItemScreen({ id }: { id: string }) {
  return (
    <KidGate>
      {/* key: a different email starts fresh (its own investigation replay, its own answer state). */}
      {(family, demo) => <Item key={id} id={id} parentName={family.parentName} demo={demo} />}
    </KidGate>
  );
}

function Item({ id, parentName, demo }: { id: string; parentName: string; demo: boolean }) {
  const feed = useFeed();
  // A7's investigator, live as it works (a sample replay in demo mode). Asked only once the
  // feed confirms this email exists, so a bad id in the address can't crash the page.
  const investigation = useInvestigation(id, feed?.some((e) => e._id === id) ?? false);
  // Set when the kid answers on this visit, so focus moves to the result (not on a later visit).
  const [justAnswered, setJustAnswered] = useState(false);

  if (feed === undefined) return <Screen focusTitle title="One moment..." />;
  const entry = feed.find((e) => e._id === id);
  if (!entry) {
    return (
      <Screen focusTitle title="We couldn't find that email">
        <BigButton href="/kid">Back to this week</BigButton>
      </Screen>
    );
  }

  const { verdict, kidAnswer } = entry;
  const who = claimedSender(verdict);
  const fake = verdict.level === "fake";
  const held = verdict.action === "held";
  return (
    <Screen
      focusTitle
      title={`Says it's from ${who}`}
      before={
        <Link href="/kid" className="inline-flex min-h-tap items-center gap-2 text-lg font-semibold text-action hover:underline">
          <Icon name="arrowLeft" className="h-5 w-5" />
          Back to this week
        </Link>
      }
    >
      {demo && <SampleDataNote />}
      <Card compact>
        <div className="flex flex-col gap-2 [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Pill tone={fake ? "fake" : "unsure"}>
              {fake ? "Looks fake" : "Not sure"}
              {held && (verdict.actionAppliedAt === undefined ? " · Being held…" : " · Held")}
            </Pill>
            <span className="text-base text-muted">
              <TimeAgo at={verdict.receivedAt} />
            </span>
          </div>
          {verdict.subject && <p className="text-xl font-semibold">{`“${senderText(verdict.subject)}”`}</p>}
          <p className="text-lg">
            {`From ${verdict.fromName ? senderText(verdict.fromName) : who}`}
            {verdict.fromAddress && <span className="text-muted">{` <${senderText(verdict.fromAddress)}>`}</span>}
          </p>
        </div>
      </Card>

      {investigation ? (
        <InvestigationPanel investigation={investigation} checks={verdict.checks} explanation={verdict.explanationForKid} />
      ) : (
        <>
          {verdict.explanationForKid && <p className="text-xl">{verdict.explanationForKid}</p>}
          {verdict.checks && verdict.checks.length > 0 && (
            <Card>
              <QuickChecks title="What we checked" checks={verdict.checks} />
            </Card>
          )}
        </>
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
      <h2 ref={heading} tabIndex={-1} className="flex items-center gap-3 text-2xl font-bold outline-none">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-real-tint text-real">
          <Icon name="check" className="h-6 w-6" />
        </span>
        {answer === "scam" ? "You said it's a scam." : "You said it's fine."}
      </h2>
      <p className="mt-2 text-lg">
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
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (answer: "fine" | "scam") => {
    setBusy(true);
    setError(null);
    try {
      // "Always trust" only means something with "It's fine" (A7: family-aware rules).
      await answerFeedItem({ feedItemId: entry._id, answer, note, ...(answer === "fine" && trust && { trustSender: true }) });
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
    <Card>
      <section className="flex flex-col gap-5">
      <h2 className="text-2xl font-bold">What do you think?</h2>
      {entry.kind === "held" && (
        <p className="-mt-2 text-lg text-muted">
          {`We already held this one. If it's a real email, tap “It's fine” and we'll put it back in ${parentName}'s inbox.`}
        </p>
      )}
      <label className="flex flex-col gap-2">
        <span className="text-lg font-semibold">{`A note for ${parentName} (optional)`}</span>
        <textarea
          name="note"
          rows={3}
          maxLength={MAX_NOTE}
          placeholder={`Good catch, ${parentName}. That one's fake. Love you.`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="rounded-2xl border-2 border-line-strong bg-surface p-4 text-xl placeholder:text-muted/70 focus:border-action"
        />
      </label>
      {error && (
        <p role="alert" className="text-lg font-bold text-fake">
          {error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <BigButton onClick={() => void send("scam")} disabled={busy}>
          It&apos;s a scam
        </BigButton>
        <BigButton onClick={() => void send("fine")} disabled={busy} secondary>
          It&apos;s fine
        </BigButton>
      </div>
      <label className="flex min-h-tap items-center gap-3 text-lg">
        <input
          type="checkbox"
          checked={trust}
          onChange={(e) => setTrust(e.target.checked)}
          className="h-7 w-7 shrink-0 accent-action"
        />
        <span>
          {`With “It's fine”: always trust this sender. We'll only flag their emails for something serious, like a request for gift cards.`}
        </span>
      </label>
      </section>
    </Card>
  );
}
