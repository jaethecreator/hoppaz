-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1, file 7: paid tickets on Bachs (direct charge: each host is their own merchant, Hoppaz keeps a platform fee).
-- Written from notes/luma/11-bachs-integration-spec.md (section 9, sequences A to D) and src/lib/events-r1/pay.ts (the field names of the
-- jsonb below are the names of those types). The exact signatures and shapes are in supabase/EVENTS_R1_PAY.md.
--
-- RUN ORDER: the six events_r1_ files first (events, registrations, tickets, pops, reports, rooms), then THIS FILE. Safe to run again. It
-- replaces two stubs the events file left (_ev_held, _ev_host_can_sell) and adds a column to ev_tickets. It edits no older file.
-- Paid tickets stay off until Ola runs: select public.ev_set_setting('paid_tickets', 'on').
--
-- WHO CALLS WHAT. The server routes of the Next.js app (with the service key, after they verified a Bachs webhook or checked the signed-in user)
-- call the service-role functions; a signed-in person calls only the six ev_pay_ functions at the end. No money code lives here: nothing
-- here talks to Bachs. The routes do the Bachs calls and hand the results to these functions. All tables are closed to anon and authenticated.
--
--   ev_host_payouts   one row per host with a Bachs account: the account id, capabilities (name -> status), what Bachs still needs, and
--                     can_sell, kept by the database from the capability rule: (bank_transfer OR ngn_card_collection active) AND payouts active.
--   ev_orders         one purchase: who, which event and ticket type, quantity, the money in kobo (unit price, gross, Hoppaz's platform fee,
--                     Bachs's processing fee once known), status open | paid | expired | failed | refund_pending | refunded, the Bachs checkout,
--                     reference and charge ids, the hold time, and the flags needs_refund and needs_manual_refund.
--   ev_refunds        one row per refund try: card (through Bachs) or manual (a bank transfer, paid back by hand).
--   ev_bachs_events   every Bachs webhook event id, for dedupe, with the raw body.
--
-- THE RULES THIS FILE ADDS
--  * A paid purchase makes ONE registration per person per event with quantity N (1 to 5 per order) and N tickets (one row per seat, each with its
--    own token). A person who already holds seats of the same ticket type can buy more: a second paid order ADDS to the same registration (at most 10
--    seats per person per event). A person holding another ticket type, or waiting for approval or on the waitlist, cannot buy (reserve says so).
--  * Seats held by an open order count against the ticket type and the event TOGETHER with the people who are going, inside the same row lock on the
--    event (ev_pay_order_reserve, ev_pay_order_paid, ev_register all take it). A hold lasts 15 minutes plus a 2 minute margin.
--  * Paid ticket types need the paid_tickets setting on AND a host whose can_sell is true (ev_create_event / ev_update_event answer payouts_not_ready).
--    A paid type never needs approval. ev_register answers use_checkout for it.
--  * Tickets are issued only by ev_pay_order_paid (the verified checkout.completed), never by the return page.
--  * The platform fee must be above 0 and below the gross (Bachs INVALID_PLATFORM_FEE rule); the route computes it, the database checks it.
--  * A late payment (after the order expired): the seats are taken again if they are free and the tickets issue; if not, needs_refund is set (and
--    needs_manual_refund for a bank transfer: Bachs cannot refund those, the host pays the buyer by hand).
--  * A refund voids the order's tickets at once and gives the seats back (the waitlist moves up). If the refund FAILS (for example INSUFFICIENT_BALANCE on
--    the host's balance) the order goes back to paid with the refund owed and the voided tickets come back (if their seats are still free). Hoppaz's fee and Bachs's fee are not returned
--    by Bachs: the host is short by the platform fee on every refund. One refund per order (a failed one does not count).
--  * Capability events can arrive twice and out of order: ev_pay_host_apply_capability keeps the time of the last change per capability and ignores
--    older ones, and applying the same one again changes nothing.
--
-- NOT HERE (Ola, the routes): the Bachs calls (accounts, account links, checkout sessions, refunds, GET to reconcile), the webhook signature check,
-- the fee percentage (2.5 or 4.5 percent, an open decision), the email sender, dispute handling beyond a flag.
-- ============================================================================
begin;

create table if not exists public.ev_host_payouts (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  bachs_account_id text not null unique check (bachs_account_id ~ '^acct_[A-Za-z0-9_]{3,100}$'),
  capabilities     jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  capability_at    jsonb not null default '{}'::jsonb check (jsonb_typeof(capability_at) = 'object'),
  requirements_due jsonb not null default '[]'::jsonb check (jsonb_typeof(requirements_due) = 'array'),
  status           text not null default 'in_progress' check (status in ('not_started', 'in_progress', 'ready', 'restricted')),
  can_sell         boolean not null default false,
  last_event_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.ev_host_payouts enable row level security;
revoke all on public.ev_host_payouts from anon, authenticated;
grant all on public.ev_host_payouts to service_role;

create table if not exists public.ev_orders (
  id                  uuid primary key default gen_random_uuid(),
  buyer_id            uuid not null references public.profiles(id),
  event_id            uuid not null references public.events(id),
  ticket_type_id      uuid references public.ev_ticket_types(id) on delete set null,
  ticket_name         text not null default 'General',
  quantity            integer not null check (quantity between 1 and 5),
  unit_price_kobo     bigint not null check (unit_price_kobo > 0),
  gross_kobo          bigint not null check (gross_kobo > 0),
  platform_fee_kobo   bigint not null,
  processing_fee_kobo bigint check (processing_fee_kobo is null or processing_fee_kobo >= 0),
  status              text not null default 'open' check (status in ('open', 'paid', 'expired', 'failed', 'refund_pending', 'refunded')),
  payment_method      text check (payment_method is null or payment_method in ('card', 'bank_transfer')),
  host_account        text not null,
  bachs_checkout_id   text unique,
  bachs_reference     text not null unique,
  bachs_charge_id     text,
  checkout_url        text,
  expires_at          timestamptz not null,
  paid_at             timestamptz,
  refunded_at         timestamptz,
  needs_refund        boolean not null default false,
  needs_manual_refund boolean not null default false,
  flag_review         text,
  fail_reason         text,
  issued_seats        integer not null default 0,
  registration_id     uuid references public.ev_registrations(id) on delete set null,
  answers             jsonb not null default '{}'::jsonb,
  referrer_id         uuid references public.profiles(id) on delete set null,
  dispute_id          text,
  dispute_status      text,
  created_at          timestamptz not null default clock_timestamp(),
  updated_at          timestamptz not null default clock_timestamp(),
  check (platform_fee_kobo > 0 and platform_fee_kobo < gross_kobo),
  check (gross_kobo = unit_price_kobo * quantity)
);
create index if not exists ev_orders_event_idx on public.ev_orders (event_id, status);
create index if not exists ev_orders_buyer_idx on public.ev_orders (buyer_id, created_at desc);
create index if not exists ev_orders_open_idx on public.ev_orders (expires_at) where status = 'open';
create unique index if not exists ev_orders_charge_idx on public.ev_orders (bachs_charge_id) where bachs_charge_id is not null;
alter table public.ev_orders enable row level security;
revoke all on public.ev_orders from anon, authenticated;
grant all on public.ev_orders to service_role;

create table if not exists public.ev_refunds (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.ev_orders(id),
  bachs_refund_id text unique,
  reference       text not null unique,
  amount_kobo     bigint not null check (amount_kobo > 0),
  method          text not null check (method in ('card', 'manual')),
  status          text not null check (status in ('requested', 'processing', 'paid', 'failed', 'manual_needed', 'manual_done')),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default clock_timestamp(),
  updated_at      timestamptz not null default clock_timestamp()
);
create index if not exists ev_refunds_order_idx on public.ev_refunds (order_id, status);
alter table public.ev_refunds enable row level security;
revoke all on public.ev_refunds from anon, authenticated;
grant all on public.ev_refunds to service_role;

create table if not exists public.ev_bachs_events (
  evt_id       text primary key check (char_length(evt_id) between 3 and 200),
  type         text not null check (char_length(type) <= 100),
  account      text,
  created_at   timestamptz,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  raw          jsonb
);
alter table public.ev_bachs_events enable row level security;
revoke all on public.ev_bachs_events from anon, authenticated;
grant all on public.ev_bachs_events to service_role;

-- Which order a ticket came from (a refund voids that order's tickets only).
alter table public.ev_tickets add column if not exists order_id uuid references public.ev_orders(id) on delete set null;
create index if not exists ev_tickets_order_idx on public.ev_tickets (order_id) where order_id is not null;

-- ---------------------------------------------------------------- helpers ---
-- Seats held by open orders whose hold (15 minutes plus a 2 minute margin) has not run out. p_type null = the whole event.
create or replace function public._ev_held(p_event uuid, p_type uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(o.quantity), 0)::int from public.ev_orders o
   where o.event_id = p_event and o.status = 'open' and o.expires_at + interval '2 minutes' > now()
     and (p_type is null or o.ticket_type_id = p_type);
$$;
revoke all on function public._ev_held(uuid, uuid) from public, anon, authenticated;

create or replace function public._ev_host_can_sell(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select h.can_sell from public.ev_host_payouts h where h.user_id = p_user), false);
$$;
revoke all on function public._ev_host_can_sell(uuid) from public, anon, authenticated;

-- kobo as naira for a screen (two decimals).
drop function if exists public._ev_pay_naira(bigint);
create or replace function public._ev_pay_naira(p_kobo numeric) returns numeric
language sql immutable set search_path = public, pg_temp as $$ select round(p_kobo / 100.0, 2); $$;
revoke all on function public._ev_pay_naira(numeric) from public, anon, authenticated;

-- can_sell and status from the capabilities: (bank_transfer OR ngn_card_collection active) AND payouts active.
create or replace function public._ev_pay_recompute(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h public.ev_host_payouts;
  v_sell boolean;
  v_any boolean;
begin
  select * into h from public.ev_host_payouts where user_id = p_user for update;
  if h.user_id is null then return; end if;
  v_sell := ((h.capabilities ->> 'bank_transfer') = 'active' or (h.capabilities ->> 'ngn_card_collection') = 'active')
            and (h.capabilities ->> 'payouts') = 'active';
  v_any := exists (select 1 from jsonb_each_text(h.capabilities) c where c.value = 'active');
  update public.ev_host_payouts
     set can_sell = v_sell,
         status = case when v_sell then 'ready' when v_any then 'restricted' else 'in_progress' end,
         updated_at = now()
   where user_id = p_user;
end $$;
revoke all on function public._ev_pay_recompute(uuid) from public, anon, authenticated;

-- What Bachs still needs from a host, in plain words.
create or replace function public._ev_pay_req_words(p_key text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p_key
    when 'persons.name' then 'Your name'
    when 'persons.dob' then 'Your date of birth'
    when 'persons.id_number' then 'Your ID number'
    when 'persons.id_document' then 'A photo of your ID'
    when 'persons.bvn' then 'Your BVN'
    when 'proof_of_address' then 'Proof of address'
    when 'payout_destination' then 'The bank account for your payouts'
    when 'business_profile.product_description' then 'What you sell'
    when 'business_profile.support_email' then 'A support email'
    when 'business_profile.product_category' then 'Your kind of business'
    else initcap(replace(replace(p_key, '.', ' '), '_', ' '))
  end;
$$;
revoke all on function public._ev_pay_req_words(text) from public, anon, authenticated;

-- An order as a screen gets it (the Order type of pay.ts). The checkout link only for the buyer, only while open.
create or replace function public._ev_pay_order_json(o public.ev_orders, p_show_url boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', o.id, 'event_id', o.event_id, 'event_title', (select e.title from public.events e where e.id = o.event_id),
    'buyer_id', o.buyer_id,
    'buyer_name', coalesce((select coalesce(nullif(btrim(p.display_name), ''), p.handle) from public.profiles p where p.id = o.buyer_id), 'Buyer'),
    'ticket_type_id', o.ticket_type_id, 'ticket_name', o.ticket_name, 'quantity', o.quantity,
    'unit_price_naira', public._ev_pay_naira(o.unit_price_kobo), 'gross_naira', public._ev_pay_naira(o.gross_kobo),
    'platform_fee_naira', public._ev_pay_naira(o.platform_fee_kobo),
    'processing_fee_naira', case when o.processing_fee_kobo is null then null else public._ev_pay_naira(o.processing_fee_kobo) end,
    'host_net_naira', case when o.processing_fee_kobo is null or o.paid_at is null then null
                           else public._ev_pay_naira(o.gross_kobo - o.platform_fee_kobo - o.processing_fee_kobo) end,
    'status', o.status, 'payment_method', o.payment_method, 'created_at', o.created_at, 'expires_at', o.expires_at, 'paid_at', o.paid_at,
    'checkout_url', case when p_show_url and o.status = 'open' then o.checkout_url else null end,
    'needs_refund', o.needs_refund, 'needs_manual_refund', o.needs_manual_refund);
$$;
revoke all on function public._ev_pay_order_json(public.ev_orders, boolean) from public, anon, authenticated;

create or replace function public._ev_pay_find(p_ref text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id from public.ev_orders o where o.bachs_checkout_id = p_ref or o.bachs_reference = p_ref limit 1;
$$;
revoke all on function public._ev_pay_find(text) from public, anon, authenticated;

-- ============================ SERVICE ROLE: host accounts (Sequence A) ============================
create or replace function public.ev_pay_host_save_account(p_user uuid, p_account text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare h public.ev_host_payouts;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return 'no_such_user'; end if;
  if p_account is null or p_account !~ '^acct_[A-Za-z0-9_]{3,100}$' then return 'bad_account'; end if;
  select * into h from public.ev_host_payouts where user_id = p_user;
  if h.user_id is not null then
    return case when h.bachs_account_id = p_account then 'ok' else 'already_has_account' end;
  end if;
  if exists (select 1 from public.ev_host_payouts where bachs_account_id = p_account) then return 'account_taken'; end if;
  insert into public.ev_host_payouts (user_id, bachs_account_id) values (p_user, p_account);
  return 'ok';
end $$;

-- capability.updated: p_at is the event's created_at, so an older one that arrives late does not undo a newer one.
create or replace function public.ev_pay_host_apply_capability(p_account text, p_capability text, p_status text, p_at timestamptz default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h    public.ev_host_payouts;
  v_at timestamptz;
begin
  if p_capability is null or p_capability !~ '^[a-z_]{1,40}$' then return 'bad_capability'; end if;
  if p_status is null or p_status not in ('active', 'restricted', 'pending', 'unrequested', 'unsupported') then return 'bad_status'; end if;
  select * into h from public.ev_host_payouts where bachs_account_id = p_account for update;
  if h.user_id is null then return 'unknown_account'; end if;
  if p_at is not null then
    v_at := (h.capability_at ->> p_capability)::timestamptz;
    if v_at is not null and p_at < v_at then return 'stale'; end if;
  end if;
  update public.ev_host_payouts
     set capabilities = capabilities || jsonb_build_object(p_capability, p_status),
         capability_at = case when p_at is null then capability_at else capability_at || jsonb_build_object(p_capability, p_at) end,
         last_event_at = now(), updated_at = now()
   where user_id = h.user_id;
  perform public._ev_pay_recompute(h.user_id);
  return 'ok';
end $$;

-- account.updated: data.outstanding, a list of field keys. Empty means nothing left to provide (it does not mean anything is enabled).
create or replace function public.ev_pay_host_apply_requirements(p_account text, p_outstanding jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_list jsonb;
begin
  if p_outstanding is null or jsonb_typeof(p_outstanding) <> 'array' or jsonb_array_length(p_outstanding) > 100 then return 'bad_list'; end if;
  select coalesce(jsonb_agg(distinct x.v), '[]'::jsonb) into v_list
    from (select jsonb_array_elements_text(p_outstanding) as v) x where char_length(x.v) between 1 and 100;
  update public.ev_host_payouts set requirements_due = v_list, last_event_at = now(), updated_at = now() where bachs_account_id = p_account;
  if not found then return 'unknown_account'; end if;
  return 'ok';
end $$;

-- ============================ SERVICE ROLE: orders (Sequence B) ============================
-- Reserve seats and make an open order. The event row is locked first, so two buyers cannot take the last seat.
create or replace function public.ev_pay_order_reserve(p_user uuid, p_event uuid, p_type uuid, p_qty integer, p_fee_kobo bigint,
                                                       p_answers jsonb default '{}'::jsonb, p_referrer uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e       public.events;
  t       record;
  r       public.ev_registrations;
  o       public.ev_orders;
  v_host  uuid;
  v_acct  text;
  v_email text;
  v_name  text;
  v_gross bigint;
  v_left  integer;
  v_ans   jsonb := '{}'::jsonb;
  v_count integer := 0;
  v_ref   uuid;
  v_id    uuid := gen_random_uuid();
  a       record;
  q       jsonb;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if p_qty is null or p_qty < 1 or p_qty > 5 then return jsonb_build_object('ok', false, 'reason', 'bad_qty'); end if;
  select * into e from public.events where id = p_event for update;
  if e.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public._ev_paid_on() then return jsonb_build_object('ok', false, 'reason', 'paid_off'); end if;
  if e.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  if e.status not in ('live', 'unlisted') then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if e.visibility = 'community' and not public._ev_in_room(e.room_id, p_user) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if now() > coalesce(e.ends_at, e.starts_at + interval '3 hours') then return jsonb_build_object('ok', false, 'reason', 'event_over'); end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  if coalesce(v_email, '') = '' then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;

  select x.id, x.name, x.price_naira into t from public._ev_types(p_event) x where x.id = p_type;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'bad_ticket'); end if;
  if t.price_naira <= 0 then return jsonb_build_object('ok', false, 'reason', 'not_paid_type'); end if;
  v_host := coalesce(e.host_id, e.created_by);
  select h.bachs_account_id into v_acct from public.ev_host_payouts h where h.user_id = v_host and h.can_sell;
  if v_acct is null then return jsonb_build_object('ok', false, 'reason', 'not_ready'); end if;

  v_gross := t.price_naira::bigint * 100 * p_qty;
  if p_fee_kobo is null or p_fee_kobo <= 0 or p_fee_kobo >= v_gross then return jsonb_build_object('ok', false, 'reason', 'bad_fee'); end if;

  -- One open order per person per event: they finish or let it expire.
  select * into o from public.ev_orders where buyer_id = p_user and event_id = p_event and status = 'open' and expires_at + interval '2 minutes' > now() limit 1;
  if o.id is not null then return jsonb_build_object('ok', false, 'reason', 'order_open', 'order_id', o.id); end if;

  -- What the person already holds (one registration per person per event).
  select * into r from public.ev_registrations where event_id = p_event and user_id = p_user for update;
  if r.id is not null then
    if r.status = 'declined' then return jsonb_build_object('ok', false, 'reason', 'declined'); end if;
    if r.status in ('requested', 'waitlisted') then return jsonb_build_object('ok', false, 'reason', 'already_registered'); end if;
    if r.status in ('going', 'checked_in') then
      if coalesce(r.ticket_type_id, public._ev_first_type(p_event)) <> t.id then return jsonb_build_object('ok', false, 'reason', 'other_ticket_held'); end if;
      if r.quantity + p_qty > 10 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
    end if;
  end if;

  -- Places: the type's own capacity and the event's, counting going people and open holds.
  v_left := public._ev_type_left(p_event, t.id);
  if v_left is not null and v_left < p_qty then return jsonb_build_object('ok', false, 'reason', 'sold_out', 'spots_left', v_left); end if;

  -- The host's questions: same checks as a free registration.
  if p_answers is not null and jsonb_typeof(p_answers) = 'object' then
    for a in select key, value from jsonb_each(p_answers) loop
      if jsonb_typeof(a.value) <> 'string' or btrim(a.value #>> '{}') = '' or a.key !~ '^[a-z0-9_]{1,40}$' then continue; end if;
      v_count := v_count + 1;
      if v_count > 20 then return jsonb_build_object('ok', false, 'reason', 'too_many_answers'); end if;
      if char_length(btrim(a.value #>> '{}')) > 500 then return jsonb_build_object('ok', false, 'reason', 'answer_too_long'); end if;
      v_ans := v_ans || jsonb_build_object(a.key, btrim(a.value #>> '{}'));
    end loop;
  end if;
  for q in select value from jsonb_array_elements(public._ev_settings(p_event) -> 'questions') loop
    if q ->> 'builtin' is not null then continue; end if;
    if jsonb_typeof(q -> 'enabled') = 'boolean' and (q ->> 'enabled')::boolean is false then continue; end if;
    if jsonb_typeof(q -> 'required') = 'boolean' and (q ->> 'required')::boolean and (v_ans ->> (q ->> 'id')) is null then
      return jsonb_build_object('ok', false, 'reason', 'answer_needed', 'question', q ->> 'label');
    end if;
  end loop;
  select p.id into v_ref from public.profiles p where p.id = p_referrer and p.id <> p_user;
  select coalesce(nullif(btrim(p.display_name), ''), p.handle, 'Guest') into v_name from public.profiles p where p.id = p_user;

  insert into public.ev_orders (id, buyer_id, event_id, ticket_type_id, ticket_name, quantity, unit_price_kobo, gross_kobo, platform_fee_kobo,
                                host_account, bachs_reference, expires_at, answers, referrer_id)
  values (v_id, p_user, p_event, t.id, t.name, p_qty, t.price_naira::bigint * 100, v_gross, p_fee_kobo, v_acct,
          'ord_' || replace(v_id::text, '-', ''), now() + interval '15 minutes', v_ans, v_ref)
  returning * into o;
  return jsonb_build_object('ok', true, 'order_id', o.id, 'reference', o.bachs_reference, 'gross_kobo', o.gross_kobo,
                            'platform_fee_kobo', o.platform_fee_kobo, 'unit_price_kobo', o.unit_price_kobo, 'quantity', o.quantity,
                            'host_account', o.host_account, 'buyer_email', v_email, 'buyer_name', v_name,
                            'expires_at', o.expires_at, 'event_id', e.id, 'event_title', e.title, 'ticket_name', t.name);
end $$;

-- Remember the Bachs checkout on the order. p_expires is the checkout's own expiry (the hold follows it, never beyond 24 hours).
create or replace function public.ev_pay_order_attach(p_order uuid, p_checkout_id text, p_checkout_url text, p_expires timestamptz default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.ev_orders;
begin
  if p_checkout_id is null or char_length(p_checkout_id) not between 3 and 200 or p_checkout_url is null or p_checkout_url !~ '^https://' or char_length(p_checkout_url) > 1000 then
    return 'bad_input';
  end if;
  select * into o from public.ev_orders where id = p_order for update;
  if o.id is null then return 'not_found'; end if;
  if o.status <> 'open' then return 'not_open'; end if;
  update public.ev_orders
     set bachs_checkout_id = p_checkout_id, checkout_url = p_checkout_url,
         expires_at = case when p_expires is not null and p_expires > now() and p_expires < now() + interval '24 hours' then p_expires else expires_at end,
         updated_at = clock_timestamp()
   where id = p_order;
  return 'ok';
exception when unique_violation then
  return 'duplicate';
end $$;

-- The checkout call failed: give the seats back. Only an open order with no checkout paid.
create or replace function public.ev_pay_order_release(p_order uuid, p_reason text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.ev_orders;
begin
  select * into o from public.ev_orders where id = p_order for update;
  if o.id is null then return 'not_found'; end if;
  if o.status <> 'open' then return 'not_open'; end if;
  update public.ev_orders set status = 'failed', fail_reason = left(coalesce(p_reason, 'checkout_failed'), 200), updated_at = clock_timestamp() where id = p_order;
  return 'ok';
end $$;

-- ============================ SERVICE ROLE: webhooks (Sequence C) ============================
-- True if this Bachs event is new. False: seen already, do nothing.
create or replace function public.ev_pay_event_record(p_evt text, p_type text, p_account text, p_created timestamptz, p_raw jsonb) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if p_evt is null or char_length(p_evt) not between 3 and 200 or p_type is null then return false; end if;
  insert into public.ev_bachs_events (evt_id, type, account, created_at, raw) values (p_evt, left(p_type, 100), p_account, p_created, p_raw)
  on conflict (evt_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

create or replace function public.ev_pay_event_processed(p_evt text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.ev_bachs_events set processed_at = coalesce(processed_at, now()) where evt_id = p_evt;
  return case when found then 'ok' else 'not_found' end;
end $$;

-- Make or extend the buyer's registration and issue the seats of an order. Returns the seats issued, or -1 when the registration cannot take them
-- (the person is waiting, declined, or holds another type). The caller holds the event and order locks.
create or replace function public._ev_pay_issue(p_order uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o      public.ev_orders;
  r      public.ev_registrations;
  v_name text;
begin
  select * into o from public.ev_orders where id = p_order;
  select coalesce(nullif(btrim(p.display_name), ''), p.handle, 'Guest') into v_name from public.profiles p where p.id = o.buyer_id;
  select * into r from public.ev_registrations where event_id = o.event_id and user_id = o.buyer_id for update;
  if r.id is null then
    insert into public.ev_registrations (event_id, user_id, status, name, answers, referrer_id, ticket_type_id, quantity)
    values (o.event_id, o.buyer_id, 'going', coalesce(v_name, 'Guest'), o.answers, o.referrer_id, o.ticket_type_id, o.quantity)
    returning * into r;
  elsif r.status in ('going', 'checked_in') then
    if coalesce(r.ticket_type_id, public._ev_first_type(o.event_id)) is distinct from coalesce(o.ticket_type_id, public._ev_first_type(o.event_id))
       or r.quantity + o.quantity > 10 then
      return -1;
    end if;
    update public.ev_registrations set quantity = quantity + o.quantity, status = 'going', updated_at = clock_timestamp() where id = r.id returning * into r;
  elsif r.status = 'cancelled' then
    update public.ev_registrations
       set status = 'going', name = coalesce(v_name, 'Guest'), answers = o.answers, ticket_type_id = o.ticket_type_id, quantity = o.quantity,
           referrer_id = coalesce(o.referrer_id, referrer_id), created_at = clock_timestamp(), updated_at = clock_timestamp(),
           checked_in_at = null, waitlist_pos = null
     where id = r.id returning * into r;
  else
    return -1;
  end if;
  perform public.ev_issue_ticket(r.id);
  -- The seats just made belong to this order.
  update public.ev_tickets set order_id = o.id where registration_id = r.id and order_id is null and status in ('valid', 'used');
  update public.ev_orders set registration_id = r.id, issued_seats = o.quantity where id = o.id;
  perform public._ev_renumber_waitlist(o.event_id);
  return o.quantity;
end $$;
revoke all on function public._ev_pay_issue(uuid) from public, anon, authenticated;

-- checkout.completed (paid). p_ref is the checkout id or our reference. Idempotent: a second call for a paid order changes nothing.
create or replace function public.ev_pay_order_paid(p_ref text, p_charge text, p_amount text, p_method text,
                                                    p_fee_kobo bigint default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id     uuid := public._ev_pay_find(p_ref);
  o        public.ev_orders;
  v_method text;
  v_kobo   bigint;
  v_late   boolean := false;
  v_flag   text := null;
  v_issued integer := 0;
  v_left   integer;
  v_refund boolean := false;
begin
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform 1 from public.events where id = (select event_id from public.ev_orders where id = v_id) for update;
  select * into o from public.ev_orders where id = v_id for update;

  v_method := case when p_method in ('card', 'bank_transfer') then p_method else o.payment_method end;
  if o.status in ('paid', 'refund_pending', 'refunded') then
    update public.ev_orders set bachs_charge_id = coalesce(bachs_charge_id, nullif(p_charge, '')), payment_method = coalesce(payment_method, v_method),
           processing_fee_kobo = coalesce(processing_fee_kobo, p_fee_kobo), updated_at = clock_timestamp() where id = o.id;
    return jsonb_build_object('ok', true, 'order_id', o.id, 'issued', false, 'late', false, 'needs_refund', o.needs_refund, 'flag_review', o.flag_review is not null);
  end if;

  -- The amount: it must be the gross. Less is not issued (flagged for a person to look at); more or "accepted" is issued and flagged.
  begin
    v_kobo := round(p_amount::numeric * 100)::bigint;
  exception when others then
    v_kobo := null;
  end;
  if v_kobo is null or v_kobo < o.gross_kobo then
    update public.ev_orders set flag_review = 'amount_mismatch', bachs_charge_id = coalesce(bachs_charge_id, nullif(p_charge, '')), updated_at = clock_timestamp() where id = o.id;
    return jsonb_build_object('ok', true, 'order_id', o.id, 'issued', false, 'late', false, 'needs_refund', false, 'flag_review', true, 'reason', 'amount_mismatch');
  end if;
  if v_kobo > o.gross_kobo then v_flag := 'overpaid'; end if;

  if o.status in ('expired', 'failed') or (o.status = 'open' and o.expires_at + interval '2 minutes' < now()) then
    -- A late payment (the hold ran out, expired or not yet swept): take the seats again if they are free (this order no longer holds any).
    v_late := true;
    v_left := public._ev_type_left(o.event_id, o.ticket_type_id);
    if (v_left is not null and v_left < o.quantity) or not exists (select 1 from public.events e where e.id = o.event_id and e.status in ('live', 'unlisted')) then
      v_refund := true;
    end if;
  end if;
  if not v_refund then
    v_issued := public._ev_pay_issue(o.id);
    if v_issued < 0 then v_refund := true; v_issued := 0; end if;
  end if;

  update public.ev_orders
     set status = 'paid', paid_at = now(), bachs_charge_id = coalesce(nullif(p_charge, ''), bachs_charge_id), payment_method = v_method,
         processing_fee_kobo = coalesce(p_fee_kobo, processing_fee_kobo), flag_review = coalesce(v_flag, flag_review),
         needs_refund = v_refund, needs_manual_refund = (v_refund and v_method = 'bank_transfer'),
         issued_seats = case when v_refund then 0 else issued_seats end, updated_at = clock_timestamp()
   where id = o.id;
  return jsonb_build_object('ok', true, 'order_id', o.id, 'issued', not v_refund, 'late', v_late, 'needs_refund', v_refund,
                            'flag_review', v_flag is not null or o.flag_review is not null, 'seats', v_issued);
end $$;

-- collection.succeeded: the charge id, the processing fee and the method. Safe before or after checkout.completed.
create or replace function public.ev_pay_order_details(p_charge text, p_checkout text, p_fee_kobo bigint, p_method text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := public._ev_pay_find(p_checkout);
  o    public.ev_orders;
begin
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into o from public.ev_orders where id = v_id for update;
  update public.ev_orders
     set bachs_charge_id = coalesce(bachs_charge_id, nullif(p_charge, '')),
         processing_fee_kobo = coalesce(p_fee_kobo, processing_fee_kobo),
         payment_method = coalesce(case when p_method in ('card', 'bank_transfer') then p_method end, payment_method),
         updated_at = clock_timestamp()
   where id = o.id returning * into o;
  -- A refund that was waiting only for the method: a bank transfer cannot be refunded through Bachs.
  if o.needs_refund and o.payment_method = 'bank_transfer' and not o.needs_manual_refund then
    update public.ev_orders set needs_manual_refund = true where id = o.id;
  end if;
  return jsonb_build_object('ok', true, 'order_id', o.id, 'status', o.status);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'charge_taken');
end $$;

-- checkout.expired. Never overwrites a paid order.
create or replace function public.ev_pay_order_expire(p_checkout text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := public._ev_pay_find(p_checkout);
  o    public.ev_orders;
begin
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into o from public.ev_orders where id = v_id for update;
  if o.status = 'open' then
    update public.ev_orders set status = 'expired', updated_at = clock_timestamp() where id = o.id;
    return jsonb_build_object('ok', true, 'order_id', o.id, 'changed', true);
  end if;
  return jsonb_build_object('ok', true, 'order_id', o.id, 'changed', false, 'status', o.status);
end $$;

-- Expire open orders whose hold and margin have run out (frees the seats). Returns them so the route can ask Bachs whether any was paid
-- after all: if so, ev_pay_order_paid takes the late payment path.
create or replace function public.ev_pay_sweep() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_out jsonb;
begin
  with gone as (
    update public.ev_orders set status = 'expired', updated_at = clock_timestamp()
     where id in (select x.id from public.ev_orders x where x.status = 'open' and x.expires_at + interval '2 minutes' < now() order by x.expires_at limit 500 for update skip locked)
    returning id, bachs_checkout_id)
  select coalesce(jsonb_agg(jsonb_build_object('order_id', g.id, 'checkout_id', g.bachs_checkout_id)), '[]'::jsonb) into v_out from gone g;
  return jsonb_build_object('ok', true, 'expired', v_out);
end $$;

-- ============================ SERVICE ROLE: refunds and disputes (Sequence D) ============================
-- Start a refund. Card: refund_pending, the route calls Bachs with the returned reference. Bank transfer: no Bachs call, a manual task.
-- Either way the order's tickets are void at once and the seats go back. p_actor null = the system (an automatic refund of a late payment).
create or replace function public.ev_pay_refund_start(p_order uuid, p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o      public.ev_orders;
  v_ev   public.events;
  v_n    integer;
  v_ref  text;
  v_card boolean;
begin
  select * into o from public.ev_orders where id = p_order;
  if o.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into v_ev from public.events where id = o.event_id for update;
  select * into o from public.ev_orders where id = p_order for update;
  if p_actor is not null and p_actor is distinct from coalesce(v_ev.host_id, v_ev.created_by)
     and not coalesce((select p.is_admin from public.profiles p where p.id = p_actor), false) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if o.status = 'refund_pending' then return jsonb_build_object('ok', false, 'reason', 'already_refunding'); end if;
  if o.status = 'refunded' then return jsonb_build_object('ok', false, 'reason', 'already_refunded'); end if;
  if o.status <> 'paid' then return jsonb_build_object('ok', false, 'reason', 'not_paid'); end if;
  if exists (select 1 from public.ev_refunds f where f.order_id = o.id and f.status <> 'failed') then
    return jsonb_build_object('ok', false, 'reason', 'already_refunded');
  end if;
  if exists (select 1 from public.ev_tickets t where t.order_id = o.id and t.status = 'used') then
    return jsonb_build_object('ok', false, 'reason', 'tickets_used');
  end if;
  if o.payment_method is null then return jsonb_build_object('ok', false, 'reason', 'method_unknown'); end if;
  v_card := o.payment_method = 'card';
  if v_card and o.bachs_charge_id is null then return jsonb_build_object('ok', false, 'reason', 'no_charge'); end if;

  -- Tickets void, seats back.
  update public.ev_tickets set status = 'void', void_reason = 'refund' where order_id = o.id and status = 'valid';
  if o.issued_seats > 0 and o.registration_id is not null then
    update public.ev_registrations
       set quantity = greatest(0, quantity - o.issued_seats),
           status = case when quantity - o.issued_seats <= 0 then 'cancelled' else status end, updated_at = clock_timestamp()
     where id = o.registration_id;
    update public.ev_orders set issued_seats = 0 where id = o.id;
  end if;

  select count(*)::int into v_n from public.ev_refunds where order_id = o.id;
  v_ref := 'rf_' || replace(o.id::text, '-', '') || case when v_n > 0 then '_' || (v_n + 1)::text else '' end;
  insert into public.ev_refunds (order_id, reference, amount_kobo, method, status, created_by)
  values (o.id, v_ref, o.gross_kobo, case when v_card then 'card' else 'manual' end, case when v_card then 'requested' else 'manual_needed' end, p_actor);
  if v_card then
    update public.ev_orders set status = 'refund_pending', needs_refund = false, needs_manual_refund = false, updated_at = clock_timestamp() where id = o.id;
  else
    update public.ev_orders set needs_refund = true, needs_manual_refund = true, updated_at = clock_timestamp() where id = o.id;
  end if;
  perform public._ev_fill_waitlist(o.event_id);
  return jsonb_build_object('ok', true, 'method', case when v_card then 'card' else 'manual' end, 'status', case when v_card then 'refund_pending' else 'manual_needed' end,
                            'charge_id', o.bachs_charge_id, 'host_account', o.host_account, 'reference', v_ref, 'amount_kobo', o.gross_kobo, 'order_id', o.id);
end $$;

-- refund.created / refund.paid / refund.failed.
create or replace function public.ev_pay_refund_apply(p_refund_id text, p_reference text, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f      public.ev_refunds;
  v_st   text := case lower(coalesce(p_status, '')) when 'paid' then 'paid' when 'success' then 'paid' when 'succeeded' then 'paid' when 'failed' then 'failed' else 'processing' end;
  v_ev   uuid;
  o      public.ev_orders;
  v_n    integer;
  v_left integer;
  v_back integer := 0;
begin
  select * into f from public.ev_refunds where reference = p_reference or (p_refund_id is not null and bachs_refund_id = p_refund_id) order by (reference = p_reference) desc limit 1;
  if f.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select event_id into v_ev from public.ev_orders where id = f.order_id;
  perform 1 from public.events where id = v_ev for update;
  select * into f from public.ev_refunds where id = f.id for update;
  -- Never go backwards: a paid refund stays paid, a created event after a paid one is ignored.
  if f.status = 'paid' or (f.status = 'failed' and v_st = 'processing') or f.method = 'manual' then
    return jsonb_build_object('ok', true, 'order_id', f.order_id, 'status', f.status, 'changed', false);
  end if;
  update public.ev_refunds set status = v_st, bachs_refund_id = coalesce(bachs_refund_id, nullif(p_refund_id, '')), updated_at = clock_timestamp() where id = f.id;
  if v_st = 'paid' then
    update public.ev_orders set status = 'refunded', refunded_at = now(), needs_refund = false, needs_manual_refund = false, updated_at = clock_timestamp() where id = f.order_id;
  elsif v_st = 'failed' then
    -- The refund failed (for example Bachs INSUFFICIENT_BALANCE on the host's balance): the order goes back to paid, the refund is owed again (a new
    -- one can be started, or the sweeper retries it), and the tickets the refund voided come back, if their seats are still free.
    select * into o from public.ev_orders where id = f.order_id for update;
    if o.status = 'refund_pending' then
      select count(*)::int into v_n from public.ev_tickets t where t.order_id = o.id and t.status = 'void' and t.void_reason = 'refund';
      v_left := public._ev_type_left(o.event_id, o.ticket_type_id);
      if v_n > 0 and (v_left is null or v_left >= v_n) then
        update public.ev_tickets set status = 'valid', void_reason = null where order_id = o.id and status = 'void' and void_reason = 'refund';
        update public.ev_registrations set quantity = quantity + v_n, status = case when status in ('cancelled', 'checked_in') then 'going' else status end, updated_at = clock_timestamp()
         where id = o.registration_id;
        v_back := v_n;
      end if;
      update public.ev_orders set status = 'paid', needs_refund = true, issued_seats = issued_seats + v_back, updated_at = clock_timestamp() where id = o.id;
    end if;
  else
    update public.ev_orders set status = 'refund_pending', updated_at = clock_timestamp() where id = f.order_id and status = 'paid';
  end if;
  return jsonb_build_object('ok', true, 'order_id', f.order_id, 'status', v_st, 'changed', true, 'tickets_restored', v_back);
end $$;

-- dispute.created / dispute.updated: a flag on the order for a person to look at. Nothing is voided automatically.
create or replace function public.ev_pay_dispute_flag(p_charge text, p_dispute text, p_status text, p_amount text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.ev_orders;
begin
  select * into o from public.ev_orders where bachs_charge_id = p_charge for update;
  if o.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  update public.ev_orders set dispute_id = left(p_dispute, 200), dispute_status = left(p_status, 50),
         flag_review = coalesce(flag_review, 'dispute'), updated_at = clock_timestamp() where id = o.id;
  return jsonb_build_object('ok', true, 'order_id', o.id);
end $$;

-- ============================ SIGNED-IN PEOPLE ============================
create or replace function public.ev_pay_host_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare h public.ev_host_payouts;
begin
  select * into h from public.ev_host_payouts where user_id = auth.uid();
  if h.user_id is null then
    return jsonb_build_object('status', 'not_started', 'capabilities', '{}'::jsonb, 'requirements_due', '[]'::jsonb, 'can_sell', false,
                              'dashboard_url', 'https://dashboard.bachs.io');
  end if;
  return jsonb_build_object(
    'status', h.status, 'capabilities', h.capabilities,
    'requirements_due', coalesce((select jsonb_agg(public._ev_pay_req_words(x.v) order by x.v) from jsonb_array_elements_text(h.requirements_due) x(v)), '[]'::jsonb),
    'can_sell', h.can_sell, 'dashboard_url', 'https://dashboard.bachs.io');
end $$;

create or replace function public.ev_pay_my_order(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o public.ev_orders;
begin
  select * into o from public.ev_orders where id = p_order and buyer_id = auth.uid();
  if o.id is null then return null; end if;
  return public._ev_pay_order_json(o, true);
end $$;

create or replace function public.ev_pay_my_orders() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(public._ev_pay_order_json(o, true) order by o.created_at desc, o.id)
                     from public.ev_orders o where o.id in (select x.id from public.ev_orders x where x.buyer_id = auth.uid() order by x.created_at desc limit 100)), '[]'::jsonb);
end $$;

-- The host's view of an event's orders (never the checkout link).
create or replace function public.ev_pay_event_orders(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public._ev_manage(p_event) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(public._ev_pay_order_json(o, false) order by o.created_at desc, o.id)
                     from public.ev_orders o where o.id in (select x.id from public.ev_orders x where x.event_id = p_event order by x.created_at desc limit 500)), '[]'::jsonb);
end $$;

-- Sales per ticket type, with both fees and the host's net. Paid orders that issued seats only. Null for anyone but the host and staff.
create or replace function public.ev_pay_sales(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rows   jsonb;
  v_tot    jsonb;
begin
  if auth.uid() is null or not public._ev_manage(p_event) then return null; end if;
  with per as (
    select t.id, t.name, t.price_naira, t.sort,
           coalesce(sum(o.quantity), 0)::int as sold,
           coalesce(sum(o.gross_kobo), 0) as gross,
           coalesce(sum(o.platform_fee_kobo), 0) as pf,
           coalesce(sum(coalesce(o.processing_fee_kobo, 0)), 0) as proc
      from public._ev_types(p_event) t
      left join public.ev_orders o on o.ticket_type_id = t.id and o.event_id = p_event and o.status = 'paid' and not o.needs_refund
     group by t.id, t.name, t.price_naira, t.sort)
  select coalesce(jsonb_agg(jsonb_build_object(
           'ticket_type_id', per.id, 'name', per.name, 'price_naira', per.price_naira, 'sold', per.sold,
           'gross_naira', public._ev_pay_naira(per.gross), 'platform_fee_naira', public._ev_pay_naira(per.pf),
           'processing_fee_naira', public._ev_pay_naira(per.proc), 'net_naira', public._ev_pay_naira(per.gross - per.pf - per.proc)) order by per.sort, per.id), '[]'::jsonb),
         jsonb_build_object(
           'sold', coalesce(sum(per.sold), 0), 'gross_naira', public._ev_pay_naira(coalesce(sum(per.gross), 0)),
           'platform_fee_naira', public._ev_pay_naira(coalesce(sum(per.pf), 0)), 'processing_fee_naira', public._ev_pay_naira(coalesce(sum(per.proc), 0)),
           'net_naira', public._ev_pay_naira(coalesce(sum(per.gross - per.pf - per.proc), 0)))
    into v_rows, v_tot from per;
  v_tot := v_tot || jsonb_build_object('refunded_naira', public._ev_pay_naira(coalesce(
             (select sum(o.gross_kobo) from public.ev_orders o where o.event_id = p_event and o.status in ('refunded', 'refund_pending')), 0)));
  return jsonb_build_object(
    'rows', v_rows, 'totals', v_tot,
    'open_orders', (select count(*)::int from public.ev_orders o where o.event_id = p_event and o.status = 'open' and o.expires_at + interval '2 minutes' > now()),
    'refunds_owed', (select count(*)::int from public.ev_orders o where o.event_id = p_event and o.status <> 'refunded' and (o.needs_refund or o.needs_manual_refund)));
end $$;

-- The host (or staff) paid a bank transfer buyer back by hand.
create or replace function public.ev_pay_mark_manual_refund(p_order uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  o  public.ev_orders;
  v_ev public.events;
begin
  if me is null then return 'no_session'; end if;
  select * into o from public.ev_orders where id = p_order;
  if o.id is null then return 'not_found'; end if;
  select * into v_ev from public.events where id = o.event_id for update;
  if me is distinct from coalesce(v_ev.host_id, v_ev.created_by) and not public._ev_staff() then return 'not_allowed'; end if;
  select * into o from public.ev_orders where id = p_order for update;
  if o.status <> 'paid' or not o.needs_manual_refund then return 'nothing_to_mark'; end if;
  update public.ev_refunds set status = 'manual_done', updated_at = clock_timestamp(), created_by = coalesce(created_by, me)
   where order_id = o.id and method = 'manual' and status = 'manual_needed';
  if not found then
    insert into public.ev_refunds (order_id, reference, amount_kobo, method, status, created_by)
    values (o.id, 'rf_' || replace(o.id::text, '-', '') || '_m', o.gross_kobo, 'manual', 'manual_done', me)
    on conflict (reference) do nothing;
  end if;
  update public.ev_orders set status = 'refunded', refunded_at = now(), needs_refund = false, needs_manual_refund = false, updated_at = clock_timestamp() where id = o.id;
  return 'ok';
end $$;

-- ----------------------------------------------------------------- access ---
do $acl$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'ev_pay_host_save_account', 'ev_pay_host_apply_capability', 'ev_pay_host_apply_requirements', 'ev_pay_order_reserve', 'ev_pay_order_attach',
       'ev_pay_order_release', 'ev_pay_event_record', 'ev_pay_event_processed', 'ev_pay_order_paid', 'ev_pay_order_details', 'ev_pay_order_expire',
       'ev_pay_sweep', 'ev_pay_refund_start', 'ev_pay_refund_apply', 'ev_pay_dispute_flag', 'ev_pay_host_status', 'ev_pay_my_order',
       'ev_pay_my_orders', 'ev_pay_event_orders', 'ev_pay_sales', 'ev_pay_mark_manual_refund')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $acl$;
grant execute on function public.ev_pay_host_status(), public.ev_pay_my_order(uuid), public.ev_pay_my_orders(), public.ev_pay_event_orders(uuid),
  public.ev_pay_sales(uuid), public.ev_pay_mark_manual_refund(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
