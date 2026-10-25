/// <reference types="vite/client" />
// The accuracy eval: a labeled set of realistic emails (scams built from the patterns the FTC
// and AARP warn older adults about, and the everyday mail a parent gets) run through the whole
// pipeline: parsing, link checks, the five checks, the relationship check against a parent's
// history, and the rule level. No AI and no network: the AI can only make a verdict stricter,
// so this is Anchor's floor.
//
// What counts: a scam is "caught" when it isn't left as real (held as fake, or the kid is
// asked). A real email "held" by mistake is the costly error; one that asks the kid is a small
// one. Regenerate docs/ACCURACY.md with: WRITE_ACCURACY=1 npx vitest run convex/accuracy

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86_400_000;
const FREEMAIL = /@(gmail|yahoo|outlook|hotmail|icloud|aol)\.com$/;
const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./checks/fixtures/${name}`, import.meta.url)), "utf8");

type Case = {
  group: string;
  kind: "scam" | "real";
  from: string;
  subject: string;
  body: string;
  auth?: "pass" | "fail";
  replyTo?: string;
};

// Mom's world: Kaiser, Wells Fargo, CVS, PG&E, Bank of America and Medicare send her mail;
// her son Matt and her friend Sue write to her (and she to them).
const CASES: Case[] = [
  // ---------- Scams ----------
  { group: "Bank impostor, look-alike link", kind: "scam", from: "Chase Bank <chase.alerts.team@gmail.com>", subject: "Unusual sign-in: verify your account within 24 hours", body: "We noticed a sign-in from a new device. Verify now: https://chase-account-verify.top/login" },
  { group: "Bank address forged (fails authentication)", kind: "scam", from: "Wells Fargo <alerts@wellsfargo.com>", auth: "fail", subject: "Your account has been suspended", body: "Restore access here: https://wellsfargo.com.secure-restore.info/login" },
  { group: "Payment app, look-alike address", kind: "scam", from: "PayPal <service@paypa1-support.com>", subject: "Payment of $499.99 sent", body: "If you didn't make this payment, dispute it here: https://paypa1-support.com/dispute" },
  { group: "Store refund from a free email account", kind: "scam", from: "Amazon Refunds <amazon.refund.dept@outlook.com>", subject: "Your refund of $129.99 is waiting", body: "Claim it within 48 hours: https://amzn-refund-center.top/claim" },
  { group: "Apple ID locked", kind: "scam", from: "Apple Support <appleid-noreply@icloud-verify.co>", subject: "Your Apple ID has been locked", body: "Unlock it now: https://icloud-verify.co/unlock" },
  { group: "Tax refund", kind: "scam", from: "IRS Refunds <irs.gov.refunds@gmail.com>", subject: "You have a tax refund of $1,240", body: "Submit your bank details to receive it: https://irs-refund-portal.top/form" },
  { group: "Package redelivery fee", kind: "scam", from: "USPS <tracking@usps-redelivery-notice.com>", subject: "Your package could not be delivered", body: "Pay the $1.99 redelivery fee: https://usps-redelivery-notice.com/pay" },
  { group: "New Medicare card", kind: "scam", from: "Medicare Services <medicare.benefits.center@yahoo.com>", subject: "Your new Medicare card is ready", body: "Confirm your Social Security number to receive it: https://medicare-card-update.top/" },
  { group: "Tech support, phone number only", kind: "scam", from: "Microsoft Support <ms.security.team@gmail.com>", subject: "Virus detected on your computer", body: "Your computer is infected. Call our support line at 1-800-555-0143 right away before your files are deleted." },
  { group: "Streaming payment failed", kind: "scam", from: "Netflix <billing@netflix-account-update.com>", subject: "Your payment was declined", body: "Update your card within 24 hours or your account will be suspended: https://netflix-account-update.com/billing" },
  { group: "Bank transfer app", kind: "scam", from: "Zelle <noreply@zelle-payments-secure.com>", subject: "Payment pending: action required", body: "Confirm your bank sign-in to receive $800: https://zelle-payments-secure.com/receive" },
  { group: "Gift cards for the pastor", kind: "scam", from: "Pastor David <pastor.david.church@gmail.com>", subject: "Quick favor", body: "Are you available? I need you to buy 3 Google Play gift cards for a parishioner. Keep this between us, I'll pay you back." },
  { group: "Lottery prize, pay by wire", kind: "scam", from: "International Lottery Board <claims@intl-lottery-board.org>", subject: "You have won $850,000", body: "To release your winnings, send the processing fee by Western Union within 24 hours." },
  { group: "Romance, cryptocurrency", kind: "scam", from: "James Carter <james.carter.oilrig@gmail.com>", subject: "I need your help", body: "My dear, I am stuck overseas. Please send $2,000 in bitcoin to my wallet address and don't tell your family." },
  { group: "Son's account hacked, gift cards", kind: "scam", from: "Matt Culver <matt.culver@gmail.com>", subject: "need a favor", body: "Mom I'm in a bind and can't talk. Can you buy four $100 Google Play gift cards and send me the numbers? Please don't tell anyone." },
  { group: "Son's name, new address, money", kind: "scam", from: "Matt Culver <matt.culver.help@gmail.com>", subject: "Mom it's me", body: "I lost my phone so this is my new email. I need $500 for a car repair, can you Zelle me today?" },
  { group: "Friend's address faked with a typo", kind: "scam", from: "Sue Miller <sue.miiler@gmail.com>", subject: "photos from Sunday", body: "Click to see the photos: https://photo-share-view.top/album" },
  { group: "Geek Squad renewal, call to cancel", kind: "scam", from: "Geek Squad <geeksquad.billing@gmail.com>", subject: "Your subscription renewed for $399.99", body: "Your Geek Squad protection renewed today. To cancel and get a refund, call 1-888-555-0177 within 24 hours." },
  { group: "Antivirus renewal", kind: "scam", from: "Norton 360 <norton.renewal.center@outlook.com>", subject: "Your Norton subscription has been renewed", body: "We charged $349.99 to your card. Call us to cancel: 1-877-555-0162." },
  { group: "Social media security alert, look-alike site", kind: "scam", from: "Facebook Security <security@facebook-account-alerts.com>", subject: "Someone tried to sign in to your account", body: "Secure your account now: https://facebook-account-alerts.com/secure" },
  { group: "Bank email that replies to someone else", kind: "scam", from: "Bank of America <alerts@bofa-online-alerts.com>", replyTo: "bofa.security.desk@gmail.com", subject: "Unusual activity on your account", body: "Reply to this email with your account number so we can stop the charge." },
  // ---------- Real mail ----------
  { group: "Bank statement", kind: "real", from: "Wells Fargo <alerts@notify.wellsfargo.com>", subject: "Your statement is ready", body: "Your Wells Fargo statement is ready. Sign on at wellsfargo.com to view it." },
  { group: "Pharmacy pickup", kind: "real", from: "CVS Pharmacy <CVS@pharmacy.cvs.com>", subject: "Your prescription is ready for pickup", body: "Your prescription is ready at your CVS on Main St." },
  { group: "Electric bill", kind: "real", from: "PG&E <customerservice@notification.pge.com>", subject: "Your PG&E bill is ready", body: "Your bill of $84.20 is due on the 15th. Pay at https://www.pge.com/" },
  { group: "Bank security alert", kind: "real", from: "Bank of America <onlinebanking@ealerts.bankofamerica.com>", subject: "Security alert: new sign-in", body: "We noticed a new sign-in to your account. If this was you, there's nothing to do." },
  { group: "Medicare summary", kind: "real", from: "Medicare <medicare@info.medicare.gov>", subject: "Your Medicare Summary Notice is ready", body: "Your Medicare Summary Notice is ready. Sign in at medicare.gov to view it." },
  { group: "Son asks Mom to pay a bill", kind: "real", from: "Matt Culver <matt.culver@gmail.com>", subject: "Can you pay the PG&E bill?", body: "Hi Mom! It's $84.20, due Friday. You can pay at https://www.pge.com/ or just Venmo me. Love, Matt" },
  { group: "Son sends a recipe from a site Mom never visited", kind: "real", from: "Matt Culver <matt.culver@gmail.com>", subject: "you'll love this", body: "Mom, look at this cookie recipe! https://www.kingarthurbaking.com/recipes/classic-chocolate-chip-cookies-recipe" },
  { group: "Friend shares a video", kind: "real", from: "Sue Miller <sue.miller@gmail.com>", subject: "funny video", body: "This made me laugh: https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  { group: "Friend asks for rent money by Venmo", kind: "real", from: "Sue Miller <sue.miller@gmail.com>", subject: "lunch money", body: "Thanks for covering lunch! I'll Venmo you back as soon as possible." },
  { group: "New dentist's reminder", kind: "real", from: "Bayview Family Dental <reminders@bayviewdental.com>", subject: "Appointment reminder for Tuesday", body: "This is a reminder of your cleaning on Tuesday at 10am." },
  { group: "Fraud-awareness newsletter", kind: "real", from: "AARP <member@email.aarp.org>", subject: "5 scams to watch for", body: "Scammers ask for gift cards and wire transfers. Never pay a stranger with a gift card, and never send money by wire to someone you haven't met." },
  { group: "Church bulletin", kind: "real", from: "St. Mark's Church <office@stmarks-church.org>", subject: "Sunday bulletin", body: "Join us Sunday at 10am. Coffee hour after the service." },
  { group: "Grandchild's school", kind: "real", from: "Lincoln Elementary <news@lincoln-elementary.org>", subject: "Grandparents Day is Friday", body: "We can't wait to see you at Grandparents Day this Friday at 9am." },
  { group: "Google security alert (she has Google mail)", kind: "real", from: "Google <no-reply@accounts.google.com>", subject: "Security alert", body: "A new sign-in on Mac. If this was you, you don't need to do anything." },
  { group: "First-ever email from the real Netflix", kind: "real", from: "Netflix <info@account.netflix.com>", subject: "New sign-in to your account", body: "We noticed a new sign-in to your Netflix account on a TV." },
  { group: "First-ever email from the real UPS", kind: "real", from: "UPS <mcinfo@ups.com>", subject: "UPS Update: Package Scheduled for Delivery Today", body: "Your package is scheduled for delivery today between 2pm and 6pm." },
  { group: "First-ever letter from Social Security", kind: "real", from: "Social Security Administration <noreply@ssa.gov>", subject: "Your benefit statement is ready", body: "Your annual benefit statement is ready. Sign in at ssa.gov to view it." },
  { group: "Store receipt", kind: "real", from: "Costco <costco@online.costco.com>", subject: "Your Costco.com order has shipped", body: "Your order is on its way. Track it in your Costco account." },
  { group: "Calendar invite from family", kind: "real", from: "Matt Culver <matt.culver@gmail.com>", subject: "Invitation: Sunday dinner @ Sun 6pm", body: "Matt Culver has invited you to Sunday dinner. Going? Yes - Maybe - No" },
  { group: "Neighborhood digest", kind: "real", from: "Nextdoor <reply@rs.email.nextdoor.com>", subject: "Lost dog on Maple St and 4 more posts", body: "Here's what your neighbors are talking about this week." },
  { group: "Facebook notification (she uses Facebook)", kind: "real", from: "Facebook <notification@facebookmail.com>", subject: "Sue Miller commented on your photo", body: "Sue Miller commented: Beautiful garden!" },
  { group: "First-ever Venmo receipt", kind: "real", from: "Venmo <venmo@venmo.com>", subject: "Matt Culver paid you $25.00", body: "Matt Culver paid you $25.00 for lunch." },
  { group: "Friend's newsletter about a gift card raffle", kind: "real", from: "Oakdale Library <events@oakdalelibrary.org>", subject: "Book sale Saturday", body: "Join us for the book sale! Every visitor is entered in a raffle for a $25 bookstore gift card." },
  { group: "City water bill", kind: "real", from: "City of Oakdale Water <billing@oakdalewater.gov>", subject: "Your water bill", body: "Your water bill for October is $42.10." },
];

const FIXTURES: { group: string; kind: "scam" | "real"; file: string }[] = [
  { group: "Chase look-alike (test file)", kind: "scam", file: "chase-phish.eml" },
  { group: "Hidden instructions to the AI (test file)", kind: "scam", file: "wellsfargo-injection.eml" },
  { group: "Package notice from an unknown site (test file)", kind: "scam", file: "usps-unsure.eml" },
  { group: "Kaiser appointment (test file)", kind: "real", file: "kaiser-real.eml" },
  { group: "Newsletter (test file)", kind: "real", file: "newsletter-real.eml" },
];

function rawEmail(c: Case): string {
  const address = /<([^>]+)>/.exec(c.from)?.[1] ?? c.from;
  const domain = address.split("@")[1];
  const policy = FREEMAIL.test(address) ? "NONE" : "REJECT";
  const auth =
    c.auth === "fail"
      ? `mx.google.com; dkim=none; spf=fail smtp.mailfrom=${address}; dmarc=fail (p=${policy}) header.from=${domain}`
      : `mx.google.com; dkim=pass header.i=@${domain}; spf=pass smtp.mailfrom=${address}; dmarc=pass (p=${policy}) header.from=${domain}`;
  return [
    `Authentication-Results: ${auth}`,
    `From: ${c.from}`,
    ...(c.replyTo ? [`Reply-To: ${c.replyTo}`] : []),
    "To: Mom <mom.culver@gmail.com>",
    `Subject: ${c.subject}`,
    "Message-ID: <m1@mail.example>",
    "Content-Type: text/plain; charset=utf-8",
    "",
    c.body,
    "",
  ].join("\r\n");
}

/** A fresh family with Mom's history, and a Gmail that has just this one new email. */
async function check(raw: string) {
  const t = convexTest(schema, modules);
  const familyId = await t.run(async (ctx) => {
    const kidUserId = await ctx.db.insert("users", { email: "lucas@example.com" });
    const familyId = await ctx.db.insert("families", {
      kidUserId, parentName: "Mom", parentEmail: "mom.culver@gmail.com", kidName: "Lucas", status: "active", parentToken: "tok",
    });
    await ctx.db.insert("gmailTokens", { familyId, refreshToken: "r", accessToken: "a", expiresAt: Date.now() + 3600_000, historyId: "100", googleEmail: "mom.culver@gmail.com" });
    const since = { firstSeen: Date.now() - 700 * DAY, lastSeen: Date.now() - 3 * DAY };
    for (const [key, orgName] of [
      ["kp.org", "Kaiser Permanente"], ["kaiserpermanente.org", "Kaiser Permanente"], ["wellsfargo.com", "Wells Fargo"], ["cvs.com", "CVS"],
      ["pge.com", "PG&E"], ["bankofamerica.com", "Bank of America"], ["medicare.gov", "Medicare"], ["google.com", "Google"],
      ["facebookmail.com", "Facebook"],
    ]) {
      await ctx.db.insert("relationships", { familyId, kind: "org", key, orgName, ...since, messageCount: 40, authPassRate: 1 });
    }
    for (const [address, name, display] of [["matt.culver@gmail.com", "matt culver", "Matt Culver"], ["sue.miller@gmail.com", "sue miller", "Sue Miller"]]) {
      await ctx.db.insert("relationships", { familyId, kind: "person", key: address, ...since, messageCount: 25, parentSentCount: 10, authPassRate: 1 });
      await ctx.db.insert("contactNames", { familyId, name, display, address });
    }
    return familyId;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith("/history")) return json({ historyId: "200", history: [{ messagesAdded: [{ message: { id: "m1", labelIds: ["INBOX"] } }] }] });
      if (url.pathname.endsWith("/messages")) return json({ messages: [] });
      if (url.pathname.endsWith("/messages/m1")) {
        if (url.searchParams.get("format") === "minimal") return json({ sizeEstimate: raw.length, labelIds: ["INBOX"] });
        return json({ id: "m1", internalDate: String(Date.now()), labelIds: ["INBOX"], raw: b64url(raw) });
      }
      return json({}, 404); // domain age, link probes, lookups: offline, so the floor is measured
    }),
  );
  await t.action(internal.mailWatch.pollFamily, { familyId });
  const [v] = await t.run((ctx) => ctx.db.query("verdicts").collect());
  return {
    level: v?.level ?? "none",
    why: (v?.checks ?? []).filter((c) => c.status === "fail" || c.status === "warn").map((c) => c.plainReason),
  };
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("CONVEX_SITE_URL", "https://some.convex.site");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("SAFE_BROWSING_API_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const VERDICT: Record<string, string> = { fake: "Held as fake", unsure: "Asked the kid", real: "Left alone", none: "Not checked" };

test("accuracy on the labeled email set", { timeout: 120_000 }, async () => {
  const rows: { group: string; kind: "scam" | "real"; level: string; why: string[] }[] = [];
  for (const c of CASES) rows.push({ group: c.group, kind: c.kind, ...(await check(rawEmail(c))) });
  for (const f of FIXTURES) rows.push({ group: f.group, kind: f.kind, ...(await check(fixture(f.file))) });

  const scams = rows.filter((r) => r.kind === "scam");
  const real = rows.filter((r) => r.kind === "real");
  const caught = scams.filter((r) => r.level === "fake" || r.level === "unsure");
  const held = scams.filter((r) => r.level === "fake");
  const falseHolds = real.filter((r) => r.level === "fake");
  const asked = real.filter((r) => r.level === "unsure");

  if (process.env.WRITE_ACCURACY) {
    const pct = (n: number, d: number) => `${Math.round((100 * n) / d)}%`;
    const table = (list: typeof rows) =>
      list.map((r) => `| ${r.group} | ${VERDICT[r.level]} | ${r.why.slice(0, 2).join(" ").replace(/\|/g, "/") || "Nothing odd."} |`).join("\n");
    const report = `# How accurate is Anchor?

