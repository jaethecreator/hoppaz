# Pulled event to claimed room: the design

Status: built on branch `claude/outreach-flow-0a3fa5`. Not pushed. Ola runs all SQL.

## The idea in one paragraph

Hoppaz pulls events from ticket sites so the app is full. Each pulled event is a **listing**: the app shows the real price and a
"Get tickets" button to the organiser's own page, and nothing else. Nobody can register or pay on Hoppaz for a listing. Every
organiser has one **organiser record** and, once their first event is approved, one dormant **room** owned by the dedicated
**Hoppaz Listings** account (never a personal login). Staff reach out. If the organiser says yes, staff type their email, the
organiser opens a single-use link, signs in with that exact email, and the room plus its upcoming events become theirs. If they say
no, staff can delete the event and the room (the organiser row stays, marked declined, so the next scrape does not relist them). If
they never reply, nothing changes: the listing stays.

## Words

| Word | Meaning |
|---|---|
| listing | an event with `ticket_mode = 'external'`. Tickets are sold on the organiser's page. |
| unclaimed listing | a listing whose host is the Hoppaz Listings account. Page says "Listed by Hoppaz". |
| claimed listing | a listing whose room moved to a real owner. Page says "Hosted by <room>", still "Get tickets" to the organiser's page until the host switches on Hoppaz tickets. |
| pulled row | one row of `ev_pulled`: what the scraper found, waiting for review. Never public. |
| scout | the Claude skill + loader that fills `ev_pulled` (`docs/skill/hoppaz-event-scout/SKILL.md`). |

## Stages of an organiser

`pulled` (we know them, nothing live) -> `listed` (an event is live) -> `offered` (we sent the offer; a transfer link may exist) ->
`claimed` (they own the room) / `declined` (they said no).

- No reply: no stage change, no expiry, nothing is parked. The listing stays.
- Declined: `do_not_contact = true`, `declined_at` set. The row is kept for ever. Their pulled rows become `blocked`; the
  loader never lists them again. Staff can **delete the event and room** (confirm by typing the organiser name). Refused if
  any real registration or paid order exists on those events; the refusal lists the events and counts.
- Claimed: transfer accepted. Stage is set by the accept function, not by staff.

## Event page rules for a listing (the fix)

Real price ("From N5,000", "N5,000", "Free", or "Check listing" when unknown), a "Get tickets" button (opens `ticket_url`,
else `instagram_url`, else no button but "Check the organiser's page" text is not shown), "Listed by Hoppaz", and an
"Is this your event?" way in. No going count, no spots left, no ticket list, no Register, no checkout, no QR. Sold out at
the source shows "Sold out at the source" and the button becomes "See the listing". The old `ig_url` is split into
`ticket_url` and `instagram_url`.

Server rules (SQL): a trigger on `ev_registrations` and on `ev_orders` raises `external_tickets` for any external event. The client
maps that to "Tickets for this event are sold by the organiser". The checkout API route maps it to HTTP 409.

## Switching to Hoppaz tickets (after a claim)

A claimed listing keeps `ticket_mode = 'external'` until its host presses "Sell tickets on Hoppaz" in Tickets, after saving real
ticket types. `ev_listing_use_hoppaz(event)` refuses if the event is still an unclaimed listing or has no real ticket type rows.
This stops an organiser from selling the same seats on two sites by accident.

## Transfer

- Staff: organiser tracker -> type email -> `Create link`. Server (admin route) makes a random token, stores only
  `sha256(token)` hex, returns the link `<site>/claim/<token>` **once**. Staff can copy it (WhatsApp, Instagram, email) or press send
  if a mailer is connected. Staff can revoke. Default life 14 days.
- Organiser: opens the link. The claim page shows the room, what they get, their events, a preview of the event page.
  Signed out: sign in (email code or Google). Signed in with another email: it says which email the link is for (masked) and offers
  sign out. The accept button is enabled only when the verified email equals the link's email (case-insensitive).
  No account yet: signing in with the code creates it.
- `ev_transfer_accept(hash)` runs in one transaction: checks (pending, not expired, caller has an account, verified email matches,
  no paid sales on the events that move) then: owner row set, previous owner removed (Hoppaz Listings leaves the room; a
  previous human owner stays as a plain member), `crews.created_by` updated, upcoming events of the room moved to the new host
  (`host_id`), join mode opened if the room was dormant, organiser stage `claimed`, transfer `accepted`, other pending transfers of that
  room revoked. A token works once.
- "Upcoming" = not cancelled and not over (end, or start + 3 hours, in the future). Past events keep their old host.
- If the person already owns a room: **allowed**. They now own both. `_ev_host_room` (oldest owned room) keeps picking their older room
  for events created without a room; events keep their own `room_id`, so nothing moves by surprise. The accept result says
  `already_owned_other: true` and the claim page tells them to use the room switcher and the "Post as" choice when creating events.
- Owner handover (`kind = 'handover'`): the same machine, started by a room owner from Room admin -> Settings -> Transfer ownership.
  The previous owner becomes a plain member.

## Hoppaz Listings account

One profile, found by `ev_listings_account.user_id`. Ola creates the auth user once (no one logs in as it), then runs
`select ev_listings_set_account('<email>')`. Nothing depends on a personal login. If the account is not set up, staff functions that
need it answer `no_listings_account`.

## Data (SQL: supabase/events_r1_listings.sql, events_r1_outreach.sql, events_r1_transfer.sql)

`events` gains: `ticket_mode`, `ticket_url`, `instagram_url`, `listed_price`, `listed_price_max`, `listing_sold_out`, `source_site`,
`source_id`, `organiser_id`. Tables: `ev_organisers`, `ev_organiser_log`, `ev_pulled`, `ev_transfers`, `ev_claim_requests`,
`ev_listings_account`. All closed (no policy); reached only through security definer functions. Staff functions are service-role
only and are called by `/api/admin/outreach` after the `HOPPAZ_ADMIN_TOKEN` check.

## Data layer (TypeScript)

`EventsR1Api` gains `outreach` (staff desk) and `claims` (organiser side + the "Is this your event?" request). `EventsApi` gains
`sellOnHoppaz`. `R1Event.listing` is `ListingInfo | null`; a listing has `ticket_types: []`, `going: 0`, `spots_left: null`.
Fake layer is the spec; real layer calls the SQL.

## Scout (scraper)

Skill runs on Jae's computer in the Claude desktop app (built-in browser), 2 to 3 times a week. It writes
`~/hoppaz-scout/<YYYY-MM-DD>/events.json` plus flyers. `scripts/events/load-scout.mjs` validates, dry-runs by default, and with
`--apply` posts the batch to `/api/admin/outreach` (`import`). Rerun = same `(source_site, source_id)` = same row. See the skill.

## What is deliberately not here (later)

Sending email from Hoppaz (the notify system is on `claude/reminders-2f2458`; the `TransferMailer` interface is ready), a
WhatsApp Business send, auto-checking whether a ticket link still works, organiser self-serve claim without staff, per-source
success dashboards.
