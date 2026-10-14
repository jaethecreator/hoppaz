# Crew rooms

A crew owns a walk-in room at `/crew/<crew id>/room`, built from the 360 Playlist clubhouse. The first one is the 360 Playlist brand crew; the same template serves every crew, brand, hotspot and event room after it. Updated 14 October 2026 on `jae/consolidate`. Local database only so far: nothing has been deployed and no production database has been changed.

## Ways in

| Where | What it does |
| --- | --- |
| Crew card (`/crew`, `CrewPanel.tsx`) | The crew name opens the crew page. ENTER CREW ROOM walks in. A verified brand crew has the lagoon tick. Open crews are listed with the tick and a JOIN button (verified first). |
| Crew page (`/crew/<id>`, `CrewHub.tsx`) | The hub: brand, tick, members, "N in the room now" with faces (every 15 s), ENTER ROOM, the owner's invite tools, the last three General messages (a tap opens the room with the chat open, `?chat=1`), and "Explore from here" tiles (below). Open crews can be looked at by anyone; a non-member gets JOIN AND WALK IN. |
| Invite link (`/crew/join/<code>`, `JoinCrew.tsx`) | The crew (name, tick, members, who is in the room now) and JOIN THE CREW. Signed in: one tap joins and lands in the room. A guest gets the usual sign-up sheet (Google first); the email form finishes the join right after, and Google returns to the page marked `?go=1`, which finishes it there. Share previews draw the crew card (`/api/og/crew/<code>`). |
| The room itself | A guest sees the account wall (Google first) and is back in the room once signed in. A signed-in Hopper who is not in the crew gets JOIN AND WALK IN (open crews) or an invite code box (private crews). |

Joining is at most two taps for a signed-in Hopper: JOIN on the open crew row, then ENTER CREW ROOM; or the crew name, then JOIN AND WALK IN; or one tap on the room gate or the invite page.

### Invite links

Each crew's `invite_code` (schema.sql, 10 hex digits) is its link. The owner sees it on the crew page with INVITE (the phone's share sheet, or the clipboard), COPY, and a new-link button (`crew_invite_reset`, owner only; the old link stops working at once, members stay). `crew_join_code(code)` needs an account, counts every try (10 in 10 minutes per Hopper, `crew_join_attempts`), answers a wrong code with `{ok: false, reason: "invalid_code"}` rather than an error (so the try still counts), and adds the membership once. `crew_card(crew, code)` is public: a member gets everything (with the code and recent General), anyone with the code or any open crew gets the card, anyone else gets null. Ola's `join_crew` (the code box on `/crew`) is unchanged.

### Explore from here

