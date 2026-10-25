// Small line icons, drawn here so the app needs no icon package and loads nothing from other
// sites. Decorative: every icon sits next to words that say the same thing, so screen readers
// skip them (aria-hidden).

const PATHS = {
  anchor: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 7.5V21M8.5 11h7M4.5 13.5a7.5 7.5 0 0 0 15 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  shield: <path d="M12 3 19 6v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3Z" />,
  shieldCheck: (
    <>
      <path d="M12 3 19 6v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  flag: <path d="M5 21V4h11l-2 4 2 4H5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  alert: <path d="M12 4 21 20H3L12 4ZM12 10v4M12 17h.01" />,
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 17h.01" />
    </>
  ),
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  arrowLeft: <path d="M19 12H5m6-6-6 6 6 6" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  heart: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" />,
  sparkle: <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />,
  external: <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />,
  inbox: <path d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-8Z" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-6 w-6" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}

/** A turning ring for "still working". Stands still when "reduce motion" is on. */
export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" className={`shrink-0 motion-safe:animate-spin-slow ${className}`}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.2} strokeWidth={3} />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

/** The Anchor mark: a white anchor on the brand navy. */
export function LogoMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-brand text-white ${className}`}>
      <Icon name="anchor" className="h-[60%] w-[60%]" />
    </span>
  );
}
