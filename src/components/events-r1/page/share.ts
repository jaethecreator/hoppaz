/** Links and sharing for the event page. The public link is hoppaz.fun/e/<slug>; ?ref= says who sent it. */
import type { R1Event } from "@/lib/events-r1/types";

export function eventUrl(e: Pick<R1Event, "slug" | "id">, ref?: string | null): string {
  const base = `https://hoppaz.fun/e/${e.slug || e.id}`;
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The phone's share sheet where there is one, else the link is copied. */
export async function shareOrCopy(input: { title: string; text: string; url: string }): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(input);
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  return (await copyText(input.url)) ? "copied" : "failed";
}
