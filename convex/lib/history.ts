// Turns email headers into "who does this person really deal with" (A4). Pure: no I/O.
// Input is headers only (From, To, Subject, Authentication-Results, date): never bodies.
//
// Trust rules (from the A4 reviews): the sender is the real From mailbox, parsed properly
// (a display name like "alerts@chase.com" <x@evil.co> is evil.co); a message counts as
// authenticated only by the same hardened check the scam pipeline uses (A1's headerAuth:
// Gmail's own top header, aligned with that sender); and an org becomes one of the parent's
// accounts only after repeated authenticated mail, so one triggered email can't plant it.
//
// A8 (real use, not volume): an account also needs account-type mail (sign-in alerts,
// statements, bills, appointments...), spotted from the Subject of authenticated mail. The
// subject is read here in memory and never returned, so it is never stored. Accounts are
// ranked by those signals, how recent they are and how much the category matters; one with
// only marketing or receipts, or with nothing in over a year, isn't shown.
//
// Companies outside our curated directory can be accounts too, but a domain that passes email
// authentication only proves who sent the mail, not that they're a real company Mom uses: a
// scammer can own one. So they need much more: half a year of authenticated account mail from
// an automated mailbox (no "she replied once" shortcut), a plain name that matches their own
// address and claims no company we know, and never a shared platform anyone can send from
// (zendesk.com, salesforce.com...). They rank as "other" whatever category is found later.

import { addressParser } from "postal-mime";
import {
  brandForDomain,
  brandInName,
  isOfficialFor,
  isPlausibleHost,
  lookalikeOf,
  registrableDomain,
} from "../checks/brands";
import { headerAuth } from "../checks/headerAuth";
import { foldText } from "../checks/text";
import type { ParsedEmail } from "../checks/types";
import type { Account, AccountCategory, AccountSignal, Relationship } from "../contract";
import { ORGS, orgForDomain } from "./orgDirectory";

export type HeaderRecord = {
  from: string; // raw From header (all From headers joined with ", " if there were several)
  to: string; // raw To header (used for mail the parent sent)
  authResults: string[]; // Authentication-Results headers, top first
  date: number; // ms since epoch
  sent: boolean; // the parent sent it (Gmail SENT label)
  subject?: string; // A8: read in memory to spot account mail, never stored
  promotional?: boolean; // Gmail filed it under Promotions: never account mail
};

export type RelationshipRow = Omit<Relationship, "familyId">;
export type AccountRow = Omit<Account, "familyId">;

/** Keep the biggest ones; plenty for the checks, and bounded for one database write. */
export const MAX_RELATIONSHIPS = 500;
/** Every real account, most important first; bounded for one write and one screen. */
export const MAX_ACCOUNTS = 60;
/** An org is an account after this many authenticated emails over at least this long... */
export const ACCOUNT_MIN_MESSAGES = 3;
export const ACCOUNT_MIN_SPAN_MS = 14 * 24 * 60 * 60 * 1000;
// ...or after any authenticated email once the parent has written to them.
/** A company outside our directory: this many account emails over at least half a year. */
export const OUTSIDE_MIN_SPAN_MS = 180 * 24 * 60 * 60 * 1000;
/** No account email in this long: a past account (an old insurer). A bit over a year, so a
 * once-a-year sender like Social Security stays. */
export const STALE_MS = 400 * 24 * 60 * 60 * 1000;

const DAY = 24 * 60 * 60 * 1000;
const MAX_HEADER = 2000; // real From/To headers are far shorter; also bounds parsing cost
const MAX_ADDRESS = 254;
const MAX_SUBJECT = 300;
const MAX_NAME = 40;

// Personal mailboxes: here the person matters, not the domain.
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "yahoo.co.uk", "yahoo.ca",
  "yahoo.in", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "comcast.net", "att.net", "sbcglobal.net", "bellsouth.net",
  "verizon.net", "cox.net", "charter.net", "rr.com", "optonline.net", "frontier.com", "windstream.net",
  "earthlink.net", "juno.com", "netzero.net", "proton.me", "protonmail.com", "pm.me", "gmx.com",
  "mail.com", "zoho.com", "fastmail.com", "hey.com",
]);

// ---------- Account signals from the subject ----------

