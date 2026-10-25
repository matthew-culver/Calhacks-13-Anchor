// Check 3: do the links go where they say they go?
import { parse } from "tldts";
import type { CheckResult, CheckStatus } from "../contract";
import { brandForSite, brandInSubject, isOfficialFor, isPlausibleHost, lookalikeOf, registrableDomain, type Brand } from "./brands";
import type { LinkIntel } from "./intel";
import { foldText, hasNonAscii } from "./text";
import type { ParsedEmail } from "./types";

export const SHORTENERS = new Set([
  "bit.ly", "bitly.com", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly",
  "shorturl.at", "rb.gy", "t.ly", "tiny.cc", "s.id", "v.gd", "qrco.de", "lnkd.in", "shorte.st", "adf.ly", "bl.ink",
  "short.io", "tiny.one", "shrtco.de", "u.to",
]);

// Click trackers that mail services wrap around every link in a newsletter. A link shown as
// "www.aarp.org" that goes through one of these is normal, not a trick. Sending
// infrastructure only: no services where anyone can publish their own pages.
export const MAIL_TRACKERS = new Set([
  "list-manage.com", "mcsv.net", "rs6.net", "sendgrid.net", "mandrillapp.com", "mailgun.org", "sparkpostmail.com",
  "createsend.com", "cmail19.com", "cmail20.com", "hubspotlinks.com", "klclick.com", "klclick1.com", "mjt.lu",
  "sendibt3.com", "awstrack.me", "exacttarget.com", "emltrk.com", "convertkit-mail.com",
]);

// Survey, meeting and help-desk services that host pages under a customer's name, like
// "kaiserpermanente.az1.qualtrics.com". Only trusted when the email comes from that brand.
const BRAND_HOSTS = new Set(["qualtrics.com", "zoom.us", "medallia.com", "salesforce.com", "force.com", "service-now.com", "webex.com", "surveymonkey.com"]);

// Link text that asks the reader to sign in or pay: "Sign in to Chase", "Pay your PG&E bill".
const ACTION_WORDS = /\b(sign ?in|sign ?on|log ?in|verify|confirm|unlock|reset|update|pay|review|restore|secure|access) /;

type FindingCode = "listed" | "lookalike" | "runs_code" | "text_names_brand" | "text_mismatch" | "odd_letters" | "hides_target" | "bare_number" | "new_site";

// Most serious first. The first one found becomes the plain reason.
const FINDINGS: Record<FindingCode, { status: CheckStatus; reason: (brand?: Brand) => string }> = {
  listed: { status: "fail", reason: () => "A link in this email goes to a website known for scams." },
  lookalike: { status: "fail", reason: (b) => `A link goes to a fake copy of the ${b?.name} website.` },
  runs_code: { status: "fail", reason: () => "A link runs hidden code instead of opening a website." },
  text_names_brand: { status: "fail", reason: (b) => `A link says it goes to ${b?.name}, but it really goes somewhere else.` },
  text_mismatch: { status: "warn", reason: () => "A link shows one web address but goes to a different one." },
  odd_letters: { status: "warn", reason: () => "A link uses odd letters that can trick the eye." },
  hides_target: { status: "warn", reason: () => "A link hides where it really goes." },
  bare_number: { status: "warn", reason: () => "A link goes to a string of numbers instead of a named website." },
  new_site: { status: "warn", reason: () => "A link goes to a website that is only a few days old." },
};

const NEW_SITE_DAYS = 30;

type Target = { rawHost: string; host: string; site: string; isIp: boolean; hasUserinfo: boolean; userinfo: string; inner: string[] };
type Parsed = { kind: "web"; target: Target } | { kind: "code" } | { kind: "other" } | { kind: "ignore" };

