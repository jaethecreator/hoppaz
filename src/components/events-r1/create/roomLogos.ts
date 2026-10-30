/**
 * The "LOGO" placeholders of Create a room (build brief section 15): each new room gets one at random in its logo square, with
 * "Tap to add yours". There is no template picker: tapping uploads, the uploaded logo tints the page, and the placeholder never comes
 * back. They are small SVGs drawn here (a few shapes and colours, the word LOGO), made into data links so they tint the page like any
 * picture. A placeholder is never saved as the room's logo: a room that never gets one shows its initial.
 */
const FONT = "font-family='Poppins,Helvetica,Arial,sans-serif' font-weight='800' text-anchor='middle'";

const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'>${body}</svg>`)}`;

/** Six placeholders: dark with red dots, lime disc, arch, blue frame, sun and sea, pink blocks. */
export const PLACEHOLDER_LOGOS: string[] = [
  svg(
    `<rect width='240' height='240' fill='#160606'/><text x='120' y='122' ${FONT} font-size='62' fill='#E0262E'>LOGO</text>` +
      [0, 1, 2, 3, 4].map((i) => `<circle cx='${60 + i * 30}' cy='${158 + (i % 2) * 14}' r='7' fill='#E0262E'/>`).join("")
  ),
  svg(`<rect width='240' height='240' fill='#D6F23C'/><circle cx='120' cy='120' r='82' fill='#101010'/><text x='120' y='134' ${FONT} font-size='40' fill='#D6F23C'>LOGO</text>`),
  svg(`<rect width='240' height='240' fill='#F4E9DA'/><path d='M50 190V120a70 70 0 0 1 140 0v70z' fill='#2D4FA8'/><text x='120' y='150' ${FONT} font-size='34' fill='#F4E9DA'>LOGO</text>`),
  svg(
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#5B2EFF'/><stop offset='1' stop-color='#16B4F2'/></linearGradient></defs>` +
      `<rect width='240' height='240' fill='url(#g)'/><rect x='60' y='60' width='120' height='120' fill='none' stroke='#fff' stroke-width='12'/><text x='120' y='132' ${FONT} font-size='30' fill='#fff'>LOGO</text>`
  ),
  svg(
    `<rect width='240' height='240' fill='#FF8A3D'/><circle cx='120' cy='104' r='54' fill='#FFD24A'/><text x='120' y='116' ${FONT} font-size='32' fill='#7A2E00'>LOGO</text>` +
      [0, 1, 2].map((i) => `<path d='M0 ${172 + i * 22} Q 30 ${160 + i * 22} 60 ${172 + i * 22} T 120 ${172 + i * 22} T 180 ${172 + i * 22} T 240 ${172 + i * 22} V240 H0Z' fill='${["#0E7FB8", "#0B6A9B", "#08577F"][i]}'/>`).join("")
  ),
  svg(
    `<rect width='240' height='240' fill='#FFE3EC'/><rect x='28' y='28' width='88' height='88' fill='#FF3D7F'/><rect x='124' y='124' width='88' height='88' fill='#7A1FFF'/><rect x='124' y='28' width='88' height='88' fill='#FFC400'/>` +
      `<text x='120' y='134' ${FONT} font-size='36' fill='#1A0A14' stroke='#FFE3EC' stroke-width='8' paint-order='stroke'>LOGO</text>`
  ),
];

/** A placeholder index for a new room (never the same as `not`, so Shuffle always changes it). */
export function randomPlaceholder(not?: number): number {
  const n = PLACEHOLDER_LOGOS.length;
  let i = Math.floor(Math.random() * n);
  if (not !== undefined && i === not) i = (i + 1) % n;
  return i;
}
