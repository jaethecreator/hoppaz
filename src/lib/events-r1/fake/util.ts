/** Small shared helpers for the fake layer: time constants, stable ids, a seeded random generator, clone. */

export const HOUR = 3.6e6;
export const DAY = 24 * HOUR;

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Four 32-bit words from a string (cyrb128): the base of the stable seed ids and the seeded random choices. */
export function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function uuidFromHex(hex: string): string {
  const v = hex.slice(0, 32).split("");
  v[12] = "4";
  v[16] = "89ab"[parseInt(v[16], 16) % 4];
  const s = v.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** A UUID-shaped id that is the same every time for the same key. */
export function seedId(key: string): string {
  return uuidFromHex(hash128(key).map((n) => n.toString(16).padStart(8, "0")).join(""));
}

/** A random UUID-shaped id (getRandomValues also works on a plain http phone address, randomUUID does not). */
export function newId(): string {
  const b = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return uuidFromHex(Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""));
}

/** A small seeded random generator (mulberry32): same key, same numbers. */
export function rngFor(key: string): () => number {
  let a = hash128(key)[0];
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/** "Sunset Rooftop Sessions Vol. 12" -> "sunset-rooftop-sessions-vol-12-3fa" (short link: hoppaz.fun/e/<slug>). */
export function slugFor(title: string, id: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return `${base || "event"}-${id.replace(/-/g, "").slice(0, 3)}`;
}

/** Midnight at the start of the Lagos day (UTC+1, no daylight saving), `day` days from today. */
export function lagosMidnight(now: number, day: number): number {
  const d = new Date(now + HOUR);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + day) - HOUR;
}

export function lagosAt(now: number, day: number, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return lagosMidnight(now, day) + (h * 60 + m) * 60_000;
}
