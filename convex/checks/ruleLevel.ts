// The level from the deterministic checks alone. This is the floor: Claude may raise it,
// never lower it.
import type { CheckResult, VerdictLevel } from "../contract";

export function ruleLevel(checks: CheckResult[]): VerdictLevel {
  // Not knowing who sent it is itself a reason to look. Other checks that couldn't run are skipped.
  const ran = checks
    .map((c): CheckResult => (c.id === "header_auth" && c.status === "unknown" ? { ...c, status: "warn" } : c))
    .filter((c) => c.status !== "unknown");
  const fails = ran.filter((c) => c.status === "fail");
  let warns = ran.filter((c) => c.status === "warn");
  // "Pick it up within 48 hours" or "Urgent - call me" alone is everyday mail.
  if (warns.length === 1 && fails.length === 0 && warns[0].id === "pressure") warns = [];

  // Strong pressure (gift cards and a deadline) on its own only asks the kid, since real mail
  // can trip it. Together with any other red flag it's a scam.
  const hardFails = fails.filter((c) => c.id !== "pressure");
  if (hardFails.length > 0) return "fake";
  if (fails.length > 0) return warns.length > 0 ? "fake" : "unsure";
  if (warns.length > 0) return "unsure";
  return "real";
}
