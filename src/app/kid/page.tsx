"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { KidGate, SampleDataNote, type KidFamily } from "@/components/KidGate";
import { TimeAgo, useClientNow } from "@/components/TimeAgo";
import { BigButton, Card, Screen } from "@/components/ui";
import { useFeed, type FeedEntry } from "@/shared/feedApi";
import { mockRecap } from "@/shared/mock";
import { claimedSender, senderText } from "@/shared/senderText";
import { api } from "../../../convex/_generated/api";

// The kid's feed (B3): emails that need an answer first, then the ones we held.
// Live from A5 (api.feed.myFeed, api.feed.myWeeklyRecap), or the sample family in demo mode.
export default function KidFeedPage() {
  return <KidGate>{(family, demo) => <KidFeed family={family} demo={demo} />}</KidGate>;
}

const MIN = 60 * 1000;

function KidFeed({ family, demo }: { family: KidFamily; demo: boolean }) {
  const feed = useFeed();
  // Rounded to the minute so the recap subscription isn't recreated on every render.
  const now = useClientNow();
  const liveRecap = useQuery(api.feed.myWeeklyRecap, !demo && now !== null ? { now: Math.floor(now / MIN) * MIN } : "skip");
  const recap = demo ? mockRecap : liveRecap;
  const { parentName } = family;

  if (feed === undefined) return <Screen title="One moment..." />;

  const newestFirst = [...feed].sort((a, b) => b.createdAt - a.createdAt);
  const waiting = newestFirst.filter((e) => e.kind === "needs_answer" && !e.kidAnswer);
  const heldItems = newestFirst.filter((e) => e.kind === "held" && !e.kidAnswer);
  const answered = newestFirst.filter((e) => e.kidAnswer);
  // Counted from the feed so it changes the moment the kid answers.
  const needAnswer = waiting.length;

  return (
    <Screen title="This week">
      {demo && <SampleDataNote />}
      <Card>
        <ul className="flex flex-col gap-2 text-xl font-bold">
          {recap && <li>{`${recap.checked} checked`}</li>}
          {recap && <li className="text-fake">{`${recap.held} held`}</li>}
          <li className="text-unsure">{`${needAnswer} ${needAnswer === 1 ? "needs" : "need"} an answer`}</li>
        </ul>
      </Card>

      {family.status === "learning" && (
        <p role="status" className="text-lg">
          {`We're reading ${parentName}'s email history. New emails get checked as soon as that's done.`}
        </p>
      )}

      <FeedSection title="Needs your answer" entries={waiting} parentName={parentName}>
        {`Nothing to answer. We'll let you know when ${parentName} gets an email we're not sure about.`}
      </FeedSection>
      <FeedSection title="We held these" entries={heldItems} parentName={parentName}>
        Nothing held this week.
      </FeedSection>
      {answered.length > 0 && <FeedSection title="You answered" entries={answered} parentName={parentName} />}

      <BigButton href="/kid/accounts" secondary>{`See ${parentName}'s accounts`}</BigButton>
    </Screen>
  );
}

function FeedSection({
  title,
  entries,
  parentName,
  children,
}: {
  title: string;
  entries: FeedEntry[];
  parentName: string;
  /** What to say when the section is empty. */
  children?: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-lg text-muted">{children}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {entries.map((e) => (
            <li key={e._id}>
              <FeedCard entry={e} parentName={parentName} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedCard({ entry, parentName }: { entry: FeedEntry; parentName: string }) {
  const { verdict, kidAnswer } = entry;
  const fake = verdict.level === "fake";
  return (
    <Link
      href={`/kid/item/${entry._id}`}
      className={`block rounded-2xl border-2 p-5 [overflow-wrap:anywhere] hover:shadow-md ${
        fake ? "border-fake bg-fake-tint" : "border-unsure bg-unsure-tint"
      }`}
    >
      {/* Said in words, so color is never the only clue. */}
      <p className={`font-bold ${fake ? "text-fake" : "text-unsure"}`}>{fake ? "Looks fake" : "Not sure"}</p>
      <p className="text-xl font-bold">{`Says it's from ${claimedSender(verdict)}`}</p>
      {verdict.subject && <p className="text-lg">{`“${senderText(verdict.subject)}”`}</p>}
      <p className="text-muted">
        <TimeAgo at={entry.createdAt} />
      </p>
      {kidAnswer && (
        <p className="mt-2 font-bold">
          {kidAnswer.answer === "scam" ? `You said it's a scam. ${parentName} was told.` : `You said it's fine.`}
        </p>
      )}
      {/* Just a visual hint; the whole card is the link, so screen readers skip it. */}
      <span aria-hidden="true" className="mt-2 inline-block font-bold text-action underline">
        Look closer
      </span>
    </Link>
  );
}
