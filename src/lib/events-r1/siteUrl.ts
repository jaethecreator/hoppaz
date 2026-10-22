/** The address share and invite links point at: NEXT_PUBLIC_SITE_URL, else the address this page is on, else hoppaz.fun. */
export function siteOrigin(): string {
  const set = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (set) return set;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://hoppaz.fun";
}

/** The working public page of an event: <site>/event/<slug or id>. */
export function eventPageUrl(e: { slug?: string | null; id: string }): string {
  return `${siteOrigin()}/event/${encodeURIComponent(e.slug || e.id)}`;
}
