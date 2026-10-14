# 360 Playlist Clubhouse

## Purpose

A compact music campaign venue on Hoppaz's main map. It should feel like one connected, lived-in space with six distinct activities, rather than a set of identical buildings or an office. The layout is reusable; campaign content can change without redrawing the venue.

This direction was developed with the user-requested Astra design agent. Reference material: the supplied Gather office screenshots, [Gather's public site](https://www.gather.town/), and [Dayroom's public room demonstration](https://usedayroom.com/#inside). These inform spatial composition and interaction. Artwork must be original.

## Compact layout

30 × 20 logical tiles, 32 units per tile. Dimensions belong in one layout definition and must drive camera bounds, art and navigation. There is no existing server-side room-width setting in the first-phase implementation.

| Section | Proposed floor rectangle (x, y, width, height) | Identity |
| --- | --- | --- |
| Listening Studio | 1, 2, 9, 6 | Slate acoustic floor, timber trim, console, speakers and headphone seats |
| 360 Playlist Stage | 11, 2, 8, 5 | Walnut stage, dominant cream/ember wordmark, microphones and decks |
| Awards Gallery | 20, 2, 9, 6 | Cream tiles, gold frames, glass cabinets and quiet seating |
| Courtyard | 11, 8, 8, 7 | Green planted edges, stone paths, benches and a central planted feature |
| Record Lounge | 1, 12, 9, 6 | Timber floor, patterned rug, sofas, vinyl bins and tables |
| Campaign Room | 20, 12, 9, 6 | Terracotta/cream floor, artist wall, poster rails and content kiosk |
| Entrance | 11, 16, 8, 3 | Welcome mark, wayfinding and two planters |

Maintain a continuous east–west route and two routes around the central planting. Main doorways need two tiles of clearance. Collision follows walls and furniture bases, never the entire room rectangle. South-facing walls are cut away to reveal interiors.

## Coherent original art

Pixel-inspired cutaways use a 32-unit grid, small angular outlines, consistent top-left lighting and lower-right contact shadows. Each material has a small family of shades. Hoppaz's existing avatar remains recognisable.

Environment palette: dark outline `#282A31`, cream plaster `#EADFC4`, walnut `#9A7150`, wood shadow `#664B3F`, courtyard green `#7F9C79`, studio slate `#556E79`, ember `#F47945`, archive gold `#D8B468`. This is a provisional environment palette, not an official 360 Playlist brand guide.

Reusable assets include speakers, console sliders/knobs, record spines, acoustic panels, shelves, framed artwork, rugs, planters, lamps, benches, sofas, display cases and stage equipment. Props should have depth, seams, handles, cables and other small details. Keep walkways visually quiet. The initial banner typesets “360 PLAYLIST”; supplied brand artwork can replace it later.

## Interaction contract

Destination selected → walk along a valid route → arrival → relevant section panel. A new movement input cancels the previous route and its pending interaction. Floor clicks convert displayed pixels through camera scale into logical tiles. Unreachable targets explain the blockage.

The Studio says what the room is playing and holds the Music switch (the room loop itself plays through the app's music player). The Stage carries the crew's next event and links to its page. A map table by the entrance (`entry-map-table`) leads out to the main map. Prop ids are fixed (other features, such as a ticket hunt, find objects by id). The Stage shows campaign/event information. The Gallery contains verified award entries and sources. The Courtyard orients the visitor. The Lounge exposes configured records/playlists. The Campaign Room carries the brand story and destination link.

No invented tracks, artists, award winners, attendees, streams, tickets or live indicators. With no supplied content: “The next listening session is being prepared,” “The archive is being curated,” or “Campaign details will appear here.” Playback requires an explicit listener action and is local, not synchronised. Real ticket drops and shared player movement require separate server integration.

## Configuration boundaries

Separate geometry, visual theme, campaign content and visitor state. Content may include a brand name, welcome copy, valid music/campaign URLs and award records with source links. Local preview edits must clearly say they save only in this browser; they are not production host permissions or server persistence. Do not stretch furniture to simulate arbitrary map resizing.

## Review gates

- Each of the six sections is distinct at a glance, and the main banner is the strongest landmark.
- All interaction anchors are reachable from spawn and from one another; character feet cannot cross furniture or walls.
- Pointer movement remains accurate after camera movement and scaling.
- Mobile portrait has a readable follow camera, overview, accessible destination chooser and unscaled touch controls.
- Content panels leave room to explore. Keyboard movement does not run while typing, Escape closes dialogs and focus returns to the trigger.
- Every visible action works or explains its empty state. Reduced-motion preferences are honoured.
- Neighbourhood rooms, event discovery and the main map remain usable.
