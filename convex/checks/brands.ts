// The brands scammers imitate most, with the domains they really use.
// To add one: append an entry. `officialDomains` covers every subdomain, so list only the
// registrable ones ("kp.org", not "healthy.kp.org").
import { parse } from "tldts";
import { decodeIdn, editDistance, foldText, skeletons } from "./text";

export type Brand = {
  name: string; // used in plain-language reasons: "This email says it is from Chase..."
  officialDomains: string[]; // only the organization can send from these
  // Real brand sites where anyone can also get an address or page (icloud.com mailboxes,
  // paypal.me/anyone). Fine as link targets, never proof of who sent an email.
  sharedDomains?: string[];
  aliases: string[]; // names people see in a From line or subject, matched as whole words
  // Set when an alias is also an everyday word or name ("Chase Smith", "Karen Kaiser",
  // "Humana Medicare", "apple harvest"). Then a From name counts only if it is the alias plus
  // words like "Bank" or "Alerts", and a looser mention is ignored.
  ambiguous?: boolean;
  domainKeys: string[]; // what a fake domain would imitate, e.g. "paypal" in "paypa1.com"
  // Set when a key is also an everyday word or name in domains ("apple-farm.org",
  // "chase-outdoors.com"). Then "brand-word" only counts if the word is a scam-style filler.
  wordLikeKeys?: boolean;
};