A labeled set of ${rows.length} emails, run through Anchor's whole pipeline: the scams are built from the
patterns the FTC and AARP warn older adults about; the real mail is what a parent actually
gets, including the family emails other filters flag (bills, Venmo, links from family). It runs
with no AI and no network, so this is Anchor's floor: the AI investigator can only make a
verdict stricter, and in real use it also clears a first email from a company's real address.

Reproduce: \`WRITE_ACCURACY=1 npx vitest run convex/accuracy\` (the test itself fails if a real
email is ever held, or a scam is missed).

| | |
|---|---|
| Scams caught | **${caught.length} of ${scams.length}** (${pct(caught.length, scams.length)}) |
| Scams held automatically (Mom never sees them) | ${held.length} of ${scams.length} |
| Scams sent to the kid to decide | ${caught.length - held.length} |
| Real emails held by mistake | **${falseHolds.length} of ${real.length}** |
| Real emails that asked the kid | ${asked.length} of ${real.length} |

## Scams

| Email | What Anchor did | Why (Anchor's own words) |
|---|---|---|
${table(scams)}

## Real mail

| Email | What Anchor did | Why |
|---|---|---|
${table(real)}
`;
    writeFileSync(fileURLToPath(new URL("../docs/ACCURACY.md", import.meta.url)), report);
  }

  // The costly mistakes: never hold a real email, never let a known scam pattern through.
  expect(falseHolds.map((r) => r.group), "real emails held").toEqual([]);
  expect(scams.filter((r) => !caught.includes(r)).map((r) => r.group), "scams missed").toEqual([]);
});
