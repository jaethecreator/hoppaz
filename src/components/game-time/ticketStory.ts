import { BRAND_PALETTE, withAlpha } from "@/components/today/palette";
import { DISPLAY, MONO, fitText, loadImage, roundRect, setFont, setSpacing, toBlob, wrap, type Ctx } from "@/components/today/story";

/**
 * Share to story for a Game Time winner: a real 1080 x 1920 PNG, drawn on a canvas, in the same look as the event story
 * (dark ink, a glow in the brand colours, the dotted ticket frame, the lip stickers, the Hoppaz wordmark).
 *
 * Top to bottom: a big I'M GOING sticker, the Game Time's title as the headline, a ticket strip that reads
 * "TICKET FROM <BRAND>" with the crew's round logo, "POWERED BY" and the Hoppaz wordmark, and the site's short address.
 *
 * NEVER PUT THE TICKET CODE IN HERE. Not in the picture, not in the share text, not in the link. Whoever holds the code can
 * claim the ticket, so sharing it would hand the prize to anyone who sees the story. That is why TicketStoryInput has no
 * code field at all: the picture cannot print what it is never given. Keep it that way.
 *
 * The crew's logo is read back off a canvas, which needs its server to allow CORS (a path of ours always does; a picture in
 * the crew-images bucket does). If the canvas is "tainted" anyway, or the logo will not load, the ticket is drawn again
 * without it, so there is always an image to share and it never fails.
 */

export const TICKET_STORY_W = 1080;
export const TICKET_STORY_H = 1920;

export type TicketStoryInput = {
  /** The Game Time's title, which staff name after the night ("Dave's concert"). */
  title: string;
  /** The game's brand, as the winner's card shows it ("360Playlist"). The picture prints it in capitals. */
  brand: string;
  /** The crew's logo address, or null to draw the ticket without one. */
  logo: string | null;
  /** The short address to print: the site's host (hoppaz.app), never a long link. */
  link: string;
};

export type TicketStoryResult = { blob: Blob; usedLogo: boolean };

/** "360 Playlist" and "360-playlist" are the same brand: it is always written 360Playlist. Other brands are left alone. */
export function brandName(brand: string): string {
  const b = brand.trim().replace(/\s+/g, " ");
  return /^360[\s-]?play[\s-]?list$/i.test(b) ? "360Playlist" : b;
}

/** "I'm going to Dave's concert. Ticket from 360Playlist, powered by Hoppaz." No code. */
export function ticketShareText(title: string, brand: string): string {
  const t = title.trim().replace(/[\s.!?]+$/, "") || "Game Time";
  const b = brandName(brand) || "Hoppaz";
  return `I'm going to ${t}. Ticket from ${b}, powered by Hoppaz.`;
}

/** Draw the story and hand back the PNG. */
export async function renderTicketStory(input: TicketStoryInput): Promise<TicketStoryResult> {
  try {
    await Promise.all([document.fonts.load(`900 80px ${DISPLAY}`), document.fonts.load(`500 30px ${MONO}`)]);
  } catch {
    /* the system fonts will do */
  }
  const [logoImg, word] = await Promise.all([input.logo ? loadImage(input.logo, true) : Promise.resolve(null), loadImage("/brand/wordmark-cream.png", false)]);
  try {
    return { blob: await draw(input, logoImg, word), usedLogo: !!logoImg };
  } catch (e) {
    // A tainted canvas: draw it again without the logo rather than fail.
    if (logoImg && e instanceof DOMException && e.name === "SecurityError") {
      return { blob: await draw(input, null, word), usedLogo: false };
    }
    throw e;
  }
}

/* -------------------------------------------------------------- drawing -- */

