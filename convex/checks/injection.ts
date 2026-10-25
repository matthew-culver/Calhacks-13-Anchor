// Check 6: is the email trying to give orders to an AI (our Claude step included)?
// A real company has no reason to do this, so any hit is a fail. Hidden text on its own is
// normal (newsletters hide preview text), so only instruction-like hidden text counts.
import type { CheckResult } from "../contract";
import { foldText } from "./text";
import type { ParsedEmail } from "./types";

// Who an instruction would be addressed to. No bare "model" or "bot": "a note for the model
// railroad club" is not an attack.
const AI = "(ai|a\\.i\\.|llm|language model|assistant|chatbot|claude|chatgpt|gpt|gemini|copilot|email (filter|scanner|checker|classifier|assistant)|spam filter)\\b";

// Fail wherever they appear, visible or not.
const STRONG = [
  /\b(ignore|disregard|forget|override|bypass)( all| any)?( of)?( the| your| my)? (previous|prior|above|earlier|preceding|original|system|existing)? ?(instructions|prompts?|rules|directions|guidelines)\b/,
  /\bsystem prompt\b/,
  /\bnew instructions\s*:/,
  new RegExp(`\\b(attention|note|message|instructions?|reminder)( is)? (to|for) (the |any |all )?${AI}`),
  new RegExp(`\\byou are (now )?(an?|the) ${AI}`),
  /\bclassify (this|the|it)( email| message| mail)? as\b/,
  /\b(do not|don't|never) (flag|hold|block|report|quarantine|filter) (this|the) (email|message)\b/,
];

// Only suspicious when hidden. Visible, these are ordinary newsletter lines ("please mark us
// as safe so you get our emails") or just bad sales copy ("this email is legitimate").
const HIDDEN_ONLY = [
  /\b(mark|label|treat|flag|report|rate|consider)( this| the| it)?( email| message| mail)? as (safe|legitimate|legit|genuine|trusted|harmless|clean|real|not (spam|a scam|phishing|suspicious|dangerous))\b/,
  /\b(do not|don't|never) (flag|hold|block|report|quarantine|filter) (this|it)\b/,
  /\b(this|the) (email|message|mail|sender) is (safe|legitimate|legit|genuine|real|trusted|verified|authentic|not (spam|a scam|phishing))\b/,
  /(^|\n|[.!?]\s)(system|assistant|ai)\s*:/,
  new RegExp(`\\b${AI}.{0,40}\\b(safe|legit\\w*|genuine|spam|scam|verdict|classif\\w*|instruction\\w*)\\b`),
  /\brespond (only )?with\b|\boutput (only|json)\b/,
];

export function injection(email: ParsedEmail): CheckResult {
  const visible = foldText(`${email.subject}\n${email.text}`);
  const hidden = email.hiddenText.map(foldText);

  const visibleHit = STRONG.some((re) => re.test(visible));
  const hiddenHit = hidden.some((t) => STRONG.some((re) => re.test(t)) || HIDDEN_ONLY.some((re) => re.test(t)));

  if (hiddenHit) {
    return { id: "injection", status: "fail", plainReason: "It hides secret instructions meant to fool our scam check.", detail: `instruction-like hidden text found${visibleHit ? "; also in visible text" : ""}` };
  }
  if (visibleHit) {
    return { id: "injection", status: "fail", plainReason: "It contains instructions meant to fool our scam check.", detail: "instruction-like visible text found" };
  }
  if (email.truncated) {
    return { id: "injection", status: "warn", plainReason: "It is too long for us to check all of it.", detail: "email over size limits, checked the first part only" };
  }
  return { id: "injection", status: "pass", plainReason: "It doesn't try to fool our scam check.", detail: hidden.length ? `${hidden.length} hidden text block(s), none instruction-like` : "no hidden text" };
}
