// Demo mode: the screens show the sample family, emails and accounts from src/shared/mock.ts
// instead of the live backend, so a demo never depends on live Gmail (CLAUDE.md, demo-data
// risk). Turn it on with ?demo=1 (kid pages remember it for this tab) or
// NEXT_PUBLIC_DEMO_MODE=1 for a whole deployment; ?demo=0 always turns it off.

import { useEffect, useSyncExternalStore } from "react";

const KEY = "anchor.demo";

function fromUrl(): "1" | "0" | null {
  const value = new URLSearchParams(window.location.search).get("demo");
  return value === "1" || value === "0" ? value : null;
}

function read(sticky: boolean): boolean {
  // The address always wins, so ?demo=0 can turn off even a demo deployment.
  const url = fromUrl();
  if (url) return url === "1";
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "1") return true;
  if (!sticky) return false;
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const readSticky = () => read(true);
const readFromAddressOnly = () => read(false);
const noSubscription = () => () => {};

/**
 * Whether to show sample data. False on the server and on the first paint (so prerendering
 * never renders sample data or reads the clock), then the real answer.
 *
 * `sticky: false` is for pages a real parent opens from a link (/p/[token]): only ?demo=1 in
 * that address counts, never a demo remembered from an earlier rehearsal in the same tab.
 */
export function useDemoMode({ sticky = true }: { sticky?: boolean } = {}): boolean {
  const demo = useSyncExternalStore(noSubscription, sticky ? readSticky : readFromAddressOnly, () => false);
  // Remember ?demo=1 / ?demo=0 for the rest of this tab (kid pages read it back).
  useEffect(() => {
    const url = fromUrl();
    if (!url) return;
    try {
      sessionStorage.setItem(KEY, url);
    } catch {
      // Blocked storage: demo mode then lasts only while ?demo=1 is in the address.
    }
  }, []);
  return demo;
}
