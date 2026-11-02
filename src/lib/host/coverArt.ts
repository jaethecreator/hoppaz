import { eventTitle } from "../geo";

/**
 * A cover for an event that has none: a generated 4:5 picture (1080 x 1350) with the event's own name on it, so no other
 * event's words ever show. Colours come from the app's palette, picked by the id so an event always gets the same one.
 * Returned as a data URL, so it works wherever a cover address does, and the page tint can read it (no outside files, no
 * foreignObject, a width and height on the root). Webfonts do not load inside an SVG image, so the type is a system bold stack.
 */

const W = 1080;
const H = 1350;
const MARGIN = 90;
const BOX_W = W - MARGIN * 2;
/** The title sits on the lower part of the cover, ending here; the shapes keep to the top. */
const BASE = 1190;
const BOX_H = 760;
const MAX_SIZE = 168;
const MIN_SIZE = 52;
const LEAD = 1.04;
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

const INK = "#0E0B0A";
const CREAM = "#F5EBDD";
const ORANGE = "#FF4D00";
const VIOLET = "#5B2EFF";
const DANFO = "#FFC400";
const LAGOON = "#22B8F0";

/** Ground, type and the shape colour. Each pairs readable type on its ground, and the shape against both. */
const PALETTES: Array<{ bg: string; fg: string; accent: string }> = [
  { bg: ORANGE, fg: INK, accent: CREAM },
  { bg: INK, fg: CREAM, accent: ORANGE },
  { bg: VIOLET, fg: CREAM, accent: ORANGE },
  { bg: DANFO, fg: INK, accent: ORANGE },
  { bg: CREAM, fg: INK, accent: ORANGE },
  { bg: LAGOON, fg: INK, accent: CREAM },
  { bg: INK, fg: DANFO, accent: VIOLET },
];

/** The id as a number, the same way every time (the same hash the template picker used). */
function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** A word per character, no stray controls or lone surrogates (an SVG must be well formed, and encodeURIComponent throws on those). */
function clean(title: string): string[] {
  const text = eventTitle({ title }).replace(/\s+/g, " ").trim().toUpperCase();
  return Array.from(text).filter((c) => {
    const k = c.codePointAt(0) as number;
    return k >= 0x20 && !(k >= 0x7f && k < 0xa0) && !(k >= 0xd800 && k <= 0xdfff) && k !== 0xfffe && k !== 0xffff;
  });
}

/** How wide a character is in em, for bold capitals in a system sans. A little generous, so a line never runs past the edge. */
function em(c: string): number {
  if (c === " ") return 0.34;
  if ("IJ".includes(c)) return 0.44;
  if (".,:;'!|".includes(c)) return 0.38;
  if ("-–—".includes(c)) return 0.52;
  if ("MW@&%".includes(c)) return 1;
  if ((c.codePointAt(0) as number) > 0x2e7f) return 1.1;
  return 0.78;
}
const widthOf = (chars: string[], size: number) => chars.reduce((n, c) => n + em(c), 0) * size;

/** The words on lines no wider than the box at this size, or null when a single word is wider than a line. */
function wrap(words: string[][], size: number): string[][] | null {
  const lines: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    if (widthOf(w, size) > BOX_W) return null;
    const next = cur.length ? [...cur, " ", ...w] : w;
    if (widthOf(next, size) <= BOX_W) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** The biggest size at which the title fits the box, with its lines. At the smallest size a long word is cut and a long title ends in "…". */
function fit(chars: string[]): { size: number; lines: string[][] } {
  const words: string[][] = [];
  let cur: string[] = [];
  for (const c of chars) {
    if (c === " ") {
      if (cur.length) words.push(cur);
      cur = [];
    } else cur.push(c);
  }
  if (cur.length) words.push(cur);

  for (let size = MAX_SIZE; size >= MIN_SIZE; size -= 4) {
    const lines = wrap(words, size);
    if (lines && lines.length * size * LEAD <= BOX_H) return { size, lines };
  }
  // Too long for even the smallest size: cut words that are wider than a line, then keep the lines that fit.
  const size = MIN_SIZE;
  const room = Math.floor(BOX_H / (size * LEAD));
  const cut: string[][] = [];
  for (const w of words) {
    let rest = w;
    while (widthOf(rest, size) > BOX_W) {
      let n = rest.length;
      while (n > 1 && widthOf(rest.slice(0, n), size) > BOX_W) n--;
      cut.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    cut.push(rest);
  }
  const lines = wrap(cut, size) ?? cut;
  if (lines.length <= room) return { size, lines };
  const kept = lines.slice(0, room);
  const last = [...kept[room - 1], "…"];
  while (last.length > 1 && widthOf(last, size) > BOX_W) last.splice(last.length - 2, 1);
  kept[room - 1] = last;
  return { size, lines: kept };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** The shape in the upper part of the cover: a sun, rings or bars. Same id, same shape. */
function shape(kind: number, color: string): string {
  if (kind === 0) return `<circle cx="820" cy="270" r="330" fill="${color}"/>`;
  if (kind === 1) {
    const rings = [110, 210, 310, 410].map((r) => `<circle cx="880" cy="230" r="${r}" fill="none" stroke="${color}" stroke-width="26"/>`);
    return rings.join("");
  }
  const bars = [60, 190, 320, 450].map((y) => `<rect x="-300" y="${y}" width="1680" height="78" fill="${color}"/>`);
  return `<g transform="rotate(-16 540 300)">${bars.join("")}</g>`;
}

/**
 * The cover as a data URL. `title` is the event's name (a "LEAD · " prefix is dropped); without one the cover is the same
 * kind of picture with the Hoppaz name in place of a title.
 */
export function generatedCover(id: string, title?: string): string {
  const h = hashOf(id);
  const p = PALETTES[h % PALETTES.length];
  const kind = Math.floor(h / PALETTES.length) % 3;
  const chars = title ? clean(title) : [];

  let text: string;
  if (chars.length) {
    const { size, lines } = fit(chars);
    text = lines
      .map((l, i) => {
        const y = Math.round(BASE - (lines.length - 1 - i) * size * LEAD);
        return `<text x="${MARGIN}" y="${y}" font-size="${size}" font-weight="900" fill="${p.fg}">${esc(l.join(""))}</text>`;
      })
      .join("");
    text += `<text x="${MARGIN}" y="1268" font-size="34" font-weight="900" letter-spacing="9" fill="${p.fg}" opacity=".7">HOPPAZ</text>`;
  } else {
    text = `<text x="${MARGIN}" y="${BASE}" font-size="150" font-weight="900" letter-spacing="6" fill="${p.fg}">HOPPAZ</text>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${p.bg}"/>${shape(kind, p.accent)}` +
    `<g font-family='${FONT}'>${text}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
