-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1, file 10: host balances and withdrawals (Hoppaz collects; Bachs "You collect the payment").
--
-- RUN ORDER: after events_r1_pay.sql (file 7) and events_r1_pay_collect.sql (file 9). Safe to run again. One transaction. It adds two columns to ev_host_payouts, one table
-- (ev_withdrawals) and its functions; it edits nothing else.
--
-- THE MONEY (decided by Jae, 26 Oct 2026)
--  * Every paid ticket is collected on Hoppaz's own Bachs account. The buyer pays Bachs's processing fee on top.
--  * Hoppaz keeps its fee: HOPPAZ_TICKET_FEE_PERCENT (4.5) of the ticket price, taken from the host's side (orders.platform_fee_kobo).
--  * The host's share of a paid order is gross - Hoppaz's fee (minus the processing fee only on an old order where the host bore it).
--  * 5 percent of each share is held back until 30 days after the event ends (chargebacks). The rest is the host's to withdraw.
--  * A refunded order, one owed back to the buyer, or one with a lost dispute earns the host nothing. If the host already withdrew, the
--    balance goes below zero and their next sales pay it back first (Hoppaz carries the gap meanwhile; the reserve is there for this).
--
-- A WITHDRAWAL
--  1. The host asks (ev_payout_request). Their payout account must be ready: a Bachs recipient account with transfers and payouts active,
--     which needs only a name, date of birth, address and a bank account that resolves (the route /api/events-r1/pay/payout-setup sends it).
--     The whole available balance is withdrawn (at least N1,000), and it is sent a day later (execute_after).
--  2. The sweeper (/api/events-r1/pay/sweep) takes due withdrawals (ev_payout_due), sends the amount from Hoppaz's balance to the host's Bachs
--     account (POST /v1/transfers), then pays it out from there to their bank (POST /v1/payouts as the host). Bachs's withdrawal fee (N50 in the
--     sandbox) comes out of the amount: the bank receives the amount less that fee.
--  3. payout.paid / payout.failed (webhook) settle it. A failed payout leaves the money in the host's Bachs account and is tried again.
--  A transfer refused for INSUFFICIENT_BALANCE (Hoppaz's payments not settled yet, a day or two in live) stays requested and is retried.
-- ============================================================================
begin;

-- What the host sees of their bank, for the screen ("GTBank Plc ending 6789"). Nothing else about the bank is kept here: Bachs holds it.
alter table public.ev_host_payouts add column if not exists bank_label text check (bank_label is null or char_length(bank_label) <= 120);

create table if not exists public.ev_withdrawals (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  -- What leaves the host's Hoppaz balance: the transfer to their Bachs account. The bank receives this less Bachs's withdrawal fee.
  amount_kobo        bigint not null check (amount_kobo > 0),
  status             text not null default 'requested' check (status in ('requested', 'transferred', 'paying', 'paid', 'cancelled')),
  reference          text not null unique check (reference ~ '^wd_[a-f0-9]{32}$'),
  execute_after      timestamptz not null,
  bachs_account_id   text not null check (bachs_account_id ~ '^acct_[A-Za-z0-9_]{3,100}$'),
  bachs_transfer_id  text,
  bachs_payout_id    text,
  payout_tries       integer not null default 0,
  payout_amount_kobo bigint check (payout_amount_kobo is null or payout_amount_kobo > 0),
  payout_fee_kobo    bigint check (payout_fee_kobo is null or payout_fee_kobo >= 0),
  attempts           integer not null default 0,
  last_attempt_at    timestamptz,
  last_error         text,
  paid_at            timestamptz,
  created_at         timestamptz not null default clock_timestamp(),
  updated_at         timestamptz not null default clock_timestamp()
);
-- One withdrawal under way per host.
create unique index if not exists ev_withdrawals_open_idx on public.ev_withdrawals (user_id) where status in ('requested', 'transferred', 'paying');
create index if not exists ev_withdrawals_due_idx on public.ev_withdrawals (execute_after) where status in ('requested', 'transferred');
create index if not exists ev_withdrawals_user_idx on public.ev_withdrawals (user_id, created_at desc);
alter table public.ev_withdrawals enable row level security;
revoke all on public.ev_withdrawals from anon, authenticated;
grant all on public.ev_withdrawals to service_role;

-- --------------------------------------------------------------- the rules ---
create or replace function public._ev_payout_rules() returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object('reserve_percent', 5, 'reserve_days', 30, 'delay_hours', 24, 'min_kobo', 100000);
$$;
revoke all on function public._ev_payout_rules() from public, anon, authenticated;

-- The host's balance in kobo. Shares of paid orders Hoppaz collected, for events this person hosts.
create or replace function public._ev_payout_balance(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with rules as (select public._ev_payout_rules() r),
  shares as (
    select o.gross_kobo - o.platform_fee_kobo - case when o.buyer_pays_fee then 0 else coalesce(o.processing_fee_kobo, 0) end as share,
           coalesce(e.ends_at, e.starts_at + interval '3 hours') + make_interval(days => ((select r from rules) ->> 'reserve_days')::int) as release_at
      from public.ev_orders o join public.events e on e.id = o.event_id
     where e.host_id = p_user and o.host_account = 'platform' and o.status = 'paid' and not o.needs_refund
       and coalesce(lower(o.dispute_status), '') not in ('lost', 'charge_refunded')),
  sums as (
    select coalesce(sum(s.share), 0)::bigint as earned,
           -- Held per order, rounded UP to a whole naira, so every amount the host sees and withdraws is whole naira.
           coalesce(sum(case when s.release_at > now()
                             then ceil(s.share * ((select r from rules) ->> 'reserve_percent')::numeric / 10000) * 100 else 0 end), 0)::bigint as reserved,
           min(s.release_at) filter (where s.release_at > now()) as reserve_until
      from shares s),
  gone as (
    select coalesce(sum(w.amount_kobo), 0)::bigint as withdrawn,
           coalesce(sum(w.amount_kobo) filter (where w.status <> 'paid'), 0)::bigint as on_the_way
      from public.ev_withdrawals w where w.user_id = p_user and w.status <> 'cancelled')
  select jsonb_build_object(
    'earned_kobo', s.earned, 'reserved_kobo', s.reserved, 'reserve_until', s.reserve_until,
    'withdrawn_kobo', g.withdrawn, 'on_the_way_kobo', g.on_the_way,
    'balance_kobo', s.earned - g.withdrawn,
    'available_kobo', greatest(0, s.earned - s.reserved - g.withdrawn))
  from sums s, gone g;
$$;
revoke all on function public._ev_payout_balance(uuid) from public, anon, authenticated;

create or replace function public._ev_withdrawal_json(w public.ev_withdrawals) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', w.id, 'amount_naira', public._ev_pay_naira(w.amount_kobo), 'status', w.status, 'execute_after', w.execute_after,
    'received_naira', case when w.payout_amount_kobo is null then null else public._ev_pay_naira(w.payout_amount_kobo) end,
    'fee_naira', case when w.payout_fee_kobo is null then null else public._ev_pay_naira(w.payout_fee_kobo) end,
    'created_at', w.created_at, 'paid_at', w.paid_at);
$$;
revoke all on function public._ev_withdrawal_json(public.ev_withdrawals) from public, anon, authenticated;

-- ============================ SIGNED-IN HOST ============================
-- Everything the host's money screen needs.
create or replace function public.ev_payout_summary() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  h  public.ev_host_payouts;
  b  jsonb;
  w  public.ev_withdrawals;
begin
  if me is null then return null; end if;
  select * into h from public.ev_host_payouts where user_id = me;
  b := public._ev_payout_balance(me);
  select * into w from public.ev_withdrawals where user_id = me and status in ('requested', 'transferred', 'paying') limit 1;
  return jsonb_build_object(
    'account', jsonb_build_object(
      'has_account', h.user_id is not null, 'ready', coalesce(h.can_sell, false), 'bank_label', h.bank_label,
      'requirements_due', coalesce((select jsonb_agg(public._ev_pay_req_words(x.v) order by x.v) from jsonb_array_elements_text(coalesce(h.requirements_due, '[]'::jsonb)) x(v)), '[]'::jsonb)),
    'earned_naira', public._ev_pay_naira((b ->> 'earned_kobo')::bigint),
    'reserved_naira', public._ev_pay_naira((b ->> 'reserved_kobo')::bigint),
    'reserve_until', b -> 'reserve_until',
    'withdrawn_naira', public._ev_pay_naira((b ->> 'withdrawn_kobo')::bigint),
    'available_naira', public._ev_pay_naira((b ->> 'available_kobo')::bigint),
    'balance_naira', public._ev_pay_naira((b ->> 'balance_kobo')::bigint),
    'open_withdrawal', case when w.id is null then null else public._ev_withdrawal_json(w) end,
    'recent', coalesce((select jsonb_agg(public._ev_withdrawal_json(x) order by x.created_at desc)
                          from (select * from public.ev_withdrawals where user_id = me order by created_at desc limit 10) x), '[]'::jsonb),
    'rules', jsonb_build_object('reserve_percent', 5, 'reserve_days', 30, 'delay_hours', 24, 'min_naira', 1000));
end $$;

-- Withdraw the whole available balance. It is sent a day later. { ok, withdrawal } or { ok: false, reason }:
-- no_session, needs_bank (no ready payout account yet), already_requested, too_small (with available_naira).
create or replace function public.ev_payout_request() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me     uuid := auth.uid();
  h      public.ev_host_payouts;
  b      jsonb;
  v_amt  bigint;
  v_id   uuid := gen_random_uuid();
  w      public.ev_withdrawals;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  -- The host row is the lock: two taps at once cannot both withdraw.
  select * into h from public.ev_host_payouts where user_id = me for update;
  if h.user_id is null or not h.can_sell then return jsonb_build_object('ok', false, 'reason', 'needs_bank'); end if;
  if exists (select 1 from public.ev_withdrawals x where x.user_id = me and x.status in ('requested', 'transferred', 'paying')) then
    return jsonb_build_object('ok', false, 'reason', 'already_requested');
  end if;
  b := public._ev_payout_balance(me);
  v_amt := (b ->> 'available_kobo')::bigint;
  if v_amt < (public._ev_payout_rules() ->> 'min_kobo')::bigint then
    return jsonb_build_object('ok', false, 'reason', 'too_small', 'available_naira', public._ev_pay_naira(v_amt));
  end if;
  insert into public.ev_withdrawals (id, user_id, amount_kobo, reference, execute_after, bachs_account_id)
  values (v_id, me, v_amt, 'wd_' || replace(v_id::text, '-', ''),
          now() + make_interval(hours => (public._ev_payout_rules() ->> 'delay_hours')::int), h.bachs_account_id)
  returning * into w;
  return jsonb_build_object('ok', true, 'withdrawal', public._ev_withdrawal_json(w));
end $$;

-- ============================ SERVICE ROLE ============================
-- The host's Bachs account is saved by the setup route (ev_pay_host_save_account, file 7); this keeps what the screen shows of the bank.
create or replace function public.ev_payout_set_bank_label(p_user uuid, p_label text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.ev_host_payouts set bank_label = left(nullif(btrim(p_label), ''), 120), updated_at = now() where user_id = p_user;
  return case when found then 'ok' else 'no_account' end;
end $$;

-- Due work for the sweeper: requested withdrawals past execute_after (send the transfer), and transferred ones (send the payout). Each is
-- claimed for 10 minutes so two sweeps never work on the same one, and a failing one waits 10 minutes before the next try.
create or replace function public.ev_payout_due(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_out jsonb;
begin
  with due as (
    update public.ev_withdrawals
       set attempts = attempts + 1, last_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
     where id in (select x.id from public.ev_withdrawals x
                   where ((x.status = 'requested' and x.execute_after <= now()) or x.status = 'transferred')
                     and (x.last_attempt_at is null or x.last_attempt_at < now() - interval '10 minutes')
                   order by x.execute_after limit greatest(1, least(coalesce(p_limit, 20), 100)) for update skip locked)
    returning *)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'reference', d.reference, 'user_id', d.user_id, 'status', d.status, 'amount_kobo', d.amount_kobo,
           'account', d.bachs_account_id, 'transfer_id', d.bachs_transfer_id, 'payout_tries', d.payout_tries, 'attempts', d.attempts)), '[]'::jsonb)
    into v_out from due d;
  return v_out;
