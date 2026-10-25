// Network lookups for linkAudit: domain age (RDAP) and Google Safe Browsing.
// These are the only non-pure part of the checks. Call gatherLinkIntel() from an action
// (task A5), then pass its result to linkAudit / runChecks as `intel`.
import { registrableDomain } from "./brands";
import type { ParsedEmail } from "./types";

/** Per registrable domain. A missing entry or field means "not checked". */
export type LinkIntel = Record<string, { ageDays?: number; listed?: boolean }>;

// TODO(A5): RDAP lookup (https://rdap.org/domain/<domain>), read the "registration" event date.
export async function lookupDomainAgeDays(domain: string): Promise<number | "unknown"> {
  void domain;
  return "unknown";
}

// TODO(A5): Safe Browsing v4 threatMatches:find with SAFE_BROWSING_API_KEY, one batched call.
// Return the registrable domains of the listed URLs.
export async function lookupBlocklisted(urls: string[]): Promise<Set<string> | "unknown"> {
  void urls;
  return "unknown";
}

// A crafted email with thousands of links must not fan out into thousands of lookups.
const MAX_SITES = 25;

function siteOf(href: string): string | undefined {
  try {
    const url = new URL(href.trim());
    return /^https?:$/.test(url.protocol) && url.hostname ? registrableDomain(url.hostname) : undefined;
  } catch {
    return undefined; // malformed: linkAudit still sees it, we just don't look it up
  }
}

export async function gatherLinkIntel(email: ParsedEmail): Promise<LinkIntel> {
  const urls = email.links.map((l) => l.href).filter((href) => siteOf(href) !== undefined).slice(0, 500);
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
