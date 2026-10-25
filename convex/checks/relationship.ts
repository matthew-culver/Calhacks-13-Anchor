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
 * What this email does, for spotting a familiar sender acting unlike themselves (a hacked
 * account). Links are judged by the site itself: an established site (YouTube, Reddit...) is
 * never suspicious just because the sender hasn't linked it before.
 */
export type Behavior = {
  links: { site: string; cls: "established" | "user_content" | "unknown" }[];
  pressure: CheckStatus; // A1's pressure check: money, gift cards, urgency, secrecy
};

/** What the caller found in the parent's history (relationships + accounts tables). */
export type HistoryContext = {
  /** The sender's own relationship row (by address for people, by domain for orgs). */
  sender?: { messageCount: number; parentSentCount?: number; firstSeen: number; authPassRate: number };
  /** For the brand the email claims to be: authenticated mail from its real domains seen before. */
  claimedBrandHistory?: { messageCount: number; firstSeen: number; isAccount: boolean };
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
  if (s && (s.messageCount >= 2 || (s.parentSentCount ?? 0) > 0)) {
    // Familiar sender: is this email unlike them? (Their account may have been taken over.)
    const odd: string[] = [];
    const risky = (behavior?.links ?? []).filter((l) => l.cls !== "established" && l.site);
    if (risky.length > 0) {
      const sites = [...new Set(risky.map((l) => l.site))].slice(0, 3).join(", ");
      odd.push(`it links to ${sites}, a site we can't vouch for`);
    }
    if (behavior && behavior.pressure !== "pass" && behavior.pressure !== "unknown") odd.push("it's pushing for money or rushing you");
    if (email.replyToAddress && registrableDomain(email.replyToAddress.split("@")[1] ?? "") !== registrableDomain(email.fromDomain || "x")) {
      odd.push("replies would go to a different address");
    }
    if (odd.length > 0) {
      return {
        id: "relationship",
        status: "warn",
        plainReason: `This came from someone you know, but ${odd.join(" and ")}. Their account may have been hacked.`,
        detail: `familiar sender (${s.messageCount} prior messages) acting unusually`,
      };
    }
    const wrote = (s.parentSentCount ?? 0) > 0 ? " You've written to them too." : "";
    return {
      id: "relationship",
      status: "pass",
      plainReason: `You've gotten email from this sender since ${yearOf(s.firstSeen)}.${wrote}`,
      detail: `${s.messageCount} prior messages from ${registrableDomain(email.fromDomain || "unknown")}`,
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
