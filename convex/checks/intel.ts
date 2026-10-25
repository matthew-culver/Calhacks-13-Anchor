// Network lookups for linkAudit: domain age (RDAP) and Google Safe Browsing.
// These are the only non-pure part of the checks. Call gatherLinkIntel() from an action
// (task A5), then pass its result to linkAudit / runChecks as `intel`.
import { brandForSite, registrableDomain } from "./brands";
import { MAIL_TRACKERS } from "./linkAudit";
import type { ParsedEmail } from "./types";

/** Per registrable domain. A missing entry or field means "not checked". */
export type LinkIntel = Record<string, { ageDays?: number; listed?: boolean }>;

const TIMEOUT_MS = 4000;

/** Days since the domain was registered, from RDAP (the public WHOIS successor). */
export async function lookupDomainAgeDays(domain: string): Promise<number | "unknown"> {
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: "application/rdap+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return "unknown";
    const body = (await res.json()) as { events?: { eventAction?: string; eventDate?: string }[] };
    const registered = body.events?.find((e) => e.eventAction === "registration")?.eventDate;
    const ms = registered ? Date.parse(registered) : NaN;
    if (!Number.isFinite(ms)) return "unknown";
    return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
  } catch {
    return "unknown";
  }
}

/** Registrable domains of the URLs Google Safe Browsing lists as dangerous. One batched call. */
export async function lookupBlocklisted(urls: string[]): Promise<Set<string> | "unknown"> {
  const key = process.env.SAFE_BROWSING_API_KEY;
  if (!key || urls.length === 0) return urls.length === 0 ? new Set() : "unknown";
  try {
    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "anchor", clientVersion: "1.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          // Only scheme + host: full links can carry private login or reset tokens.
          threatEntries: [...new Set(urls.map(originOf).filter((u): u is string => u !== undefined))]
            .slice(0, 500)
            .map((url) => ({ url })),
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return "unknown";
    const body = (await res.json()) as { matches?: { threat?: { url?: string } }[] };
    const listed = new Set<string>();
    for (const m of body.matches ?? []) {
      const site = m.threat?.url ? siteOf(m.threat.url) : undefined;
      if (site) listed.add(site);
    }
    return listed;
  } catch {
    return "unknown";
  }
}

// A crafted email with thousands of links must not fan out into thousands of lookups.
const MAX_SITES = 25;

function originOf(href: string): string | undefined {
  try {
    const url = new URL(href.trim());
    return /^https?:$/.test(url.protocol) && url.hostname ? `${url.protocol}//${url.hostname}/` : undefined;
  } catch {
    return undefined;
  }
}

/** Big brands and mail trackers: looking them up tells us nothing and leaks what the parent reads. */
function worthLookingUp(site: string): boolean {
  return !brandForSite(site) && !MAIL_TRACKERS.has(site);
}

function siteOf(href: string): string | undefined {
  try {
    const url = new URL(href.trim());
    return /^https?:$/.test(url.protocol) && url.hostname ? registrableDomain(url.hostname) : undefined;
  } catch {
    return undefined; // malformed: linkAudit still sees it, we just don't look it up
  }
}

export async function gatherLinkIntel(email: ParsedEmail): Promise<LinkIntel> {
  const urls = email.links
    .map((l) => l.href)
    .filter((href) => {
      const site = siteOf(href);
      return site !== undefined && worthLookingUp(site);
    })
    .slice(0, 500);
  const sites = [...new Set(urls.map((u) => siteOf(u)!))].slice(0, MAX_SITES);
  const [listed, ages] = await Promise.all([lookupBlocklisted(urls), Promise.all(sites.map(lookupDomainAgeDays))]);
  const intel: LinkIntel = {};
  sites.forEach((site, i) => {
    const entry: LinkIntel[string] = {};
    if (listed !== "unknown") entry.listed = listed.has(site);
    if (ages[i] !== "unknown") entry.ageDays = ages[i];
    if (Object.keys(entry).length > 0) intel[site] = entry;
  });
  return intel;
}
