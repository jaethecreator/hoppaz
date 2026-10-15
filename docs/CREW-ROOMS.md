# Crew rooms

A crew owns a walk-in room at `/crew/<crew id>/room`, built from the 360Playlist clubhouse template (more rooms later, see "Room templates"). The first one is the 360Playlist brand crew; the same template serves every crew, brand, hotspot and event room after it. Updated 14 October 2026 on `jae/consolidate`. Local database only so far: nothing has been deployed and no production database has been changed.

> Event rooms (theatre, pool party, outdoor party, indoor party, tech event) and one room per hotspot are built on this
> engine as "place rooms", not as crew templates: see [ROOM-TEMPLATES.md](ROOM-TEMPLATES.md). The crew picker still lists
> the clubhouse only.

## Ways in

| Where | What it does |
| --- | --- |
| Crew card (`/crew`, `CrewPanel.tsx`) | The crew name opens the crew page. ENTER CREW ROOM walks in. A verified brand crew has the lagoon tick. Open crews are listed with the tick and a JOIN button (verified first). |
| Crew page (`/crew/<id>`, `CrewHub.tsx`) | The hub, inside the app with its bottom nav (see "The hub"): a header that swipes through the crew's pictures, the name with the verified tick and the round logo, members, "N in the room now" with faces (every 15 s), ENTER ROOM and INVITE (a non-member gets JOIN AND WALK IN), the owner's MANAGE CREW, the fountain's featured event, the last three General messages (a tap opens the room with the chat open, `?chat=1`), and "Explore from here" tiles. Open crews can be looked at by anyone. |
| Invite link (`/crew/join/<code>`, `JoinCrew.tsx`) | The crew as its hub shows it (pictures, name, tick, logo, members, who is in the room now, the featured event) and JOIN THE CREW. Signed in: one tap joins and lands in the room. A guest gets the usual sign-up sheet (Google first); the email form finishes the join right after, and Google returns to the page marked `?go=1`, which finishes it there. Share previews draw the crew card (`/api/og/crew/<code>`). |
| The room itself | A guest sees the account wall (Google first) and is back in the room once signed in. A signed-in Hopper who is not in the crew gets JOIN AND WALK IN (open crews) or an invite code box (private crews). |

Joining is at most two taps for a signed-in Hopper: JOIN on the open crew row, then ENTER CREW ROOM; or the crew name, then JOIN AND WALK IN; or one tap on the room gate or the invite page.

### Invite links

Each crew's `invite_code` (schema.sql, 10 hex digits) is its link. Members get INVITE on the crew page (the phone's share sheet, or the clipboard). The owner also has the link in MANAGE CREW with SEND IT, COPY, and a new-link button (`crew_invite_reset`, owner only; the old link stops working at once, members stay). `crew_join_code(code)` needs an account, counts every try (10 in 10 minutes per Hopper, `crew_join_attempts`), answers a wrong code with `{ok: false, reason: "invalid_code"}` rather than an error (so the try still counts), and adds the membership once. `crew_card(crew, code)` is public: a member gets everything (with the code and recent General), anyone with the code or any open crew gets the card, anyone else gets null. Ola's `join_crew` (the code box on `/crew`) is unchanged.

### Explore from here

Tiles that lead out into the app. A crew's own featured event is not a tile: it has its own card above the chat. The tiles are: the crew's next events (live events whose title or venue has one of the crew's event words, the crew name when the owner set none; for 360Playlist "360Playlist, Dave") open the map on that event (`/?e=<id>`); when none match, the next big events of the week (by heat) stand in, labelled BIG THIS WEEK. The two nearest hotspots (from the Hopper's area or position, worked out on the phone) open that hotspot's sheet on the map (`/?hotspot=<slug>`; ENTER on the sheet opens the room). TONIGHT IN LAGOS opens the events deck (`/discover`). What people are going to this week (`room_rails().trending`, from `supabase/crew_rails.sql`; "THIS WEEK" with the day when nobody has said they are going yet) opens the map on the event too. Other open crews, verified first and with their round logo (`room_rails().crews`), open their crew pages. The odd tile at the end fills the row.

## The hub (`/crew/<id>`)

