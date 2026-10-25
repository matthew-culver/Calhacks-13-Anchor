// Mock data that matches convex/contract.ts exactly.
// Person B builds every screen against this until Person A's pipeline writes real rows.
// The scenarios are the demo script: a "Chase" phish, a real Kaiser email,
// a prompt-injection email and an unsure "package" email.
// History is the import window of about 2 years, so copy says "in your inbox for 2 years",
// not "since 2019".

import type { GenericId } from "convex/values";
import type {
  Account,
  AccountSignal,
  Family,
  FeedItem,
  Verdict,
  WeeklyRecap,
} from "../../convex/contract";

/** A row as read from Convex: the contract fields plus _id and _creationTime. */
export type Row<T, Table extends string> = T & {
  _id: GenericId<Table>;
  _creationTime: number;
};

const id = <Table extends string>(s: string) => s as GenericId<Table>;
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// Everything is relative to when the app loads, so a demo always reads "20 minutes ago",
// never a date in the future or the past. Tests that check durations use mockNow.
export const mockNow = Date.now();
const now = mockNow;
const monthsAgo = (m: number) => now - m * 30 * DAY;

const familyId = id<"families">("mock_family_1");

export const mockFamily: Row<Family, "families"> = {
  _id: familyId,
  _creationTime: now - 3 * DAY,
  parentName: "Mom",
  parentEmail: "mom.culver@gmail.com",
  kidName: "Lucas",
  kidUserId: id<"users">("mock_kid_1"),
  status: "active",
  parentToken: "mock-parent-token",
  connectedAt: now - 3 * DAY,
};

const acct = (
  n: number,
  orgName: string,
  category: Account["category"],
  officialDomains: string[],
  loginUrl: string | undefined,
  months: number,
  messageCount: number,
  // v2 (A8): how much Mom really uses it, and the account-type emails that show it.
  rank: number,
  signals: AccountSignal[],
): Row<Account, "accounts"> => ({
  _id: id<"accounts">(`mock_account_${n}`),
  _creationTime: now - 3 * DAY,
  familyId,
  orgName,
  category,
  officialDomains,
  loginUrl,
  firstSeen: monthsAgo(months),
  messageCount,
  rank,
  signals,
  ...(signals.length > 0 && { lastActivity: now - (n % 5 + 1) * DAY }),
  ...(loginUrl && { loginUrlSource: "curated" as const }),
});

// Ranked by real use (bills, statements, sign-in alerts), not by how much mail they send:
// Amazon sends the most email but isn't the most important account.
export const mockAccounts: Row<Account, "accounts">[] = [
  acct(1, "Kaiser Permanente", "health", ["kp.org", "kaiserpermanente.org"], "https://healthy.kaiserpermanente.org/", 24, 88, 90, ["appointment", "sign_in", "code"]),
  acct(2, "Wells Fargo", "bank", ["wellsfargo.com", "wf.com"], "https://connect.secure.wellsfargo.com/auth/login/present", 24, 140, 95, ["statement", "bill", "sign_in"]),
  acct(3, "CVS Pharmacy", "pharmacy", ["cvs.com"], "https://www.cvs.com/account/login", 19, 41, 75, ["order"]),
  acct(4, "PG&E", "utility", ["pge.com"], "https://m.pge.com/#login", 24, 48, 70, ["bill"]),
  acct(5, "Medicare", "government", ["medicare.gov"], "https://www.medicare.gov/account/login", 14, 12, 80, ["statement"]),
  acct(6, "Amazon", "shopping", ["amazon.com"], "https://www.amazon.com/ap/signin", 24, 210, 55, ["order", "sign_in"]),
  // Not in the curated directory yet, so there's no verified link. The UI must not show one.
  acct(7, "Sunrise Senior Center", "other", ["sunrisecenter.org"], undefined, 9, 17, 10, []),
  acct(8, "Social Security", "government", ["ssa.gov"], "https://secure.ssa.gov/RIL/SiView.action", 24, 9, 65, ["statement", "security"]),
  acct(9, "AARP Medicare Supplement", "insurance", ["aarpmedicareplans.com", "uhc.com"], "https://www.aarpmedicareplans.com/", 24, 22, 60, ["bill", "statement"]),
  acct(10, "Xfinity", "utility", ["xfinity.com", "comcast.net"], "https://login.xfinity.com/login", 24, 36, 50, ["bill"]),
  acct(11, "Costco", "shopping", ["costco.com"], "https://www.costco.com/LogonForm", 16, 30, 35, ["order"]),
  acct(12, "Walgreens", "pharmacy", ["walgreens.com"], "https://www.walgreens.com/login.jsp", 6, 8, 20, ["order"]),
];

const verdictBase = { familyId, _creationTime: now };

