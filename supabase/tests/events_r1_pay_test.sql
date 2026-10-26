-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Release 1 paid tickets (supabase/events_r1_pay.sql). LOCAL ONLY: everything rolls back.
-- Needs the six events_r1_ files, events_r1_pay.sql and events_r1_pay_collect.sql (Hoppaz collects, 26 Oct) loaded. Ends with ALL EVENTS R1 PAY TESTS PASSED.
-- The service-role functions are called as the database owner here (as the SQL editor would); the access checks at the end and in the
-- middle show that anon and signed-in users cannot call them.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_pay_test.sql
begin;
-- Release 1 is switched on for the test (rolled back with everything else). The "off" cases switch it off again inside the test.
select public.ev_set_setting('events_r1', 'on');
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
create function pg_temp.anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.newuser(shown text, guest boolean default false) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          case when guest then null else 'pay-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
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
create function pg_temp.t(u uuid, q text) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.actor(u);
  execute q into r;
  perform pg_temp.admin();
  return r;
end $$;
-- A live event made straight in the table, with host, capacity and approval.
create function pg_temp.ev(host uuid, ttl text, cap int default null, appr boolean default false, starts timestamptz default now() + interval '2 days') returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id, capacity, requires_approval)
  values (ttl, 'Somewhere', starts, 'live', host, cap, appr) returning id;
$$;
create function pg_temp.ty(ev uuid, nm text, price int default 0, cap int default null, srt int default 0) returns uuid language sql as $$
  insert into public.ev_ticket_types (event_id, name, price_naira, capacity, sort) values (ev, nm, price, cap, srt) returning id;
$$;
-- 4.5 percent of the gross, in kobo.
create function pg_temp.fee(price int, qty int) returns bigint language sql as $$ select round(price::numeric * 100 * qty * 0.045)::bigint; $$;
create function pg_temp.res(u uuid, ev uuid, ty uuid, qty int, price int, ans jsonb default '{}') returns jsonb language sql as $$
  select public.ev_pay_order_reserve(u, ev, ty, qty, pg_temp.fee(price, qty), ans, null);
$$;
-- Reserve, attach a checkout, hand back the order id.
create function pg_temp.go(u uuid, ev uuid, ty uuid, qty int, price int) returns uuid language plpgsql as $$
declare r jsonb; oid uuid;
begin
  r := pg_temp.res(u, ev, ty, qty, price);
  if not (r ->> 'ok')::boolean then raise exception 'reserve failed: %', r; end if;
  oid := (r ->> 'order_id')::uuid;
  perform public.ev_pay_order_attach(oid, 'chk_' || replace(oid::text, '-', ''), 'https://checkout.bachs.io/c/' || oid, now() + interval '15 minutes');
  return oid;
end $$;
create function pg_temp.gross(oid uuid) returns text language sql as $$ select to_char(gross_kobo / 100.0, 'FM999999990.00') from public.ev_orders where id = oid; $$;
create function pg_temp.paid(oid uuid, meth text default 'bank_transfer', fee bigint default 15000) returns jsonb language sql as $$
  select public.ev_pay_order_paid('chk_' || replace(oid::text, '-', ''), 'ch_' || replace(oid::text, '-', ''), pg_temp.gross(oid), meth, fee);
$$;
create function pg_temp.st(oid uuid) returns text language sql as $$ select status from public.ev_orders where id = oid; $$;
create function pg_temp.tix(ev uuid, u uuid) returns int language sql as $$
  select count(*)::int from public.ev_tickets t join public.ev_registrations r on r.id = t.registration_id where r.event_id = ev and r.user_id = u and t.status in ('valid', 'used');
$$;
create function pg_temp.mine(u uuid, ev uuid) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_my_tickets(%L)', ev));
end $$;
create function pg_temp.scan(u uuid, ev uuid, tok text, mode text default 'express') returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_scan(%L, %L, %L)', ev, tok, mode));
end $$;
create function pg_temp.left_of(ev uuid, ty uuid) returns int language sql as $$
  select public._ev_type_left(ev, ty);
$$;

