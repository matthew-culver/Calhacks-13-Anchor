import { describe, expect, test } from "vitest";
import { BRANDS } from "../checks/brands";
import { authenticatedFor, buildHistory, type HeaderRecord, parseAddresses, senderOf } from "./history";
import { ORGS, orgForDomain } from "./orgDirectory";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 25);
const PASS = ["mx.google.com; spf=pass; dkim=pass; dmarc=pass (p=REJECT)"];
const FAIL = ["mx.google.com; spf=fail; dkim=none; dmarc=fail (p=REJECT)"];

const got = (from: string, daysAgo: number, auth = PASS): HeaderRecord => ({
  from,
  to: "Mom <mom.culver@gmail.com>",
  authResults: auth,
  date: now - daysAgo * DAY,
  sent: false,
});
const sent = (to: string, daysAgo: number): HeaderRecord => ({
  from: "Mom <mom.culver@gmail.com>",
  to,
  authResults: [],
  date: now - daysAgo * DAY,
  sent: true,
});

describe("org directory", () => {
  test("every login link is on one of the org's own domains", () => {
    for (const org of ORGS) {
      const host = new URL(org.loginUrl).hostname;
      expect(org.loginUrl.startsWith("https://")).toBe(true);
      expect(org.domains.some((d) => host === d || host.endsWith(`.${d}`))).toBe(true);
    }
  });

  test("no domain belongs to two orgs", () => {
    const all = ORGS.flatMap((o) => o.domains);
    expect(new Set(all).size).toBe(all.length);
  });

  test("every brand the scam checks know is in the directory", () => {
    for (const brand of BRANDS) expect(orgForDomain(brand.officialDomains[0]), brand.name).toBeDefined();
  });

  test("finds an org by registrable domain", () => {
    expect(orgForDomain("kaiserpermanente.org")?.name).toBe("Kaiser Permanente");
    expect(orgForDomain("chase-secure-login.co")).toBeUndefined();
  });
});

describe("parsing", () => {
  test("reads addresses from From and To headers", () => {
    expect(parseAddresses('"Kaiser Permanente" <NoReply@KP.org>')).toEqual(["noreply@kp.org"]);
    expect(parseAddresses("a@x.com, Bob <b@y.org>")).toEqual(["a@x.com", "b@y.org"]);
    expect(parseAddresses("undisclosed-recipients:;")).toEqual([]);
  });

  test("the sender is the real mailbox, not an address in the display name", () => {
    expect(senderOf('"alerts@chase.com" <x@evil.co>')).toMatchObject({ address: "x@evil.co", domain: "evil.co" });
    expect(senderOf("Chase <x@evil.co> (alerts@chase.com)")?.address).toBe("x@evil.co");
    expect(senderOf("a@x.com, b@chase.com")).toBeNull(); // two senders: don't guess
    expect(senderOf("garbage")).toBeNull();
    expect(senderOf(`${"a".repeat(300)}@x.com`)).toBeNull();
  });

  test("handles huge headers quickly", () => {
    const start = Date.now();
    senderOf(`${"a".repeat(60_000)}@x.com`);
    parseAddresses(`a@${"a.".repeat(30_000)}com`);
    expect(Date.now() - start).toBeLessThan(500);
  });

  test("authenticated only by Gmail's own top header, aligned with the real sender", () => {
    const chase = { address: "alerts@chase.com", domain: "chase.com" };
    expect(authenticatedFor(PASS, chase)).toBe(true);
    expect(authenticatedFor(FAIL, chase)).toBe(false);
    expect(authenticatedFor([FAIL[0], PASS[0]], chase)).toBe(false); // a lower header can be forged
    expect(authenticatedFor([], chase)).toBe(false);
    // A pass for some other domain doesn't count for this sender.
    expect(authenticatedFor(["mx.google.com; dmarc=pass header.from=evil.co"], chase)).toBe(false);
    // Not Gmail's header on top (e.g. forwarded or imported mail).
    expect(authenticatedFor(["evil.example; dmarc=pass header.from=chase.com"], chase)).toBe(false);
    // "dmarc=pass" hidden in the attacker's MAIL FROM inside a comment.
    expect(
      authenticatedFor(["mx.google.com; spf=pass (domain of dmarc=pass@evil.co) smtp.mailfrom=dmarc=pass@evil.co; dmarc=fail (p=NONE) header.from=chase.com"], chase),
    ).toBe(false);
  });
});

