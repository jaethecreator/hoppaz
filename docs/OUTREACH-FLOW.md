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
else `instagram_url`, labelled "See the listing"; no link at all means no button), "Listed by Hoppaz", and an
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

## Rules added while building

- A wrong email on a transfer link does not use it up. After 10 wrong tries the link is cancelled and staff issue a new one.
- Accepting also clears an old "no" on the organiser: someone who accepts has come back.
- A link for a handover is only good while the person who started it still owns the room.
- Lagos HQ can never be transferred. An owner cannot hand a room to their own email. At most 5 open handover links per room.
- Staff cannot create a link for an organiser who said no (reopen them first) or who already claimed.
- Deleting refuses when any registration or order exists, and when the organiser is claimed (they own the room now).
- "Is this your event?": 3 requests per email per day, 300 a day overall. It lands in the tracker as a claim request.
- A claimed organiser's next scraped event is hosted by the room's owner, not Hoppaz Listings, and links to the same room.
- Logged replies are kept in the database (`last_replied_at`), so every staff device sees them.

## Outreach readiness (CHANGE-005, draft)

Added in `supabase/events_r1_outreach_ready.sql` (see `supabase/EVENTS_R1_ORDER.md`, section 1a). The listing page shows the flyer credit and the organiser's public Instagram and X.
Behind the flag `event_claims` (off by default, front end `NEXT_PUBLIC_EVENT_CLAIMS=1` and database `ev_set_claims('on')`): the strip "Is this your event? Claim it" on a listing Hoppaz
listed, one-time `/claim/<token>` links that need no email and no review (staff press "Copy claim link"), an ask for people without a link that staff approve or decline, and the
Claimable list in the desk. A listing has exactly one ticket button; a tap on it is counted once per person or device per day ("[N] people went to buy" on the host Overview and in the
desk). Review has "Select" on each row and "Approve selected": rows that cannot be approved (no time, a name under 2 characters, a blocked organiser) are skipped with the reason.

## What is deliberately not here (later)

Sending email from Hoppaz (the notify system is on `claude/reminders-2f2458`; the `TransferMailer` interface is ready), a
WhatsApp Business send, auto-checking whether a ticket link still works, organiser self-serve claim without staff, per-source
success dashboards.

---

# Build contract (read by every builder)

## Files and owners

| Area | Files |
|---|---|
| Foundation SQL (done) | `supabase/events_r1_listings.sql` |
| Outreach SQL | `supabase/events_r1_outreach.sql`, `supabase/tests/events_r1_outreach_test.sql` |
| Transfer SQL | `supabase/events_r1_transfer.sql`, `supabase/tests/events_r1_transfer_test.sql` |
| Fake layer | `src/lib/events-r1/fake/**`, `src/lib/events-r1/outreach/**` (pure modules), `src/lib/events-r1/listing.ts`, `scripts/events-r1-check.mts` |
| Real layer + routes | `src/lib/events-r1/real/**`, `src/app/api/admin/outreach/**`, `src/app/api/events-r1/pay/checkout/route.ts` |
| Scout | `docs/skill/hoppaz-event-scout/**`, `scripts/events/scout-lib.mjs`, `scripts/events/load-scout.mjs`, `scripts/events/venues.json`, `scripts/events-scout-check.mts` |
| Event page | components that show an event (see the plan) |
| Desk | `src/components/admin/desk/outreach/**`, the section wiring in `src/app/admin/page.tsx`, `sections/nav.ts` |
| Claim page and owner settings | `src/app/claim/**`, `SettingsTab.tsx`, `TicketsTab.tsx` |

## SQL function contract

All names live in `public`, `security definer`, `set search_path = public, pg_temp`. "service" = `grant execute ... to service_role` only,
`revoke all ... from public, anon, authenticated`. Every function returns jsonb unless noted. Failures are `{ "ok": false, "reason": "<code>" }`
(reasons: see `OUTREACH_REASONS` in `src/lib/events-r1/types.ts`). `p_by` is the staff label (a name typed in the desk).

### events_r1_outreach.sql (service)
- `_ev_name_key(text) returns text` = `lower(regexp_replace(normalize(coalesce($1,''), NFKD), '[^a-zA-Z0-9]', '', 'g'))`
- `ev_o_import(p_batch jsonb, p_apply boolean)` -> ImportReport. Batch = ScoutBatch. Upserts `ev_pulled` by (source_site, source_id).
  Matches the organiser (ig handle, else `name_key`, else email) or makes one at stage `pulled`; an organiser who is `declined` or `do_not_contact` makes
  the pulled row `blocked` (flag `blocked`) and it is never listed. Duplicate hint: same Lagos date + same `name_key` of the event, flag `duplicate`.
  A row already `approved` whose event is an unclaimed listing: update price/time/sold out/ticket link/flyer on the event for fields not in `edited`
  (flag `moved` if the start changed). A claimed listing is never touched (flag `changed` only). Rows of `sources_covered` for upcoming events
  not in this batch get `missing_since` (flag `gone`); seen again clears it. p_apply false writes nothing. Never throws on one bad event: that line is `skipped` with a note.
