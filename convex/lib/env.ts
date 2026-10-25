// Convex env vars the Gmail code needs, read at request time (never at module scope).
// Set with `npx convex env set NAME value`. SITE_URL is the website's origin, e.g.
// http://localhost:3000 in dev; CONVEX_SITE_URL is provided by Convex.

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  convexSiteUrl: string;
};

/** All of it, or null if anything is missing. Check this before touching the database or Google. */
export function readGoogleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const siteUrl = process.env.SITE_URL;
  const convexSiteUrl = process.env.CONVEX_SITE_URL;
  if (!clientId || !clientSecret || !siteUrl || !convexSiteUrl) return null;
  return { clientId, clientSecret, siteUrl: siteUrl.replace(/\/+$/, ""), convexSiteUrl: convexSiteUrl.replace(/\/+$/, "") };
}
