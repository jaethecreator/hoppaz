# Release 1 database drafts: how to run them (for Ola)

DRAFT FOR OLA, NOT RUN ON PRODUCTION. Six new SQL files, each with a test file. They are drafts written from the fake data layer
(`src/lib/events-r1/fake/`), which is the executable spec of the rules. Nothing here edits an older SQL file or an existing function. Every
name is new (`ev_` for tables and functions, `_ev_` for helpers). You review them and you run them; nobody else touches production.

None of the six files or their tests has been run against any database by the builder who wrote them: Docker was not running, so the
only checking so far is reading and re-reading. Treat the first local run as the first real test (instructions at the end).

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
| 6 | `events_r1_rooms.sql` | `crews`, `crew_members`, `crew_rooms`, `crew_announcement_seen`, `crew_announcement_seen()` | files 1, 2 and 4 |

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
| events.create / update / clone / cancel | `ev_create_event` / `ev_update_event` / `ev_clone_event` / `ev_cancel_event` |
| events.setInterested | the existing swipes (untouched) |
| events.viewerState | `ev_viewer_state` |
| events.get/setRegistrationSettings | `ev_get_registration_settings` / `ev_set_registration_settings` |
| registrations.register / cancel | `ev_register` / `ev_cancel_registration` |
| registrations.list / approve / decline / promote / exportCsv | `ev_audience` / `ev_decide` / `ev_decide` / `ev_promote` / `ev_export` (rows) |
| registrations.ticketFor | `ev_my_ticket` |
| pops.listForEvent / visibleOnEvent / send | `ev_host_pops` / `ev_event_pops` / `ev_send_pop` |
| rooms.list / get / eventChat | `ev_rooms_for_me` / `ev_room` / `ev_event_chat` |
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
3. **HQ capacity.** Hoppaz HQ is a crew pointed to by `ev_hq`, with `crew_rooms.capacity` 500 (the most the check allows). The cap only
   limits walkers in the 3D room, not members and not General chat, so chat first never meets it. What should the 3D room do when HQ
   is big? Also, every General message reaches every member with the room open: look at the realtime load before HQ is large. If you
   would rather make HQ by hand, make a verified crew named `Hoppaz HQ`: `ev_ensure_hq()` adopts it. HQ needs one staff account to own it.
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
11. **Reports.** Three open reports from three different accounts (guests cannot report) hide an event until staff look. Three friends can hide a
    rival's event; raise the number or weigh accounts by age if that worries you. Staff still use the shared token; named staff and an audit
    log are Release 2 (money).
12. **Door staff.** `ev_set_door_staff` lets a host add up to 20 helpers who can scan and search names and emails. The fake layer has no such
    thing yet. Keep it, or host and staff only for Release 1?
13. **pg_cron and the Pops delivery.** Is pg_cron on, and who delivers the push for a Pop (the web push route exists; email does not)?

## 6. Deliberately not included

- Payments of any kind: Bachs, orders, order items, checkout, webhooks, payouts, fees, paid events (`ev_register` refuses a price above 0).
- Ticket types (there is one free General ticket), discount codes, transfer, resale, refunds, chargebacks, per-event refund policy.
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
# then, in this order, each file twice (the second run checks they are safe to run again):
for f in events_r1_events events_r1_registrations events_r1_tickets events_r1_pops events_r1_reports events_r1_rooms; do
  for i in 1 2; do docker exec -i supabase_db_hoppaz-local psql -U postgres -d hoppaz_ev_t1 -q -v ON_ERROR_STOP=1 < supabase/$f.sql; done
done
# then each test (one transaction that rolls back; each ends with ALL ... TESTS PASSED):
for f in events_r1_events events_r1_registrations events_r1_tickets events_r1_pops events_r1_reports events_r1_rooms; do
  docker exec -i supabase_db_hoppaz-local psql -U postgres -d hoppaz_ev_t1 -q -v ON_ERROR_STOP=1 < supabase/tests/${f}_test.sql
done
docker exec supabase_db_hoppaz-local psql -U postgres -d postgres -c "drop database hoppaz_ev_t1"
```

Notes: the schema-only dump carries the extensions' schemas but not the roles (they are cluster wide, so `anon`, `authenticated` and
`service_role` are there). If `create extension` complains in the new database, create `postgis` and `pgcrypto` there first. The test for the
tickets sets its own test signing secret inside its transaction and the rollback puts yours back. The test for rooms clears the staff flags
and any Hoppaz HQ room inside its own transaction, also rolled back. The registrations test cannot show two people racing for the last place
in one transaction; the header of that test says how to see it with two real sessions.
