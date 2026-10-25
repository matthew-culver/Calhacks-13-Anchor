// Check 1: did the email really come from the address it shows? Reads the SPF, DKIM and
// DMARC results that Gmail recorded in its Authentication-Results header.
import type { CheckResult } from "../contract";
import { registrableDomain } from "./brands";
import type { ParsedEmail } from "./types";

// Only these servers' results count. Senders can add their own Authentication-Results
// header below Gmail's, saying whatever they like.
export const TRUSTED_AUTH_SERVERS = ["mx.google.com"];

// Gmail's own header is a few hundred characters. A huge one is not Gmail's.
const MAX_HEADER = 8192;

// Words we print in `detail`. Anything else becomes "other", so a forged header can't put
// its own words into what we store.
const RESULTS = new Set(["pass", "fail", "softfail", "neutral", "none", "temperror", "permerror", "bestguesspass", "policy"]);
const POLICIES = new Set(["none", "quarantine", "reject"]);

export type AuthEntry = { method: string; result: string; props: Record<string, string> };

/** Splits on ";" outside quotes and comments, keeping comment text apart, in one pass. */
function splitSegments(value: string): { text: string; comments: string }[] {
  const segments: { text: string; comments: string }[] = [];
  let text = "";
  let comments = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && (quoted || depth > 0)) {
      i++;
      continue;
    }
    if (depth === 0 && ch === '"') {
      quoted = !quoted;
      text += ch;
    } else if (!quoted && ch === "(") {
      depth++;
      comments += " ";
    } else if (!quoted && ch === ")" && depth > 0) {
      depth--;
      comments += " ";
    } else if (depth > 0) {
      comments += ch;
    } else if (!quoted && ch === ";") {
      segments.push({ text, comments });
      text = comments = "";
    } else {
      text += ch;
    }
  }
  segments.push({ text, comments });
  return segments;
}

/** Parses one header value: "mx.google.com; dkim=pass header.i=@x.com; spf=fail ...". */
export function parseAuthResults(value: string): { server: string; entries: AuthEntry[] } {
  const [head, ...rest] = splitSegments(value.slice(0, MAX_HEADER));
  const server = head.text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const entries: AuthEntry[] = [];
  for (const segment of rest) {
    const [first, ...pairs] = segment.text.trim().split(/\s+/);
    const m = /^([a-z0-9-]+)=([a-z]+)$/i.exec(first ?? "");
    if (!m) continue;
    const props: Record<string, string> = {};
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq > 0) props[pair.slice(0, eq).toLowerCase()] = pair.slice(eq + 1).replace(/^"|"$/g, "").toLowerCase();
    }
    // Gmail puts the sender's DMARC policy in a comment: "dmarc=fail (p=REJECT sp=REJECT dis=NONE)".
    const policy = /(?:^|\s)p=([a-z]+)/i.exec(segment.comments)?.[1]?.toLowerCase();
    if (policy) props.policy = policy;
    entries.push({ method: m[1].toLowerCase(), result: m[2].toLowerCase(), props });
  }
  return { server, entries };
}

function domainOf(value: string | undefined): string {
  if (!value) return "";
  return value.slice(value.lastIndexOf("@") + 1);
}

const word = (value: string | undefined, allowed = RESULTS) => (value === undefined ? "none" : allowed.has(value) ? value : "other");

export function headerAuth(email: ParsedEmail, options: { trustedServers?: string[] } = {}): CheckResult {
  const trusted = options.trustedServers ?? TRUSTED_AUTH_SERVERS;
  if (email.multipleFrom) {
    return { id: "header_auth", status: "fail", plainReason: "This email hides its real sender behind more than one address.", detail: "more than one From address" };
  }
  // Only the topmost header: the receiving server adds its own above everything the sender
  // wrote. If that one isn't from a trusted server, we have no trustworthy result at all.
  const top = email.authResults[0];
  const header = top !== undefined && top.length <= MAX_HEADER ? parseAuthResults(top) : undefined;
  if (!header || !trusted.includes(header.server)) {
    return { id: "header_auth", status: "unknown", plainReason: "We couldn't check who sent this email.", detail: "no Authentication-Results from a trusted server on top" };
  }

  const of = (method: string) => header.entries.filter((e) => e.method === method);
  const dmarcs = of("dmarc");
  const dmarc = dmarcs[0];
  const dkim = of("dkim");
  const spf = of("spf")[0];
  const sender = email.fromDomain ? registrableDomain(email.fromDomain) : "(no sender)";
  const sameSite = (domain: string) => domain !== "" && registrableDomain(domain) === sender;
  const dkimAligned = dkim.some((e) => e.result === "pass" && sameSite(domainOf(e.props["header.d"] ?? e.props["header.i"])));
  const spfAligned = spf?.result === "pass" && sameSite(domainOf(spf.props["smtp.mailfrom"]));
  const summary = `spf=${word(spf?.result)} dkim=${dkim.map((e) => word(e.result)).join(",") || "none"} dmarc=${word(dmarc?.result)}`;

  const real: CheckResult = { id: "header_auth", status: "pass", plainReason: "This email really came from the address it shows.", detail: summary };
  const forged: CheckResult = { id: "header_auth", status: "fail", plainReason: "This email was not really sent from the address it shows.", detail: summary };
  const unconfirmed = (why: string): CheckResult => ({ id: "header_auth", status: "warn", plainReason: "We couldn't confirm who really sent this email.", detail: `${summary} (${why})` });

  if (dmarcs.length > 1) return unconfirmed("conflicting results");
  if (dmarc?.result === "pass" || dmarc?.result === "bestguesspass") {
    // The pass must be for the address the reader sees, not some other domain.
    const checked = dmarc.props["header.from"];
    return checked === undefined || sameSite(checked) ? real : unconfirmed("result is for a different address");
  }
  // A sender whose own policy says "reject" or "quarantine" has promised its mail always
  // passes, so a fail is a forgery. With p=none it's often just a badly set up mail service,
  // a mailing list or a forward.
  if (dmarc?.result === "fail") return dmarc.props.policy === "none" ? unconfirmed("sender policy p=none") : { ...forged, detail: `${summary} (policy p=${word(dmarc.props.policy, POLICIES)})` };
  if (dkimAligned || spfAligned) return { ...real, detail: `${summary} (aligned ${dkimAligned ? "dkim" : "spf"})` };
  return unconfirmed(spf?.result === "fail" || dkim.some((e) => e.result === "fail") ? "failed, no sender policy" : "nothing matches the sender");
}