describe("buildHistory", () => {
  test("groups organizations by registrable domain, across subdomains", () => {
    const { relationships } = buildHistory(
      [got("Kaiser <noreply@kp.org>", 600), got("Kaiser <alerts@mail.kp.org>", 10), got("Kaiser <x@kp.org>", 3)],
      now,
    );
    expect(relationships).toHaveLength(1);
    expect(relationships[0]).toMatchObject({
      kind: "org",
      key: "kp.org",
      orgName: "Kaiser Permanente",
      messageCount: 3,
      firstSeen: now - 600 * DAY,
      lastSeen: now - 3 * DAY,
      authPassRate: 1,
    });
  });

  test("keeps people at free mail providers apart, by address", () => {
    const { relationships } = buildHistory(
      [got("Aunt Sue <sue@gmail.com>", 5), got("Bob <bob@gmail.com>", 4), got("Sue <SUE@gmail.com>", 1)],
      now,
    );
    const people = relationships.filter((r) => r.kind === "person");
    expect(people.map((p) => [p.key, p.messageCount]).sort()).toEqual([
      ["bob@gmail.com", 1],
      ["sue@gmail.com", 2],
    ]);
  });

  test("counts who the parent writes to", () => {
    const { relationships } = buildHistory(
      [got("Sue <sue@gmail.com>", 5), sent("Sue <sue@gmail.com>, help@kp.org", 4), sent("sue@gmail.com", 2)],
      now,
    );
    expect(relationships.find((r) => r.key === "sue@gmail.com")?.parentSentCount).toBe(2);
    expect(relationships.find((r) => r.key === "kp.org")?.parentSentCount).toBe(1);
  });

  test("builds My Accounts from authenticated mail from known orgs, merging their domains", () => {
    const { accounts } = buildHistory(
      [
        got("Kaiser <noreply@kp.org>", 400),
        got("Kaiser <noreply@kp.org>", 200),
        got("Kaiser <noreply@kp.org>", 100),
        got("Kaiser <news@kaiserpermanente.org>", 60),
        got("Kaiser <news@kaiserpermanente.org>", 40),
        got("Kaiser <news@kaiserpermanente.org>", 20),
        got("Wells Fargo <alerts@notify.wellsfargo.com>", 90),
        got("Wells Fargo <alerts@notify.wellsfargo.com>", 60),
        got("Wells Fargo <alerts@notify.wellsfargo.com>", 30),
        got("Some Shop <deals@randomshop.com>", 30),
        got("Some Shop <deals@randomshop.com>", 20),
        got("Some Shop <deals@randomshop.com>", 2),
      ],
      now,
    );
    expect(accounts.map((a) => a.orgName).sort()).toEqual(["Kaiser Permanente", "Wells Fargo"]);
    expect(accounts.find((a) => a.orgName === "Kaiser Permanente")).toMatchObject({
      category: "health",
      officialDomains: ["kp.org", "kaiserpermanente.org"],
      loginUrl: "https://healthy.kaiserpermanente.org/",
      firstSeen: now - 400 * DAY,
      messageCount: 6,
    });
  });

  test("one email, or a burst of emails, from a brand is not enough to make it your account", () => {
    const oneOff = buildHistory([got("PayPal <service@paypal.com>", 3)], now);
    expect(oneOff.accounts).toEqual([]);
    const burst = buildHistory([got("x <a@paypal.com>", 3), got("x <a@paypal.com>", 2), got("x <a@paypal.com>", 1)], now);
    expect(burst.accounts).toEqual([]);
  });

  test("an org the parent has written to counts after one authenticated email", () => {
    const { accounts } = buildHistory([got("Kaiser <noreply@kp.org>", 5), sent("help@kp.org", 4)], now);
    expect(accounts.map((a) => a.orgName)).toEqual(["Kaiser Permanente"]);
  });

  test("a scammer's own authenticated domain with Chase's address in the name doesn't make Chase yours", () => {
    const evil = ["mx.google.com; spf=pass smtp.mailfrom=x@evil.co; dkim=pass header.d=evil.co; dmarc=pass (p=REJECT) header.from=evil.co"];
    const records = [40, 30, 20, 10, 1].map((d) => got('"alerts@chase.com" <x@evil.co>', d, evil));
    const { accounts, relationships } = buildHistory(records, now);
    expect(accounts).toEqual([]);
    expect(relationships.map((r) => r.key)).toEqual(["evil.co"]);
  });

  test("skips the parent's own address", () => {
    const { relationships } = buildHistory(
      [got("Mom <mom.culver@gmail.com>", 1), sent("mom.culver@gmail.com, sue@gmail.com", 1)],
      now,
      { selfEmail: "mom.culver@gmail.com" },
    );
    expect(relationships.map((r) => r.key)).toEqual(["sue@gmail.com"]);
  });

  test("a scam pretending to be Chase does not make Chase one of your accounts", () => {
    const { accounts, relationships } = buildHistory(
      [got("Chase <alerts@chase.com>", 3, FAIL), got("Chase <alerts@chase.com>", 1, FAIL)],
      now,
    );
    expect(accounts).toEqual([]);
    expect(relationships.find((r) => r.key === "chase.com")?.authPassRate).toBe(0);
  });

  test("someone the parent wrote to but never heard from has nothing failed", () => {
    const { relationships } = buildHistory([sent("newfriend@gmail.com", 1)], now);
    expect(relationships[0]).toMatchObject({ messageCount: 0, parentSentCount: 1, authPassRate: 1 });
  });

  test("ignores unparseable senders and keeps only the biggest relationships", () => {
    const records = [got("garbage", 1), got("", 1)];
    for (let i = 0; i < 700; i++) records.push(got(`p${i}@gmail.com`, 1));
    records.push(got("Kaiser <x@kp.org>", 1), got("Kaiser <x@kp.org>", 2));
    const { relationships } = buildHistory(records, now);
    expect(relationships.length).toBeLessThanOrEqual(500);
    expect(relationships[0].key).toBe("kp.org"); // biggest first
  });
});
