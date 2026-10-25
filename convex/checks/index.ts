// The deterministic checks, all pure: no Gmail, network or database calls.
// The relationship check (inbox history) needs the database, so it joins in task A5.
import type { CheckResult, VerdictLevel } from "../contract";
import { claimedIdentity, findClaimedBrand } from "./claimedIdentity";
import { headerAuth } from "./headerAuth";
import { injection } from "./injection";
import type { LinkIntel } from "./intel";
import { linkAudit } from "./linkAudit";
import { pressure } from "./pressure";
import { ruleLevel } from "./ruleLevel";
import type { ParsedEmail } from "./types";

export { BRANDS, lookalikeOf } from "./brands";
export { gatherLinkIntel, type LinkIntel } from "./intel";
export { parseEml } from "./parse";
export type { Link, ParsedEmail } from "./types";
export { claimedIdentity, findClaimedBrand, headerAuth, injection, linkAudit, pressure, ruleLevel };

export type RunOptions = { intel?: LinkIntel; trustedServers?: string[] };

export function runChecks(email: ParsedEmail, options: RunOptions = {}): { checks: CheckResult[]; ruleLevel: VerdictLevel; claimedOrg?: string } {
  const checks = [
    headerAuth(email, { trustedServers: options.trustedServers }),
    claimedIdentity(email),
    linkAudit(email, options.intel),
    pressure(email),
    injection(email),
  ];
  return { checks, ruleLevel: ruleLevel(checks), claimedOrg: findClaimedBrand(email)?.name };
}
