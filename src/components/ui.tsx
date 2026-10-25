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

const secondaryButtonClass =
  "flex min-h-tap w-full items-center justify-center rounded-2xl border-2 border-action " +
  "bg-page px-6 text-xl font-bold text-action hover:bg-action hover:text-on-action";

/** The one main action on a screen. A link when given `href`, otherwise a button. */
export function BigButton({
  href,
  type = "button",
  onClick,
  disabled,
  secondary,
  children,
}: {
  href?: string;
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  /** Outlined, for a backup action that sits under the main one. */
  secondary?: boolean;
  children: ReactNode;
}) {
  const className = secondary ? secondaryButtonClass : bigButtonClass;
  // Off-site links (like the Gmail connect redirect or an sms: link) get a plain <a>,
  // not client routing.
  if (href && !href.startsWith("/")) {
    return (
      <a href={href} className={className}>
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
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${className} disabled:opacity-60`}
    >
      {children}
    </button>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-line p-6">{children}</div>
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
      <span className="text-lg font-bold">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-tap rounded-2xl border-2 border-line px-4 text-xl"
      />
    </label>
  );
}
