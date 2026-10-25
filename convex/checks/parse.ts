// Raw RFC 822 email (a Gmail "raw" message or a saved .eml) -> ParsedEmail.
// postal-mime does the MIME work (multipart, base64, quoted-printable, encoded names);
// htmlparser2 walks the HTML to pull out links and text a reader wouldn't see.
import { Parser } from "htmlparser2";
import PostalMime, { addressParser } from "postal-mime";
import { parse } from "tldts";
import type { Link, ParsedEmail } from "./types";

// Real mail fits easily. Past these, the rest is dropped and `truncated` is set, so a
// padded email can't make the checks slow or push its payload out of view unnoticed.
const MAX_HTML = 2_000_000;
const MAX_TEXT = 300_000;
const MAX_HIDDEN = 100_000;
const MAX_LINKS = 300;
const MAX_URL = 2048;

export async function parseEml(raw: string | ArrayBuffer | Uint8Array): Promise<ParsedEmail> {
  const mail = await PostalMime.parse(raw);
  const from = mail.from && "address" in mail.from ? mail.from : mail.from?.group?.[0];
  const fromAddress = (from?.address ?? "").trim().toLowerCase();
  const replyTo = mail.replyTo?.flatMap((a) => ("group" in a && a.group ? a.group : [a]))[0];
  const replyToAddress = ("address" in (replyTo ?? {}) ? (replyTo as { address?: string }).address ?? "" : "").trim().toLowerCase();
  const plain = mail.text ?? "";
  const html = mail.html ? readHtml(mail.html.slice(0, MAX_HTML)) : { text: "", hiddenText: [], links: [] };

  // "From: a@evil.com, Chase <b@chase.com>" or two From headers: which one a mail app shows
  // differs, so we refuse to guess.
  const fromHeaders = mail.headers.filter((h) => h.key === "from");
  const fromCount = fromHeaders.flatMap((h) => addressParser(h.value).flatMap((a) => ("group" in a && a.group ? a.group : [a]))).length;

  const text = [plain.trim(), html.text].filter(Boolean).join("\n\n");
  const links = [...html.links, ...linksInText(plain)];
  let hiddenSize = 0;
  const hiddenText = html.hiddenText.filter((t) => (hiddenSize += t.length) <= MAX_HIDDEN);
  return {
    fromName: (from?.name ?? "").trim(),
    fromAddress,
    fromDomain: fromAddress.includes("@") ? fromAddress.slice(fromAddress.lastIndexOf("@") + 1) : "",
    multipleFrom: fromHeaders.length > 1 || fromCount > 1,
    ...(replyToAddress && replyToAddress !== fromAddress && { replyToAddress }),
    subject: (mail.subject ?? "").trim(),
    authResults: mail.headers.filter((h) => h.key === "authentication-results").map((h) => h.value.replace(/\s+/g, " ").trim()),
    text: text.slice(0, MAX_TEXT),
    links: links.slice(0, MAX_LINKS),
    hiddenText,
    truncated: (mail.html?.length ?? 0) > MAX_HTML || text.length > MAX_TEXT || links.length > MAX_LINKS || hiddenText.length < html.hiddenText.length,
  };
}

function trimTrailingPunctuation(s: string): string {
  let end = s.length;
  while (end > 0 && ".,;:!?".includes(s[end - 1])) end--;
  return s.slice(0, end);
}

