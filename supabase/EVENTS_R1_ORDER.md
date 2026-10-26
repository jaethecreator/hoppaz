# Release 1 database drafts: how to run them (for Ola)

DRAFT FOR OLA, NOT RUN ON PRODUCTION. Six new SQL files, each with a test file. They are drafts written from the fake data layer
(`src/lib/events-r1/fake/`), which is the executable spec of the rules. Nothing here edits an older SQL file or an existing function. Every
name is new (`ev_` for tables and functions, `_ev_` for helpers). You review them and you run them; nobody else touches production.

The six files and their tests (plus `tests/events_r1_leaks_test.sql`, the leak checks) have been run against a throwaway database in the local
Docker Postgres (`hoppaz_ev_*`, never `postgres`, never production): loaded twice in the order below, then every test passes. The first local
run found two mistakes in the test helpers (fixed) and one in `events_r1_reports.sql` (the service role could execute `ev_report_event`; fixed). Nothing
has run on production or any remote database; that is yours to do (section 1, then the secret step in section 2).

## 1. Run order

Older files first (in the order of `localdb/README.md`, then the ones the new files need):

1. `schema.sql`, `chat_accounts.sql`, then the rest of the local list (`hunt_items`, `spawning`, `daily_box`, `seed`, ..., `hotspots`).
2. `crew_rooms.sql` (and whatever it asks for, `crew_rails.sql`, `crew_reactions.sql`, `game_time.sql`), then `crew_announcements.sql`.
3. `starter_quests.sql`, if you use it. Before or after the new files, either way (see question 6).

Then the new files, in this order, each one once (they are safe to run again):

| # | File | Needs from the older files | Needs from the new files |
|---|---|---|---|
| 1 | `events_r1_events.sql` | `events`, `areas`, `profiles`, `checkins`, `swipes`, `crews`, `crew_members`, `has_account()`, the trigger `force_pending_on_insert` | nothing |
| 2 | `events_r1_registrations.sql` | as file 1 | file 1 |
| 3 | `events_r1_tickets.sql` | pgcrypto (from `schema.sql`) | files 1 and 2 |
| 4 | `events_r1_pops.sql` | `crew_announcements` (the table) | files 1 and 2 |
| 5 | `events_r1_reports.sql` | as file 1 | file 1 |
| 7 | `events_r1_pay.sql` | all six new files; `auth.users` | files 1 to 6 (see `EVENTS_R1_PAY.md`) |
| 6 | `events_r1_rooms.sql` | `crews`, `crew_members`, `crew_rooms`, `crew_announcement_seen`, `crew_announcement_seen()` | files 1, 2 and 4 |
| 8 | `events_r1_covers.sql` | `crew_rooms.sql` (the public `crew-images` bucket), `chat_accounts.sql` (`has_account()`) | nothing, but run it after file 1: a cover link is saved through `ev_create_event` / `ev_update_event` (see 2d) |
| 9 | `events_r1_pay_collect.sql` | `events_r1_pay.sql` | file 7 (Hoppaz collects: replaces six payment functions, adds `ev_orders.buyer_pays_fee`; see `EVENTS_R1_PAY.md`) |
| 10 | `events_r1_payouts.sql` | `events_r1_pay_collect.sql` | file 9 (host balances and withdrawals) |

Files 1 and 2 leave small stubs for functions that later files fill in (the going count, the waitlist fill, the ticket issue and void,
the HQ test). A stub is written only when the real function is missing, so running a file again never puts a stub back over the real one.
Running the older files again later (even `schema.sql`) does not undo anything here: the new status check, the new trigger, the new
columns and the new functions are not touched by them.

## 2. The one-time secret step (tickets)

The QR is signed with a secret that is not in the repo. Before any ticket can be shown, run this once in the SQL editor, with a long random
value of your own (for example the output of `openssl rand -hex 32`):

```sql
select public.ev_set_ticket_secret('<at least 32 random characters>');   -- answers ok
```