- `ev_o_queue()` -> PulledEvent[] (status new or blocked, plus approved rows with a flag `changed`, `moved` or `gone`), newest first.
- `ev_o_approve(p_pulled, p_by, p_patch jsonb)` -> `{ok, event_id, organiser_id}`. Applies the patch to `fields` (and `edited`), refuses blocked. Needs `_ev_listings_uid()`
  (`no_listings_account`). Ensures the organiser (stage `listed` if it was `pulled`) and its dormant room (`ev_o_ensure_room`), then creates the listing event
  (`ticket_mode external`, `host_id` = Listings account, `room_id`, `organiser_id`, `source` 'partner', status live, `ig_url` = ticket_url or instagram_url,
  `listed_price` = lowest known ticket price, `listed_price_max`, `listing_sold_out`, flyer, vibe from category, pin from lat/lng else parked and no venue pin
  semantics as `events_r1_events.sql`) or, if the pulled row already has an event, updates it. Writes a log line. Lead rows (no start time) are refused `no_time`.
- `ev_o_ensure_room(p_org uuid) returns uuid` : the organiser's one room, made on first use: a `crews` row (`created_by` Listings account), owner member row, `ev_room_profiles`
  (slug from the name, `join_mode 'invite'` = dormant, hidden from Discover), `organisers.room_id`. Reused after that.
- `ev_o_edit(p_pulled, p_patch)`, `ev_o_reject(p_pulled, p_by, p_reason)`, `ev_o_merge(p_pulled, p_into, p_by)` (the loser becomes `merged`, its source goes to the winner's `also_at`).
- `ev_o_organisers()` -> Organiser[]; `ev_o_organiser(p_id)` -> OrganiserDetail; `ev_o_save_organiser(p_id, p_patch)` -> Organiser (handle uniqueness -> `handle_taken`);
  `ev_o_log(p_id, p_by, p_kind, p_channel, p_body)` ("contact" also sets `last_contacted_*`); `ev_o_set_stage(p_id, p_stage, p_by)` (offered | declined | listed; declined sets
  `do_not_contact`, `declined_at`, and blocks that organiser's `new` pulled rows; `listed` clears both = reopen; refuses to move a `claimed` organiser);
  `ev_o_delete(p_id, p_confirm, p_by)` (see below); `ev_o_claim_requests()`; `ev_o_handle_claim_request(p_id, p_by)`; `ev_o_week()` -> WeekSummary.
- `ev_o_delete`: `p_confirm` must equal the organiser name (`confirm_name`). Refuse `has_registrations` (with `events: [{title, count}]`) if any `ev_registrations` with status
  not in (cancelled, declined) or any `ev_orders` with status in (open, paid, refund_pending) exist on the organiser's events. Refuse `claimed` organisers (`is_claimed`: they own it now).
  Otherwise delete the events, the room (`crews`), keep the organiser row (`stage declined`, `do_not_contact true`, `room_id null`), set their pulled rows to `blocked`/`rejected`, write a log line.

### events_r1_transfer.sql
- service: `ev_o_transfer_create(p_org, p_email, p_hash, p_days, p_by)` -> `{ok, transfer}` (email lower-cased and checked; `organiser_declined` if declined or do_not_contact;
  `already_pending` if an open link exists for that room + email; needs the organiser's room, else made with `ev_o_ensure_room`; sets stage `offered` if it was `listed`/`pulled`; log line),
  `ev_o_transfer_revoke(p_id, p_by)`.
- anon + authenticated: `ev_claim_request(p_event, p_name, p_email, p_phone, p_note)` (external events only; rate limit: 3 per email per day, 300 per day overall -> `try_again_later`;
  logs a `claim_request` line on the organiser), `ev_transfer_preview(p_hash)` -> TransferPreview (never says the full email).
- authenticated: `ev_transfer_accept(p_hash)` -> `{ok, room_id, slug, moved_events, already_owned_other}` or a reason (`invalid_link`, `link_expired`, `link_used`, `link_revoked`, `need_account`,
  `wrong_email`, `paid_sales`, `not_open`). A wrong email does not use the link up; `attempts` counts them and 10 locks the link (`link_revoked`).
  `ev_transfer_create_owner(p_room, p_email, p_hash)` (room owner only), `ev_transfers_for_room(p_room)` (owner or staff), `ev_transfer_revoke_owner(p_id)`, `ev_listing_use_hoppaz(p_event)`.

## Import batch (what the scout sends)

`ScoutBatch` in `src/lib/events-r1/types.ts`. Times are ISO with offset. `tickets: []` and `sold_out: false` when the page shows none. Money is whole naira. Nothing is guessed:
unknown is `null` or `""`. `lat/lng` come from the venue pin file or the source, never from a guess.

## Staff desk route

`GET/POST /api/admin/outreach`, `Authorization: Bearer $HOPPAZ_ADMIN_TOKEN` (timing-safe compare, like `/api/admin/event-rooms`). POST body `{ action, ...args }`; one action per
`OutreachApi` method plus `flyer` (uploads a base64 JPEG to the `event-flyers` bucket under `scout/` and returns the public url). `createTransfer` makes the token here
(32 random bytes, base64url), stores `sha256` hex only, and returns `{ transfer, link }` with `link = ${SITE}/claim/${token}` (`NEXT_PUBLIC_SITE_URL`, else the request origin).
