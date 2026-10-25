// My Accounts, shared by the kid page and the parent's big-text page (B4).
// Same rows for both: "the parent sees exactly what the kid sees".

import type { FunctionReturnType } from "convex/server";
import { BigButton, Card } from "@/components/ui";
import type { api } from "../../convex/_generated/api";

export type AccountView = FunctionReturnType<typeof api.accounts.myAccounts>[number];

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
  const host = url.hostname.toLowerCase();
  const official = account.officialDomains.some((d) => host === d || host.endsWith(`.${d}`));
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
  now: number;
}) {
  return (
    <ul className="flex flex-col gap-4">
      {accounts.map((a) => {
        const login = trustedLoginUrl(a);
        return (
          <li key={a._id}>
            <Card>
              <h2 className="text-xl font-bold">{a.orgName}</h2>
              <p className="text-muted">
                {`${CATEGORY[a.category]} · In ${parentName}'s email for ${howLong(a.firstSeen, now)} · ${a.messageCount} emails`}
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
export function ParentAccountList({ accounts, now }: { accounts: AccountView[]; now: number }) {
  return (
    <ul className="flex flex-col gap-6">
      {accounts.map((a) => {
        const login = trustedLoginUrl(a);
        return (
          <li key={a._id}>
            <Card>
              <h2 className="text-2xl font-bold">{a.orgName}</h2>
              <p className="mb-4 text-lg text-muted">{`In your email for ${howLong(a.firstSeen, now)}`}</p>
              {login ? (
                <BigButton href={login} secondary>{`Open ${a.orgName}`}</BigButton>
              ) : (
                <p className="text-lg text-muted">No sign-in page on file.</p>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
