// Check 6: does this make sense for THIS person? Compares the email with the parent's own
// inbox history (A4). The killer case: a perfect "Chase" email when Mom has never had mail
// from Chase. Pure: the caller passes in the history it looked up.
//
// How strongly the email claims a brand matters (from A1's claimed_identity check):
// - "fail" there means it pretends to BE the brand (its From name, or a lookalike address).
//   No history with that brand makes it a scam here too.
// - A mere mention ("shipped via USPS") is judged by the sender's own history instead, so a
//   real store's shipping email isn't held just for naming USPS.
import type { CheckResult, CheckStatus } from "../contract";
import { BRANDS, isOfficialFor, registrableDomain } from "./brands";
import type { ParsedEmail } from "./types";

/**
 * What this email does, for spotting a familiar or trusted sender acting unlike themselves (a
 * hacked account). Only hard evidence counts: a link our own checks found dangerous (not just
 * "a site we don't know": Aunt Sue's YouTube link and your landlord's portal are fine), the
 * payment and secrecy signals scammers use (gift cards, wires, crypto, "don't tell anyone";
 * NOT ordinary bills, Venmo or "ASAP"), or replies redirected to another address.
 */
export type Behavior = {
  riskySites: string[]; // sites of links that failed our own checks (see sites.linkIsRisky)
  scamPressure: boolean; // any gift card, wire, crypto or secrecy signal
};

/** What the caller found in the parent's history (relationships + accounts tables). */
export type HistoryContext = {
  /** The sender's own relationship row (by address for people, by domain for orgs). */
  sender?: { messageCount: number; parentSentCount?: number; firstSeen: number; authPassRate: number };
  /** For the brand the email claims to be: authenticated mail from its real domains seen before. */
  claimedBrandHistory?: { messageCount: number; firstSeen: number; isAccount: boolean };
  /** Family: the kid's own sign-in address, or a sender the kid marked "always trust". */
  trusted?: { who: string };
  /**
   * A new sender using the name of someone the parent corresponds with ("Aunt Sue" from an
   * address Sue has never used). `lookalike`: the address is a letter or two off the real one.
   */
  knownNameElsewhere?: { who: string; lookalike: boolean };
};

const yearOf = (ms: number) => new Date(ms).getUTCFullYear();

export function relationship(
  email: ParsedEmail,
  claimedOrg: string | undefined,
  history: HistoryContext,
  claimStatus: CheckStatus = "pass",
  behavior?: Behavior,
): CheckResult {
  const brand = claimedOrg ? BRANDS.find((b) => b.name === claimedOrg) : undefined;
  const fromBrand = brand !== undefined && email.fromDomain !== "" && isOfficialFor(email.fromDomain, brand);
  const seen = history.claimedBrandHistory;
  const hasSeen = seen !== undefined && seen.messageCount > 0;

  if (brand && fromBrand) {
    return hasSeen
      ? {
          id: "relationship",
          status: "pass",
          plainReason: `You've gotten real emails from ${brand.name} since ${yearOf(seen.firstSeen)}.`,
          detail: `${seen.messageCount} prior authenticated messages${seen.isAccount ? ", in My Accounts" : ""}`,
        }
      : {
          id: "relationship",
          status: "warn",
          plainReason: `This is the first email you've ever gotten from ${brand.name}.`,
          detail: `no prior mail from ${brand.officialDomains[0]}`,
        };
  }

  if (brand && claimStatus === "fail") {
    // It pretends to be the brand and isn't. Never a reassuring "pass" here.
    return hasSeen
      ? {
          id: "relationship",
          status: "warn",
          plainReason: `You do get email from ${brand.name}, but this one didn't come from ${brand.name}'s real address.`,
          detail: `known ${brand.name} sender domains: ${brand.officialDomains.join(", ")}`,
        }
      : {
          id: "relationship",
          status: "fail",
          plainReason: `It says it's ${brand.name}, but you've never gotten email from ${brand.name}.`,
          detail: `0 prior messages from ${brand.officialDomains.join(", ")}`,
        };
  }

  const s = history.sender;
  const familiar = s !== undefined && (s.messageCount >= 2 || (s.parentSentCount ?? 0) > 0);
  if (history.trusted || familiar) {
    // Is this email unlike them? (Their account may have been taken over.)
    const odd: string[] = [];
    const risky = [...new Set(behavior?.riskySites ?? [])].filter(Boolean);
    if (risky.length > 0) odd.push(`it links to ${risky.slice(0, 3).join(", ")}, which our checks found dangerous`);
    if (behavior?.scamPressure) odd.push("it asks for gift cards, a wire transfer, cryptocurrency or secrecy");
    if (email.replyToAddress && registrableDomain(email.replyToAddress.split("@")[1] ?? "") !== registrableDomain(email.fromDomain || "x")) {
      odd.push("replies would go to a different address");
    }
    if (odd.length > 0) {
      const who = history.trusted?.who;
      return {
        id: "relationship",
        status: "warn",
        plainReason: who
          ? `This came from ${who}'s own address, but ${odd.join(" and ")}. ${who}'s account may have been hacked.`
          : `This came from someone you know, but ${odd.join(" and ")}. Their account may have been hacked.`,
        detail: history.trusted ? "trusted sender acting unusually" : `familiar sender (${s?.messageCount ?? 0} prior messages) acting unusually`,
      };
    }
    if (history.trusted) {
      return { id: "relationship", status: "pass", plainReason: `This is from ${history.trusted.who}.`, detail: "trusted family sender" };
    }
    const wrote = (s!.parentSentCount ?? 0) > 0 ? " You've written to them too." : "";
    return {
      id: "relationship",
      status: "pass",
      plainReason: `You've gotten email from this sender since ${yearOf(s!.firstSeen)}.${wrote}`,
      detail: `${s!.messageCount} prior messages from ${registrableDomain(email.fromDomain || "unknown")}`,
    };
  }
  // Someone Mom knows, by name, on an address they've never used: the family impostor scam.
  // A look-alike address is deliberate, so a fake; a plain new address asks the kid (people do
  // get new addresses).
  if (history.knownNameElsewhere) {
    const { who, lookalike } = history.knownNameElsewhere;
    return lookalike
      ? {
          id: "relationship",
          status: "fail",
          plainReason: `The address is made to look like ${who}'s, but it isn't theirs. Someone may be pretending to be ${who}.`,
          detail: "look-alike of a known contact's address",
        }
      : {
          id: "relationship",
          status: "warn",
          plainReason: `It uses the name ${who}, someone you know, but from an address they've never used with you.`,
          detail: "known contact's name on a new address",
        };
  }

  // A new sender with no brand claim is normal (a new newsletter, a new doctor's office):
  // not suspicious on its own, so it doesn't change the level. Claude still sees it.
  return {
    id: "relationship",
    status: "unknown",
    plainReason: "This is the first email from this sender.",
    detail: "first-time sender",
  };
}
