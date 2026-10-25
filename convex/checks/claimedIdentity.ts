// Check 2: does the brand the email claims to be match where it was really sent from?
import type { CheckResult } from "../contract";
import { brandForDomain, brandInName, brandInSubject, isOfficialFor, isPlausibleHost, lookalikeOf, type Brand } from "./brands";
import { foldText, hasNonAscii } from "./text";
import type { ParsedEmail } from "./types";

// "name": the From name is the brand ("Chase Bank"). "mention": the From name or subject only
// mentions it ("Humana Medicare", "USPS: your package...").
type Claim = { brand: Brand; how: "name" | "mention" };

function findClaim(email: ParsedEmail): Claim | undefined {
  const inName = brandInName(email.fromName);
  if (inName?.strict) return { brand: inName.brand, how: "name" };
  const mentioned = inName?.brand ?? brandInSubject(email.subject);
  return mentioned ? { brand: mentioned, how: "mention" } : undefined;
}

// How a company (or someone pretending to be one) talks, and family doesn't: "your account has
// been locked", "Dear customer", "verify your identity", "unusual sign-in activity".
const COMPANY_VOICE = [
  /\b(your|the) (account|card|access|service|membership|subscription)s? (has been|have been|will be|is|was) (suspended|locked|closed|disabled|terminated|frozen|restricted|limited|on hold|cancell?ed)\b/,
  /\bdear (valued )?(customer|member|user|client|account ?holder|card ?holder)\b/,
  /\b(verify|confirm|validate|update) your (account|identity|information|details|billing|payment (info|information|details|method))\b/,
  /\b(unusual|suspicious|unauthori[sz]ed) (activity|sign-?ins?|logins?|access|charges?|transactions?)\b/,
];

/** The email speaks as a company would to its customer, rather than about one. */
export function speaksAsCompany(email: ParsedEmail): boolean {
  const text = foldText([email.subject, email.text, ...email.hiddenText].join("\n"));
  return COMPANY_VOICE.some((re) => re.test(text));
}

/** The brand the email presents itself as, for `verdict.claimedOrg`. */
export function findClaimedBrand(email: ParsedEmail): Brand | undefined {
  return findClaim(email)?.brand ?? lookalikeOf(email.fromDomain);
}

export function claimedIdentity(email: ParsedEmail): CheckResult {
  if (!email.fromDomain || !isPlausibleHost(email.fromDomain)) {
    return { id: "claimed_identity", status: "warn", plainReason: "We couldn't tell who sent this email.", detail: email.fromDomain ? "sender address is not a real address" : "no sender address" };
  }
  const claim = findClaim(email);
  const imitated = lookalikeOf(email.fromDomain);

  if (claim && !isOfficialFor(email.fromDomain, claim.brand)) {
    const name = claim.brand.name;
    if (claim.how === "name" || imitated) {
      return { id: "claimed_identity", status: "fail", plainReason: `This email says it is from ${name}, but it was not sent by ${name}.`, detail: `${claim.how} claims ${name}; sender is not one of ${name}'s addresses` };
    }
    // A shipping email from a real store can mention USPS without pretending to be USPS.
    if (!brandForDomain(email.fromDomain)) {
      return { id: "claimed_identity", status: "warn", plainReason: `This email talks about ${name}, but it was not sent by ${name}.`, detail: `mentions ${name}; sender is not one of ${name}'s addresses` };
    }
  }

  if (imitated) {
    const name = imitated.name;
    return { id: "claimed_identity", status: "fail", plainReason: `The sender's address is made to look like ${name}, but it is not ${name}.`, detail: `sender address imitates ${imitated.officialDomains[0]}` };
  }

  // Letters from other alphabets in the address itself ("chas\u00e9.com"), with no brand to compare.
  if (hasNonAscii(email.fromDomain) || email.fromDomain.split(".").some((l) => l.startsWith("xn--"))) {
    return { id: "claimed_identity", status: "warn", plainReason: "The sender's address uses odd letters that can trick the eye.", detail: "non-ASCII sender address" };
  }

  if (claim && isOfficialFor(email.fromDomain, claim.brand)) {
    return { id: "claimed_identity", status: "pass", plainReason: `It says it is from ${claim.brand.name}, and the address is ${claim.brand.name}'s.`, detail: `sender is on ${claim.brand.name}'s list` };
  }
  return { id: "claimed_identity", status: "pass", plainReason: "It doesn't use the name of a company we know.", detail: "no known brand claimed" };
}
