// Check 5: is it pushing the reader to hurry, pay in odd ways, or keep it secret?
import type { CheckResult } from "../contract";
import { foldText } from "./text";
import type { ParsedEmail } from "./types";

type Category = "urgency" | "gift_card" | "wire" | "crypto" | "secrecy";

const PATTERNS: Record<Category, RegExp[]> = {
  urgency: [
    /\burgent(ly)?\b/,
    /\bimmediate(ly)?\b/,
    /\bright away\b/,
    /\bact now\b/,
    /\bas soon as possible\b/,
    /\bwithin (\d{1,2}|twenty[- ]four|forty[- ]eight|seventy[- ]two) hours\b/,
    /\bfinal (notice|warning)\b/,
    /\b(account|access|card|service|benefits?)s? (has been|have been|will be|is|are) (suspended|locked|closed|disabled|terminated|frozen|restricted|cancell?ed)\b/,
    /\b(expires?|expiring) (today|tonight|in \d+ hours)\b/,
  ],
  gift_card: [/\bgift ?cards?\b/, /\b(google play|itunes|steam|razer gold|vanilla|ebay) cards?\b/, /\bscratch (off )?the back\b/, /\bnumbers? on the back\b/],
  wire: [
    /\bwire (transfer|the money|money|the funds|funds|payment)\b/,
    /\bwestern union\b/,
    /\bmoneygram\b/,
    /\b(send|pay|transfer)( the| your)? (money|funds|payment)?\s*(by|via|through|with|using) (zelle|venmo|cash ?app)\b/,
  ],
  crypto: [/\bbitcoin\b/, /\bbtc\b/, /\bcrypto(currency|currencies)?\b/, /\bethereum\b/, /\busdt\b/, /\bwallet address\b/],
  secrecy: [
    /\b(don't|do not|dont) tell (anyone|anybody|your (family|kids|children|son|daughter|bank|wife|husband)|mom|dad|grandma|grandpa)\b/,
    /\bkeep (this|it) (between us|a secret|secret|confidential|private|to yourself)\b/,
    /\b(don't|do not|dont) (discuss|share) this with\b/,
    /\btell no ?one\b/,
    /\bour (little )?secret\b/,
  ],
};

// Fraud-awareness mail (AARP, banks, Medicare) describes these exact tricks. It can't count
// as a hard fail on its own, though it still warns.
const AWARENESS = /\b(scammers?|fraudsters?|(will|would) never ask|never (ask|pay|send|give)|beware of|protect yourself|common scams?)\b/;

const PAYMENT_WORDS: Record<"gift_card" | "wire" | "crypto", string> = { gift_card: "gift cards", wire: "a wire transfer", crypto: "cryptocurrency" };

export function pressure(email: ParsedEmail): CheckResult {
  // Hidden text too: a scam can hide its body from the visible-text checks.
  const text = foldText([email.subject, email.text, ...email.hiddenText].join("\n"));
  const hits = (Object.keys(PATTERNS) as Category[]).filter((c) => PATTERNS[c].some((re) => re.test(text)));
  const payments = hits.filter((c): c is keyof typeof PAYMENT_WORDS => c in PAYMENT_WORDS);
  const detail = hits.length ? `signals: ${hits.join(", ")}` : "no signals";
  const how = payments.map((c) => PAYMENT_WORDS[c]).join(" or ");

  if (hits.length === 0) {
    return { id: "pressure", status: "pass", plainReason: "It doesn't rush you or ask for unusual payments.", detail };
  }
  const strong = hits.length >= 2 && (payments.length > 0 || hits.includes("secrecy")) && !AWARENESS.test(text);
  if (strong) {
    const reason = payments.length === 0
      ? "It rushes you and asks you to keep it a secret."
      : hits.includes("secrecy")
        ? `It asks you to pay with ${how} and keep it a secret.`
        : `It pushes you to pay with ${how}, which real companies don't ask for.`;
    return { id: "pressure", status: "fail", plainReason: reason, detail };
  }
  const reason = payments.length > 0 ? `It mentions paying with ${how}.` : hits.includes("secrecy") ? "It asks you to keep it a secret." : "It tries to rush you.";
  return { id: "pressure", status: "warn", plainReason: reason, detail };
}
