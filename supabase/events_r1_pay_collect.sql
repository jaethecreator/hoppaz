-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1, file 9: HOPPAZ COLLECTS (26 Oct 2026). Bachs "You collect the payment", the marketplace shape, decided by Jae.
--
-- RUN ORDER: after events_r1_pay.sql (file 7), before events_r1_payouts.sql (file 10). Safe to run again. One transaction.
-- It leaves events_r1_pay.sql untouched and replaces six of its functions here, so the change is one file Ola can read on its own:
--   _ev_host_can_sell     any host can sell paid tickets at once (no payout setup first)
--   _ev_pay_recompute     ev_host_payouts.can_sell now means "can withdraw": transfers AND payouts active (the host is a recipient)
--   ev_pay_order_reserve  every order is collected on Hoppaz's own Bachs account (host_account 'platform') with buyer_pays_fee
--   ev_pay_order_paid     the gross plus the processing fee the buyer paid on top is exact, not "overpaid"
--   _ev_pay_order_json    the host's net is the gross less Hoppaz's fee when the buyer paid the processing fee
--   ev_pay_sales          the same for the sales totals
-- and adds one column, ev_orders.buyer_pays_fee. Orders made before it keep false (the host bore the fee) and every old rule still
-- applies to them. The order, refund and dispute rules of file 7 are unchanged; where they say the host's account, read Hoppaz's.
-- Host balances and withdrawals are file 10 (events_r1_payouts.sql). Guide: supabase/EVENTS_R1_PAY.md, section "26 Oct 2026".
-- ============================================================================
begin;

-- The buyer pays Bachs's processing fee on top (customer_bears_fee), so it is never taken from the host's share.
alter table public.ev_orders add column if not exists buyer_pays_fee boolean not null default false;

-- Hoppaz collects every payment, so any host can sell paid tickets at once: no payout setup first. The bank details are asked for
-- only when the host withdraws (events_r1_payouts.sql). ev_host_payouts.can_sell now means "can withdraw".
create or replace function public._ev_host_can_sell(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_user is not null and exists (select 1 from public.profiles p where p.id = p_user);
$$;
revoke all on function public._ev_host_can_sell(uuid) from public, anon, authenticated;

-- can_sell (now: can withdraw) and status from the capabilities. A host is a recipient: Hoppaz sends them their share (transfers) and they take
-- it to their bank (payouts). Both must be active.
create or replace function public._ev_pay_recompute(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h public.ev_host_payouts;
  v_sell boolean;
  v_any boolean;
begin
  select * into h from public.ev_host_payouts where user_id = p_user for update;
  if h.user_id is null then return; end if;
  -- coalesce: a missing capability reads as null, and null and true is null (the column is not null).
  v_sell := coalesce((h.capabilities ->> 'transfers') = 'active' and (h.capabilities ->> 'payouts') = 'active', false);
  v_any := exists (select 1 from jsonb_each_text(h.capabilities) c where c.value = 'active');
  update public.ev_host_payouts
     set can_sell = v_sell,
         status = case when v_sell then 'ready' when v_any then 'restricted' else 'in_progress' end,
         updated_at = now()
   where user_id = p_user;
end $$;
revoke all on function public._ev_pay_recompute(uuid) from public, anon, authenticated;

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
    -- The buyer paid the processing fee on top (buyer_pays_fee): the host's share is the gross less Hoppaz's fee, known at once.
    'host_net_naira', case when o.paid_at is null then null
                           when o.buyer_pays_fee then public._ev_pay_naira(o.gross_kobo - o.platform_fee_kobo)
                           when o.processing_fee_kobo is null then null
                           else public._ev_pay_naira(o.gross_kobo - o.platform_fee_kobo - o.processing_fee_kobo) end,
    'status', o.status, 'payment_method', o.payment_method, 'created_at', o.created_at, 'expires_at', o.expires_at, 'paid_at', o.paid_at,
    'checkout_url', case when p_show_url and o.status = 'open' then o.checkout_url else null end,
    'needs_refund', o.needs_refund, 'needs_manual_refund', o.needs_manual_refund,
    'refund_reason', case when o.needs_refund then o.refund_reason else null end);
$$;
revoke all on function public._ev_pay_order_json(public.ev_orders, boolean) from public, anon, authenticated;

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
  if not public._ev_open() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if p_qty is null or p_qty < 1 or p_qty > 5 then return jsonb_build_object('ok', false, 'reason', 'bad_qty'); end if;
  select * into e from public.events where id = p_event for update;
  if e.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public._ev_paid_on() then return jsonb_build_object('ok', false, 'reason', 'paid_off'); end if;
  -- No host, no seller: an old listing (its created_by is only whoever dropped it) is never sold, whatever its door price says.
  if e.host_id is null then return jsonb_build_object('ok', false, 'reason', 'no_host'); end if;
  if e.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  if e.status not in ('live', 'unlisted') then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if e.visibility = 'community' and not public._ev_in_room(e.room_id, p_user) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if now() > coalesce(e.ends_at, e.starts_at + interval '3 hours') then return jsonb_build_object('ok', false, 'reason', 'event_over'); end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  if coalesce(v_email, '') = '' then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;

  select x.id, x.name, x.price_naira into t from public._ev_types(p_event) x where x.id = p_type;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'bad_ticket'); end if;
  if t.price_naira <= 0 then return jsonb_build_object('ok', false, 'reason', 'not_paid_type'); end if;
  v_host := e.host_id;
  -- Hoppaz collects the payment on its own Bachs account ('platform'); the host's share is paid out later (events_r1_payouts.sql).
  v_acct := 'platform';

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
                                host_account, bachs_reference, expires_at, answers, referrer_id, buyer_pays_fee)
  values (v_id, p_user, p_event, t.id, t.name, p_qty, t.price_naira::bigint * 100, v_gross, p_fee_kobo, v_acct,
          'ord_' || replace(v_id::text, '-', ''), now() + interval '15 minutes', v_ans, v_ref, true)
  returning * into o;
  return jsonb_build_object('ok', true, 'order_id', o.id, 'reference', o.bachs_reference, 'gross_kobo', o.gross_kobo,
                            'platform_fee_kobo', o.platform_fee_kobo, 'unit_price_kobo', o.unit_price_kobo, 'quantity', o.quantity,
                            'host_account', o.host_account, 'buyer_email', v_email, 'buyer_name', v_name,
                            'expires_at', o.expires_at, 'event_id', e.id, 'event_title', e.title, 'ticket_name', t.name);
