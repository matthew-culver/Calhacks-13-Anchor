"use client";

import type { Infer } from "convex/values";
import { Icon, type IconName, Spinner } from "@/components/icons";
import { Card, Pill } from "@/components/ui";
import type { InvestigationView } from "@/shared/investigationApi";
import { senderText } from "@/shared/senderText";
import type { checkResult, InvestigationStep, LinkFinding } from "../../convex/contract";

// The AI investigator at work (B9). While it runs, its steps appear live. When it's done, one
// card says what it found (who really sent it, each link, what to do), and the steps and our
// quick checks fold away under "How we checked", so nothing is said twice.
// Plain words only, and never "safe": a link that's fine "Looks fine". The agent writes from
// scam emails, so its text gets the same cleanup as email text (no hidden direction tricks).

type Check = Infer<typeof checkResult>;

const STEP: Record<InvestigationStep["kind"], { icon: IconName; className: string }> = {
  search: { icon: "search", className: "bg-action-tint text-action" },
  visit: { icon: "globe", className: "bg-action-tint text-action" },
  check: { icon: "shieldCheck", className: "bg-page text-muted" },
  finding: { icon: "flag", className: "bg-unsure-tint text-unsure" },
};

const LINK: Record<LinkFinding["verdict"], { label: string; tone: "real" | "neutral" | "fake" }> = {
  safe: { label: "Looks fine", tone: "real" },
  unknown: { label: "Unknown", tone: "neutral" },
  dangerous: { label: "Dangerous", tone: "fake" },
};

type Sender = NonNullable<InvestigationView["conclusion"]>["sender"]["verdict"];
const SENDER: Record<Sender, { label: string; tone: "real" | "unsure" | "fake" }> = {
  genuine: { label: "Really them", tone: "real" },
  unverified: { label: "Not confirmed", tone: "unsure" },
  impostor: { label: "Pretending to be someone else", tone: "fake" },
};

const CHECK: Record<Check["status"], { icon: IconName; label: string; className: string }> = {
  pass: { icon: "check", label: "Looks right", className: "text-real" },
  warn: { icon: "alert", label: "Odd", className: "text-unsure" },
  fail: { icon: "x", label: "Problem", className: "text-fake" },
  unknown: { icon: "question", label: "Couldn't check", className: "text-muted" },
};

/** The host of an https URL, or null for anything else (javascript:, http:, garbage). */
function httpsHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
}

