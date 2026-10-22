import { CalendarDays, DoorOpen, Flag, Gift, MapPin, MoreHorizontal, ShieldAlert, Target, type LucideIcon } from "lucide-react";
import { EVENTS_R1 } from "@/lib/events-r1/flags";
import type { SectionKey } from "../types";

/**
 * The desk's sections in rail order: the long name (the rail and the section's heading), the short one (the phone's chips),
 * the icon, and the words that find the section in the search box (DeskSearch).
 */
export const SECTIONS: { key: SectionKey; title: string; short: string; Icon: LucideIcon; words: string[] }[] = [
  { key: "rooms", title: "Rooms and brands", short: "Rooms", Icon: DoorOpen, words: ["room", "brand", "crew"] },
  { key: "drops", title: "Drops", short: "Drops", Icon: Gift, words: ["game time", "drop", "ticket"] },
  { key: "events", title: "Events", short: "Events", Icon: CalendarDays, words: ["event", "queue"] },
  { key: "hotspots", title: "Hotspots", short: "Hotspots", Icon: MapPin, words: ["hotspot", "alias", "mute"] },
  { key: "safety", title: "Safety", short: "Safety", Icon: ShieldAlert, words: ["report", "photo", "safety"] },
  ...(EVENTS_R1 ? [{ key: "eventreports" as const, title: "Event reports", short: "Reports", Icon: Flag, words: ["event report", "reported", "hidden"] }] : []),
  { key: "quests", title: "Quests", short: "Quests", Icon: Target, words: ["quest"] },
  { key: "more", title: "More tools", short: "More", Icon: MoreHorizontal, words: ["partner", "spawner", "street box", "score", "collectible", "classic", "more"] },
];

export const isSection = (v: unknown): v is SectionKey => SECTIONS.some((s) => s.key === v);
