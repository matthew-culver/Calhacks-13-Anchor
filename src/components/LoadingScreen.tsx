"use client";

import { useEffect, useState } from "react";
import { Screen } from "@/components/ui";

const SLOW_MS = 8000;

/** "One moment...", plus a calm line if it takes long enough that the connection may be the problem. */
export function LoadingScreen() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Screen focusTitle title="One moment...">
      <p role="status" className="text-xl text-muted">
        {slow ? "Still connecting… If this doesn't change in a minute, check your internet connection." : ""}
      </p>
    </Screen>
  );
}
