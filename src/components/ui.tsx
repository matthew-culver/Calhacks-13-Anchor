// Shared building blocks so every screen looks the same: one title,
// a little plain text, and one big action.

import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "./icons";
import { ScreenTitle } from "./ScreenTitle";

const titleClass = "text-4xl leading-tight font-bold tracking-tight text-ink [overflow-wrap:anywhere] sm:text-5xl";

export function Screen({
  title,
  focusTitle,
  before,
  children,
}: {
  title: string;
  /** Move focus to the title when it appears. Use for steps that replace one another. */
  focusTitle?: boolean;
  /** A small line above the title, like a back link or a status. */
  before?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6">
      {before && <div className="-mb-4 flex flex-col items-start gap-4">{before}</div>}
      {focusTitle ? (
        <ScreenTitle className={titleClass}>{title}</ScreenTitle>
      ) : (
        <h1 className={titleClass}>{title}</h1>
      )}
      {children}
    </main>
  );
}

/**
 * The bar at the top of every page: the Anchor name, and on some pages a few links.
 * `home` is where the name links to; null on pages that shouldn't send anyone away (a
 * parent's page, the invite).
 */
export function SiteHeader({ home = "/", children, wide }: { home?: string | null; children?: ReactNode; wide?: boolean }) {
  const brand = (
    <span className="flex items-center gap-3">
      <LogoMark className="h-10 w-10" />
      <span className="text-2xl font-bold tracking-tight text-brand">Anchor</span>
    </span>
  );
  return (
    <header className="border-b border-line bg-surface">
      <div className={`mx-auto flex w-full items-center justify-between gap-4 px-4 py-2 sm:px-6 ${wide ? "max-w-6xl" : "max-w-2xl"}`}>
        {home ? (
          <Link href={home} className="flex min-h-tap items-center rounded-xl">
            {brand}
          </Link>
        ) : (
          <div className="flex min-h-tap items-center">{brand}</div>
        )}
        {children}
      </div>
    </header>
  );
}

// The transparent border is invisible normally, but in Windows High Contrast mode (which drops
// background colors) it's what keeps the button's edge on screen.
const buttonBase =
  "inline-flex min-h-tap items-center justify-center gap-3 rounded-2xl border-2 px-6 text-center text-xl font-semibold transition-colors";
const bigButtonClass = `${buttonBase} border-transparent bg-action text-on-action shadow-card hover:bg-action-hover`;
const secondaryButtonClass = `${buttonBase} border-line-strong bg-surface text-action hover:border-action hover:bg-action-tint`;

/** The one main action on a screen. A link when given `href`, otherwise a button. */
export function BigButton({
  href,
  type = "button",
  onClick,
  disabled,
  secondary,
  fit,
  children,
}: {
  href?: string;
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  /** Outlined, for a backup action that sits under the main one. */
  secondary?: boolean;
  /** As wide as its words instead of the whole column (wide screens only; phones stay full width). */
  fit?: boolean;
  children: ReactNode;
}) {
  const className = `${secondary ? secondaryButtonClass : bigButtonClass} ${fit ? "w-full sm:w-auto" : "w-full"}`;
  // Off-site links (like a login page or an sms: link) get a plain <a>, not client routing.
  // noreferrer: our page addresses can hold secret tokens (/p/<token>), and some in-app
  // browsers would send the full address to the other site.
  if (href && !href.startsWith("/")) {
    return (
      <a href={href} rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  // While busy the button ignores taps (and form submits) but stays focusable: a truly
  // disabled button that has focus drops it to the top of the page (WCAG 2.4.3).
  return (
    <button
      type={type}
      onClick={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onClick?.();
      }}
      aria-disabled={disabled || undefined}
      className={`${className} aria-disabled:opacity-70`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "", compact }: { children: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={`rounded-3xl border border-line bg-surface shadow-card ${compact ? "p-5" : "p-6 sm:p-7"} ${className}`}>
      {children}
    </div>
  );
}

const TONE = {
  fake: "bg-fake-tint text-fake",
  unsure: "bg-unsure-tint text-unsure",
  real: "bg-real-tint text-real",
  action: "bg-action-tint text-action",
  neutral: "bg-page text-muted",
} as const;

/** A short label in a rounded tag: "Looks fake", "Held", "Really them". */
export function Pill({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border border-transparent px-3 py-1 text-base font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  );
}

/** A labeled text box. The label sits above the box, never inside it. */
export function TextField({
  label,
  name,
  type = "text",
  autoComplete,
  placeholder,
  minLength,
  value,
  onChange,
}: {
  label: string;
  name: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  placeholder?: string;
  minLength?: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-lg font-semibold">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-tap rounded-2xl border-2 border-line-strong bg-surface px-4 text-xl placeholder:text-muted/70 focus:border-action"
      />
    </label>
  );
}
