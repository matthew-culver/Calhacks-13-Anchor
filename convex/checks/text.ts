// Text normalization shared by the checks.

// Letters from other alphabets that look like Latin ones. Small on purpose: these are the
// ones seen in real brand spoofs. Extend as new ones turn up.
const CONFUSABLE_LETTERS: Record<string, string> = {
  "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y",
  "\u0445": "x", "\u0456": "i", "\u0458": "j", "\u0455": "s", "\u0501": "d", "\u04bb": "h",
  "\u04cf": "l", "\u043a": "k",
  "\u03bf": "o", "\u03b1": "a", "\u03c1": "p", "\u03bd": "v", "\u03b9": "i", "\u03ba": "k",
  "\u03c4": "t", "\u03b5": "e", "\u0131": "i", "\u0261": "g", "\u0251": "a",
  "\u043f": "n", "\u051b": "q", "\u051d": "w", // Cyrillic
  "\u0585": "o", "\u057d": "u", "\u0578": "n", "\u057c": "n", "\u0570": "h", "\u0581": "g", // Armenian
};

// Format characters, variation selectors and Unicode "tag" characters: invisible, and used to
// split words so patterns miss them ("ig\u200bnore").
const INVISIBLE_CLASSES = /[\p{Cf}\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}\ufe00-\ufe0f\u180b-\u180d]/gu;
const INVISIBLE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufeff]/g;

/** Lowercase, fold look-alike letters, drop accents and invisible characters, collapse spaces. */
export function foldText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(INVISIBLE, "")
    .replace(INVISIBLE_CLASSES, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/./gu, (ch) => CONFUSABLE_LETTERS[ch] ?? ch)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The "skeleton" of a domain label: what it looks like at a glance. Folds look-alike letters
 * and the digit and letter-pair tricks used in fake domains (paypa1, amaz0n, arnazon).
 * Returns both readings of "1" (as l and as i).
 */
export function skeletons(label: string): string[] {
  const folded = foldText(label);
  const base = folded.replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/8/g, "b").replace(/\$/g, "s").replace(/@/g, "a");
  // The unmapped reading too, so "chase-0" stays "chase" plus a number.
  return [...new Set([folded, base.replace(/1/g, "l"), base.replace(/1/g, "i")])];
}

// ---------- Punycode (RFC 3492), to read "xn--" domain labels ----------
// Small and dependency-free because Convex's default runtime has no node:url.

function decodePunycode(input: string): string | undefined {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  const out: number[] = [];
  const delim = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(delim, 0); j++) out.push(input.charCodeAt(j));
  let n = 128, i = 0, bias = 72;
  for (let pos = delim > 0 ? delim + 1 : 0; pos < input.length; ) {
    const oldi = i;
    for (let w = 1, k = base; ; k += base) {
      if (pos >= input.length) return undefined;
      const c = input.charCodeAt(pos++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
      if (digit >= base) return undefined;
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
      if (w > 1e9 || i > 1e9) return undefined;
    }
    const len = out.length + 1;
    let delta = oldi === 0 ? Math.floor((i - oldi) / damp) : (i - oldi) >> 1;
    delta += Math.floor(delta / len);
    let k = 0;
    for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
    bias = Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
    n += Math.floor(i / len);
    i %= len;
    if (n > 0x10ffff) return undefined;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

/** "xn--chas-9ra.com" becomes "chas\u00e9.com". Labels that don't decode are left as they are. */
export function decodeIdn(host: string): string {
  if (!host.includes("xn--")) return host;
  return host
    .split(".")
    .map((label) => (label.startsWith("xn--") ? (decodePunycode(label.slice(4)) ?? label) : label))
    .join(".");
}

export function hasNonAscii(input: string): boolean {
  return /[^\x00-\x7f]/.test(input);
}

/** Edit distance, capped: returns max + 1 as soon as it is clearly over. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
