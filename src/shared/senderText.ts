// Subject, sender name and address come from the email itself, which may be a scam. React
// already escapes them; this removes invisible direction-control characters, which can make
// "moc.esahc" display as "chase.com" or reorder a sentence. Then trims and collapses spaces.

const DIRECTION_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function senderText(text: string): string {
  return text.replace(DIRECTION_CONTROLS, "").replace(/\s+/g, " ").trim();
}

/** "Chase", or the sender's display name, or a plain fallback when the email gave neither. */
export function claimedSender(verdict: { claimedOrg?: string; fromName?: string }): string {
  const raw = verdict.claimedOrg ?? verdict.fromName;
  return raw ? senderText(raw) : "an unknown sender";
}