async function draw({ title, brand, link }: TicketStoryInput, logoImg: HTMLImageElement | null, word: HTMLImageElement | null) {
  const W = TICKET_STORY_W;
  const H = TICKET_STORY_H;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  // willReadFrequently keeps it a plain (CPU) canvas: it is saved as a picture once drawn, and a GPU one stalls on that read.
  const x = cv.getContext("2d", { willReadFrequently: true });
  if (!x) throw new Error("This browser cannot draw the story.");
  const [c0, c1, c2] = BRAND_PALETTE;

  // The ground, then the brand's colours as soft pools of light.
  x.fillStyle = "#0E0B0A";
  x.fillRect(0, 0, W, H);
  const pool = (cx: number, cy: number, r: number, col: string, a: number) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(col, a));
    g.addColorStop(1, withAlpha(col, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  };
  pool(W * 0.5, H * 0.42, W * 1.0, c0, 0.8);
  pool(0, H * 0.12, W * 0.95, c1, 0.85);
  pool(W, H * 0.88, W * 1.1, c1, 0.75);
  pool(W, 0, W * 0.7, c2, 0.5);
  const vg = x.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, "rgba(14,11,10,.5)");
  vg.addColorStop(0.18, "rgba(14,11,10,0)");
  vg.addColorStop(0.8, "rgba(14,11,10,0)");
  vg.addColorStop(1, "rgba(14,11,10,.72)");
  x.fillStyle = vg;
  x.fillRect(0, 0, W, H);
  // A fine dot screen, like print.
  x.fillStyle = "rgba(14,11,10,.12)";
  for (let yy = 0; yy < H; yy += 22) for (let xx = ((yy / 22) % 2) * 11; xx < W; xx += 22) x.fillRect(xx, yy, 3, 3);
  // A ticket frame: a solid hairline and a dotted one inside it.
  x.strokeStyle = "rgba(245,235,221,.4)";
  x.lineWidth = 5;
  roundRect(x, 34, 34, W - 68, H - 68, 64);
  x.stroke();
  x.setLineDash([2, 18]);
  x.lineCap = "round";
  x.lineWidth = 6;
  x.strokeStyle = "rgba(245,235,221,.35)";
  roundRect(x, 58, 58, W - 116, H - 116, 48);
  x.stroke();
  x.setLineDash([]);

  x.textAlign = "center";

  // The sticker: I'M GOING, big and a little crooked, with the lip of the buttons.
  x.save();
  x.translate(W / 2, 262);
  x.rotate((-5 * Math.PI) / 180);
  x.fillStyle = "#B83600";
  roundRect(x, -350, -85 + 12, 700, 170, 44);
  x.fill();
  x.fillStyle = "#FF4D00";
  roundRect(x, -350, -85, 700, 170, 44);
  x.fill();
  x.fillStyle = "#0E0B0A";
  const ssz = fitText(x, "I'M GOING", 900, DISPLAY, 112, 60, 0, 620);
  x.fillText("I'M GOING", 0, ssz * 0.35);
  x.restore();

  // The headline: the Game Time's title, as big as it can be and still fit in the band, wrapped and shrunk for a long one.
  const head = fitHeadline(x, (title.trim() || "Game Time").toUpperCase(), 880, 5, 620, 176, 56);
  x.fillStyle = "#F5EBDD";
  x.font = `900 ${head.size}px ${DISPLAY}`;
  setSpacing(x, 0);
  x.save();
  x.shadowColor = "rgba(0,0,0,.35)";
  x.shadowBlur = 24;
  x.shadowOffsetY = 4;
  const lh = head.size * 0.98;
  const top = 700 - (lh * head.lines.length) / 2;
  head.lines.forEach((l, i) => x.fillText(l, W / 2, top + i * lh + head.size * 0.8));
  x.restore();

  // The ticket strip, tilted a little and shadowed.
  const tw = 900;
  const th = 330;
  const off = document.createElement("canvas");
  off.width = tw;
  off.height = th;
  // Plain (CPU) like the canvas it is drawn onto: a GPU one would be read back from the graphics card, and stall.
  const ox = off.getContext("2d", { willReadFrequently: true });
  if (!ox) throw new Error("This browser cannot draw the story.");
  drawTicket(ox, brand, logoImg, tw, th);
  x.save();
  x.translate(W / 2, 1195);
  x.rotate((1.6 * Math.PI) / 180);
  x.shadowColor = "rgba(0,0,0,.6)";
  x.shadowBlur = 60;
  x.shadowOffsetY = 30;
  x.drawImage(off, -tw / 2, -th / 2);
  x.restore();

  // POWERED BY, and the real wordmark file (letters take the lower 58% of it, the ears rise above).
  x.textAlign = "center";
  x.fillStyle = "rgba(245,235,221,.78)";
  setFont(x, 500, MONO, 32, 9);
  x.fillText("POWERED BY", W / 2, 1482);
  setSpacing(x, 0);
  if (word) {
    const h = 160;
    const w = (word.width / word.height) * h;
    x.drawImage(word, W / 2 - w / 2, 1500, w, h);
  } else {
    x.fillStyle = "#F5EBDD";
    x.font = `900 112px ${DISPLAY}`;
    x.fillText("HOPPAZ", W / 2, 1620);
  }

  // The site's short address, so anyone who sees the story can find it.
  const shown = link.replace(/^https?:\/\//, "");
  const lsz = fitText(x, shown, 500, MONO, 44, 26, 0, W - 220);
  const lw = Math.min(W - 120, x.measureText(shown).width + 120);
  x.fillStyle = "#B83600";
  roundRect(x, W / 2 - lw / 2, 1716, lw, 108, 54);
  x.fill();
  x.fillStyle = "#FF4D00";
  roundRect(x, W / 2 - lw / 2, 1708, lw, 108, 54);
  x.fill();
  x.fillStyle = "#0E0B0A";
  x.fillText(shown, W / 2, 1708 + 54 + lsz * 0.34);
  x.textAlign = "left";

  return toBlob(cv);
}

