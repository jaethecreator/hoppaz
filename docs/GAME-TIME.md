# Game Time

A ticket hunt inside a crew room. Staff hide 1 to 10 boxes (one per ticket code) in the objects of a
crew's room for a window of time. Crew members walk next to an object and press SEARCH. The first
finder of a box wins its code. This file is the contract between the database, the staff desk and the
room (the app). The server half is built: `supabase/game_time.sql`, the staff route
`src/app/api/admin/game-time/`, and `supabase/tests/game_time_test.sql`.

- [1. Load it and test it](#1-load-it-and-test-it)
- [2. The rules](#2-the-rules)
- [3. What can be read, and by whom](#3-what-can-be-read-and-by-whom)
- [4. The Hopper calls (the app)](#4-the-hopper-calls-the-app)
- [5. How the room learns a box was claimed](#5-how-the-room-learns-a-box-was-claimed)
- [6. The staff calls (SQL and HTTP)](#6-the-staff-calls-sql-and-http)
- [7. The opening push](#7-the-opening-push)
- [8. Run one on this Mac](#8-run-one-on-this-mac)
- [9. Decisions worth knowing](#9-decisions-worth-knowing)
- [10. The app](#10-the-app)
- [11. The Friday drop, for staff](#11-the-friday-drop-for-staff)
- [12. Reviewed and what is left](#12-reviewed-and-what-is-left)

## 1. Load it and test it

Run order: `schema.sql`, `chat_accounts.sql`, ... `play.sql`, `push.sql`, `crew_rooms.sql`, then
`game_time.sql`. It is additive and safe to run again, and it stops with a plain sentence if a file
before it is missing. Running `crew_rooms.sql` again later does not undo it (`crew_rooms.sql` only writes
its stand-in `_crew_room_hunt_busy` when the real one is missing).

```bash
docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < hoppaz/supabase/game_time.sql
docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < hoppaz/supabase/tests/game_time_test.sql
```

The test ends with `ALL GAME TIME TESTS PASSED` (about 10 seconds, 459 checks). Part 1 rolls back. Part 2
(50 Hoppers searching at the same moment) needs real parallel sessions, so it commits its own fixtures
(users `gtconc-NN@gametime.invalid` and a private crew named GT CONCURRENCY), starts the sessions with
psql's `\!` (which runs inside the database container, as the command above does) and removes them again.
If a run is killed half way, the next run clears the leftovers first.

pg_cron runs `game_time_tick()` every minute (job `hoppaz-game-time-tick`). Without pg_cron everything
still works: the opening push goes out when a Hopper loads the room or the ping, and boxes move on at the
next search. Only the exact minute is lost.

## 2. The rules

| | |
|---|---|
| Window | A game is **upcoming** until `opens_at`, **live** until `closes_at`, and **over** when every box is found (`all_found`), staff press CLOSE NOW (`closed`) or the time runs out (`time_up`). Two unfinished games of one crew never overlap. At most 7 days long. |
| A game never opens by accident | Staff say when (`opens_at`) or say `start_now: true`. Leaving the time out is refused. |
| Who | Members of the crew with an account whose email is **confirmed**. A guest (no email), an unconfirmed email and a non-member are refused. A game can also ask for members of at least `min_member_minutes` before it opens (default 0: any member); a Hopper who joined later can watch, not hunt. Both rules exist because one person with a handful of accounts cleared a 3-box hunt in 3.5 s. **Auth "Confirm email" must be ON in the project**: with it off Supabase stamps every email as confirmed at sign-up and the first rule does nothing. |
| Where | The server compares the searcher's **server-side presence tile** (`crew_room_presence`, written only by `crew_room_step`) with the object's rectangle. It must be within **one tile**, diagonals included (Chebyshev distance to the rectangle, 1 or less). No live walker (left, timed out after 45 s, or only watching a full room) means no search. |
| Pace | One counted search per account per 3 seconds, across every game. Every answer carries `retry_ms: 3000`; the app waits that long. The server floor is **2.5 s**, so a slow network that bunches two honest searches is not punished (`slow_down`, with the wait in ms in the error detail). A refused search does not use up the gap. |
| The answer | `nothing` with a `hint`, or a `win`. The hint is the distance from the searched object to the **nearest box nobody has found**, between object centres, in tiles: `hot` up to `hot_tiles` (5), `warm` up to `warm_tiles` (10), else `cold`. Staff can set both per game. |
| The win | An atomic first-finder claim: `update game_time_boxes set claimed_by = me ... where id = ... and claimed_by is null`, inside a per-game lock (never the crew room lock). The code is returned to the winner only. |
| The limit | One win per account per `campaign_key`. The default key is `crew:<crew id>`, so every Game Time of one crew shares one limit. Staff can set the same key on games of different crews to share a limit across them. A unique index (`campaign_key`, `user_id`) is the last line of defence. |
| Moving | An unfound box moves to another eligible object that holds no box after `relocate_minutes` (default 10; 0 means never), counted from the later of its last placement and the opening. It is checked on every search and by the tick. With no free object it stays and waits again. A found box never moves. |
| One box per object | At most one unfound box per object (a partial unique index). Every code needs its own object, so pick at least as many objects as codes. |
| The room under the game | The rectangles are copied from the room's layout when staff save the game. If the crew changes template or width afterwards, `room_ok` turns false, nobody can search, and staff save the objects again. While a game is scheduled or live the owner cannot resize or re-template the room (`hunt_in_progress`, from `crew_room_settings` and `crew_room_set_template`). |
| Eligible objects | The solid props of the crew's room template at its width, by prop id from `src/lib/campaign/templates.ts` (clubhouse: 35 of them). Never a rug (not solid), a wall (no id) or the door (`entry-map-table`, kind `maptable`: tapping it leaves for the map). The database checks the ids against `crew_room_layouts` again, so a caller that skips the staff route still cannot hide a box where none can be searched. |

Brand text: the crew's room brand is always shown as **360Playlist**, one word (`brand` in every answer),
whatever the staff typed.

## 3. What can be read, and by whom

Every game table has RLS on and **no grant to `anon` or `authenticated`**, with one exception.

| Table | Holds | Hoppers |
|---|---|---|
| `game_times` | the game, its window, campaign key, hint rings | closed |
| `game_time_spots` | the eligible objects and their tile rectangles | closed |
| `game_time_boxes` | one row per code: the **code**, where it hides **now**, who found it | closed |
| `game_time_wins` | who won which code | closed |
| `game_time_players` | search counters | closed |
| `game_time_rate` | the 3 second gap | closed |
| `game_time_feed` | what the room is told: "Ada found a box" (name, object it was found on, boxes left). No code, and never a box still hiding. | `select` for members of the crew only (RLS), and Realtime carries it |

Codes and hiding spots are therefore readable by the **service role only**. Every `_gt_*` helper, every
`admin_game_time_*` call and `game_time_tick` is closed to `anon` and `authenticated`. The test walks
every table, view (there are none) and function that touches these tables, as `anon` and `authenticated`,
and checks all of it, and that the answers a Hopper can get never hold an unfound code or a hiding spot.

## 4. The Hopper calls (the app)

All four are `rpc` calls with the Hopper's own session. All answers are JSON. A refusal is a Postgres
error: with supabase-js, `error.message` is the reason in the tables below, and `error.details` carries
the wait for `slow_down`.

### `game_time_state(p_crew uuid) -> jsonb`

For the room's HUD and the crew hub. `anon` may call it for an open crew. Returns `null` when the crew is
private and the caller is not in it. Call it on entering the room, then about every 2 seconds while the
game is live (every 10 to 15 s while it is upcoming, with a local countdown from `opens_at` against
`server_now`).

```json
{
  "server_now": "2026-10-14T22:45:44Z",
  "game": null,
  "me": { "member": true, "won": false, "code": null, "won_at": null, "blocked": null, "can_search": false }
}
```

`game` is `null` when the crew has nothing to show. Otherwise the game that is **live**, else the next one
opening within 48 hours, else the one that ended in the last 30 minutes (so the end state stays on screen):

```json
{
  "server_now": "...",
  "game": {
    "id": "uuid", "crew_id": "uuid", "crew_name": "360Playlist", "brand": "360Playlist",
    "title": "Find the box",
    "status": "upcoming | live | over",
    "over_reason": null,
    "opens_at": "...", "closes_at": "...", "ended_at": null,
    "boxes_total": 2, "boxes_left": 2,
    "search_gap_ms": 3000,
    "room_ok": true,
    "join_in_time": true,
    "objects": ["courtyard-fountain", "mixing-desk", "record-wall"],
    "feed_tail": 60,
    "found": [ { "id": 60, "at": "...", "name": "Ada", "object": "mixing-desk", "boxes_left": 1 } ]
  },
  "me": { "member": true, "won": false, "code": null, "won_at": null, "blocked": null, "can_search": true }
}
```

- `status`: `upcoming` (show GAME TIME and the countdown), `live`, or `over`. When `over`, `over_reason` is
  `all_found`, `closed` or `time_up`. `ended_at` is when it ended (`closes_at` for `time_up`).
- `objects`: **the eligible object ids, only while live, only for a member, and only when `room_ok`**.
  These are the objects that may hide a box (shimmer them softly, brighter when the walker is near). It
  says nothing about which holds a box. Get each object's rectangle from the room layout
  (`roomTemplate(template, width).props`) by id.
- `room_ok` false: the crew changed its room under the game. Show "Game Time is being reset"; searching is off.
- `found`: the last 10 finds, newest first (members only). `feed_tail` is the newest feed id.
- `me.won`: this account has won the game's **campaign** (not necessarily this game). `me.code` is
  filled only with **your own** code from **this** game. `me.can_search` is the server's view: member,
  has an account, live, `room_ok`, not already a winner, not blocked. It does not know the walker's tile; the app
  decides SEARCH from the tile. `me.blocked` is `need_confirmed` (the account's email was never confirmed) or
  `joined_late` (the game wants members from `min_member_minutes` before it opened), else `null`: the room tells a
  blocked member so, and lets them watch. `game.join_in_time` is false once joining the crew now would be too late
  for a members-only game (the hub and the ping say so to a newcomer).

### `game_time_list() -> jsonb`

For the global ping in `layout.tsx`. Games that start within 6 hours or are live, in crews the caller can
see (open crews, and their own), with a box left. At most 5.

```json
{ "server_now": "...", "games": [ {
  "id": "uuid", "crew_id": "uuid", "crew_name": "360Playlist", "brand": "360Playlist", "verified": true,
  "title": "Find the box", "status": "upcoming | live", "opens_at": "...", "closes_at": "...",
  "boxes_total": 2, "boxes_left": 2, "is_member": true, "blocked": null, "join_in_time": true, "won": false } ] }
```

`is_member` picks the button: ENTER ROOM, or JOIN AND HUNT (one tap: joins the open crew and walks in). `won` means the
Hopper has nothing left to hunt in that campaign. `blocked` (a member who cannot hunt) and a newcomer with
`join_in_time` false get no ping. Dismissal ("once per Game Time per device") is the app's, keyed by `id`.

### `game_time_search(p_crew uuid, p_object text) -> jsonb`

One search. `p_object` is a prop id from `objects`. The only way to learn anything about the boxes.

```json
{ "result": "nothing", "hint": "hot | warm | cold", "boxes_left": 2, "object": "courtyard-fountain", "feed_tail": 60, "retry_ms": 3000 }
{ "result": "win", "code": "TICKET-AAA", "game_id": "uuid", "title": "Find the box", "object": "mixing-desk",
  "boxes_left": 1, "game_over": false, "won_at": "...", "feed_tail": 61, "retry_ms": 3000 }
```

Play the 2 second search animation, then show the answer (NOTHING HERE with the hint, or the win sheet).
Send the call when the animation starts if you like; the answer is held for the reveal. Keep the SEARCH
button disabled until `retry_ms` after the call. The win sheet shows `code`, COPY, confetti, the reward
sound and a haptic. The code is also in `my_game_time_wins()` and `game_time_state().me.code`, so a lost
response (a dropped connection after the claim) loses nothing.

Errors (`error.message`):

| Reason | Meaning | What the room says |
|---|---|---|
| `need_account` | no session, or a guest without an email | sign up to hunt |
| `need_confirmed` | the account's email was never confirmed | CONFIRM YOUR EMAIL TO HUNT |
| `joined_late` | the game wants members from `min_member_minutes` before it opened, and this Hopper joined later | YOU JOINED TOO LATE. WATCH. |
| `not_in_crew` | not a member | JOIN THE CREW TO HUNT |
| `no_game` | the crew has no game to search | nothing is on |
| `not_open_yet` | upcoming | the countdown |
| `all_found` | every box is found | the end state |
| `game_closed` | staff closed it, or time ran out | the end state |
| `already_won` | this account already won this campaign | you have your ticket |
| `room_changed` | the crew changed its room; staff must save the objects again | Game Time is being reset |
| `not_in_room` | no live walker (left, timed out, or watching a full room) | walk into the room |
| `unknown_object` | not one of the game's `objects` | (a bug if it happens) |
| `too_far` | more than one tile from the object | step closer |
| `slow_down` | under 2.5 s since your last search; `error.details` is the wait in ms | wait, then press again |

A lock wait over 4 s (`55P03`, "canceling statement due to lock timeout") is possible only under an
extreme pile-up or while staff edit the game; treat it as "try again".

### `my_game_time_wins() -> jsonb`

For Me, "Your tickets". Newest first. Signed-in only.

```json
[ { "id": "uuid", "game_id": "uuid", "crew_id": "uuid", "title": "Find the box", "brand": "360Playlist", "code": "TICKET-AAA", "won_at": "..." } ]
```

## 5. How the room learns a box was claimed

- **The winner** learns from the search answer: `result: "win"` with the `code` (and `game_over: true` if
  it was the last box).
- **Everyone else** learns from the same data, two ways. Use both:
  1. **Realtime** (`postgres_changes`, table `game_time_feed`, event `INSERT`, filter
     `game_id=eq.<game id>`). RLS decides who gets each row, so only crew members do. The payload is
     `{ id, game_id, crew_id, name, object_id, boxes_left, at }`: toast "Ada found a box", drop the HUD
     count to `boxes_left`. When `boxes_left` is 0 the game is over: call `game_time_state` and show the end state.
  2. **Polling** `game_time_state` about every 2 seconds while live: `boxes_left`, `found`, `feed_tail`
     and `status` change within the poll, so the room is up to date within a couple of seconds even if Realtime is
     down. Compare `feed_tail` with the last id you saw to know you missed a find.
  A searcher who lost the race simply gets `nothing` (the box is gone), and the `feed_tail` in that answer
  tells the app to refresh at once.
- The box itself is never drawn, so "the box vanishes" means: the count drops, the toast shows, and when it
  was the last one the shimmer stops (`objects` is empty once the game is over).
- When staff press CLOSE NOW or the time runs out, `status` becomes `over` (`closed` or `time_up`) on the next poll.

## 6. The staff calls (SQL and HTTP)

The SQL calls are `security definer`, executable by the **service role only**. They answer
`{"ok": true, ...}` or `{"ok": false, "reason": "<reason>"}`. The HTTP route wraps them behind the same
staff token as the rest of the admin desk (`Authorization: Bearer $HOPPAZ_ADMIN_TOKEN`).

| SQL | HTTP (`/api/admin/game-time`) |
|---|---|
| `admin_game_time_create(p_args jsonb)` | `POST { "action": "create", ... }` |
| `admin_game_time_update(p_id uuid, p_patch jsonb)` | `POST { "action": "update", "id": ..., ... }` |
| `admin_game_time_start_now(p_id uuid)` | `POST { "action": "start_now", "id": ... }` |
| `admin_game_time_close(p_id uuid)` | `POST { "action": "close", "id": ... }` |
| `admin_game_time_status(p_id uuid)` | `GET ?id=<game>` |
| `admin_game_time_list()` | `GET` (also the crews, their rooms and each room's objects) |
| `admin_game_time_winners(p_id uuid default null)` | `GET ?winners=<game or all>` and `&format=csv` for the export |
| `game_time_tick()` | (pg_cron, every minute) |

**Create.** `{ crew_id, title (2 to 60), codes (1 to 10: an array, or codes_text with one per line),
min_member_minutes? (0 to 10080, default 0), silent? (true: no opening push, for a rehearsal),
objects (ids), start_now: true | opens_at, closes_at | duration_minutes (1 to 10080), relocate_minutes?
(0 to 720, default 10), campaign_key? (up to 80), hot_tiles? (default 5), warm_tiles? (default 10) }`.
The route turns the ids into rectangles from `templates.ts` for the crew's current room (falling back to
the clubhouse at 30 wide) and sends `room_template` and `room_width` with them. Times without a zone
(`2026-10-16T20:00`, what a datetime-local field gives) are **Lagos time**; times with `Z` or an offset are
taken as written. (That is the HTTP route; the SQL call takes a `timestamptz` and reads a zone-less string as UTC.) START NOW opens it this second and sends the push.

**Update.** Any of: `title`, `opens_at` (only before it opens), `closes_at` (later than now; a game whose
time ran out comes back when it is pushed past now), `relocate_minutes`, `hot_tiles`, `warm_tiles`,
`campaign_key` (until someone has won), `objects` (the rectangles are taken again from the room as it is
now; boxes on a removed object move to a free one), `codes` (until someone has won; the same codes again
change nothing). A finished game (all found, or closed) cannot change.

**Answers.** SQL: `{"ok": true, "game": {...}}` (`start_now` adds `started`, `close` adds `closed`). HTTP:
the same body with status 200, or `{ "ok": false, "error": "<reason>", "message": "<for staff>" }` with 400
(a field is wrong), 404 (`not_found`), 409 (`overlaps`, `ended`, `already_open`, `codes_locked`,
`campaign_locked`, `time_up`, `room_changed`), 401 (no or wrong token), 503 (not configured, or
`not_loaded` when `game_time.sql` has not been run).

`game` in the staff answers holds everything: `id, crew_id, crew_name, brand, title, status (upcoming | live | over),
phase (upcoming | live | all_found | closed | time_up), opens_at, closes_at, ended_at, campaign_key,
room_template, room_width, room_ok, relocate_minutes, hot_tiles, warm_tiles, push_sent_at, push_count,
min_member_minutes, push_ready, cron_ready (the minute tick is scheduled and on), room_capacity, boxes_total, boxes_left,
searches, searchers, claims, members, in_room, objects [{id,x,y,w,h}]`
and `boxes [{id, code, spot, placed_at, claimed_at, claimed_by, handle, name}]` (the list call leaves
`boxes` and `objects` out). That is the **live status**: who is in the room, how many searches, which box
sits where, who found what.

**Reasons** (create, update, start now, close): `bad_args`, `unknown_field`, `bad_crew`, `bad_title`,
`bad_times`, `in_past`, `too_long`, `bad_codes`, `dup_codes`, `bad_objects` (not a list of ids, or a
repeat), `unknown_objects` (not a hiding prop of this room), `not_enough_spots`, `bad_relocate`,
`bad_tiles`, `bad_campaign`, `bad_members`, `room_changed`, `overlaps`, `not_found`, `ended`, `time_up`, `already_open`
(also: changing `min_member_minutes` once it is open), `codes_locked`, `campaign_locked`.

**Winners.** `admin_game_time_winners` and the CSV: `game, crew, handle, name, email, code, object, won_at`, then the
facts that tell a real winner from one person with a few accounts, before a ticket is redeemed: `account_created,
email_confirmed, joined_crew, mins_joined_before_open, mins_account_before_open, searches, secs_after_open, flags`
(`flags`: LEFT THE CREW, JOINED AFTER OPENING, JOINED UNDER 30 MIN BEFORE, ACCOUNT UNDER 1 HOUR OLD, EMAIL NOT CONFIRMED).
Oldest first. The CSV defuses spreadsheet formulas (a cell that starts with `=`, `+`, `-` or `@` gets a
leading apostrophe).

## 7. The opening push

When a game opens, the crew's members who have a push subscription, whose alerts are not Off, who are not
walking in the room right now and have not already won the campaign get one push through the existing path:
the database posts to `/api/push/send` with the existing `PUSH_SEND_SECRET` (the `send_url` and `send_secret`
of `push_config`, `supabase/push.sql`). **No new secret.** Quiet hours (23:00 to 07:00 Lagos by default) are
respected: nothing is sent and the game is marked done, so nobody is woken at the tick after. It does not
spend the spot-alert quota.

> **GAME TIME in the 360Playlist room**
> 3 boxes are hiding. First to find one wins a ticket. Run!

The alert opens `/crew/<crew id>/room`, tag `game-time-<game id>`. It is sent once per game, never more than
10 minutes after `opens_at`, by START NOW at once, by `game_time_tick()` within a minute, or by any Hopper
loading `game_time_state` or `game_time_list` if cron is off. If the push path is not set up yet (no
`send_url` or secret, or no pg_net) nothing is sent and the game is not marked, so a later call inside the
10 minutes still can. The staff status shows `push_ready`, `push_sent_at` and `push_count`.

## 8. Run one on this Mac

The local 360 crew is `a06ba5fa-2847-4824-8a62-fe31437d01c7` (room `/crew/a06ba5fa-2847-4824-8a62-fe31437d01c7/room`).
The staff token is `HOPPAZ_ADMIN_TOKEN` in `.env.local`. With the dev server on port 3100:

```bash
set -a; . hoppaz/.env.local; set +a
curl -s localhost:3100/api/admin/game-time -H "authorization: Bearer $HOPPAZ_ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{
    "action": "create", "crew_id": "a06ba5fa-2847-4824-8a62-fe31437d01c7", "title": "Find the box",
    "start_now": true, "duration_minutes": 60, "relocate_minutes": 10,
    "codes_text": "TEST-ONE\nTEST-TWO\nTEST-THREE",
    "objects": ["mixing-desk", "courtyard-fountain", "record-wall", "artist-counter", "stage-console"] }'
```

In SQL (service role, or the `postgres` user in the container), the same thing is
`select public.admin_game_time_create('{...}')`, and the live board is
`select jsonb_pretty(public.admin_game_time_status('<game id>'))`. To see where the boxes hide while testing,
`select code, spot_id, claimed_by from game_time_boxes where game_id = '<game id>'`. To put a box where you
are standing, `update game_time_boxes set spot_id = 'mixing-desk' where game_id = '<game id>' and code = 'TEST-ONE'`
(keep one unfound box per object). CLOSE NOW: `{ "action": "close", "id": "<game id>" }`.

Do not create a game on a crew that real Hoppers are in without meaning to: START NOW pushes to its members.

## 9. Decisions worth knowing

- **The server floor is 2.5 s, the app paces at 3 s, on purpose.** "About one search per 3 s" holds for an honest client;
  the floor forgives network jitter on Lagos mobile data (the app counts its 3 s from when it SENDS, the server from when the
  call ARRIVES, so a slow first call and a quick second one can land 2 s apart). A modified client searching every 2.5 s is
  a small edge next to a pile of accounts, which the confirmed-email and joined-before rules answer. Change `_gt_gap()` to tighten it.
- **The door never hides a box**, because tapping it leaves the room (the action button would read the map,
  not SEARCH). It is excluded in both the route and the database.
- **One lock per game, not per room.** A search takes the game's advisory lock (`game-time:<id>`), never the
  crew room lock (`_crew_room_lock`), so a busy room's movement and chat never wait on a search, and a crowd of
  searches only waits on each other, a few milliseconds each. Staff create and re-save-objects take the room
  lock briefly, so a room cannot change while its hiding places are read.
- **A box that is overdue moves before the claim.** A search that arrives after `relocate_minutes` moves the
  box first, then looks, so a Hopper standing at the old object finds nothing.
- **No fabricated winners.** `claimed_by` and the win row are not foreign keys, so deleting an account never
  puts a found box back in play.
- **Staff codes never leave staff.** The codes are in `game_time_boxes` and the staff views only. The winner
  sees only their own code. Nothing else Hopper-facing has a `code` field for an unfound box.

## 10. The app

The Hopper side of all of the above, in the room, on the hub, in the global ping, on Me and on the staff desk. The look is
`docs/ROOM-GAME-DESIGN.md` section 13.

| Where | File | What it does |
|---|---|---|
| Calls | `src/lib/game-time/api.ts` | the four rpc calls; a refusal becomes a reason, a dropped connection is an answer too |
| Controller | `src/lib/game-time/controller.ts` | one poll and one Realtime channel for the room (2 s live, 12 s before it opens, 5 s in the last two minutes, 15 s with nothing on, a little jitter per phone, nothing in a hidden tab, one extra ask at `opens_at` minus half a second and just after), the one-at-a-time search with its 2 s animation and the server's `retry_ms`, the held finds so a Hopper is never told about their own win, and the lost-reply net: a poll that brings `me.code` when no win sheet has shown that code on this device (kept in localStorage per game and code) opens the sheet and clears the NO SIGNAL chip; offline and busy answers ask the database at once |
| Clock | `src/lib/game-time/clock.ts` | every countdown is `server_now` plus time passed on the phone (the shortest round trip wins), never the phone's clock |
| World layer | `src/components/game-time/GameTimeWorld.tsx` | the shimmer (an 18 px gold star with a dark edge and a halo on every object in `objects`, brighter near, a steady ring on the one SEARCH would pick, a soft pulsing outline round the whole object for the ten nearest (four on a weak phone), a bigger pulsing dot in the full view), a tap on a star walks next to its object, the search frame and dust, the win burst, the puff where someone else found a box |
| Hint chip | `src/components/game-time/HintLayer.tsx` | the answer to a search ("NOTHING HERE · WARM", or what went wrong), drawn in the screen layer over the object so a zone label never covers it; above the object, or under it when its top would meet the banner, the feed lines or the tip (it reads their real boxes); follows the object while the camera moves |
| Chrome layer | `src/components/game-time/GameTimeChrome.tsx` | runs the controller, registers the SEARCH pill (`gt-search`, priority 100, shown after 450 ms standing still within one tile, gone at two tiles), sets `huntActive` (live, or opening within 10 minutes) so the exits ask "Leave the hunt?", one tip card per Game Time per device: in the banner column for the first 20 s (or until the first search), so no zone card covers it, and it says what HOT and COLD mean |
| Banner, countdown, sheet | `Banner.tsx`, `Hype.tsx`, `WinSheet.tsx` | the HUD banner, the last ten seconds and GO, the full win sheet with COPY and confetti |
| Hub, ping, Me | `HubGameTime.tsx`, `GameTimePing.tsx` (mounted in `layout.tsx`), `YourTickets.tsx` | the hub card, the dismissible ping (once per Game Time per device, ENTER ROOM or the one-tap JOIN AND HUNT; none for a member who cannot hunt or a newcomer who would be too late), "Your tickets" |
| Staff desk | `src/components/admin/GameTimeSection.tsx` (mounted in `src/app/admin/page.tsx`) | the list (live first, then coming up, then ended), create (opens on SCHEDULE; START NOW asks twice; members-for-at-least minutes; the win limit on the form with how many Hoppers already used it; a REHEARSAL tick: own key, no push, any member), edit, CLOSE NOW, live status (every box, its code and where it hides, room cap, minute tick, push) and winner cards with the facts above, CSV export |

Where it differs from the design: the room store's action has no cooldown field, so the pill reads SEARCHING for the 2 s
animation and WAIT for the rest of the gap, instead of drawing a sweeping ring. The sticker on the fountain covers every
tile beside the fountain, so the floor cannot be tapped there: a tap on the fountain's star walks you next to it, and the
world layer is raised one step so the star draws over the sticker.

Rehearse it on this Mac: make a Game Time on the local crew (section 8) with `relocate_minutes: 0`, `silent: true` and a `campaign_key` of its
own (so test wins do not use up an account's real limit; on the desk that is the REHEARSAL tick), open the room as two crew members and walk
next to an object with the arrow keys. The finder's code and the box on each object are in `game_time_boxes` (service role).

## 11. The Friday drop, for staff

Read this before Friday 16 Oct. About 60 people, mostly on phones on Lagos mobile data.

**Once, on production, before Friday**

1. Supabase Auth, Providers, Email: **Confirm email ON**. With it off, the check that stops one person making a pile of
   accounts does nothing. Try a sign-up on the live app with it on first: a new Hopper must confirm before they can log in.
2. Load `supabase/game_time.sql` (additive, safe to run again) after `crew_rooms.sql` and `push.sql`. Then check
   `select jobname, active from cron.job where jobname = 'hoppaz-game-time-tick'` (pg_cron) and that pg_net and the push
   config exist. The desk says it for you: open any game's LIVE STATUS and read "Minute tick is running" and the push line.
3. Raise the room cap: `update crew_rooms set capacity = 120 where crew_id = '<360Playlist crew id>';` (default 60, staff only). A Hopper
   past the cap only watches. The desk warns when members outnumber the cap. Size the database compute up for the night.
4. The day before, rehearse with as many real phones as you can on the real project. Use the REHEARSAL tick (its own win
   limit, no push). A rehearsal on the real crew does not use up anybody's real win.
5. Tell people on WhatsApp: sign up, confirm your email, join the crew before the drop, be in the room at the time.

**Making the drop**

- Hunts with 60 phones end fast: the first box falls about 3 s after GO, the last of three about 7 s. Run **waves**: several
  one-code Game Times a few minutes apart (the room shows the next one as upcoming; overlapping windows are refused). Keep
  the Campaign key empty so one Hopper wins once across all the waves.
- Use SCHEDULE for the real thing: the room shows the countdown and the ten second GO. The opening push rides the minute tick
  and can be up to a minute late, so say "be in the room at 8:00 sharp". START NOW (press twice) opens it this second and pushes
  at once.
- Members for at least: 30 or more for the drop. The form opens on 30. Anyone who joined later can watch.
- With three boxes or more, set hot 3 and warm 6 (Hints), or HOT is the answer a third of the time. One box: 5 and 10.

**During and after**

- LIVE STATUS shows who is in the room, searches, which box is where and who found what. CLOSE NOW ends it.
- Before you hand over a ticket, read the winner card: handle, email, searches, seconds after the opening, how long before the
  opening they joined, account age, email confirmed, and the flags. Several winners with brand new accounts and the same kind
  of email is the sign. Void by not redeeming; EXPORT WINNERS gives the same facts as a CSV.

## 12. Reviewed and what is left

The Hopper-facing server held up under review (no code or hiding spot reaches a Hopper, the claim is atomic, the distance and
pace rules hold). Fixed after review: the many-accounts hole (confirmed email, joined-before, winner facts), the hint hidden
under the banner, a faint shimmer, an unreadable first tip, a win claimed on the server but never shown on the phone, a staff
desk that could open a hunt by accident and used up Friday eligibility, the plain-text join line, unexplained HOT and COLD, the
staff list order and narrow layout. Left on purpose or for later: a "starts in 5 minutes" push (staff say it on WhatsApp);
slimmer room step responses (about 11 KB per step, not this feature); the 2.5 s server floor (section 9); zone pop-ups that slide
under the banner (the room's, not this feature's); push inside quiet hours was checked in SQL only; audio, real iOS Safari and
real push delivery were not tested.
