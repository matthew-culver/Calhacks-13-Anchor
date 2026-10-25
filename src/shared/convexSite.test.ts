import { afterEach, describe, expect, it, vi } from "vitest";
import { convexSiteUrl } from "./convexSite";

afterEach(() => vi.unstubAllEnvs());

const env = (site: string, deployment: string) => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", site);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", deployment);
};

describe("convexSiteUrl", () => {
  it("uses the explicit site URL, without a trailing slash", () => {
    env("https://x.convex.site/", "https://x.convex.cloud");
    expect(convexSiteUrl()).toBe("https://x.convex.site");
  });

  it("derives it from the deployment URL when the site URL is empty", () => {
    env("", "https://x.convex.cloud/");
    expect(convexSiteUrl()).toBe("https://x.convex.site");
  });

  it("derives the local dev site port", () => {
    env("", "http://127.0.0.1:3210");
    expect(convexSiteUrl()).toBe("http://127.0.0.1:3211");
  });

  it("refuses to fall back to a relative path", () => {
    env("", "");
    expect(() => convexSiteUrl()).toThrow(/NEXT_PUBLIC_CONVEX_SITE_URL/);
    env("", "https://example.com");
    expect(() => convexSiteUrl()).toThrow();
  });
});