It answers `already_set` if one exists; pass `true` as the second argument only to rotate it on purpose (every QR issued before then stops
verifying). Until it is set, `ev_my_ticket` raises `ticket_secret_missing` and `ev_scan` answers `no_secret`. The secret lives in the closed
table `ev_ticket_secret`; no signed-in user can read it or set it.

## 2a. Paid tickets on Bachs (file 7)

`events_r1_pay.sql` adds host Bachs accounts (`ev_host_payouts`), orders (`ev_orders`), refunds (`ev_refunds`) and the webhook dedupe table
(`ev_bachs_events`), with the service-role functions the Next.js route handlers call and six client functions. The exact signatures, result shapes,
the order state machine and the environment variable names are in `supabase/EVENTS_R1_PAY.md`. It changes three earlier files (all drafts): a paid
purchase is ONE registration with `quantity` N and N tickets (`ev_tickets` has one row per seat, `ev_registrations.quantity`), open orders hold
seats against the type and event capacity, door counts count tickets, `ev_register` answers `use_checkout` for a paid type, `ev_cancel_registration`
answers `paid_use_refund` for a paid registration, and a paid type needs the host's `can_sell` (`payouts_not_ready`). Paid tickets stay off until
`select public.ev_set_setting('paid_tickets','on')`. No Bachs call is made by any SQL; Ola's routes must do those and verify the webhook signature.

## 2b. Ticket types and the paid switch

