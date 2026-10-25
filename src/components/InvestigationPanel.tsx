"use client";

import { Card } from "@/components/ui";
import type { InvestigationView } from "@/shared/investigationApi";
import type { InvestigationStep, LinkFinding } from "../../convex/contract";

// The AI investigator at work (B9): its steps appear live as it checks the email, then the
// conclusion: who really sent it, each link, a suggestion, and the official pages it relied on.
// Plain words only, and never "safe": a link that's fine "Looks fine".

const STEP_MARK: Record<InvestigationStep["kind"], string> = {
  search: "🔎",
  visit: "🌐",
  check: "✓",
  finding: "💡",
};

const LINK: Record<LinkFinding["verdict"], { label: string; className: string }> = {
  safe: { label: "Looks fine", className: "text-real" },
  unknown: { label: "Unknown", className: "text-muted" },
  dangerous: { label: "Dangerous", className: "text-fake" },
};

type Sender = NonNullable<InvestigationView["conclusion"]>["sender"]["verdict"];
const SENDER: Record<Sender, { label: string; className: string }> = {
  genuine: { label: "Really them", className: "text-real" },
  unverified: { label: "Not confirmed", className: "text-unsure" },
  impostor: { label: "Pretending to be someone else", className: "text-fake" },
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

export function InvestigationPanel({ investigation }: { investigation: InvestigationView | null | undefined }) {
  if (!investigation) return null;
  const { status, steps, conclusion, sources } = investigation;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">Our investigation</h2>
      <p role="status" className="text-lg text-muted">
        {status === "running" ? "Still checking…" : status === "failed" ? "We couldn't finish checking this one." : ""}
      </p>

      {conclusion && (
        <Card>
          <div className="flex flex-col gap-4">
            <p className="text-xl font-bold">{conclusion.summary}</p>
            <div>
              <p className="text-lg">
                <span className="font-bold">Sender: </span>
                <span className={`font-bold ${SENDER[conclusion.sender.verdict].className}`}>
                  {SENDER[conclusion.sender.verdict].label}.
                </span>{" "}
                {conclusion.sender.reason}
              </p>
            </div>
            {conclusion.links.length > 0 && (
              <div>
                <p className="text-lg font-bold">{conclusion.links.length === 1 ? "The link" : "The links"}</p>
                <ul className="flex flex-col gap-2">
                  {conclusion.links.map((l, i) => (
                    <li key={`${l.site}-${i}`} className="text-lg">
                      <span className="font-bold">{l.site}</span>
                      {": "}
                      <span className={`font-bold ${LINK[l.verdict].className}`}>{LINK[l.verdict].label}.</span>{" "}
                      {l.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {conclusion.suggestion && (
              <p className="rounded-xl bg-unsure-tint px-4 py-3 text-lg">
                <span className="font-bold">What to do: </span>
                {conclusion.suggestion}
              </p>
            )}
            {sources && sources.length > 0 && (
              <div>
                <p className="text-lg font-bold">Based on</p>
                <ul className="flex flex-col gap-1">
                  {sources.flatMap((s, i) => {
                    const host = httpsHost(s.url);
                    if (!host) return [];
                    // The title comes from the agent; the address shows where the link really goes.
                    return [
                      <li key={`${s.url}-${i}`} className="text-lg">
                        <a href={s.url} rel="noopener noreferrer" className="font-bold text-action underline">
                          {s.title}
                        </a>{" "}
                        <span className="text-muted">({host})</span>
                      </li>,
                    ];
                  })}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {steps.length > 0 && (
        <ol role="log" aria-label="What we did" className="flex flex-col gap-2">
          {steps.map((s, i) => (
            <li key={`${s.at}-${i}`} className="flex gap-3 text-lg motion-safe:animate-fade-in">
              <span aria-hidden="true" className="w-7 shrink-0 text-center">
                {STEP_MARK[s.kind]}
              </span>
              <span className={s.kind === "finding" ? "font-bold" : ""}>{s.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
