-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Notifications step 2 (supabase/events_r1_notify_emails.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, crew_announcements.sql, events_r1_events.sql, events_r1_registrations.sql,
-- events_r1_tickets.sql, events_r1_pops.sql, events_r1_pay.sql, events_r1_notify.sql and events_r1_notify_emails.sql loaded (the last two
-- twice is a good habit: both must be safe to run again). Ends with ALL NOTIFY EMAIL TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_notify_emails_test.sql
--
-- What it covers: every trigger (registration going, requested, approved, declined, waitlisted, promoted, guest-cancelled; order paid and
-- refunded; time, place and link changed; event cancelled; event published; a host Pop; thanks the morning after), the exact priorities, the
-- dedupe keys of things that can happen twice (cancel then register again, a second time change, a change undone, a cancelled event that
-- comes back and is cancelled again), who is left out, the WhatsApp copies, payloads without secrets, tickets added at claim time and not
-- stored, the claim's new re-checks, and that a broken queue never rolls back the guest's action.
-- It cannot show a real commit: the whole file is one transaction, so nothing here proves what happens when a trigger fails at COMMIT. The
-- triggers are AFTER ROW and catch their own errors, so there is no such failure to see.
begin;
select public.ev_set_setting('events_r1', 'on');
select public.ev_set_setting('paid_tickets', 'on');
select public.ev_set_ticket_secret(repeat('s', 40), true);
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
create function pg_temp.newuser(shown text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nme-' || u || '@evtest.invalid', false, '{}',
          json_build_object('name', shown)::jsonb, now(), now());
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
-- A live event made straight in the table (as the service role would), by a host, a few days ahead unless said otherwise.
create function pg_temp.ev(host uuid, ttl text, cap int default null, appr boolean default false, wl boolean default false,
                           starts timestamptz default now() + interval '3 days') returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id, kind, capacity, requires_approval, waitlist_on, created_at)
  values (ttl, 'Terra Kulture', starts, 'live', host, 'in_person', cap, appr, wl, now() - interval '5 days') returning id;
$$;
create function pg_temp.flags(e text, w text) returns void language plpgsql as $$
begin
  perform public.notify_set_flag('notify_email', e);
  perform public.notify_set_flag('notify_whatsapp', w);
end $$;
create function pg_temp.reg(u uuid, ev uuid) returns jsonb language plpgsql as $$
begin return pg_temp.j(u, format('select public.ev_register(%L, %L::jsonb)', ev, '{}')); end $$;
create function pg_temp.cancel(u uuid, ev uuid) returns text language plpgsql as $$
begin return pg_temp.t(u, format('select public.ev_cancel_registration(%L)', ev)); end $$;
create function pg_temp.rid(ev uuid, u uuid) returns uuid language sql as $$ select id from public.ev_registrations where event_id = ev and user_id = u; $$;
create function pg_temp.decide(h uuid, ev uuid, u uuid, act text) returns jsonb language plpgsql as $$
begin return pg_temp.j(h, format('select public.ev_decide(%L, %L)', pg_temp.rid(ev, u), act)); end $$;
-- A registration written straight into the table, in any status.
create function pg_temp.regd(ev uuid, u uuid, st text) returns void language sql as $$
  insert into public.ev_registrations (event_id, user_id, status, name, created_at) values (ev, u, st, 'x', now() - interval '3 days');
$$;
create function pg_temp.paidrow(ev uuid, u uuid) returns void language sql as $$
  insert into public.ev_orders (buyer_id, event_id, quantity, unit_price_kobo, gross_kobo, platform_fee_kobo, host_account, bachs_reference, expires_at, status, paid_at)
  values (u, ev, 1, 500000, 500000, 22500, 'platform', 'ord_nme_' || gen_random_uuid(), now() + interval '15 minutes', 'paid', now());
$$;
create function pg_temp.prefs(u uuid, wa boolean, num text default null, pops boolean default true, rem boolean default true) returns void language sql as $$
  insert into public.notify_prefs (user_id, email_reminders, email_pops, whatsapp_on, whatsapp_number, agreed_at, agreed_how)
  values (u, rem, pops, wa, num, case when wa then now() end, case when wa then 'checkout' end)
  on conflict (user_id) do update set email_reminders = excluded.email_reminders, email_pops = excluded.email_pops, whatsapp_on = excluded.whatsapp_on,
    whatsapp_number = excluded.whatsapp_number, agreed_at = excluded.agreed_at, agreed_how = excluded.agreed_how;
$$;
-- How many rows of a kind a person has for an event, on a channel and (optionally) in a status.
create function pg_temp.q(ev uuid, u uuid, k text, ch text default 'email', st text default null) returns integer language sql as $$
  select count(*)::int from public.notify_queue n where n.event_id = ev and n.user_id = u and n.kind = k and n.channel = ch and (st is null or n.status = st);
$$;
create function pg_temp.row1(ev uuid, u uuid, k text, ch text default 'email') returns public.notify_queue language sql as $$
  select n.* from public.notify_queue n where n.event_id = ev and n.user_id = u and n.kind = k and n.channel = ch order by n.created_at desc limit 1;
$$;
create function pg_temp.note(qid uuid) returns text language sql as $$ select string_agg(error, ' | ' order by created_at) from public.notify_sends where queue_id = qid; $$;
create function pg_temp.ty(ev uuid, nm text, price int default 0, cap int default null, srt int default 0) returns uuid language sql as $$
  insert into public.ev_ticket_types (event_id, name, price_naira, capacity, sort) values (ev, nm, price, cap, srt) returning id;
$$;
create function pg_temp.fee(price int, qty int) returns bigint language sql as $$ select round(price::numeric * 100 * qty * 0.045)::bigint; $$;
create function pg_temp.go(u uuid, ev uuid, ty uuid, qty int, price int) returns uuid language plpgsql as $$
declare r jsonb; oid uuid;
begin
  r := public.ev_pay_order_reserve(u, ev, ty, qty, pg_temp.fee(price, qty), '{}', null);
  if not (r ->> 'ok')::boolean then raise exception 'reserve failed: %', r; end if;
  oid := (r ->> 'order_id')::uuid;
  perform public.ev_pay_order_attach(oid, 'chk_' || replace(oid::text, '-', ''), 'https://checkout.bachs.io/c/' || oid, now() + interval '15 minutes');
  return oid;
