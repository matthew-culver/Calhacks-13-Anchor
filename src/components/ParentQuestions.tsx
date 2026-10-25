"use client";

import { Icon } from "@/components/icons";
import type { FeedEntry } from "@/shared/feedApi";
import { claimedSender, senderText } from "@/shared/senderText";

// The parent's side of asking: the emails they moved to "Check with [kid]", and what the kid
// said. Only the ones they asked about, newest first, so their question never disappears into
// silence.

export function ParentQuestions({ entries, kidName }: { entries: FeedEntry[]; kidName: string }) {
  const asked = entries
    .filter((e) => e.kind === "asked")
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);
  if (asked.length === 0) return null;
  return (
    <section className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-7">
      <h2 className="text-2xl font-bold">{`Your questions for ${kidName}`}</h2>
      <ul className="mt-4 flex flex-col gap-4">
        {asked.map((e) => {
          const about = e.verdict.subject ? `“${senderText(e.verdict.subject)}”` : `The email that says it's from ${claimedSender(e.verdict)}`;
          const answer = e.kidAnswer;
          return (
            <li key={e._id} className="flex items-start gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
              <span
                aria-hidden="true"
                className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  !answer ? "bg-action-tint text-action" : answer.answer === "fine" ? "bg-real-tint text-real" : "bg-fake-tint text-fake"
                }`}
              >
                <Icon name={!answer ? "mail" : answer.answer === "fine" ? "check" : "shield"} className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <p className="text-xl font-semibold">{about}</p>
                <p className="text-xl">
                  {!answer
                    ? `${kidName} is looking at it.`
                    : answer.answer === "fine"
                      ? `${kidName} says it's fine.`
                      : `${kidName} says it's a scam, so we moved it out of your inbox.`}
                </p>
                {answer?.note && <p className="mt-1 text-xl text-muted">{`“${answer.note}”`}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
