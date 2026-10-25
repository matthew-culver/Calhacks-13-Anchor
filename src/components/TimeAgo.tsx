"use client";

import { useSyncExternalStore } from "react";

// "20 minutes ago". Only in the browser: pages are also prerendered at build time, where
// Next.js refuses a clock value, so the server render shows nothing and the time fills in.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function timeAgo(at: number, now: number): string {
  const ago = Math.max(0, now - at);
  if (ago < MIN) return "just now";
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (ago < HOUR) return plural(Math.floor(ago / MIN), "minute");
  if (ago < DAY) return plural(Math.floor(ago / HOUR), "hour");
  return plural(Math.floor(ago / DAY), "day");
}

// One shared clock: every row measures from the same moment, and it ticks once a minute
// while anything is on screen. With nothing on screen it stops and forgets the time.
let clock: number | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    clock = Date.now();
    listeners.forEach((l) => l());
  }, MIN);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
      clock = undefined;
    }
  };
}

const readClock = () => (clock ??= Date.now());

/** The current time to the minute, or null on the server and the first paint. */
export function useClientNow(): number | null {
  return useSyncExternalStore(subscribe, readClock, () => null);
}

export function TimeAgo({ at }: { at: number }) {
  const now = useClientNow();
  return now === null ? null : <>{timeAgo(at, now)}</>;
}