end $$;

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
  -- A buyer who paid the processing fee on top paid exactly the gross plus that fee: that is exact, not overpaid.
  if v_kobo > o.gross_kobo and not (o.buyer_pays_fee and p_fee_kobo is not null and v_kobo = o.gross_kobo + p_fee_kobo) then v_flag := 'overpaid'; end if;

  -- An event that is cancelled, hidden, pending or rejected issues nothing, on every path (on time or late): the money is owed back.
  if not exists (select 1 from public.events e where e.id = o.event_id and e.status in ('live', 'unlisted')) then
    v_refund := true;
  end if;
  if o.status in ('expired', 'failed') or (o.status = 'open' and o.expires_at + interval '2 minutes' < now()) then
    -- A late payment (the hold ran out, expired or not yet swept): take the seats again if they are free (this order no longer holds any).
    v_late := true;
    v_left := public._ev_type_left(o.event_id, o.ticket_type_id);
    if v_left is not null and v_left < o.quantity then v_refund := true; end if;
  end if;
  if not v_refund then
    v_issued := public._ev_pay_issue(o.id);
    if v_issued < 0 then v_refund := true; v_issued := 0; end if;
  end if;

  update public.ev_orders
     set status = 'paid', paid_at = now(), bachs_charge_id = coalesce(nullif(p_charge, ''), bachs_charge_id), payment_method = v_method,
         processing_fee_kobo = coalesce(p_fee_kobo, processing_fee_kobo), flag_review = coalesce(v_flag, flag_review),
         -- A refund owed with the method not known yet (checkout.completed can arrive before collection.succeeded, and has no method) is manual
         -- until the method says card (ev_pay_order_details then hands a card payment to the automatic refund). coalesce: true and null is null.
         needs_refund = v_refund, needs_manual_refund = coalesce(v_refund and v_method is distinct from 'card', false), reconcile = false,
         refund_reason = case when v_refund and v_late then 'late' else null end,
         issued_seats = case when v_refund then 0 else issued_seats end, updated_at = clock_timestamp()
   where id = o.id;
  return jsonb_build_object('ok', true, 'order_id', o.id, 'issued', not v_refund, 'late', v_late, 'needs_refund', v_refund,
                            'flag_review', v_flag is not null or o.flag_review is not null, 'seats', v_issued);
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
           -- Only what the host bears: a fee the buyer paid on top is not taken from the host's net.
           coalesce(sum(case when o.buyer_pays_fee then 0 else coalesce(o.processing_fee_kobo, 0) end), 0) as proc
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


-- ----------------------------------------------------------------- access ---
-- create or replace keeps a function's grants; this says them again so the file stands on its own.
do $acl$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('ev_pay_order_reserve', 'ev_pay_order_paid', 'ev_pay_sales')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $acl$;
grant execute on function public.ev_pay_sales(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
