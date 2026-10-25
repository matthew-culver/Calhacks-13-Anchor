"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import type { FeedEntry } from "@/shared/feedApi";
import { claimedSender } from "@/shared/senderText";

// The kid's "phone buzzes once": a system notification when a new email lands in the feed,
// while the kid's page is open in any tab. Only for new items (never the ones already there when
// the page opened), once each, and only after the kid turns alerts on.

const supported = () => typeof window !== "undefined" && "Notification" in window;

function alertFor(entry: FeedEntry, parentName: string): { title: string; body: string } {
  const who = `Says it's from ${claimedSender(entry.verdict)}`;
  if (entry.kind === "asked") return { title: `${parentName} asked you about an email`, body: who };
  if (entry.kind === "held") return { title: `Anchor held a fake email for ${parentName}`, body: who };
  return { title: `An email for ${parentName} needs your answer`, body: who };
}

/** Notify about feed items that arrive after the page opened. */
export function useNewItemAlerts(feed: FeedEntry[] | undefined, parentName: string) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!feed) return;
    if (seen.current === null) {
      seen.current = new Set(feed.map((e) => e._id)); // what was already there: no alerts
      return;
    }
    const fresh = feed.filter((e) => !seen.current!.has(e._id) && !e.kidAnswer);
    for (const e of fresh) seen.current.add(e._id);
    if (!supported() || Notification.permission !== "granted") return;
    for (const e of fresh) {
      const { title, body } = alertFor(e, parentName);
      const n = new Notification(title, { body, tag: e._id });
      n.onclick = () => {
        window.focus();
        window.location.assign(`/kid/item/${e._id}`);
      };
    }
  }, [feed, parentName]);
}

const readPermission = (): NotificationPermission | "unsupported" => (supported() ? Notification.permission : "unsupported");
const noSubscription = () => () => {};

/** "Get alerts on this computer": asks once, on a tap (browsers require that). */
export function AlertsButton() {
  const current = useSyncExternalStore(noSubscription, readPermission, () => "unsupported" as const);
  const [answered, setAnswered] = useState<NotificationPermission | null>(null);
  const permission = answered ?? current;
  if (permission === "unsupported" || permission === "denied") return null;
  if (permission === "granted") {
    return (
      <p className="flex items-center gap-2 text-base text-muted">
        <Icon name="check" className="h-5 w-5 text-real" />
        Alerts are on for this computer.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void Notification.requestPermission().then(setAnswered)}
      className="inline-flex min-h-tap items-center gap-2 self-start rounded-xl border-2 border-line-strong bg-surface px-4 text-lg font-semibold text-action hover:border-action hover:bg-action-tint"
    >
      <Icon name="mail" className="h-5 w-5" />
      Get an alert when something needs you
    </button>
  );
}