/** Cleans a link the way a browser does: tabs and newlines vanish, "\" means "/". */
function normalizeHref(raw: string): string {
  return raw
    .replace(/[\t\n\r]/g, "")
    .replace(/^[\u0000- ]+|[\u0000- ]+$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\/\//, "https://");
}

/** Full web addresses tucked inside a link, as redirect wrappers do: "?url=https://...". */
/** URLs wrapped inside a redirect link (google.com/url?q=..., urldefense, l.php?u=...). */
export function innerUrls(href: string): string[] {
  const found: string[] = [];
  const query = href.indexOf("?");
  if (query !== -1) {
    for (const part of href.slice(query + 1).split(/[&;]/).slice(0, 50)) {
      const value = part.slice(part.indexOf("=") + 1);
      let decoded = value;
      try {
        decoded = decodeURIComponent(value.replace(/\+/g, " "));
      } catch {
        // keep the raw value
      }
      if (/^https?:\/\//i.test(decoded)) found.push(decoded);
    }
  }
  // Proofpoint: "https://urldefense.com/v3/__https://example.com/x__;..."
  const wrapped = /__(https?:\/\/[^_]{1,2048}?)__/i.exec(href)?.[1];
  if (wrapped) found.push(wrapped);
  return found;
}

function parseHref(rawHref: string, depth = 0): Parsed {
  const href = normalizeHref(rawHref);
  if (href === "" || href.startsWith("#") || href.startsWith("/") || href.startsWith("?")) return { kind: "ignore" };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (scheme === "mailto" || scheme === "tel" || scheme === "sms" || scheme === "cid") return { kind: "ignore" };
  if (scheme === "javascript" || scheme === "data" || scheme === "vbscript") return { kind: "code" };
  if (scheme !== "http" && scheme !== "https") return scheme ? { kind: "other" } : { kind: "ignore" };

  const m = /^https?:\/\/(?:([^/?#@]*)@)?(\[[^\]]*\]|[^/?#:]+)/i.exec(href);
  if (!m) return { kind: "other" };
  const rawHost = m[2].toLowerCase().replace(/\.$/, "");
  let host = rawHost;
  try {
    host = new URL(href).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    // keep the raw host
  }
  return {
    kind: "web",
    target: {
      rawHost,
      host,
      site: registrableDomain(host),
      isIp: parse(host).isIp === true,
      hasUserinfo: m[1] !== undefined,
      userinfo: (m[1] ?? "").toLowerCase().replace(/:.*$/, ""), // drop any ":password"
      inner: depth === 0 ? innerUrls(href) : [],
    },
  };
}

/**
 * The web address shown in link text: the whole text ("www.chase.com", "chase.com/login") or
 * one inside it ("www.chase.com - view statement"). Must end in a real public suffix, so
 * "Statement.pdf" and "Dr.Smith" don't count.
 */
function hostInText(text: string): string | undefined {
  for (const m of text.slice(0, 500).matchAll(/(?:^|[\s(<"'])(?:https?:\/\/)?((?:[a-z0-9\u00a1-\uffff-]+\.)+[a-z\u00a1-\uffff]{2,})\.?(?=$|[\s/?#:)>"',;!])/gi)) {
    const host = m[1].toLowerCase();
    if (parse(host).isIcann === true) return host;
  }
  return undefined;
}

/**
 * `intel` holds domain age and blocklist results fetched ahead of time (see intel.ts), keyed by
 * registrable domain. Without it, those two checks are reported as not checked.
 */
export function linkAudit(email: ParsedEmail, intel: LinkIntel = {}): CheckResult {
  const found = new Map<FindingCode, { count: number; brand?: Brand }>();
  const add = (code: FindingCode, brand?: Brand) => {
    const prev = found.get(code);
    found.set(code, { count: (prev?.count ?? 0) + 1, brand: prev?.brand ?? brand });
  };

  const sites = new Set<string>();
  const auditTarget = (target: Target) => {
    sites.add(target.site);
    if (!isPlausibleHost(target.host)) {
      add("hides_target");
      return;
    }
    const imitated = lookalikeOf(target.rawHost) ?? lookalikeOf(target.host);
    const brandHosted = imitated && BRAND_HOSTS.has(target.site) && isOfficialFor(email.fromDomain, imitated);
    if (imitated && !brandHosted) add("lookalike", imitated);
    if (hasNonAscii(target.rawHost) || target.host.split(".").some((l) => l.startsWith("xn--"))) add("odd_letters");
    if (target.isIp) add("bare_number");
    if (SHORTENERS.has(target.site)) add("hides_target");
    // "https://www.chase.com@evil.example/" shows chase.com but goes to evil.example.
    const userinfoBrand = target.hasUserinfo ? brandForSite(target.userinfo.replace(/^www\./, "")) : undefined;
    if (userinfoBrand) add("text_names_brand", userinfoBrand);
    else if (target.hasUserinfo) add("hides_target");
  };

  for (const link of email.links) {
    const parsed = parseHref(link.href);
    if (parsed.kind === "ignore") continue;
    if (parsed.kind === "code") {
      add("runs_code");
      continue;
    }
    if (parsed.kind === "other") {
      add("hides_target");
      continue;
    }
    const outer = parsed.target;
    auditTarget(outer);
    // A redirect wrapper's real destination gets the same checks, and is what the text
    // should match.
    const inner = outer.inner.map((u) => parseHref(u, 1)).flatMap((p) => (p.kind === "web" ? [p.target] : []));
    inner.forEach(auditTarget);
    const destination = inner[inner.length - 1] ?? outer;
    const targetBrand = brandForSite(destination.host);
    const tracker = MAIL_TRACKERS.has(destination.site);

    const shown = hostInText(link.text);
    if (shown && registrableDomain(shown) !== destination.site) {
      const shownBrand = brandForSite(shown) ?? lookalikeOf(shown);
      // Through a newsletter tracker: fine for an ordinary site, worth a look for a brand.
      if (shownBrand && shownBrand !== targetBrand) add(tracker ? "text_mismatch" : "text_names_brand", shownBrand);
      else if (!shownBrand && !tracker) add("text_mismatch");
    } else if (!shown) {
      // "Sign in to Chase" pointing anywhere but Chase.
      const folded = foldText(link.text.slice(0, 300)) + " ";
      const named = ACTION_WORDS.test(folded) ? brandInSubject(`${folded} account`) : undefined;
      if (named && named !== targetBrand) add(tracker ? "text_mismatch" : "text_names_brand", named);
    }
  }

  let unchecked = 0;
  for (const site of sites) {
    const info = intel[site];
    if (!info) {
      unchecked++;
      continue;
    }
    if (info.listed) add("listed");
    if (info.ageDays !== undefined && info.ageDays < NEW_SITE_DAYS) add("new_site");
  }

  const notChecked = unchecked > 0 ? `; age and blocklist not checked for ${unchecked} site(s)` : "";
  const codes = (Object.keys(FINDINGS) as FindingCode[]).filter((code) => found.has(code));
  if (codes.length === 0) {
    if (sites.size === 0) return { id: "link_audit", status: "pass", plainReason: "This email has no web links.", detail: "no links" };
    return { id: "link_audit", status: "pass", plainReason: "The links go where they say they go.", detail: `${sites.size} site(s), nothing odd${notChecked}` };
  }
  const top = codes[0];
  const detail = codes
    .map((code) => {
      const f = found.get(code)!;
      const brand = f.brand ? `:${f.brand.officialDomains[0]}` : "";
      return `${code}${brand} x${f.count}`;
    })
    .join(", ");
  return { id: "link_audit", status: FINDINGS[top].status, plainReason: FINDINGS[top].reason(found.get(top)!.brand), detail: detail + notChecked };
}
