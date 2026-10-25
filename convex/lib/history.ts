// Turns email headers into "who does this person really deal with" (A4). Pure: no I/O.
// Input is headers only (From, To, Authentication-Results, date): never bodies.
//
// Trust rules (from the A4 reviews): the sender is the real From mailbox, parsed properly
// (a display name like "alerts@chase.com" <x@evil.co> is evil.co); a message counts as
// authenticated only by the same hardened check the scam pipeline uses (A1's headerAuth:
// Gmail's own top header, aligned with that sender); and an org becomes one of the parent's
// accounts only after repeated authenticated mail, so one triggered email can't plant it.

import { addressParser } from "postal-mime";
import { isPlausibleHost, registrableDomain, brandForDomain } from "../checks/brands";
import { headerAuth } from "../checks/headerAuth";
import type { ParsedEmail } from "../checks/types";
import type { Account, Relationship } from "../contract";
import { orgForDomain } from "./orgDirectory";

export type HeaderRecord = {
  from: string; // raw From header (all From headers joined with ", " if there were several)
  to: string; // raw To header (used for mail the parent sent)
  authResults: string[]; // Authentication-Results headers, top first
  date: number; // ms since epoch
  sent: boolean; // the parent sent it (Gmail SENT label)
};

export type RelationshipRow = Omit<Relationship, "familyId">;
export type AccountRow = Omit<Account, "familyId">;

/** Keep the biggest ones; plenty for the checks, and bounded for one database write. */
export const MAX_RELATIONSHIPS = 500;
/** An org is an account after this many authenticated emails over at least this long... */
export const ACCOUNT_MIN_MESSAGES = 3;
export const ACCOUNT_MIN_SPAN_MS = 14 * 24 * 60 * 60 * 1000;
// ...or after any authenticated email once the parent has written to them.

const MAX_HEADER = 2000; // real From/To headers are far shorter; also bounds parsing cost
const MAX_ADDRESS = 254;

// Personal mailboxes: here the person matters, not the domain.
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "yahoo.co.uk", "yahoo.ca",
  "yahoo.in", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "comcast.net", "att.net", "sbcglobal.net", "bellsouth.net",
  "verizon.net", "cox.net", "charter.net", "rr.com", "optonline.net", "frontier.com", "windstream.net",
  "earthlink.net", "juno.com", "netzero.net", "proton.me", "protonmail.com", "pm.me", "gmx.com",
  "mail.com", "zoho.com", "fastmail.com", "hey.com",
]);

type Mailbox = { address: string; domain: string };

function mailboxes(header: string): Mailbox[] {
  let parsed: ReturnType<typeof addressParser>;
  try {
    parsed = addressParser(header.slice(0, MAX_HEADER));
  } catch {
    return [];
  }
  const out: Mailbox[] = [];
  for (const entry of parsed.flatMap((a) => ("group" in a && a.group ? a.group : [a]))) {
    const address = (("address" in entry && entry.address) || "").trim().toLowerCase();
    const at = address.lastIndexOf("@");
    if (at <= 0 || address.length > MAX_ADDRESS) continue;
    const domain = address.slice(at + 1);
    if (!domain.includes(".") || !isPlausibleHost(domain)) continue;
    out.push({ address, domain });
  }
  return out;
}

/** Lowercased email addresses in a From/To header. */
export function parseAddresses(header: string): string[] {
  return [...new Set(mailboxes(header).map((m) => m.address))];
}

/** The one real sender, or null if there's none or more than one (then we don't guess). */
export function senderOf(fromHeader: string): Mailbox | null {
  const all = mailboxes(fromHeader);
  return all.length === 1 ? all[0] : null;
}

/** Authenticated for this sender, by the same rules as the scam checks (A1 headerAuth). */
export function authenticatedFor(authResults: string[], sender: Mailbox): boolean {
  const email: ParsedEmail = {
    fromName: "",
    fromAddress: sender.address,
    fromDomain: sender.domain,
    multipleFrom: false,
    subject: "",
    authResults,
    text: "",
    links: [],
    hiddenText: [],
    truncated: false,
  };
  return headerAuth(email).status === "pass";
}

export type Key = { kind: "org" | "person"; key: string };

/** How a sender is keyed in `relationships`: by address for personal mailboxes, else by domain. */
export function keyFor(m: Mailbox): Key {
  const registrable = registrableDomain(m.domain);
  if (FREEMAIL.has(registrable)) return { kind: "person", key: m.address };
  return { kind: "org", key: registrable };
}

type Tally = RelationshipRow & { authPassCount: number; authFirst: number; authLast: number };

