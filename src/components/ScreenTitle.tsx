"use client";

import { useEffect, useRef } from "react";

/**
 * A screen's heading that takes focus when it appears. For multi-step flows: when one
 * screen swaps for the next, screen readers and keyboards start at the new title
 * instead of being dropped at the top of the page.
 */
export function ScreenTitle({ className, children }: { className: string; children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [children]);
  return (
    <h1 ref={ref} tabIndex={-1} className={`${className} outline-none`}>
      {children}
    </h1>
  );
}