end $$;
create function pg_temp.paid(oid uuid, meth text default 'card', fee bigint default 15000) returns jsonb language sql as $$
  select public.ev_pay_order_paid('chk_' || replace(oid::text, '-', ''), 'ch_' || replace(oid::text, '-', ''),
                                  (select to_char(gross_kobo / 100.0, 'FM999999990.00') from public.ev_orders where id = oid), meth, fee);
$$;
create temp table seen (kind text, priority int);
-- Forgets the queue between sections, after noting which kinds and priorities were seen and checking that no payload holds an address or a secret.
create function pg_temp.clear() returns void language plpgsql as $$
begin
  insert into pg_temp.seen select distinct kind, priority from public.notify_queue;
  if exists (select 1 from public.notify_queue where payload::text ~ '@' or payload::text ~* 'token|secret|zoom') then
    raise exception 'FAILED: a payload holds an address, a token or a secret';
  end if;
  delete from public.notify_queue;
end $$;

do $$
declare
  h uuid := pg_temp.newuser('Em Host');
  a uuid := pg_temp.newuser('Ada'); a2 uuid := pg_temp.newuser('Ada Two'); a3 uuid := pg_temp.newuser('Ada Three');
  b uuid := pg_temp.newuser('Bola'); c uuid := pg_temp.newuser('Chike'); d uuid := pg_temp.newuser('Dayo'); f uuid := pg_temp.newuser('Efe');
  g1 uuid := pg_temp.newuser('Gee One'); g2 uuid := pg_temp.newuser('Gee Two'); g3 uuid := pg_temp.newuser('Gee Three');
  g4 uuid := pg_temp.newuser('Gee Four'); g5 uuid := pg_temp.newuser('Gee Five'); g6 uuid := pg_temp.newuser('Gee Six');
  p1 uuid := pg_temp.newuser('Pee One'); p2 uuid := pg_temp.newuser('Pee Two'); p3 uuid := pg_temp.newuser('Pee Three');
  s1 uuid := pg_temp.newuser('Suppressed');
  e0 uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; e7 uuid; e8 uuid; e9 uuid; e10 uuid; e11 uuid; e12 uuid;
  vip uuid; o1 uuid; o2 uuid; r jsonb; n int; n2 int; x public.notify_queue; claimed jsonb; el jsonb; t0 timestamptz; v_due timestamptz;
  v_start timestamptz; ids uuid[]; room uuid; rf jsonb; kinds text[];
