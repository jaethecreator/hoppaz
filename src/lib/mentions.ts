/**
 * Tags in hotspot chats (supabase/hotspot_mentions.sql).
 *
 * Hotspot chat refuses an "@name" on purpose (it is how handles get swapped), so a tag is stored as the alias between two
 * white square brackets, U+27E6 and U+27E7, which the room's filter reads as plain words. The box lists aliases when you type
 * "@" and writes the token when you pick one; the message row shows the token as "@alias". The server pings the person only
 * if the token is an alias that is in that room right now.
 */
export const TAG_OPEN = "⟦";
export const TAG_CLOSE = "⟧";
/** A message may tag at most this many people. */
export const MAX_TAGS = 3;

export type Mentionable = { key: string; alias: string };

const WORD = /[A-Za-z0-9]/;

/** The "@alias" at index i of text (the longest alias that fits), or null. */
function tagAt(text: string, i: number, sorted: Mentionable[]): Mentionable | null {
  if (text[i] !== "@") return null;
  if (i > 0 && !/[\s([{,.;:!?]/.test(text[i - 1])) return null; // an email-like "a@b" is not a tag
  const rest = text.slice(i + 1).toLowerCase();
  for (const m of sorted) {
    const a = m.alias.toLowerCase();
    if (!rest.startsWith(a)) continue;
    const next = text[i + 1 + a.length];
    if (next !== undefined && WORD.test(next)) continue; // "@Mango Zebra F5x" is not "@Mango Zebra F5"
    return m;
  }
  return null;
}

const byLength = (list: Mentionable[]) => [...list].sort((x, y) => y.alias.length - x.alias.length);

/** How many "@alias" tags are in the text as typed (the box stops offering more at MAX_TAGS). */
export function countTags(text: string, list: Mentionable[]): number {
  const sorted = byLength(list);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const m = tagAt(text, i, sorted);
    if (m) {
      n++;
      i += m.alias.length;
    }
  }
  return n;
}

/** The text as it is sent: each "@alias" that is a known alias becomes its token. Tags past MAX_TAGS are left as typed. */
export function encodeTags(text: string, list: Mentionable[]): string {
  if (!list.length || !text.includes("@")) return text;
  const sorted = byLength(list);
  let out = "";
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const m = n < MAX_TAGS ? tagAt(text, i, sorted) : null;
    if (m) {
      out += `${TAG_OPEN}${m.alias}${TAG_CLOSE}`;
      i += m.alias.length;
      n++;
    } else out += text[i];
  }
  return out;
}

export type Piece = { text: string; tag: boolean };

/** A stored body as pieces: plain text and tags, so the message row can draw each. */
export function splitTags(body: string): Piece[] {
  if (!body.includes(TAG_OPEN)) return [{ text: body, tag: false }];
  const out: Piece[] = [];
  const re = new RegExp(`${TAG_OPEN}([^${TAG_OPEN}${TAG_CLOSE}]{1,40})${TAG_CLOSE}`, "g");
  let last = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index > last) out.push({ text: body.slice(last, m.index), tag: false });
    out.push({ text: m[1], tag: true });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), tag: false });
  return out;
}
