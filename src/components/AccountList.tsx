// My Accounts, shared by the kid page and the parent's big-text "front door" (B4, B8).
// Same rows for both: "the parent sees exactly what the kid sees".

import type { FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";
import { BigButton, Card } from "@/components/ui";
import { useFlip } from "@/components/useFlip";
import type { api } from "../../convex/_generated/api";
import type { Account, AccountSignal } from "../../convex/contract";

/** An account as the queries return it, plus A8's ranking fields (optional until A8 lands). */
export type AccountView = FunctionReturnType<typeof api.accounts.myAccounts>[number] &
  Partial<Pick<Account, "rank" | "signals" | "lastActivity">>;

/** Most important first: A8's rank, then how much mail, then name. */
export function byImportance(a: AccountView, b: AccountView): number {
  return (b.rank ?? 0) - (a.rank ?? 0) || b.messageCount - a.messageCount || a.orgName.localeCompare(b.orgName);
}

// The parent's groups, in plain words. Medicare and Social Security sit in "Other".
const GROUPS = ["Money", "Health", "Bills", "Shopping", "Other"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_OF: Record<AccountView["category"], Group> = {
  bank: "Money",
  insurance: "Money",
  health: "Health",
  pharmacy: "Health",
  utility: "Bills",
  shopping: "Shopping",
  government: "Other",
  other: "Other",
};

/** Accounts in groups; the group holding the most important account comes first. */
export function groupAccounts(accounts: AccountView[]): { group: Group; accounts: AccountView[] }[] {
  const sorted = [...accounts].sort(byImportance);
  const groups = new Map<Group, AccountView[]>();
  for (const a of sorted) {
    const g = GROUP_OF[a.category];
    groups.set(g, [...(groups.get(g) ?? []), a]);
  }
  return [...groups.entries()]
    .sort(([ga, a], [gb, b]) => byImportance(a[0], b[0]) || GROUPS.indexOf(ga) - GROUPS.indexOf(gb))
    .map(([group, list]) => ({ group, accounts: list }));
}

// Why we think Mom really uses it, in plain words, most telling first.
const SIGNAL_WORDS: Record<AccountSignal, string> = {
  bill: "Bills",
  statement: "Statements",
  appointment: "Appointments",
  order: "Orders",
  sign_in: "Sign-in alerts",
  security: "Security alerts",
  password: "Password changes",
  code: "Sign-in codes",
};
const SIGNAL_ORDER = Object.keys(SIGNAL_WORDS) as AccountSignal[];

/** "Bills · Statements", or null before A8 says why. */
export function usedFor(signals: AccountSignal[] | undefined): string | null {
  if (!signals?.length) return null;
  const words = SIGNAL_ORDER.filter((s) => signals.includes(s)).map((s) => SIGNAL_WORDS[s]);
  return words.slice(0, 2).join(" · ");
}

const CATEGORY: Record<AccountView["category"], string> = {
  bank: "Bank",
  health: "Health care",
  pharmacy: "Pharmacy",
  insurance: "Insurance",
  utility: "Utility",
  government: "Government",
  shopping: "Shopping",
  other: "Other",
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * The time to measure "how long" from, read once when the list first shows. Read here, not in
 * the page: lists only render in the browser after data arrives, while pages are also
 * prerendered at build time, where Next.js refuses a clock value. Tests pass a fixed `now`.
 */
function useNow(now?: number): number {
  const [mountedAt] = useState(() => Date.now());
  return now ?? mountedAt;
}

/** "2 years", "9 months", "a few weeks": how long this sender has been in the inbox. */
export function howLong(firstSeen: number, now: number): string {
  const days = Math.max(0, (now - firstSeen) / DAY);
  if (days >= 365) {
    // Rounded, so the full 2-year import window (about 720 days) reads "2 years", not "1 year".
    const years = Math.round(days / 365);
    return years === 1 ? "1 year" : `${years} years`;
  }
  const months = Math.floor(days / 30.4);
  if (months >= 1) return months === 1 ? "1 month" : `${months} months`;
  return days >= 14 ? "a few weeks" : "a few days";
}

/**
 * The login link, only if it's https on one of the org's own domains. A4 already promises
 * this; checking again here costs nothing, and these are the links we tell a parent to trust.
 */
export function trustedLoginUrl(account: Pick<AccountView, "loginUrl" | "officialDomains">): string | null {
  if (!account.loginUrl) return null;
  let url: URL;
  try {
    url = new URL(account.loginUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // A real sign-in page needs no username, password or odd port in its address.
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const official = account.officialDomains.some((raw) => {
    const d = raw.toLowerCase().replace(/^\.+|\.+$/g, "");
    return d !== "" && (host === d || host.endsWith(`.${d}`));
  });
  return official ? url.href : null;
}

/** Kid version: compact rows with the facts a kid wants at a glance. */
export function KidAccountList({
  accounts,
  parentName,
  now,
}: {
  accounts: AccountView[];
  parentName: string;
  now?: number;
}) {
  const at = useNow(now);
  return (
    <ul className="flex flex-col gap-4">
      {[...accounts].sort(byImportance).map((a) => {
        const login = trustedLoginUrl(a);
        return (
          <li key={a._id}>
            <Card>
              <h2 className="text-xl font-bold">{a.orgName}</h2>
              <p className="text-muted">
                {`${CATEGORY[a.category]} · In ${parentName}'s email for ${howLong(a.firstSeen, at)} · ${a.messageCount} emails`}
              </p>
              {/* Only the verified login page from our directory, never a link from an email. */}
              {login && (
                <a
                  href={login}
                  className="mt-2 inline-flex min-h-tap items-center font-bold text-action underline"
                  rel="noopener noreferrer"
                >
                  {`Go to ${a.orgName}`}
                </a>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** Parent version: big text, one big button per place, nothing else to read. */
export function ParentAccountList({ accounts, now }: { accounts: AccountView[]; now?: number }) {
  const at = useNow(now);
  const groups = groupAccounts(accounts);
  // Re-run the motion whenever the order or the set of accounts changes (live import, A8).
  const root = useRef<HTMLDivElement>(null);
  useFlip(root, groups.map((g) => `${g.group}:${g.accounts.map((a) => a._id).join(",")}`).join("|"));

  return (
    <div ref={root} className="flex flex-col gap-8">
      {groups.map(({ group, accounts: list }) => (
        <section key={group} data-flip-key={`group-${group}`} aria-labelledby={`group-${group}`} className="flex flex-col gap-4">
          <h2 id={`group-${group}`} className="text-3xl font-bold">
            {group}
          </h2>
          <ul className="flex flex-col gap-4">
            {list.map((a) => {
              const login = trustedLoginUrl(a);
              const why = usedFor(a.signals);
              return (
                <li key={a._id} data-flip-key={a._id}>
                  <Card>
                    <h3 className="text-2xl font-bold">{a.orgName}</h3>
                    {why && <p className="text-lg">{why}</p>}
                    <p className="mb-4 text-lg text-muted">{`In your email for ${howLong(a.firstSeen, at)}`}</p>
                    {login ? (
                      <BigButton href={login}>{`Open ${a.orgName}`}</BigButton>
                    ) : (
                      <p className="text-lg text-muted">We don&apos;t have a sign-in page for this one yet.</p>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