Every event has 1 to 5 ticket types (name, price in whole naira, capacity), in the closed table `ev_ticket_types`, made by `events_r1_events.sql`
(`ev_create_event` gives each new event one free General with no limit). Registrations and tickets carry `ticket_type_id`; the ticket and the door
card show the type's name; a type's places are counted on going and checked-in people holding it AND the event's capacity (spots_left is the
tighter), the waitlist moves up per type (a full type is skipped), and an edit cannot drop a type people hold (`ticket_in_use`). Old events are
NOT backfilled: they read as one derived FREE General (an old listing's `events.price_naira` is its listed door price, information for the old TICKETS link, never a ticket price; nothing paid is ever sold for an event with no `host_id`: `no_host`), and the real row is made at their first registration.

Paid is off. `ev_create_event`, `ev_update_event` (when it is sent a tickets list) and `ev_clone_event` refuse any type with a price above 0 with
exactly the text `currently_unavailable`, until Ola turns the setting on. The setting is the row `paid_tickets` of the closed table `ev_settings`
(key, value), `off` at first; a re-run of the file never flips it. Only the service role and the SQL editor can change it:

```sql
select public.ev_set_setting('paid_tickets', 'on');    -- or 'off'; answers ok, bad_key or bad_value
```

With it on, a paid type also needs a host whose Bachs account can sell (`payouts_not_ready`), and `ev_register` on a paid type answers `use_checkout` (paid orders go
through `events_r1_pay.sql`). (Clone also refuses a paid type while the setting is off; the fake layer copies it.) `ev_export` gained a Ticket column, so the file drops and recreates that one function.

## 2c. THE LAUNCH SWITCH (`events_r1`): run this at launch

Running the SQL does NOT turn Release 1 on. The row `events_r1` of `ev_settings` is `off` (a re-run of any file never flips it) and, while it is off, every WRITE a normal user can call answers `not_open` and changes nothing: `ev_create_event`, `ev_update_event`, `ev_cancel_event`, `ev_clone_event`, `ev_register`, `ev_cancel_registration`, `ev_decide`, `ev_promote`, `ev_set_registration_settings`, `ev_send_pop`, `ev_cancel_pop`, `ev_set_auto_pop`, `ev_edit_auto_pop`, `ev_report_event`, `ev_set_door_staff`, `ev_set_room_3d`, `ev_pay_mark_manual_refund`, and the server-side `ev_pay_order_reserve`. `ev_ensure_hq` makes and joins nothing for a signed-in person, `ev_room_mark_read` does nothing, `ev_my_tickets` makes no new ticket, and `ev_dispatch_due_pops` sends nothing. Reads (lists, event pages, the Audience, the Roomz list) keep working. The door (`ev_scan`, `ev_checkin_manual`, counts) is deliberately NOT switched: a ticket already sold must still scan. Payments, webhooks, refunds and the staff desk (service role only) are not switched either: money that moved is always settled.

```sql
select public.ev_set_setting('events_r1', 'on');    -- at launch; 'off' is the emergency stop. Answers ok, bad_key or bad_value.
```

Only the service role and the SQL editor can run it. Separately, an event with no `host_id` (the old curated and /drop listings) can be edited or cancelled by staff only: the Hopper who dropped it is not its host. The text of `not_open` in the app is "Not open yet".

## 2d. Event cover pictures (file 8)

**Local stack only:** the local Supabase serves storage on http://127.0.0.1, so on a laptop run `select public.ev_set_setting('local_http_covers','on');` once. Never on production: there only https cover links are accepted.

`events_r1_covers.sql` lets a host with an account upload a cover to the existing public `crew-images` bucket, in their own folder: `event-covers/<user id>/<file>.jpg` (2 MB, jpeg, png or webp: the bucket's own limits, unchanged). It adds three storage policies (`events_r1_cover_upload`, `_read`, `_remove`) and one helper (`_ev_cover_path_owner`); the older crew picture policies only match a file straight under a crew id, so they are not touched. The app keeps the full public link as `cover_url` (saved as `flyer_url`), because every card, the map and the share card use `flyer_url` as an image address as is. `events_r1_events.sql` changed in one line: the cover check in `_ev_create_core` also accepts a plain `http://localhost` or `http://127.0.0.1` link into `/storage/v1/object/public/` (the local stack serves storage on http); any other plain http link is still `bad_cover`. Cover files are not removed when an event is deleted or the account is deleted (`/api/account/delete` clears `event-photos` and `chat-images`, not this folder). Test: `tests/events_r1_covers_test.sql`.

## 3. The cron line (Pops)

`ev_dispatch_due_pops()` makes the automatic Pops (day before, 1 hour before, doors open) when they are due and sends the scheduled ones. It
is meant to run every minute. No file schedules it. When you are ready, once:

```sql
select cron.schedule('hoppaz-ev-pops', '* * * * *', 'select public.ev_dispatch_due_pops()');
```

It needs pg_cron (Supabase, Database, Extensions). It only writes rows and copies announcements into rooms; it does not deliver a push or
an email. `ev_pop_recipient_ids(pop)` (service role) lists who a Pop is for, for whatever delivers it.

## 4. What the front end calls (interface to SQL)

Write functions answer `{ ok: true, ... }` or `{ ok: false, reason: '<code>' }` (or a short text code, listed in each file's header)
instead of throwing, as `claim_quest` and the Game Time staff calls do. The real layer turns a reason into the fake layer's message.

| Fake layer method | SQL |
|---|---|
| events.list / get / listMine / listForRoom | `ev_list_events` / `ev_get_event` / `ev_my_events` / `ev_room_events` |
| events.create / update / clone / cancel (draft.tickets = the ticket types) | `ev_create_event` / `ev_update_event` / `ev_clone_event` / `ev_cancel_event` |
| events.setInterested | the existing swipes (untouched) |
| events.viewerState | `ev_viewer_state` |
| events.get/setRegistrationSettings | `ev_get_registration_settings` / `ev_set_registration_settings` |
| registrations.register (opts.ticketTypeId) / cancel | `ev_register` / `ev_cancel_registration` |
| registrations.list / approve / decline / promote / exportCsv | `ev_audience` / `ev_decide` / `ev_decide` / `ev_promote` / `ev_export` (rows) |
| registrations.ticketFor | `ev_my_ticket` |
| pops.listForEvent / visibleOnEvent / send | `ev_host_pops` / `ev_event_pops` / `ev_send_pop` |
| rooms.list / get / eventChat | `ev_rooms_for_me` / `ev_room` / `ev_event_chat` |
| rooms.setThreeD / listForStaff | `ev_set_room_3d` (owner or staff, answers `ok` or a reason) / `ev_admin_rooms` (staff, null for anyone else) |
| rooms.announcements / markRead | `ev_room_announcements` / `ev_room_mark_read` |
| rooms.create / join / postAnnouncement | the existing `create_crew` / `join_crew` / `crew_announce` (untouched) |
| door.scan / confirm / search / checkInById / counts | `ev_scan` (mode standard, express, confirm) / `ev_scan` / `ev_door_search` / `ev_checkin_manual` / `ev_door_counts` |
| (new, for the offline scan) | `ev_valid_tickets` |
| reports.report | `ev_report_event` |
| reports.list / markReviewed | `ev_admin_reports` / `ev_admin_review_report`, service role only, through a new admin route (like `src/app/api/admin/game-time/route.ts`) |

## 5. Questions for Ola

1. **Pops overlap.** You are already writing Pops. `events_r1_pops.sql` exists only as the shape the front end expects. Keep yours if it does
   the same, and make it return the shapes in that file's header (or tell us what differs). Do not run both. Also: the copy into a room is a
   plain row in `crew_announcements`, which uses up the owner's 2 announcements a day in `crew_announce`; is that fine, or should
   `crew_announce` skip rows that have a link in `ev_announcement_event`?
2. **The trigger choice.** `ev_create_event` inserts a row (your `force_pending_on_insert` makes it pending) and then, in the same
   function and transaction, updates that one row to live. Nothing of yours is edited or switched off. Is that acceptable, or would you rather
   the trigger learned a "published by ev_create_event" rule?
3. **HQ capacity.** Lagos HQ is a crew pointed to by `ev_hq`, with `crew_rooms.capacity` 500 (the most the check allows). The cap only
   limits walkers in the 3D room, not members and not General chat, so chat first never meets it. What should the 3D room do when HQ
   is big? Also, every General message reaches every member with the room open: look at the realtime load before HQ is large. If you
   would rather make HQ by hand, make a verified crew named `Lagos HQ`: `ev_ensure_hq()` adopts it. HQ needs one staff account to own it.
4. **Email sender.** The email code sign-in (six digits, no password) and the sender are yours (Supabase Auth, mail provider). Nothing in
   these files sends email. Which sender and domain will it be, and when can the front end test the code step for real?
5. **Leak check on the events read policy.** `events_read_live` lets anyone with the anon key read every column of every live event. So
   the online link is NOT a column (it is in the closed table `ev_event_links`), and live-but-not-public events (community, invite only) are
   stored with the new status `unlisted`, which the policy, `events_near`, `events_deck`, `claim_checkin` and `/api/public/events` all ignore. Is
   an extra status value OK with you? The alternative is to edit those readers to look at `visibility`.
6. **Starter quests.** `starter_quests_on_event` gives every live event a check-in quest titled `'Check in at ' || venue_name`. Events with no
   place store the placeholder `Online` or `To be announced` in `venue_name` so that title is never null (a null would stop every online event
   from publishing). The kit's check-in quest is then pointless for them. Suggested change on your side: add `and new.geog is not null` to that trigger.
7. **No place on the old screens.** `geog` and `venue_name` may be empty now. `events_near` drops such events; `events_deck` would return them with
   null lat and lng. Add `and e.geog is not null` there?
8. **Chat messages and registrations.** `in_room` still decides who can post in an event channel from check-ins and swipes. To make event chat
   follow registrations, give `in_room` an event branch that calls `_ev_chat_can_enter(event, user)` and make `room_closes_at` use the same
   close time (end + 3 days; it uses end or start + 8 hours). That edit is yours.
9. **Waitlisted people and the chat.** The fake layer lets a waitlisted person into the event chat when approval is off; the SQL lets in people
   who are going only (framework doc rule 10). Which do you want?
10. **Invite only events in the host's own list.** `ev_list_events` shows a host their own invite events (as the fake layer does); nobody else
    ever sees them. Say if the host should not see them there either.
11. **Reports.** Three open reports from three different accounts that are MORE THAN 7 DAYS OLD (`auth.users.created_at`; guests cannot report) hide an
    event from the lists until staff look. Never auto-hidden: an event with no host (an old listing) or with a paid order (staff only). A hidden event's
    door still works (scan, manual check in, counts): hidden is for the lists only. Three week-old accounts can still hide a free event; raise the number if
    that worries you. Staff still use the shared token; named staff and an audit log are Release 2 (money).
12. **Door staff.** `ev_set_door_staff` lets a host add up to 20 helpers who can scan and search names and emails. The fake layer has no such
    thing yet. Keep it, or host and staff only for Release 1?
13. **pg_cron and the Pops delivery.** Is pg_cron on, and who delivers the push for a Pop (the web push route exists; email does not)?

14. **Paid tickets switch.** `paid_tickets` lives in `ev_settings` and only you set it, with `ev_set_setting`. Is a SQL-editor statement enough, or do you want
    it behind the admin route too? And in Release 2, should the switch stay as a global kill switch?

## 5a. The room is called Lagos HQ, and the 3D room switch (one change for Ola)

**Lagos HQ.** The home room is now named Lagos HQ (it was Hoppaz HQ). `ev_ensure_hq()` makes a crew named `Lagos HQ`; it adopts a verified crew already named `Lagos HQ`, or one still named `Hoppaz HQ` (and renames it, and the room's brand line, to `Lagos HQ`); a pointed-to crew still named `Hoppaz HQ` is renamed the next time the function runs. It starts fresh: no hotspot message is moved into it. Code names are unchanged (`kind` `hq`, slug `hq`, the `ev_hq` table).

**3D room switch.** The owner of a room (the `crew_members` row with role `owner`) and staff (`profiles.is_admin`) switch the walkable 3D room on or off. Off means chat only (Announcements, General, event chats) and the app hides "Enter room". All in `events_r1_rooms.sql` (no new file, so no new run order step):

- table `ev_room_settings` (room_id primary key, three_d_on, updated_by, updated_at), closed like the other `ev_` tables;
- `ev_set_room_3d(room, on)` answers `ok`, `need_account`, `bad_value`, `not_allowed` or `not_found`; owner or staff only;
- `ev_room_3d_allowed(room)` answers whether it is on: a saved switch wins; with none it is on for a room with a layout (every crew has one: the room is made on first entry from the default template) and on for Lagos HQ too (its room uses the `lagos-hq` template; `ev_ensure_hq()` moves it over from the clubhouse once `lagos_hq_template.sql` has run, and says so in a NOTICE if it has not);
- `ev_rooms_for_me`, `ev_room` and `ev_admin_rooms` return `has_3d` (a layout exists) and `three_d_on` (the switch) for every room;
- `ev_admin_rooms()` is staff only (null for anyone else): every room, Lagos HQ first, then the biggest.

**THE ONE CHANGE FOR OLA.** Nothing here edits an existing function, so nothing yet stops someone calling the entry function of a room that is off. The function is `public.crew_room_enter(p_crew uuid, p_session uuid)`. The live copy is in `crew_rooms_scale.sql` (line 371; it replaces the one in `crew_rooms.sql`, line 407, and no later file redefines it). Add this line right after `perform _crew_room_require(p_crew);` (line 383 of `crew_rooms_scale.sql`), and the same line after the same call in the older copy (line 419 of `crew_rooms.sql`):

```sql
  if not public.ev_room_3d_allowed(p_crew) then raise exception 'room_off'; end if;
```

The app turns `room_off` into "The 3D room is off", and the client also hides Enter room when `three_d_on` is false. People already walking when it is switched off are not thrown out (`crew_room_step` is not changed); nobody new comes in. `tests/events_r1_rooms_test.sql` puts this exact line into the live function inside its own rolled-back transaction and shows: a member enters a room that is on, is refused with `room_off` when it is off (the owner too), and Lagos HQ is refused until staff switch it on.

Staff in the app: `ev_set_room_3d` and `ev_admin_rooms` use the signed-in account's `profiles.is_admin`. The /admin desk has the shared token and no account, so it has its own two, in the same file: `ev_admin_set_room_3d(room, on)` (answers `ok`, `bad_value` or `not_found`) and `ev_admin_list_rooms()` (every room, Lagos HQ first, nobody "joined"). Both are service role only (revoked from everyone else, tested) and are called by the route `src/app/api/admin/event-rooms/route.ts` after it checks `HOPPAZ_ADMIN_TOKEN`, like the reports route. Nothing else changes for Ola: the file loads twice cleanly.

## 5b. Known gaps (not fixed in Release 1, for Ola)

- **Event chat is gated in the browser only** (review finding 9, question 8): the `in_room` / swipe rule lets anyone with an event id read and post in its chat; invite only and community privacy depends on that edit.
- **The event list is heavy and not cached** (finding 13): `ev_list_events` builds up to 500 events with a dozen subqueries each, per client, and the app reloads it every 30 seconds and after every write. Measure before a big night; cache it or give it a materialised read.
- **Old open insert policy** (finding 15): `events_insert` (`auth.uid() is not null`) lets a guest insert a pending row with `host_id` and `room_id` set to someone else's; if staff approve it in the old desk it shows as theirs. Restrict the policy or the approval step.
- **Seat hold abuse** (finding 18): free accounts can each hold up to 5 seats for 17 minutes on a small paid event. Add a per-event cap on concurrent holds and a per-IP limit in the checkout route.
- **Very low paid prices** (review small items): the fee clamps to gross minus 1 kobo, so a price of N1 to N100 leaves nothing for Bachs's processing fee. Set a minimum paid price (for example N500).
- **Email confirmation**: with confirmation off a guest can attach any unclaimed email and the code step accepts any six digits (same exposure as the existing account creation route). Turn email confirmation on before launch.

## 6. Deliberately not included

- Any Bachs call, the webhook signature check, the platform fee percentage, payouts, transfer and resale (the SQL only stores and decides).
- Sales windows and per-person limits per type, discount codes, transfer, resale, refunds, chargebacks, per-event refund policy.
- Approval for paid tickets (Jae: paying is the approval; Release 2).
- The email code sign-in itself and the email sender (Supabase Auth, yours), a phone number, Web3 identity.
- Pop delivery (push, email, WhatsApp). The WhatsApp share is a front end copy of the text and the event link.
- Hotspots, home base, the old rooms' sealing (a flag in the front end; the data stays), Emergency Room, 3D room looks and templates.
- Insights, the host followers page, themes, named staff and an audit log.
- A change to `events_near`, `events_deck`, `in_room`, `crew_announce` or any other existing function (see the questions).

## 7. Running the tests locally (Docker, a throwaway database, never `postgres`)

Only against the local Docker database, in a database whose name starts with `hoppaz_ev_`. Never a `hoppaz-load-*` container, never
anything remote.

```bash
docker exec supabase_db_hoppaz-local psql -U postgres -d postgres -c "create database hoppaz_ev_t1"
docker exec supabase_db_hoppaz-local pg_dump -U postgres -d postgres -s | docker exec -i supabase_db_hoppaz-local psql -U postgres -d hoppaz_ev_t1 -q
# the schema dump has no rows: the rooms test needs the two room layouts that crew_rooms.sql inserts (read only from postgres)
docker exec supabase_db_hoppaz-local pg_dump -U postgres -d postgres -a -t public.crew_room_layouts | docker exec -i supabase_db_hoppaz-local psql -U postgres -d hoppaz_ev_t1 -q
# then, in this order, each file twice (the second run checks they are safe to run again):
for f in events_r1_events events_r1_registrations events_r1_tickets events_r1_pops events_r1_reports events_r1_rooms events_r1_pay events_r1_covers; do
  for i in 1 2; do docker exec -i supabase_db_hoppaz-local psql -U postgres -d hoppaz_ev_t1 -q -v ON_ERROR_STOP=1 < supabase/$f.sql; done
done
# then each test (one transaction that rolls back; each ends with ALL ... TESTS PASSED):
for f in events_r1_events events_r1_registrations events_r1_tickets events_r1_pops events_r1_reports events_r1_rooms events_r1_pay events_r1_covers; do
  docker exec -i supabase_db_hoppaz-local psql -U postgres -d hoppaz_ev_t1 -q -v ON_ERROR_STOP=1 < supabase/tests/${f}_test.sql
done
docker exec supabase_db_hoppaz-local psql -U postgres -d postgres -c "drop database hoppaz_ev_t1"
```

Notes: the dump step prints a few "permission denied to change default privileges" and "must be able to SET ROLE" errors (objects owned by
Supabase's own roles) and skips pg_cron in the new database; none of that matters for these files. The schema-only dump carries the extensions' schemas but not the roles (they are cluster wide, so `anon`, `authenticated` and
`service_role` are there). If `create extension` complains in the new database, create `postgis` and `pgcrypto` there first. The test for the
tickets sets its own test signing secret inside its transaction and the rollback puts yours back. The test for rooms clears the staff flags
and any Lagos HQ room inside its own transaction, also rolled back. The leaks test (`events_r1_leaks_test.sql`) reads as the real roles `anon` and `authenticated` and proves: no new table is readable or writable by them, the
online link cannot be read from any table, list or `ev_get_event` except by the host and people who are going, invite and community events are not
returned by `events_near`, `events_deck`, `claim_checkin` or a plain select on `events`, and the starter quests notes in question 6 and in
`events_r1_events.sql` are true. The registrations test cannot show two people racing for the last place
in one transaction; the header of that test says how to see it with two real sessions.

## 8. Local test database (the shared `postgres` on the Docker stack)

The seven `events_r1_` files are loaded in the local `postgres` database (events, registrations, tickets, pops, reports, rooms, pay, in that order; each also passed its test twice in a throwaway `hoppaz_ev_` database first). `events_r1_rooms.sql` was loaded again with the Lagos HQ rename and the 3D room switch (the local HQ crew, made by an earlier check run as Hoppaz HQ, is now Lagos HQ). The real front end layer (`src/lib/events-r1/real/`) runs against it. The ticket signing secret is set there with a random local value, and `paid_tickets` is `off` (the paid check script switches it on and back off). Only local data was touched: nothing is on production or any remote database.

Backup taken first, before anything was loaded: `localdb/backups/postgres-before-events-r1-20261022-1908.dump` (pg_dump custom format). To go back to exactly that state:

```bash
# drops everything in postgres and restores the backup (the stack must be up; this replaces the current local data)
docker exec -i supabase_db_hoppaz-local pg_restore -U postgres -d postgres --clean --if-exists --no-owner < localdb/backups/postgres-before-events-r1-20261022-1908.dump
```

Run the real layer check (local stack, Inbucket on 54324): `node --no-warnings scripts/events-r1-real-check.mts`, and with the mock Bachs on 3415 `RUN_PAID=1 node --no-warnings scripts/events-r1-real-check.mts` (header of the script says how to start the mock).

## 9. Email code sign in: two templates for the Supabase dashboard

The sign in screens ask for a six digit code, not a link. Supabase only sends the code if the email template prints `{{ .Token }}`. Two new templates are ready to paste (Authentication, Emails): `supabase/email-templates/magic-link-code.html` (the "Magic link" template, used for a person with no session or an email that already has an account; also paste it into "Confirm sign up" if that is on) and `supabase/email-templates/email-change-code.html` (the "Change email address" template, used when a guest adds their email so their progress is kept). Subject for both: `Your Hoppaz code is {{ .Token }}`. The local stack's `config.toml` was not edited: the local tests read the code through the auth admin API instead.
