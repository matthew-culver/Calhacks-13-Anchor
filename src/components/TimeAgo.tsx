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

// Read once per page load, so every row measures from the same moment.
let pageNow: number | undefined;
const readNow = () => (pageNow ??= Date.now());

export function TimeAgo({ at }: { at: number }) {
  const now = useSyncExternalStore(
    () => () => {},
    readNow,
    () => null,
  );
  return now === null ? null : <>{timeAgo(at, now)}</>;
}
