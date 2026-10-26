-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Host balances and withdrawals (supabase/events_r1_payouts.sql). LOCAL ONLY: everything rolls back.
-- Needs the events_r1_ files, events_r1_pay.sql and events_r1_payouts.sql loaded. Ends with ALL EVENTS R1 PAYOUTS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_payouts_test.sql
begin;
select public.ev_set_setting('events_r1', 'on');
select public.ev_set_setting('paid_tickets', 'on');
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$
begin
  if v is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.actor(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.newuser(shown text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po-' || u || '@evtest.invalid', false, '{}', json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
create function pg_temp.j(u uuid, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(u);
  execute q into r;
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.ev(host uuid, ttl text, starts timestamptz default now() + interval '2 days') returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id) values (ttl, 'Somewhere', starts, 'live', host) returning id;
$$;
create function pg_temp.ty(ev uuid, price int) returns uuid language sql as $$
  insert into public.ev_ticket_types (event_id, name, price_naira, sort) values (ev, 'GA', price, 1) returning id;
$$;
-- Reserve (4.5 percent fee), attach, pay with the buyer's fee on top. Returns the order id.
create function pg_temp.sale(u uuid, ev uuid, ty uuid, price int) returns uuid language plpgsql as $$
declare r jsonb; oid uuid;
begin
  r := public.ev_pay_order_reserve(u, ev, ty, 1, round(price::numeric * 100 * 0.045)::bigint, '{}', null);
  if not (r ->> 'ok')::boolean then raise exception 'reserve failed: %', r; end if;
  oid := (r ->> 'order_id')::uuid;
  perform public.ev_pay_order_attach(oid, 'chk_' || replace(oid::text, '-', ''), 'https://checkout.bachs.io/c/' || oid, now() + interval '15 minutes');
  -- Bachs reports the gross plus its fee (N200 on a card), which the buyer paid on top.
  r := public.ev_pay_order_paid('chk_' || replace(oid::text, '-', ''), 'ch_' || replace(oid::text, '-', ''), to_char(price + 200, 'FM9999990') || '.00', 'card', 20000);
  if not (r ->> 'issued')::boolean or (r ->> 'flag_review')::boolean then raise exception 'pay failed: %', r; end if;
  return oid;
end $$;
create function pg_temp.sum(u uuid) returns jsonb language sql as $$ select pg_temp.j(u, 'select public.ev_payout_summary()'); $$;

do $$
declare
  h  uuid := pg_temp.newuser('Payout Host');
  h2 uuid := pg_temp.newuser('Payout Host Two');
  b1 uuid := pg_temp.newuser('Buyer One');
  b2 uuid := pg_temp.newuser('Buyer Two');
  e1 uuid; t1 uuid; eold uuid; told uuid; o1 uuid; o2 uuid; o3 uuid;
  r jsonb; w jsonb; d jsonb; wid uuid;
begin
  -- ================================================== a sale lands as the host's share ========
  e1 := pg_temp.ev(h, 'Payout night'); t1 := pg_temp.ty(e1, 10000);
  o1 := pg_temp.sale(b1, e1, t1, 10000);
  perform pg_temp.ok((select host_account from public.ev_orders where id = o1) = 'platform' and (select buyer_pays_fee from public.ev_orders where id = o1),
                     'the order is Hoppaz''s (platform) and the buyer paid the fee on top');
  r := pg_temp.sum(h);
  perform pg_temp.ok((r ->> 'earned_naira')::numeric = 9550 and (r ->> 'reserved_naira')::numeric = 478 and (r ->> 'available_naira')::numeric = 9072,
                     'N10,000 ticket: earned 9,550 (less Hoppaz''s 4.5 percent), 478 held (5 percent, rounded up), 9,072 available');
  perform pg_temp.ok((r -> 'reserve_until') is not null and (r ->> 'reserve_until')::timestamptz > now() + interval '30 days', 'held until 30 days after the event ends');
  perform pg_temp.ok(not (r -> 'account' ->> 'has_account')::boolean and not (r -> 'account' ->> 'ready')::boolean, 'no payout account yet');
  perform pg_temp.ok(pg_temp.sum(h2) ->> 'earned_naira' = '0.00' or (pg_temp.sum(h2) ->> 'earned_naira')::numeric = 0, 'another host earns nothing from it');

  -- ================================================== a past event: nothing held ========
  eold := pg_temp.ev(h, 'Long ago', now() + interval '1 hour'); told := pg_temp.ty(eold, 2000);
  o2 := pg_temp.sale(b2, eold, told, 2000);
  update public.events set starts_at = now() - interval '40 days', ends_at = now() - interval '40 days' + interval '3 hours' where id = eold;
  r := pg_temp.sum(h);
  perform pg_temp.ok((r ->> 'earned_naira')::numeric = 9550 + 1910 and (r ->> 'reserved_naira')::numeric = 478 and (r ->> 'available_naira')::numeric = 9072 + 1910,
                     'an event over 30 days ago holds nothing back: its whole share is available');

  -- ================================================== withdrawing ========
  r := pg_temp.j(h, 'select public.ev_payout_request()');
  perform pg_temp.ok(r ->> 'reason' = 'needs_bank', 'no ready payout account: needs_bank');
  perform public.ev_pay_host_save_account(h, 'acct_payouthost1');
  perform public.ev_pay_host_apply_capability('acct_payouthost1', 'transfers', 'active');
  perform public.ev_pay_host_apply_capability('acct_payouthost1', 'payouts', 'active');
  perform pg_temp.ok(public.ev_payout_set_bank_label(h, 'GTBank Plc ending 6789') = 'ok' and public.ev_payout_set_bank_label(h2, 'x') = 'no_account', 'the bank label');
  r := pg_temp.sum(h);
  perform pg_temp.ok((r -> 'account' ->> 'ready')::boolean and r -> 'account' ->> 'bank_label' = 'GTBank Plc ending 6789', 'ready, with the bank shown');
  r := pg_temp.j(h, 'select public.ev_payout_request()');
  w := r -> 'withdrawal';
  wid := (w ->> 'id')::uuid;
  perform pg_temp.ok((r ->> 'ok')::boolean and (w ->> 'amount_naira')::numeric = 10982 and w ->> 'status' = 'requested'
                     and (w ->> 'execute_after')::timestamptz between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute',
                     'the whole available balance (10,982), sent a day later');
  perform pg_temp.ok(pg_temp.j(h, 'select public.ev_payout_request()') ->> 'reason' = 'already_requested', 'one withdrawal at a time');
  r := pg_temp.sum(h);
  perform pg_temp.ok((r ->> 'available_naira')::numeric = 0 and (r ->> 'withdrawn_naira')::numeric = 10982 and r -> 'open_withdrawal' ->> 'id' = wid::text, 'nothing left to withdraw, the withdrawal shows');
  perform pg_temp.ok(public.ev_payout_due(20) = '[]'::jsonb, 'not due before its day');

  -- ================================================== the sweeper moves it ========
  update public.ev_withdrawals set execute_after = now() - interval '1 minute' where id = wid;
  d := public.ev_payout_due(20);
  perform pg_temp.ok(jsonb_array_length(d) = 1 and d -> 0 ->> 'status' = 'requested' and d -> 0 ->> 'account' = 'acct_payouthost1' and (d -> 0 ->> 'amount_kobo')::bigint = 1098200,
                     'due: the transfer to the host''s account, in kobo');
  perform pg_temp.ok(public.ev_payout_due(20) = '[]'::jsonb, 'claimed: a second sweep does not take it again');
  perform pg_temp.ok(public.ev_payout_note(wid, 'transfer: waiting for Hoppaz''s payments to settle') = 'ok', 'a failed try is noted');
  update public.ev_withdrawals set last_attempt_at = now() - interval '11 minutes' where id = wid;
  perform pg_temp.ok(jsonb_array_length(public.ev_payout_due(20)) = 1, 'and tried again 10 minutes later');
  perform pg_temp.ok(public.ev_payout_transferred(wid, 'tr_1') = 'ok' and public.ev_payout_transferred(wid, 'tr_1') = 'not_requested', 'transferred, once');
  perform pg_temp.ok(public.ev_payout_paying(wid, 'pay_1', 1093200, 5000) = 'ok', 'the payout is under way (amount less the N50 fee)');
  perform pg_temp.ok(public.ev_payout_result('pay_1', 'failed', 'bank said no') ->> 'status' = 'transferred', 'a failed payout goes back to transferred (the money is in the host''s account)');
  perform pg_temp.ok(public.ev_payout_paying(wid, 'pay_2', 1093200, 5000) = 'ok' and public.ev_payout_result('pay_2', 'completed') ->> 'status' = 'paid', 'paid out again, then paid');
  perform pg_temp.ok(public.ev_payout_result('pay_2', 'failed') ->> 'changed' = 'false', 'paid is final');
  r := pg_temp.sum(h);
  perform pg_temp.ok(r -> 'open_withdrawal' = 'null'::jsonb and r -> 'recent' -> 0 ->> 'status' = 'paid' and (r -> 'recent' -> 0 ->> 'received_naira')::numeric = 10932
                     and (r -> 'recent' -> 0 ->> 'fee_naira')::numeric = 50, 'the host sees what reached the bank and the fee');

  -- ================================================== a refund after withdrawing ========
  update public.ev_orders set status = 'refunded', refunded_at = now() where id = o2;
  r := pg_temp.sum(h);
  perform pg_temp.ok((r ->> 'balance_naira')::numeric = 9550 - 10982 and (r ->> 'available_naira')::numeric = 0,
                     'a refund after the withdrawal: the balance goes below zero (owed from the next sales), nothing available');
  o3 := pg_temp.sale(b2, e1, t1, 10000);
  r := pg_temp.sum(h);
  perform pg_temp.ok((r ->> 'available_naira')::numeric = greatest(0, 9550 * 2 - 956 - 10982), 'the next sale pays it back first');

  -- ================================================== access ========
  perform pg_temp.actor(h);
  begin
    perform public.ev_payout_due(20);
    perform pg_temp.ok(false, 'a signed-in person must not run the sweeper''s function');
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'the sweeper''s functions are service role only');
  end;
  perform pg_temp.admin();
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ev_withdrawals', 'select'), 'nobody signed in reads the withdrawals table directly');
  raise notice 'ALL EVENTS R1 PAYOUTS TESTS PASSED';
end $$;
rollback;