export const mockVerdicts: Row<Verdict, "verdicts">[] = [
  {
    ...verdictBase,
    _id: id<"verdicts">("mock_verdict_chase"),
    gmailMessageId: "mock_msg_chase",
    receivedAt: now - 2 * 60 * MIN,
    fromDomain: "chase-secure-login.co",
    fromName: "Chase Bank",
    fromAddress: "alerts@chase-secure-login.co",
    subject: "Unusual sign-in: verify your account within 24 hours",
    claimedOrg: "Chase",
    level: "fake",
    ruleLevel: "fake",
    action: "held",
    actionAppliedAt: now - 2 * 60 * MIN,
    parentNoteSentAt: now - 2 * 60 * MIN,
    checks: [
      { id: "header_auth", status: "fail", plainReason: "This email did not really come from Chase.", detail: "DMARC=fail for chase-secure-login.co" },
      { id: "claimed_identity", status: "fail", plainReason: "It says it's Chase, but it was sent from a different website.", detail: "Claimed Chase (chase.com), sent from chase-secure-login.co" },
      { id: "link_audit", status: "fail", plainReason: "The button leads to a fake website made 3 days ago.", detail: "href host chase-secure-login.co, RDAP age 3 days" },
      { id: "relationship", status: "fail", plainReason: "You don't have a Chase account.", detail: "0 messages from chase.com in 2 years of history" },
      { id: "pressure", status: "warn", plainReason: "It tries to rush you with a 24-hour deadline." },
    ],
    explanationForParent: "We held a message pretending to be Chase. You don't have a Chase account, so you don't need to do anything.",
    explanationForKid: "A convincing fake Chase email: sent from the wrong website, a link to a 3-day-old copycat site, and no Chase history in Mom's inbox. Held automatically.",
  },
  {
    // Real mail keeps only what the checks and counts need. The kid never sees it.
    ...verdictBase,
    _id: id<"verdicts">("mock_verdict_kaiser"),
    gmailMessageId: "mock_msg_kaiser",
    receivedAt: now - 5 * 60 * MIN,
    fromDomain: "kaiserpermanente.org",
    level: "real",
    ruleLevel: "real",
    action: "none",
  },
  {
    ...verdictBase,
    _id: id<"verdicts">("mock_verdict_injection"),
    gmailMessageId: "mock_msg_injection",
    receivedAt: now - 30 * MIN,
    fromDomain: "wellsfargo-help.net",
    fromName: "Wells Fargo Security",
    fromAddress: "security@wellsfargo-help.net",
    subject: "Action required: confirm your identity",
    claimedOrg: "Wells Fargo",
    level: "fake",
    ruleLevel: "fake",
    action: "held",
    actionAppliedAt: now - 30 * MIN,
    parentNoteSentAt: now - 30 * MIN,
    checks: [
      { id: "header_auth", status: "fail", plainReason: "This email did not really come from Wells Fargo.", detail: "SPF=fail, DMARC=fail" },
      { id: "claimed_identity", status: "fail", plainReason: "Your real Wells Fargo emails come from a different website.", detail: "Known: wellsfargo.com, wf.com. This: wellsfargo-help.net" },
      { id: "link_audit", status: "fail", plainReason: "The link hides where it really goes.", detail: "Display text wellsfargo.com, href is a shortener redirecting to wellsfargo-help.net" },
      { id: "relationship", status: "warn", plainReason: "This sender has never emailed you before." },
      { id: "injection", status: "fail", plainReason: "It hid a message trying to trick our checker. It didn't work.", detail: "Hidden instruction text found" },
    ],
    explanationForParent: "We held a message pretending to be Wells Fargo. Your real bank emails come from a different address.",
    explanationForKid: "A Wells Fargo lookalike with hidden text telling the AI to approve it. The rules caught it first, and the trick had no effect.",
  },
  {
    ...verdictBase,
    _id: id<"verdicts">("mock_verdict_usps"),
    gmailMessageId: "mock_msg_usps",
    receivedAt: now - 20 * MIN,
    fromDomain: "usps-informed.com",
    fromName: "USPS Delivery",
    fromAddress: "tracking@usps-informed.com",
    subject: "Your package could not be delivered",
    claimedOrg: "USPS",
    level: "unsure",
    ruleLevel: "unsure",
    action: "labeled_check",
    parentNoteSentAt: now - 20 * MIN,
    checks: [
      { id: "header_auth", status: "pass", plainReason: "The sender's address checks out on its own." },
      { id: "claimed_identity", status: "warn", plainReason: "It says it's the Post Office, but uses a different website.", detail: "Claimed USPS (usps.com), sent from usps-informed.com" },
      { id: "link_audit", status: "unknown", plainReason: "We couldn't fully check the link." },
      { id: "relationship", status: "warn", plainReason: "You haven't gotten email from this sender before." },
      { id: "pressure", status: "pass", plainReason: "Nothing pushy in this email." },
    ],
    explanationForParent: "We're not sure about this one, so we asked Lucas. Please don't click anything in it yet.",
    explanationForKid: "A delivery notice from a website that isn't usps.com, with no history. Did Mom order something recently?",
  },
  {
    // An older unsure email the kid already answered: the "Good catch, Mom" moment.
    ...verdictBase,
    _id: id<"verdicts">("mock_verdict_medicare"),
    gmailMessageId: "mock_msg_medicare",
    receivedAt: now - 2 * DAY,
    fromDomain: "medicare-benefits-update.com",
    fromName: "Medicare Benefits",
    fromAddress: "info@medicare-benefits-update.com",
    subject: "You may qualify for a new benefits card",
    claimedOrg: "Medicare",
    level: "unsure",
    ruleLevel: "unsure",
    action: "held", // the kid said "It's a scam", so it moved from the check label to Held
    actionAppliedAt: now - 2 * DAY + 26 * MIN,
    parentNoteSentAt: now - 2 * DAY,
    checks: [
      { id: "header_auth", status: "pass", plainReason: "The sender's address checks out on its own." },
      { id: "claimed_identity", status: "warn", plainReason: "Your real Medicare emails come from medicare.gov.", detail: "Known: medicare.gov. This: medicare-benefits-update.com" },
      { id: "link_audit", status: "warn", plainReason: "The link goes to a website you've never used.", detail: "RDAP age 41 days" },
      { id: "relationship", status: "warn", plainReason: "This sender has never emailed you before." },
      { id: "pressure", status: "pass", plainReason: "Nothing pushy in this email." },
    ],
    explanationForParent: "We're not sure about this one, so we asked Lucas. Please don't click anything in it yet.",
    explanationForKid: "Claims Medicare but isn't from medicare.gov, and the site is 6 weeks old. Mom already has a real Medicare relationship.",
  },
];