/** Web addresses written out in plain text: full URLs, plus "www.x.com" and "x.com/path". */
export function linksInText(text: string): Link[] {
  const full = (text.match(/https?:\/\/[^\s<>"'`)\]]{1,2048}/gi) ?? []).map(trimTrailingPunctuation);
  const bare = (text.match(/(?<![\w@./:-])(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9-]+(?:\.[a-z0-9-]+)+\/)[^\s<>"'`)\]]*/gi) ?? [])
    .map((s) => trimTrailingPunctuation(s.slice(0, MAX_URL)))
    .filter((s) => parse(s.split("/")[0]).isIcann === true);
  return [...full.map((href) => ({ text: href, href })), ...bare.map((s) => ({ text: s, href: `http://${s}` }))];
}

// ---------- HTML ----------

type Rgb = [number, number, number];
type Frame = {
  tag: string;
  hidden: boolean; // display:none and friends: children can't undo it
  tiny: boolean; // font-size of 2px or less: a child with its own font size shows again
  color: Rgb;
  clearInk: boolean; // color: transparent
  background: Rgb;
  backgroundSet: boolean; // an inline background or bgcolor, not the white default
  classed: boolean; // a class is in play, so a <style> block may set colors we can't see
};

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const INLINE = new Set(["a", "abbr", "b", "bdi", "bdo", "big", "cite", "code", "em", "font", "i", "img", "kbd", "mark", "q", "s", "small", "span", "strong", "sub", "sup", "u", "wbr"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
// Text a mail app never shows. Not skipped: an unclosed <head> would otherwise swallow the
// whole body, while a browser shows it.
const UNSHOWN = new Set(["head", "title", "template", "xml"]);
const RAW = new Set(["script", "style"]);
const MAX_STYLE = 4096;

function parseStyle(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of (style ?? "").slice(0, MAX_STYLE).split(";")) {
    const colon = decl.indexOf(":");
    if (colon > 0) out[decl.slice(0, colon).trim().toLowerCase()] = decl.slice(colon + 1).replace(/!important/i, "").trim().toLowerCase();
  }
  return out;
}

/** An RGB color, "clear" for transparent ink, or undefined if we can't read it. */
function parseColor(value: string | undefined): Rgb | "clear" | undefined {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "white") return WHITE;
  if (v === "black") return BLACK;
  if (v === "transparent") return "clear";
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as Rgb;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return m[2] === "00" ? "clear" : ([0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as Rgb);
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+)(%?))?/.exec(v);
  if (m) return m[4] !== undefined && Number(m[4]) === 0 ? "clear" : [Number(m[1]), Number(m[2]), Number(m[3])];
  return undefined;
}

const rgbOf = (c: Rgb | "clear" | undefined) => (c === "clear" ? undefined : c);

/** The first color in a `background` shorthand like "#117aca url(x.png) no-repeat". */
function backgroundColor(style: Record<string, string>, attrs: Record<string, string>): Rgb | undefined {
  if (style["background-color"]) return rgbOf(parseColor(style["background-color"]));
  // Glue "rgb(1, 2, 3)" into one token, then split on spaces: linear, unlike a lookahead.
  for (const token of (style.background ?? "").replace(/\s*([,()])\s*/g, "$1").split(/\s+/)) {
    const color = rgbOf(parseColor(token));
    if (color) return color;
  }
  return rgbOf(parseColor(attrs.bgcolor));
}

function isZero(value: string | undefined): boolean {
  return value !== undefined && /^0(\.0+)?([a-z%]+)?$/.test(value);
}

function farOffScreen(value: string | undefined): boolean {
  const m = /^-(\d+)/.exec(value ?? "");
  return m !== null && Number(m[1]) >= 999;
}

function hiddenByStyle(style: Record<string, string>, attrs: Record<string, string>): boolean {
  if ("hidden" in attrs) return true;
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return true;
  if (style["mso-hide"] === "all") return true;
  if (style.opacity && Number(style.opacity) < 0.1) return true;
  const clipped = style.overflow === "hidden";
  if (clipped && ["max-height", "height", "max-width", "width"].some((k) => isZero(style[k]))) return true;
  if (["text-indent", "left", "top", "margin-left", "margin-top"].some((k) => farOffScreen(style[k]))) return true;
  if (/^rect\(\s*0/.test(style.clip ?? "") || /^inset\(\s*(50|100)%/.test(style["clip-path"] ?? "")) return true;
  return false;
}

/** True or false when this element sets a font size, undefined when it inherits one. */
function tinyFont(style: Record<string, string>): boolean | undefined {
  const value = style["font-size"];
  if (!value) return undefined;
  const size = /^([\d.]+)(px|pt)?$/.exec(value);
  return isZero(value) || (size !== null && Number(size[1]) <= 2);
}

// Close enough that nobody can read it: #eeeeee on white counts.
function sameColor(a: Rgb, b: Rgb): boolean {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 75;
}

/** Class names a <style> block hides outright: ".pre{display:none}". */
function hiddenClasses(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.slice(0, 200_000).matchAll(/\.([a-z0-9_-]{1,64})\s*\{([^{}]{0,2000})\}/gi)) {
    const style = parseStyle(m[2]);
    if (hiddenByStyle(style, {}) || tinyFont(style)) out.add(m[1].toLowerCase());
  }
  return out;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Visible text, hidden text and links from an HTML body. */
export function readHtml(html: string): { text: string; hiddenText: string[]; links: Link[] } {
  const stack: Frame[] = [{ tag: "#root", hidden: false, tiny: false, color: BLACK, clearInk: false, background: WHITE, backgroundSet: false, classed: false }];
  const visible: string[] = [];
  const hiddenText: string[] = [];
  const links: Link[] = [];
  const openLinks: { href: string; text: string[]; alt: string[] }[] = [];
  let hiddenRun: string[] = [];
  let rawDepth = 0;
  let css = "";
  let hideClasses = new Set<string>();

  const flushHidden = () => {
    const text = collapse(hiddenRun.join(""));
    if (text) hiddenText.push(text);
    hiddenRun = [];
  };
  // Block boundaries separate words; inline ones don't ("ig<span>nore</span>" is "ignore").
  const boundary = (name: string) => {
    if (INLINE.has(name)) return;
    visible.push(name === "br" ? "\n" : " ");
    if (hiddenRun.length) hiddenRun.push(" ");
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (RAW.has(name)) rawDepth++;
        boundary(name);
        if (name === "a" && attrs.href) openLinks.push({ href: attrs.href.trim(), text: [], alt: [] });
        if (name === "img" && attrs.alt && openLinks.length) openLinks[openLinks.length - 1].alt.push(attrs.alt);
        if (VOID.has(name)) return;
        // <body> ends an unclosed <head>, as it does in a browser.
        if (name === "body") {
          const head = stack.findIndex((f) => f.tag === "head");
          if (head > 0) stack.length = head;
        }
        const parent = stack[stack.length - 1];
        const style = parseStyle(attrs.style);
        const background = backgroundColor(style, attrs);
        const ink = parseColor(style.color) ?? (name === "font" ? parseColor(attrs.color) : undefined);
        const classes = (attrs.class ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        stack.push({
          tag: name,
          hidden: parent.hidden || UNSHOWN.has(name) || hiddenByStyle(style, attrs) || classes.some((c) => hideClasses.has(c)),
          tiny: tinyFont(style) ?? parent.tiny,
          color: rgbOf(ink) ?? parent.color,
          clearInk: ink === undefined ? parent.clearInk : ink === "clear",
          background: background ?? parent.background,
          backgroundSet: parent.backgroundSet || background !== undefined,
          classed: parent.classed || classes.length > 0,
        });
      },
      onclosetag(name) {
        if (RAW.has(name)) rawDepth = Math.max(0, rawDepth - 1);
        if (name === "style") {
          hideClasses = hiddenClasses(css);
        }
        boundary(name);
        if (name === "a" && openLinks.length) {
          const link = openLinks.pop()!;
          links.push({ text: collapse(link.text.join("")) || collapse(link.alt.join(" ")), href: link.href });
        }
        if (VOID.has(name)) return;
        for (let at = stack.length - 1; at > 0; at--) {
          if (stack[at].tag === name) {
            stack.length = at;
            break;
          }
        }
      },
      ontext(text) {
        const frame = stack[stack.length - 1];
        if (rawDepth > 0) {
          if (frame.tag === "style" && css.length < 200_000) css += text;
          return;
        }
        // White on an unknown background might be white on a CSS-colored button, so it only
        // counts as hidden when the background is set inline or no stylesheet could change it.
        const camouflaged = frame.clearInk || (sameColor(frame.color, frame.background) && (frame.backgroundSet || !frame.classed));
        if (frame.hidden || frame.tiny || camouflaged) {
          hiddenRun.push(text);
          return;
        }
        if (!text.trim()) {
          visible.push(text);
          return;
        }
        flushHidden();
        visible.push(text);
        for (const link of openLinks) link.text.push(text);
      },
      oncomment(comment) {
        // Not a word break: "ig<!-- -->nore" still reads "ignore".
        const text = collapse(comment);
        if (text) hiddenText.push(text);
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  flushHidden();
  return { text: collapse(visible.join("")), hiddenText, links };
}
