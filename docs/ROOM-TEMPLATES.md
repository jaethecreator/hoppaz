# Room templates: event rooms and hotspot rooms

Status: 15 Oct 2026, branch `jae/room-templates` (cut from PR #4, 00e8ef8). Built on the 360Playlist crew-room engine
(`CampaignWorld`, `layout.ts`, `geometry.ts`, `templates.ts`). Nothing here touches the crew-room server, the map, Play,
the intro or `crew_rooms.sql`.

## What there is

| Kind | Rooms | Key | Opened when |
|---|---|---|---|
| Event rooms | theatre, pool party, outdoor party, indoor party, tech event | `event-theatre`, `event-pool`, `event-outdoor`, `event-indoor`, `event-tech` | an event is posted; the flyer and the line-up hang on the walls |
| Hotspot rooms | one per hotspot, unique to its real place (13 hotspots, wave 1 first) | `hotspot-<slug>` (slug from `supabase/hotspot_zones.sql`) | the hotspot is entered |
| Crew rooms | the clubhouse | `clubhouse` | unchanged: `ROOM_TEMPLATES`, the MANAGE picker |

Event and hotspot rooms are **place rooms** (`PLACE_ROOMS` in `src/lib/campaign/templates.ts`). They are not crew
templates: `ROOM_TEMPLATES` (what MANAGE shows) still lists the clubhouse only, and `templateFor("event-pool")` still opens
the clubhouse.

## Entry points

```ts
import { eventRoom, hotspotRoom, placeRoom } from "@/lib/campaign/templates";
import RoomArt from "@/components/campaign/roomArt";

hotspotRoom("yaba")        // PlaceRoom | null: null while that hotspot has no room (fall back to the crossroads screen)
eventRoom("event-pool")    // PlaceRoom | null
placeRoom(key)             // either
room.layout                // CampaignLayout: pass it to CampaignWorld as `layout`
```

`CampaignWorld` picks the backdrop by `layout.id` (`roomArt.tsx`). Pass `roomContent` for an event: `{ title, line,
flyerUrl, lineup }`. A hotspot room reads its place data from `src/lib/rooms/hotspotRooms.ts` itself.

Dev page: `/dev/room-templates` (still of each room at phone size, walk it with demo people).

## One room = two files (plus a line in two registries)

| File | What |
|---|---|
| `src/lib/campaign/rooms/<name>.ts` | the layout: grid, spawn, zones, walls, props. Data only, no JSX. Uses `build.ts` |
| `src/components/campaign/art/<Name>Art.tsx` | the backdrop: one SVG, drawn from the layout with `kit.tsx` |
| `src/lib/campaign/templates.ts` | `EVENT_ROOMS` or `HOTSPOT_ROOMS` entry |
| `src/components/campaign/roomArt.tsx` | the `ART` map entry |

Hotspot place data: `src/lib/rooms/hotspotRooms.ts` (sign, palette, welcome line, Paz line, hero, four venues).

## The frame every room shares (same as the clubhouse)

- 30 by 20 tiles of 32 px (960 x 640). The outer ring of tiles is never walkable, so author walls inside it.
- Spawn (15, 17). The exit is the prop `entry-map-table`, 2 by 1 tiles at (13, 16): the tile under it must be walkable
  (the exit's plate walks you there). Draw it as whatever fits the room (`gate`, `door`, `mapboard`, a box office desk).
- Walls are blocks and always solid. A prop is solid unless made with `floorProp`. Floor decoration (a dance floor, a rug)
  is a `floorProp`.
- Zones are the name tags in the room (3 to 7). Each has a `stop` tile (walkable, inside it, reachable from the spawn) and a
  `plaque` tile (where the tag sits). No private areas.
- Prop ids are stable and unique inside a room: Game Time hides boxes by prop id and other features find the exit and the
  flyer by id. Never rename one once shipped.
- No pockets: every walkable tile must be reachable from the spawn (the check allows 2).

## Event contract

- `event-flyer`: kind `flyer`, solid, at least 2 by 2 tiles, hanging on a wall (draw it with `Flyer` from the kit).
- `event-lineup`: kind `lineup`, solid, at least 2 by 2, on a wall (draw with `Lineup`).
- The room's sign shows `content.title` (fall back to `brand`). Both props come from `content`, with the sample
  placeholders the kit already has when there is no content.

## Hotspot contract

- Props `hero` (at least 12 tiles) and `venue-1` to `venue-4` (each at least 8 tiles), solid.
- Zones `hero` and `venue-1` to `venue-4`; the venue zones are named exactly as the real venues in the place data (the tags
  in the room read as the venue names).
- The four venue facades carry the real venue name as text. Name only: no logos, no photos, no claim to be the venue.
- Local objects (danfo, keke, BRT shelter, palms ...) are props too, with stable ids (`danfo-1`, `keke-1`).

## Who is drawn in a room

- **Event rooms** show real avatars and real names, like crew rooms.
- **Hotspot rooms keep aliases** (Jae, 15 Oct 2026): everyone there is an alias name with an alias look (`anonLook(alias)`),
  exactly as hotspot chat shows them today. Never a real avatar or a real name, and never a user id in a peer. The
  `/room/<slug>` preview and the dev page follow this; the walking server (hotspot_rooms.sql) will hand each Hopper their
  alias.

## Look (match the 360Playlist room and the Hoppaz brand)

- Pixel look, `shapeRendering="crispEdges"`, flat colour, no gradients (an opacity overlay is fine), 2 px ink outlines,
  one light from the top left, a hard shadow to the lower right, three tones per material.
- Palette: the clubhouse tones in `kit.tsx` `P`, plus Hoppaz orange `#FF4D00`, ember, night `#0E0B0A`, violet `#5B2EFF`
  (one violet shape per room at most) and the Lagos street colours (danfo yellow, keke green, lagoon blue). Orange is the
  loudest thing on a wall: signs, doors, the flyer. Never a fifth brand colour.
- Type on art: `FONT.display` (Poppins 900) for signs, `FONT.mono` for small captions. Text sits on a plate, never bare.
- No people (the engine draws the avatars), no logos, no emoji, no real photos.
- Copy: no em dashes, "360Playlist" as one word, "Hoppaz", the mascot is "Paz". Short, second person, Lagos-street.

## Working on a room

```bash
node scripts/rooms/render-room.mjs event-pool          # draws .room-renders/event-pool.png (no browser)
node scripts/rooms/render-room.mjs event-pool --props  # same with every prop box, wall, stop and the spawn outlined
node scripts/rooms/render-room.mjs all
node scripts/rooms/check-campaign.mjs                  # layouts, ids, reachability, event and hotspot contracts
```

The render uses system fonts, so type is only roughly right; shapes and positions are exact. Keep a room under about
900 SVG nodes (the clubhouse is about 650): use patterns for floors, not one rect per tile.

## What this branch does not do

- The server for walking in hotspot rooms, and any production SQL.
- Game Time inside these rooms.
- `scripts/crew-room/export-layouts.mjs` is untouched and must not be run for this branch: it rewrites
  `supabase/crew_rooms.sql`. Layout SQL for place rooms goes to its own file (`scripts/rooms/export-place-layouts.mjs`).
