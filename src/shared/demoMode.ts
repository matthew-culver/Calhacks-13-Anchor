// Demo mode: the kid screens show the sample family and emails from src/shared/mock.ts
// instead of the live backend, so a demo never depends on live Gmail (CLAUDE.md, demo-data
// risk). Turn it on with ?demo=1 on any page (remembered for this tab) or
// NEXT_PUBLIC_DEMO_MODE=1 for a whole deployment; ?demo=0 turns it off again.

import { useEffect, useSyncExternalStore } from "react";

const KEY = "anchor.demo";

function fromUrl(): "1" | "0" | null {
  const value = new URLSearchParams(window.location.search).get("demo");
  return value === "1" || value === "0" ? value : null;
}

function read(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "1") return true;
  const url = fromUrl();
  if (url) return url === "1";
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** False on the server and on the first paint, then the real answer. */
export function useDemoMode(): boolean {
  const demo = useSyncExternalStore(
    () => () => {},
    read,
    () => process.env.NEXT_PUBLIC_DEMO_MODE === "1",
  );
  // Remember ?demo=1 / ?demo=0 for the rest of this tab.
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
