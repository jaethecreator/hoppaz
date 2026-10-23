import { CLUBHOUSE, clubhouseWidth, type CampaignLayout } from "../layout";

/**
 * The Emergency Room: a crew template for the Emergency Room night, a party dressed as a hospital ER. It is the
 * clubhouse's floor plan, tile for tile, with new names, floors and art (EmergencyArt). Same walls, areas, spawn and
 * prop ids, so everything that finds a room by its shape works as it does in the 360Playlist room: the stage (zone
 * `stage`) for voice, the featured event's sticker on `courtyard-fountain` (drawn here as the helipad), the way out
 * (`entry-map-table`, the discharge desk), Game Time's hiding places, and the 36-wide room.
 *
 * Only names and floors change here; the art draws every prop kind as hospital kit.
 */
const ZONES: Record<string, { name: string; subtitle: string; material: string }> = {
  studio: { name: "Triage", subtitle: "Take a number. Take a breath.", material: "triage" },
  stage: { name: "Operating Theatre", subtitle: "Scrubs on. Music up.", material: "theatre" },
  awards: { name: "Pharmacy", subtitle: "Prescriptions for the night", material: "pharmacy" },
  courtyard: { name: "Waiting Room", subtitle: "The doctor will see you now", material: "waiting" },
  records: { name: "Recovery Ward", subtitle: "Lie back. Link up.", material: "ward" },
  campaign: { name: "The Lab", subtitle: "Mixed, tested, served", material: "lab" },
};

const AREAS: Record<string, string> = {
  "booth-1": "Exam Room 1",
  "booth-2": "Exam Room 2",
  "courtyard-corner": "Waiting Corner",
  "lounge-table": "Ward Bay",
};

function retheme(base: CampaignLayout): CampaignLayout {
  return {
    ...base,
    id: "emergency-room",
    zones: base.zones.map((z) => ({ ...z, ...(ZONES[z.id] ?? {}) })),
    privateAreas: base.privateAreas.map((a) => ({ ...a, name: AREAS[a.id] ?? a.name })),
  };
}

export const EMERGENCY_ROOM: CampaignLayout = retheme(CLUBHOUSE);

export function emergencyRoomWidth(width: 30 | 36): CampaignLayout {
  return width === 30 ? EMERGENCY_ROOM : retheme(clubhouseWidth(width));
}