Tiles that lead out into the app: the crew's next events (live events whose title or venue has one of the crew's event words, the crew name when the owner set none; for 360 Playlist "360 Playlist, Dave") open the map on that event (`/?e=<id>`); when none match, the next big events of the week (by heat) stand in, labelled BIG THIS WEEK. The two nearest hotspots (from the Hopper's area or position, worked out on the phone) open Play on that hotspot (`/?hotspot=<slug>`). TONIGHT IN LAGOS opens the events deck (`/discover`). Other open crews, verified first, open their crew pages.

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
| Capacity | `crew_rooms.capacity` walkers, 60 by default, staff only, kept by the server on entry. Past it a member watches: the room stays live (everyone walking is shown), General chat works both ways, there is no avatar and no area chat, and "Room is full, you're watching" says so. A spot is tried for every 15 s and they walk in when one opens. |
| Drafts | Unsent text lives in a store above the room screen (`src/lib/crew-room/drafts.ts`), one per crew and conversation (`<crew>:general`, `<crew>:area:<area id>`). A session that expires, a rejoin, a takeover or a trip to the crew page keeps them. A private draft is never moved to General; a draft from an area's earlier session needs an explicit tap before it goes to the new one. Memory only: a reload starts clean, and nothing private is written to the phone. |
| Messages | General and each area session are separate threads, each read 40 at a time with "Earlier messages" for older pages (by time, then id, so a page boundary loses nothing). New messages are added from the Realtime payload (RLS decides who gets an area message); a small catch-up read every 20 s and after each send covers a dropped event. |
| Server writes | A heartbeat with nothing to sweep is one row update and takes no room lock. The room lock (one advisory lock per crew) is taken by moves, area sends, entering, leaving and settings, always before any row lock. The sweep (`_crew_room_reconcile`) runs only when someone went stale or left the crew, or a walker crossed an area boundary, and it writes only the rows whose area session changed. A walker's area is kept on the row by a trigger, so a sweep never works areas out again. Presence is no longer in the Realtime publication (it is polled): a heartbeat is not a Realtime event. |

What is still not measured: a room of 60 on real phones and a hosted database. Every client reads the room every 1.5 s while visible, and each read carries every walker (name, look, tile), so traffic grows with the square of the crowd. See "Before a big crowd" in `360-HANDOFF-README.md`.

## Files

| What | Where |
| --- | --- |
| Routes | `src/app/crew/[id]/page.tsx` (hub), `src/app/crew/[id]/room/page.tsx` (room), `src/app/crew/join/[code]/` (invite page and its share tags), `src/app/api/og/crew/[code]/route.tsx` (share card) |
| Room screens | `src/components/crew-room/CrewRoomScreen.tsx` (gate, join, takeover), `CrewRoomChat.tsx`, `CrewHub.tsx`, `JoinCrew.tsx`, `CrewRoom.module.css` |
| Scene | `src/components/campaign/` (`CampaignExperience`, `CampaignWorld`, `ClubhouseArt`, `RoomMusic`), `src/lib/campaign/layout.ts` |
| Data | `src/lib/crew-room/useCrewRoom.ts` (presence and threads), `drafts.ts`, `hub.ts` (crew card, crew events, share), `types.ts`; `src/lib/sound/roomTrack.ts` (what the room tells MusicHost) |
| Database | `supabase/crew_rooms.sql` (after schema.sql and chat_accounts.sql; safe to run again; replaces no chat, drop or hotspot function) |
| Checks | `supabase/tests/crew_rooms_test.sql` (rolls back, ends ALL CREW ROOM TESTS PASSED), `scripts/rooms/check-campaign.mjs` (layout and stable prop ids), `scripts/crew-room/check-live.mjs` (local REST and Realtime with fixture accounts) |
| Local data | `scripts/crew-room/seed-local.mjs` makes the verified, open "360 Playlist" crew owned by local test account A (reads `../localdb/test_users.env`, prints nothing secret) |
| Layout export | `node scripts/crew-room/export-layouts.mjs` writes the walkable grid of both widths into `crew_rooms.sql`; run it and apply the SQL whenever walls, props or areas move |

## Stable ids (Game Time)

Thursday's ticket hunt will hide boxes in room objects. Prop ids in `src/lib/campaign/layout.ts` are fixed: `scripts/rooms/check-campaign.mjs` fails if one is renamed or dropped in either width. The full list: mixing-desk, studio-speaker-l, studio-speaker-r, listening-chair-l, listening-chair-r, studio-plant, stage-console, stage-speaker-l, stage-speaker-r, gallery-display-1 to 3, gallery-plant, courtyard-tree-l, courtyard-tree-r, courtyard-fountain, courtyard-bench-l, courtyard-bench-r, courtyard-plant-l, courtyard-plant-r, record-wall, record-wall-r, record-rug, record-sofa-l, record-sofa-r, record-table, record-sofa-bottom, record-lamp, record-plant, artist-poster-1 to 3, artist-counter, artist-plant, entry-plant-l, entry-plant-r, entry-map-table. Zone ids (studio, stage, awards, courtyard, records, campaign) and area ids (booth-1, booth-2, courtyard-corner, lounge-table) are fixed too.

## Run it locally

```bash
docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/crew_rooms.sql
docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/crew_rooms_test.sql
node scripts/crew-room/seed-local.mjs
node scripts/rooms/check-campaign.mjs
node scripts/crew-room/check-live.mjs
```

`check-live.mjs` refuses a database that is not on this machine and removes its own accounts and crew; `--keep` retains them in `/tmp/hoppaz-crew-room-qa.json` for browser QA and `--cleanup` removes them. A default run never touches a kept set.
