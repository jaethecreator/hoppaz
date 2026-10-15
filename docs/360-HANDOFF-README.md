# Hoppaz / 360 Playlist: code handoff

Updated 14 October 2026. Working copy: `/Users/gg/hoppaz-scratch-1007`.

> **Status, 14 October 2026 (evening).** The 360 slice now lives on `jae/consolidate` (Ola's main plus small fixes), brought over from the snapshot `rooms/snapshot/rooms-2026-10-14` without the neighbourhood rooms or QA settings. The section 6 must-fixes are done, and the room is wired into the app (verified brand crews, two-tap join, invite links, the crew page as a hub, room music). `CREW-ROOMS.md` describes the room as it is now; where this handoff and that file differ, that file is current. Local database only.

This is the handoff for the work discussed and built in this chat. The current deliverable is a **crew-owned 360 Playlist room with shared avatars, general text chat and fixed conversation areas**. It works locally. It has not been deployed or tested at event-crowd scale.

Use this document to select the right code, review its limits and continue the implementation. It is not an instruction to publish every uncommitted change in this checkout.

## 1. What belongs in this release

The first release is the 360 Playlist music space attached to a crew. Keep it reusable for later brands and venue templates.

| Work discussed | Current state | Release decision |
| --- | --- | --- |
| 360 Playlist artwork, walking, camera and six sections | Built locally: Listening Studio, Stage, Awards Gallery, Courtyard, Record Lounge, Artist Corner | Include |
| Crew-owned rooms and shared avatars | Built; signed-in crew members enter from their crew card | Include |
| General crew chat and fixed conversation areas | Built and locally checked | Include |
| Shared owner settings | Built: brand, welcome copy, music/audio links, artist information, awards, compact/roomy width | Include |
| Event discovery strip and event-detail improvements | Separate local work; strip selection focuses an event on the main map | Hold separately |
| Four hotspot rooms | Local prototypes for Jibowu/Yaba, Lekki Phase 1, Adeola Odeku/VI and Allen/Ikeja | Hold separately |
| Other venue templates | National Theatre, Event Yard, Community Chapel and House Hangout prototypes | Hold separately |
| Scheduled boxes hidden in objects, first valid finder wins tickets | Discussed; no real campaign ticket hunt built | Next feature |
| Voice messages or live spatial voice | Discussed; not part of room text chat | Later feature |
| Suggested ₦5,000 room fee, payments, shop rentals | Monetisation ideas; no billing or paywall built | Later decision |

Earlier banner/hover experiments were rejected. Moving distance-based conversation groups were replaced by **fixed areas**. Do not reintroduce either as a requirement for this release.

The wider event/map work aimed to make events obvious to a newcomer while leaving the map visible. The neighbourhood concepts use a few recognisable places and streets, rather than a full city simulation. Keep those directions documented without bundling their implementation into the 360 release. Place details still need checking before public use; the room is an imagined layout, not a navigation map or an endorsement by the venue.

## 2. The agreed experience

1. A signed-in member opens a crew and chooses **Enter crew room**.
2. The member enters that crew's permanent room and sees other connected members.
3. **General** chat is available throughout the room, including inside conversation areas.
4. Walking into a marked area joins its conversation. Walking around inside it keeps the same conversation, even when participants are far apart.
5. Crossing the boundary stops new messages from that area. Adjacent areas do not share messages.

The four areas are **Listening Booth 1**, **Listening Booth 2**, **Courtyard Corner** and **Lounge Table**. The stage, entrance and main paths remain public. Boundaries, an active-area label and participants show who the conversation is with. Speech icons and the area list let members walk to a chosen area.

These areas are open to crew members. “Private” means messages exclude people outside the boundary; it does not mean the area is locked or invitation-only. Live voice is not connected.

Only members present in an area when a message is sent become its recipients. New arrivals cannot read earlier private messages. One remaining occupant keeps the session open; an empty area ends that session. Former recipients retain access to their received history while they remain crew members and are not blocked by its author, although the UI shows the current session.

Each area has a separate unsent draft. Leaving does not turn it into a General message. Returning to the same session restores it; using an old draft in a fresh session requires an explicit action. These drafts now live in a store above the room screen (`src/lib/crew-room/drafts.ts`), so an expiry, a rejoin or a second tab keeps them; a reload still starts clean.

The scene uses original SVG artwork aligned with Hoppaz's existing colours, fonts and avatar system. Gather/Dayroom informed the interaction and layout; this is not an integration with either service. Music starts through an explicit user action. Approved tracks, artist content and awards need to be supplied; defaults do not invent them. Playback is per browser, not a synchronised listening party.

## 3. Where the code lives

Paths below are relative to the repository root.

| Responsibility | Code |
| --- | --- |
| Authenticated crew-room route | `src/app/crew/[id]/room/page.tsx` |
| Crew-card entry | `src/app/crew/CrewPanel.tsx`: the crew page link and the “Enter crew room” action |
| Room shell, owner settings, music and section content | `src/components/campaign/CampaignExperience.tsx` |
| Original scene artwork | `src/components/campaign/ClubhouseArt.tsx` |
| Walking, camera, visible people and area boundaries | `src/components/campaign/CampaignWorld.tsx` |
| Geometry, collisions and four area definitions | `src/lib/campaign/layout.ts`, `geometry.ts` |
| Account gate and room/chat composition | `src/components/crew-room/CrewRoomScreen.tsx` |
| General/Area chat and drafts | `src/components/crew-room/CrewRoomChat.tsx` |
| Room connection, movement batches, heartbeat and message reads | `src/lib/crew-room/useCrewRoom.ts`, `types.ts` |
| Responsive presentation | Campaign and CrewRoom CSS modules |
| Tables, membership checks, movement validation, audience rules and owner RPCs | `supabase/crew_rooms.sql` |
| Server geometry export | `scripts/crew-room/export-layouts.mjs` |
| Checks | `scripts/rooms/check-campaign.mjs`, `scripts/crew-room/check-live.mjs`, `supabase/tests/crew_rooms_test.sql` |

Reuse existing `RequireAccount`, `useSession`, Supabase client, `Avatar`, avatar normalisation, chat `Bubble`/`ChatFace`, store and global styling. Do not rebuild those systems or copy the unrelated, modified chat Composer into this feature.

`package.json` is the stack source of truth: Next.js 16.4, React 19, TypeScript, Supabase, Tailwind and the existing Poppins/Archivo/DM Mono fonts. The older main README contains historical stack/feature descriptions that should not override the current code.

### One source of truth

```text
Campaign layout and privateAreas
          ↓ export-layouts.mjs
Server collision/area definitions
          ↓ validated room RPCs
Presence + area session + recipient records
          ↓ authorised reads / Realtime
Shared room and General/Area chat
```

Each crew owns one `crew_rooms` record. Presence tracks a member's session, position and movement sequence. The database checks adjacent walkable steps and decides the member's area. Private message recipients are stored when the message is sent; RLS protects both reads and Realtime delivery.

The database names `circle_id` and message scope `nearby` remain for compatibility. They now represent **fixed-area conversation sessions**, not moving proximity groups. Rename them only through a deliberate migration that preserves message history.

Existing event and crew-move chats remain unchanged. The new permanent crew-room channel has its own message store. It is not currently mirrored into the standalone Chat page; adding another view should read the same records, not duplicate messages.

## 4. Necessary integration and what to leave out

Include the campaign/crew-room modules, crew-room route, additive SQL, checks and documentation. Select only the room-entry changes from `CrewPanel` and the fullscreen crew-room handling from `BottomNav`.

The public `/room/chill-lounge` preview currently goes through `src/app/room/[slug]/page.tsx`, the generic room catalogue and `RoomExperience`. For an isolated 360 release, give the public campaign preview a direct wrapper around `CampaignExperience`; do not import all neighbourhood prototypes just to render it. The authenticated crew-room route already uses the dedicated crew-room screen.

Exclude the event/onboarding changes, whole main-map diff, neighbourhood catalogue, generic venue experiments, unrelated admin/privacy/legacy Play changes, hotspot SQL and existing voice scripts unless separately reviewed for another release. Preserve those files in the working copy; “exclude” does not mean delete someone else's work.

Also exclude the temporary `/dev/crew-room` harness, `.next-room-qa/`, QA-only Next/TypeScript configuration, `.env.local` and `/tmp/hoppaz-crew-room-qa.json`. The harness signs in isolated local test accounts; it is not the customer entry flow. The snapshot ZIP is a review bundle with shared dependencies, not a complete deployable application.

## 5. Run and verify

Start with the existing Hoppaz Supabase schema and account/chat migration. Then apply `supabase/crew_rooms.sql` to the intended local/staging database. No production database was changed during this chat.

When geometry or area boundaries change:

```bash
node scripts/crew-room/export-layouts.mjs
```

Apply the resulting SQL before testing the client. Client artwork and server boundaries must match.

```bash
npm run typecheck
node scripts/rooms/check-campaign.mjs
node scripts/crew-room/check-live.mjs
npx eslint src/components/campaign src/components/crew-room src/lib/campaign src/lib/crew-room
npm run build
```

The live check requires local Supabase credentials in `.env.local`, refuses a non-local database and creates/removes its own test accounts and crew. Do not run `--keep` again while another retained QA fixture set is in use. The separate `--cleanup` option removes that retained fixture set.

For the existing local Docker setup, the rollback-only SQL checks run as:

```bash
docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/crew_rooms_test.sql
```

Checked in the first chat: production build, typecheck, scoped lint, ten campaign/layout checks, SQL rules, three authenticated REST/Realtime clients, desktop/mobile room movement, private-area messaging, adjacent-area separation and draft separation during movement. Test success here is functional evidence, not a load test or production sign-off.

## 6. Focused code review: follow-up work

This is a review of this feature's implementation, not a full application security audit. The items below are source-based findings. The first four are fixed on `jae/consolidate` (14 October 2026); what was done is in the "Done" table after this one, and the behaviour is in `CREW-ROOMS.md`.

| Priority | Finding and evidence | Next action |
| --- | --- | --- |
| Before a public campaign | `_crew_room_reconcile` updates every presence row on each reconciliation, even when membership is unchanged (`supabase/crew_rooms.sql`, around line 93). Each crew's mutations also share an advisory lock. | Update only changed area memberships, reduce repeated full-room reconciliation, and measure lock wait and database writes under load. Keep audience decisions server-side. |
| Before a public campaign | Session expiry sets room status to error (`useCrewRoom.ts`, around lines 100–101). The screen then unmounts the chat (`CrewRoomScreen.tsx`, around line 32), whose drafts are local state. An unsent draft can therefore be lost on expiry/rejoin. | Move drafts above the error gate, keyed by crew and area, and test safe restoration without switching a private draft to General. Do not claim drafts survive reloads today. |
| Before increasing attendance | Presence expires after 15 seconds. Background/sleeping mobile tabs can miss heartbeats and need to rejoin. A second tab for the same member also replaces their session. | Test screen lock, backgrounding, network loss and two tabs. Define a recovery policy that retains drafts and does not keep inactive avatars falsely present. |
| Before long-running chat use | One shared query loads the latest 120 authorised messages across General and area sessions (`useCrewRoom.ts`, around line 69). A busy area can push General messages out of that fetched window. No older-history pagination is provided. | Fetch/paginate by conversation scope and session, preserving audience checks. |
| Before transferring/publishing | The public preview depends on generic room code, and the checkout contains mixed experiments plus QA configuration. | Extract a narrow release patch, review its imports and remove QA-only pieces from that patch. Do not publish the entire dirty checkout. |

Done on `jae/consolidate`, 14 October 2026:

| Finding | Fix | Checked by |
| --- | --- | --- |
| Reconcile writes every row | A walker's area is kept on the row by a trigger. The sweep runs only when someone went stale or left the crew, or a walker crossed an area boundary, and updates only rows whose area session changed. A heartbeat with nothing to sweep takes no room lock. Presence left the Realtime publication. | SQL test: a quiet heartbeat and an empty sweep leave other rows untouched (same tuple), and someone walking in leaves the people already there untouched. |
| Drafts lost on expiry | Drafts live above the gate, per crew and area. | Browser: a General draft survives a forced expiry and a takeover; the booth draft stays with the booth. |
| 15 s presence, silent second tab | 45 s presence, a 10 s heartbeat, a beat on return to the page, a keepalive leave on close, faded "away" peers after 25 s, an automatic rejoin when the session expired, `room_session_replaced` with a clear "open somewhere else" screen and a "took over" line in the new tab. | SQL test (30 s quiet still present, 45 s gone, takeover); live check (replaced); browser (expiry and takeover). |
| One shared 120-message window | Threads per conversation (General, each area session), 40 a page with older pages by time and id, new messages from the Realtime payload. | Live check (General apart from a busy area, two pages without overlap, the payload carries the whole message); browser (General both ways, area privacy). |
| No crowd limit | `crew_rooms.capacity` (60 by default, 90 for 360Playlist through `setup_360playlist.sql`; staff only), checked on entry; past it a member watches the room live with General chat and "Room is full, you're watching". | SQL test (cap kept, watcher General, no area, walks in when a spot opens); browser with the cap forced to 1. |

Keep the validated movement sequence, idempotent sends, owner-only settings, RLS audience checks and separate private drafts. Removing those to simplify the UI would weaken the working foundation.

## 7. Scale: what we know and what to test

**Verified scale: three authenticated test clients. No maximum room capacity has been established.** The 30×20 and 36×20 presets are scene dimensions, not attendance guarantees.

The client checks its movement queue every 200 ms, sends a heartbeat about once per second when stationary, reads room state roughly every 1.2–1.4 seconds and refreshes recent messages every three seconds. Realtime message inserts trigger additional reads. A moving client can issue up to approximately five movement RPCs per second.

Every member receives full-room presence snapshots. Reconciliation also touches the room's presence records. Traffic and database writes can therefore grow roughly with the square of occupancy, while the per-crew lock serialises mutations. This makes a large crowd claim premature, even though a small local test works.

Run staged tests at **10, 25, 50 and 100 members in one room**, then multiple crews simultaneously. These are test targets, not supported capacities. Mix stationary members, walking members and active chat; include entry/exit bursts and phone backgrounding.

Record movement/chat latency, errors, lock waits, database writes, payload sizes, browser frame rate and reconnect behaviour. Repeat privacy checks during movement, membership revocation and concurrent sends. Set an attendance cap from those measurements before announcing a public campaign. If full-room polling remains the bottleneck, introduce authenticated presence changes/deltas and bounded cleanup while keeping private text and reward decisions on the server.

## 8. Next features, in order

1. Extract the 360-only release, repair draft/session recovery and establish a measured pilot capacity.
2. Add approved 360 music, artist stories and awards; configure the actual campaign crew. This chat did not create a production brand crew.
3. Build the scheduled ticket hunt: campaign inventory, opening/closing time, approved hiding objects, per-account limits and an atomic server claim. Do not expose hiding answers before opening or remove GPS checks from existing geographical drops. The generic room's preview box animation awards no real ticket or XP.
4. Add voice notes to the same authorised conversations: record, preview/cancel, send and private playback. Live spatial voice is a separate transport feature.
5. Decide billing, room provisioning and optional locked areas after the core campaign flow has been validated.

Related documents: `CREW-ROOMS.md` (current room behaviour), `360-PLAYLIST-DESIGN.md` (art/layout brief), `360-RELEASE-SCOPE.md` (release boundary), `ROOMS.md` (separate neighbourhood/template prototypes).