begin
  -- ================================================== 1. flags off: nothing is queued ========
  perform pg_temp.flags('off', 'off');
  e0 := pg_temp.ev(h, 'Quiet night');
  r := pg_temp.reg(a, e0);
  perform pg_temp.ok((r ->> 'ok')::boolean and not exists (select 1 from public.notify_queue), 'flags off: a registration, and the event itself, queue nothing');
  update public.events set venue_name = 'Elsewhere' where id = e0;
  perform pg_temp.ok(not exists (select 1 from public.notify_queue), 'flags off: a place change queues nothing');
  perform pg_temp.clear();

  -- ================================================== 2. G1 registered ========
  perform pg_temp.flags('on', 'off');
  e1 := pg_temp.ev(h, 'Afro Night');
  update public.events set slug = 'afro-night-ab12' where id = e1;
  r := pg_temp.reg(a, e1);
  perform pg_temp.ok((r ->> 'ok')::boolean and pg_temp.q(e1, a, 'registered') = 1, 'G1: registering for a free event queues "registered"');
  x := pg_temp.row1(e1, a, 'registered');
  perform pg_temp.ok(x.priority = 1 and x.cap_kind = 'guest' and x.channel = 'email' and x.status = 'queued' and x.expires_at is null and x.due_at <= now(),
                     'G1: priority 1, guest allowance, email, due now, no expiry');
  perform pg_temp.ok(x.payload ->> 'title' = 'Afro Night' and x.payload ->> 'slug' = 'afro-night-ab12' and x.payload ->> 'host_name' = 'Em Host'
                     and x.payload ->> 'name' = 'Ada' and x.payload ->> 'venue_name' = 'Terra Kulture' and x.payload ->> 'timezone' = 'Africa/Lagos'
                     and x.payload ->> 'kind' = 'in_person' and x.payload ? 'starts_at', 'G1: the payload has what the template shows');
  perform pg_temp.ok(not (x.payload ? 'tickets') and x.payload::text !~ '@' and x.payload::text !~* 'token|secret', 'G1: no ticket, token or address is stored in the payload');
  perform pg_temp.ok(x.dedupe_key like 'registered:' || pg_temp.rid(e1, a)::text || ':%', 'G1: the key names the registration and its cycle');
  -- Registering again while registered changes nothing.
  perform pg_temp.reg(a, e1);
  perform pg_temp.ok(pg_temp.q(e1, a, 'registered') = 1, 'G1: registering twice is one mail');

  -- ================================================== 3. tickets are added at claim time, not stored ========
  perform pg_temp.admin();
  claimed := public.notify_claim_due(500, array['log']);
  select e into el from jsonb_array_elements(claimed) e where e ->> 'id' = x.id::text;
  perform pg_temp.ok(el is not null and jsonb_array_length(el -> 'payload' -> 'tickets') = 1, 'claim: the ticket mail comes out with its ticket');
  perform pg_temp.ok((el -> 'payload' -> 'tickets' -> 0 ->> 'code') ~ '^[A-HJ-NP-Z2-9]{8}$' and (el -> 'payload' -> 'tickets' -> 0 ->> 'token') ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$',
                     'claim: with the door code and a signed token');
  perform pg_temp.ok(not (select payload from public.notify_queue where id = x.id) ? 'tickets', 'claim: and the queue row itself still holds no ticket');
  perform pg_temp.ok(not (el -> 'payload' ? 'email') and el ->> 'email' = (select lower(email) from auth.users where id = a), 'claim: the address is a field of the row, not of the payload');
  update public.notify_queue set status = 'sent' where id = x.id;

  -- ================================================== 4. cancel (G13), then register again sends again ========
  perform pg_temp.reg(a2, e1);
  perform pg_temp.ok(pg_temp.cancel(a2, e1) = 'ok' and pg_temp.q(e1, a2, 'you_cancelled') = 1, 'G13: the guest cancelling queues "you_cancelled"');
  perform pg_temp.ok((pg_temp.row1(e1, a2, 'you_cancelled')).priority = 3, 'G13: priority 3');
  claimed := public.notify_claim_due(500, array['log']);
  perform pg_temp.ok(pg_temp.note((pg_temp.row1(e1, a2, 'registered')).id) = 'skipped: no longer going', 'claim: "you''re going" for someone who has cancelled meanwhile is skipped');
  perform pg_temp.ok((pg_temp.row1(e1, a2, 'you_cancelled')).status = 'claimed', 'claim: but the cancellation mail goes');
  perform pg_temp.reg(a3, e1);
  perform pg_temp.cancel(a3, e1);
  perform pg_temp.reg(a3, e1);
  perform pg_temp.cancel(a3, e1);
  perform pg_temp.reg(a3, e1);
  perform pg_temp.ok(pg_temp.q(e1, a3, 'registered') = 3 and pg_temp.q(e1, a3, 'you_cancelled') = 2, 'DEDUPE: cancel then register again sends again, every time (3 "going", 2 "cancelled")');
  perform pg_temp.ok((select count(distinct dedupe_key) from public.notify_queue where event_id = e1 and user_id = a3) = 5, 'DEDUPE: each of them has its own key');

  -- Only the guest's own cancel counts: the server (no signed-in user) cancelling the same row, or another user doing it, is not "you cancelled".
  perform pg_temp.regd(e1, g4, 'going');
  update public.ev_registrations set status = 'cancelled' where event_id = e1 and user_id = g4;
  perform pg_temp.ok(pg_temp.q(e1, g4, 'you_cancelled') = 0, 'G13: the server cancelling a registration is not a guest cancellation');
  perform pg_temp.regd(e1, g5, 'going');
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  update public.ev_registrations set status = 'cancelled' where event_id = e1 and user_id = g5;
  perform pg_temp.admin();
  perform pg_temp.ok(pg_temp.q(e1, g5, 'you_cancelled') = 0, 'G13: nor is someone else cancelling it');
  delete from public.ev_registrations where event_id = e1 and user_id = g5;

  -- ================================================== 5. approval events: G3, G4, G5 ========
  e2 := pg_temp.ev(h, 'Closed door', null, true);
  perform pg_temp.reg(b, e2); perform pg_temp.reg(c, e2); perform pg_temp.reg(d, e2);
  perform pg_temp.ok(pg_temp.q(e2, b, 'request_sent') = 1 and pg_temp.q(e2, b, 'registered') = 0 and (pg_temp.row1(e2, b, 'request_sent')).priority = 2,
                     'G3: asking to join an approval event queues "request_sent" (priority 2), not "going"');
  perform pg_temp.ok((pg_temp.decide(h, e2, b, 'approve') ->> 'ok')::boolean and pg_temp.q(e2, b, 'approved') = 1 and (pg_temp.row1(e2, b, 'approved')).priority = 1,
                     'G4: the host approving queues "approved" (priority 1)');
  perform pg_temp.ok(pg_temp.q(e2, b, 'registered') = 0, 'G4: and not also "registered"');
  perform pg_temp.ok((pg_temp.decide(h, e2, c, 'decline') ->> 'ok')::boolean and pg_temp.q(e2, c, 'declined') = 1 and (pg_temp.row1(e2, c, 'declined')).priority = 3,
                     'G5: the host declining queues "declined" (priority 3)');
  perform pg_temp.ok(pg_temp.cancel(d, e2) = 'ok' and pg_temp.q(e2, d, 'you_cancelled') = 1, 'G13: cancelling a request is a cancellation too');
  -- The host cancelling someone else's registration is not the guest cancelling: declining a going guest says "declined" only.
  perform pg_temp.reg(f, e1);
  perform pg_temp.ok((pg_temp.decide(h, e1, f, 'decline') ->> 'ok')::boolean and pg_temp.q(e1, f, 'declined') = 1 and pg_temp.q(e1, f, 'you_cancelled') = 0,
                     'G5: the host removing a going guest says "declined", and is not a guest cancellation');

  -- ================================================== 6. the waitlist: G6, G7 ========
  e3 := pg_temp.ev(h, 'Tiny room', 1, false, true);
  perform pg_temp.reg(p1, e3); perform pg_temp.reg(p2, e3); perform pg_temp.reg(p3, e3);
  perform pg_temp.ok(pg_temp.q(e3, p1, 'registered') = 1 and pg_temp.q(e3, p2, 'waitlisted') = 1 and pg_temp.q(e3, p3, 'waitlisted') = 1
                     and (pg_temp.row1(e3, p2, 'waitlisted')).priority = 3, 'G6: a full event with a waitlist queues "waitlisted" (priority 3)');
  perform pg_temp.ok((pg_temp.row1(e3, p2, 'waitlisted')).payload -> 'waitlist_pos' = '1'::jsonb and (pg_temp.row1(e3, p3, 'waitlisted')).payload -> 'waitlist_pos' = '2'::jsonb,
                     'G6: with their place in line');
  perform pg_temp.cancel(p1, e3);
  perform pg_temp.ok(pg_temp.q(e3, p2, 'spot_opened') = 1 and (pg_temp.row1(e3, p2, 'spot_opened')).priority = 1 and pg_temp.q(e3, p3, 'spot_opened') = 0,
                     'G7: a cancel moves the next person up and queues "spot_opened" (priority 1) for them only');
  perform pg_temp.ok(pg_temp.q(e3, p2, 'registered') = 0, 'G7: and not also "registered"');
  -- The host promoting someone from the waitlist, and approving someone when it is full.
  perform pg_temp.ok((pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', e3, '{"capacity":2}')) ->> 'ok')::boolean and pg_temp.q(e3, p3, 'spot_opened') = 1,
                     'G7: more room moves the next person up too');
  e4 := pg_temp.ev(h, 'Approve and full', 1, true, true);
  perform pg_temp.reg(p1, e4); perform pg_temp.reg(p2, e4);
  perform pg_temp.decide(h, e4, p1, 'approve');
  perform pg_temp.ok((pg_temp.decide(h, e4, p2, 'approve') ->> 'ok')::boolean and pg_temp.q(e4, p2, 'waitlisted') = 1 and pg_temp.q(e4, p2, 'approved') = 0,
                     'G6: a yes from the host on a full event puts them on the waitlist and says so');

  -- ================================================== 7. paid: G2 receipt, G14 refund ========
  e5 := pg_temp.ev(h, 'Paid night');
  vip := pg_temp.ty(e5, 'VIP', 5000, null, 1);
  o1 := pg_temp.go(b, e5, vip, 2, 5000);
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where event_id = e5 and user_id = b), 'G2: nothing is queued while the order is only open');
  r := pg_temp.paid(o1);
  perform pg_temp.ok((r ->> 'issued')::boolean and pg_temp.q(e5, b, 'receipt') = 1 and pg_temp.q(e5, b, 'registered') = 0, 'G2: payment queues the receipt, and not "you''re going"');
  x := pg_temp.row1(e5, b, 'receipt');
  perform pg_temp.ok(x.priority = 1 and x.dedupe_key = 'receipt:' || o1::text and (x.payload ->> 'quantity')::int = 2 and x.payload ->> 'ticket_name' = 'VIP'
                     and (x.payload ->> 'gross_kobo')::bigint = 1000000 and x.payload ->> 'order_ref' like 'ORD-%', 'G2: priority 1, one per order, with quantity, ticket and amount');
  perform pg_temp.ok((x.payload ->> 'fee_kobo') is not distinct from (select case when buyer_pays_fee then processing_fee_kobo::text end from public.ev_orders where id = o1),
                     'G2: the fee shows only when the buyer paid it');
  perform pg_temp.paid(o1);
  perform pg_temp.ok(pg_temp.q(e5, b, 'receipt') = 1, 'G2: the same payment arriving twice is one receipt');
  claimed := public.notify_claim_due(500, array['log']);
  select e into el from jsonb_array_elements(claimed) e where e ->> 'id' = x.id::text;
  perform pg_temp.ok(jsonb_array_length(el -> 'payload' -> 'tickets') = 2, 'claim: the receipt comes with both seats');
  -- Refund: the guest is not cancelling, even if the refund is started under their own login.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  rf := public.ev_pay_refund_start(o1, h);
  perform pg_temp.admin();
  perform pg_temp.ok((rf ->> 'ok')::boolean and (select status from public.ev_registrations where event_id = e5 and user_id = b) = 'cancelled', 'refund started: the registration is cancelled');
  perform pg_temp.ok(pg_temp.q(e5, b, 'you_cancelled') = 0 and pg_temp.q(e5, b, 'refund_sent') = 0, 'G13: and a refund is not a guest cancellation; nothing sent for G14 yet');
  perform public.ev_pay_refund_apply('rfnd_n1', rf ->> 'reference', 'paid');
  x := pg_temp.row1(e5, b, 'refund_sent');
  perform pg_temp.ok(x.id is not null and x.priority = 2 and x.dedupe_key = 'refund_sent:' || o1::text and (x.payload ->> 'amount_kobo')::bigint = 1000000 and x.payload ->> 'method' = 'card',
                     'G14: the refund being paid queues "refund_sent" (priority 2) with the amount');
  perform public.ev_pay_refund_apply('rfnd_n1', rf ->> 'reference', 'paid');
  perform pg_temp.ok(pg_temp.q(e5, b, 'refund_sent') = 1, 'G14: and one only');
  -- A bank transfer paid back by hand.
  o2 := pg_temp.go(c, e5, vip, 1, 5000);
  perform pg_temp.paid(o2, 'bank_transfer');
  perform public.ev_pay_refund_start(o2, h);
  perform pg_temp.ok(pg_temp.t(h, format('select public.ev_pay_mark_manual_refund(%L)', o2)) = 'ok' and pg_temp.q(e5, c, 'refund_sent') = 1
                     and (pg_temp.row1(e5, c, 'refund_sent')).payload ->> 'method' = 'manual', 'G14: marking a bank transfer paid back queues it too, as a manual refund');

  -- ================================================== 8. event changed: G8 ========
  perform pg_temp.flags('on', 'on');
  e6 := pg_temp.ev(h, 'Moving night');
  perform pg_temp.regd(e6, g1, 'going'); perform pg_temp.regd(e6, g2, 'requested'); perform pg_temp.regd(e6, g3, 'waitlisted');
  perform pg_temp.regd(e6, g4, 'cancelled'); perform pg_temp.regd(e6, g5, 'declined'); perform pg_temp.regd(e6, g6, 'checked_in');
  perform pg_temp.paidrow(e6, g1); perform pg_temp.paidrow(e6, g2); perform pg_temp.paidrow(e6, g3);
  perform pg_temp.prefs(g1, true, '+2348011111111'); perform pg_temp.prefs(g2, true, '+2348022222222'); perform pg_temp.prefs(g3, false);
  select starts_at into t0 from public.events where id = e6;
  perform pg_temp.clear();
  r := pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', e6, json_build_object('starts_at', (t0 + interval '2 hours'))::text));
  perform pg_temp.ok((r ->> 'ok')::boolean, 'setup: the host moves the start by two hours');
  perform pg_temp.ok(pg_temp.q(e6, g1, 'event_changed') = 1 and pg_temp.q(e6, g2, 'event_changed') = 1 and pg_temp.q(e6, g3, 'event_changed') = 1
                     and pg_temp.q(e6, g4, 'event_changed') = 0 and pg_temp.q(e6, g5, 'event_changed') = 0 and pg_temp.q(e6, g6, 'event_changed') = 0,
                     'G8: going, requested and waitlisted guests are told; cancelled, declined and checked-in ones are not');
  x := pg_temp.row1(e6, g1, 'event_changed');
  perform pg_temp.ok(x.priority = 1 and (x.payload ->> 'time_changed')::boolean and not (x.payload ->> 'place_changed')::boolean and (x.payload ->> 'prev_starts_at')::timestamptz = t0
                     and (x.payload ->> 'starts_at')::timestamptz = t0 + interval '2 hours' and x.dedupe_key like 'event_changed:' || e6::text || ':%', 'G8: priority 1, says time changed, with the old and the new start');
  perform pg_temp.ok(pg_temp.q(e6, g1, 'event_changed', 'whatsapp') = 1 and pg_temp.q(e6, g2, 'event_changed', 'whatsapp') = 1 and pg_temp.q(e6, g3, 'event_changed', 'whatsapp') = 0,
                     'G8 WhatsApp: only guests with a paid order AND WhatsApp on (g3 paid but WhatsApp off, g4-g6 not told)');
  perform pg_temp.ok((pg_temp.row1(e6, g1, 'event_changed', 'whatsapp')).priority = 1 and (pg_temp.row1(e6, g1, 'event_changed', 'whatsapp')).cap_kind = 'guest', 'G8 WhatsApp: priority 1');
  -- A second edit before the first mail has gone: one mail, the first old value, the latest new value.
  perform pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', e6, json_build_object('starts_at', (t0 + interval '5 hours'))::text));
  perform pg_temp.ok(pg_temp.q(e6, g1, 'event_changed') = 1 and ((pg_temp.row1(e6, g1, 'event_changed')).payload ->> 'starts_at')::timestamptz = t0 + interval '5 hours',
                     'G8: a second edit before sending is folded into the waiting mail (one mail, the latest new time)');
  perform pg_temp.ok(((pg_temp.row1(e6, g1, 'event_changed')).payload ->> 'prev_starts_at')::timestamptz = t0 and pg_temp.q(e6, g1, 'event_changed', 'whatsapp') = 1,
                     'G8: which still shows the first old time (also on the WhatsApp copy)');
  -- Moved back before anyone was told: the waiting mails are dropped, with a note.
  perform pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', e6, json_build_object('starts_at', t0)::text));
  perform pg_temp.ok(pg_temp.q(e6, g1, 'event_changed', 'email', 'dropped') = 1 and pg_temp.q(e6, g1, 'event_changed', 'email', 'queued') = 0
                     and pg_temp.note((pg_temp.row1(e6, g1, 'event_changed')).id) like 'dropped: the change was undone%', 'G8: a change that is undone before sending is dropped, with a note');
  -- A new change after that is a new mail.
  perform pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', e6, json_build_object('starts_at', (t0 + interval '1 hour'))::text));
  perform pg_temp.ok(pg_temp.q(e6, g1, 'event_changed') = 2 and pg_temp.q(e6, g1, 'event_changed', 'email', 'queued') = 1, 'DEDUPE: after a dropped one, the next change is a new mail');
  -- The mail goes. Another change later is another mail.
  update public.notify_queue set status = 'sent' where event_id = e6 and kind = 'event_changed' and status = 'queued';
  perform pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', e6, json_build_object('starts_at', (t0 + interval '3 hours'))::text));
  perform pg_temp.ok(pg_temp.q(e6, g1, 'event_changed', 'email', 'queued') = 1 and pg_temp.q(e6, g1, 'event_changed') = 3
                     and ((pg_temp.row1(e6, g1, 'event_changed')).payload ->> 'prev_starts_at')::timestamptz = t0 + interval '1 hour',
                     'DEDUPE: a second time change, after the first mail went, sends again (and shows the time as it was then)');
  perform pg_temp.ok((select count(distinct dedupe_key) from public.notify_queue where event_id = e6 and user_id = g1 and kind = 'event_changed') = 6, 'DEDUPE: every row has its own key (email and WhatsApp, three each)');
  -- The place.
  update public.notify_queue set status = 'sent' where event_id = e6 and kind = 'event_changed' and status = 'queued';
  update public.events set venue_name = 'The Pent Studios' where id = e6;
  x := pg_temp.row1(e6, g1, 'event_changed');
  perform pg_temp.ok(x.status = 'queued' and (x.payload ->> 'place_changed')::boolean and not (x.payload ->> 'time_changed')::boolean and x.payload ->> 'prev_venue_name' = 'Terra Kulture'
                     and x.payload ->> 'venue_name' = 'The Pent Studios', 'G8: a new venue says place changed, with the old and the new');
  -- Things that are not a time or a place change nothing.
  select count(*) into n from public.notify_queue where event_id = e6;
  perform pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', e6, '{"description":"New words only"}'));
  update public.events set capacity = 50 where id = e6;
  perform pg_temp.ok((select count(*) from public.notify_queue where event_id = e6) = n, 'G8: a new description or capacity queues nothing');
  -- The online link.
  e7 := pg_temp.ev(h, 'Online night');
  update public.events set kind = 'online', venue_name = 'Online' where id = e7;
  insert into public.ev_event_links (event_id, link) values (e7, 'https://zoom.us/j/111');
  perform pg_temp.regd(e7, g1, 'going'); perform pg_temp.regd(e7, g4, 'cancelled');
  perform pg_temp.clear();
  update public.ev_event_links set link = 'https://zoom.us/j/999' where event_id = e7;
  x := pg_temp.row1(e7, g1, 'event_changed');
  perform pg_temp.ok(x.id is not null and (x.payload ->> 'link_changed')::boolean and not (x.payload ->> 'time_changed')::boolean and not (x.payload ->> 'place_changed')::boolean
                     and pg_temp.q(e7, g4, 'event_changed') = 0, 'G8: a new online link queues "event changed" with the link flag');
  perform pg_temp.ok(x.payload::text !~* 'zoom', 'G8: and the link itself is not in the payload');
  update public.ev_event_links set link = 'https://zoom.us/j/999' where event_id = e7;
  perform pg_temp.ok(pg_temp.q(e7, g1, 'event_changed') = 1, 'G8: saving the same link again queues nothing');
  -- Editing time and link in one go (what ev_update_event does) is one mail.
  update public.notify_queue set status = 'sent' where event_id = e7;
  update public.events set starts_at = starts_at + interval '1 day' where id = e7;
  update public.ev_event_links set link = 'https://zoom.us/j/555' where event_id = e7;
  x := pg_temp.row1(e7, g1, 'event_changed');
  perform pg_temp.ok(pg_temp.q(e7, g1, 'event_changed', 'email', 'queued') = 1 and (x.payload ->> 'time_changed')::boolean and (x.payload ->> 'link_changed')::boolean,
                     'G8: a time and a link edited together are one mail that says both');

  -- ================================================== 9. event cancelled: G9 ========
  e8 := pg_temp.ev(h, 'Doomed night');
  perform pg_temp.regd(e8, g1, 'going'); perform pg_temp.regd(e8, g2, 'requested'); perform pg_temp.regd(e8, g3, 'waitlisted');
  perform pg_temp.regd(e8, g4, 'cancelled'); perform pg_temp.regd(e8, g5, 'declined'); perform pg_temp.regd(e8, g6, 'going');
  perform pg_temp.paidrow(e8, g1); perform pg_temp.paidrow(e8, g3);
  perform pg_temp.clear();
  r := pg_temp.j(h, format('select public.ev_cancel_event(%L)', e8));
  perform pg_temp.ok((r ->> 'ok')::boolean, 'setup: the host cancels the event');
  perform pg_temp.ok(pg_temp.q(e8, g1, 'event_cancelled') = 1 and pg_temp.q(e8, g2, 'event_cancelled') = 1 and pg_temp.q(e8, g3, 'event_cancelled') = 1 and pg_temp.q(e8, g6, 'event_cancelled') = 1
                     and pg_temp.q(e8, g4, 'event_cancelled') = 0 and pg_temp.q(e8, g5, 'event_cancelled') = 0, 'G9: going, requested and waitlisted guests are told; cancelled and declined are not');
  perform pg_temp.ok((pg_temp.row1(e8, g1, 'event_cancelled')).priority = 1 and (pg_temp.row1(e8, g1, 'event_cancelled')).payload -> 'paid' = 'true'::jsonb
                     and (pg_temp.row1(e8, g6, 'event_cancelled')).payload -> 'paid' = 'false'::jsonb, 'G9: priority 1, and it says whether the guest paid (so the mail can promise a refund)');
  perform pg_temp.ok(pg_temp.q(e8, g1, 'event_cancelled', 'whatsapp') = 1 and pg_temp.q(e8, g3, 'event_cancelled', 'whatsapp') = 0 and pg_temp.q(e8, g6, 'event_cancelled', 'whatsapp') = 0
                     and pg_temp.q(e8, g2, 'event_cancelled', 'whatsapp') = 0, 'G9 WhatsApp: only the paid guest with WhatsApp on (g3 paid, WhatsApp off; g2 WhatsApp on, not paid)');
  perform pg_temp.j(h, format('select public.ev_cancel_event(%L)', e8));
  perform pg_temp.ok(pg_temp.q(e8, g1, 'event_cancelled') = 1, 'G9: cancelling a cancelled event again queues nothing');
  update public.events set status = 'live' where id = e8;
  update public.notify_queue set status = 'sent' where event_id = e8 and kind = 'event_cancelled';
  perform pg_temp.j(h, format('select public.ev_cancel_event(%L)', e8));
  perform pg_temp.ok(pg_temp.q(e8, g6, 'event_cancelled') = 2, 'DEDUPE: an event that came back and is cancelled again tells its guests again');

  -- ================================================== 10. published: H1 ========
  perform pg_temp.clear();
  r := pg_temp.j(h, 'select public.ev_create_event(''{"title":"Launch party"}''::jsonb)');
  perform pg_temp.ok((r ->> 'ok')::boolean, 'setup: the host publishes an event in one step');
  e9 := (r -> 'event' ->> 'id')::uuid;
  perform pg_temp.ok(pg_temp.q(e9, h, 'host_live') = 1 and (pg_temp.row1(e9, h, 'host_live')).priority = 3 and (pg_temp.row1(e9, h, 'host_live')).payload ->> 'slug' is not null
                     and (pg_temp.row1(e9, h, 'host_live')).payload ->> 'title' = 'Launch party', 'H1: publishing queues "your event is live" for the host (priority 3), with the link to share');
  update public.events set status = 'hidden' where id = e9;
  perform pg_temp.ok(pg_temp.q(e9, h, 'host_live') = 1, 'H1: hiding it queues nothing');
  update public.events set status = 'live' where id = e9;
  perform pg_temp.ok(pg_temp.q(e9, h, 'host_live') = 1, 'DEDUPE: and showing it again does not repeat the "live" mail');
  insert into public.events (title, venue_name, starts_at, status, created_at) values ('Hoppaz team listing', 'Somewhere', now() + interval '2 days', 'live', now());
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where payload ->> 'title' = 'Hoppaz team listing'), 'H1: an old listing with no host queues nothing');
  perform pg_temp.ok(pg_temp.q(e9, h, 'host_live') = 1 and (select count(*) from public.notify_queue where kind = 'host_live' and event_id = e9) = 1, 'H1: one mail');

  -- ================================================== 11. host Pops: G12 ========
  perform pg_temp.flags('on', 'off');
  e10 := pg_temp.ev(h, 'Pop night');
  perform pg_temp.regd(e10, g1, 'going'); perform pg_temp.regd(e10, g2, 'going'); perform pg_temp.regd(e10, g3, 'requested'); perform pg_temp.regd(e10, h, 'going');
  perform pg_temp.regd(e10, s1, 'going');
  perform pg_temp.prefs(g2, false, null, false);
  insert into public.notify_suppressed (address, reason) select lower(email), 'test' from auth.users where id = s1;
  perform pg_temp.clear();
  r := pg_temp.j(h, format('select public.ev_send_pop(%L, %L, %L, false, null)', e10, 'Doors at 8. Dress code is all black.', 'going'));
  perform pg_temp.ok((r ->> 'ok')::boolean, 'setup: the host sends a Pop to everyone going');
  perform pg_temp.ok(pg_temp.q(e10, g1, 'host_pop') = 1 and pg_temp.q(e10, g2, 'host_pop') = 0 and pg_temp.q(e10, g3, 'host_pop') = 0 and pg_temp.q(e10, h, 'host_pop') = 0
                     and pg_temp.q(e10, s1, 'host_pop') = 0, 'G12: going guests get it; not someone with Pop emails off, not a request, not the author, not a suppressed address');
  x := pg_temp.row1(e10, g1, 'host_pop');
  perform pg_temp.ok(x.priority = 3 and x.payload ->> 'body' = 'Doors at 8. Dress code is all black.' and x.payload ->> 'pop_id' is not null
                     and x.expires_at = (select coalesce(ends_at, starts_at + interval '3 hours') from public.events where id = e10) and x.dedupe_key like 'host_pop:%',
                     'G12: priority 3, the words of the Pop, and it expires when the event is over');
  r := pg_temp.j(h, format('select public.ev_send_pop(%L, %L, %L, false, null)', e10, 'Everyone please read.', 'everyone'));
  perform pg_temp.ok(pg_temp.q(e10, g3, 'host_pop') = 1 and pg_temp.q(e10, g1, 'host_pop') = 2, 'G12: a Pop to everyone also reaches the requests, and a second Pop is a second mail');
  -- A scheduled Pop goes when it is due, not when it is written.
  r := pg_temp.j(h, format('select public.ev_send_pop(%L, %L, %L, false, now() + interval ''1 hour'')', e10, 'See you soon.', 'going'));
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where payload ->> 'body' = 'See you soon.'), 'G12: a scheduled Pop queues nothing yet');
  update public.ev_pops set send_at = now() - interval '1 minute' where body = 'See you soon.' and event_id = e10;
  perform pg_temp.admin();
  perform public.ev_dispatch_due_pops();
  perform pg_temp.ok(pg_temp.q(e10, g1, 'host_pop') = 3, 'G12: it queues when the dispatcher sends it');
  -- An automatic Pop is a reminder (step 1), never also a host Pop.
  e11 := pg_temp.ev(h, 'Tomorrow night', null, false, false, now() + interval '23 hours 50 minutes');
  perform pg_temp.regd(e11, g1, 'going');
  perform public.ev_dispatch_due_pops();
  perform pg_temp.ok(exists (select 1 from public.ev_pops where event_id = e11 and auto = 'day_before' and status = 'sent'), 'setup: the automatic day-before Pop went out');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where event_id = e11 and kind = 'host_pop') and pg_temp.q(e11, g1, 'reminder_day') = 1,
                     'G12: an automatic Pop queues the reminder (step 1) and no host Pop');
  -- The claim asks again about Pop emails.
  perform pg_temp.prefs(g1, false, null, false);
  claimed := public.notify_claim_due(500, array['log']);
  perform pg_temp.ok(pg_temp.note((select id from public.notify_queue where event_id = e10 and user_id = g1 and kind = 'host_pop' order by created_at limit 1)) = 'skipped: email Pops are off',
                     'claim: Pop emails switched off after it was queued are skipped');

  -- ================================================== 12. thanks for coming: G15 ========
  perform pg_temp.flags('off', 'off');
  v_due := (date_trunc('day', now() at time zone 'Africa/Lagos') + interval '10 hours') at time zone 'Africa/Lagos';
  insert into public.crews (name, created_by) values ('Mainland Nights', h) returning id into room;
  e12 := pg_temp.ev(h, 'Last night', null, false, false, v_due - interval '14 hours');
  update public.events set room_id = room where id = e12;
  perform pg_temp.regd(e12, g1, 'checked_in');
  perform pg_temp.regd(e12, g2, 'going'); perform pg_temp.regd(e12, g3, 'going'); perform pg_temp.regd(e12, g4, 'cancelled'); perform pg_temp.regd(e12, g5, 'checked_in');
  perform pg_temp.regd(e12, g6, 'going'); perform pg_temp.regd(e12, p1, 'checked_in');
  insert into public.ev_tickets (event_id, registration_id, owner_id, seat, code, status, used_at)
  select e12, r2.id, r2.user_id, 1, translate(upper(substr(md5(gen_random_uuid()::text), 1, 8)), '01', 'XY'), 'used', now() from public.ev_registrations r2 where r2.event_id = e12 and r2.user_id = g2;
  insert into public.ev_tickets (event_id, registration_id, owner_id, seat, code, status)
  select e12, r2.id, r2.user_id, 1, translate(upper(substr(md5(gen_random_uuid()::text), 1, 8)), '01', 'XY'), 'valid' from public.ev_registrations r2 where r2.event_id = e12 and r2.user_id = g3;
  perform pg_temp.prefs(g5, false, null, true, false);
  perform pg_temp.prefs(g6, false);
  insert into public.notify_suppressed (address, reason) select lower(email), 'test' from auth.users where id = p1;
  insert into public.ev_tickets (event_id, registration_id, owner_id, seat, code, status, used_at)
  select e12, r2.id, r2.user_id, 1, translate(upper(substr(md5(gen_random_uuid()::text), 1, 8)), '01', 'XY'), 'used', now() from public.ev_registrations r2 where r2.event_id = e12 and r2.user_id = g6;
  perform pg_temp.clear();
  perform pg_temp.ok(public.notify_enqueue_thanks(v_due) = 0, 'G15: with the flag off, nothing is queued');
  perform pg_temp.flags('on', 'off');
  perform pg_temp.ok(public.notify_enqueue_thanks(v_due - interval '1 minute') = 0, 'G15: before 10:00 the morning after, nothing yet');
  n := public.notify_enqueue_thanks(v_due);
  perform pg_temp.ok(n = 3 and pg_temp.q(e12, g1, 'thanks') = 1 and pg_temp.q(e12, g2, 'thanks') = 1 and pg_temp.q(e12, g6, 'thanks') = 1,
                     'G15: at 10:00 the morning after, checked-in guests and holders of a used ticket are queued (3)');
  perform pg_temp.ok(pg_temp.q(e12, g3, 'thanks') = 0 and pg_temp.q(e12, g4, 'thanks') = 0 and pg_temp.q(e12, g5, 'thanks') = 0 and pg_temp.q(e12, p1, 'thanks') = 0,
                     'G15: not a guest who never came, who cancelled, who switched reminders off, or whose address is suppressed');
  x := pg_temp.row1(e12, g1, 'thanks');
  perform pg_temp.ok(x.priority = 5 and x.expires_at is null and x.due_at = v_due and x.payload ->> 'room_name' = 'Mainland Nights' and x.payload ->> 'room_slug' = room::text
                     and x.dedupe_key = 'thanks:' || e12::text || ':' || g1::text || ':email', 'G15: priority 5, no expiry (it may move to the next day), due at 10:00, with the room');
  perform pg_temp.ok(public.notify_enqueue_thanks(v_due + interval '5 minutes') = 0 and pg_temp.q(e12, g1, 'thanks') = 1, 'DEDUPE: the timer asking again queues nothing');
  perform pg_temp.ok(public.notify_enqueue_thanks(v_due + interval '31 hours') = 0, 'G15: a timer that was off for more than 30 hours does not send a stale thanks');
  -- An event that ended in the small hours counts as the night before; the timer (notify_tick) is what queues it.
  e12 := pg_temp.ev(h, 'Late night', null, false, false, v_due - interval '11 hours');
  update public.events set ends_at = v_due - interval '8 hours' where id = e12;
  perform pg_temp.regd(e12, g1, 'checked_in');
  e11 := pg_temp.ev(h, 'Called off', null, false, false, v_due - interval '14 hours');
  update public.events set status = 'cancelled' where id = e11;
  perform pg_temp.regd(e11, g1, 'checked_in');
  perform public.notify_tick(v_due);
  perform pg_temp.ok(pg_temp.q(e12, g1, 'thanks') = 1 and (pg_temp.row1(e12, g1, 'thanks')).due_at = v_due, 'G15: an event that ended at 2 a.m. gets its thanks at 10:00 that same morning, queued by notify_tick');
  perform pg_temp.ok(pg_temp.q(e11, g1, 'thanks') = 0, 'G15: a cancelled event gets no thanks');
  perform pg_temp.clear();

  -- ================================================== 13. a broken queue never rolls back the guest ========
  perform pg_temp.flags('on', 'on');
  alter table public.notify_queue add constraint ntf_break check (false) not valid;
  e9 := pg_temp.ev(h, 'Fragile night', null, true);
  perform pg_temp.ty(e9, 'Free', 0, null, 0);
  vip := pg_temp.ty(e9, 'Paid', 5000, null, 1);
  r := pg_temp.reg(c, e9);
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'registration' ->> 'status' = 'requested', 'NO ROLLBACK: registering works while the queue is broken');
  r := pg_temp.decide(h, e9, c, 'approve');
  perform pg_temp.ok((r ->> 'ok')::boolean and (select status from public.ev_registrations where event_id = e9 and user_id = c) = 'going', 'NO ROLLBACK: approving works');
  n := (pg_temp.cancel(c, e9) = 'ok')::int;
  perform pg_temp.ok(n = 1 and (select status from public.ev_registrations where event_id = e9 and user_id = c) = 'cancelled', 'NO ROLLBACK: cancelling works');
  r := pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', e9, json_build_object('starts_at', now() + interval '4 days')::text));
  perform pg_temp.reg(d, e9);
  r := pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', e9, json_build_object('starts_at', now() + interval '5 days')::text));
  perform pg_temp.ok((r ->> 'ok')::boolean and (select starts_at from public.events where id = e9) > now() + interval '4 days 23 hours', 'NO ROLLBACK: changing the time works');
  r := pg_temp.j(h, format('select public.ev_send_pop(%L, %L, %L, false, null)', e9, 'Still on.', 'everyone'));
  perform pg_temp.ok((r ->> 'ok')::boolean and exists (select 1 from public.ev_pops where event_id = e9 and body = 'Still on.' and status = 'sent'), 'NO ROLLBACK: sending a Pop works');
  o1 := pg_temp.go(f, e9, vip, 1, 5000);
  r := pg_temp.paid(o1);
  perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'issued')::boolean and (select status from public.ev_orders where id = o1) = 'paid'
                     and (select count(*) from public.ev_tickets where event_id = e9 and owner_id = f and status = 'valid') = 1, 'NO ROLLBACK: a payment still issues the ticket');
  rf := public.ev_pay_refund_start(o1, h);
  perform public.ev_pay_refund_apply('rfnd_n9', rf ->> 'reference', 'paid');
  perform pg_temp.ok((select status from public.ev_orders where id = o1) = 'refunded', 'NO ROLLBACK: a refund still completes');
  r := pg_temp.j(h, format('select public.ev_cancel_event(%L)', e9));
  perform pg_temp.ok((r ->> 'ok')::boolean and (select status from public.events where id = e9) = 'cancelled', 'NO ROLLBACK: cancelling the event works');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue), 'and nothing was queued at all (the queue was broken)');
  alter table public.notify_queue drop constraint ntf_break;
  perform pg_temp.reg(d, e1);
  perform pg_temp.ok(pg_temp.q(e1, d, 'registered') = 1, 'with the queue mended, mail is queued again');
  perform pg_temp.clear();

  -- ================================================== 14. who is never mailed ========
  perform pg_temp.flags('on', 'on');
  r := pg_temp.reg(s1, e1);
  perform pg_temp.ok((r ->> 'ok')::boolean and not exists (select 1 from public.notify_queue where user_id = s1), 'a suppressed address queues nothing');
  update auth.users set email = null where id = g5;
  perform pg_temp.regd(e1, g5, 'going');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where user_id = g5), 'a guest with no address queues nothing');
  perform pg_temp.clear();

  -- ================================================== 15. priorities and kinds, over the whole run ========
  perform pg_temp.clear();
  perform pg_temp.ok(not exists (
    select 1 from pg_temp.seen s join (values
      ('registered', 1), ('receipt', 1), ('request_sent', 2), ('approved', 1), ('declined', 3), ('waitlisted', 3), ('spot_opened', 1), ('event_changed', 1),
      ('event_cancelled', 1), ('host_pop', 3), ('you_cancelled', 3), ('refund_sent', 2), ('thanks', 5), ('host_live', 3)) as w(k, p) on w.k = s.kind
    where s.priority <> w.p), 'PRIORITIES: every kind was queued with exactly the priority of the plan');
  select array_agg(distinct kind order by kind) into kinds from pg_temp.seen where kind not in ('reminder_day', 'reminder_hour');
  perform pg_temp.ok(kinds = array['approved', 'declined', 'event_cancelled', 'event_changed', 'host_live', 'host_pop', 'receipt', 'refund_sent', 'registered', 'request_sent', 'spot_opened', 'thanks', 'waitlisted', 'you_cancelled'],
                     'all 14 kinds of this step were seen: ' || array_to_string(kinds, ', '));

  -- ================================================== 16. nobody signed in can call any of it ========
  perform pg_temp.ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('_notify_name', '_notify_event_end', '_notify_event_facts', '_notify_email_ok', '_notify_wa_ok', '_notify_reg_paid', '_notify_us',
       '_notify_token', '_notify_claim_extra', '_notify_send', '_notify_fan', '_notify_reg_trigger', '_notify_order_trigger', '_notify_change_flags', '_notify_event_changed',
       '_notify_event_change_trigger', '_notify_link_trigger', '_notify_event_status_trigger', '_notify_host_pop_trigger', 'notify_enqueue_thanks')
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
    'ACCESS: anon and authenticated cannot call any function of this step');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.notify_enqueue_thanks(timestamptz)', 'execute'), 'ACCESS: the service role can call notify_enqueue_thanks');
  perform pg_temp.anon();
  begin
    perform public.notify_enqueue_thanks(now());
    perform pg_temp.admin();
    raise exception 'FAILED: anon ran notify_enqueue_thanks';
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'ACCESS: a call from anon is refused');
  end;

  raise notice 'ALL NOTIFY EMAIL TESTS PASSED';
end $$;
rollback;
