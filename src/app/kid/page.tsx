"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { KidGate, SampleDataNote, type KidFamily } from "@/components/KidGate";
import { KidRecapCard } from "@/components/RecapCard";
import { AlertsButton, useNewItemAlerts } from "@/components/Alerts";
import { Icon, Spinner } from "@/components/icons";
import { TimeAgo, useClientNow } from "@/components/TimeAgo";
import { Watching } from "@/components/Watching";
import { BigButton, Pill, Screen } from "@/components/ui";
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
  useNewItemAlerts(feed, parentName);

  if (feed === undefined) return <Screen focusTitle title="One moment..." />;

  const newestFirst = [...feed].sort((a, b) => b.createdAt - a.createdAt);
  const waiting = newestFirst.filter((e) => (e.kind === "needs_answer" || e.kind === "asked") && !e.kidAnswer);
  const heldItems = newestFirst.filter((e) => e.kind === "held" && !e.kidAnswer);
  const answered = newestFirst.filter((e) => e.kidAnswer);
  // Counted from the feed so it changes the moment the kid answers.
  const needAnswer = waiting.length;

  return (
    <Screen focusTitle title="This week">
      {demo && <SampleDataNote />}
      {family.status === "active" && (
        <div className="flex flex-col gap-3">
          <Watching whose={`${parentName}'s`} lastCheckedAt={family.lastCheckedAt} />
          <AlertsButton />
        </div>
      )}
      <KidRecapCard recap={recap} needAnswer={needAnswer} parentName={parentName} />

      {family.status === "learning" && (
        <p role="status" className="flex items-center gap-3 rounded-2xl bg-action-tint px-5 py-4 text-lg text-action">
          <Spinner className="h-6 w-6" />
          {`We're reading ${parentName}'s email history. New emails get checked as soon as that's done.`}
        </p>
      )}

      <FeedSection title="Needs your answer" entries={waiting} parentName={parentName}>
        {`Nothing to answer. We'll let you know when ${parentName} gets an email we're not sure about, or asks you about one.`}
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
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      {entries.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line-strong/50 px-5 py-4 text-lg text-muted">{children}</p>
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
  const asked = entry.kind === "asked";
  const status = asked ? `${parentName} asked` : fake ? "Looks fake" : "Not sure";
  // A short name for screen readers, instead of the whole card read as one run-on sentence.
  const name = `Says it's from ${claimedSender(verdict)}. ${status}.${
    kidAnswer ? ` You said it's ${kidAnswer.answer === "scam" ? "a scam" : "fine"}.` : ""
  }`;
  return (
    <Link
      href={`/kid/item/${entry._id}`}
      aria-label={name}
      className="group flex items-center gap-4 rounded-3xl border border-line bg-surface p-5 shadow-card transition-shadow [overflow-wrap:anywhere] hover:shadow-lift"
    >
      <span
        aria-hidden="true"
        className={`hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl min-[420px]:flex ${
          asked ? "bg-action-tint text-action" : fake ? "bg-fake-tint text-fake" : "bg-unsure-tint text-unsure"
        }`}
      >
        <Icon name={asked ? "heart" : fake ? "shield" : "alert"} className="h-7 w-7" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* Said in words, so color is never the only clue. */}
          <Pill tone={asked ? "action" : fake ? "fake" : "unsure"}>
            {status}
            {/* action is the decision; actionAppliedAt means Gmail really moved it (A6). */}
            {verdict.action === "held" && verdict.actionAppliedAt === undefined && " · Being held…"}
          </Pill>
          <span className="text-base text-muted">
            <TimeAgo at={entry.createdAt} />
          </span>
        </div>
        <p className="mt-2 text-xl font-bold">{`Says it's from ${claimedSender(verdict)}`}</p>
        {verdict.subject && <p className="line-clamp-2 text-lg text-muted">{`“${senderText(verdict.subject)}”`}</p>}
        {kidAnswer && (
          <p className="mt-2 flex items-center gap-2 text-base font-semibold text-ink">
            <Icon name="check" className="h-5 w-5 text-real" />
            {kidAnswer.answer === "scam" ? `You said it's a scam. ${parentName} was told.` : `You said it's fine.`}
          </p>
        )}
      </div>
      {/* Just a visual hint; the whole card is the link. */}
      <Icon name="chevronRight" className="h-7 w-7 text-muted transition-colors group-hover:text-action" />
    </Link>
  );
}
