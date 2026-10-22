/** The kind of online link, in words a guest knows. The link itself is shown only to a registered person and the host. */
import type { LinkType, R1Event } from "@/lib/events-r1/types";

export const LINK_LABEL: Record<LinkType, string> = {
  zoom: "Zoom",
  meet: "Google Meet",
  whatsapp: "WhatsApp call",
  other: "Online link",
};

export const linkLabel = (e: Pick<R1Event, "link_type">): string => LINK_LABEL[e.link_type ?? "other"];

/** Online or hybrid: there is a call or a stream to join. */
export const hasOnline = (e: Pick<R1Event, "kind">): boolean => e.kind === "online" || e.kind === "hybrid";
