"use client";

import Link from "next/link";
import { TimeAgo } from "@/components/TimeAgo";
import { BigButton, Card, Screen } from "@/components/ui";
import { useFeed, type FeedEntry } from "@/shared/feedApi";
import { mockFamily, mockRecap } from "@/shared/mock";

// The kid's feed (B3): emails that need an answer first, then the ones we held.
// B5 adds the full recap card. Feed and family are mock data until A5 exists (src/shared/feedApi.ts).
export default function KidFeed() {
  const feed = useFeed();
  const { checked, held, needAnswer } = mockRecap;
  const parentName = mockFamily.parentName;

  if (feed === undefined) return <Screen title="One moment..." />;

  const newestFirst = [...feed].sort((a, b) => b.createdAt - a.createdAt);
  const waiting = newestFirst.filter((e) => e.kind === "needs_answer" && !e.kidAnswer);
  const heldItems = newestFirst.filter((e) => e.kind === "held" && !e.kidAnswer);
  const answered = newestFirst.filter((e) => e.kidAnswer);

  return (
    <Screen title="This week">
      <Card>
        <ul className="flex flex-col gap-2 text-xl font-bold">
          <li>{`${checked} checked`}</li>
          <li className="text-fake">{`${held} held`}</li>
          <li className="text-unsure">
            {`${needAnswer} ${needAnswer === 1 ? "needs" : "need"} an answer`}
          </li>
        </ul>
      </Card>

      <FeedSection title="Needs your answer" entries={waiting} parentName={parentName}>
        {`Nothing to answer. We'll let you know when ${parentName} gets an email we're not sure about.`}
      </FeedSection>
      <FeedSection title="We held these" entries={heldItems} parentName={parentName}>
        Nothing held this week.
      </FeedSection>
      {answered.length > 0 && (
        <FeedSection title="You answered" entries={answered} parentName={parentName} />
      )}

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
  const who = verdict.claimedOrg ?? verdict.fromName ?? verdict.fromDomain;
  const tone = verdict.level === "fake" ? "border-fake bg-fake-tint" : "border-unsure bg-unsure-tint";
  return (
    <Link
      href={`/kid/item/${entry._id}`}
      className={`block rounded-2xl border-2 p-5 hover:shadow-md ${tone}`}
    >
      <p className="text-xl font-bold">{`Says it's from ${who}`}</p>
      {verdict.subject && <p className="text-lg">{`“${verdict.subject}”`}</p>}
      <p className="text-muted">
        <TimeAgo at={entry.createdAt} />
      </p>
      {kidAnswer && (
        <p className="mt-2 font-bold">
          {kidAnswer.answer === "scam" ? `You said it's a scam. ${parentName} was told.` : `You said it's fine.`}
        </p>
      )}
      <span className="mt-2 inline-block font-bold text-action underline">Look closer</span>
    </Link>
  );
}
