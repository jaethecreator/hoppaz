# Paid tickets on Bachs: the database contract (events_r1_pay.sql)

## 26 Oct 2026: Hoppaz collects (read this first)

Decided by Jae: Bachs "You collect the payment" (the marketplace shape), not direct charges.

- Every checkout is made on Hoppaz's own Bachs account. `ev_orders.host_account` is `'platform'` and `buyer_pays_fee` is true: the buyer
  pays the ticket price plus Bachs's processing fee, shown by Bachs as its own line (`customer_bears_fee: true`). No `platform_fee` is sent.
- Hoppaz keeps `HOPPAZ_TICKET_FEE_PERCENT` (4.5) of the price, taken from the host's share (`platform_fee_kobo`).
- Any host sells at once. `_ev_host_can_sell` is true for every host; `ev_host_payouts.can_sell` now means "can withdraw": the host's Bachs
  account is a recipient with `transfers` and `payouts` active. It needs only a name, date of birth, address and a bank account that
  resolves (no ID, no BVN), sent from the app (`/api/events-r1/pay/payout-setup`), never Bachs's hosted form.
- `events_r1_pay_collect.sql` (file 9) holds these changes; `events_r1_pay.sql` itself is unchanged.
- `events_r1_payouts.sql` (file 10): the host balance (paid shares less withdrawals; 5 percent of each share held until 30 days after the
  event), withdrawals (the whole available balance, at least N1,000, sent a day after the ask), and the functions the sweeper and the
  webhook use. The sweeper transfers from Hoppaz to the host (`POST /v1/transfers`) and pays out as the host (`POST /v1/payouts`);
  `payout.paid` / `payout.failed` settle it.
- Refunds of these orders come out of Hoppaz's balance; a refunded order earns the host nothing (it comes off their earnings, and a balance
  can go below zero until the next sales). Disputes are the same.
- Tested end to end on the Bachs sandbox on 26 Oct: checkout (N10,000 + N200 card fee), Hoppaz balance N10,000, transfer N9,550 to a
  recipient host, payout N9,500 with a N50 fee.

The sections below describe the order, refund and dispute rules, which are unchanged; where they say the host's account, read Hoppaz's.


DRAFT FOR OLA, NOT RUN ON PRODUCTION. For the builder of the Next.js route handlers. Read with `notes/luma/11-bachs-integration-spec.md` (section 9) and
`src/lib/events-r1/pay.ts`. Everything here is in `supabase/events_r1_pay.sql` (run after the six `events_r1_` files); the test is
`supabase/tests/events_r1_pay_test.sql`. No function here talks to Bachs: the route does the Bachs call and hands the result to the function.

How to call: `supabase.rpc(name, args)` with the SERVICE key for the service-role functions (section 2 to 5), and with the signed-in user's own
session for the client functions (section 6). Money inside the database is in kobo (integers); the client functions return naira (numbers with up
to 2 decimals, the field names of `pay.ts`). Convert kobo to the Bachs decimal string ("10000.00") at the edge. Every service function returns
`{ ok: true, ... }` or `{ ok: false, reason: '<code>' }`, or a short text code where it says so. Nothing returns a Bachs id to a client except what
`pay.ts` already has (the checkout link, to the buyer, while open).

## 1. Settings and the order state machine

`paid_tickets` (table `ev_settings`) is `off` until Ola runs `select public.ev_set_setting('paid_tickets','on')`. Off: a paid type cannot be saved
(`currently_unavailable`) and `ev_pay_order_reserve` answers `paid_off`. On: a paid type also needs the host's `can_sell` (`payouts_not_ready`).

