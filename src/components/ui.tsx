// Shared building blocks so every screen looks the same: one title,
// a little plain text, and one big action.

import Link from "next/link";
import type { ReactNode } from "react";

export function Screen({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-12">
      <h1 className="text-4xl leading-tight font-bold">{title}</h1>
      {children}
    </main>
  );
}

const bigButtonClass =
  "flex min-h-tap w-full items-center justify-center rounded-2xl bg-action px-6 " +
  "text-xl font-bold text-on-action hover:bg-action-hover";

/** The one main action on a screen. A link when given `href`, otherwise a button. */
export function BigButton({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  // Off-site links (like the Gmail connect redirect) get a plain <a>, not client routing.
  if (href?.startsWith("http")) {
    return (
      <a href={href} className={bigButtonClass}>
        {children}
      </a>
    );
  }
  if (href) {
    return (
      <Link href={href} className={bigButtonClass}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={bigButtonClass}>
      {children}
    </button>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-line p-6">{children}</div>
  );
}