// Sales, newsletters and surveys can use account words ("Save 20% on your next order"):
// any of these means it isn't account mail, whatever else the subject says.
// Notices about the company's own terms ("Updates to our Privacy Statement") aren't either.
const MARKETING =
  /\d+\s?% off|\b(sale|deals?|offers?|save|savings|free shipping|newsletter|webinar|tips|introducing|new arrivals|last chance|limited time|exclusive|shop now|coupons?|promo\w*|sweepstakes|survey|feedback|rate your|review your|apply now|pre-?approved|you're invited|join us|privacy (statement|policy|notice)|terms (of service|of use|and conditions)|(user|customer|cardmember) agreement|thanks? (you )?for (your )?visit\w*)\b/;

const SIGNAL_PATTERNS: [AccountSignal, RegExp][] = [
  [
    "sign_in",
    /\b(new|recent|unusual|unrecognized|suspicious) (sign[- ]?in|log[- ]?in|login|device)s?\b|\b(sign[- ]?in|log[- ]?in|login) (alert|attempt|activity|notification|from|detected)s?\b|\b(signed|logged) (in|into|on)\b|\bnew device\b|\bdevice (added|registered)\b/,
  ],
  [
    "security",
    /\bsecurity (alert|notice|notification|update|warning|check-?up|settings)s?\b|\baccount (change|changes|changed|update|updated|alert|activity|locked|notice)\b|\b(unusual|suspicious) activity\b|\bfraud alert\b|\b(email address|email|phone number|mailing address|address|contact information|username|profile|two-step verification|two-factor authentication) (was |has been )?(changed|updated|added|removed|turned on|turned off)\b|\bimportant (account|security) (information|notice|update)\b/,
  ],
  [
    "password",
    /\b(password|passcode) (reset|change|changed|updated|expires|expiring|request)\b|\b(reset|change|changed|update|updated|forgot|create|set up|new) (your |a )?(password|passcode)\b/,
  ],
  [
    "code",
    /\b(verification|security|one[- ]time|login|sign[- ]in|access|confirmation|authentication|authorization|temporary|identity) (code|passcode|pin)\b|\byour (code|passcode|one[- ]time code)\b|\bcode (is|for)\b|\bverify your (email|identity|account|device|phone|login|sign[- ]in)\b|\b(2fa|otp|mfa)\b/,
  ],
  [
    "statement",
    /\b(e-?)?statements?\b|\b(document|documents|letter|notice|form|forms) (is |are )?(ready|available|posted)\b|\bnew (document|letter|notice)s?\b|\btax (form|forms|document|documents)\b|\b1099\b|\bexplanation of benefits\b|\beob\b|\bsummary notice\b|\bpolicy (document|documents|renewal|declarations)\b|\b(annual|monthly|quarterly|year[- ]end) (summary|report|notice)\b|\bbenefits? (letter|notice|summary)\b/,
  ],
  [
    "bill",
    /\b(bill|bills|invoice|e-?bill)\b|\bpayment (is |was )?(due|received|scheduled|confirmation|confirmed|reminder|processed|posted|successful|failed|declined|returned|pending)\b|\bauto-?pay\b|\bautomatic payment\b|\bamount due\b|\bdue date\b|\bpast due\b|\bpremium (is )?(due|payment|notice)\b|\bthank you for your payment\b|\bwe received your payment\b/,
  ],
  [
    "order",
    /^(ordered|shipped|delivered|arriving|out for delivery)\b|\border (has |was |is )?(shipped|delivered|confirmed|received|placed|update|status|number|is ready|confirmation)\b|\border #|\b(has|have|was|were) (shipped|delivered)\b|\bout for delivery\b|\bdelivery (update|scheduled|notification|confirmation|attempt)\b|\barriving (today|tomorrow|soon)\b|\bpackage\b|\btracking (number|update)\b|\bprescriptions?\b|\brefills?\b|\bready for pick-?up\b|\bpick-?up (is )?ready\b/,
  ],
  [
    "appointment",
    /\b(appointments?|appt)\b|\b(upcoming|your|scheduled|video|virtual|telehealth|office) visits?\b|\bvisit (summary|reminder|confirmation|confirmed|scheduled)\b|\bafter[- ]visit summary\b|\bcheck[- ]in (for|now|is open|reminder)\b|\b(test|lab|imaging) results?\b|\bresults? (are |is )?(ready|available|in)\b|\b(new |secure )?messages? from (your )?(doctor|care team|provider|clinic|physician|nurse)\b|\bnew (secure )?message in (mychart|your (patient )?portal)\b/,
  ],
];

/** How strongly each kind of email shows Mom really uses the account. */
const SIGNAL_WEIGHT: Record<AccountSignal, number> = {
  statement: 6,
  bill: 6,
  appointment: 6,
  sign_in: 5,
  security: 4,
  password: 4,
  code: 3,
  order: 2,
};

/** Health, money and government first; shopping and subscriptions last. */
export const CATEGORY_WEIGHT: Record<AccountCategory, number> = {
  health: 20,
  bank: 20,
  government: 20,
  pharmacy: 14,
  insurance: 14,
  utility: 10,
  shopping: 4,
  other: 2,
};

/** The kinds of account email a subject shows, strongest first. Empty for marketing. */
export function accountSignals(subject: string): AccountSignal[] {
  const s = foldText(subject.slice(0, MAX_SUBJECT));
  if (s === "" || MARKETING.test(s)) return [];
  return SIGNAL_PATTERNS.filter(([, pattern]) => pattern.test(s))
    .map(([signal]) => signal)
    .sort((a, b) => SIGNAL_WEIGHT[b] - SIGNAL_WEIGHT[a]);
}

export type RankInput = {
  category: AccountCategory;
  signals: AccountSignal[];
  lastActivity?: number;
  signalCount: number; // account emails seen
  wrote: boolean; // the parent wrote to them
};

/** Higher is more important. Real use (kinds and amount of account mail), then recency, then category. */
export function rankAccount(a: RankInput, now: number): number {
  const kinds = a.signals.reduce((sum, s) => sum + SIGNAL_WEIGHT[s], 0);
  const amount = Math.min(6, 2 * Math.log2(1 + a.signalCount));
  const age = a.lastActivity === undefined ? Number.POSITIVE_INFINITY : now - a.lastActivity;
  const recency = age <= 30 * DAY ? 10 : age <= 90 * DAY ? 7 : age <= 180 * DAY ? 4 : age <= 365 * DAY ? 1 : 0;
  const score = CATEGORY_WEIGHT[a.category] + kinds + amount + recency + (a.wrote ? 3 : 0);
  return Math.round(score * 100) / 100;
}

// ---------- Names for companies outside our directory ----------

// Words around a company name that don't make it a different company: "Fidelity Investments",
// "Wells Fargo Online". A name that is a known company's plus only these is that company.
const NAME_FILLER = new Set(
  ("bank banking online alert alerts investment investments insurance financial finance services service " +
    "support team security account accounts customer customers care billing payments payment notification " +
    "notifications card cards credit rewards statement statements health pharmacy rx mobile wireless energy " +
    "the of inc llc co corp us usa help center official secure fraud member members client clients " +
    "department dept group na mail email info update updates my e get go rewards reward alerts portal web").split(" "),
);

// Display names that say nothing about who it is.
const GENERIC_NAMES = new Set(
  ("noreply no reply donotreply do not reply notification notifications notify alert alerts info support " +
    "service services customer service customer care team admin billing accounts account mailer daemon " +
    "mailer-daemon newsletter news updates hello contact office").split(" "),
);

// Words that make a "name" a message instead ("Call Dad Now It Is Urgent", "Verify Your Account").
const MESSAGE_WORDS = new Set(
  ("you your yours mom dad mother father grandma grandpa grandson granddaughter son daughter call text reply " +
    "click tap open verify urgent now please help immediately act suspended locked winner prize gift refund " +
    "money cash send pay free safe secure password code login sign").split(" "),
);

// Platforms where anyone can get an address on the same domain (a help desk, a store, a form):
// mail from them says nothing about which company it is.
const SHARED_SENDERS = new Set([
  "zendesk.com", "freshdesk.com", "salesforce.com", "force.com", "atlassian.net", "sharepoint.com",
  "typeform.com", "statuspage.io", "squarespace.com", "wix.com", "wixsite.com", "shopify.com", "myshopify.com",
  "mailchimp.com", "mailchimpapp.com", "mcsv.net", "sendgrid.net", "amazonses.com", "hubspot.com",
  "hubspotemail.net", "constantcontact.com", "intercom.io", "intercom-mail.com", "helpscout.net", "github.com",
  "gitlab.com", "googlegroups.com", "notion.so", "dropbox.com", "docusign.net", "docusign.com",
  "eventbrite.com", "stripe.com", "squareup.com", "square.site", "zoom.us", "calendly.com", "mailgun.org",
  "sparkpostmail.com", "qualtrics.com", "surveymonkey.com", "jotform.com", "formstack.com", "wufoo.com",
  "zohomail.com", "office365.com", "onmicrosoft.com", "mailerlite.com", "klaviyomail.com", "sendinblue.com",
  "brevo.com", "substack.com", "medium.com", "linkedin.com", "nextdoor.com", "yelp.com",
  "patreon.com", "gofundme.com", "zelle.com", "cash.app", "wordpress.com",
  "blogger.com", "weebly.com", "godaddysites.com", "ghost.io", "beehiiv.com", "convertkit.com", "kit.com",
]);

/** A platform anyone can send from (a help desk, a store builder, a mailing service). */
export const isSharedSender = (domain: string) => SHARED_SENDERS.has(registrableDomain(domain));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KNOWN_ORG_NAMES = ORGS.map((o) => ({
  org: o,
  pattern: new RegExp(`(?<![a-z0-9])${escapeRe(foldText(o.name))}(?![a-z0-9])`),
}));

// What a directory company's name looks like inside a domain: "wellsfargo", "fidelity".
const KNOWN_ORG_KEYS = [
  ...new Set(
    ORGS.flatMap((o) => [foldText(o.name).replace(/[^a-z0-9]/g, ""), ...o.domains.map((d) => d.slice(0, d.indexOf(".")))]).filter(
      (k) => k.length >= 4 && /[a-z]/.test(k),
    ),
  ),
];

/** `s` is the key with only filler words or digits around it: "myfidelityonline", "wellsfargo2". */
function keyPlusFiller(s: string, key: string): boolean {
  // reach[i]: 0 unreachable, 1 reachable before the key, 2 reachable with the key. Linear in s.
  const reach = new Array<number>(s.length + 1).fill(0);
  reach[0] = 1;
  for (let i = 0; i < s.length; i++) {
    if (!reach[i]) continue;
    if (reach[i] === 1 && s.startsWith(key, i)) reach[i + key.length] = 2;
    let digits = i;
    while (digits < s.length && s[digits] >= "0" && s[digits] <= "9") digits++;
    if (digits > i) reach[digits] = Math.max(reach[digits], reach[i]);
    for (let j = i + 1; j <= Math.min(s.length, i + 14); j++) {
      if (NAME_FILLER.has(s.slice(i, j))) reach[j] = Math.max(reach[j], reach[i]);
    }
  }
  return reach[s.length] === 2;
}

/**
 * A domain built from a directory company's name plus filler: "fidelity-statements.net",
 * "wellsfargorewards.com". Not "providence-dental.com": "dental" says it's someone else.
 */
function domainImitatesOrg(domain: string): boolean {
  const registrable = registrableDomain(domain);
  if (ORGS.some((o) => o.domains.includes(registrable))) return false;
  const label = registrable.slice(0, registrable.indexOf(".")).toLowerCase().replace(/-/g, "");
  return KNOWN_ORG_KEYS.some((key) => keyPlusFiller(label, key));
}

/**
 * True when a company outside our directory presents itself as one we know: a known brand in
 * its name or address (including look-alike addresses), a directory company's name plus only
 * filler words ("Fidelity Investments"), or an address built from one ("fidelity-statements.net").
 */
export function impersonatesKnownOrg(name: string, domain: string): boolean {
  if (lookalikeOf(domain) || domainImitatesOrg(domain)) return true;
  const claim = brandInName(name);
  if (claim && !isOfficialFor(domain, claim.brand)) return true;
  const folded = foldText(name.slice(0, 400)).slice(0, 200);
  for (const { org, pattern } of KNOWN_ORG_NAMES) {
    if (!pattern.test(folded) || org.domains.includes(registrableDomain(domain))) continue;
    const rest = folded.replace(pattern, " ").split(/[^a-z0-9]+/).filter(Boolean);
    if (rest.every((w) => NAME_FILLER.has(w))) return true;
  }
  return false;
}

/**
 * A company name fit to show Mom: plain letters, short, not an address, not a generic
 * "No-Reply", not a message ("Call Dad Now"), sharing a word with the company's own address
 * ("Bayview Family Dental" from bayviewdental.com, not "Dr. Jane Smith"), and not a company we
 * know (that would be impersonation). Null if not.
 */
export function cleanOrgName(raw: string, domain: string): string | null {
  const name = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > MAX_NAME) return null;
  if (!/^[A-Za-z0-9 &'.,()+-]+$/.test(name) || !/[A-Za-z]{2}/.test(name)) return null; // plain letters only: no look-alikes
  if (/[a-z0-9-]+\.[a-z]{2,}/i.test(name) || /\d{4,}/.test(name)) return null; // an address or a number
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.every((w) => GENERIC_NAMES.has(w) || NAME_FILLER.has(w))) return null;
  if (words.some((w) => MESSAGE_WORDS.has(w))) return null;
  const registrable = registrableDomain(domain);
  const label = registrable.slice(0, Math.max(registrable.indexOf("."), 0)).replace(/-/g, "");
  if (!words.some((w) => w.length >= 3 && /[a-z]/.test(w) && label.includes(w))) return null;
  if (impersonatesKnownOrg(name, domain)) return null;
  return name;
}

// Mailboxes that send account mail ("reminders@", "noreply@"), unlike a person's ("bob@").
const AUTOMATED_WORDS = new Set(
  ("noreply no reply donotreply do not notification notifications notify alert alerts billing bill bills " +
    "statement statements info support service services customerservice customer customers care appointment " +
    "appointments reminder reminders mychart account accounts security order orders shipping shipment " +
    "shipments update updates news hello team member members patient patients message messages mail mailer " +
    "ebill ebills payment payments autopay system admin portal online digital myaccount verify verification " +
    "confirm confirmation receipts receipt invoice invoices contact office clinic scheduling frontdesk " +
    "reception pharmacy rx records benefits claims").split(" "),
);

function isAutomatedMailbox(address: string): boolean {
  const local = address.slice(0, address.lastIndexOf("@"));
  if (/no-?reply|do-?not-?reply/.test(local)) return true;
  return local.split(/[^a-z]+/).some((w) => AUTOMATED_WORDS.has(w));
}

/**
 * Apply what the sign-in page finder learned about a company outside our directory: its own
 * name and category, and its sign-in page, only if that page is on the company's own domain.
 * The rank doesn't change: the category came from the company's own web page, so it can sort
 * the screen into groups but never lift an unknown company above Mom's known accounts.
 */
export function applyDiscovered(
  account: AccountRow,
  found: { orgName: string; category: string; loginUrl?: string },
): AccountRow {
  const domain = account.officialDomains[0];
  const next: AccountRow = { ...account };
  const name = cleanOrgName(found.orgName, domain);
  if (name) next.orgName = name;
  if (isCategory(found.category)) next.category = found.category;
  if (found.loginUrl && isOnDomains(found.loginUrl, account.officialDomains)) {
    next.loginUrl = found.loginUrl;
    next.loginUrlSource = "discovered";
  } else if (account.loginUrlSource === "discovered") {
    // The latest lookup decides: a link it no longer confirms goes away.
    delete next.loginUrl;
    delete next.loginUrlSource;
  }
  return next;
}

const CATEGORIES = new Set<string>(Object.keys(CATEGORY_WEIGHT));
export const isCategory = (c: string): c is AccountCategory => CATEGORIES.has(c);

/** An https link whose host is one of these domains or under one. */
export function isOnDomains(url: string, domains: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

// ---------- Parsing ----------

type Mailbox = { address: string; domain: string; name: string };

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
    out.push({ address, domain, name: ("name" in entry && entry.name) || "" });
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
export function authenticatedFor(authResults: string[], sender: { address: string; domain: string }): boolean {
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
export function keyFor(m: { address: string; domain: string }): Key {
  const registrable = registrableDomain(m.domain);
  if (FREEMAIL.has(registrable)) return { kind: "person", key: m.address };
  return { kind: "org", key: registrable };
}

// ---------- Building the history ----------

type Use = {
  signals: Set<AccountSignal>;
  signalCount: number;
  lastActivity: number; // 0 when no account mail
  automated: boolean; // some account mail came from a mailbox like "reminders@"
  automatedCount: number; // account mail from such mailboxes...
  automatedFirst: number; // ...and when it started and last came
  automatedLast: number;
  names: Map<string, number>; // display names on that mail
};

type Tally = RelationshipRow & { authPassCount: number; authFirst: number; authLast: number; use: Use };

const newUse = (): Use => ({
  signals: new Set(),
  signalCount: 0,
  lastActivity: 0,
  automated: false,
  automatedCount: 0,
  automatedFirst: Number.POSITIVE_INFINITY,
  automatedLast: 0,
  names: new Map(),
});

export function buildHistory(
  records: HeaderRecord[],
  now = Date.now(),
  opts: { selfEmail?: string } = {},
): { relationships: RelationshipRow[]; accounts: AccountRow[] } {
  const self = opts.selfEmail?.toLowerCase();
  const selfDomain = self?.includes("@") ? registrableDomain(self.slice(self.lastIndexOf("@") + 1)) : undefined;
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
        use: newUse(),
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
    if (!authenticatedFor(r.authResults, sender)) continue;
    t.authPassCount += 1;
    t.authFirst = Math.min(t.authFirst, date);
    t.authLast = Math.max(t.authLast, date);
    if (t.kind !== "org") continue;
    const signals = r.promotional ? [] : accountSignals(r.subject ?? "");
    if (signals.length === 0) continue;
    for (const s of signals) t.use.signals.add(s);
    t.use.signalCount += 1;
    t.use.lastActivity = Math.max(t.use.lastActivity, date);
    if (!isAutomatedMailbox(sender.address)) continue;
    // Names only from the company's own account mail, not from a person who works there.
    t.use.automated = true;
    t.use.automatedFirst = Math.min(t.use.automatedFirst, date);
    t.use.automatedLast = Math.max(t.use.automatedLast, date);
    t.use.automatedCount += 1;
    if (sender.name) t.use.names.set(sender.name, (t.use.names.get(sender.name) ?? 0) + 1);
  }

  // Nothing received means nothing failed: rate 1. Callers must look at messageCount too.
  const all = [...tallies.values()].map((t) => ({
    ...t,
    authPassRate: t.messageCount === 0 ? 1 : t.authPassCount / t.messageCount,
  }));

  // My Accounts: orgs with repeated authenticated mail (or a reply from the parent), mostly
  // passing, counted across all of a known org's domains, AND recent account-type mail. A
  // spoofed or one-off "Chase" never becomes one of the parent's accounts.
  type OrgTally = {
    orgName: string;
    category: AccountCategory;
    officialDomains: string[];
    loginUrl?: string;
    curated: boolean;
    firstSeen: number;
    messageCount: number;
    authPassCount: number;
    authFirst: number;
    authLast: number;
    sentCount: number;
    use: Use;
  };
  const byOrg = new Map<string, OrgTally>();
  for (const t of all) {
    if (t.kind !== "org") continue;
    const org = orgForDomain(t.key);
    if (!org && (t.key === selfDomain || brandForDomain(t.key) || isSharedSender(t.key))) continue;
    const id = org ? `curated:${org.name}` : `domain:${t.key}`;
    const o = byOrg.get(id) ?? {
      orgName: org?.name ?? t.key,
      category: org?.category ?? "other",
      officialDomains: org?.domains ?? [t.key],
      loginUrl: org?.loginUrl,
      curated: org !== undefined,
      firstSeen: Number.POSITIVE_INFINITY,
      messageCount: 0,
      authPassCount: 0,
      authFirst: Number.POSITIVE_INFINITY,
      authLast: 0,
      sentCount: 0,
      use: newUse(),
    };
    o.firstSeen = Math.min(o.firstSeen, t.firstSeen);
    o.messageCount += t.messageCount;
    o.authPassCount += t.authPassCount;
    o.authFirst = Math.min(o.authFirst, t.authFirst);
    o.authLast = Math.max(o.authLast, t.authLast);
    o.sentCount += t.parentSentCount ?? 0;
    for (const s of t.use.signals) o.use.signals.add(s);
    o.use.signalCount += t.use.signalCount;
    o.use.lastActivity = Math.max(o.use.lastActivity, t.use.lastActivity);
    o.use.automated ||= t.use.automated;
    o.use.automatedCount += t.use.automatedCount;
    o.use.automatedFirst = Math.min(o.use.automatedFirst, t.use.automatedFirst);
    o.use.automatedLast = Math.max(o.use.automatedLast, t.use.automatedLast);
    for (const [n, c] of t.use.names) o.use.names.set(n, (o.use.names.get(n) ?? 0) + c);
    byOrg.set(id, o);
  }

  const trusted = (o: OrgTally) =>
    o.authPassCount > 0 &&
    o.authPassCount / Math.max(o.messageCount, 1) >= 0.5 &&
    ((o.authPassCount >= ACCOUNT_MIN_MESSAGES && o.authLast - o.authFirst >= ACCOUNT_MIN_SPAN_MS) || o.sentCount > 0);
  const inUse = (o: OrgTally) => o.use.signals.size > 0 && now - o.use.lastActivity <= STALE_MS;

  const usedNames = new Set(ORGS.map((o) => o.name.toLowerCase()));
  const accounts: AccountRow[] = [];
  for (const o of byOrg.values()) {
    if (!trusted(o) || !inUse(o)) continue;
    if (!o.curated) {
      // A company outside our directory (see the top of this file): half a year of account
      // mail from its own automated mailboxes, never dressed up as a company we know, named as
      // it names itself (or by its plain address).
      const domain = o.officialDomains[0];
      const u = o.use;
      if (u.automatedCount < ACCOUNT_MIN_MESSAGES || u.automatedLast - u.automatedFirst < OUTSIDE_MIN_SPAN_MS) continue;
      const names = u.names.size > 0 ? [...u.names.keys()] : [""]; // "": still check the address itself
      if (names.some((n) => impersonatesKnownOrg(n, domain))) continue;
      const best = [...u.names.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([n]) => cleanOrgName(n, domain))
        .find((n): n is string => n !== null && !usedNames.has(n.toLowerCase()));
      if (!best && !/^[a-z0-9.-]+$/.test(domain)) continue;
      o.orgName = best ?? domain;
    }
    usedNames.add(o.orgName.toLowerCase());
    const signals = [...o.use.signals].sort((a, b) => SIGNAL_WEIGHT[b] - SIGNAL_WEIGHT[a]);
    const rank = rankAccount(
      {
        category: o.curated ? o.category : "other",
        signals,
        lastActivity: o.use.lastActivity,
        signalCount: o.use.signalCount,
        wrote: o.curated && o.sentCount > 0,
      },
      now,
    );
    accounts.push({
      orgName: o.orgName,
      category: o.category,
      officialDomains: o.officialDomains,
      ...(o.loginUrl !== undefined && { loginUrl: o.loginUrl, loginUrlSource: "curated" as const }),
      firstSeen: o.firstSeen,
      messageCount: o.messageCount,
      rank,
      signals,
      lastActivity: o.use.lastActivity,
    });
  }
  accounts.sort(byRank);

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

  return { relationships, accounts: accounts.slice(0, MAX_ACCOUNTS) };
}

/** Just the account fields of a stored row (no _id, _creationTime or familyId). */
export function accountFields(row: AccountRow): AccountRow {
  return {
    orgName: row.orgName,
    category: row.category,
    officialDomains: row.officialDomains,
    ...(row.loginUrl !== undefined && { loginUrl: row.loginUrl }),
    firstSeen: row.firstSeen,
    messageCount: row.messageCount,
    ...(row.rank !== undefined && { rank: row.rank }),
    ...(row.signals !== undefined && { signals: row.signals }),
    ...(row.lastActivity !== undefined && { lastActivity: row.lastActivity }),
    ...(row.loginUrlSource !== undefined && { loginUrlSource: row.loginUrlSource }),
  };
}

export const sameAccount = (a: AccountRow, b: AccountRow) =>
  JSON.stringify(accountFields(a)) === JSON.stringify(accountFields(b));

/** Most important first, then by name. Rows from before A8 (no rank) go last. */
export function byRank(a: { rank?: number; orgName: string }, b: { rank?: number; orgName: string }): number {
  return (b.rank ?? -1) - (a.rank ?? -1) || a.orgName.localeCompare(b.orgName);
}