/**
 * The ticket: a cream top with the crew's round logo, TICKET FROM and the brand, a perforation with a bite out of each
 * edge, and an orange foot. The brand is the game's brand, in capitals.
 */
function drawTicket(x: Ctx, brand: string, logo: HTMLImageElement | null, cw: number, ch: number) {
  const cut = 236;
  x.save();
  roundRect(x, 0, 0, cw, ch, 34);
  x.clip();
  x.fillStyle = "#FBF3E6";
  x.fillRect(0, 0, cw, ch);

  // The round logo, with an ink ring.
  let left = 48;
  if (logo) {
    const r = 82;
    const cx = 44 + r;
    const cy = cut / 2;
    x.fillStyle = "#0E0B0A";
    x.beginPath();
    x.arc(cx, cy, r, 0, 7);
    x.fill();
    x.save();
    x.beginPath();
    x.arc(cx, cy, r - 6, 0, 7);
    x.clip();
    // object-fit: cover
    const k = Math.max((r * 2) / logo.width, (r * 2) / logo.height);
    const w = logo.width * k;
    const h = logo.height * k;
    x.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
    x.restore();
    left = 44 + r * 2 + 34;
  }

  // TICKET FROM, and the brand under it.
  const maxW = cw - left - 44;
  x.textAlign = "left";
  x.fillStyle = "#6B5F55";
  setFont(x, 500, MONO, 30, 6);
  x.fillText("TICKET FROM", left, cut / 2 - 28);
  setSpacing(x, 0);
  const name = (brandName(brand) || "Hoppaz").toUpperCase();
  x.fillStyle = "#0E0B0A";
  const bsz = fitText(x, name, 900, DISPLAY, 92, 34, 0, maxW);
  x.fillText(name, left, cut / 2 - 28 + 18 + bsz * 0.82);

  // The perforation.
  x.fillStyle = "rgba(14,11,10,.4)";
  for (let px = 26; px < cw - 26; px += 22) x.fillRect(px, cut - 1.5, 11, 3);

  // The foot.
  x.fillStyle = "#FF4D00";
  x.fillRect(0, cut, cw, ch - cut);
  x.fillStyle = "#B83600";
  x.fillRect(0, ch - 8, cw, 8);
  x.fillStyle = "#0E0B0A";
  x.textAlign = "center";
  const fsz = fitText(x, "GAME TIME WINNER", 900, DISPLAY, 36, 22, 5, cw - 80);
  x.fillText("GAME TIME WINNER", cw / 2, cut + (ch - 8 - cut) / 2 + fsz * 0.35);
  setSpacing(x, 0);
  x.textAlign = "left";
  x.restore();

  // The two punched notches on the perforation.
  x.save();
  x.globalCompositeOperation = "destination-out";
  x.beginPath();
  x.arc(0, cut, 19, 0, 7);
  x.fill();
  x.beginPath();
  x.arc(cw, cut, 19, 0, 7);
  x.fill();
  x.restore();
}

/**
 * The headline: from `from` px down to no less than `min`, the biggest size at which the title wraps into at most
 * `maxLines` lines that all fit `maxW` wide, and whose block is no taller than `maxH`. A title that still does not fit at the
 * smallest size is cut with an ellipsis, never run off the picture.
 */
function fitHeadline(x: Ctx, text: string, maxW: number, maxLines: number, maxH: number, from: number, min: number) {
  const fits = (size: number) => {
    x.font = `900 ${size}px ${DISPLAY}`;
    setSpacing(x, 0);
    const lines = wrap(x, text, maxW);
    const ok = lines.length <= maxLines && lines.length * size * 0.98 <= maxH && lines.every((l) => x.measureText(l).width <= maxW);
    return { ok, lines };
  };
  for (let size = from; size >= min; size -= 4) {
    const r = fits(size);
    if (r.ok) return { size, lines: r.lines };
  }
  x.font = `900 ${min}px ${DISPLAY}`;
  setSpacing(x, 0);
  const all = wrap(x, text, maxW);
  const lines = all.slice(0, maxLines);
  if (all.length > maxLines) lines[maxLines - 1] += "…";
  return { size: min, lines: lines.map((l) => clip(x, l, maxW)) };
}

/** `text` cut short with an ellipsis until it measures no wider than `maxW` (the font is already set). */
function clip(x: Ctx, text: string, maxW: number) {
  if (x.measureText(text).width <= maxW) return text;
  let t = text.replace(/…$/, "");
  while (t.length > 1 && x.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}
