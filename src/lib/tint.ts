/**
 * The Tint engine (build brief section 3a). One colour, read from a host's cover or logo, becomes the whole page:
 * background, cards, text, lines, the main button and its lip. Same rule as Luma, our own maths, no AI.
 *
 * 1. readTint: shrink the picture to 64 x 64, drop grey, very dark and very light pixels, group the rest into 24 hue bins
 *    weighted by chroma squared. The winning bin's average hue is the tint, its 75th percentile chroma the strength.
 * 2. tintTokens: fixed lightness per role, chroma capped per role, then reduced until the colour fits sRGB.
 * 3. tintStyle: the tokens as CSS variables (--t-bg, --t-text, ...). Tailwind reads them as bg-t-bg, text-t-text, etc.
 *
 * Store only { hue, chroma } (a Look). Every surface rebuilds the same scale from it.
 */
import type { CSSProperties } from "react";

export type Tint = { hue: number; chroma: number };
export type Mood = "day" | "night";

/** A black and white flyer, or a picture we cannot read: a warm grey. */
export const FALLBACK_TINT: Tint = { hue: 40, chroma: 0.03 };

const toLin = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const toS = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

/** sRGB 0..255 to OKLCH. */
export function oklch(r: number, g: number, b: number): { L: number; C: number; H: number } {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, Bb), H: ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360 };
}

function rawRgb(L: number, C: number, H: number): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH to an rgb() string, lowering chroma until it fits sRGB. */
export function oklchToRgb(L: number, C: number, H: number, alpha?: number): string {
  let c = C;
  for (let i = 0; i < 30; i++) {
    if (rawRgb(L, c, H).every((x) => x >= -0.0005 && x <= 1.0005)) break;
    c *= 0.92;
  }
  const v = rawRgb(L, c, H).map(toS).join(" ");
  return alpha == null ? `rgb(${v})` : `rgb(${v} / ${alpha})`;
}

/** The dominant colour of loaded pixels (RGBA, any size). Exposed for tests. */
export function tintFromPixels(d: Uint8ClampedArray): Tint {
  const bins = Array.from({ length: 24 }, () => ({ w: 0, hx: 0, hy: 0, c: [] as number[] }));
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const o = oklch(d[i], d[i + 1], d[i + 2]);
    if (o.C < 0.04 || o.L < 0.18 || o.L > 0.94) continue;
    const b = bins[Math.floor(o.H / 15) % 24];
    const w = o.C * o.C;
    b.w += w;
    b.hx += Math.cos((o.H * Math.PI) / 180) * w;
    b.hy += Math.sin((o.H * Math.PI) / 180) * w;
    b.c.push(o.C);
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  if (!best.w) return FALLBACK_TINT;
  best.c.sort((a, b) => a - b);
  return { hue: ((Math.atan2(best.hy, best.hx) * 180) / Math.PI + 360) % 360, chroma: best.c[Math.floor(best.c.length * 0.75)] };
}

const cache = new Map<string, Promise<Tint>>();

/** Read the tint of a picture by its address (data URL, same-site path, or a public bucket link that allows CORS). */
export function readTint(src: string): Promise<Tint> {
  const hit = cache.get(src);
  if (hit) return hit;
  const p = new Promise<Tint>((resolve) => {
    if (typeof window === "undefined") return resolve(FALLBACK_TINT);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 64;
        const x = cv.getContext("2d");
        if (!x) return resolve(FALLBACK_TINT);
        x.drawImage(img, 0, 0, 64, 64);
        resolve(tintFromPixels(x.getImageData(0, 0, 64, 64).data));
      } catch {
        resolve(FALLBACK_TINT);
      }
    };
    img.onerror = () => resolve(FALLBACK_TINT);
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

export type TintTokens = Record<"bg" | "tile" | "solid" | "text" | "muted" | "line" | "soft" | "accent" | "ember" | "on" | "bar" | "glow" | "glow2", string> & {
  scheme: "dark" | "light";
};

/** The tinted scale for one colour, night (dark page) or day (light page). */
export function tintTokens({ hue: H, chroma: C }: Tint, mood: Mood): TintTokens {
  const k = (n: number) => Math.min(C, n);
  const c = oklchToRgb;
  return mood === "night"
    ? {
        bg: c(0.19, k(0.035), H), tile: c(0.225, k(0.042), H), solid: c(0.235, k(0.045), H), text: c(0.95, k(0.015), H),
        muted: c(0.72, k(0.03), H), line: c(0.32, k(0.045), H), soft: c(0.28, k(0.065), H), accent: c(0.67, k(0.17), H),
        ember: c(0.45, k(0.15), H), on: c(0.14, k(0.04), H), bar: c(0.19, k(0.035), H, 0.94), glow: c(0.32, k(0.12), H, 0.8),
        glow2: c(0.36, k(0.12), (H + 40) % 360, 0.7), scheme: "dark",
      }
    : {
        bg: c(0.968, k(0.02), H), tile: c(0.99, k(0.008), H), solid: c(0.995, k(0.006), H), text: c(0.22, k(0.035), H),
        muted: c(0.5, k(0.035), H), line: c(0.89, k(0.025), H), soft: c(0.92, k(0.045), H), accent: c(0.46, k(0.15), H),
        ember: c(0.31, k(0.12), H), on: c(0.985, k(0.01), H), bar: c(0.968, k(0.02), H, 0.94), glow: c(0.86, k(0.08), H, 0.9),
        glow2: c(0.88, k(0.07), (H + 40) % 360, 0.8), scheme: "light",
      };
}

/** Tokens as CSS variables for a wrapper's style. */
export function tintStyle(tint: Tint, mood: Mood): CSSProperties {
  const t = tintTokens(tint, mood);
  const s: Record<string, string> = { colorScheme: t.scheme };
  for (const [k, v] of Object.entries(t)) if (k !== "scheme") s[`--t-${k}`] = v;
  return s as CSSProperties;
}

/** Five fixed swatches the host can pick instead of the cover's own colour. */
export const SWATCHES: Tint[] = [
  { hue: 26, chroma: 0.16 },
  { hue: 274, chroma: 0.12 },
  { hue: 150, chroma: 0.12 },
  { hue: 85, chroma: 0.13 },
  { hue: 330, chroma: 0.14 },
];

/** A swatch's own face (mid lightness). */
export const swatchColor = (t: Tint) => oklchToRgb(0.6, t.chroma, t.hue);
