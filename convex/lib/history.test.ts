import { describe, expect, test } from "vitest";
import { BRANDS } from "../checks/brands";
import {
  accountSignals,
  applyDiscovered,
  authenticatedFor,
  buildHistory,
  cleanOrgName,
  type HeaderRecord,
  MAX_ACCOUNTS,
  parseAddresses,
  rankAccount,
  senderOf,
} from "./history";
import { ORGS, orgForDomain } from "./orgDirectory";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 25);
const PASS = ["mx.google.com; spf=pass; dkim=pass; dmarc=pass (p=REJECT)"];
const FAIL = ["mx.google.com; spf=fail; dkim=none; dmarc=fail (p=REJECT)"];

const got = (from: string, daysAgo: number, auth = PASS, subject?: string): HeaderRecord => ({
  from,
  to: "Mom <mom.culver@gmail.com>",
  authResults: auth,
  date: now - daysAgo * DAY,
  sent: false,
  ...(subject !== undefined && { subject }),
});
/** Account-type mail: the same sender every `every` days, `count` times, newest `newest` days ago. */
const series = (from: string, subject: string, count: number, newest: number, every = 30, auth = PASS): HeaderRecord[] =>
  Array.from({ length: count }, (_, i) => got(from, newest + i * every, auth, subject));
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

  test("covers the services older adults use, each with a plain sign-in link", () => {
    expect(ORGS.length).toBeGreaterThanOrEqual(100);
    for (const category of ["bank", "health", "pharmacy", "insurance", "utility", "government", "shopping", "other"]) {
      expect(ORGS.filter((o) => o.category === category).length, category).toBeGreaterThanOrEqual(3);
    }
    for (const org of ORGS) {
      const url = new URL(org.loginUrl);
      expect(url.search + url.hash, org.name).toBe(""); // no tracking codes or session tokens
    }
    expect(new Set(ORGS.map((o) => o.name)).size).toBe(ORGS.length);
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
        got("Kaiser <noreply@kp.org>", 400, PASS, "Your test results are ready"),
        got("Kaiser <noreply@kp.org>", 200, PASS, "Appointment reminder"),
        got("Kaiser <noreply@kp.org>", 100),
        got("Kaiser <news@kaiserpermanente.org>", 60),
        got("Kaiser <news@kaiserpermanente.org>", 40),
        got("Kaiser <news@kaiserpermanente.org>", 20),
        got("Wells Fargo <alerts@notify.wellsfargo.com>", 90, PASS, "Your statement is ready"),
        got("Wells Fargo <alerts@notify.wellsfargo.com>", 60, PASS, "Your statement is ready"),
        got("Wells Fargo <alerts@notify.wellsfargo.com>", 30, PASS, "Your statement is ready"),
        got("Some Shop <deals@randomshop.com>", 30, PASS, "Big summer sale"),
        got("Some Shop <deals@randomshop.com>", 20, PASS, "New arrivals"),
        got("Some Shop <deals@randomshop.com>", 2, PASS, "Last chance: 20% off"),
      ],
      now,
    );
    expect(accounts.map((a) => a.orgName).sort()).toEqual(["Kaiser Permanente", "Wells Fargo"]);
    expect(accounts.find((a) => a.orgName === "Kaiser Permanente")).toMatchObject({
      category: "health",
      officialDomains: ["kp.org", "kaiserpermanente.org"],
      loginUrl: expect.stringMatching(/^https:\/\/healthy\.kaiserpermanente\.org\//),
      loginUrlSource: "curated",
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
    const { accounts } = buildHistory([got("Kaiser <noreply@kp.org>", 5, PASS, "Your appointment is confirmed"), sent("help@kp.org", 4)], now);
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

describe("account signals (A8)", () => {
  test("spots account mail from its subject", () => {
    expect(accountSignals("New sign-in to your account")).toEqual(["sign_in"]);
    expect(accountSignals("We noticed a new device")).toEqual(["sign_in"]);
    expect(accountSignals("Security alert: your email address was changed")).toEqual(["security"]);
    expect(accountSignals("Reset your password")).toEqual(["password"]);
    expect(accountSignals("Your verification code is ready")).toEqual(["code"]);
    expect(accountSignals("Your statement is ready to view")).toEqual(["statement"]);
    expect(accountSignals("Your Medicare Summary Notice is available")).toEqual(["statement"]);
    expect(accountSignals("Your PG&E bill is ready")).toEqual(["bill"]);
    expect(accountSignals("Payment due in 5 days")).toEqual(["bill"]);
    expect(accountSignals("Your order has shipped")).toEqual(["order"]);
    expect(accountSignals("Your prescription is ready for pickup")).toEqual(["order"]);
    expect(accountSignals("Appointment reminder for Tuesday")).toEqual(["appointment"]);
    expect(accountSignals("New test results are available")).toEqual(["appointment"]);
    expect(accountSignals("Shipped: reading glasses, 2 pairs")).toEqual(["order"]);
    expect(accountSignals("Delivered: your package")).toEqual(["order"]);
  });

  test("marketing, newsletters and receipts are not account mail", () => {
    for (const s of [
      "Our spring newsletter",
      "Save 20% on your next order",
      "Last chance: free shipping on every order",
      "Your receipt from Apple",
      "Tips for a healthy heart",
      "Exclusive offer: open a new account today",
      "Updates to our Privacy Statement",
      "Changes to your Cardmember Agreement",
      "Thanks for your visit!",
      "",
    ]) {
      expect(accountSignals(s), s).toEqual([]);
    }
  });

  test("handles huge or odd subjects quickly", () => {
    const start = Date.now();
    accountSignals(`${"statement ".repeat(20_000)}`);
    accountSignals("\u0000\u200bsign\u200b-in");
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe("real-use ranking (A8)", () => {
  // Mom's real life: health and bank first, then bills, then shopping. Marketing-only and
  // long-gone accounts don't show up at all.
  const inbox = () => [
    ...series("Kaiser <noreply@kp.org>", "Your test results are ready", 4, 3, 20),
    ...series("Kaiser <noreply@kp.org>", "Appointment reminder", 3, 10, 40),
    ...series("Wells Fargo <alerts@notify.wellsfargo.com>", "Your statement is ready", 12, 5),
    ...series("Wells Fargo <alerts@notify.wellsfargo.com>", "New sign-in to Wells Fargo Online", 2, 2, 60),
    ...series("PG&E <billing@notifications.pge.com>", "Your PG&E bill is ready", 12, 8),
    ...series("Amazon.com <shipment-tracking@amazon.com>", "Your order has shipped", 30, 1, 7),
    ...series("Apple <no_reply@email.apple.com>", "Your receipt from Apple", 10, 4),
    ...series("Sutter Health <news@sutterhealth.org>", "Healthy living tips for fall", 20, 2, 10),
    ...series("Blue Shield of California <noreply@blueshieldca.com>", "Your statement is ready", 5, 430),
    ...series("Netflix <info@account.netflix.com>", "Your bill", 6, 12),
  ];

  test("only accounts Mom really uses, most important first", () => {
    const { accounts } = buildHistory(inbox(), now);
    expect(accounts.map((a) => a.orgName)).toEqual(["Wells Fargo", "Kaiser Permanente", "PG&E", "Netflix", "Amazon"]);
    // Marketing only (Sutter), receipts only (Apple), a past insurer (Blue Shield): not shown.
    for (const gone of ["Sutter Health", "Apple", "Blue Shield of California"]) {
      expect(accounts.find((a) => a.orgName === gone), gone).toBeUndefined();
    }
  });

  test("records why: the signals, the newest account email and a rank", () => {
    const { accounts } = buildHistory(inbox(), now);
    const wells = accounts.find((a) => a.orgName === "Wells Fargo")!;
    expect(wells.signals).toEqual(["statement", "sign_in"]); // strongest first
    expect(wells.lastActivity).toBe(now - 2 * DAY);
    expect(wells.messageCount).toBe(14);
    expect(wells.loginUrlSource).toBe("curated");
    const ranks = accounts.map((a) => a.rank!);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  test("never stores the subject", () => {
    const secret = "Your statement for account ending 4321 is ready";
    const out = buildHistory(series("Wells Fargo <alerts@notify.wellsfargo.com>", secret, 4, 1), now);
    expect(JSON.stringify(out)).not.toContain("4321");
    expect(JSON.stringify(out)).not.toContain("ending");
  });

  test("signals count only from authenticated mail that Gmail didn't file as promotions", () => {
    const spoofed = series("Chase <alerts@chase.com>", "Your statement is ready", 6, 1, 20, FAIL);
    expect(buildHistory(spoofed, now).accounts).toEqual([]);
    const promo = series("Chase <offers@chase.com>", "Your statement is ready", 6, 1, 20).map((r) => ({ ...r, promotional: true }));
    expect(buildHistory(promo, now).accounts).toEqual([]);
  });

  test("an old account with nothing in the last year drops off", () => {
    const old = series("Aetna <noreply@aetna.com>", "Your explanation of benefits is ready", 6, 420, 30);
    expect(buildHistory(old, now).accounts).toEqual([]);
    const yearly = series("Social Security <noreply@ssa.gov>", "Your benefit statement is ready", 2, 300, 365);
    expect(buildHistory([...yearly, ...series("Social Security <noreply@ssa.gov>", "News", 3, 20, 10)], now).accounts.map((a) => a.orgName)).toEqual([
      "Social Security",
    ]);
  });

  test("shows every real account, not a fixed few", () => {
    const records = ORGS.slice(0, 30).flatMap((o) => series(`"${o.name}" <noreply@${o.domains[0]}>`, "Your statement is ready", 3, 5, 10));
    const { accounts } = buildHistory(records, now);
    expect(accounts).toHaveLength(30);
    expect(MAX_ACCOUNTS).toBeGreaterThanOrEqual(40);
  });

  test("health, banks and government rank above shopping for the same use", () => {
    const base = { signals: ["statement" as const], lastActivity: now - DAY, signalCount: 3, wrote: false };
    const health = rankAccount({ ...base, category: "health" }, now);
    const bank = rankAccount({ ...base, category: "bank" }, now);
    const shop = rankAccount({ ...base, category: "shopping" }, now);
    const other = rankAccount({ ...base, category: "other" }, now);
    expect(health).toBeGreaterThan(shop);
    expect(bank).toBeGreaterThan(shop);
    expect(shop).toBeGreaterThan(other);
    // Recent use beats old use.
    expect(rankAccount({ ...base, category: "bank" }, now)).toBeGreaterThan(rankAccount({ ...base, category: "bank", lastActivity: now - 200 * DAY }, now));
  });
});

describe("accounts with companies outside our list (A8)", () => {
  test("a company with real account mail shows up by its own name, without a link yet", () => {
    const { accounts } = buildHistory(series('"Bayview Family Dental" <reminders@bayviewdental.com>', "Appointment reminder", 6, 6, 45), now);
    expect(accounts).toEqual([
      expect.objectContaining({
        orgName: "Bayview Family Dental",
        category: "other",
        officialDomains: ["bayviewdental.com"],
        signals: ["appointment"],
      }),
    ]);
    expect(accounts[0].loginUrl).toBeUndefined();
    expect(accounts[0].loginUrlSource).toBeUndefined();
  });

  test("newsletters from an unknown company don't make an account", () => {
    const { accounts } = buildHistory(series("Sunrise Senior Center <news@sunrisecenter.org>", "This month at Sunrise", 12, 3), now);
    expect(accounts).toEqual([]);
  });

  test("a friend with their own domain is not an account", () => {
    const { accounts } = buildHistory(series("Bob Jones <bob@jonesfamily.net>", "Invoice for the cabin rental", 5, 3), now);
    expect(accounts).toEqual([]);
  });

  test("a company that names itself after a bank it isn't is never an account", () => {
    for (const from of [
      '"Wells Fargo Alerts" <alerts@wf-alerts.co>',
      '"Chase Online" <noreply@secure-banking-online.com>',
      '"Account Services" <noreply@paypa1.com>',
      '"Fidelity Investments" <noreply@fidelity-statements.net>',
      // A plain name, but an address built from a company we know.
      '"Statements" <noreply@fidelity-statements.net>',
      '"Rewards Team" <noreply@wellsfargorewards.com>',
    ]) {
      const evil = ["mx.google.com; spf=pass; dkim=pass; dmarc=pass (p=REJECT)"];
      expect(buildHistory(series(from, "Your statement is ready", 6, 1, 7, evil), now).accounts, from).toEqual([]);
    }
  });

  test("a local business whose name merely contains a word like Chase is fine", () => {
    const { accounts } = buildHistory(series('"Chasewood Dental" <reminders@chasewood-dental.com>', "Appointment reminder", 6, 6, 45), now);
    expect(accounts.map((a) => a.orgName)).toEqual(["Chasewood Dental"]);
    const providence = buildHistory(series('"Providence Dental" <reminders@providence-dental.com>', "Appointment reminder", 6, 6, 45), now);
    expect(providence.accounts.map((a) => a.orgName)).toEqual(["Providence Dental"]);
  });

  test("one triggered email is not enough", () => {
    expect(buildHistory([got("Bayview <noreply@bayviewdental.com>", 2, PASS, "Your verification code")], now).accounts).toEqual([]);
  });

  test("a messy display name falls back to the company's address", () => {
    const { accounts } = buildHistory(series("noreply <noreply@bayviewdental.com>", "Appointment reminder", 6, 6, 45), now);
    expect(accounts[0].orgName).toBe("bayviewdental.com");
  });

  test("cleans names: plain letters, short, no addresses or brand claims", () => {
    expect(cleanOrgName("  Bayview   Family Dental ", "bayviewdental.com")).toBe("Bayview Family Dental");
    expect(cleanOrgName("Bayview\u200b Dental", "bayviewdental.com")).toBe("Bayview Dental");
    expect(cleanOrgName("bayviewdental.com", "bayviewdental.com")).toBeNull();
    expect(cleanOrgName("No-Reply", "bayviewdental.com")).toBeNull();
    expect(cleanOrgName("\u0412\u0430yview", "bayviewdental.com")).toBeNull(); // Cyrillic look-alikes
    expect(cleanOrgName("x".repeat(80), "bayviewdental.com")).toBeNull();
    expect(cleanOrgName("Chase Bank", "bayviewdental.com")).toBeNull();
    expect(cleanOrgName("Kaiser Permanente Billing", "kp-billing.com")).toBeNull();
    // Not a message, and it has to match the company's own address.
    expect(cleanOrgName("Call Dad Now It Is Urgent", "bayviewdental.com")).toBeNull();
    expect(cleanOrgName("Bayview Verify Your Account", "bayviewdental.com")).toBeNull();
    expect(cleanOrgName("Dr. Jane Smith", "bayviewdental.com")).toBeNull();
    expect(cleanOrgName("Golden Gate Dental", "ggdental.com")).toBe("Golden Gate Dental");
  });

  test("needs half a year of account mail: a scammer's own domain can't become one quickly", () => {
    // Three months of authenticated "statements" from an automated mailbox: not yet.
    expect(buildHistory(series('"Sunrise Credit Union" <noreply@sunrisecu.com>', "Your statement is ready", 4, 2, 30), now).accounts).toEqual([]);
    // Mom replying once doesn't shortcut that for a company outside our list.
    const replied = [
      ...series('"Sunrise Credit Union" <noreply@sunrisecu.com>', "Your statement is ready", 1, 2),
      sent("help@sunrisecu.com", 1),
    ];
    expect(buildHistory(replied, now).accounts).toEqual([]);
    // Half a year of it: an account.
    const real = buildHistory(series('"Sunrise Credit Union" <noreply@sunrisecu.com>', "Your statement is ready", 7, 2, 30), now);
    expect(real.accounts.map((a) => a.orgName)).toEqual(["Sunrise Credit Union"]);
  });

  test("ranks below known accounts with the same use: it's ranked as 'other'", () => {
    const { accounts } = buildHistory(
      [
        ...series('"Sunrise Credit Union" <noreply@sunrisecu.com>', "Your statement is ready", 7, 2, 30),
        ...series("Wells Fargo <alerts@notify.wellsfargo.com>", "Your statement is ready", 7, 2, 30),
      ],
      now,
    );
    expect(accounts.map((a) => a.orgName)).toEqual(["Wells Fargo", "Sunrise Credit Union"]);
  });

  test("mail through a platform anyone can send from is never a company account", () => {
    for (const from of ['"Acme Support" <support@acme.zendesk.com>', '"Bayview Dental" <noreply@squareup.com>']) {
      expect(buildHistory(series(from, "Your statement is ready", 8, 2, 30), now).accounts, from).toEqual([]);
    }
  });

  test("named from the company's own account mail, not from a person who works there", () => {
    const { accounts } = buildHistory(
      [
        ...series('"Dr. Jane Smith" <jane.smith@bayviewdental.com>', "Your appointment", 10, 3, 20),
        ...series('"Bayview Reminders" <reminders@bayviewdental.com>', "Appointment reminder", 6, 6, 45),
      ],
      now,
    );
    expect(accounts.map((a) => a.orgName)).toEqual(["Bayview Reminders"]);
  });

  test("a display name that is a message falls back to the plain address", () => {
    const { accounts } = buildHistory(series('"Call Dad Now It Is Urgent" <noreply@bayviewdental.com>', "Appointment reminder", 6, 6, 45), now);
    expect(accounts.map((a) => a.orgName)).toEqual(["bayviewdental.com"]);
  });

  test("a sign-in page found later gives it a link, its own name and a group, but never a higher rank", () => {
    const { accounts } = buildHistory(series("Bayview <reminders@bayviewdental.com>", "Appointment reminder", 6, 6, 45), now);
    const found = applyDiscovered(accounts[0], {
      orgName: "Bayview Family Dental",
      category: "health",
      loginUrl: "https://portal.bayviewdental.com/login",
    });
    expect(found).toMatchObject({
      orgName: "Bayview Family Dental",
      category: "health",
      loginUrl: "https://portal.bayviewdental.com/login",
      loginUrlSource: "discovered",
    });
    // The category came from the company's own web page: it may group the screen, not lift the rank.
    expect(found.rank).toBe(accounts[0].rank);
    // A link off the company's own domain is never applied.
    const offDomain = applyDiscovered(accounts[0], { orgName: "Bayview", category: "health", loginUrl: "https://evil.example.com/login" });
    expect(offDomain.loginUrl).toBeUndefined();
  });
});
