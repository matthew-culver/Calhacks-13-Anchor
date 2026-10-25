"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The kid's two places, in the header of every kid page.
const LINKS = [
  { href: "/kid", label: "This week", match: (p: string) => p === "/kid" || p.startsWith("/kid/item") },
  { href: "/kid/accounts", label: "Accounts", match: (p: string) => p.startsWith("/kid/accounts") },
];

export function KidNav({ path: fixed }: { path?: string }) {
  return fixed !== undefined ? <Links path={fixed} /> : <CurrentLinks />;
}

function CurrentLinks() {
  return <Links path={usePathname() ?? ""} />;
}

function Links({ path }: { path: string }) {
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      {LINKS.map((l) => {
        const here = l.match(path);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={here ? "page" : undefined}
            className={`flex min-h-tap items-center rounded-xl px-3 text-lg font-semibold whitespace-nowrap sm:px-4 ${
              here ? "bg-action-tint text-action" : "text-muted hover:bg-page hover:text-ink"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
