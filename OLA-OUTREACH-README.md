# Pulled events, organiser outreach and room transfers: start here, Ola

Ola: to work through this with Claude, open this repo and say "read OLA-OUTREACH-README.md and walk me through it, one step at a time".

## For Claude, helping Ola

- Work in order and do one step at a time. Stop for Ola's yes before anything that changes production.
- Ola does these personally, in the dashboards: running SQL on production, Supabase users, Vercel values. Tell Ola exactly what to click or paste.
- Never ask for keys or tokens in chat, and never print them. Don't run the app or scripts against production from a `.env.local`.
- Never run a test file (`supabase/tests/*`) on the production database. Tests go on a throwaway database only.
- If something here doesn't match what you see on production, stop and tell Ola. Don't guess.
- The full detail for every step is in `supabase/EVENTS_R1_LISTINGS.md` (SQL) and `docs/OUTREACH-FLOW.md` (design). This file is the order.

## What's in this PR

| Change | What people see | Needs setup? |
|---|---|---|
| Pulled events become listings | Real price and a "Get tickets" button to the organiser's page. No Register, no counts, no checkout | Yes, steps 1 to 4 |
| Server guard | The database refuses any registration or order on a listing | Comes with step 2 |
| Organisers, review queue, outreach tracker | Staff desk `/admin`, Outreach section | Steps 2 to 4 |
| Room transfer by email link | Organiser opens the link, signs in with that email, accepts, and the room is theirs. Owners can also hand over a room in Room admin, Settings | Steps 2 to 4 |
| "Is this your event?" | A request form on a listing, landing in the tracker | Steps 2 to 4 |
| 370 pulled Lagos events (2 Nov) | Nothing until step 6 imports them into the review queue and staff approve | Step 6 |

Nothing goes live just from merging: the SQL files are drafts and are not run by merging, and pulled events only show after staff approve them.

## Step 1: check what production already has (read only)

These earlier files must already be on production: `events_r1_events.sql` (1), `events_r1_registrations.sql` (2), `events_r1_pay.sql` (7), `events_r1_rooms.sql`, and `events_r1_room_profile.sql` (11, which needs the public `crew-images` bucket). The 2 Nov QA pass also found 11 to 16 missing on a local copy, so confirm them too. `supabase/EVENTS_R1_ORDER.md` has the list. Tell Jae what is missing before going on.

## Step 2: test, then run the 3 new SQL files

1. On a throwaway database only: run `supabase/tests/events_r1_outreach_test.sql` and `supabase/tests/events_r1_transfer_test.sql`. Each ends with `ALL ... TESTS PASSED`. They passed on a local copy of the schema; they have never run against the real one.
2. On production, in this order: `events_r1_listings.sql` (17), `events_r1_outreach.sql` (18), `events_r1_transfer.sql` (19). Each is safe to run again.

## Step 3: the Hoppaz Listings account

It owns rooms and events nobody has claimed yet. Nobody signs in as it.

1. Supabase, Authentication, Users, Add user: an email you control (for example `listings@hoppaz.fun`), a long random password you then throw away, Auto Confirm User on.
2. SQL editor: `select public.ev_listings_set_account('listings@hoppaz.fun');` should answer `ok`.

## Step 4: old listings and settings

1. Run the read-only checks in section 4 of `supabase/EVENTS_R1_LISTINGS.md`, including `select * from public.ev_listings_registrations_report();`.
2. If anyone registered on an old listing, follow section 5 there. Tell Jae first: Jae sends those people the real ticket link before anything is cancelled.
3. Vercel: set `NEXT_PUBLIC_SITE_URL` to the live address so claim links point at the right site. No new secret is needed.

## Step 5: merge and deploy

The "Vercel" check fails with "Git author jaethecreator must have access to the project". That's the known access rule, not a build error.

## Step 6: import the pulled events into the review queue

The events are in `docs/events-import/2026-11-02/events.json` (370 events from Tix, Eventbrite, Chowdeck, Luma, AllEvents, Startup Map Hub, Meetup, dev.events and 6 December events from press). Organiser emails and phone numbers were removed from the organiser fields; a few organisers printed contact details inside their own event descriptions. Events that have passed by the time you import are left out by the loader.

Whoever imports needs a file `~/hoppaz-scout/.env` on their own computer (never in the repo) with two lines: `HOPPAZ_SITE_URL=https://<live site>` and `HOPPAZ_ADMIN_TOKEN=<the staff desk token>`.

- **Best:** Jae imports from his computer, which also has the 330 flyer pictures, so they upload too. Tell Jae when steps 1 to 5 are done.
- **Or Ola imports from the repo** (events keep the organiser's own picture link instead of an uploaded flyer):

  ```bash
  node scripts/events/load-scout.mjs docs/events-import/2026-11-02
  ```

  That is a dry run: read the totals. Then, only when happy, add `--apply`. It sends the events to the review queue, never live.

Then open `/admin`, Outreach, Review, and approve the ones to list. Approving needs step 3 done.

## What was proved and what wasn't

- Proved: the fake data checks (95, 53, 9 and 41), type check, both SQL test files on a local copy of the schema, and a clean merge with `main` at the time of writing.
- Not proved: the SQL on the real schema, the flyer upload and the staff route against production, and an organiser accepting a transfer from the owner's button.
- The 2 Nov whole-app QA pass ran before this code was written, so this flow has had no separate QA pass.