end $$;

-- The transfer went through: the money is in the host's Bachs account.
create or replace function public.ev_payout_transferred(p_id uuid, p_transfer text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.ev_withdrawals set status = 'transferred', bachs_transfer_id = left(p_transfer, 200), last_error = null, updated_at = clock_timestamp()
   where id = p_id and status = 'requested';
  return case when found then 'ok' else 'not_requested' end;
end $$;

-- The payout was created at Bachs (pending): remember it. p_ref is the payout reference that was sent (one per try).
create or replace function public.ev_payout_paying(p_id uuid, p_payout text, p_amount_kobo bigint, p_fee_kobo bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.ev_withdrawals
     set status = 'paying', bachs_payout_id = left(p_payout, 200), payout_tries = payout_tries + 1,
         payout_amount_kobo = p_amount_kobo, payout_fee_kobo = p_fee_kobo, last_error = null, updated_at = clock_timestamp()
   where id = p_id and status = 'transferred';
  return case when found then 'ok' else 'not_transferred' end;
end $$;

-- A try that did not go through: keep the state, note why (the sweeper tries again after 10 minutes).
create or replace function public.ev_payout_note(p_id uuid, p_error text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.ev_withdrawals set last_error = left(coalesce(p_error, ''), 300), updated_at = clock_timestamp() where id = p_id;
  return case when found then 'ok' else 'not_found' end;
end $$;

-- payout.paid / payout.failed, found by the Bachs payout id. Paid is final. Failed sends it back to transferred: the money is still in the
-- host's Bachs account and the next sweep pays it out again (a new payout, a new reference).
create or replace function public.ev_payout_result(p_payout text, p_status text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare w public.ev_withdrawals;
begin
  select * into w from public.ev_withdrawals where bachs_payout_id = p_payout for update;
  if w.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if w.status = 'paid' then return jsonb_build_object('ok', true, 'id', w.id, 'changed', false); end if;
  if lower(coalesce(p_status, '')) in ('paid', 'completed', 'succeeded') then
    update public.ev_withdrawals set status = 'paid', paid_at = now(), last_error = null, updated_at = clock_timestamp() where id = w.id;
    return jsonb_build_object('ok', true, 'id', w.id, 'changed', true, 'status', 'paid');
  elsif lower(coalesce(p_status, '')) = 'failed' and w.status = 'paying' then
    update public.ev_withdrawals set status = 'transferred', last_error = left(coalesce(p_reason, 'payout failed'), 300), last_attempt_at = clock_timestamp(),
           updated_at = clock_timestamp() where id = w.id;
    return jsonb_build_object('ok', true, 'id', w.id, 'changed', true, 'status', 'transferred');
  end if;
  return jsonb_build_object('ok', true, 'id', w.id, 'changed', false);
end $$;

-- ----------------------------------------------------------------- access ---
do $acl$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'ev_payout_summary', 'ev_payout_request', 'ev_payout_set_bank_label', 'ev_payout_due', 'ev_payout_transferred', 'ev_payout_paying',
       'ev_payout_note', 'ev_payout_result')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $acl$;
grant execute on function public.ev_payout_summary(), public.ev_payout_request() to authenticated;

notify pgrst, 'reload schema';
commit;