```
            reserve                       checkout.completed (paid)
  (none) ------------> open ------------------------------------------> paid ------ refund_start (card) ----> refund_pending --refund.paid--> refunded
                        |  \                                             |  \                                      |
        checkout.expired|   \ release (checkout call failed)             |   \ refund_start (bank transfer):       | refund.failed: back to paid,
        or sweep        v    v                                           |    manual task, tickets void            v needs_refund true (start again)
                     expired  failed                                     |    mark_manual_refund --------------> refunded
                        |        |                                       |
                        +--------+-- a late checkout.completed: seats free? -> paid + tickets (late: true)
                                      else -> paid, NO tickets, needs_refund true (needs_manual_refund true for a bank transfer)
```
* Hold: an open order holds its seats for 15 minutes plus a 2 minute margin (`expires_at` is set to now + 15 min, then to the checkout's own expiry
  if `ev_pay_order_attach` is given one). Held seats count against the type AND the event together with the people going.
* `checkout.expired` and the sweep set `expired`; a payment can still arrive later (late path). `expired` never overwrites `paid`.
* A paid order makes ONE registration per person per event with `quantity` (1 to 5 per order), and one ticket per seat (each with its own token). A
  second paid order of the same type adds to the same registration (10 seats per person per event at most).
* Tickets are issued only by `ev_pay_order_paid`.

## 2. Host accounts (service role) - Sequence A

