import { copyText } from "@/components/events-r1/page/share";

/**
 * Share to WhatsApp: the text always goes to the clipboard. On a phone WhatsApp opens in a new tab with the text filled
 * in; on a desktop it only copies. Open first, copy after: a tab opened after an await can be blocked.
 */
export async function shareToWhatsApp(text: string): Promise<"copied" | "failed"> {
  const phone = typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  if (phone) window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  return (await copyText(text)) ? "copied" : "failed";
}
