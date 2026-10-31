-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Notifications step 1 (supabase/events_r1_notify.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, events_r1_events.sql, events_r1_registrations.sql, events_r1_tickets.sql, events_r1_pops.sql, events_r1_pay.sql and
-- events_r1_notify.sql loaded (the notify file loaded twice is a good habit: it must be safe to run again). Ends with ALL NOTIFY TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_notify_test.sql
--
-- What it covers: dedupe, the claim not handing a row out twice, the daily cap running out (and the Lagos day), the paid-guest rule for
-- WhatsApp, the skip rules (cancelled, checked in, registered under 12 hours ago, suppressed, switched off), priority dropping, the exact
-- reminder timing, the settle function, and the flags off doing nothing.
-- It cannot prove two runs at once never share a row (one session cannot race itself): that comes from "for update skip locked", which the
-- test checks is in the function, and from claim-then-claim-again handing out nothing. The pg_net call is checked only up to the point
-- where it would be made.
begin;
-- Release 1 is on (the dispatcher needs it). The notify flags are set per section.
select public.ev_set_setting('events_r1', 'on');
-- This file tests step 1 alone. If events_r1_notify_emails.sql (step 2) is loaded too, its triggers would queue their own mails for the
-- registrations, orders and events made below, so they are switched off for this transaction (rolled back with everything else).
-- events_r1_notify_emails_test.sql tests them.
do $off$
declare t record;
begin
  for t in
    select c.relname, g.tgname from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not g.tgisinternal
       and g.tgname in ('notify_reg_insert', 'notify_reg_update', 'notify_order_status', 'notify_event_change', 'notify_event_insert', 'notify_event_status',
                        'notify_link_insert', 'notify_link_update', 'notify_host_pop_insert', 'notify_host_pop_update')
  loop
    execute format('alter table public.%I disable trigger %I', t.relname, t.tgname);
  end loop;
end $off$;
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
          case when guest then null else 'ntf-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
create function pg_temp.mail(u uuid) returns text language sql as $$ select lower(btrim(email)) from auth.users where id = u; $$;
create function pg_temp.flags(e text, w text) returns void language plpgsql as $$
begin
  perform public.notify_set_flag('notify_email', e);
  perform public.notify_set_flag('notify_whatsapp', w);
end $$;
-- A live event made straight in the table. Made 5 days ago unless said otherwise, so the dispatcher does not call it brand new.
create function pg_temp.ev(host uuid, ttl text, starts timestamptz, st text default 'live') returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id, kind, created_at)
  values (ttl, 'Somewhere', starts, st, host, 'in_person', now() - interval '5 days') returning id;
$$;
create function pg_temp.reg(ev uuid, u uuid, st text, made timestamptz default null) returns void language sql as $$
  insert into public.ev_registrations (event_id, user_id, status, name, created_at) values (ev, u, st, 'x', coalesce(made, now() - interval '3 days'));
$$;
create function pg_temp.paid(ev uuid, u uuid, st text default 'paid') returns void language sql as $$
  insert into public.ev_orders (buyer_id, event_id, quantity, unit_price_kobo, gross_kobo, platform_fee_kobo, host_account, bachs_reference, expires_at, status, paid_at)
  values (u, ev, 1, 500000, 500000, 22500, 'acct_TESTTESTTEST', 'ord_ntf_' || gen_random_uuid(), now() + interval '15 minutes', st, now());
$$;
create function pg_temp.prefs(u uuid, wa boolean, num text default null, email_rem boolean default true) returns void language sql as $$
  insert into public.notify_prefs (user_id, email_reminders, whatsapp_on, whatsapp_number, agreed_at, agreed_how)
  values (u, email_rem, wa, num, case when wa then now() end, case when wa then 'checkout' end);
$$;
create function pg_temp.q(p_ev uuid, p_u uuid, p_kind text, p_ch text) returns integer language sql as $$
  select count(*)::int from public.notify_queue n where n.event_id = p_ev and n.user_id = p_u and n.kind = p_kind and n.channel = p_ch;
$$;
-- After a dispatch: forget what it did for events that are not part of the test (a local database may hold some).
create function pg_temp.others(keep uuid[]) returns void language plpgsql as $$
begin
  delete from public.notify_queue where event_id is not null and not (event_id = any (keep));
  update public.ev_pops set sent_at = sent_at - interval '2 days'
   where auto in ('day_before', 'hour_before') and sent_at is not null and not (event_id = any (keep));
end $$;
create function pg_temp.tkt(ev uuid, u uuid, seatno integer, st text) returns void language sql as $$
  insert into public.ev_tickets (event_id, registration_id, owner_id, seat, code, status, used_at)
  select ev, r.id, u, seatno, translate(upper(substr(md5(gen_random_uuid()::text), 1, 8)), '01', 'XY'), st, case when st = 'used' then now() end
    from public.ev_registrations r where r.event_id = ev and r.user_id = u;
$$;
create function pg_temp.dispatch() returns integer language sql as $$ select public.ev_dispatch_due_pops(); $$;
create function pg_temp.note(qid uuid) returns text language sql as $$ select string_agg(error, ' | ' order by created_at) from public.notify_sends where queue_id = qid; $$;

do $$
declare
  h uuid := pg_temp.newuser('Ntf Host'); stranger uuid := pg_temp.newuser('Ntf Stranger');
  gA uuid := pg_temp.newuser('Ntf A free'); gB uuid := pg_temp.newuser('Ntf B paid wa'); gC uuid := pg_temp.newuser('Ntf C wa no order');
  gD uuid := pg_temp.newuser('Ntf D refunded'); gE uuid := pg_temp.newuser('Ntf E paid wa off'); gF uuid := pg_temp.newuser('Ntf F new reg');
  gG uuid := pg_temp.newuser('Ntf G cancelled'); gH uuid := pg_temp.newuser('Ntf H checked in'); gI uuid := pg_temp.newuser('Ntf I requested');
  gJ uuid := pg_temp.newuser('Ntf J suppressed'); gK uuid := pg_temp.newuser('Ntf K email off'); gL uuid := pg_temp.newuser('Ntf L no email', true);
  gM uuid := pg_temp.newuser('Ntf M paid new reg'); gN uuid := pg_temp.newuser('Ntf N paid wa email off');
  gP uuid := pg_temp.newuser('Ntf P three seats'); gQ uuid := pg_temp.newuser('Ntf Q scanned later'); gR uuid := pg_temp.newuser('Ntf R refunded later'); gS uuid := pg_temp.newuser('Ntf S paid ok');
  e0 uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid;
  r jsonb; rows1 jsonb; rows2 jsonb; n int; id1 uuid; id2 uuid; pid uuid; f record;
  starts timestamptz; nextday timestamptz; qa uuid; qb uuid; qc uuid; t1 boolean; t2 boolean; t3 boolean;
