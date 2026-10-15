import type { ComponentType } from "react";
import ClubhouseArt from "../campaign/ClubhouseArt";
import IndoorArt from "./art/IndoorArt";
import TheatreArt from "./art/TheatreArt";
import PoolArt from "./art/PoolArt";
import OutdoorArt from "./art/OutdoorArt";
import TechArt from "./art/TechArt";
import HotspotYabaArt from "./art/HotspotYabaArt";
import HotspotLekkiArt from "./art/HotspotLekkiArt";
import HotspotVictoriaIslandArt from "./art/HotspotVictoriaIslandArt";
import HotspotIkejaArt from "./art/HotspotIkejaArt";
import HotspotLagosIslandArt from "./art/HotspotLagosIslandArt";
import HotspotIkoyiArt from "./art/HotspotIkoyiArt";
import HotspotSurulereArt from "./art/HotspotSurulereArt";
import HotspotOjotaArt from "./art/HotspotOjotaArt";
import HotspotFestacArt from "./art/HotspotFestacArt";
import HotspotAjahArt from "./art/HotspotAjahArt";
import HotspotAlimoshoArt from "./art/HotspotAlimoshoArt";
import HotspotOjoBadagryArt from "./art/HotspotOjoBadagryArt";
import HotspotIkoroduArt from "./art/HotspotIkoroduArt";

import type { RoomArtContent, RoomArtProps } from "./art/kit";
import type { CampaignLayout } from "@/lib/campaign/layout";

export type { RoomArtContent, RoomArtProps };

/**
 * The backdrop of every room, by layout id (CampaignLayout.id). The clubhouse is the 360Playlist room; the others are the
 * event templates (event-*) and the hotspot rooms (hotspot-<slug>), one component each, written against art/kit.tsx.
 * A layout id with no entry falls back to the clubhouse art, so a stale or unknown template still draws something.
 */
const ART: Record<string, ComponentType<RoomArtProps>> = {
  "event-indoor": IndoorArt,
  "event-theatre": TheatreArt,
  "event-pool": PoolArt,
  "event-outdoor": OutdoorArt,
  "event-tech": TechArt,
  "hotspot-yaba": HotspotYabaArt,
  "hotspot-lekki": HotspotLekkiArt,
  "hotspot-victoria-island": HotspotVictoriaIslandArt,
  "hotspot-ikeja": HotspotIkejaArt,
  "hotspot-lagos-island": HotspotLagosIslandArt,
  "hotspot-ikoyi": HotspotIkoyiArt,
  "hotspot-surulere": HotspotSurulereArt,
  "hotspot-ojota": HotspotOjotaArt,
  "hotspot-festac": HotspotFestacArt,
  "hotspot-ajah": HotspotAjahArt,
  "hotspot-alimosho": HotspotAlimoshoArt,
  "hotspot-ojo-badagry": HotspotOjoBadagryArt,
  "hotspot-ikorodu": HotspotIkoroduArt,
};

export function hasRoomArt(layoutId: string) {
  return layoutId in ART;
}

export default function RoomArt({ layout, uid, brand, content }: { layout: CampaignLayout; uid: string; brand: string; content?: RoomArtContent }) {
  const Art = ART[layout.id];
  if (Art) return <Art layout={layout} uid={uid} brand={brand} content={content} />;
  return <ClubhouseArt layout={layout} uid={uid} brand={brand} />;
}