| Function | Arguments | Result |
|---|---|---|
| `ev_pay_host_save_account` | `p_user uuid, p_account text` | text: `ok`, `no_such_user`, `bad_account` (must look like `acct_...`), `already_has_account`, `account_taken` |
| `ev_pay_host_apply_capability` | `p_account text, p_capability text, p_status text, p_at timestamptz default null` | text: `ok`, `stale` (an older event than the last applied for that capability: pass the event's `created_at` as `p_at`), `unknown_account`, `bad_capability`, `bad_status`. Status is one of active, restricted, pending, unrequested, unsupported. |
| `ev_pay_host_apply_requirements` | `p_account text, p_outstanding jsonb` (array of keys, from `account.updated` `data.outstanding`) | text: `ok`, `unknown_account`, `bad_list` |

`can_sell` is kept by the database: (`bank_transfer` OR `ngn_card_collection` active) AND `payouts` active. Status: `ready` when can_sell, `restricted` when
some capability is active but it cannot sell, else `in_progress`; no row is `not_started`. Applying the same event twice, or out of order, is safe.

## 3. Orders (service role) - Sequence B

`ev_pay_order_reserve(p_user uuid, p_event uuid, p_type uuid, p_qty integer, p_fee_kobo bigint, p_answers jsonb default '{}', p_referrer uuid default null)` returns jsonb:
```
{ ok: true, order_id, reference, gross_kobo, platform_fee_kobo, unit_price_kobo, quantity, host_account, buyer_email, buyer_name,
  expires_at, event_id, event_title, ticket_name }
{ ok: false, reason }   reasons: no_session, bad_qty (1 to 5), not_found, paid_off, cancelled, event_over, need_account (no email), bad_ticket,
                        not_paid_type, not_ready (host cannot sell), bad_fee (fee must be > 0 and < gross), order_open (also returns order_id: finish or
                        wait for it), declined, already_registered (waiting for approval or on the waitlist), other_ticket_held, too_many (10 seats max),
                        sold_out (also returns spots_left), too_many_answers, answer_too_long, answer_needed (also returns question)
```
It locks the event row, checks the type's capacity and the event's capacity including open holds, and inserts the order `open`. `reference` is
`ord_<order id without dashes>`: use it as the Bachs `reference`, and put `order_id` in the metadata. `host_account` goes in `X-Account-Id`.
The route computes `p_fee_kobo` (the percentage is an open decision) and sends `platform_fee` to Bachs as `platform_fee_kobo / 100` with 2 decimals.

| Function | Arguments | Result |
|---|---|---|
| `ev_pay_order_attach` | `p_order uuid, p_checkout_id text, p_checkout_url text, p_expires timestamptz default null` | text: `ok`, `bad_input` (url must be https), `not_found`, `not_open`, `duplicate` (checkout id on another order) |
| `ev_pay_order_release` | `p_order uuid, p_reason text default null` | text: `ok`, `not_found`, `not_open`. For a failed checkout call: order `failed`, seats free. |
| `ev_pay_sweep` | none | `{ ok: true, expired: [{ order_id, checkout_id }] }`. Expires open orders past their hold and margin. For each, `GET /v1/checkout-sessions/{checkout_id}`: if it was completed, call `ev_pay_order_paid` (late path). `checkout_id` can be null (attach never happened). |

## 4. Webhook handlers (service role) - Sequence C

Order of work in the route: verify the signature, `ev_pay_event_record(evt id...)` (false = duplicate, answer 200), act, then `ev_pay_event_processed`.

| Function | Arguments | Result |
|---|---|---|
| `ev_pay_event_record` | `p_evt text, p_type text, p_account text, p_created timestamptz, p_raw jsonb` | boolean: true if new. False for a repeat or a bad id/type. |
| `ev_pay_event_processed` | `p_evt text` | text: `ok`, `not_found` |
| `ev_pay_order_paid` | `p_ref text` (checkout id OR our reference), `p_charge text` (`data.charge.id`), `p_amount text` (`data.amount`, "10000.00"), `p_method text` (`card` or `bank_transfer`, else ignored), `p_fee_kobo bigint default null` | `{ ok: true, order_id, issued, late, needs_refund, flag_review, seats? }` or `{ ok: false, reason: not_found }`. Idempotent. Amount below the gross: nothing issued, order unchanged, `flag_review true`, `reason: 'amount_mismatch'`. Above: issued, flagged `overpaid`. Late: `late true`; if no seat is free `issued false, needs_refund true`. |
| `ev_pay_order_details` | `p_charge text, p_checkout text, p_fee_kobo bigint, p_method text` | `{ ok: true, order_id, status }` or `{ ok: false, reason: not_found \| charge_taken }`. For `collection.succeeded` (`processing_fee` times 100, `payment_method_details.type`). Safe before or after checkout.completed; changes no status. |
| `ev_pay_order_expire` | `p_checkout text` | `{ ok: true, order_id, changed }` or `{ ok:false, reason: not_found }`. For `checkout.expired`. `changed false` (with `status`) if the order was not open. |
| `ev_pay_refund_apply` | `p_refund_id text, p_reference text, p_status text` | `{ ok: true, order_id, status, changed }` or `{ ok:false, reason: not_found }`. Status `processing` (refund.created), `paid`/`success` (refund.paid), `failed` (refund.failed, e.g. INSUFFICIENT_BALANCE: order back to `paid` with `needs_refund true`, and the tickets the refund voided come back if their seats are still free: result has `tickets_restored`). Never moves a paid refund backwards. |
| `ev_pay_dispute_flag` | `p_charge text, p_dispute text, p_status text, p_amount text default null` | `{ ok: true, order_id }` or `{ ok:false, reason: not_found }`. Sets `flag_review = 'dispute'` and the dispute status. Nothing is voided. |

Host events: `capability.updated` -> `ev_pay_host_apply_capability(account, data.capability, data.status, event created_at)`; `account.updated` ->
`ev_pay_host_apply_requirements(account, data.outstanding)`.

## 5. Refunds (service role) - Sequence D

`ev_pay_refund_start(p_order uuid, p_actor uuid default null)` returns jsonb. `p_actor` is the signed-in user (host of the event or staff) or null for the
system (an automatic refund of a late payment).
```
{ ok: true, method: 'card',   status: 'refund_pending', order_id, charge_id, host_account, reference: 'rf_<order id no dashes>[_2]', amount_kobo }
{ ok: true, method: 'manual', status: 'manual_needed',  order_id, charge_id, host_account, reference, amount_kobo }     (bank transfer: NO Bachs call)
{ ok: false, reason: not_found | not_allowed | already_refunding | already_refunded | not_paid | tickets_used | method_unknown | no_charge }
```
For `card`: call `POST /v1/refunds { charge_id, reference }` (with `X-Account-Id: host_account` if Bachs confirms), then wait for `refund.paid`. The tickets are void and
the seats are free the moment this returns. A failed earlier refund does not count; the next reference gets `_2`, `_3`.
A refund whose call to Bachs has an UNKNOWN outcome (timeout, 5xx) is NOT failed: the route calls `ev_pay_refund_attempt(p_reference, p_error)` (service role; `{ ok, attempts }`),
which records the try on the refund row (`attempts`, `last_attempt_at`, `last_error`) and leaves the order `refund_pending` with its tickets void; the tenth try flags the order
`flag_review = 'refund_stuck'`. The sweeper then settles it: `GET /v1/refunds/{id}` as the host when the id is known, otherwise the SAME reference and the SAME idempotency key
(`refund:<reference>`) again. Only a definite Bachs refusal calls `ev_pay_refund_apply(..., 'failed')`. `refund.paid` always wins: it makes the order `refunded` and voids its
tickets again; a later `failed` never undoes a paid refund and a duplicate `failed` for an older refund never undoes a newer one.
`ev_pay_mark_manual_refund(p_order uuid)` (a client function, section 6) finishes a bank transfer refund.

## 6. Client functions (signed-in user, own identity)

| Function | Arguments | Result |
|---|---|---|
| `ev_pay_host_status` | none | `HostPayout`: `{ status, capabilities, requirements_due: string[] (plain words), can_sell, dashboard_url: 'https://dashboard.bachs.io' }` |
| `ev_pay_my_order` | `p_order uuid` | `Order` or null (not the buyer's). `checkout_url` only while `open`. |
| `ev_pay_my_orders` | none | `Order[]`, newest first, mine only |
| `ev_pay_event_orders` | `p_event uuid` | `Order[]` for the host or staff, else `[]`; `checkout_url` always null |
| `ev_pay_sales` | `p_event uuid` | `Sales` or null (not host or staff): `{ rows: [{ticket_type_id,name,price_naira,sold,gross_naira,platform_fee_naira,processing_fee_naira,net_naira}], totals: {sold,gross_naira,platform_fee_naira,processing_fee_naira,net_naira,refunded_naira}, open_orders, refunds_owed }`. Sold, gross and fees count paid orders that issued seats only. |
| `ev_pay_mark_manual_refund` | `p_order uuid` | text: `ok`, `no_session`, `not_found`, `not_allowed`, `nothing_to_mark`. Host or staff. |

`Order` fields (all present): `id, event_id, event_title, buyer_id, buyer_name, ticket_type_id, ticket_name, quantity, unit_price_naira, gross_naira,
platform_fee_naira, processing_fee_naira (null until known), host_net_naira (null until paid and the fee is known), status, payment_method, created_at,
expires_at, paid_at, checkout_url, needs_refund, needs_manual_refund, refund_reason` (`late` when the payment landed after the hold with no seat left, `failed` when a refund was definitely refused, else null).

Other functions the paid flow uses (from the earlier files): `ev_my_tickets(event)` (one ticket per seat, each with `token`, `code`, `seat`), `ev_scan` (per ticket),
`ev_door_counts` (counts tickets), `ev_register` (answers `use_checkout` for a paid type), `ev_cancel_registration` (answers `paid_use_refund` for a paid registration).
`ev_create_event`, `ev_update_event` and `ev_clone_event` answer `currently_unavailable` (setting off) or `payouts_not_ready` for a paid type.

## 7. Environment variables (names only; none is read by the database)

`BACHS_SECRET_KEY` (sk_sandbox_ or sk_live_), `BACHS_API_BASE` (`https://sandbox-api.bachs.io` or `https://api.bachs.io`), `BACHS_WEBHOOK_SECRET` (the endpoint signing secret; the
sandbox and live ones differ), `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`, the service key the routes use), `NEXT_PUBLIC_SUPABASE_URL`, `HOPPAZ_ADMIN_TOKEN` (the
staff routes), `NEXT_PUBLIC_PAID_TICKETS` (the front end switch; the database switch is the `paid_tickets` setting), `NEXT_PUBLIC_SITE_URL` (for `success_url`, `cancel_url` and
the onboarding return URLs). The platform fee percentage is a decision for Jae and Ola: keep it in one place (for example `HOPPAZ_PLATFORM_FEE_BPS`).
