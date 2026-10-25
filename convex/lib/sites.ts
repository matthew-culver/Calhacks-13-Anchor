// Is a link's site safe to click? Judged by the site itself, never by "Mom hasn't seen it
// before": a YouTube link from Aunt Sue is fine even if Mom never visits YouTube (A7).
//   established  - big, long-standing sites; safe destinations in themselves
//   user_content - real platforms where ANYONE can publish a page (Google Forms/Sites/Drive,
//                  Dropbox, OneDrive, Wix, GitHub Pages...): fake sign-in pages live here, so
//                  the destination page itself must be looked at
//   unknown      - everything else: needs investigating (age, reputation, what the page asks)

import { BRANDS, registrableDomain } from "../checks/brands";
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
