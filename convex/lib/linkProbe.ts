// Follow a link to where it really goes and look at the page, without Mom clicking (A7).
// Only for links whose site isn't established (see sites.ts). Safety:
//  - query strings and fragments are stripped first, so a per-victim tracking code can't
//    tell the scammer that Mom's address is real and her mail gets read
//  - only plain http(s) on a hostname: no IP addresses, ports, localhost or internal names
//  - at most 5 redirects, 5 s per hop, first 200 KB of the page

import { registrableDomain } from "../checks/brands";

const MAX_HOPS = 5;
const TIMEOUT_MS = 5000;
const MAX_BYTES = 200_000;

export type Probe = {
  requested: string; // the cleaned URL we fetched
  finalUrl?: string; // where the redirects ended (cleaned)
  finalSite?: string; // registrable domain of finalUrl
  hops: number;
  status?: number;
  title?: string;
  asksForPassword: boolean; // the page has a password field
  error?: "blocked" | "unreachable" | "timeout";
};

/** Scheme + host + path only. Null if it isn't a safe public http(s) URL. */
export function cleanUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.length > 253) return null;
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null; // IP literals
  if (/(^|\.)(localhost|local|internal|intranet|corp|home|lan|invalid|test|example)$/.test(host)) return null;
  return `${u.protocol}//${host}${u.pathname}`.slice(0, 500);
}

const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

export async function probeLink(raw: string): Promise<Probe> {
  const requested = cleanUrl(raw);
  if (!requested) return { requested: "", hops: 0, asksForPassword: false, error: "blocked" };
  let url = requested;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AnchorLinkCheck/1.0)", Accept: "text/html" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const timeout = e instanceof Error && e.name === "TimeoutError";
      return { requested, finalUrl: url, finalSite: siteOf(url), hops: hop, asksForPassword: false, error: timeout ? "timeout" : "unreachable" };
    }
    const location = res.headers.get("Location");
    if (res.status >= 300 && res.status < 400 && location) {
      const next = cleanUrl(new URL(location, url).toString());
      if (!next) return { requested, finalUrl: url, finalSite: siteOf(url), hops: hop + 1, status: res.status, asksForPassword: false, error: "blocked" };
      url = next;
      continue;
    }
    const html = await readCapped(res);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    return {
      requested,
      finalUrl: url,
      finalSite: siteOf(url),
      hops: hop,
      status: res.status,
      ...(title && { title: oneLine(decodeEntities(title), 100) }),
      asksForPassword: /<input[^>]+type\s*=\s*["']?password/i.test(html),
    };
  }
  return { requested, finalUrl: url, finalSite: siteOf(url), hops: MAX_HOPS, asksForPassword: false, error: "unreachable" };
}

function siteOf(url: string): string | undefined {
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return undefined;
  }
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(total, MAX_BYTES));
  let offset = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, all.length - offset);
    all.set(c.subarray(0, take), offset);
    offset += take;
    if (offset >= all.length) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
