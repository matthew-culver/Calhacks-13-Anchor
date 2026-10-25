"use client";

import { useState } from "react";
import { TimeAgo } from "@/components/TimeAgo";
import { BigButton, Card, Screen } from "@/components/ui";
import { MAX_NOTE, useAnswerFeedItem, useFeed, type FeedEntry } from "@/shared/feedApi";
import { mockFamily } from "@/shared/mock";

// One flagged email, up close (B3): what it claims, what we checked in plain words, and the
// kid's one-tap answer. The note goes to the parent in the kid's own words.

type CheckStatus = NonNullable<FeedEntry["verdict"]["checks"]>[number]["status"];

const STATUS: Record<CheckStatus, { mark: string; label: string; className: string }> = {
  pass: { mark: "✓", label: "Looks right", className: "text-real" },
  warn: { mark: "!", label: "Odd", className: "text-unsure" },
  fail: { mark: "✗", label: "Problem", className: "text-fake" },
  unknown: { mark: "?", label: "Couldn't check", className: "text-muted" },
};

export function ItemScreen({ id }: { id: string }) {
  const feed = useFeed();
  const parentName = mockFamily.parentName;

  if (feed === undefined) return <Screen title="One moment..." />;
  const entry = feed.find((e) => e._id === id);
  if (!entry) {
    return (
      <Screen title="We couldn't find that email">
        <BigButton href="/kid">Back to this week</BigButton>
      </Screen>
    );
  }

  const { verdict } = entry;
  const who = verdict.claimedOrg ?? verdict.fromName ?? verdict.fromDomain;
  return (
    <Screen title={`Says it's from ${who}`}>
      <Card>
        {verdict.subject && <p className="text-xl font-bold">{`“${verdict.subject}”`}</p>}
        <p className="text-lg">
          {`From ${verdict.fromName ?? who}`}
          {verdict.fromAddress && <span className="break-all text-muted">{` <${verdict.fromAddress}>`}</span>}
        </p>
        <p className="text-muted">
          <TimeAgo at={verdict.receivedAt} />
        </p>
      </Card>

      {verdict.explanationForKid && <p className="text-xl">{verdict.explanationForKid}</p>}

      {verdict.checks && verdict.checks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold">What we checked</h2>
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

      {entry.kidAnswer ? <Answered entry={entry} parentName={parentName} /> : <AnswerForm entry={entry} parentName={parentName} />}
    </Screen>
  );
}

function Answered({ entry, parentName }: { entry: FeedEntry; parentName: string }) {
  const { answer, note } = entry.kidAnswer!;
  return (
    <Card>
      <p className="text-xl font-bold">{answer === "scam" ? "You said it's a scam." : "You said it's fine."}</p>
      <p className="text-lg">
        {answer === "scam"
          ? `It stays out of ${parentName}'s inbox.`
          : `We put it back in ${parentName}'s inbox.`}
      </p>
      {note && <p className="mt-2 text-lg">{`Your note to ${parentName}: “${note}”`}</p>}
      <div className="mt-4">
        <BigButton href="/kid" secondary>Back to this week</BigButton>
      </div>
    </Card>
  );
}

function AnswerForm({ entry, parentName }: { entry: FeedEntry; parentName: string }) {
  const answerFeedItem = useAnswerFeedItem();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (answer: "fine" | "scam") => {
    setBusy(true);
    setError(null);
    try {
      await answerFeedItem({ feedItemId: entry._id, answer, note });
    } catch {
      setError("That didn't go through. Please try again.");
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