export function buildHistory(
  records: HeaderRecord[],
  now = Date.now(),
  opts: { selfEmail?: string } = {},
): { relationships: RelationshipRow[]; accounts: AccountRow[] } {
  const self = opts.selfEmail?.toLowerCase();
  const tallies = new Map<string, Tally>();
  const tally = (k: Key): Tally => {
    const id = `${k.kind}:${k.key}`;
    let t = tallies.get(id);
    if (!t) {
      const orgName = k.kind === "org" ? (orgForDomain(k.key)?.name ?? brandForDomain(k.key)?.name) : undefined;
      t = {
        kind: k.kind,
        key: k.key,
        ...(orgName !== undefined && { orgName }),
        firstSeen: Number.POSITIVE_INFINITY,
        lastSeen: 0,
        messageCount: 0,
        authPassRate: 0,
        authPassCount: 0,
        authFirst: Number.POSITIVE_INFINITY,
        authLast: 0,
      };
      tallies.set(id, t);
    }
    return t;
  };
  const seen = (t: Tally, date: number) => {
    t.firstSeen = Math.min(t.firstSeen, date);
    t.lastSeen = Math.max(t.lastSeen, date);
  };

  for (const r of records) {
    const date = Number.isFinite(r.date) && r.date > 0 ? Math.min(r.date, now) : now;
    if (r.sent) {
      for (const m of mailboxes(r.to)) {
        if (m.address === self) continue;
        const t = tally(keyFor(m));
        t.parentSentCount = (t.parentSentCount ?? 0) + 1;
        seen(t, date);
      }
      continue;
    }
    const sender = senderOf(r.from);
    if (!sender || sender.address === self) continue;
    const t = tally(keyFor(sender));
    t.messageCount += 1;
    seen(t, date);
    if (authenticatedFor(r.authResults, sender)) {
      t.authPassCount += 1;
      t.authFirst = Math.min(t.authFirst, date);
      t.authLast = Math.max(t.authLast, date);
    }
  }

  // Nothing received means nothing failed: rate 1. Callers must look at messageCount too.
  const all = [...tallies.values()].map((t) => ({
    ...t,
    authPassRate: t.messageCount === 0 ? 1 : t.authPassCount / t.messageCount,
  }));

  // My Accounts: known orgs with repeated authenticated mail (or a reply from the parent),
  // mostly passing, counted across all of the org's domains. A spoofed or one-off "Chase"
  // never becomes one of the parent's accounts.
  type OrgTally = AccountRow & { authPassCount: number; authFirst: number; authLast: number; sentCount: number };
  const byOrg = new Map<string, OrgTally>();
  for (const t of all) {
    if (t.kind !== "org") continue;
    const org = orgForDomain(t.key);
    if (!org) continue;
    const o = byOrg.get(org.name) ?? {
      orgName: org.name,
      category: org.category,
      officialDomains: org.domains,
      loginUrl: org.loginUrl,
      firstSeen: Number.POSITIVE_INFINITY,
      messageCount: 0,
      authPassCount: 0,
      authFirst: Number.POSITIVE_INFINITY,
      authLast: 0,
      sentCount: 0,
    };
    o.firstSeen = Math.min(o.firstSeen, t.firstSeen);
    o.messageCount += t.messageCount;
    o.authPassCount += t.authPassCount;
    o.authFirst = Math.min(o.authFirst, t.authFirst);
    o.authLast = Math.max(o.authLast, t.authLast);
    o.sentCount += t.parentSentCount ?? 0;
    byOrg.set(org.name, o);
  }
  const accounts: AccountRow[] = [...byOrg.values()]
    .filter(
      (o) =>
        o.authPassCount > 0 &&
        o.authPassCount / Math.max(o.messageCount, 1) >= 0.5 &&
        ((o.authPassCount >= ACCOUNT_MIN_MESSAGES && o.authLast - o.authFirst >= ACCOUNT_MIN_SPAN_MS) || o.sentCount > 0),
    )
    .map(({ orgName, category, officialDomains, loginUrl, firstSeen, messageCount }) => ({
      orgName,
      category,
      officialDomains,
      ...(loginUrl !== undefined && { loginUrl }),
      firstSeen,
      messageCount,
    }))
    .sort((a, b) => a.orgName.localeCompare(b.orgName));

  const relationships = all
    .sort((a, b) => b.messageCount + (b.parentSentCount ?? 0) - (a.messageCount + (a.parentSentCount ?? 0)))
    .slice(0, MAX_RELATIONSHIPS)
    .map((t): RelationshipRow => ({
      kind: t.kind,
      key: t.key,
      ...(t.orgName !== undefined && { orgName: t.orgName }),
      firstSeen: t.firstSeen,
      lastSeen: t.lastSeen,
      messageCount: t.messageCount,
      ...(t.parentSentCount !== undefined && { parentSentCount: t.parentSentCount }),
      authPassRate: t.authPassRate,
    }));

  return { relationships, accounts };
}
