// The short plain-text notes Anchor puts in the parent's inbox (A6). Pure: builds the raw
// RFC 822 message for Gmail's messages.insert. Plain text only, no HTML; the one link is our
// own parent page.

/** Informational only. The watcher recognizes notes by label and recorded id, never by this header. */
export const ANCHOR_HEADER = "X-Anchor-Note";
export const MAX_KID_NOTE = 280;

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 2047 encoded-word, so names and punctuation survive in the Subject and From. */
function encodeWord(s: string): string {
  return `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=`;
}

function oneLine(s: string, max: number): string {
  return Array.from(s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, max)
    .join("");
}

/**
 * The kid's own words for the parent. Kept as their words, but without links, addresses or
 * long numbers: a stranger posing as the kid must not be able to send the parent a phishing
 * link through Anchor.
 */
export function cleanKidNote(note: string | undefined): string | undefined {
  if (!note) return undefined;
  const cleaned = oneLine(note, MAX_KID_NOTE)
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link removed]")
    .replace(/\S+@\S+\.\S+/g, "[address removed]")
    // Any dotted name ending in letters (chase-help.ru, g00gle.link, bit.ly/x): a mangled word
    // now and then beats a live link reaching the parent.
    // A dot with no spaces ("chase-help.ru"), or spaced on both sides ("help . com"); a normal
    // sentence end ("Mom. Love you") has a space only after the dot, so it's left alone.
    .replace(/\b[a-z0-9-]+(?:(?:\.|\s+\.\s+)[a-z0-9-]+)*(?:\.|\s+\.\s+)[a-z]{2,}\b\S*/gi, "[link removed]")
    .replace(/\bhxxps?\S*/gi, "[link removed]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number removed]")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export type Note = {
  messageId: string; // stable per note, e.g. "verdict-<id>", so a retry can find it already sent
  to: string; // the parent's address
  kidName: string;
  subject: string;
  lines: string[]; // paragraphs of plain text
  parentPageUrl: string; // our own /p/<parentToken> page
  date?: Date;
};

/** The RFC 822 Message-ID for a note key. Gmail can search for it: rfc822msgid:<id>. */
export function noteMessageId(key: string): string {
  return `<${key.replace(/[^A-Za-z0-9._-]/g, "")}@anchor.invalid>`;
}

/** base64url raw message for Gmail's messages.insert. */
export function buildNote(note: Note): string {
  const kid = oneLine(note.kidName, 40);
  const body = [
    ...note.lines.map((l) => oneLine(l, 600)),
    "",
    `See what ${kid} sees, or turn Anchor off: ${note.parentPageUrl}`,
  ].join("\r\n\r\n");
  const headers = [
    `From: ${encodeWord(`Anchor (with ${kid})`)} <no-reply@anchor.invalid>`,
    `To: <${oneLine(note.to, 254).replace(/[<>]/g, "")}>`,
    `Subject: ${encodeWord(oneLine(note.subject, 120))}`,
    `Date: ${(note.date ?? new Date()).toUTCString()}`,
    `Message-ID: ${noteMessageId(note.messageId)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    `${ANCHOR_HEADER}: 1`,
  ];
  return b64url(new TextEncoder().encode(`${headers.join("\r\n")}\r\n\r\n${body}\r\n`));
}
