// The weekly recap (B5): "41 checked, 3 held, 0 need an answer", plus the good catches the kid
// and parent made together. The kid's card is compact; the parent's is big, warm sentences.

import type { Infer } from "convex/values";
import { Card } from "@/components/ui";
import type { weeklyRecap } from "../../convex/contract";

export type WeeklyRecap = Infer<typeof weeklyRecap>;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Kid version. `needAnswer` comes from the feed, so it drops the moment the kid answers. */
export function KidRecapCard({
  recap,
  needAnswer,
  parentName,
}: {
  recap: WeeklyRecap | null | undefined;
  needAnswer: number;
  parentName: string;
}) {
  return (
    <Card>
      <ul className="flex flex-col gap-2 text-xl font-bold">
        {recap && <li>{`${recap.checked} checked`}</li>}
        {recap && <li className="text-fake">{`${recap.held} held`}</li>}
        <li className="text-unsure">{`${needAnswer} ${needAnswer === 1 ? "needs" : "need"} an answer`}</li>
      </ul>
      {recap && recap.goodCatches > 0 && (
        <p className="mt-3 text-lg font-bold text-real">
          {`${count(recap.goodCatches, "good catch", "good catches")} with ${parentName} this week.`}
        </p>
      )}
    </Card>
  );
}

/** Parent version: plain sentences in big text, nothing to tap. */
export function ParentRecapCard({ recap, kidName }: { recap: WeeklyRecap; kidName: string }) {
  return (
    <Card>
      <h2 className="mb-3 text-2xl font-bold">This week</h2>
      <ul className="flex flex-col gap-2 text-xl">
        <li>
          {recap.checked === 0
            ? "No new emails yet this week."
            : `We checked ${count(recap.checked, "email", "emails")} for you.`}
        </li>
        <li>
          {recap.held === 0
            ? "Nothing looked fake."
            : `We set aside ${count(recap.held, "fake email", "fake emails")}, so you didn't have to.`}
        </li>
        {recap.goodCatches > 0 && (
          <li className="font-bold text-real">
            {`You and ${kidName} caught ${count(recap.goodCatches, "scam", "scams")} together. Good catch!`}
          </li>
        )}
      </ul>
    </Card>
  );
}