// Mom asked about a real email herself (she moved it to "Check with Lucas"). Because she asked,
// the kid sees who sent it and what we checked.
mockVerdicts.push({
  ...verdictBase,
  _id: id<"verdicts">("mock_verdict_asked"),
  gmailMessageId: "mock_msg_asked",
  receivedAt: now - 9 * MIN,
  fromDomain: "kp.org",
  fromName: "Kaiser Permanente",
  fromAddress: "noreply@kp.org",
  subject: "Your test results are ready",
  claimedOrg: "Kaiser Permanente",
  level: "real",
  ruleLevel: "real",
  action: "none",
  askedAt: now - 6 * MIN,
  checks: [
    { id: "header_auth", status: "pass", plainReason: "This email really came from the address it shows." },
    { id: "claimed_identity", status: "pass", plainReason: "It's from Kaiser's real address." },
    { id: "link_audit", status: "pass", plainReason: "Its link goes to Kaiser's real website." },
    { id: "relationship", status: "pass", plainReason: "You've gotten real emails from Kaiser Permanente since 2023." },
    { id: "pressure", status: "pass", plainReason: "It doesn't rush you or ask for unusual payments." },
  ],
  explanationForParent: "",
  explanationForKid: "Mom asked you about this email. Our quick checks didn't find anything wrong with it.",
});

export const mockFeed: Row<FeedItem, "feedItems">[] = [
  {
    _id: id<"feedItems">("mock_feed_asked"),
    _creationTime: now,
    familyId,
    verdictId: id<"verdicts">("mock_verdict_asked"),
    kind: "asked",
    createdAt: now - 6 * MIN,
  },
  {
    _id: id<"feedItems">("mock_feed_usps"),
    _creationTime: now,
    familyId,
    verdictId: id<"verdicts">("mock_verdict_usps"),
    kind: "needs_answer",
    createdAt: now - 20 * MIN,
    notifiedKidAt: now - 20 * MIN,
  },
  {
    _id: id<"feedItems">("mock_feed_injection"),
    _creationTime: now,
    familyId,
    verdictId: id<"verdicts">("mock_verdict_injection"),
    kind: "held",
    createdAt: now - 30 * MIN,
  },
  {
    _id: id<"feedItems">("mock_feed_chase"),
    _creationTime: now,
    familyId,
    verdictId: id<"verdicts">("mock_verdict_chase"),
    kind: "held",
    createdAt: now - 2 * 60 * MIN,
  },
  {
    _id: id<"feedItems">("mock_feed_medicare"),
    _creationTime: now,
    familyId,
    verdictId: id<"verdicts">("mock_verdict_medicare"),
    kind: "needs_answer",
    createdAt: now - 2 * DAY,
    notifiedKidAt: now - 2 * DAY,
    kidAnswer: { answer: "scam", note: "Good catch, Mom. That one's fake. Love you.", answeredAt: now - 2 * DAY + 25 * MIN },
    answerAppliedAt: now - 2 * DAY + 26 * MIN,
  },
];

/** What the weekly-recap query returns. It's computed live, not stored. */
export const mockRecap: WeeklyRecap = {
  weekStart: now - 7 * DAY,
  checked: 41,
  held: 3, // Chase, Wells Fargo, Medicare
  needAnswer: 1, // USPS
  goodCatches: 1, // Medicare
};
