"use client";

// The AI investigator's check of one flagged email (A7), for the kid's email page (B9).
// Live from api.investigations.forFeedItem: steps appear as the agent appends them, then its
// conclusion. Demo mode replays the sample investigations below step by step instead.

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Investigation, InvestigationStep } from "../../convex/contract";
import { useDemoMode } from "./demoMode";

export type InvestigationView = Omit<Investigation, "familyId" | "verdictId">;

const T0 = 0; // step times are relative; only their order matters on screen
const step = (kind: InvestigationStep["kind"], text: string, i: number): InvestigationStep => ({
  at: T0 + i,
  kind,
  text,
});

/** Sample investigations for the demo's feed items, written the way A7 will write them. */
export const SAMPLE_INVESTIGATIONS: Record<string, InvestigationView> = {
  mock_feed_asked: {
    status: "done",
    startedAt: T0,
    finishedAt: T0 + 6,
    steps: [
      step("check", "Checking who really sent this: kp.org.", 0),
      step("finding", "It really came from Kaiser's mail servers.", 1),
      step("search", "Looking up Kaiser Permanente's official email addresses", 2),
      step("finding", "Kaiser sends its emails from kp.org, and Mom has gotten them since 2023.", 3),
      step("check", "kaiserpermanente.org is Kaiser's own website.", 4),
    ],
    conclusion: {
      level: "real",
      summary: "This one is real: Kaiser letting Mom know her test results are ready.",
      sender: { verdict: "genuine", reason: "It's from Kaiser's real address, the one Mom has gotten mail from for years." },
      links: [{ site: "kaiserpermanente.org", verdict: "safe", reason: "Kaiser's own sign-in page." }],
      suggestion: "Tell Mom it's real. She can also use the Kaiser button on her Anchor page.",
    },
    sources: [{ title: "Kaiser Permanente: Protect yourself from fraud", url: "https://healthy.kaiserpermanente.org/" }],
  },
  mock_feed_chase: {
    status: "done",
    startedAt: T0,
    finishedAt: T0 + 9,
    steps: [
      step("check", "Checking whether this email really came from Chase's mail servers", 0),
      step("finding", "It failed Chase's sender check. Chase didn't send it.", 1),
      step("search", "Looking up Chase's official email addresses", 2),
      step("visit", "Reading Chase's page about how to spot fake emails", 3),
      step("finding", "Chase only emails from chase.com. This came from chase-secure-login.co.", 4),
      step("check", "Checking how old the website in the button is", 5),
      step("finding", "chase-secure-login.co was registered 3 days ago", 6),
      step("visit", "Looking at where the button really goes (tracking codes removed)", 7),
      step("finding", "It's a copy of Chase's sign-in page asking for a password", 8),
      step("check", "Checking Mom's email history for Chase", 9),
    ],
    conclusion: {
      level: "fake",
      summary: "A fake Chase email: it's from a copycat website made 3 days ago, and Mom has never banked at Chase.",
      sender: { verdict: "impostor", reason: "Says it's Chase, but Chase only sends from chase.com." },
      links: [
        {
          site: "chase-secure-login.co",
          verdict: "dangerous",
          reason: "A 3-day-old copy of Chase's sign-in page that asks for a password.",
        },
      ],
      suggestion: "Nothing to do. It's already held, and Mom has no Chase account.",
    },
    sources: [{ title: "Chase: How to spot fake emails", url: "https://www.chase.com/digital/resources/privacy-security/security/report-fraud" }],
  },
  mock_feed_usps: {
    status: "done",
    startedAt: T0,
    finishedAt: T0 + 7,
    steps: [
      step("search", "Looking up the Post Office's official email addresses", 0),
      step("visit", "Reading USPS's page about delivery text and email scams", 1),
      step("finding", "USPS sends tracking emails from usps.com, not usps-informed.com", 2),
      step("check", "Checking how old usps-informed.com is", 3),
      step("finding", "usps-informed.com was registered 41 days ago", 4),
      step("visit", "Looking at where the tracking link really goes (tracking codes removed)", 5),
      step("finding", "The page asks for a card number to \"pay a redelivery fee\"", 6),
      step("check", "Checking Mom's history for packages from USPS", 7),
    ],
    conclusion: {
      level: "fake",
      summary: "This isn't from the Post Office. The link asks for a card number for a \"redelivery fee\", a common scam.",
      sender: { verdict: "impostor", reason: "USPS sends from usps.com. This came from a 41-day-old lookalike." },
      links: [
        {
          site: "usps-informed.com",
          verdict: "dangerous",
          reason: "A new lookalike site that asks for a card number.",
        },
      ],
      suggestion: "Tap \"It's a scam\". If Mom is expecting a package, she can check it on usps.com.",
    },
    sources: [{ title: "USPS: Smishing and email scams", url: "https://www.uspis.gov/news/scam-article/smishing" }],
  },
  mock_feed_injection: {
    status: "done",
    startedAt: T0,
    finishedAt: T0 + 5,
    steps: [
      step("check", "Checking whether this email really came from Wells Fargo", 0),
      step("finding", "It failed Wells Fargo's sender check", 1),
      step("finding", "It hides text meant to trick our checker. We ignored it.", 2),
      step("visit", "Looking at where the link really goes (tracking codes removed)", 3),
      step("finding", "The short link leads to wellsfargo-help.net, not Wells Fargo", 4),
      step("check", "Checking Mom's history: her real Wells Fargo emails come from wellsfargo.com", 5),
    ],
    conclusion: {
      level: "fake",
      summary: "A Wells Fargo lookalike that tried to trick our checker with hidden text. The trick didn't work.",
      sender: { verdict: "impostor", reason: "Mom's real Wells Fargo emails come from wellsfargo.com." },
      links: [
        { site: "wellsfargo-help.net", verdict: "dangerous", reason: "Not Wells Fargo. The link hides where it goes." },
      ],
    },
  },
};

const STEP_MS = 900;

/**
 * The investigation for one feed item, or null when there isn't one (yet), or undefined while
 * loading. In demo mode it replays the sample: steps arrive one by one, then the conclusion.
 */
export function useInvestigation(feedItemId: string, known = true): InvestigationView | null | undefined {
  const demo = useDemoMode();
  // `known`: only ask once the feed confirms this id. The id comes from the address, and the
  // query rejects a malformed one with an error, which would crash the page.
  const live = useQuery(
    api.investigations.forFeedItem,
    demo || !known ? "skip" : { feedItemId: feedItemId as Id<"feedItems"> },
  );
  const sample = demo ? SAMPLE_INVESTIGATIONS[feedItemId] : undefined;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!sample) return;
    const total = sample.steps.length;
    const timer = setInterval(() => {
      setShown((n) => {
        if (n > total) clearInterval(timer);
        return Math.min(n + 1, total + 1);
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [sample]);

  if (!demo) return known ? live : null;
  if (!sample) return null;
  if (shown > sample.steps.length) return sample;
  return { status: "running", startedAt: sample.startedAt, steps: sample.steps.slice(0, shown) };
}
