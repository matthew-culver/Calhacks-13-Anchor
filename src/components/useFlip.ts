"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

// Gentle motion for lists that fill in and re-sort live (B8, B10). Elements marked with
// data-flip-key fade in when they first appear and slide to their new place when the order
// changes ("FLIP": measure before and after, then animate the difference). Positions are
// measured against the nearest marked ancestor, so an account moving with its whole group
// doesn't slide twice. Does nothing for people who ask their device to reduce motion.

type Point = { x: number; y: number };

export function useFlip(container: RefObject<HTMLElement | null>, version: unknown) {
  const last = useRef(new Map<string, Point>());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const next = new Map<string, Point>();

    for (const el of root.querySelectorAll<HTMLElement>("[data-flip-key]")) {
      const key = el.dataset.flipKey!;
      const frame = el.parentElement?.closest<HTMLElement>("[data-flip-key]") ?? root;
      const box = el.getBoundingClientRect();
      const origin = frame.getBoundingClientRect();
      const now = { x: box.left - origin.left, y: box.top - origin.top };
      next.set(key, now);

      if (reduce || typeof el.animate !== "function") continue;
      const before = last.current.get(key);
      if (!before) {
        el.animate(
          [
            { opacity: 0, transform: "translateY(12px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 400, easing: "ease-out" },
        );
      } else if (before.x !== now.x || before.y !== now.y) {
        el.animate(
          [{ transform: `translate(${before.x - now.x}px, ${before.y - now.y}px)` }, { transform: "none" }],
          { duration: 500, easing: "ease-in-out" },
        );
      }
    }
    last.current = next;
  }, [container, version]);
}