/** Our fixed checks, each labeled in words so color is never the only clue. */
export function QuickChecks({ title, checks }: { title: string; checks: Check[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">{title}</h2>
      <ul className="flex flex-col gap-3">
        {checks.map((c) => {
          const s = CHECK[c.status];
          return (
            <li key={c.id} className="flex gap-3 text-lg">
              <Icon name={s.icon} className={`mt-1 h-6 w-6 ${s.className}`} />
              <span>
                <span className={`font-semibold ${s.className}`}>{`${s.label}: `}</span>
                {c.plainReason}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Steps({ steps }: { steps: InvestigationStep[] }) {
  return (
    <ol aria-label="What we did" className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={`${s.at}-${i}`} className="flex items-start gap-3 text-lg motion-safe:animate-fade-in">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${STEP[s.kind].className}`}>
            <Icon name={STEP[s.kind].icon} className="h-5 w-5" />
          </span>
          <span className={`pt-0.5 ${s.kind === "finding" ? "font-semibold" : ""}`}>{senderText(s.text)}</span>
        </li>
      ))}
    </ol>
  );
}

/** One finding: what it's about, a label in words, and why. */
function Finding({ about, label, tone, reason }: { about: string; label: string; tone: "real" | "unsure" | "fake" | "neutral"; reason: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-lg font-semibold">{about}</span>
        <Pill tone={tone}>{label}</Pill>
      </div>
      <p className="text-lg text-muted">{reason}</p>
    </div>
  );
}

export function InvestigationPanel({
  investigation,
  checks,
  explanation,
}: {
  investigation: InvestigationView | null | undefined;
  /** Our quick checks, shown under "How we checked". */
  checks?: Check[];
  /** What the rules alone said, for while the investigation runs or if it couldn't finish. */
  explanation?: string;
}) {
  if (!investigation) return null;
  const { status, steps, conclusion, sources } = investigation;
  const running = status === "running";
  const shownSources = (sources ?? []).flatMap((s) => {
    const host = httpsHost(s.url);
    return host ? [{ ...s, host }] : [];
  });

  return (
    <section className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-action-tint text-action">
            {running ? <Spinner className="h-6 w-6" /> : <Icon name="sparkle" className="h-6 w-6" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold">Our investigation</h2>
            <p role="status" className="text-lg text-muted">
              {/* One calm announcement per change: checking, then done (the steps themselves stay quiet). */}
              {running
                ? "Still checking…"
                : status === "failed"
                  ? "We couldn't finish checking this one."
                  : "Finished checking. Here's what we found."}
            </p>
          </div>
        </div>

        {running && (
          <div className="mt-6 flex flex-col gap-5">
            {explanation && <p className="text-lg">{explanation}</p>}
            <Steps steps={steps} />
          </div>
        )}

        {!running && !conclusion && explanation && <p className="mt-5 text-xl">{explanation}</p>}

        {conclusion && (
          <div className="mt-6 flex flex-col gap-4">
            <p className="text-2xl leading-snug font-semibold">{senderText(conclusion.summary)}</p>
            <Finding
              about="Sender"
              label={SENDER[conclusion.sender.verdict].label}
              tone={SENDER[conclusion.sender.verdict].tone}
              reason={senderText(conclusion.sender.reason)}
            />
            {conclusion.links.map((l, i) => (
              <Finding
                key={`${senderText(l.site)}-${i}`}
                about={senderText(l.site)}
                label={LINK[l.verdict].label}
                tone={LINK[l.verdict].tone}
                reason={senderText(l.reason)}
              />
            ))}
            {conclusion.suggestion && (
              <div className="mt-2 flex gap-3 rounded-2xl bg-action-tint px-5 py-4 text-lg text-ink">
                <Icon name="flag" className="mt-1 h-6 w-6 text-action" />
                <p>
                  <span className="font-semibold">What to do: </span>
                  {senderText(conclusion.suggestion)}
                </p>
              </div>
            )}
            {shownSources.length > 0 && (
              <div className="text-base text-muted">
                <p className="font-semibold">Based on</p>
                <ul className="flex flex-col gap-1">
                  {shownSources.map((s, i) => (
                    // The title comes from the agent; the address shows where the link really goes.
                    <li key={`${s.url}-${i}`}>
                      <a href={s.url} rel="noopener noreferrer" className="font-semibold text-action underline">
                        {senderText(s.title)}
                      </a>{" "}
                      ({s.host})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      {(!running && steps.length > 0) || (checks && checks.length > 0) ? (
        <details className="group rounded-3xl border border-line bg-surface shadow-card">
          <summary className="flex min-h-tap cursor-pointer items-center justify-between gap-3 rounded-3xl px-6 py-4 text-xl font-semibold">
            How we checked
            <Icon name="chevronDown" className="details-chevron h-6 w-6 text-muted transition-transform" />
          </summary>
          <div className="flex flex-col gap-6 border-t border-line px-6 py-5">
            {!running && steps.length > 0 && <Steps steps={steps} />}
            {checks && checks.length > 0 && <QuickChecks title="Our quick checks" checks={checks} />}
            <p className="flex gap-2 text-base text-muted">
              <Icon name="shieldCheck" className="mt-0.5 h-5 w-5" />
              Our fixed checks decide first. The AI can make a verdict stricter, and it can clear an unsure
              one only when our own records show it&apos;s from the real company. It treats the email as
              evidence, never as instructions.
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
}
