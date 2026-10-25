import { describe, expect, test } from "vitest";
import { classifySite, titleImpersonates } from "./sites";

describe("classifySite", () => {
  test("big, long-standing sites are established", () => {
    expect(classifySite("https://www.youtube.com/watch?v=abc").cls).toBe("established");
    expect(classifySite("https://old.reddit.com/r/cats").cls).toBe("established");
    expect(classifySite("https://en.wikipedia.org/wiki/Cat").cls).toBe("established");
    expect(classifySite("https://healthy.kaiserpermanente.org/").cls).toBe("established");
  });

  test("anyone-can-publish platforms are user content, even on big domains", () => {
    expect(classifySite("https://docs.google.com/forms/d/abc").cls).toBe("user_content");
    expect(classifySite("https://forms.gle/xyz").cls).toBe("user_content");
    expect(classifySite("https://evil.github.io/login").cls).toBe("user_content");
    expect(classifySite("https://www.dropbox.com/s/abc").cls).toBe("user_content");
    expect(classifySite("https://bit.ly/3abc").cls).toBe("user_content");
  });

  test("everything else is unknown, including junk", () => {
    expect(classifySite("https://secure-docs-view.top/x").cls).toBe("unknown");
    expect(classifySite("javascript:alert(1)").cls).toBe("unknown");
    expect(classifySite("not a url").site).toBe("");
  });
});

describe("a page title pretending to be a brand", () => {
  test("matches brand names as whole words only", () => {
    expect(titleImpersonates("UPS Sign In", "ups-track.top")).toBe(true);
    expect(titleImpersonates("Chase | Sign in", "chase-verify.top")).toBe(true);
    expect(titleImpersonates("Support Groups - Sign in", "caregiver-groups.org")).toBe(false); // "ups" inside "groups"
    expect(titleImpersonates("Secure Messaging", "clinic-portal.com")).toBe(false); // "ssa" inside "messaging"
    expect(titleImpersonates("UPS Sign In", "ups.com")).toBe(false); // the real site
  });
});
