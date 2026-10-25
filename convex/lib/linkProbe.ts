// Follow a link to where it really goes and look at the page, without Mom clicking (A7).
// Only for links whose site isn't established (see sites.ts). Safety:
//  - query strings, fragments and token-like path parts are stripped first, so a per-victim
//    code can't tell the scammer that Mom's address is real and her mail gets read
//  - only plain https/http on a public hostname: no IP literals, ports, single-label or
//    internal names, and every hop's name must resolve (over DNS-over-HTTPS) only to public
//    addresses, so a link can't point the server at private networks
//  - at most 5 redirects, 5 s per hop, first 200 KB of the page; never throws
// Limits: a scam site can show this check a clean page ("cloaking"); the probe is evidence,
// never proof that a page is safe.

import { registrableDomain } from "../checks/brands";

const MAX_HOPS = 5;
const TIMEOUT_MS = 5000;
const MAX_BYTES = 200_000;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

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

// A path part that looks like a per-recipient token: long base64/hex/digits, or an address.
const TOKENISH = /^(?:[A-Za-z0-9_=-]{16,}|[0-9a-f]{12,}|\d{8,})$|@|%40/i;

/** Scheme + host + path (token-like parts removed). Null if it isn't a safe public URL. */
export function cleanUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host.length > 253) return null; // single-label names
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null; // IP literals
  if (/(^|\.)(localhost|local|internal|intranet|corp|home|lan|invalid|test|example|localdomain|arpa)$/.test(host)) return null;
  const path = u.pathname
    .split("/")
    .filter((part) => !TOKENISH.test(part))
    .join("/");
  return `${u.protocol}//${host}${path || "/"}`.slice(0, 500);
}

/** Private, loopback, link-local, CGNAT, multicast, ULA and mapped addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

/** True only if the name resolves, and every A/AAAA address is public. Fails closed. */
async function resolvesPublic(host: string): Promise<boolean> {
  const addresses: string[] = [];
  for (const type of ["A", "AAAA"]) {
    try {
      const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
      for (const a of body.Answer ?? []) if (a.type === 1 || a.type === 28) addresses.push(a.data);
    } catch {
      return false;
    }
  }
  return addresses.length > 0 && !addresses.some(isPrivateAddress);
}

const oneLine = (s: string, max: number) =>
  s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function probeLink(raw: string): Promise<Probe> {
  const requested = cleanUrl(raw);
  if (!requested) return { requested: "", hops: 0, asksForPassword: false, error: "blocked" };
  let url = requested;
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (!(await resolvesPublic(new URL(url).hostname))) {
        return { requested, finalUrl: url, finalSite: siteOf(url), hops: hop, asksForPassword: false, error: "blocked" };
      }
      const res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const location = res.headers.get("Location");
      if (res.status >= 300 && res.status < 400 && location) {
        let next: string | null = null;
        try {
          next = cleanUrl(new URL(location, url).toString());
        } catch {
          next = null;
        }
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
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { requested, finalUrl: url, finalSite: siteOf(url), hops: 0, asksForPassword: false, error: timeout ? "timeout" : "unreachable" };
  }
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
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
  } catch {
    // a stalled or broken body: use what arrived
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
