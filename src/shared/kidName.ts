// The kid's first name, carried from the invite page to /connect-problem in this tab only.
// That URL must not carry names or tokens (A3 rule), but "Ask Lucas" beats "ask your family".
// Storage can be blocked, so every read falls back to null.

import { useSyncExternalStore } from "react";

const KEY = "anchor.kidName";

export function rememberKidName(name: string) {
  try {
    sessionStorage.setItem(KEY, name);
  } catch {
    // Blocked storage only costs us the name.
  }
}

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The remembered name, or null on the server, on first paint, or if it was never saved. */
export function useRememberedKidName(): string | null {
  return useSyncExternalStore(
    () => () => {},
    read,
    () => null,
  );
}
