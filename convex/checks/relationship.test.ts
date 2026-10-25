import { describe, expect, test } from "vitest";
import { relationship } from "./relationship";
import type { ParsedEmail } from "./types";

const email = (fromAddress: string): ParsedEmail => ({
  fromName: "",
  fromAddress,
  fromDomain: fromAddress.split("@")[1],
  multipleFrom: false,
  subject: "",
  authResults: [],
  text: "",
  links: [],
  hiddenText: [],
  truncated: false,
});
const y2024 = Date.UTC(2024, 3, 1);

describe("relationship check", () => {
  test("pretends to be Chase, Mom has never had Chase mail: fail", () => {
    const r = relationship(email("alerts@chase-secure-login.co"), "Chase", {}, "fail");
    expect(r).toMatchObject({ id: "relationship", status: "fail" });
    expect(r.plainReason).toBe("It says it's Chase, but you've never gotten email from Chase.");
  });

  test("a store that only mentions USPS isn't treated as pretending to be USPS", () => {
    expect(relationship(email("orders@etsy-shop.example"), "USPS", {}, "warn").status).toBe("unknown");
    const known = relationship(email("orders@shop.example"), "USPS", { sender: { messageCount: 9, firstSeen: y2024, authPassRate: 1 } }, "warn");
    expect(known.status).toBe("pass");
  });

  test("a fake Chase never gets a reassuring pass, even when Mom really uses Chase", () => {
    const r = relationship(email("alerts@chase-secure-login.co"), "Chase", {
      claimedBrandHistory: { messageCount: 30, firstSeen: y2024, isAccount: true },
    }, "fail");
    expect(r.status).toBe("warn");
    expect(r.plainReason).toContain("didn't come from Chase's real address");
  });

  test("real Chase domain but no history: a first contact worth asking about", () => {
    expect(relationship(email("alerts@chase.com"), "Chase", {}).status).toBe("warn");
  });

  test("claims Kaiser and Mom has real Kaiser history: pass, with the year", () => {
    const r = relationship(email("noreply@kp.org"), "Kaiser Permanente", {
      claimedBrandHistory: { messageCount: 40, firstSeen: y2024, isAccount: true },
    });
    expect(r.status).toBe("pass");
    expect(r.plainReason).toContain("since 2024");
  });

  test("known sender without a brand claim: pass", () => {
    const r = relationship(email("sue@gmail.com"), undefined, { sender: { messageCount: 12, firstSeen: y2024, authPassRate: 1 } });
    expect(r.status).toBe("pass");
    const wrote = relationship(email("new@gmail.com"), undefined, {
      sender: { messageCount: 0, parentSentCount: 1, firstSeen: y2024, authPassRate: 1 },
    });
    expect(wrote.plainReason).toContain("written to them");
  });

  test("a brand-new sender with no claim doesn't change the level", () => {
    expect(relationship(email("hello@newsletter.example"), undefined, {}).status).toBe("unknown");
  });
});

describe("familiar sender acting unlike themselves", () => {
  const known = { sender: { messageCount: 40, firstSeen: y2024, authPassRate: 1 } };
  const calm = { links: [], pressure: "pass" as const };

  test("Aunt Sue sending a YouTube link is fine: established sites aren't suspicious", () => {
    const r = relationship(email("sue@gmail.com"), undefined, known, "pass", { links: [{ site: "youtube.com", cls: "established" }], pressure: "pass" });
    expect(r.status).toBe("pass");
  });

  test("Aunt Sue linking to an unknown site or a Google Form is flagged as a possible hack", () => {
    for (const cls of ["unknown", "user_content"] as const) {
      const r = relationship(email("sue@gmail.com"), undefined, known, "pass", { links: [{ site: "secure-docs-view.top", cls }], pressure: "pass" });
      expect(r.status).toBe("warn");
      expect(r.plainReason).toContain("may have been hacked");
    }
  });

  test("Aunt Sue suddenly asking for money is flagged", () => {
    const r = relationship(email("sue@gmail.com"), undefined, known, "pass", { links: [], pressure: "warn" });
    expect(r.plainReason).toContain("pushing for money");
  });

  test("replies going to a different address are flagged", () => {
    const e = { ...email("sue@gmail.com"), replyToAddress: "sue.help@outlook.com" };
    expect(relationship(e, undefined, known, "pass", calm).status).toBe("warn");
  });

  test("a normal email from a familiar sender still passes", () => {
    expect(relationship(email("sue@gmail.com"), undefined, known, "pass", calm).status).toBe("pass");
  });
});
