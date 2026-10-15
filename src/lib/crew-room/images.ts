/**
 * Where a crew's pictures come from. The database keeps a PATH (supabase/crew_rooms.sql, _crew_image_ok): either one of
 * ours under /brands/ or a file in the crew-images bucket, "/storage/v1/object/public/crew-images/<crew id>/<file>". It
 * never keeps a link to a host, so no crew owner can point a logo at a server of their own. The app puts its own storage
 * address in front of a bucket path here, and draws nothing for anything else.
 */
const STORAGE = "/storage/v1/object/public/crew-images/";
const BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

/** The address an <img> can load for a stored picture, or null when it is not one of ours. */
export function crewImageSrc(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (stored.startsWith("/brands/") && !stored.includes("..")) return stored;
  if (stored.startsWith(STORAGE) && BASE) return `${BASE}${stored}`;
  // A full link on our own storage host (a card from before paths were stored) still loads; any other host never does.
  if (BASE && stored.startsWith(`${BASE}${STORAGE}`)) return stored;
  return null;
}

/** The path to store for a link on our storage host (what the owner's upload hands back). */
export function crewImagePath(link: string): string {
  const at = link.indexOf(STORAGE);
  return at >= 0 ? link.slice(at) : link;
}

/** A list of stored pictures as loadable addresses, the ones that are not ours left out. */
export function crewImageSrcs(stored: readonly string[] | null | undefined): string[] {
  return (stored ?? []).map(crewImageSrc).filter((s): s is string => !!s);
}