Mobile first, built for a phone on Lagos data, and inside the app: the bottom nav stays and the CREW tab stays lit. On a wide screen the page is one column, 760 px wide, centred. `CrewHub.tsx` holds the page, `HubHeader.tsx` the top of it (the invite page uses the same header).

- **Header carousel.** Up to 5 pictures from `crews.header_images`, swiped with the finger (scroll snap, so it is the phone's own scrolling), with dots under them (each dot is 44 x 44 to tap). It plays itself every 6 s (`AUTOPLAY_MS`), holds while a finger is on it and for one more turn after, holds when the page is hidden or the header is scrolled away, never plays with reduced motion, and a single picture is a still with no dots and no timer. With no pictures, or one that will not load, it shows the room's own art (`public/templates/clubhouse.jpg`). Only the first picture loads eagerly; the rest are lazy.
- **Name row.** Kicker (BRAND CREW, OPEN CREW or PRIVATE CREW), the name up to two lines (never cut to "360 Play..."), the verified tick, the member count, and the round logo (`crews.logo_url`) at the right end, half over the picture. A crew with no logo gets its first letter on the card colour.
- **The way in.** "N in the room now" with faces, then ENTER ROOM and INVITE for a member, JOIN AND WALK IN for someone outside an open crew (INVITE ONLY for a private one). The join button waits for the session to be up, so a tap never opens the sign-up sheet for someone who is already signed in.
- **Featured event.** The event on the room's fountain sticker with the owner's ribbon (`CrewHubFeatured.tsx`), opening the map on it. The ribbon is the only place "FREE" comes from: an event's price is 0 when the price is simply not known.
- **Owner only: MANAGE CREW** (`ManageCrew.tsx`), a panel over the hub (the nav stays). Every change saves at once and the hub behind it updates; one action at a time. **For launch only the featured event and the invite link show.** The picture upload, the logo and the template picker are behind `OWNER_UPLOADS` (`src/lib/crew-room/look.ts`, `NEXT_PUBLIC_CREW_OWNER_UPLOADS=1` at build time); the code is all there. Until then the header pictures are set from SQL (see `supabase/setup_360playlist.sql`).
  - *Header pictures.* ADD A PICTURE (up to 5, several at once), move earlier or later, remove. The phone shrinks each one to a JPEG no wider than 1080 px at quality about 0.72, squeezed further until it is under 2 MB, before it leaves the phone (`toJpeg` in `src/lib/crew-room/look.ts`), puts it in the crew-images bucket under `<crew id>/` and saves the list with `crew_update_look`. A removed picture is also taken out of the bucket.
  - *Logo.* A picture cropped to the middle square, 512 px.
  - *Featured event.* A search over the live events of the next six weeks, a radio list, the ribbon (up to 14 letters, capitals, quick picks FREE, SOLD OUT, TICKETS), a preview of the sticker, SAVE STICKER (`crew_room_set_featured`). "No featured event" clears both.
  - *Meeting room.* The template picker (`ROOM_TEMPLATES`, `src/lib/campaign/templates.ts`): the clubhouse is ticked and "More rooms soon" stands next to it. Choosing another walks everyone back to its entrance (`crew_room_set_template`), and waits while a Game Time is scheduled or live.
  - *Invite link.* Copy, send, make a new one.
  `/crew/<id>?manage=1` opens the panel straight away for the owner.

### The data and the calls

| What | Contract |
| --- | --- |
| `crews.logo_url`, `crews.header_images text[]` | The look. Written only by `crew_update_look`; the column grant stays name and visibility. A table check (`crews_look_valid`) holds even for a write that skips the call: each value is a PATH, never a link: `/brands/<file>.(jpg\|jpeg\|png\|webp)` or `/storage/v1/object/public/crew-images/<this crew's id>/<file>`, at most 5 pictures. A link to any host is refused, so an owner cannot point the logo at a server of their own; `src/lib/crew-room/images.ts` puts the app's own storage address in front of a bucket path, and draws nothing for anything else. A local stack and a hosted one both pass. |
| `crew_rooms.template` | The room template key (default `clubhouse`). A foreign key to `crew_room_layouts(template, width)` keeps it to templates that exist. |
| `crew_rooms.featured_event_id`, `crew_rooms.featured_ribbon` | The fountain's sticker. The event is a live event (`on delete set null`); the ribbon is up to 14 characters, no line breaks, empty by default. |
| `crew_update_look(p_crew, p_logo_url, p_header_images) returns jsonb` | Owner only. A null or empty logo clears it. Returns the crew's card. Errors: `owner_only`, `need_account`, `too_many_images`, `invalid_image`. |
| `crew_room_set_featured(p_crew, p_event, p_ribbon default '') returns jsonb` | Owner only. A null event clears the sticker and its ribbon. Returns the room snapshot. Errors: `owner_only`, `invalid_event` (not a live event), `invalid_ribbon`. Lives in `crew_rooms.sql` together with its columns, so it loads before and without `crew_rails.sql`; `add column if not exists` keeps a second definition harmless. |
| `crew_room_set_template(p_crew, p_template) returns jsonb` | Owner only. Errors: `owner_only`, `invalid_template`, `hunt_in_progress`. |
| `crew_card(p_crew, p_code)` | Public. `heads` (the faces in the room) carry the look for everyone, but a name and a user id only for the crew's own members; an outsider and the public key get an empty name and a place in the row. Adds to what it gave: `logo_url`, `header_images`, `template`, `featured_event_id`, `featured_ribbon`, `featured_event` (id, title, venue, area, starts_at, flyer_url; null when none or no longer live). Everyone who can see the card can see the featured event: it is a public event. |
| `_crew_room_snapshot` (every room call) | Carries `crew.logo_url`, `crew.owner_id`, `room.template`, `room.featured_event_id` and `room.featured_ribbon`. |
| `crew-images` bucket | Public read. Only the crew's owner writes: insert, list and delete a single file straight under `<crew id>/` (jpeg, png or webp only), 2 MB. File names are fresh per upload (no overwrite). A member cannot list or remove the owner's files. |

### Room templates

`src/lib/campaign/templates.ts` is the registry (key, name, one line, thumbnail, layout at a width). Every template needs stable unique prop ids, valid walls and a spawn, an `entry-map-table` door and a `courtyard-fountain` (`scripts/rooms/check-campaign.mjs` checks each one in both widths). Adding one: write its layout and art, add it to the registry, run `node scripts/crew-room/export-layouts.mjs` (it writes every template and width into `crew_rooms.sql`), load the SQL. `public/templates/clubhouse.jpg` is the picker card, drawn from the live room.

## The room

- Six sections (Listening Studio, The 360 Stage, Awards Gallery, The Courtyard, Record Lounge, Artist Corner), server-checked walking, shared avatars.
- **General** chat reaches the whole crew from anywhere in the room. **Area chat** belongs to four fixed areas: Listening Booth 1, Listening Booth 2, Courtyard Corner, Lounge Table. Walking in joins the area's conversation, moving inside keeps it, crossing the boundary stops new messages. Only people inside when a message is sent receive it; a new arrival cannot read what came before. An empty area ends its session. The database names `circle_id` and scope `nearby` mean "area session" and "area message".
- The **Stage** shows the crew's next event (by its event words) and links to its page. The **map table** by the entrance (prop `entry-map-table`) walks you to it and out to the main map.
- **Music.** The room plays a loop through the app's music player (`src/lib/sound/music.ts`, picked by `MusicHost`): the owner's "Room music loop" when they set one, otherwise the Play theme (day or night by the map's theme) as the room theme. It starts only on the first tap in the room, follows the Music switch (and Sound), and is quiet on the join gate. A loop the phone cannot play (its host refuses other sites, it is not audio, it is over 12 MB) is dropped for the visit and the theme plays. Low-tier phones get the menu loop. The bottom bar has the Music switch, and the Studio says what is playing. The main map outside Play stays silent, as before.
- **Owner settings** (shared with the crew): banner, welcome line, music link, room music loop, featured artist and story, awards, event words, compact or roomy width.
- **Verified.** `crews.verified` is staff only (service role or SQL: Hoppers may update a crew's name and visibility, nothing else). The tick shows on the crew card, the open crews list, the crew page, the invite page and card, and the room header.

## Holding up with a crowd

| | What happens |
| --- | --- |
| Presence | A walker beats every 10 s when standing still and stays for 45 s after the last beat, so a phone screen lock or a quick look at another app keeps the avatar. Someone quiet for 25 s shows faded with "away". Back on the page, the app beats at once: the same session carries on, or (gone over 45 s) it walks back in at the entrance, with drafts and messages kept. Closing the page leaves at once (a keepalive request), so nobody is left standing there. |
| Two tabs | One walker per Hopper. A second tab or phone takes it over and says so ("It's here now, and the other one has paused"); the first shows "This room is open somewhere else" with USE THE ROOM HERE. Nothing is lost either way. |
| Capacity | `crew_rooms.capacity` walkers, 60 by default (`setup_360playlist.sql` makes the 360Playlist room 90: about 60 people and the staff), staff only, kept by the server on entry. Arrivals land on the nearest free tile around the entrance out to four tiles, never touching the exit door, so a crowd does not pile on the spawn tile and the EXIT TO MAP pill (which also waits for the first step) is not the first thing anyone sees. Past it a member watches: the room stays live (everyone walking is shown), General chat works both ways, there is no avatar and no area chat, and "Room is full, you're watching" says so. A spot is tried for every 15 s and they walk in when one opens. |
| Drawing a crowd | A Hopper is an SVG of about 86 nodes, and 60 different ones handed to the browser at once froze a 4x throttled phone for 2 to 3 s right after the room opened. `src/components/campaign/spriteCache.ts` draws them one at a time instead: every Hopper shows at once as a flat blob in their own colours (one cheap node), and the real avatar is rasterised to a small PNG in a queue, me first and then nearest first, with a frame or an idle moment between each (a CPU canvas, `willReadFrequently`, because a GPU canvas costs a second or more of set-up on a slow phone). The open sequence's zoom waits up to 0.9 s for my avatar and the nearest six to be drawn, so it never zooms onto blobs, and the first sprite's one-off set-up is paid on the "Walking in" screen. A phone with 2 GB or less (or data saver) draws the nearest 30 Hoppers only. The static art is still vector (it carries the page's fonts), so the world art is not capped at a pixel ratio of 2: only the avatars are (their bitmaps are at most 2.4 to 3 times their CSS size). Measured on 58 distinct avatars at 4x CPU throttle on a real GPU backend: no main-thread task over 170 ms in the open sequence (before: 567 and 1633 ms, and one 2.7 s frame), and every Hopper drawn within about 3 s. Not measured on a real phone yet. |
| Drafts | Unsent text lives in a store above the room screen (`src/lib/crew-room/drafts.ts`), one per crew and conversation (`<crew>:general`, `<crew>:area:<area id>`). A session that expires, a rejoin, a takeover or a trip to the crew page keeps them. A private draft is never moved to General; a draft from an area's earlier session needs an explicit tap before it goes to the new one. Memory only: a reload starts clean, and nothing private is written to the phone. |
| Messages | General and each area session are separate threads, each read 40 at a time with "Earlier messages" for older pages (by time, then id, so a page boundary loses nothing). New messages are added from the Realtime payload (RLS decides who gets an area message); a small catch-up read every 20 s and after each send covers a dropped event. |
| Server writes | A heartbeat with nothing to sweep is one row update and takes no room lock. The room lock (one advisory lock per crew) is taken by moves, area sends, entering, leaving and settings, always before any row lock. The sweep (`_crew_room_reconcile`) runs only when someone went stale or left the crew, or a walker crossed an area boundary, and it writes only the rows whose area session changed. A walker's area is kept on the row by a trigger, so a sweep never works areas out again. Presence is no longer in the Realtime publication (it is polled): a heartbeat is not a Realtime event. |

What is still not measured: a room of 60 on real phones and a hosted database. Every client reads the room every 1.5 s while visible, and each read carries every walker (name, look, tile), so traffic grows with the square of the crowd. See "Before a big crowd" in `360-HANDOFF-README.md`.

## Files

| What | Where |
| --- | --- |
| Routes | `src/app/crew/[id]/page.tsx` (hub), `src/app/crew/[id]/room/page.tsx` (room), `src/app/crew/join/[code]/` (invite page and its share tags), `src/app/api/og/crew/[code]/route.tsx` (share card) |
| Room screens | `src/components/crew-room/CrewRoomScreen.tsx` (gate, join, takeover), `CrewRoomChat.tsx`, `CrewRoom.module.css` |
| Hub screens | `src/components/crew-room/CrewHub.tsx` (the page), `HubHeader.tsx` and `HubHeader.module.css` (carousel, name row, logo), `ManageCrew.tsx` (the owner's panel), `CrewHubFeatured.tsx`, `CrewHubNow.tsx`, `JoinCrew.tsx` (invite page) |
| Scene | `src/components/campaign/` (`CampaignExperience`, `CampaignWorld`, `ClubhouseArt`, `RoomMusic`), `src/lib/campaign/layout.ts` |
| Data | `src/lib/crew-room/useCrewRoom.ts` (presence and threads), `drafts.ts`, `hub.ts` (crew card, crew events, rails, share), `look.ts` (shrink and upload pictures, the owner calls, their error lines), `types.ts`; `src/lib/sound/roomTrack.ts` (what the room tells MusicHost) |
| Database | `supabase/crew_rooms.sql` (after schema.sql and chat_accounts.sql; safe to run again; replaces no chat, drop or hotspot function) |
| Rails | `supabase/crew_rails.sql` (`room_rails`: other crews and what is trending, read by the hub and the room) |
| Checks | `supabase/tests/crew_rooms_test.sql` (rolls back, ends ALL CREW ROOM TESTS PASSED), `scripts/rooms/check-campaign.mjs` (layout, stable prop ids, every template; loaded through `scripts/rooms/load-campaign.mjs`), `scripts/crew-room/check-live.mjs` (local REST and Realtime with fixture accounts) |
| Local data | `scripts/crew-room/seed-local.mjs` makes the verified, open "360Playlist" crew owned by local test account A, with the logo (`public/brands/360playlist.jpg`), two header pictures in the bucket (the Dave flyer on its own blurred backdrop, and the room from above) and the Dave event on the fountain with a FREE ribbon. It renames the crew made under the old two-word spelling, fills in only what is missing, and never replaces what the owner set later (`--reset-look` draws the two pictures again). Reads `../localdb/test_users.env`, prints nothing secret. |
| Layout export | `node scripts/crew-room/export-layouts.mjs` writes the walkable grid of both widths into `crew_rooms.sql`; run it and apply the SQL whenever walls, props or areas move |

## Stable ids (Game Time)

Thursday's ticket hunt will hide boxes in room objects. Prop ids in `src/lib/campaign/layout.ts` are fixed: `scripts/rooms/check-campaign.mjs` fails if one is renamed or dropped in either width. The full list: mixing-desk, studio-speaker-l, studio-speaker-r, listening-chair-l, listening-chair-r, studio-plant, stage-console, stage-speaker-l, stage-speaker-r, gallery-display-1 to 3, gallery-plant, courtyard-tree-l, courtyard-tree-r, courtyard-fountain, courtyard-bench-l, courtyard-bench-r, courtyard-plant-l, courtyard-plant-r, record-wall, record-wall-r, record-rug, record-sofa-l, record-sofa-r, record-table, record-sofa-bottom, record-lamp, record-plant, artist-poster-1 to 3, artist-counter, artist-plant, entry-plant-l, entry-plant-r, entry-map-table. Zone ids (studio, stage, awards, courtyard, records, campaign) and area ids (booth-1, booth-2, courtyard-corner, lounge-table) are fixed too.

## Run it locally

```bash
docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/crew_rooms.sql
docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/crew_rooms_test.sql
docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/crew_rails.sql
node scripts/crew-room/seed-local.mjs
node scripts/rooms/check-campaign.mjs
node scripts/crew-room/check-live.mjs
```

`check-live.mjs` refuses a database that is not on this machine and removes its own accounts and crew; `--keep` retains them in `/tmp/hoppaz-crew-room-qa.json` for browser QA and `--cleanup` removes them. A default run never touches a kept set.
