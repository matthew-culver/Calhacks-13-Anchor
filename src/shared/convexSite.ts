// Where Person A's HTTP routes live (Convex "site" URL), e.g. the Gmail connect form posts here.
// Prefer the explicit variable; otherwise derive it from the deployment URL. Throws when neither
// gives an absolute URL: a relative "/gmail/start" would post to this website and dead-end.

export function convexSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  const url = (explicit || derive(process.env.NEXT_PUBLIC_CONVEX_URL)).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_SITE_URL is empty. Set it in .env.local (the deployment's .convex.site URL).",
    );
  }
  return url;
}

function derive(deploymentUrl: string | undefined): string {
  const url = (deploymentUrl ?? "").trim().replace(/\/+$/, "");
  if (/\.convex\.cloud$/.test(url)) return url.replace(/\.convex\.cloud$/, ".convex.site");
  // `npx convex dev --local` serves the site one port above the deployment.
  const local = url.match(/^(http:\/\/(?:127\.0\.0\.1|localhost)):3210$/);
  if (local) return `${local[1]}:3211`;
  return "";
}