export const BRANDS: Brand[] = [
  { name: "Chase", officialDomains: ["chase.com", "jpmorganchase.com", "jpmorgan.com"], aliases: ["chase", "chase bank", "jpmorgan chase"], ambiguous: true, domainKeys: ["chase", "jpmorganchase", "jpmorgan"], wordLikeKeys: true },
  { name: "Wells Fargo", officialDomains: ["wellsfargo.com", "wf.com", "wellsfargoadvisors.com"], aliases: ["wells fargo"], domainKeys: ["wellsfargo"] },
  { name: "Bank of America", officialDomains: ["bankofamerica.com", "bofa.com", "ml.com", "merrilledge.com"], aliases: ["bank of america", "bofa"], domainKeys: ["bankofamerica", "bofa"] },
  { name: "Kaiser Permanente", officialDomains: ["kp.org", "kaiserpermanente.org"], aliases: ["kaiser permanente", "kaiser"], ambiguous: true, domainKeys: ["kaiserpermanente", "kaiser"], wordLikeKeys: true },
  { name: "Medicare", officialDomains: ["medicare.gov", "cms.gov", "hhs.gov"], aliases: ["medicare"], ambiguous: true, domainKeys: ["medicare", "mymedicare"] },
  { name: "USPS", officialDomains: ["usps.com", "usps.gov"], aliases: ["usps", "u.s. postal service", "us postal service", "united states postal service", "postal service"], domainKeys: ["usps"] },
  { name: "Amazon", officialDomains: ["amazon.com", "amazon.co.uk", "amazon.ca", "amazon.de", "amazonpay.com", "amazon.jobs", "a.co"], aliases: ["amazon", "amazon prime"], ambiguous: true, domainKeys: ["amazon"], wordLikeKeys: true },
  { name: "PayPal", officialDomains: ["paypal.com"], sharedDomains: ["paypal.me"], aliases: ["paypal"], domainKeys: ["paypal"] },
  { name: "Apple", officialDomains: ["apple.com", "apple.news"], sharedDomains: ["icloud.com", "icloud.com.cn", "me.com", "mac.com"], aliases: ["apple", "apple id", "apple support", "icloud", "app store"], ambiguous: true, domainKeys: ["apple", "appleid", "icloud"], wordLikeKeys: true },
  { name: "IRS", officialDomains: ["irs.gov", "treasury.gov"], aliases: ["irs", "internal revenue service"], domainKeys: ["irs"] },
  { name: "CVS", officialDomains: ["cvs.com", "cvshealth.com", "caremark.com"], aliases: ["cvs", "cvs pharmacy", "cvs health", "cvs caremark"], domainKeys: ["cvs", "cvspharmacy", "cvshealth"] },
  { name: "PG&E", officialDomains: ["pge.com", "pgecorp.com"], aliases: ["pg&e", "pge", "pacific gas and electric", "pacific gas & electric"], domainKeys: ["pge", "pacificgasandelectric"] },
  // Tech support, streaming, payment apps, parcels and antivirus: the other names scammers use
  // most with older adults (the accuracy eval found these missing). Free mailbox domains anyone
  // can sign up for are shared, never proof of who sent an email.
  // Not office.com: Sway and Forms pages there are published by anyone.
  { name: "Microsoft", officialDomains: ["microsoft.com", "microsoftonline.com"], sharedDomains: ["outlook.com", "hotmail.com", "live.com", "msn.com"], aliases: ["microsoft", "microsoft support", "microsoft account", "windows support", "windows defender"], domainKeys: ["microsoft", "windowsdefender"] },
  { name: "Google", officialDomains: ["google.com", "youtube.com", "g.co", "google.ca", "google.co.uk", "google.com.au", "google.de", "google.fr", "google.es", "google.it", "google.ie", "google.co.nz", "google.co.in", "google.com.mx", "google.co.jp", "google.com.br", "google.nl"], sharedDomains: ["gmail.com", "googlemail.com", "blogspot.com", "goo.gl"], aliases: ["google", "google support", "google account", "gmail team"], ambiguous: true, domainKeys: ["google", "gmail"] },
  { name: "Netflix", officialDomains: ["netflix.com"], aliases: ["netflix", "netflix support", "netflix billing"], domainKeys: ["netflix"] },
  // Ambiguous: banks and credit unions send "You received money with Zelle" from their own domains.
  { name: "Zelle", officialDomains: ["zelle.com", "zellepay.com"], aliases: ["zelle", "zelle pay", "zelle support"], ambiguous: true, domainKeys: ["zelle", "zellepay"] },
  { name: "Venmo", officialDomains: ["venmo.com"], aliases: ["venmo", "venmo support"], domainKeys: ["venmo"] },
  { name: "Facebook", officialDomains: ["facebook.com", "facebookmail.com", "meta.com"], aliases: ["facebook", "facebook security", "facebook support", "meta support"], domainKeys: ["facebook", "facebookmail"] },
  { name: "Social Security", officialDomains: ["ssa.gov"], aliases: ["social security", "social security administration", "ssa"], domainKeys: ["socialsecurity", "ssa"] },
  { name: "UPS", officialDomains: ["ups.com", "theupsstore.com"], aliases: ["ups", "ups delivery", "ups my choice", "united parcel service"], ambiguous: true, domainKeys: ["ups"], wordLikeKeys: true },
  { name: "FedEx", officialDomains: ["fedex.com"], aliases: ["fedex", "fedex delivery", "federal express"], domainKeys: ["fedex"] },
  // Norton is also a surname and a hospital system (Norton Healthcare), so only the product
  // names count in a web address; impostor emails are still caught by the name they use.
  { name: "Norton", officialDomains: ["norton.com", "nortonlifelock.com"], aliases: ["norton", "norton antivirus", "norton 360", "norton security", "nortonlifelock"], ambiguous: true, domainKeys: ["nortonlifelock", "norton360"], wordLikeKeys: true },
  { name: "McAfee", officialDomains: ["mcafee.com"], aliases: ["mcafee", "mcafee antivirus", "mcafee security"], ambiguous: true, domainKeys: ["mcafee"] },
  { name: "Geek Squad", officialDomains: ["bestbuy.com", "geeksquad.com"], aliases: ["geek squad", "geeksquad", "best buy geek squad"], domainKeys: ["geeksquad"] },
];

// Words that pad out a fake domain or a From name around a brand: "chase-secure-login",
// "mychaseonline", "Chase Fraud Alerts".
const FILLER = new Set(
  ("secure security login logon log signin sign in on verify verification verified account accounts acct online " +
    "support help helpdesk desk service services customer customers care alert alerts update updates auth id my " +
    "bank banking pay payment payments billing bill center centre team notice notices notify notification " +
    "notifications mail email portal web app access info official us usa claim claims refund refunds track " +
    "tracking delivery redelivery deliver parcel package member members benefit benefits rx health pharmacy now " +
    "today check confirm unlock locked reset recover recovery protect protection fraud prevention reward rewards " +
    "card cards wallet connect mobile net link page site inc corp group dept department no reply noreply the " +
    "na prime order orders shipping store com from at specialist agent representative officer division unit hq " +
    "corporate headquarters assistance offer offers deal deals mortgage loan loans homeloan homeloans invoice " +
    "invoices receipt receipts giftcard gift winner winners prize enrollment enroll appointment appointments ca " +
    "gov home secure2 247 24 7").split(" "),
);

