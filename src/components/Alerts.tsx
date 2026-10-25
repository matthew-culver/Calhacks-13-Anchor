"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import type { FeedEntry } from "@/shared/feedApi";
import { claimedSender } from "@/shared/senderText";

// The kid's "phone buzzes once": a system notification when a new email lands in the feed,
// while a kid page is open in any tab. Only for new items (never the ones already there when
// the page opened), once each, and only after the kid turns alerts on.

// Android browsers have Notification but refuse to make one outside a service worker, so they
// get no button, and an alert a browser refuses never breaks the page.
const supported = () => typeof window !== "undefined" && "Notification" in window && !/Android/i.test(navigator.userAgent);

/** Shows a system notification. False if this browser refuses to. */
function notify(title: string, body: string, tag?: string, onClick?: () => void): boolean {
  try {
    const n = new Notification(title, { body, tag });
    if (onClick) n.onclick = onClick;
    return true;
  } catch {
    return false;
  }
}

function alertFor(entry: FeedEntry, parentName: string): { title: string; body: string } {
  const who = `Says it's from ${claimedSender(entry.verdict)}`;
  if (entry.kind === "asked") return { title: `${parentName} asked you about an email`, body: who };
  if (entry.kind === "held") return { title: `Anchor held a fake email for ${parentName}`, body: who };
  return { title: `An email for ${parentName} needs your answer`, body: who };
}

/** Notify about feed items that arrive after the page opened. Every kid page calls this. */
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
      notify(title, body, e._id, () => {
        window.focus();
        // A full page load: the click can come while this tab sits in the background.
        window.location.assign(new URL(`/kid/item/${e._id}`, window.location.origin).href);
      });
    }
  }, [feed, parentName]);
}

type State = NotificationPermission | "unsupported" | "refused";

const readPermission = (): State => (supported() ? Notification.permission : "unsupported");
const noSubscription = () => () => {};

/** "Get alerts on this computer": asks once, on a tap (browsers require that). */
export function AlertsButton() {
  const current = useSyncExternalStore(noSubscription, readPermission, () => "unsupported" as const);
  const [answered, setAnswered] = useState<State | null>(null);
  const state = answered ?? current;

  const turnOn = async () => {
    const permission = await Notification.requestPermission();
    // A first alert right away shows the kid what one looks like, and proves this browser shows them.
    if (permission === "granted" && !notify("Alerts are on", "You'll get one like this when an email needs a look.")) {
      setAnswered("refused");
      return;
    }
    setAnswered(permission);
  };

  if (state === "unsupported" || (state === "denied" && answered === null)) return null;
  if (state !== "default") {
    const text =
      state === "granted"
        ? "Alerts are on for this computer."
        : state === "denied"
          ? "Alerts are blocked in this browser's settings. This page still updates on its own."
          : "This browser can't show alerts. This page still updates on its own.";
    return (
      <p role="status" className="flex items-center gap-2 text-base text-muted">
        {state === "granted" && <Icon name="check" className="h-5 w-5 text-real" />}
        {text}
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void turnOn()}
      className="inline-flex min-h-tap items-center gap-2 self-start rounded-xl border-2 border-line-strong bg-surface px-4 text-lg font-semibold text-action hover:border-action hover:bg-action-tint"
    >
      <Icon name="mail" className="h-5 w-5" />
      Get alerts on this computer
    </button>
  );
}