do $$
declare
  h uuid := pg_temp.newuser('Pay Host'); h2 uuid := pg_temp.newuser('Pay Host Two'); st uuid := pg_temp.newuser('Pay Staff');
  b1 uuid := pg_temp.newuser('Pay Ada'); b2 uuid := pg_temp.newuser('Pay Bola'); b3 uuid := pg_temp.newuser('Pay Chike'); b4 uuid := pg_temp.newuser('Pay Dayo');
  x uuid := pg_temp.newuser('Pay Stranger'); g uuid := pg_temp.newuser('Pay Guest', true);
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; eo uuid; ec uuid; vip uuid; fr uuid; vip2 uuid; vip3 uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid; o8 uuid; v3 uuid; v4 uuid; v5 uuid; r jsonb; t1 text; t2 text; n int; f record; tk jsonb; reg uuid;
begin
  update public.profiles set is_admin = true where id = st;
  perform public.ev_set_ticket_secret(repeat('s', 40), true);
  perform public.ev_set_setting('paid_tickets', 'on');

  -- ================================================== closed tables, service only ========
  perform pg_temp.ok(not exists (select 1 from information_schema.table_privileges where table_schema = 'public'
                                  and table_name in ('ev_host_payouts', 'ev_orders', 'ev_refunds', 'ev_bachs_events') and grantee in ('anon', 'authenticated')),
                     'LEAK CHECK: host payouts, orders, refunds and Bachs events are closed to anon and authenticated');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ev_orders', 'select') and not has_table_privilege('anon', 'public.ev_orders', 'select')
                     and not has_table_privilege('authenticated', 'public.ev_orders', 'insert') and not has_table_privilege('authenticated', 'public.ev_host_payouts', 'update'),
                     'and no signed-in user can read or write an order or a payout row');

  -- ================================================== host accounts: can_sell from capabilities ========
  r := pg_temp.j(h, 'select public.ev_pay_host_status()');
  perform pg_temp.ok(r ->> 'status' = 'not_started' and not (r ->> 'can_sell')::boolean and r -> 'capabilities' = '{}'::jsonb and r -> 'requirements_due' = '[]'::jsonb
                     and r ->> 'dashboard_url' = 'https://dashboard.bachs.io', 'a host with no account: not_started, cannot sell, the Bachs dashboard link');
  perform pg_temp.ok(public.ev_pay_host_save_account(h, 'acct_host1') = 'ok' and public.ev_pay_host_save_account(h, 'acct_host1') = 'ok', 'saving the account twice is fine');
  perform pg_temp.ok(public.ev_pay_host_save_account(h, 'acct_other') = 'already_has_account', 'a host cannot swap their account');
  perform pg_temp.ok(public.ev_pay_host_save_account(h2, 'acct_host1') = 'account_taken', 'two hosts cannot share an account');
  perform pg_temp.ok(public.ev_pay_host_save_account(h2, 'nope') = 'bad_account' and public.ev_pay_host_save_account(gen_random_uuid(), 'acct_zzz1') = 'no_such_user', 'a bad account id or user is refused');
  r := pg_temp.j(h, 'select public.ev_pay_host_status()');
  perform pg_temp.ok(r ->> 'status' = 'in_progress' and not (r ->> 'can_sell')::boolean, 'a new account: in progress, cannot withdraw');
  -- Hoppaz collects (26 Oct): can_sell now means "can withdraw": transfers AND payouts active. Collection capabilities no longer count.
  perform pg_temp.ok(public.ev_pay_host_apply_capability('acct_host1', 'payouts', 'active') = 'ok', 'payouts active');
  r := pg_temp.j(h, 'select public.ev_pay_host_status()');
  perform pg_temp.ok(not (r ->> 'can_sell')::boolean and r ->> 'status' = 'restricted' and r -> 'capabilities' ->> 'payouts' = 'active', 'payouts alone cannot withdraw');
  perform pg_temp.ok(public.ev_pay_host_apply_capability('acct_host1', 'bank_transfer', 'active', now()) = 'ok', 'a collection capability');
  perform pg_temp.ok(not (pg_temp.j(h, 'select public.ev_pay_host_status()') ->> 'can_sell')::boolean, 'collection does not count any more');
  perform pg_temp.ok(public.ev_pay_host_apply_capability('acct_host1', 'transfers', 'restricted', now()) = 'ok', 'transfers restricted');
  perform pg_temp.ok(not (pg_temp.j(h, 'select public.ev_pay_host_status()') ->> 'can_sell')::boolean, 'still cannot withdraw');
  perform pg_temp.ok(public.ev_pay_host_apply_capability('acct_host1', 'transfers', 'active', now() + interval '1 minute') = 'ok', 'it becomes active (newer event)');
  r := pg_temp.j(h, 'select public.ev_pay_host_status()');
  perform pg_temp.ok((r ->> 'can_sell')::boolean and r ->> 'status' = 'ready', 'transfers and payouts active: can withdraw, ready');
  perform pg_temp.ok(public.ev_pay_host_apply_capability('acct_host1', 'transfers', 'restricted', now() + interval '30 seconds') = 'stale', 'an OLDER event arriving late is ignored');
  perform pg_temp.ok((pg_temp.j(h, 'select public.ev_pay_host_status()') ->> 'can_sell')::boolean, 'so the host is still ready (events applied out of order)');
  perform pg_temp.ok(public.ev_pay_host_apply_capability('acct_host1', 'transfers', 'active', now() + interval '1 minute') = 'ok'
                     and (pg_temp.j(h, 'select public.ev_pay_host_status()') ->> 'can_sell')::boolean, 'the same event applied twice changes nothing');
  perform pg_temp.ok(public.ev_pay_host_apply_capability('acct_host1', 'payouts', 'restricted', now() + interval '3 minutes') = 'ok', 'payouts restricted');
  r := pg_temp.j(h, 'select public.ev_pay_host_status()');
  perform pg_temp.ok(not (r ->> 'can_sell')::boolean and r ->> 'status' = 'restricted', 'cannot withdraw again, and the status is restricted');
  perform pg_temp.ok(public.ev_pay_host_apply_capability('acct_host1', 'payouts', 'active', now() + interval '4 minutes') = 'ok' and (pg_temp.j(h, 'select public.ev_pay_host_status()') ->> 'can_sell')::boolean, 'and ready once payouts are back');
  perform pg_temp.ok(public.ev_pay_host_apply_capability('acct_nobody', 'payouts', 'active') = 'unknown_account' and public.ev_pay_host_apply_capability('acct_host1', 'Payouts!', 'active') = 'bad_capability'
                     and public.ev_pay_host_apply_capability('acct_host1', 'payouts', 'maybe') = 'bad_status', 'an unknown account, capability or status is refused');
  perform pg_temp.ok(public.ev_pay_host_apply_requirements('acct_host1', '["persons.id_number","proof_of_address","persons.id_number","weird.thing_here"]') = 'ok'
                     and public.ev_pay_host_apply_requirements('acct_nobody', '[]') = 'unknown_account' and public.ev_pay_host_apply_requirements('acct_host1', '"x"') = 'bad_list', 'requirements are a list');
  r := pg_temp.j(h, 'select public.ev_pay_host_status()');
  perform pg_temp.ok(jsonb_array_length(r -> 'requirements_due') = 3 and r -> 'requirements_due' @> '"Your ID number"' and r -> 'requirements_due' @> '"Proof of address"' and r -> 'requirements_due' @> '"Weird Thing Here"',
                     'what Bachs still needs shows in plain words');
  perform pg_temp.ok(public.ev_pay_host_apply_requirements('acct_host1', '[]') = 'ok' and pg_temp.j(h, 'select public.ev_pay_host_status()') -> 'requirements_due' = '[]'::jsonb, 'an empty list clears them');
  perform pg_temp.ok(pg_temp.j(h2, 'select public.ev_pay_host_status()') ->> 'status' = 'not_started', 'another host sees their own status');

  -- ================================================== paid types: any host (Hoppaz collects) ========
  e1 := pg_temp.ev(h, 'Paid night', 5);
  fr := pg_temp.ty(e1, 'Free', 0, null, 1); vip := pg_temp.ty(e1, 'VIP', 5000, 3, 2);
  r := pg_temp.j(h2, format('select public.ev_update_event(%L, %L::jsonb)', e1, '{"description":"x"}'));
  perform pg_temp.ok(r ->> 'reason' = 'not_allowed', 'a stranger cannot edit the event');
  update public.events set host_id = h2 where id = e1;
  r := pg_temp.j(h2, format('select public.ev_update_event(%L, %L::jsonb)', e1, '{"tickets":[{"name":"Free"},{"name":"VIP","price_naira":5000,"capacity":3}]}'));
  perform pg_temp.ok((r ->> 'ok')::boolean, 'a host with no payout account can set a paid type (bank details come at withdrawal)');
  update public.events set host_id = h where id = e1;
  r := pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', e1, '{"tickets":[{"name":"Free"},{"name":"VIP","price_naira":5000,"capacity":3}]}'));
  perform pg_temp.ok((r ->> 'ok')::boolean, 'and so can a ready host');
  perform pg_temp.ok(pg_temp.j(b1, format('select public.ev_register(%L, %L::jsonb)', e1, json_build_object('ticketTypeId', vip)::text)) ->> 'reason' = 'use_checkout', 'registering for a paid type says use_checkout');
  perform public.ev_set_setting('paid_tickets', 'off');
  r := pg_temp.res(b1, e1, vip, 1, 5000);
  perform pg_temp.ok(r ->> 'reason' = 'paid_off', 'with the setting off nothing can be reserved: paid_off');
  perform public.ev_set_setting('paid_tickets', 'on');

  -- ================================================== reserve: the checks ========
  perform pg_temp.ok(pg_temp.res(b1, e1, vip, 0, 5000) ->> 'reason' = 'bad_qty' and pg_temp.res(b1, e1, vip, 6, 5000) ->> 'reason' = 'bad_qty', 'quantity is 1 to 5');
  perform pg_temp.ok(public.ev_pay_order_reserve(b1, e1, vip, 1, 0, '{}', null) ->> 'reason' = 'bad_fee' and public.ev_pay_order_reserve(b1, e1, vip, 1, 500000, '{}', null) ->> 'reason' = 'bad_fee'
                     and public.ev_pay_order_reserve(b1, e1, vip, 1, 600000, '{}', null) ->> 'reason' = 'bad_fee' and public.ev_pay_order_reserve(b1, e1, vip, 1, null, '{}', null) ->> 'reason' = 'bad_fee',
                     'FEE RULE: the platform fee must be above 0 and below the gross (0, equal, above, null are all refused)');
  perform pg_temp.ok(public.ev_pay_order_reserve(b1, e1, vip, 1, 1, '{}', null) ->> 'ok' = 'true', 'a fee of 1 kobo is allowed');
  perform pg_temp.ok(public.ev_pay_order_release((select id from public.ev_orders where buyer_id = b1 and status = 'open'), 'test') = 'ok', 'released');
  perform pg_temp.ok(pg_temp.res(b1, e1, fr, 1, 100) ->> 'reason' = 'not_paid_type', 'a free type is not bought here');
  perform pg_temp.ok(pg_temp.res(b1, e1, gen_random_uuid(), 1, 5000) ->> 'reason' = 'bad_ticket', 'a type that is not the event''s is bad_ticket');
  perform pg_temp.ok(pg_temp.res(g, e1, vip, 1, 5000) ->> 'reason' = 'need_account', 'a guest with no email cannot buy');
  perform pg_temp.ok(pg_temp.res(null, e1, vip, 1, 5000) ->> 'reason' = 'no_session' and pg_temp.res(b1, gen_random_uuid(), vip, 1, 5000) ->> 'reason' = 'not_found', 'no user, or no event');
  e2 := pg_temp.ev(h2, 'Other host event'); vip2 := pg_temp.ty(e2, 'VIP', 5000);
  r := pg_temp.res(b1, e2, vip2, 1, 5000);
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'host_account' = 'platform', 'a host with no payout account sells: Hoppaz collects (host_account platform)');
  perform pg_temp.ok(public.ev_pay_order_release((r ->> 'order_id')::uuid, 'test') = 'ok', 'released');
  eo := pg_temp.ev(h, 'Over', null, false, now() - interval '5 hours'); vip3 := pg_temp.ty(eo, 'VIP', 5000);
  perform pg_temp.ok(pg_temp.res(b1, eo, vip3, 1, 5000) ->> 'reason' = 'event_over', 'an event that is over');
  ec := pg_temp.ev(h, 'Cancelled'); vip3 := pg_temp.ty(ec, 'VIP', 5000); update public.events set status = 'cancelled' where id = ec;
  perform pg_temp.ok(pg_temp.res(b1, ec, vip3, 1, 5000) ->> 'reason' = 'cancelled', 'a cancelled event');
  begin
    insert into public.ev_orders (buyer_id, event_id, quantity, unit_price_kobo, gross_kobo, platform_fee_kobo, host_account, bachs_reference, expires_at)
    values (b1, e1, 1, 500000, 500000, 500000, 'acct_host1', 'ord_bad1', now());
    perform pg_temp.ok(false, 'a fee equal to the gross must be refused by the table');
  exception when check_violation then
    perform pg_temp.ok(true, 'the table itself refuses a fee that is not below the gross');
  end;

  -- ================================================== reserve: capacity and holds ========
  r := pg_temp.res(b1, e1, vip, 2, 5000);
  o1 := (r ->> 'order_id')::uuid;
  perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'gross_kobo')::bigint = 1000000 and (r ->> 'platform_fee_kobo')::bigint = 45000 and r ->> 'host_account' = 'platform'
                     and r ->> 'buyer_email' like 'pay-%@evtest.invalid' and r ->> 'reference' = 'ord_' || replace(o1::text, '-', '') and (r ->> 'expires_at')::timestamptz > now() + interval '14 minutes'
                     and (r ->> 'quantity')::int = 2, 'reserve: the money in kobo, the host account, the buyer email, the reference and a 15 minute hold');
  perform pg_temp.ok(pg_temp.left_of(e1, vip) = 1, 'two seats held: 1 of 3 left');
  perform pg_temp.ok((pg_temp.j(x, format('select public.ev_get_event(%L)', e1)) -> 'ticket_types' -> 1 ->> 'spots_left')::int = 1, 'and the event page shows the hold in spots_left');
  perform pg_temp.ok(pg_temp.res(b1, e1, vip, 1, 5000) ->> 'reason' = 'order_open' and pg_temp.res(b1, e1, vip, 1, 5000) ->> 'order_id' = o1::text, 'the same buyer already has an open order: order_open, with its id');
  perform pg_temp.ok(pg_temp.res(b2, e1, vip, 2, 5000) ->> 'reason' = 'sold_out', 'a second buyer asking for 2 when 1 is left: sold_out (the per-type limit counts the open hold)');
  r := pg_temp.res(b2, e1, vip, 1, 5000);
  o2 := (r ->> 'order_id')::uuid;
  perform pg_temp.ok((r ->> 'ok')::boolean, 'asking for the last 1: one wins');
  perform pg_temp.ok(pg_temp.res(b3, e1, vip, 1, 5000) ->> 'reason' = 'sold_out', 'and the third buyer for the same seat is sold_out');
  -- Event capacity 5: 3 VIP seats are held; free people take the other 2, and no more.
  perform pg_temp.ok((pg_temp.j(b3, format('select public.ev_register(%L, %L::jsonb)', e1, json_build_object('ticketTypeId', fr)::text)) -> 'registration' ->> 'status') = 'going', 'a free registration still fits (2 of 5 left after 3 held)');
  perform pg_temp.ok((pg_temp.j(b4, format('select public.ev_register(%L, %L::jsonb)', e1, json_build_object('ticketTypeId', fr)::text)) -> 'registration' ->> 'status') = 'going', 'and another');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_register(%L, %L::jsonb)', e1, json_build_object('ticketTypeId', fr)::text)) ->> 'reason' = 'full', 'the event is full counting open holds: a free registration is refused');
  -- Hold time: 15 minutes plus a 2 minute margin.
  update public.ev_orders set expires_at = now() - interval '1 minute' where id = o2;
  perform pg_temp.ok(pg_temp.left_of(e1, vip) = 0, 'just past the 15 minutes but inside the 2 minute margin: the seat is still held');
  update public.ev_orders set expires_at = now() - interval '3 minutes' where id = o2;
  perform pg_temp.ok(pg_temp.left_of(e1, vip) = 1, 'past the margin: the seat is free again');
  update public.ev_orders set expires_at = now() + interval '10 minutes' where id = o2;
  -- Attach and release.
  perform pg_temp.ok(public.ev_pay_order_attach(o1, 'chk_one', 'http://insecure', null) = 'bad_input' and public.ev_pay_order_attach(o1, 'chk_one', 'http://127.0.0.1.evil.example/c', null) = 'bad_input', 'a checkout link must be https (only a plain http link to this machine passes, for the mock Bachs server)');
  perform pg_temp.ok(public.ev_pay_order_attach(o1, 'chk_one', 'https://checkout.bachs.io/c/one', now() + interval '15 minutes') = 'ok', 'attach');
  perform pg_temp.ok(public.ev_pay_order_attach(o2, 'chk_one', 'https://checkout.bachs.io/c/two', null) = 'duplicate', 'a checkout id cannot be on two orders');
  perform pg_temp.ok(public.ev_pay_order_attach(o2, 'chk_two', 'https://checkout.bachs.io/c/two', null) = 'ok', 'attach the other');
  perform pg_temp.ok(public.ev_pay_order_attach(gen_random_uuid(), 'chk_x', 'https://x.example/c', null) = 'not_found', 'attach to nothing');
  -- Two statements: a stable function inside the same statement as the release would not see the change.
  perform pg_temp.ok(public.ev_pay_order_release(o2, 'bachs timed out') = 'ok', 'release answers ok');
  perform pg_temp.ok(pg_temp.st(o2) = 'failed' and pg_temp.left_of(e1, vip) = 1, 'release: the order fails and the seat is free');
  perform pg_temp.ok(public.ev_pay_order_release(o2) = 'not_open' and public.ev_pay_order_attach(o2, 'chk_three', 'https://x.example/c', null) = 'not_open', 'a failed order cannot be released or attached again');

  -- The host's questions are asked at checkout too.
  e6 := pg_temp.ev(h, 'Questions night'); v3 := pg_temp.ty(e6, 'VIP', 1000);
  insert into public.ev_registration_settings (event_id, questions, messages)
  values (e6, '[{"id":"name","label":"Name","required":true,"builtin":"name","enabled":true},{"id":"email","label":"Email","required":true,"builtin":"email","enabled":true},{"id":"diet","label":"Dietary needs","required":true}]', '{}');
  r := pg_temp.res(b1, e6, v3, 1, 1000);
  perform pg_temp.ok(r ->> 'reason' = 'answer_needed' and r ->> 'question' = 'Dietary needs', 'a required question without an answer: answer_needed');
  r := pg_temp.res(b1, e6, v3, 1, 1000, '{"diet":"  no pork ","Bad Key":"x"}');
  perform pg_temp.ok((r ->> 'ok')::boolean and (select answers from public.ev_orders where id = (r ->> 'order_id')::uuid) = '{"diet":"no pork"}'::jsonb, 'with an answer it goes, the answer cleaned and kept on the order');
  perform public.ev_pay_order_release((r ->> 'order_id')::uuid);

  -- ================================================== a paid order: tickets issued once, one per seat ========
  r := public.ev_pay_order_paid('chk_one', 'ch_one', '10000.00', 'bank_transfer', 15000);
  perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'issued')::boolean and not (r ->> 'late')::boolean and not (r ->> 'needs_refund')::boolean and not (r ->> 'flag_review')::boolean, 'paid: tickets issued, not late, no refund, no flag');
  perform pg_temp.ok(pg_temp.st(o1) = 'paid' and (select count(*) from public.ev_registrations where event_id = e1 and user_id = b1) = 1
                     and (select quantity from public.ev_registrations where event_id = e1 and user_id = b1) = 2 and (select status from public.ev_registrations where event_id = e1 and user_id = b1) = 'going'
                     and (select ticket_type_id from public.ev_registrations where event_id = e1 and user_id = b1) = vip, 'ONE registration with quantity 2, going, with the VIP type');
  perform pg_temp.ok(pg_temp.tix(e1, b1) = 2 and (select count(*) from public.ev_tickets where order_id = o1) = 2, 'and two tickets, both belonging to the order');
  r := public.ev_pay_order_paid('chk_one', 'ch_one', '10000.00', 'bank_transfer', 15000);
  perform pg_temp.ok((r ->> 'ok')::boolean and not (r ->> 'issued')::boolean and pg_temp.tix(e1, b1) = 2 and (select quantity from public.ev_registrations where event_id = e1 and user_id = b1) = 2,
                     'IDEMPOTENT: the same payment event again issues nothing and changes nothing');
  r := public.ev_pay_order_paid('chk_unknown_zzz', 'ch_one', '10000.00', 'bank_transfer', 15000);
  perform pg_temp.ok(r ->> 'reason' = 'not_found', 'an unknown reference is not_found');
  tk := pg_temp.mine(b1, e1);
  perform pg_temp.ok(jsonb_array_length(tk) = 2 and tk -> 0 ->> 'token' <> tk -> 1 ->> 'token' and tk -> 0 ->> 'code' <> tk -> 1 ->> 'code' and (tk -> 0 ->> 'seat')::int = 1 and (tk -> 1 ->> 'seat')::int = 2
                     and tk -> 0 ->> 'ticket_name' = 'VIP' and tk -> 0 ->> 'holder_name' = 'Pay Ada', 'the buyer has 2 tickets, each with its own token and code');
  perform pg_temp.ok(pg_temp.j(b1, format('select public.ev_my_ticket(%L)', e1)) ->> 'token' = tk -> 0 ->> 'token', 'ev_my_ticket is the first of them');
  -- Money fields and who may read the order.
  r := pg_temp.j(b1, format('select public.ev_pay_my_order(%L)', o1));
  perform pg_temp.ok(r ->> 'status' = 'paid' and (r ->> 'gross_naira')::numeric = 10000 and (r ->> 'platform_fee_naira')::numeric = 450 and (r ->> 'processing_fee_naira')::numeric = 150
                     and (r ->> 'host_net_naira')::numeric = 9550 and r ->> 'payment_method' = 'bank_transfer' and r -> 'checkout_url' = 'null'::jsonb and (r ->> 'quantity')::int = 2
                     and (r ->> 'unit_price_naira')::numeric = 5000 and r ->> 'event_title' = 'Paid night' and r ->> 'ticket_name' = 'VIP' and r ->> 'buyer_name' = 'Pay Ada'
                     and not (r ->> 'needs_refund')::boolean and r ->> 'paid_at' is not null, 'the Order shape: kobo shown as naira, the host net is gross minus Hoppaz''s fee (the buyer paid the processing fee on top), no checkout link once paid');
  perform pg_temp.ok(pg_temp.j(b2, format('select public.ev_pay_my_order(%L)', o1)) is null and pg_temp.j(x, format('select public.ev_pay_my_order(%L)', o1)) is null, 'LEAK CHECK: nobody else can read the buyer''s order');
  perform pg_temp.ok(jsonb_array_length(pg_temp.j(b1, 'select public.ev_pay_my_orders()')) >= 1 and not exists (select 1 from jsonb_array_elements(pg_temp.j(b1, 'select public.ev_pay_my_orders()')) o where o ->> 'buyer_id' <> b1::text) and jsonb_array_length(pg_temp.j(x, 'select public.ev_pay_my_orders()')) = 0, 'my orders: only mine');
  perform pg_temp.ok(jsonb_array_length(pg_temp.j(h, format('select public.ev_pay_event_orders(%L)', e1))) >= 1 and pg_temp.j(h, format('select public.ev_pay_event_orders(%L)', e1)) -> 0 -> 'checkout_url' = 'null'::jsonb
                     and pg_temp.j(x, format('select public.ev_pay_event_orders(%L)', e1)) = '[]'::jsonb and pg_temp.j(b1, format('select public.ev_pay_event_orders(%L)', e1)) = '[]'::jsonb,
                     'the host sees the event''s orders (never the checkout link); a buyer or a stranger sees none');
  -- An open order shows its checkout link to its buyer only.
  o3 := pg_temp.go(b2, e1, vip, 1, 5000);
  perform pg_temp.ok(pg_temp.j(b2, format('select public.ev_pay_my_order(%L)', o3)) ->> 'checkout_url' like 'https://checkout.bachs.io/c/%' and pg_temp.j(b2, format('select public.ev_pay_my_order(%L)', o3)) ->> 'status' = 'open',
                     'while open the buyer gets the checkout link');
  perform pg_temp.ok((select q -> 'checkout_url' from jsonb_array_elements(pg_temp.j(h, format('select public.ev_pay_event_orders(%L)', e1))) q where q ->> 'id' = o3::text) = 'null'::jsonb, 'and the host does not');
  -- Door: each seat scans on its own.
  r := pg_temp.scan(h, e1, tk -> 0 ->> 'token');
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'kind' = 'checked_in' and r ->> 'ticket' = 'VIP' and r ->> 'name' = 'Pay Ada', 'the first ticket checks in');
  perform pg_temp.ok((select status from public.ev_registrations where event_id = e1 and user_id = b1) = 'going', 'the registration stays going while a ticket is unused');
  r := pg_temp.j(h, format('select public.ev_door_counts(%L)', e1));
  perform pg_temp.ok((r ->> 'going')::int = 4 and (r ->> 'checked_in')::int = 1, 'door counts count tickets: 4 going (2 + 2 free), 1 checked in');
  perform pg_temp.ok(pg_temp.scan(h, e1, tk -> 0 ->> 'token') ->> 'kind' = 'already_used', 'the same ticket again is already_used');
  r := pg_temp.scan(h, e1, tk -> 1 ->> 'code');
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'kind' = 'checked_in', 'the second ticket checks in by its typed code');
  perform pg_temp.ok((select status from public.ev_registrations where event_id = e1 and user_id = b1) = 'checked_in' and (pg_temp.j(h, format('select public.ev_door_counts(%L)', e1)) ->> 'checked_in')::int = 2,
                     'with the last ticket used the registration is checked_in, and the count is 2');
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_checkin_manual(%L, %L)', e1, (select id from public.ev_registrations where event_id = e1 and user_id = b1))) ->> 'kind' = 'already_used', 'a manual check-in of someone fully in is already_used');
  perform pg_temp.ok((pg_temp.j(h, format('select public.ev_door_search(%L, %L)', e1, 'pay ada')) -> 0 ->> 'quantity')::int = 2 and pg_temp.j(h, format('select public.ev_door_search(%L, %L)', e1, 'pay ada')) -> 0 ->> 'ticket_name' = 'VIP',
                     'the name search shows the quantity and the ticket name');
  perform pg_temp.ok(pg_temp.t(b1, format('select public.ev_cancel_registration(%L)', e1)) = 'already_checked_in', 'someone fully checked in cannot cancel');
  update public.events set capacity = 8 where id = e1;
  update public.ev_ticket_types set capacity = 6 where id = vip;

  -- A second paid order adds to the same registration.
  perform pg_temp.paid(o3);
  perform pg_temp.ok((select quantity from public.ev_registrations where event_id = e1 and user_id = b2) = 1 and pg_temp.tix(e1, b2) = 1, 'b2 bought one: a registration of 1 with 1 ticket');
  o4 := pg_temp.go(b1, e1, vip, 1, 5000);
  perform pg_temp.ok(pg_temp.left_of(e1, vip) = 2, 'the second order of b1 holds one more seat (6 seats, 3 sold, 1 held)');
  perform pg_temp.paid(o4);
  perform pg_temp.ok((select count(*) from public.ev_registrations where event_id = e1 and user_id = b1) = 1 and (select quantity from public.ev_registrations where event_id = e1 and user_id = b1) = 3
                     and (select status from public.ev_registrations where event_id = e1 and user_id = b1) = 'going' and pg_temp.tix(e1, b1) = 3 and (select count(*) from public.ev_tickets where order_id = o4) = 1,
                     'CHOICE: a second paid order adds to the same registration: quantity 3, 3 tickets, the new one tied to the new order, and the person is going again');
  perform pg_temp.ok(jsonb_array_length(pg_temp.mine(b1, e1)) = 3, 'and holds 3 tickets');
  perform pg_temp.ok(pg_temp.t(b1, format('select public.ev_cancel_registration(%L)', e1)) = 'paid_use_refund', 'a paid registration is undone by a refund, not by cancelling: paid_use_refund');
  perform pg_temp.ok(pg_temp.res(b3, e1, vip, 1, 5000) ->> 'reason' = 'other_ticket_held', 'someone holding a free ticket cannot buy a paid one (other_ticket_held)');
  update public.ev_registrations set quantity = 8 where event_id = e1 and user_id = b1;
  perform pg_temp.ok(pg_temp.res(b1, e1, vip, 5, 5000) ->> 'reason' = 'too_many', 'at most 10 seats per person per event');
  update public.ev_registrations set quantity = 3 where event_id = e1 and user_id = b1;

  -- ================================================== amount, overpaid, details ========
  e3 := pg_temp.ev(h, 'Money night'); v3 := pg_temp.ty(e3, 'Ticket', 2000);
  o5 := pg_temp.go(b2, e3, v3, 1, 2000);
  r := public.ev_pay_order_paid('chk_' || replace(o5::text, '-', ''), 'ch_o5', '1999.00', 'card', 4000);
  perform pg_temp.ok((r ->> 'ok')::boolean and not (r ->> 'issued')::boolean and (r ->> 'flag_review')::boolean and r ->> 'reason' = 'amount_mismatch' and pg_temp.st(o5) = 'open' and pg_temp.tix(e3, b2) = 0,
                     'AMOUNT MISMATCH: less than the gross is not issued, it is flagged, and the order stays open');
  r := public.ev_pay_order_paid('chk_' || replace(o5::text, '-', ''), 'ch_o5', 'abc', 'card', 4000);
  perform pg_temp.ok(not (r ->> 'issued')::boolean and (r ->> 'flag_review')::boolean, 'an amount that is not a number is flagged too');
  perform pg_temp.ok((select flag_review from public.ev_orders where id = o5) = 'amount_mismatch', 'the flag is on the order');
  r := public.ev_pay_order_details('ch_o5', 'chk_' || replace(o5::text, '-', ''), 5000, 'card');
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'status' = 'open' and (select processing_fee_kobo from public.ev_orders where id = o5) = 5000 and (select payment_method from public.ev_orders where id = o5) = 'card',
                     'collection.succeeded before checkout.completed: the fee, the charge and the method are kept, nothing is issued');
  r := public.ev_pay_order_paid('chk_' || replace(o5::text, '-', ''), null, '2000.00', null);
  perform pg_temp.ok((r ->> 'issued')::boolean and (select bachs_charge_id from public.ev_orders where id = o5) = 'ch_o5' and (select payment_method from public.ev_orders where id = o5) = 'card'
                     and (select processing_fee_kobo from public.ev_orders where id = o5) = 5000, 'then the right amount issues, with the earlier details kept');
  perform pg_temp.ok(public.ev_pay_order_details(null, 'chk_nothing', 1, 'card') ->> 'reason' = 'not_found', 'details of an unknown checkout: not_found');
  o6 := pg_temp.go(b3, e3, v3, 1, 2000);
  r := public.ev_pay_order_paid('chk_' || replace(o6::text, '-', ''), 'ch_o6', '2001.00', 'card', 4000);
  perform pg_temp.ok((r ->> 'issued')::boolean and (r ->> 'flag_review')::boolean and pg_temp.tix(e3, b3) = 1, 'OVERPAID: issued, and flagged for review');
  declare e9 uuid; t9 uuid; o9 uuid;
  begin
    -- On its own event, so no later count changes.
    e9 := pg_temp.ev(h, 'Fee on top'); t9 := pg_temp.ty(e9, 'GA', 2000);
    o9 := pg_temp.go(b2, e9, t9, 1, 2000);
    r := public.ev_pay_order_paid('chk_' || replace(o9::text, '-', ''), 'ch_o9', '2040.00', 'card', 4000);
    perform pg_temp.ok((r ->> 'issued')::boolean and not (r ->> 'flag_review')::boolean, 'the gross plus the processing fee the buyer paid on top is exact, not overpaid');
  end;
  o7 := pg_temp.go(b4, e3, v3, 1, 2000);
  perform pg_temp.ok(public.ev_pay_order_details('ch_o5', 'chk_' || replace(o7::text, '-', ''), 1, 'card') ->> 'reason' = 'charge_taken', 'a charge id already on another order is refused');

  -- ================================================== expire, sweep, late payments ========
  r := public.ev_pay_order_expire('chk_' || replace(o7::text, '-', ''));
  perform pg_temp.ok((r ->> 'changed')::boolean and pg_temp.st(o7) = 'expired', 'checkout.expired: an open order expires');
  r := public.ev_pay_order_expire('chk_' || replace(o5::text, '-', ''));
  perform pg_temp.ok(not (r ->> 'changed')::boolean and pg_temp.st(o5) = 'paid', 'EXPIRE NEVER OVERWRITES PAID');
  perform pg_temp.ok(public.ev_pay_order_expire('chk_unknown') ->> 'reason' = 'not_found', 'an unknown checkout is not_found');
  -- A late payment with the seat free again: taken again and issued.
  r := pg_temp.paid(o7, 'bank_transfer');
  perform pg_temp.ok((r ->> 'issued')::boolean and (r ->> 'late')::boolean and not (r ->> 'needs_refund')::boolean and pg_temp.st(o7) = 'paid' and pg_temp.tix(e3, b4) = 1,
                     'LATE PAYMENT, seat free: the seat is taken again, the ticket is issued, late is true');
  -- A late payment with no seat left.
  e4 := pg_temp.ev(h, 'Two seats', 2); v4 := pg_temp.ty(e4, 'VIP', 3000);
  o1 := pg_temp.go(b1, e4, v4, 1, 3000); o2 := pg_temp.go(b3, e4, v4, 1, 3000);
  update public.ev_orders set expires_at = now() - interval '5 minutes' where id in (o1, o2);
  r := public.ev_pay_sweep();
  perform pg_temp.ok(jsonb_array_length(r -> 'expired') >= 2 and r -> 'expired' @> jsonb_build_array(jsonb_build_object('order_id', o1, 'checkout_id', 'chk_' || replace(o1::text, '-', ''))) and pg_temp.st(o1) = 'expired' and pg_temp.st(o2) = 'expired',
                     'SWEEP: open orders past the hold and the margin expire and are returned with their checkout ids');
  perform pg_temp.ok(pg_temp.left_of(e4, v4) = 2, 'and the seats are free');
  o3 := pg_temp.go(b2, e4, v4, 2, 3000);
  perform pg_temp.paid(o3, 'card');
  perform pg_temp.ok(pg_temp.left_of(e4, v4) = 0, 'someone else bought both seats');
  r := pg_temp.paid(o1, 'card');
  perform pg_temp.ok((r ->> 'ok')::boolean and not (r ->> 'issued')::boolean and (r ->> 'late')::boolean and (r ->> 'needs_refund')::boolean and pg_temp.st(o1) = 'paid' and pg_temp.tix(e4, b1) = 0
                     and not (select needs_manual_refund from public.ev_orders where id = o1), 'LATE PAYMENT, no seat: no ticket, needs_refund (a card: Bachs can refund it)');
  r := pg_temp.paid(o2, 'bank_transfer');
  perform pg_temp.ok((r ->> 'needs_refund')::boolean and (select needs_manual_refund from public.ev_orders where id = o2) and pg_temp.tix(e4, b3) = 0, 'and for a bank transfer needs_manual_refund too');
  perform pg_temp.ok(not exists (select 1 from public.ev_registrations where event_id = e4 and user_id in (b1, b3)), 'no registration was made for a payment that could not be seated');
  -- A sweep leaves an order inside the margin alone, and a late payment on an open order past its margin is checked for seats.
  perform pg_temp.ok(pg_temp.res(b4, e4, v4, 1, 3000) ->> 'reason' = 'sold_out', 'no seat left on that event for a fresh buyer (the two seats are paid for)');
  e5 := pg_temp.ev(h, 'Margin night'); v5 := pg_temp.ty(e5, 'VIP', 1000);
  o8 := pg_temp.go(b1, e5, v5, 1, 1000);
  update public.ev_orders set expires_at = now() - interval '1 minute' where id = o8;
  perform pg_temp.ok(not (public.ev_pay_sweep() -> 'expired' @> jsonb_build_array(jsonb_build_object('order_id', o8, 'checkout_id', 'chk_' || replace(o8::text, '-', '')))) and pg_temp.st(o8) = 'open', 'an order inside the 2 minute margin is not swept');
  perform pg_temp.ok(public.ev_pay_event_record('evt_1', 'checkout.completed', 'acct_host1', now(), '{"a":1}') and not public.ev_pay_event_record('evt_1', 'checkout.completed', 'acct_host1', now(), '{"a":1}'),
                     'DEDUPE: a Bachs event id is new once');
  perform pg_temp.ok(public.ev_pay_event_processed('evt_1') = 'ok' and public.ev_pay_event_processed('evt_nope') = 'not_found', 'and can be marked processed');
  perform pg_temp.ok((select processed_at from public.ev_bachs_events where evt_id = 'evt_1') is not null, 'the processed time is saved');
  perform pg_temp.ok(not public.ev_pay_event_record('x', 'a', null, null, null) and not public.ev_pay_event_record('evt_2', null, null, null, null), 'a bad event id or type is refused');

  -- ================================================== refunds ========
  -- Card: tickets void at once, seats back, one refund only.
  tk := pg_temp.mine(b4, e3);
  r := public.ev_pay_refund_start(o7, h);
  perform pg_temp.ok(r ->> 'method' = 'manual' and r ->> 'status' = 'manual_needed' and r ->> 'charge_id' = 'ch_' || replace(o7::text, '-', ''), 'o7 was a bank transfer: manual, no Bachs call');
  perform pg_temp.ok(pg_temp.tix(e3, b4) = 0 and pg_temp.scan(h, e3, tk -> 0 ->> 'token') ->> 'reason' = 'void', 'its ticket is void at once: the old QR is not valid');
  perform pg_temp.ok((select needs_manual_refund from public.ev_orders where id = o7) and pg_temp.st(o7) = 'paid' and (select status from public.ev_refunds where order_id = o7) = 'manual_needed', 'a manual task is waiting');
  perform pg_temp.ok(public.ev_pay_refund_start(o7, h) ->> 'reason' = 'already_refunded', 'one refund per order');
  perform pg_temp.ok(pg_temp.t(x, format('select public.ev_pay_mark_manual_refund(%L)', o7)) = 'not_allowed' and pg_temp.t(b4, format('select public.ev_pay_mark_manual_refund(%L)', o7)) = 'not_allowed', 'only the host or staff can mark it paid back');
  perform pg_temp.ok(pg_temp.t(h, format('select public.ev_pay_mark_manual_refund(%L)', o7)) = 'ok', 'the host marks the manual refund done');
  perform pg_temp.ok(pg_temp.st(o7) = 'refunded' and (select status from public.ev_refunds where order_id = o7) = 'manual_done'
                     and not (select needs_manual_refund from public.ev_orders where id = o7), 'the host marks the manual refund done: refunded');
  perform pg_temp.ok(pg_temp.t(h, format('select public.ev_pay_mark_manual_refund(%L)', o7)) = 'nothing_to_mark', 'and not twice');
  -- Card refund by Bachs.
  r := public.ev_pay_refund_start(o5, x);
  perform pg_temp.ok(r ->> 'reason' = 'not_allowed', 'a stranger cannot start a refund');
  r := public.ev_pay_refund_start(o5, h);
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'method' = 'card' and r ->> 'status' = 'refund_pending' and r ->> 'reference' = 'rf_' || replace(o5::text, '-', '') and r ->> 'charge_id' = 'ch_o5'
                     and r ->> 'host_account' = 'platform' and (r ->> 'amount_kobo')::bigint = 200000 and pg_temp.st(o5) = 'refund_pending', 'a card refund: refund_pending, the reference rf_<order>, the charge and the host account for the Bachs call');
  perform pg_temp.ok(pg_temp.tix(e3, b2) = 0 and (select status from public.ev_registrations where event_id = e3 and user_id = b2) = 'cancelled' and (select quantity from public.ev_registrations where event_id = e3 and user_id = b2) = 0,
                     'the tickets are void and the registration is given up');
  perform pg_temp.ok(public.ev_pay_refund_start(o5, h) ->> 'reason' = 'already_refunding', 'a second start while it is pending: already_refunding');
  perform pg_temp.ok((public.ev_pay_refund_apply('rfnd_1', 'rf_' || replace(o5::text, '-', ''), 'processing') ->> 'status') = 'processing' and pg_temp.st(o5) = 'refund_pending', 'refund.created: processing');
  perform pg_temp.ok(public.ev_pay_refund_apply('rfnd_1', 'rf_' || replace(o5::text, '-', ''), 'paid') ->> 'status' = 'paid', 'refund.paid answers paid');
  perform pg_temp.ok(pg_temp.st(o5) = 'refunded' and (select refunded_at from public.ev_orders where id = o5) is not null, 'refund.paid: refunded');
  perform pg_temp.ok(not (public.ev_pay_refund_apply('rfnd_1', 'rf_' || replace(o5::text, '-', ''), 'processing') ->> 'changed')::boolean and pg_temp.st(o5) = 'refunded', 'a late created event never takes a paid refund backwards');
  perform pg_temp.ok(public.ev_pay_refund_apply('rfnd_x', 'rf_unknown', 'paid') ->> 'reason' = 'not_found', 'an unknown refund is not_found');
  -- Failed: the tickets stay void, the refund is owed again, a new one can be started by staff.
  r := public.ev_pay_refund_start(o6, st);
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'method' = 'card', 'staff can start a refund');
  perform pg_temp.ok(public.ev_pay_refund_apply('rfnd_2', r ->> 'reference', 'failed') ->> 'status' = 'failed', 'refund.failed: the order is paid again and owed a refund (call)');
  perform pg_temp.ok(pg_temp.st(o6) = 'paid' and (select needs_refund from public.ev_orders where id = o6), 'refund.failed: the order is paid again and owed a refund');
  perform pg_temp.ok(pg_temp.tix(e3, b3) = 1 and (select quantity from public.ev_registrations where event_id = e3 and user_id = b3) = 1 and (select status from public.ev_registrations where event_id = e3 and user_id = b3) = 'going',
                     'and the voided ticket is back (INSUFFICIENT_BALANCE case), the registration holds its seat again');
  r := public.ev_pay_refund_start(o6, null);
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'reference' = 'rf_' || replace(o6::text, '-', '') || '_2', 'a failed refund does not count: a new one starts with a new reference (and the system can start it)');
  perform public.ev_pay_refund_apply(null, r ->> 'reference', 'success');
  perform pg_temp.ok(pg_temp.st(o6) = 'refunded', 'and paid (success is read as paid)');
  -- The late payment that had no seat: refund it.
  r := public.ev_pay_refund_start(o1, null);
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'method' = 'card' and pg_temp.st(o1) = 'refund_pending' and not (select needs_refund from public.ev_orders where id = o1), 'an automatic refund of the card payment that could not be seated');
  perform pg_temp.ok((select count(*) from public.ev_tickets where registration_id in (select id from public.ev_registrations where event_id = e4 and user_id = b2) and status = 'valid') = 2, 'and the person who did get the seats keeps theirs');
  -- Refund of seats frees them.
  perform pg_temp.ok(pg_temp.left_of(e3, v3) is null, 'event with no capacity: nothing to count');
  -- Refund refusals.
  perform pg_temp.ok(public.ev_pay_refund_start(o8, h) ->> 'reason' = 'not_paid', 'an open order cannot be refunded');
  perform pg_temp.ok(public.ev_pay_refund_start(gen_random_uuid(), h) ->> 'reason' = 'not_found', 'an unknown order');
  e5 := pg_temp.ev(h, 'Refund checks'); v5 := pg_temp.ty(e5, 'VIP', 500);
  o8 := pg_temp.go(b1, e5, v5, 1, 500);
  r := public.ev_pay_order_paid('chk_' || replace(o8::text, '-', ''), 'ch_o8', pg_temp.gross(o8), 'card', 100);
  perform pg_temp.scan(h, e5, (pg_temp.mine(b1, e5) -> 0 ->> 'token'));
  perform pg_temp.ok(public.ev_pay_refund_start(o8, h) ->> 'reason' = 'tickets_used', 'a ticket already used at the door: tickets_used (the host decides by hand)');
  o8 := pg_temp.go(b2, e5, v5, 1, 500);
  perform public.ev_pay_order_paid('chk_' || replace(o8::text, '-', ''), 'ch_o8b', pg_temp.gross(o8), 'crypto', 100);
  perform pg_temp.ok(public.ev_pay_refund_start(o8, h) ->> 'reason' = 'method_unknown', 'a payment method we do not know: method_unknown');
  o8 := pg_temp.go(b3, e5, v5, 1, 500);
  perform public.ev_pay_order_paid('chk_' || replace(o8::text, '-', ''), null, pg_temp.gross(o8), 'card', null);
  perform pg_temp.ok(public.ev_pay_refund_start(o8, h) ->> 'reason' = 'no_charge', 'a card payment with no charge id: no_charge');
  r := public.ev_pay_dispute_flag('ch_o8', 'dsp_1', 'needs_response');
  perform pg_temp.ok(public.ev_pay_dispute_flag('ch_nope', 'dsp_2', 'x') ->> 'reason' = 'not_found', 'a dispute for an unknown charge is not_found');
  perform pg_temp.ok((r ->> 'ok')::boolean and (select flag_review from public.ev_orders where bachs_charge_id = 'ch_o8') = 'dispute' and (select dispute_status from public.ev_orders where bachs_charge_id = 'ch_o8') = 'needs_response', 'a dispute flags the order');

  -- ================================================== sales ========
  r := pg_temp.j(h, format('select public.ev_pay_sales(%L)', e1));
  perform pg_temp.ok(jsonb_array_length(r -> 'rows') = 2 and (r -> 'rows' -> 1 ->> 'sold')::int = 4 and (r -> 'rows' -> 1 ->> 'gross_naira')::numeric = 20000
                     and (r -> 'rows' -> 1 ->> 'platform_fee_naira')::numeric = 900 and (r -> 'rows' -> 1 ->> 'name') = 'VIP' and (r -> 'rows' -> 0 ->> 'sold')::int = 0,
                     'sales per ticket type: VIP sold 4 for 20,000 with Hoppaz''s 900; the free type sold 0');
  perform pg_temp.ok((r -> 'totals' ->> 'sold')::int = 4 and (r -> 'totals' ->> 'gross_naira')::numeric = 20000 and (r -> 'totals' ->> 'net_naira')::numeric =
                     (r -> 'totals' ->> 'gross_naira')::numeric - (r -> 'totals' ->> 'platform_fee_naira')::numeric - (r -> 'totals' ->> 'processing_fee_naira')::numeric
                     and (r -> 'totals' ->> 'refunded_naira')::numeric = 0 and (r ->> 'open_orders')::int = 0 and (r ->> 'refunds_owed')::int = 0, 'totals: net is gross minus Hoppaz''s fee and any fee the host bore; nothing refunded, nothing open');
  r := pg_temp.j(h, format('select public.ev_pay_sales(%L)', e3));
  perform pg_temp.ok((r -> 'totals' ->> 'refunded_naira')::numeric = 6000 and (r -> 'rows' -> 0 ->> 'sold')::int = 0, 'refunded money shows in the totals (3 orders of 2,000), and refunded orders are not sold');
  r := pg_temp.j(h, format('select public.ev_pay_sales(%L)', e4));
  perform pg_temp.ok((r ->> 'refunds_owed')::int = 1 and (r -> 'totals' ->> 'sold')::int = 2, 'refunds owed counts the bank transfer still to pay back');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_pay_sales(%L)', e1)) is null and pg_temp.j(b1, format('select public.ev_pay_sales(%L)', e1)) is null and pg_temp.j(st, format('select public.ev_pay_sales(%L)', e1)) is not null,
                     'sales are for the host and staff only');

  -- ================================================== review fixes ========
  declare
    ex uuid; ty uuid; oa uuid; ob uuid; oc uuid; od uuid; rf1 text; rf2 text; reg_id uuid; tk0 int; q0 int; ref text; i int;
  begin
    -- F1: a refund whose outcome is unknown (timeout, 5xx) is recorded, not undone. Order stays refund_pending, tickets stay void.
    ex := pg_temp.ev(h, 'Refund unknown', 5); ty := pg_temp.ty(ex, 'VIP', 2000);
    oa := pg_temp.go(b1, ex, ty, 2, 2000);
    perform pg_temp.paid(oa, 'card');
    perform pg_temp.ok(pg_temp.tix(ex, b1) = 2, 'F1 setup: a paid card order with 2 tickets');
    r := public.ev_pay_refund_start(oa, h);
    rf1 := r ->> 'reference';
    perform pg_temp.ok(pg_temp.tix(ex, b1) = 0 and pg_temp.st(oa) = 'refund_pending', 'F1: the refund starts: tickets void, refund_pending');
    r := public.ev_pay_refund_attempt(rf1, 'Bachs did not answer');
    perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'attempts')::int = 1 and pg_temp.st(oa) = 'refund_pending' and pg_temp.tix(ex, b1) = 0
                       and (select last_error from public.ev_refunds where reference = rf1) = 'Bachs did not answer' and (select status from public.ev_refunds where reference = rf1) = 'requested',
                       'F1: a timeout is recorded as an attempt: the order stays refund_pending, the tickets stay void, the refund is not failed');
    perform pg_temp.ok(public.ev_pay_refund_start(oa, null) ->> 'reason' = 'already_refunding' and (select count(*) from public.ev_refunds where order_id = oa) = 1,
                       'F1: the sweeper can never start a second refund with a new reference while one is pending');
    perform pg_temp.ok(public.ev_pay_refund_attempt('rf_nobody', 'x') ->> 'reason' = 'not_found', 'F1: an attempt on an unknown refund is not_found');
    r := public.ev_pay_refund_apply('rfnd_u1', rf1, 'paid');
    perform pg_temp.ok(r ->> 'status' = 'paid' and pg_temp.st(oa) = 'refunded' and pg_temp.tix(ex, b1) = 0 and (select refund_reason from public.ev_orders where id = oa) is null,
                       'F1: timeout, then refund.paid: refunded, tickets void');
    perform pg_temp.ok(public.ev_pay_refund_attempt(rf1, 'late') ->> 'reason' = 'not_found', 'F1: no attempt is recorded on a refund that is paid');
    perform pg_temp.ok(not (public.ev_pay_refund_apply('rfnd_u1', rf1, 'failed') ->> 'changed')::boolean and pg_temp.st(oa) = 'refunded' and pg_temp.tix(ex, b1) = 0,
                       'F1: a late refund.failed never undoes a refund that is recorded as paid');
    -- The refund is refused for sure, the tickets come back, then it turns out the money went out: refund.paid voids them again.
    ob := pg_temp.go(b2, ex, ty, 1, 2000);
    perform pg_temp.paid(ob, 'card');
    r := public.ev_pay_refund_start(ob, h);
    rf2 := r ->> 'reference';
    r := public.ev_pay_refund_apply(null, rf2, 'failed');
    perform pg_temp.ok(pg_temp.st(ob) = 'paid' and pg_temp.tix(ex, b2) = 1 and (select needs_refund from public.ev_orders where id = ob)
                       and (select refund_reason from public.ev_orders where id = ob) = 'failed', 'F1: a definite refusal: order paid again, tickets valid again, refund owed with reason failed');
    perform pg_temp.ok(pg_temp.j(b2, format('select public.ev_pay_my_order(%L)', ob)) ->> 'refund_reason' = 'failed', 'F1: the buyer''s Order says refund_reason failed');
    r := public.ev_pay_refund_apply('rfnd_u2', rf2, 'paid');
    perform pg_temp.ok(pg_temp.st(ob) = 'refunded' and pg_temp.tix(ex, b2) = 0 and (select quantity from public.ev_registrations where event_id = ex and user_id = b2) = 0,
                       'F1: refund.paid after a failed one: refunded, and the order''s tickets are void again (the buyer cannot be refunded AND get in)');
    -- A duplicate refund.failed for an earlier refund must not undo a newer refund that is under way.
    oc := pg_temp.go(b3, ex, ty, 1, 2000);
    perform pg_temp.paid(oc, 'card');
    r := public.ev_pay_refund_start(oc, h); rf1 := r ->> 'reference';
    perform public.ev_pay_refund_apply(null, rf1, 'failed');
    r := public.ev_pay_refund_start(oc, null); rf2 := r ->> 'reference';
    perform pg_temp.ok(rf2 = rf1 || '_2' and pg_temp.st(oc) = 'refund_pending', 'F1: after a DEFINITE failure a new refund (a new reference) may start');
    perform public.ev_pay_refund_apply(null, rf1, 'failed');
    perform pg_temp.ok(pg_temp.st(oc) = 'refund_pending' and pg_temp.tix(ex, b3) = 0, 'F1: a duplicate failed for the first refund does not undo the second');
    -- Ten attempts flag the order for a person.
    for i in 1..10 loop perform public.ev_pay_refund_attempt(rf2, 'timeout ' || i); end loop;
    perform pg_temp.ok((select flag_review from public.ev_orders where id = oc) = 'refund_stuck' and (select attempts from public.ev_refunds where reference = rf2) = 10, 'F1: ten unknown outcomes flag the order refund_stuck');

    -- F2: an old listing is never sold, and its door price is not a ticket price.
    insert into public.events (title, venue_name, starts_at, status, created_by, price_naira) values ('Old paid listing', 'Somewhere', now() + interval '3 days', 'live', h, 5000) returning id into ex;
    r := pg_temp.res(b1, ex, md5('ticket-type:' || ex::text)::uuid, 1, 5000);
    perform pg_temp.ok(r ->> 'reason' = 'no_host', 'F2: reserve for an event with no host_id answers no_host');
    perform pg_temp.ok((select price_naira from public._ev_types(ex)) = 0, 'F2: the derived General of an old listing is free');

    -- F5: the switch. A buyer cannot reserve while it is off; orders that exist keep settling.
    ex := pg_temp.ev(h, 'Switch pay', 5); ty := pg_temp.ty(ex, 'VIP', 1000);
    oa := pg_temp.go(b1, ex, ty, 1, 1000);
    perform public.ev_set_setting('events_r1', 'off');
    perform pg_temp.ok(pg_temp.res(b2, ex, ty, 1, 1000) ->> 'reason' = 'not_open', 'F5: events_r1 off: reserve answers not_open');
    r := pg_temp.paid(oa, 'card');
    perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'issued')::boolean, 'F5: events_r1 off: a payment for an order that already exists is still settled');
    perform pg_temp.ok(pg_temp.t(h, format('select public.ev_pay_mark_manual_refund(%L)', oa)) = 'not_open', 'F5: events_r1 off: mark manual refund answers not_open');
    perform public.ev_set_setting('events_r1', 'on');

    -- F6: a late payment with no seat and no method yet (checkout.completed before collection.succeeded) must not crash.
    ex := pg_temp.ev(h, 'No method yet', 1); ty := pg_temp.ty(ex, 'VIP', 1000);
    oa := pg_temp.go(b1, ex, ty, 1, 1000);
    update public.ev_orders set expires_at = now() - interval '5 minutes' where id = oa;
    perform public.ev_pay_sweep();
    ob := pg_temp.go(b2, ex, ty, 1, 1000);
    perform pg_temp.paid(ob, 'card');
    r := public.ev_pay_order_paid('chk_' || replace(oa::text, '-', ''), 'ch_nm1', pg_temp.gross(oa), null, null);
    perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'late')::boolean and (r ->> 'needs_refund')::boolean and pg_temp.st(oa) = 'paid' and pg_temp.tix(ex, b1) = 0,
                       'F6: a late payment with no seat and NO payment method does not crash: paid, no ticket, refund owed');
    perform pg_temp.ok((select needs_manual_refund from public.ev_orders where id = oa) and (select refund_reason from public.ev_orders where id = oa) = 'late', 'F6: an unknown method is held as manual, with the reason late');
    r := public.ev_pay_order_details('ch_nm1', 'chk_' || replace(oa::text, '-', ''), 20000, 'card');
    perform pg_temp.ok((r ->> 'refund_by_card')::boolean and not (select needs_manual_refund from public.ev_orders where id = oa) and (select needs_refund from public.ev_orders where id = oa),
                       'F6: collection.succeeded says card: handed to the automatic card refund');
    ex := pg_temp.ev(h, 'No method bank', 1); ty := pg_temp.ty(ex, 'VIP', 1000);
    ob := pg_temp.go(b3, ex, ty, 1, 1000);
    update public.ev_orders set expires_at = now() - interval '5 minutes' where id = ob;
    perform public.ev_pay_sweep();
    perform pg_temp.paid(pg_temp.go(b2, ex, ty, 1, 1000), 'card');
    perform public.ev_pay_order_paid('chk_' || replace(ob::text, '-', ''), 'ch_nm2', pg_temp.gross(ob), null, null);
    r := public.ev_pay_order_details('ch_nm2', 'chk_' || replace(ob::text, '-', ''), 15000, 'bank_transfer');
    perform pg_temp.ok((select needs_manual_refund from public.ev_orders where id = ob) and r ->> 'refund_by_card' is null, 'F6: a bank transfer stays manual');
    -- the issue = -1 path (the person is waiting or declined by the time the payment lands), also with no method
    ex := pg_temp.ev(h, 'Issue refused', 5); ty := pg_temp.ty(ex, 'VIP', 1000);
    oa := pg_temp.go(b4, ex, ty, 1, 1000);
    insert into public.ev_registrations (event_id, user_id, status, name) values (ex, b4, 'declined', 'Pay Dayo');
    r := public.ev_pay_order_paid('chk_' || replace(oa::text, '-', ''), 'ch_nm3', pg_temp.gross(oa), null, null);
    perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'needs_refund')::boolean and not (r ->> 'issued')::boolean and (select needs_manual_refund from public.ev_orders where id = oa),
                       'F6: the path where the registration cannot take the seats, with no method, does not crash either');

    -- F7: an event that is cancelled or hidden issues nothing, on every path.
    ex := pg_temp.ev(h, 'Cancel with open order', 5); ty := pg_temp.ty(ex, 'VIP', 1000);
    oa := pg_temp.go(b1, ex, ty, 2, 1000);
    perform pg_temp.ok(pg_temp.left_of(ex, ty) = 3, 'F7 setup: an open order holds 2 of 5 seats');
    r := pg_temp.j(h, format('select public.ev_cancel_event(%L)', ex));
    perform pg_temp.ok((r ->> 'ok')::boolean and pg_temp.st(oa) = 'expired' and (select reconcile from public.ev_orders where id = oa), 'F7: cancelling an event expires its open orders and marks them for the sweeper');
    perform pg_temp.ok(pg_temp.left_of(ex, ty) = 5, 'F7: the seats are free at once');
    r := public.ev_pay_sweep();
    perform pg_temp.ok(r -> 'expired' @> jsonb_build_array(jsonb_build_object('order_id', oa, 'checkout_id', 'chk_' || replace(oa::text, '-', ''))) and not (select reconcile from public.ev_orders where id = oa),
                       'F7: the sweeper gets that order back to ask Bachs about its checkout, once');
    perform pg_temp.ok(not (public.ev_pay_sweep() -> 'expired' @> jsonb_build_array(jsonb_build_object('order_id', oa, 'checkout_id', 'chk_' || replace(oa::text, '-', '')))), 'F7: and only once');
    r := pg_temp.paid(oa, 'card');
    perform pg_temp.ok((r ->> 'needs_refund')::boolean and not (r ->> 'issued')::boolean and pg_temp.tix(ex, b1) = 0 and pg_temp.st(oa) = 'paid', 'F7: a payment that still lands on the cancelled event: no ticket, refund owed');
    -- an order still open (never swept) on an event cancelled by a direct update: the on-time path
    ex := pg_temp.ev(h, 'Cancelled underneath', 5); ty := pg_temp.ty(ex, 'VIP', 1000);
    oa := pg_temp.go(b2, ex, ty, 1, 1000);
    update public.events set status = 'cancelled' where id = ex;
    r := pg_temp.paid(oa, 'card');
    perform pg_temp.ok(pg_temp.st(oa) = 'paid' and (r ->> 'needs_refund')::boolean and not (r ->> 'late')::boolean and pg_temp.tix(ex, b2) = 0 and (select refund_reason from public.ev_orders where id = oa) is null,
                       'F7: an on-time payment on a cancelled event is not issued either: refund owed, and it is not called late');
    ex := pg_temp.ev(h, 'Hidden underneath', 5); ty := pg_temp.ty(ex, 'VIP', 1000);
    oa := pg_temp.go(b3, ex, ty, 1, 1000);
    update public.events set status = 'hidden' where id = ex;
    r := pg_temp.paid(oa, 'card');
    perform pg_temp.ok((r ->> 'needs_refund')::boolean and not (r ->> 'issued')::boolean and pg_temp.tix(ex, b3) = 0, 'F7: a hidden event issues nothing either');

    -- F14: declining a registration that holds a paid order is refused.
    ex := pg_temp.ev(h, 'Decline paid', 5); ty := pg_temp.ty(ex, 'VIP', 1000);
    oa := pg_temp.go(b1, ex, ty, 1, 1000);
    perform pg_temp.paid(oa, 'card');
    select id into reg_id from public.ev_registrations where event_id = ex and user_id = b1;
    r := pg_temp.j(h, format('select public.ev_decide(%L, %L)', reg_id, 'decline'));
    perform pg_temp.ok(r ->> 'reason' = 'paid_use_refund' and pg_temp.tix(ex, b1) = 1 and (select status from public.ev_registrations where id = reg_id) = 'going',
                       'F14: declining a paid registration answers paid_use_refund and changes nothing');
    perform public.ev_pay_refund_start(oa, h);
    perform public.ev_pay_refund_apply(null, 'rf_' || replace(oa::text, '-', ''), 'paid');
    perform pg_temp.ok(pg_temp.st(oa) = 'refunded', 'F14: the refund path is the way to undo it');
  end;

  -- ================================================== access ========
  for f in select p.oid as oid, p.oid::regprocedure as sig, p.proname as name
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and (p.proname like 'ev\_pay\_%' or p.proname in ('_ev_held', '_ev_host_can_sell', '_ev_pay_issue', '_ev_pay_recompute'))
  loop
    perform pg_temp.ok(not has_function_privilege('anon', f.oid, 'execute'), f.sig || ': anon cannot call');
    perform pg_temp.ok(has_function_privilege('authenticated', f.oid, 'execute') = (f.name in ('ev_pay_host_status', 'ev_pay_my_order', 'ev_pay_my_orders', 'ev_pay_event_orders', 'ev_pay_sales', 'ev_pay_mark_manual_refund')),
                       f.sig || ': a signed-in user may call only the six client functions');
    perform pg_temp.ok(not f.name like 'ev\_pay\_%' or has_function_privilege('service_role', f.oid, 'execute'), f.sig || ': the service role can call it');
  end loop;
  begin
    perform pg_temp.actor(b1);
    perform public.ev_pay_order_paid('x', 'x', '1', 'card', 1);
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a signed-in user must not mark an order paid');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a signed-in user cannot mark an order paid');
  end;
  begin
    perform pg_temp.anon();
    perform public.ev_pay_host_status();
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not call ev_pay_host_status');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot call the pay functions');
  end;
  raise notice 'ALL EVENTS R1 PAY TESTS PASSED';
end $$;
rollback;