begin
  -- ------------------------------------------------------------ closed tables, and what a person may read of their own prefs ---
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.notify_queue', 'select') and not has_table_privilege('authenticated', 'public.notify_sends', 'select')
                     and not has_table_privilege('authenticated', 'public.notify_suppressed', 'select') and not has_table_privilege('authenticated', 'public.notify_caps', 'select')
                     and not has_table_privilege('authenticated', 'public.notify_cap_use', 'select') and not has_table_privilege('authenticated', 'public.notify_config', 'select')
                     and not has_table_privilege('anon', 'public.notify_queue', 'select') and not has_table_privilege('anon', 'public.notify_prefs', 'select'),
                     'the queue, the send log, the suppression list, the caps and the config are closed to anon and authenticated');
  perform pg_temp.ok(has_table_privilege('authenticated', 'public.notify_prefs', 'select') and not has_table_privilege('authenticated', 'public.notify_prefs', 'insert')
                     and not has_table_privilege('authenticated', 'public.notify_prefs', 'update') and not has_table_privilege('authenticated', 'public.notify_prefs', 'delete'),
                     'notify_prefs can be read, and only read, by a signed-in person');
  perform pg_temp.prefs(gA, false); perform pg_temp.prefs(gB, true, '+2348012345678');
  perform pg_temp.actor(gA);
  select count(*) into n from public.notify_prefs;
  perform pg_temp.admin();
  perform pg_temp.ok(n = 1, 'a person reads only their own prefs row');
  begin
    perform pg_temp.actor(gA);
    update public.notify_prefs set whatsapp_on = false where user_id = gA;
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a person must not write prefs');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a person cannot write prefs directly');
  end;
  begin
    perform pg_temp.anon();
    perform count(*) from public.notify_prefs;
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not read prefs');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot read prefs');
  end;
  begin
    insert into public.notify_prefs (user_id, whatsapp_on) values (gC, true);
    perform pg_temp.ok(false, 'WhatsApp on needs a number and an agreement');
  exception when check_violation then
    perform pg_temp.ok(true, 'WhatsApp cannot be on without a number and a record of the agreement');
  end;
  begin
    insert into public.notify_prefs (user_id, whatsapp_number) values (gC, '0801 234 5678');
    perform pg_temp.ok(false, 'a bad number must be refused');
  exception when check_violation then
    perform pg_temp.ok(true, 'a WhatsApp number must be in international form');
  end;
  begin
    insert into public.notify_suppressed (address, reason) values ('Mixed@Case.com', 'complaint');
    perform pg_temp.ok(false, 'a mixed case address must be refused');
  exception when check_violation then
    perform pg_temp.ok(true, 'suppressed addresses are kept lower case');
  end;
  delete from public.notify_prefs;

  -- ------------------------------------------------------------ seeds and the flags ---
  perform pg_temp.ok((select daily_cap from public.notify_caps where provider = 'brevo' and kind = 'guest') = 300
                     and (select daily_cap from public.notify_caps where provider = 'mailjet' and kind = 'guest') = 100
                     and (select daily_cap from public.notify_caps where provider = 'mailtrap' and kind = 'code') = 150
                     and (select daily_cap from public.notify_caps where provider = 'mailjet' and kind = 'code') = 100
                     and (select daily_cap from public.notify_caps where provider = 'log' and kind = 'guest') >= 1000000,
                     'the caps are seeded: brevo guest 300, mailjet guest 100, mailtrap code 150, mailjet code 100, log unlimited');
  perform pg_temp.ok(exists (select 1 from public.ev_settings where key = 'notify_email') and exists (select 1 from public.ev_settings where key = 'notify_whatsapp'),
                     'the two flags exist in ev_settings');
  perform public.notify_set_flag('notify_email', 'on');
  insert into public.ev_settings (key, value) values ('notify_email', 'off'), ('notify_whatsapp', 'off') on conflict (key) do nothing;
  perform pg_temp.ok((select value from public.ev_settings where key = 'notify_email') = 'on', 'the seed statement of the file leaves a flag that is on alone');
  perform pg_temp.ok(public.notify_set_flag('notify_sms', 'on') = 'bad_key' and public.notify_set_flag('notify_email', 'maybe') = 'bad_value' and public.notify_set_flag(null, 'on') = 'bad_key',
                     'the flag setter refuses an unknown key and a bad value');

  -- ------------------------------------------------------------ flags off do nothing ---
  perform pg_temp.flags('off', 'off');
  delete from public.notify_queue;
  e0 := pg_temp.ev(h, 'Flags off night', now() + interval '24 hours' - interval '1 minute');
  perform pg_temp.reg(e0, gA, 'going'); perform pg_temp.reg(e0, gB, 'going');
  perform pg_temp.paid(e0, gB);
  perform pg_temp.prefs(gB, true, '+2348012345678');
  perform pg_temp.ok(public.notify_enqueue(gA, 'ticket', e0) is null and not exists (select 1 from public.notify_queue), 'flags off: notify_enqueue queues nothing');
  perform pg_temp.dispatch();
  perform pg_temp.ok(exists (select 1 from public.ev_pops where event_id = e0 and auto = 'day_before' and status = 'sent'), 'the day-before Pop went out (flags off)');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue), 'flags off: a Pop going out queues no reminders');
  select id into pid from public.ev_pops where event_id = e0 and auto = 'day_before';
  perform pg_temp.ok(public.notify_enqueue_pop(pid) = 0 and public.notify_enqueue_due() = 0, 'flags off: the hook and the safety net queue nothing');
  insert into public.notify_queue (user_id, kind, channel, dedupe_key, due_at) values (gA, 'ticket', 'email', 'off-1', now() - interval '1 minute');
  insert into public.notify_queue (user_id, kind, channel, dedupe_key, due_at) values (gB, 'ticket', 'whatsapp', 'off-2', now() - interval '1 minute');
  perform pg_temp.ok(public.notify_claim_due() = '[]'::jsonb and not public.notify_has_due() and public.notify_tick() = false, 'flags off: nothing is claimed, nothing is due, the timer does nothing');
  perform pg_temp.ok((select count(*) from public.notify_queue where status = 'queued') = 2 and not exists (select 1 from public.notify_sends), 'flags off: the rows are untouched and nothing is logged');
  -- One flag on does not wake the other channel.
  perform pg_temp.flags('on', 'off');
  r := public.notify_claim_due();
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'channel' = 'email' and r -> 0 ->> 'email' = pg_temp.mail(gA), 'only email on: the email row is handed out, the WhatsApp row is not');
  perform pg_temp.ok(public.notify_enqueue(gB, 'ticket', e0, '{}', 3, null, 'off-wa', 'whatsapp') is null, 'only email on: a WhatsApp row cannot be queued');
  perform pg_temp.flags('off', 'on');
  perform pg_temp.ok(public.notify_enqueue(gB, 'ticket', e0, '{}', 3, null, 'off-em', 'email') is null, 'only WhatsApp on: an email row cannot be queued');
  -- The Pop of e0 was sent a moment ago with no rows: keep it out of the safety net for the rest of the test.
  update public.ev_pops set sent_at = sent_at - interval '2 days' where event_id = e0;
  delete from public.notify_queue; delete from public.notify_sends;

  -- ------------------------------------------------------------ dedupe ---
  perform pg_temp.flags('on', 'on');
  id1 := public.notify_enqueue(gA, 'ticket', e0);
  id2 := public.notify_enqueue(gA, 'ticket', e0);
  perform pg_temp.ok(id1 is not null and id2 is null and (select count(*) from public.notify_queue) = 1, 'dedupe: the same message to the same person for the same event is queued once');
  perform pg_temp.ok((select dedupe_key from public.notify_queue where id = id1) = 'ticket:' || e0 || ':' || gA || ':email', 'dedupe: the default key is kind:event:user:channel');
  perform pg_temp.ok(public.notify_enqueue(gA, 'ticket', e0, '{}', 3, null, null, 'whatsapp') is not null, 'dedupe: the same message on another channel is a different row');
  perform pg_temp.ok(public.notify_enqueue(gB, 'ticket', e0) is not null, 'dedupe: another person gets their own');
  perform pg_temp.ok(public.notify_enqueue(gA, 'receipt', e0, '{}', 3, null, 'ticket:' || e0 || ':' || gA || ':email') is null, 'dedupe: an explicit key that is already used is refused');
  begin
    perform public.notify_enqueue(gA, 'thanks', e0, '{}', 6);
    perform pg_temp.ok(false, 'priority 6 must be refused');
  exception when check_violation then
    perform pg_temp.ok(true, 'priority outside 1 to 5 is refused');
  end;
  delete from public.notify_queue; delete from public.notify_sends;

  -- ------------------------------------------------------------ the day-before Pop: who gets what ---
  delete from public.notify_prefs;
  e1 := pg_temp.ev(h, 'Reminder night', now() + interval '24 hours' - interval '1 minute');
  starts := (select starts_at from public.events where id = e1);
  perform pg_temp.reg(e1, gA, 'going');
  perform pg_temp.reg(e1, gB, 'going'); perform pg_temp.paid(e1, gB); perform pg_temp.prefs(gB, true, '+2348012345678');
  perform pg_temp.reg(e1, gC, 'going'); perform pg_temp.prefs(gC, true, '+2348022222222');
  perform pg_temp.reg(e1, gD, 'going'); perform pg_temp.paid(e1, gD, 'refunded'); perform pg_temp.prefs(gD, true, '+2348033333333');
  perform pg_temp.reg(e1, gE, 'going'); perform pg_temp.paid(e1, gE); perform pg_temp.prefs(gE, false);
  perform pg_temp.reg(e1, gF, 'going', now() - interval '1 hour');
  perform pg_temp.reg(e1, gG, 'cancelled');
  perform pg_temp.reg(e1, gH, 'checked_in');
  perform pg_temp.reg(e1, gI, 'requested');
  perform pg_temp.reg(e1, gJ, 'going'); insert into public.notify_suppressed (address, reason) values (pg_temp.mail(gJ), 'hard_bounce');
  perform pg_temp.reg(e1, gK, 'going'); perform pg_temp.prefs(gK, false, null, false);
  perform pg_temp.reg(e1, gL, 'going');
  perform pg_temp.reg(e1, gM, 'going', now() - interval '2 hours'); perform pg_temp.paid(e1, gM); perform pg_temp.prefs(gM, true, '+2348044444444');
  perform pg_temp.reg(e1, gN, 'going'); perform pg_temp.paid(e1, gN); perform pg_temp.prefs(gN, true, '+2348055555555', false);
  n := pg_temp.dispatch();
  select id into pid from public.ev_pops where event_id = e1 and auto = 'day_before';
  perform pg_temp.ok(pid is not null and (select status from public.ev_pops where id = pid) = 'sent', 'the day-before Pop of the event went out');
  -- Anything the dispatcher did for other events in this database is not part of this test.
  perform pg_temp.others(array[e1]);

  perform pg_temp.ok(pg_temp.q(e1, gA, 'reminder_day', 'email') = 1 and pg_temp.q(e1, gA, 'reminder_day', 'whatsapp') = 0, 'a free guest gets the email and no WhatsApp');
  perform pg_temp.ok(pg_temp.q(e1, gB, 'reminder_day', 'email') = 1 and pg_temp.q(e1, gB, 'reminder_day', 'whatsapp') = 1, 'a paid guest with WhatsApp on gets the email and a separate WhatsApp row');
  perform pg_temp.ok(pg_temp.q(e1, gC, 'reminder_day', 'email') = 1 and pg_temp.q(e1, gC, 'reminder_day', 'whatsapp') = 0, 'WhatsApp on but no paid order: no WhatsApp row');
  perform pg_temp.ok(pg_temp.q(e1, gD, 'reminder_day', 'email') = 1 and pg_temp.q(e1, gD, 'reminder_day', 'whatsapp') = 0, 'a refunded order is not a paid order: no WhatsApp row');
  perform pg_temp.ok(pg_temp.q(e1, gE, 'reminder_day', 'email') = 1 and pg_temp.q(e1, gE, 'reminder_day', 'whatsapp') = 0, 'a paid guest who did not agree to WhatsApp gets no WhatsApp row');
  perform pg_temp.ok(pg_temp.q(e1, gF, 'reminder_day', 'email') = 0, 'skip rule: no day-before email to someone who registered 1 hour ago');
  perform pg_temp.ok(pg_temp.q(e1, gM, 'reminder_day', 'email') = 0 and pg_temp.q(e1, gM, 'reminder_day', 'whatsapp') = 0, 'skip rule: and no day-before WhatsApp either');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where event_id = e1 and user_id = gG), 'skip rule: nobody who cancelled');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where event_id = e1 and user_id = gH), 'skip rule: nobody who is checked in');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where event_id = e1 and user_id = gI), 'someone waiting for approval is not a recipient');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where event_id = e1 and user_id = gJ), 'skip rule: a suppressed address gets nothing');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where event_id = e1 and user_id = gK), 'skip rule: email reminders switched off, no email');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where event_id = e1 and user_id = gL), 'a guest with no email address gets no email');
  perform pg_temp.ok(pg_temp.q(e1, gN, 'reminder_day', 'email') = 0 and pg_temp.q(e1, gN, 'reminder_day', 'whatsapp') = 1,
                     'email reminders off does not stop the WhatsApp of a paid guest who agreed to it');
  perform pg_temp.ok((select count(*) from public.notify_queue where event_id = e1 and channel = 'email') = 5
                     and (select count(*) from public.notify_queue where event_id = e1 and channel = 'whatsapp') = 2, 'in all: 5 emails and 2 WhatsApp rows');
  perform pg_temp.ok((select send_at from public.ev_pops where id = pid) = starts - interval '24 hours', 'timing: the Pop is for exactly 24 hours before the start');
  perform pg_temp.ok((select bool_and(due_at <= now() and expires_at = starts - interval '1 hour' and status = 'queued') from public.notify_queue where event_id = e1),
                     'timing: the rows are due the moment the Pop goes, and go stale when the hour-before one is due');
  perform pg_temp.ok((select bool_and(priority = 2 and cap_kind = 'guest' and payload ->> 'pop_id' = pid::text and payload ->> 'title' = 'Reminder night') from public.notify_queue where event_id = e1),
                     'the day-before rows are priority 2, guest mail, and carry the event facts');
  perform pg_temp.ok(public.notify_enqueue_pop(pid) = 0 and (select count(*) from public.notify_queue where event_id = e1) = 7, 'dedupe: asking for the same Pop again queues nothing');
  -- The safety net: rows lost, the net puts them back, once.
  delete from public.notify_queue where event_id = e1;
  n := public.notify_enqueue_due();
  perform pg_temp.ok(n >= 7 and (select count(*) from public.notify_queue where event_id = e1) = 7, 'the safety net queues the reminders of a recent Pop that has none');
  perform pg_temp.ok(public.notify_enqueue_due() = 0, 'and does not do it twice');

  -- ------------------------------------------------------------ the hour-before Pop ---
  e2 := pg_temp.ev(h, 'Soon night', now() + interval '1 hour' - interval '1 minute');
  perform pg_temp.reg(e2, gA, 'going', now() - interval '1 hour');
  perform pg_temp.reg(e2, gH, 'checked_in');
  perform pg_temp.reg(e2, gB, 'going'); perform pg_temp.paid(e2, gB);
  perform pg_temp.dispatch();
  perform pg_temp.others(array[e1, e2]);
  perform pg_temp.ok(exists (select 1 from public.ev_pops where event_id = e2 and auto = 'hour_before' and status = 'sent') and not exists (select 1 from public.ev_pops where event_id = e2 and auto = 'day_before'),
                     'only the hour-before Pop of an event starting in an hour is made');
  perform pg_temp.ok(pg_temp.q(e2, gA, 'reminder_hour', 'email') = 1, 'the 12 hour rule is only for the day before: a late registrant still gets the hour-before email');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where event_id = e2 and user_id = gH), 'skip rule: nobody who is checked in gets the hour-before reminder');
  perform pg_temp.ok(pg_temp.q(e2, gB, 'reminder_hour', 'email') = 1 and pg_temp.q(e2, gB, 'reminder_hour', 'whatsapp') = 1, 'the paid guest with WhatsApp on gets both for the hour before');
  perform pg_temp.ok((select priority from public.notify_queue where event_id = e2 and user_id = gA and channel = 'email') = 4
                     and (select priority from public.notify_queue where event_id = e2 and user_id = gB and channel = 'whatsapp') = 2, 'the hour-before email is priority 4, a WhatsApp reminder priority 2');
  perform pg_temp.ok((select bool_and(expires_at = (select starts_at from public.events where id = e2)) from public.notify_queue where event_id = e2)
                     and (select send_at from public.ev_pops where event_id = e2 and auto = 'hour_before') = (select starts_at - interval '1 hour' from public.events where id = e2),
                     'timing: the Pop is for exactly 1 hour before, and the rows expire at the start');
  -- A host's own Pop, and a Pop that is not a reminder, queue nothing.
  select count(*) into n from public.notify_queue;
  insert into public.ev_pops (event_id, author_id, body, audience, status, auto) values (e2, h, 'Bring snacks', 'going', 'scheduled', null) returning id into id1;
  update public.ev_pops set status = 'sent', sent_at = now() where id = id1;
  insert into public.ev_pops (event_id, author_id, body, audience, status, auto) values (e2, h, 'Doors open', 'going', 'scheduled', 'doors_open') returning id into id2;
  update public.ev_pops set status = 'sent', sent_at = now() where id = id2;
  perform pg_temp.ok((select count(*) from public.notify_queue) = n and public.notify_enqueue_pop(id1) = 0 and public.notify_enqueue_pop(id2) = 0 and public.notify_enqueue_due() = 0,
                     'a host Pop and a doors-open Pop queue no reminders');
  -- An event that has been cancelled sends no reminders.
  e3 := pg_temp.ev(h, 'Cancelled night', now() + interval '1 hour' - interval '1 minute', 'cancelled');
  perform pg_temp.reg(e3, gA, 'going');
  insert into public.ev_pops (event_id, author_id, body, audience, status, auto, send_at) values (e3, h, 'soon', 'going', 'scheduled', 'hour_before', now()) returning id into id1;
  update public.ev_pops set status = 'sent', sent_at = now() where id = id1;
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where event_id = e3), 'a cancelled event queues no reminders');

  -- ------------------------------------------------------------ the claim ---
  select count(*) into n from public.notify_queue;
  perform pg_temp.ok(n = 10, 'ten rows are waiting (7 for the day before, 3 for the hour before)');
  perform pg_temp.ok(public.notify_has_due(), 'something is due');
  r := public.notify_claim_due(3, array['log']);
  perform pg_temp.ok(jsonb_array_length(r) = 3 and (select bool_and(x ->> 'tries' = '1') from jsonb_array_elements(r) x), 'claim: the limit is kept, and the first claim is try 1');
  rows1 := r;
  r := public.notify_claim_due(500, array['log']);
  rows2 := r;
  perform pg_temp.ok(jsonb_array_length(rows2) = 7, 'claim: the rest are handed out next');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(rows1) ja join jsonb_array_elements(rows2) jb on ja ->> 'id' = jb ->> 'id'), 'claim: no row is handed out twice');
  perform pg_temp.ok(public.notify_claim_due(500, array['log']) = '[]'::jsonb and not public.notify_has_due(), 'claim: a third claim finds nothing, and nothing is due');
  perform pg_temp.ok((select count(*) from public.notify_queue where status = 'claimed') = 10, 'claim: all ten are marked claimed');
  perform pg_temp.ok((select bool_and((x ->> 'channel' = 'email' and x ->> 'email' is not null and x ->> 'whatsapp_number' is null)
                                      or (x ->> 'channel' = 'whatsapp' and x ->> 'whatsapp_number' ~ '^\+' and x ->> 'email' is null))
                        from (select jsonb_array_elements(rows1 || rows2) x) q),
                     'claim: an email row carries the address, a WhatsApp row the number');
  perform pg_temp.ok(position('skip locked' in pg_get_functiondef('public.notify_claim_due(integer,text[],timestamptz)'::regprocedure)) > 0,
                     'claim: two runs at once cannot take the same row (for update skip locked is in the function)');
  -- A run that died: its rows come back after 10 minutes, as try 2.
  r := public.notify_claim_due(500, array['log'], now() + interval '11 minutes');
  perform pg_temp.ok(jsonb_array_length(r) = 10 and (select bool_and(x ->> 'tries' = '2') from jsonb_array_elements(r) x), 'claim: rows left claimed for over 10 minutes are handed out again as try 2');

  -- ------------------------------------------------------------ settle ---
  select (x ->> 'id')::uuid into qa from jsonb_array_elements(r) x where x ->> 'channel' = 'email' limit 1;
  select (x ->> 'id')::uuid into qb from jsonb_array_elements(r) x where x ->> 'channel' = 'email' and (x ->> 'id')::uuid <> qa limit 1;
  select (x ->> 'id')::uuid into qc from jsonb_array_elements(r) x where x ->> 'channel' = 'whatsapp' limit 1;
  perform pg_temp.ok(public.notify_complete(qa, 'sent', '[{"channel":"email","provider":"brevo","status":"failed","error":"timeout"},{"channel":"email","provider":"mailjet","status":"sent","message_id":"mj_1","cost_usd":0}]'::jsonb),
                     'settle: a failed provider and then a good one are both logged');
  perform pg_temp.ok((select status from public.notify_queue where id = qa) = 'sent' and (select count(*) from public.notify_sends where queue_id = qa) = 2
                     and exists (select 1 from public.notify_sends where queue_id = qa and provider = 'mailjet' and status = 'sent' and provider_message_id = 'mj_1')
                     and exists (select 1 from public.notify_sends where queue_id = qa and provider = 'brevo' and status = 'failed' and error = 'timeout'), 'settle: the row is sent and one log row per attempt');
  perform pg_temp.ok(not public.notify_complete(qa, 'sent', '[{"channel":"email","provider":"log","status":"sent"}]'::jsonb) and (select count(*) from public.notify_sends where queue_id = qa) = 2,
                     'settle: settling a row twice changes nothing');
  perform pg_temp.ok(not public.notify_complete(qb, 'bogus') and not public.notify_complete(qb, 'sent', '{"a":1}'::jsonb), 'settle: a bad final status or a bad attempts list is refused');
  t1 := public.notify_complete(qb, 'queued', '[{"channel":"email","provider":"router","status":"skipped","error":"every provider is at its daily cap"}]'::jsonb, now() + interval '15 minutes', true);
  perform pg_temp.ok(t1
                     and (select status from public.notify_queue where id = qb) = 'queued' and (select tries from public.notify_queue where id = qb) = 1
                     and (select due_at from public.notify_queue where id = qb) = now() + interval '15 minutes', 'settle: a row put back for later gets its try back when it only waited for room');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.notify_claim_due(500, array['log'], now() + interval '5 minutes')) x where x ->> 'id' = qb::text), 'a row put back is not due until its time');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(public.notify_claim_due(500, array['log'], now() + interval '16 minutes')) x where x ->> 'id' = qb::text), 'and is handed out when it is');
  t1 := public.notify_complete(qc, 'skipped', '[{"channel":"whatsapp","provider":"none","status":"skipped","error":"not built yet"}]'::jsonb);
  perform pg_temp.ok(t1
                     and (select status from public.notify_queue where id = qc) = 'skipped', 'settle: a WhatsApp row can be skipped with a reason');

  -- ------------------------------------------------------------ the daily cap ---
  insert into public.notify_caps (provider, kind, daily_cap) values ('cap', 'guest', 3), ('cap', 'code', 1), ('cs', 'guest', 10);
  t1 := public.notify_take_cap('cap', 'guest'); t2 := public.notify_take_cap('cap', 'guest'); t3 := public.notify_take_cap('cap', 'guest');
  perform pg_temp.ok(t1 and t2 and t3, 'cap: three takes of a cap of three');
  perform pg_temp.ok(not public.notify_take_cap('cap', 'guest'), 'cap: the fourth is refused, the cap has run out');
  t1 := public.notify_take_cap('cap', 'code'); t2 := public.notify_take_cap('cap', 'code');
  perform pg_temp.ok(t1 and not t2, 'cap: codes are counted apart from guest mail');
  perform public.notify_give_cap('cap', 'guest');
  t1 := public.notify_take_cap('cap', 'guest'); t2 := public.notify_take_cap('cap', 'guest');
  perform pg_temp.ok(t1 and not t2, 'cap: a unit handed back can be taken again, once');
  perform pg_temp.ok(not public.notify_take_cap('nobody', 'guest') and not public.notify_take_cap('cap', 'guest', 0), 'cap: a provider with no cap row, and a take of 0, are refused');
  t1 := public.notify_take_cap('cs', 'guest', 8); t2 := public.notify_take_cap('cs', 'guest', 3); t3 := public.notify_take_cap('cs', 'guest', 2);
  perform pg_temp.ok(t1 and not t2 and t3, 'cap: a take of several is all or nothing');
  perform pg_temp.ok(public.notify_take_cap('log', 'guest', 50000), 'cap: the log provider is effectively unlimited');
  perform pg_temp.ok((select (x ->> 'percent')::numeric from jsonb_array_elements(public.notify_cap_status()) x where x ->> 'provider' = 'cs' and x ->> 'kind' = 'guest') = 100.0
                     and (select (x ->> 'used')::int from jsonb_array_elements(public.notify_cap_status()) x where x ->> 'provider' = 'cap' and x ->> 'kind' = 'guest') = 3, 'cap: the status shows what each cap has used');
  -- The day is the Lagos day: 23:30 and 00:30 Lagos time are different days, 23:30 and 23:59 are the same.
  insert into public.notify_caps (provider, kind, daily_cap) values ('day', 'guest', 2);
  t1 := public.notify_take_cap('day', 'guest', 2, '2026-11-02 23:30'::timestamp at time zone 'Africa/Lagos');
  t2 := public.notify_take_cap('day', 'guest', 1, '2026-11-02 23:59'::timestamp at time zone 'Africa/Lagos');
  t3 := public.notify_take_cap('day', 'guest', 1, '2026-11-03 00:30'::timestamp at time zone 'Africa/Lagos');
  perform pg_temp.ok(t1 and not t2 and t3, 'cap: the day is counted in Africa/Lagos, and a new Lagos day starts again at 0');
  delete from public.notify_caps where provider in ('cap', 'cs', 'day');
  delete from public.notify_cap_use where provider in ('cap', 'cs', 'day');

  -- ------------------------------------------------------------ priority dropping ---
  delete from public.notify_queue; delete from public.notify_sends;
  insert into public.notify_caps (provider, kind, daily_cap) values ('tst', 'guest', 10);
  for n in 1..6 loop perform public.notify_take_cap('tst', 'guest'); end loop;   -- 6 of 10 used: P2 may go to 9, P3 to 8, P4 to 7, P5 to 5
  qa := pg_temp.newuser('Ntf Prio');
  perform public.notify_enqueue(qa, 'thanks', null, '{}', 1, null, 'g-p1');
  perform public.notify_enqueue(qa, 'thanks', null, '{}', 2, null, 'g-p2');
  perform public.notify_enqueue(qa, 'thanks', null, '{}', 3, null, 'g-p3', 'email', 'guest', now() + interval '1 day');
  perform public.notify_enqueue(qa, 'thanks', null, '{}', 4, null, 'g-p4');
  perform public.notify_enqueue(qa, 'thanks', null, '{}', 5, null, 'g-p5a');
  perform public.notify_enqueue(qa, 'thanks', null, '{}', 5, null, 'g-p5b', 'email', 'guest', now() + interval '1 day');
  r := public.notify_claim_due(500, array['tst']);
  perform pg_temp.ok(jsonb_array_length(r) = 2 and (select array_agg((x ->> 'priority')::int order by (x ->> 'priority')::int) from jsonb_array_elements(r) x) = array[1, 2],
                     'priority: with 6 of 10 used, priority 1 and 2 are handed out and 3, 4 and 5 are not');
  nextday := (((now() at time zone 'Africa/Lagos')::date + 1)::timestamp + interval '8 hours') at time zone 'Africa/Lagos';
  perform pg_temp.ok((select status from public.notify_queue where dedupe_key = 'g-p3') = 'dropped' and (select status from public.notify_queue where dedupe_key = 'g-p5b') = 'dropped',
                     'priority: a row that goes stale (it has an expires_at) is dropped');
  perform pg_temp.ok((select status from public.notify_queue where dedupe_key = 'g-p4') = 'queued' and (select due_at from public.notify_queue where dedupe_key = 'g-p4') = nextday
                     and (select status from public.notify_queue where dedupe_key = 'g-p5a') = 'queued' and (select due_at from public.notify_queue where dedupe_key = 'g-p5a') = nextday,
                     'priority: an open ended row is moved to 08:00 Lagos the next day');
  perform pg_temp.ok((select count(*) from public.notify_sends where provider = 'policy' and error like 'dropped: allowance low%') = 2
                     and (select count(*) from public.notify_sends where provider = 'policy' and error like 'moved to the next day: allowance low%') = 2,
                     'priority: every drop and every move leaves a note in the send log');
  -- The allowance is full: priority 1 still goes, the rest do not.
  for n in 1..4 loop perform public.notify_take_cap('tst', 'guest'); end loop;
  perform public.notify_enqueue(qa, 'thanks', null, '{}', 1, null, 'g-q1');
  perform public.notify_enqueue(qa, 'thanks', null, '{}', 2, null, 'g-q2', 'email', 'guest', now() + interval '1 day');
  r := public.notify_claim_due(500, array['tst']);
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'dedupe_key' = 'g-q1' and (select status from public.notify_queue where dedupe_key = 'g-q2') = 'dropped',
                     'priority: with the day full, priority 1 always goes and priority 2 does not');
  -- Next day the allowance is new: the moved rows go. (The rows handed out above are settled first, or they would be handed out again as stale.)
  update public.notify_queue set status = 'sent' where status = 'claimed';
  r := public.notify_claim_due(500, array['tst'], nextday + interval '1 minute');
  perform pg_temp.ok(jsonb_array_length(r) = 2 and (select bool_and(x ->> 'dedupe_key' in ('g-p4', 'g-p5a')) from jsonb_array_elements(r) x), 'priority: the moved rows are handed out the next day');
  -- No providers at all: nothing but priority 1 is handed out.
  delete from public.notify_queue; delete from public.notify_sends;
  perform public.notify_enqueue(qa, 'thanks', null, '{}', 1, null, 'n-1');
  perform public.notify_enqueue(qa, 'thanks', null, '{}', 3, null, 'n-3');
  r := public.notify_claim_due(500, array['no-such-provider']);
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'dedupe_key' = 'n-1', 'priority: with no allowance to count, only priority 1 is handed out');
  delete from public.notify_caps where provider = 'tst'; delete from public.notify_cap_use where provider = 'tst';

  -- ------------------------------------------------------------ a buyer already at the door, and a refund after the row was queued ---
  delete from public.notify_queue; delete from public.notify_sends;
  e5 := pg_temp.ev(h, 'Door night', now() + interval '24 hours' - interval '1 minute');
  -- gP bought 3 seats and one has been scanned: the registration stays 'going' (ev_scan checks it in only when the last seat is used).
  insert into public.ev_registrations (event_id, user_id, status, name, quantity, created_at) values (e5, gP, 'going', 'x', 3, now() - interval '3 days');
  perform pg_temp.tkt(e5, gP, 1, 'used'); perform pg_temp.tkt(e5, gP, 2, 'valid'); perform pg_temp.tkt(e5, gP, 3, 'valid');
  perform pg_temp.prefs(gP, true, '+2348066666666'); perform pg_temp.paid(e5, gP);
  perform pg_temp.reg(e5, gQ, 'going'); perform pg_temp.tkt(e5, gQ, 1, 'valid'); perform pg_temp.paid(e5, gQ); perform pg_temp.prefs(gQ, true, '+2348077777777');
  perform pg_temp.reg(e5, gR, 'going'); perform pg_temp.paid(e5, gR); perform pg_temp.prefs(gR, true, '+2348088888888');
  perform pg_temp.reg(e5, gS, 'going'); perform pg_temp.paid(e5, gS); perform pg_temp.prefs(gS, true, '+2348099999999');
  perform pg_temp.dispatch();
  perform pg_temp.others(array[e5]);
  perform pg_temp.ok((select r.status from public.ev_registrations r where r.event_id = e5 and r.user_id = gP) = 'going',
                     'a buyer with one of three seats scanned is still going');
  perform pg_temp.ok(not exists (select 1 from public.notify_queue where event_id = e5 and user_id = gP), 'enqueue: nothing, email or WhatsApp, for someone with a used ticket');
  perform pg_temp.ok(pg_temp.q(e5, gQ, 'reminder_day', 'email') = 1 and pg_temp.q(e5, gQ, 'reminder_day', 'whatsapp') = 1
                     and pg_temp.q(e5, gR, 'reminder_day', 'email') = 1 and pg_temp.q(e5, gR, 'reminder_day', 'whatsapp') = 1
                     and pg_temp.q(e5, gS, 'reminder_day', 'email') = 1 and pg_temp.q(e5, gS, 'reminder_day', 'whatsapp') = 1,
                     'the others (valid ticket, paid) get an email and a WhatsApp row');
  -- Between queueing and sending: gQ's ticket is scanned, gR's order is refunded.
  update public.ev_tickets set status = 'used', used_at = now() where event_id = e5 and owner_id = gQ;
  update public.ev_orders set status = 'refunded' where event_id = e5 and buyer_id = gR;
  r := public.notify_claim_due(500, array['log']);
  perform pg_temp.ok(jsonb_array_length(r) = 3 and (select array_agg(x ->> 'user_id' || ':' || (x ->> 'channel') order by x ->> 'user_id', x ->> 'channel') from jsonb_array_elements(r) x)
                     = (select array_agg(u || ':' || ch order by u, ch) from (values (gR::text, 'email'), (gS::text, 'email'), (gS::text, 'whatsapp')) v(u, ch)),
                     'claim: only gR email, gS email and gS WhatsApp are handed out');
  perform pg_temp.ok(pg_temp.note((select id from public.notify_queue where user_id = gQ and channel = 'email')) = 'skipped: already checked in'
                     and pg_temp.note((select id from public.notify_queue where user_id = gQ and channel = 'whatsapp')) = 'skipped: already checked in',
                     'claim: someone whose ticket was scanned since is skipped, on both channels');
  perform pg_temp.ok(pg_temp.note((select id from public.notify_queue where user_id = gR and channel = 'whatsapp')) = 'skipped: no paid order'
                     and (select status from public.notify_queue where user_id = gR and channel = 'whatsapp') = 'skipped',
                     'claim: a guest refunded since costs no WhatsApp message');
  perform pg_temp.ok((select status from public.notify_queue where user_id = gR and channel = 'email') = 'claimed', 'claim: but the refunded guest still gets the email');

  -- ------------------------------------------------------------ the skip rules, asked again at claim time ---
  delete from public.notify_queue; delete from public.notify_sends;
  delete from public.notify_prefs; delete from public.notify_suppressed;
  e4 := pg_temp.ev(h, 'Skip night', now() + interval '2 days');
  e3 := pg_temp.ev(h, 'Cancelled later night', now() + interval '2 days');
  perform pg_temp.reg(e4, gA, 'going'); perform pg_temp.reg(e4, gB, 'going'); perform pg_temp.reg(e4, gC, 'going'); perform pg_temp.reg(e4, gD, 'going');
  perform pg_temp.reg(e4, gE, 'going'); perform pg_temp.reg(e4, gF, 'going'); perform pg_temp.reg(e4, gG, 'going'); perform pg_temp.reg(e4, gL, 'going');
  perform pg_temp.reg(e3, gH, 'going');
  perform public.notify_enqueue(gA, 'reminder_day', e4, '{}', 2, null, null, 'email', 'guest', now() + interval '1 day');   -- stays valid
  perform public.notify_enqueue(gB, 'reminder_day', e4, '{}', 2, null, null, 'email', 'guest', now() + interval '1 day');   -- cancels
  perform public.notify_enqueue(gC, 'reminder_day', e4, '{}', 2, null, null, 'email', 'guest', now() + interval '1 day');   -- bounces
  perform public.notify_enqueue(gD, 'reminder_day', e4, '{}', 2, null, null, 'email', 'guest', now() + interval '1 day');   -- switches reminders off
  perform public.notify_enqueue(gE, 'reminder_day', e4, '{}', 2, null, null, 'email', 'guest', now() - interval '1 minute'); -- too late
  perform public.notify_enqueue(gF, 'reminder_day', e4, '{}', 2, null, null, 'whatsapp', 'guest', now() + interval '1 day'); -- no WhatsApp
  perform public.notify_enqueue(gH, 'reminder_day', e3, '{}', 2, null, null, 'email', 'guest', now() + interval '1 day');   -- event cancelled
  perform public.notify_enqueue(gG, 'reminder_day', e4, '{}', 2, null, null, 'email', 'guest', now() + interval '1 day');   -- tried too often
  perform public.notify_enqueue(gL, 'reminder_day', e4, '{}', 2, null, null, 'email', 'guest', now() + interval '1 day');   -- no address
  update public.ev_registrations set status = 'cancelled' where event_id = e4 and user_id = gB;
  insert into public.notify_suppressed (address, reason) values (pg_temp.mail(gC), 'complaint');
  perform pg_temp.prefs(gD, false, null, false);
  update public.events set status = 'cancelled' where id = e3;
  update public.notify_queue set tries = 5 where user_id = gG;
  r := public.notify_claim_due(500, array['log']);
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'user_id' = gA::text and r -> 0 ->> 'email' = pg_temp.mail(gA), 'claim: of nine rows only the one still wanted is handed out');
  perform pg_temp.ok(pg_temp.note((select id from public.notify_queue where user_id = gB)) = 'skipped: no longer going' and (select status from public.notify_queue where user_id = gB) = 'skipped',
                     'claim: someone who cancelled since is skipped, with a note');
  perform pg_temp.ok(pg_temp.note((select id from public.notify_queue where user_id = gC)) = 'skipped: address suppressed', 'claim: an address that bounced since is skipped');
  perform pg_temp.ok(pg_temp.note((select id from public.notify_queue where user_id = gD)) = 'skipped: email reminders are off', 'claim: reminders switched off since are skipped');
  perform pg_temp.ok((select status from public.notify_queue where user_id = gE) = 'dropped' and pg_temp.note((select id from public.notify_queue where user_id = gE)) = 'dropped: too late to be useful', 'claim: a stale row is dropped');
  perform pg_temp.ok(pg_temp.note((select id from public.notify_queue where user_id = gF)) = 'skipped: WhatsApp is off', 'claim: a WhatsApp row for a person with WhatsApp off is skipped');
  perform pg_temp.ok(pg_temp.note((select id from public.notify_queue where user_id = gH)) = 'skipped: no longer going', 'claim: a reminder for a cancelled event is skipped');
  perform pg_temp.ok((select status from public.notify_queue where user_id = gG) = 'failed' and pg_temp.note((select id from public.notify_queue where user_id = gG)) = 'gave up after 5 tries', 'claim: a row that has failed 5 times is given up on');
  perform pg_temp.ok(pg_temp.note((select id from public.notify_queue where user_id = gL)) = 'skipped: no email address', 'claim: a guest with no address is skipped');

  -- ------------------------------------------------------------ the timer ---
  delete from public.notify_queue; delete from public.notify_sends;
  -- The Pops sent above have had their rows deleted: keep them out of the safety net.
  update public.ev_pops set sent_at = sent_at - interval '2 days' where auto in ('day_before', 'hour_before') and sent_at is not null;
  perform pg_temp.ok(public.notify_tick() = false, 'timer: nothing due, nothing sent');
  perform public.notify_enqueue(gA, 'ticket', e4);
  perform pg_temp.ok(public.notify_has_due(), 'timer: a due row is seen');
  perform public.set_notify_config('run_url', null); perform public.set_notify_config('run_secret', null);
  perform pg_temp.ok(public.notify_tick() = false, 'timer: without the run address and secret it makes no call');
  perform public.set_notify_config('run_url', 'https://example.invalid/api/notify/run'); perform public.set_notify_config('run_secret', 'test-secret-not-real');
  perform pg_temp.ok(public.notify_tick() = (to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null), 'timer: with something due and everything set it makes the call (when pg_net is installed)');
  delete from public.notify_queue;
  perform pg_temp.ok(public.notify_tick() = false, 'timer: and with nothing due again it does not');
  perform public.set_notify_config('run_url', null); perform public.set_notify_config('run_secret', null);

  -- ------------------------------------------------------------ access ---
  for f in select p.oid, p.oid::regprocedure as sig, p.proname as name
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and p.proname in ('set_notify_config', '_notify_cfg', '_notify_flag', 'notify_set_flag', '_notify_day', '_notify_priority_limit', '_notify_allowance', '_notify_note',
                                '_notify_close', 'notify_take_cap', 'notify_give_cap', 'notify_cap_status', 'notify_enqueue', 'notify_enqueue_pop', '_notify_pop_trigger',
                                'notify_enqueue_due', 'notify_claim_due', 'notify_complete', 'notify_has_due', 'notify_tick')
  loop
    perform pg_temp.ok(not has_function_privilege('anon', f.oid, 'execute') and not has_function_privilege('authenticated', f.oid, 'execute'), f.sig || ': anon and authenticated cannot call');
    perform pg_temp.ok(f.name ~ '^_' or has_function_privilege('service_role', f.oid, 'execute'), f.sig || ': the service role can call');
  end loop;
  begin
    perform pg_temp.actor(stranger);
    perform public.notify_claim_due();
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a signed-in person must not claim rows');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a signed-in person cannot claim rows');
  end;

  raise notice 'ALL NOTIFY TESTS PASSED';
end $$;
rollback;
