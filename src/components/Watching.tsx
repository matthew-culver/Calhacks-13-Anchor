"use client";

import { timeAgo, useClientNow } from "@/components/TimeAgo";

// The heartbeat: Anchor is really watching, and when it last looked. If the checks stop (Google
// trouble, an expired connection), it says so instead of quietly looking fine.

const STALE_MS = 10 * 60 * 1000;

export function Watching({ whose, lastCheckedAt }: { whose: string; lastCheckedAt?: number }) {
  const now = useClientNow();
  const stale = now !== null && lastCheckedAt !== undefined && now - lastCheckedAt > STALE_MS;
  if (stale) {
    return (
      <p role="status" className="flex items-center gap-3 text-lg font-semibold text-unsure">
        <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-unsure" />
        {`We haven't been able to check ${whose} inbox for a while. We'll keep trying.`}
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg">
      <span aria-hidden="true" className="relative flex h-3 w-3 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-real opacity-40 motion-safe:animate-ping" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-real" />
      </span>
      <span className="font-semibold text-real">{`Watching ${whose} inbox`}</span>
      {now !== null && lastCheckedAt !== undefined && (
        <span className="text-muted">{`· checked ${timeAgo(lastCheckedAt, now)}`}</span>
      )}
    </p>
  );
}
