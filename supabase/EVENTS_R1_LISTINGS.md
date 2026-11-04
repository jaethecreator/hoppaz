# Listings, organisers and room transfers: steps for Ola

DRAFT, NOT RUN ON PRODUCTION. Three new SQL files, two test files. Nothing here edits an older SQL file or an existing function.
Design: `docs/OUTREACH-FLOW.md`. All SQL here is yours to review and run.

## 1. What this adds

- Pulled events become **listings**: `events.ticket_mode = 'external'`. The app shows the real listed price and a link to the organiser's
  ticket page. Nobody can register or buy on Hoppaz for a listing.
- **Server guard.** Triggers on `ev_registrations` and `ev_orders` refuse any external event with the error `external_tickets`, whatever
  function tries it. This replaces the old `no_host` protection, which stops working once listings get a `host_id`.
- Organiser records, outreach log, the review queue (`ev_pulled`), transfers (single use, hashed token), "Is this your event?" requests.
- The **Hoppaz Listings** account that owns unclaimed rooms.

## 2. Run order

After `events_r1_events.sql`, `events_r1_registrations.sql` and `events_r1_pay.sql` (the guard triggers are only made on tables that exist;
run `events_r1_listings.sql` again if you add those later), and after `events_r1_room_profile.sql`:

| # | File | Needs | Test |
|---|---|---|---|
| 17 | `events_r1_listings.sql` | `events`, `crews`, `profiles`, file 1 (`ev_settings`, `_ev_staff`) | (covered by the two tests below) |
| 18 | `events_r1_outreach.sql` | file 17, `events_r1_room_profile.sql` (`ev_room_profiles`), `events_r1_rooms.sql` (`_ev_is_hq`) | `tests/events_r1_outreach_test.sql` |
| 19 | `events_r1_transfer.sql` | files 17 and 18, `has_account()` | `tests/events_r1_transfer_test.sql` |

Each one is safe to run again. `events_r1_room_profile.sql` (file 11) must already be run: the outreach and transfer files check for it and stop with a clear message if it is missing (it also needs the public `crew-images` storage bucket from `crew_rooms.sql`).

Tests: `docker exec -i <db container> psql -U postgres -d <throwaway db> -q -v ON_ERROR_STOP=1 < supabase/tests/<file>.sql`. Each ends with `ALL ... TESTS PASSED`. Never run a test on a real database; every test rolls back, but use a throwaway one.

## 3. One-time setup: the Hoppaz Listings account

Nobody signs in as this account. It only owns rooms and events nobody has claimed yet.

1. Supabase dashboard, Authentication, Users, **Add user**: an email you control for it (for example `listings@<your domain>`), a long random
   password you then throw away, **Auto Confirm User** on. (A user with a confirmed email passes `has_account()`.)
2. In the SQL editor:

   ```sql
   select public.ev_listings_set_account('listings@<your domain>');   -- ok
   ```

   It answers `no_such_user` if the email is wrong. It sets the profile name to "Hoppaz Listings". Nothing in the flow uses any personal
   login. If the account is not set, approving a pulled event answers `no_listings_account`.

## 4. Before you open it up: what to check

Read-only. Run in the SQL editor.

```sql
-- Old listings that will become external (no host, not a Hoppaz event), and how many are free / have a price / are leads.
select count(*) as listings,
       count(*) filter (where listed_price is null) as price_unknown,
       count(*) filter (where listed_price = 0) as free,
       count(*) filter (where listed_price > 0) as priced
  from public.events where ticket_mode = 'external';

-- Events with no host that were NOT turned external (should only be source 'hoppaz'):
select source, count(*) from public.events where host_id is null and ticket_mode = 'hoppaz' group by 1;

-- Who already registered for a listing (people holding a free "General" ticket for a show Hoppaz does not run):
select * from public.ev_listings_registrations_report();
```

## 5. The people who already registered on an old listing

Before this change an old listing read as a free "General" ticket, so someone may have registered or got a QR for a show Hoppaz does not
run. The guard stops new ones. The existing ones are left as they are by the SQL (nothing is deleted). Recommended plan:

1. Run `ev_listings_registrations_report()`. If every count is zero, you are done.
2. For each listing with `going > 0`: send those people one short message (WhatsApp or email, from Jae) with the real ticket link
   (`ticket_url` in the report): "We listed this event for you but Hoppaz does not sell its tickets. Your Hoppaz ticket will not work at
   the door. Buy here: <link>. Sorry for the mix up."
3. Then cancel those registrations by hand, one event at a time, after the message went out:

   ```sql
   -- DO NOT run until step 2 is done for that event. Replace the id.
   update public.ev_registrations set status = 'cancelled'
    where event_id = '<event id>' and status in ('going', 'checked_in', 'requested', 'waitlisted');
   ```

   (Tickets of a cancelled registration stop working at the door.) If `paid_orders` is above zero for a listing, stop and ask Jae: that
   should never have been possible and needs a refund by hand.

## 6. Secrets and settings

No new secret. The staff desk uses the existing `HOPPAZ_ADMIN_TOKEN` and the service role key the admin routes already use, on the server only.
Set `NEXT_PUBLIC_SITE_URL` so the claim links are built on the right address (otherwise the request address is used).
Sending the claim link by email is **not connected**: staff copy the link. See section 8.

## 7. Rolling back

The new columns and tables can stay. To stop the flow: do not give anyone the staff desk. To remove the guard only:
`drop trigger ev_block_external on public.ev_registrations; drop trigger ev_block_external on public.ev_orders;` (this lets listings be
registered for again, which is the bug this file fixes, so do not do it lightly).

## 8. Connecting email after `claude/reminders-2f2458` is merged

The transfer link is made and shown to staff with a Copy link button (also what they paste into Instagram and WhatsApp). Email sits behind
`src/lib/events-r1/outreach/mailer.ts` (`TransferMailer`). To connect it: add a class that sends through `src/lib/notify` (Mailjet, then Brevo)
with a `transfer_offer` template, return it from `getMailer()` when the provider keys are set. The desk then shows a Send button by itself
(`mail_connected`). Nothing else changes.
