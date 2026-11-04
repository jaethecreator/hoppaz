/**
 * The address part of a shared link's path. A share sheet's Copy can join the event or room name onto the link
 * ("<slug> Jae's home welcoming", arriving as "<slug>%20Jae's..."), so only the first word is the address.
 */
export function linkAddress(raw: string): string {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    // Not valid percent encoding: use it as it came.
  }
  return s.trim().split(/\s+/)[0] ?? "";
}