const MAX_FILLER = Math.max(...[...FILLER].map((w) => w.length));

// Real DNS names are at most 253 characters with labels of at most 63. Anything longer is
// not a working address, and the matching below would get slow on it.
export const MAX_HOST = 253;
export const MAX_LABEL = 63;

export function isPlausibleHost(host: string): boolean {
  return host.length > 0 && host.length <= MAX_HOST && host.split(".").every((l) => l.length <= MAX_LABEL);
}

export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  // Private suffixes too, so "evil.github.io" and "docs.github.io" are different sites.
  return parse(h, { allowPrivateDomains: true }).domain ?? h;
}

const within = (h: string, domains: string[] = []) => domains.some((d) => h === d || h.endsWith("." + d));

/** The sending domain belongs to this brand alone. Shared mailbox domains never count. */
export function isOfficialFor(host: string, brand: Brand): boolean {
  return within(host.toLowerCase().replace(/\.$/, ""), brand.officialDomains);
}

/** The brand whose sending domain this is, if any. */
export function brandForDomain(host: string): Brand | undefined {
  return BRANDS.find((b) => isOfficialFor(host, b));
}

/** The brand whose website this is, shared domains included (for link targets). */
export function brandForSite(host: string): Brand | undefined {
  const h = host.toLowerCase().replace(/\.$/, "");
  return BRANDS.find((b) => within(h, b.officialDomains) || within(h, b.sharedDomains));
}

/** True when the string is the brand key plus filler words and numbers, e.g. "mychaseonline". */
function composedOf(s: string, key: string): boolean {
  // reach[i] = 0 unreachable, 1 reachable without the key yet, 2 reachable with the key.
  // Each step tries pieces of at most MAX_FILLER characters, so this is linear in s.
  const reach = new Array<number>(s.length + 1).fill(0);
  reach[0] = 1;
  for (let i = 0; i < s.length; i++) {
    if (!reach[i]) continue;
    if (s.startsWith(key, i)) reach[i + key.length] = Math.max(reach[i + key.length], 2);
    let digits = i;
    while (digits < s.length && s[digits] >= "0" && s[digits] <= "9") digits++;
    if (digits > i) reach[digits] = Math.max(reach[digits], reach[i]);
    for (let j = i + 1; j <= Math.min(s.length, i + MAX_FILLER); j++) {
      if (FILLER.has(s.slice(i, j))) reach[j] = Math.max(reach[j], reach[i]);
    }
  }
  return reach[s.length] === 2;
}

/** A doubled letter: "chasee", "chaase", "cchase". Safe for short keys, unlike edit distance. */
function isDoubledLetterOf(s: string, key: string): boolean {
  if (s.length !== key.length + 1) return false;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1] && s.slice(0, i) + s.slice(i + 1) === key) return true;
  }
  return false;
}

/** Close misspellings. Edit distance only for longer keys: "phase" must not read as "chase". */
function isTypoOf(s: string, key: string): boolean {
  if (s === key) return false;
  if (key.length >= 4 && isDoubledLetterOf(s, key)) return true;
  if (key.length < 6 || s.length < key.length) return false;
  const max = key.length >= 10 ? 2 : 1;
  return editDistance(s, key, max) <= max;
}

function labelImitates(label: string): Brand | undefined {
  for (const variant of skeletons(label)) {
    const parts = variant.split("-").filter(Boolean);
    const joined = parts.join("");
    for (const brand of BRANDS) {
      for (const key of brand.domainKeys) {
        if (joined === key || composedOf(joined, key)) return brand;
        // "paypal-invoice", "irs-gov": a distinctive brand name as one part of the name.
        if (!brand.wordLikeKeys && parts.length > 1 && parts.includes(key)) return brand;
        if ([joined, ...parts].some((p) => isTypoOf(p, key))) return brand;
      }
    }
  }
  return undefined;
}

