// Subject, sender name and address come from the email itself, which may be a scam. React
// already escapes them; this removes invisible direction-control characters, which can make
// "moc.esahc" display as "chase.com" or reorder a sentence. Then trims and collapses spaces.

const DIRECTION_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;

export function senderText(text: string): string {
  return text.replace(DIRECTION_CONTROLS, "").replace(/\s+/g, " ").trim();
}
