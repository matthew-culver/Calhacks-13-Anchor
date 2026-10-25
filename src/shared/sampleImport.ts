"use client";

// Demo mode's stand-in for A8's live import: the sample accounts arrive in batches the way a
// fast first pass finds them (the senders with the most mail first), ranked roughly at first,
// then the real ranking lands and the list re-sorts. Used by the parent page (B8) and the
// connect screen (B10) so the motion can be shown without a live inbox.

import { useEffect, useState } from "react";
import type { AccountView } from "@/components/AccountList";
import { mockAccounts } from "./mock";

const BATCH = 3;
const STEP_MS = 1200;

// Discovery order: busiest senders first, like a first pass over recent mail.
const FOUND = [...mockAccounts].sort((a, b) => b.messageCount - a.messageCount);
const BATCHES = Math.ceil(FOUND.length / BATCH);

/** The accounts visible after `step` batches. The last step adds the real ranking. */
export function sampleImportStep(step: number): AccountView[] {
  const shown = FOUND.slice(0, Math.min(step, BATCHES) * BATCH);
  if (step > BATCHES) return shown; // final: real ranks from A8
  // Before the deeper pass, all we know is how much mail each one sends.
  return shown.map((a) => ({ ...a, rank: a.messageCount / 10 }));
}

export const SAMPLE_IMPORT_STEPS = BATCHES + 1;

/** Replays the import once while `active`: what's visible so far, and whether it's finished. */
export function useSampleImport(active: boolean): { accounts: AccountView[]; done: boolean } {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setStep((s) => {
        if (s >= SAMPLE_IMPORT_STEPS) {
          clearInterval(timer);
          return s;
        }
        return s + 1;
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [active]);
  return { accounts: active ? sampleImportStep(step) : [], done: step >= SAMPLE_IMPORT_STEPS };
}