/**
 * The brand a host is dressed up as, e.g. "paypa1.com" or "chase.com.verify-account.ru".
 * Undefined for the brand's real domains and for .gov, .mil and .edu, which only vetted
 * organizations can register.
 */
export function lookalikeOf(host: string): Brand | undefined {
  const h = decodeIdn(host.toLowerCase().replace(/\.$/, ""));
  if (!isPlausibleHost(h) || brandForSite(h)) return undefined;
  const info = parse(h);
  if (info.isIp) return undefined;
  if (/(^|\.)(gov|mil|edu)$/.test(info.publicSuffix ?? "")) return undefined;
  const labels = [...(info.subdomain ? info.subdomain.split(".") : []), info.domainWithoutSuffix ?? h];
  for (const label of labels) {
    const brand = labelImitates(label);
    if (brand) return brand;
  }
  return undefined;
}

function aliasPattern(alias: string): RegExp {
  const escaped = foldText(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`);
}

const ALIASES = BRANDS.map((brand) => ({ brand, patterns: brand.aliases.map(aliasPattern) }));

export type NameClaim = { brand: Brand; strict: boolean };

/**
 * A From name that names a brand. `strict` when the name is the brand plus filler words
 * ("Chase", "Wells Fargo Online", "service@paypal.com"): that is pretending to be the brand.
 * Loose when it only mentions one ("Fred from Wells Fargo", "Humana Medicare"); ambiguous
 * brands never match loosely.
 */
export function brandInName(name: string): NameClaim | undefined {
  // A real From name is short. Capping it keeps a crafted 80 KB name from costing seconds.
  const folded = foldText(name.slice(0, 400)).slice(0, 200);
  if (!folded) return undefined;
  const isFiller = (w: string) => FILLER.has(w) || /^\d+$/.test(w);
  const onlyFiller = (rest: string) => rest.split(/[^a-z0-9]+/).filter(Boolean).every(isFiller);
  let loose: Brand | undefined;
  for (const { brand, patterns } of ALIASES) {
    for (const pattern of patterns) {
      if (!pattern.test(folded)) continue;
      if (onlyFiller(folded.replace(pattern, " "))) return { brand, strict: true };
      if (!brand.ambiguous) loose ??= brand;
    }
  }
  // Run-together, misspelled or look-alike brand words, standing alone: "WellsFargo Security",
  // "Pay Pal Support", "PayPaI Service". Not "Tom Keiser": a near-miss next to a person's
  // name is just a name.
  const words = folded.split(/[^a-z0-9]+/).filter(Boolean).slice(0, 12);
  const nonFiller = words.filter((w) => !isFiller(w)).length;
  const candidates = [...words.map((w) => [w] as const), ...words.slice(1).map((w, i) => [words[i], w] as const)];
  for (const group of candidates) {
    // Every word outside this candidate must be filler.
    if (nonFiller - group.filter((w) => !isFiller(w)).length > 0) continue;
    const word = group.join("");
    for (const brand of BRANDS) {
      if (brand.domainKeys.some((key) => word === key || isTypoOf(word, key))) return { brand, strict: true };
    }
  }
  return loose ? { brand: loose, strict: false } : undefined;
}

const ACCOUNT_WORDS = /(?<![a-z])(account|password|verify|verification|suspend\w*|lock\w*|payment|statement|refund|package|deliver\w*|shipment|claim|benefits?|log ?in|sign[ -]?in|security|alert|update|confirm\w*|billing|invoice|order|tax|card|prescription|results?|appointment|bill|unusual|activity|id)(?![a-z])/;

/** A subject that names a brand in an account context: "USPS: your package...". */
export function brandInSubject(subject: string): Brand | undefined {
  const folded = foldText(subject);
  if (!ACCOUNT_WORDS.test(folded)) return undefined;
  for (const { brand, patterns } of ALIASES) {
    for (const pattern of patterns) {
      const match = pattern.exec(folded);
      if (!match) continue;
      if (!brand.ambiguous) return brand;
      // Ambiguous names count only when used as a brand: "Apple ID", "Chase account".
      const next = folded.slice(match.index + match[0].length).match(/^[^a-z0-9]*([a-z0-9]+)/)?.[1];
      if (next && (FILLER.has(next) || ACCOUNT_WORDS.test(next))) return brand;
    }
  }
  return undefined;
}
