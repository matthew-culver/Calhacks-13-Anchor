// Is a link's site safe to click? Judged by the site itself, never by "Mom hasn't seen it
// before": a YouTube link from Aunt Sue is fine even if Mom never visits YouTube (A7).
//   established  - big, long-standing sites; safe destinations in themselves
//   user_content - real platforms where ANYONE can publish a page (Google Forms/Sites/Drive,
//                  Dropbox, OneDrive, Wix, GitHub Pages...): fake sign-in pages live here, so
//                  the destination page itself must be looked at
//   unknown      - everything else: needs investigating (age, reputation, what the page asks)

import { BRANDS, registrableDomain } from "../checks/brands";
import { innerUrls } from "../checks/linkAudit";
import { ORGS } from "./orgDirectory";

export type SiteClass = "established" | "user_content" | "unknown";

// Host suffixes where anyone can publish. Checked on the full host (docs.google.com is
// user content even though google.com is established).
const USER_CONTENT_HOSTS = [
  "docs.google.com", "forms.gle", "forms.google.com", "sites.google.com", "drive.google.com",
  "storage.googleapis.com", "firebaseapp.com", "web.app", "appspot.com", "script.google.com",
  "dropbox.com", "dropboxusercontent.com", "db.tt", "1drv.ms", "onedrive.live.com",
  "sharepoint.com", "forms.office.com", "forms.microsoft.com", "wixsite.com", "weebly.com",
  "squarespace.com", "github.io", "githubusercontent.com", "gitlab.io", "notion.site",
  "notion.so", "netlify.app", "vercel.app", "pages.dev", "workers.dev", "glitch.me",
  "herokuapp.com", "canva.site", "my.canva.site", "carrd.co", "webflow.io", "blogspot.com",
  "wordpress.com", "medium.com", "typeform.com", "jotform.com", "surveymonkey.com",
  "wetransfer.com", "we.tl", "box.com", "mediafire.com", "s3.amazonaws.com", "azurewebsites.net",
  "ipfs.io", "linktr.ee", "bit.ly", "tinyurl.com", "t.co", "rebrand.ly", "is.gd", "ow.ly",
];

// Large, long-standing sites that are safe destinations in themselves (registrable domains).
const ESTABLISHED = new Set([
  "youtube.com", "youtu.be", "google.com", "gmail.com", "reddit.com", "redd.it", "wikipedia.org",
  "wikimedia.org", "facebook.com", "fb.com", "instagram.com", "whatsapp.com", "x.com",
  "twitter.com", "linkedin.com", "pinterest.com", "tiktok.com", "nytimes.com", "washingtonpost.com",
  "wsj.com", "cnn.com", "bbc.com", "bbc.co.uk", "npr.org", "pbs.org", "apnews.com", "reuters.com",
  "theguardian.com", "usatoday.com", "foxnews.com", "nbcnews.com", "cbsnews.com", "abcnews.go.com",
  "weather.com", "accuweather.com", "imdb.com", "spotify.com", "apple.com", "microsoft.com",
  "yahoo.com", "bing.com", "zoom.us", "etsy.com", "ebay.com", "walmart.com", "target.com",
  "costco.com", "homedepot.com", "lowes.com", "bestbuy.com", "allrecipes.com", "foodnetwork.com",
  "nih.gov", "cdc.gov", "medlineplus.gov", "mayoclinic.org", "webmd.com", "clevelandclinic.org",
  "aarp.org", "ssa.gov", "medicare.gov", "irs.gov", "usa.gov", "nps.gov", "loc.gov", "github.com",
  "stackoverflow.com", "quora.com", "goodreads.com", "nextdoor.com", "craigslist.org",
  "tripadvisor.com", "yelp.com", "booking.com", "airbnb.com", "expedia.com", "nationalgeographic.com",
  "smithsonianmag.com", "time.com", "theatlantic.com", "newyorker.com", "vimeo.com", "twitch.tv",
]);

function hostOf(url: string): string | undefined {
  try {
    const u = new URL(url.trim());
    if (!/^https?:$/.test(u.protocol) || !u.hostname) return undefined;
    return u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}

const within = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

/** Classify a URL's site. Unparseable links are "unknown". */
export function classifySite(url: string): { site: string; host: string; cls: SiteClass } {
  const host = hostOf(url);
  if (!host) return { site: "", host: "", cls: "unknown" };
  const site = registrableDomain(host);
  if (USER_CONTENT_HOSTS.some((h) => within(host, h))) return { site, host, cls: "user_content" };
  if (ESTABLISHED.has(site)) return { site, host, cls: "established" };
  if (BRANDS.some((b) => b.officialDomains.includes(site))) return { site, host, cls: "established" };
  if (ORGS.some((o) => o.domains.includes(site))) return { site, host, cls: "established" };
  return { site, host, cls: "unknown" };
}

/**
 * Where a link really points: a URL wrapped in a redirect (google.com/url?q=..., youtube.com/
 * redirect?q=..., l.facebook.com/l.php?u=..., urldefense) is judged by the inner URL, so a
 * big site's redirector can't make a bad link look "established".
 */
export function linkTarget(href: string): { url: string; viaRedirect: boolean } {
  let url = href;
  for (let depth = 0; depth < 3; depth++) {
    const inner = innerUrls(url)[0];
    if (!inner) break;
    url = inner;
  }
  return { url, viaRedirect: url !== href };
}

/** A sign-in page that names a brand it isn't (a fake Microsoft/Chase login on some site). */
// Each brand name as a whole word: "UPS" in "UPS Sign In", never in "Support Groups".
const TITLE_ALIASES = BRANDS.map((b) => ({
  brand: b,
  patterns: b.aliases.map((a) => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`)),
}));

export function titleImpersonates(title: string | undefined, site: string | undefined): boolean {
  if (!title || !site) return false;
  const t = title.toLowerCase();
  return TITLE_ALIASES.some(
    ({ brand, patterns }) => patterns.some((p) => p.test(t)) && !brand.officialDomains.includes(site) && !(brand.sharedDomains ?? []).includes(site),
  );
}

/**
 * Hard evidence that a link is dangerous, from our own checks (never from the model):
 * on Google's danger list, set up in the last 90 days, a password page on an anyone-can-
 * publish site, or a sign-in page pretending to be a brand.
 */
export function linkIsRisky(l: {
  cls: SiteClass;
  ageDays?: number;
  listedDangerous?: boolean;
  probe?: { asksForPassword: boolean; title?: string; finalSite?: string; error?: string };
}): boolean {
  if (l.listedDangerous) return true;
  if (l.ageDays !== undefined && l.ageDays < 90) return true;
  if (l.probe?.asksForPassword && (l.cls === "user_content" || titleImpersonates(l.probe.title, l.probe.finalSite))) return true;
  return false;
}
