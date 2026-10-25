// The weekly recap (B5): "41 checked, 3 held, 0 need an answer", plus the good catches the kid
// and parent made together. The kid's card is three numbers at a glance; the parent's is big,
// warm sentences.

import type { Infer } from "convex/values";
import { Icon, type IconName } from "@/components/icons";
import { Card } from "@/components/ui";
import type { weeklyRecap } from "../../convex/contract";

export type WeeklyRecap = Infer<typeof weeklyRecap>;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Stat({ label, value, className = "text-ink" }: { label: string; value: number; className?: string }) {
  return (
    <div className="flex flex-col-reverse justify-end rounded-2xl bg-page px-4 py-3">
      <dt className="text-base font-semibold text-muted">{label}</dt>
      <dd className={`text-4xl leading-tight font-bold tabular-nums ${className}`}>{value}</dd>
    </div>
  );
}

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
      <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        {recap && <Stat label="Checked" value={recap.checked} />}
        {recap && <Stat label="Held" value={recap.held} className="text-fake" />}
        <Stat label={needAnswer === 1 ? "Needs an answer" : "Need an answer"} value={needAnswer} className="text-unsure" />
      </dl>
      {recap && recap.goodCatches > 0 && (
        <p className="mt-4 flex items-center gap-2 text-lg font-semibold text-real">
          <Icon name="heart" className="h-6 w-6" />
          {`${count(recap.goodCatches, "good catch", "good catches")} with ${parentName} this week.`}
        </p>
      )}
    </Card>
  );
}

function Line({ icon, className = "", children }: { icon: IconName; className?: string; children: string }) {
  return (
    <li className={`flex items-start gap-3 ${className}`}>
      <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-real-tint text-real">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Parent version: plain sentences in big text, nothing to tap. */
export function ParentRecapCard({ recap, kidName }: { recap: WeeklyRecap; kidName: string }) {
  return (
    <Card>
      <h2 className="mb-4 text-2xl font-bold">This week</h2>
      <ul className="flex flex-col gap-3 text-xl">
        <Line icon="mail">
          {recap.checked === 0
            ? "No new emails yet this week."
            : `We checked ${count(recap.checked, "email", "emails")} for you.`}
        </Line>
        <Line icon="shieldCheck">
          {recap.held === 0
            ? "Nothing looked fake."
            : `We set aside ${count(recap.held, "fake email", "fake emails")}, so you didn't have to.`}
        </Line>
        {recap.goodCatches > 0 && (
          <Line icon="heart" className="font-bold text-real">
            {`You and ${kidName} caught ${count(recap.goodCatches, "scam", "scams")} together. Good catch!`}
          </Line>
        )}
      </ul>
    </Card>
  );
}
