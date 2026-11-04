-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Notifications step 5 (supabase/events_r1_notify_whatsapp.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, events_r1_events.sql, events_r1_registrations.sql, events_r1_tickets.sql, events_r1_pops.sql, events_r1_pay.sql,
-- events_r1_notify.sql, events_r1_notify_emails.sql, events_r1_notify_prefs.sql and events_r1_notify_whatsapp.sql loaded (the notify set and this file
-- loaded twice is a good habit: it must be safe to run again). Ends with ALL NOTIFY WHATSAPP TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_notify_whatsapp_test.sql
--
-- What it covers: who can call what; Nigerian number forms; the checkout switch (signed in only); STOP for every person with a number and at once,
-- including queued and in-flight rows; START only for a person who agreed before; TICKET revealing nothing about anyone else; a replayed message
-- doing nothing twice; the reply limits and loops; the paid-guest rule and the channel gate at claim; the monthly budget (spent, unpriced, in flight,
-- last month, the room, email unaffected); Meta's status events with cost and replays; the recheck before a send.
begin;
select public.ev_set_setting('events_r1', 'on');
-- Step 2's triggers would queue their own mails for the registrations, orders and events made below; this file queues exactly what it needs.
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
          case when guest then null else 'wa-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
create function pg_temp.ev(host uuid, ttl text, starts timestamptz, st text default 'live') returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id, kind, created_at)
  values (ttl, 'Somewhere', starts, st, host, 'in_person', now() - interval '5 days') returning id;
$$;
create function pg_temp.reg(ev uuid, u uuid, st text default 'going') returns void language sql as $$
  insert into public.ev_registrations (event_id, user_id, status, name, created_at) values (ev, u, st, 'x', now() - interval '3 days');
$$;
create function pg_temp.paid(ev uuid, u uuid, st text default 'paid') returns void language sql as $$
  insert into public.ev_orders (buyer_id, event_id, quantity, unit_price_kobo, gross_kobo, platform_fee_kobo, host_account, bachs_reference, expires_at, status, paid_at)
  values (u, ev, 1, 500000, 500000, 22500, 'acct_TESTTESTTEST', 'ord_wa_' || gen_random_uuid(), now() + interval '15 minutes', st, now());
$$;
-- A person with a WhatsApp number. agreed: the record of their agreement exists. on: it is switched on (only possible with an agreement).
create function pg_temp.num(u uuid, n text, on_ boolean default true, agreed boolean default true) returns void language sql as $$
  insert into public.notify_prefs (user_id, whatsapp_on, whatsapp_number, agreed_at, agreed_how)
  values (u, on_, n, case when agreed then now() - interval '1 day' end, case when agreed then 'checkout' end)
  on conflict (user_id) do update set whatsapp_on = excluded.whatsapp_on, whatsapp_number = excluded.whatsapp_number, agreed_at = excluded.agreed_at, agreed_how = excluded.agreed_how;
$$;
create function pg_temp.tkt(ev uuid, u uuid, seatno integer, st text) returns void language sql as $$
  insert into public.ev_tickets (event_id, registration_id, owner_id, seat, code, status, used_at)
  select ev, r.id, u, seatno, translate(upper(substr(md5(gen_random_uuid()::text), 1, 8)), '01', 'XY'), st, case when st = 'used' then now() end
    from public.ev_registrations r where r.event_id = ev and r.user_id = u;
$$;
-- A WhatsApp reminder row, the way the Pop hook makes it.
create function pg_temp.wa(u uuid, ev uuid, kind text default 'reminder_day', key text default null) returns uuid language sql as $$
  select public.notify_enqueue(u, kind, ev, jsonb_build_object('event_id', ev, 'title', 'Night', 'starts_at', now() + interval '1 day', 'timezone', 'Africa/Lagos', 'venue_name', 'Somewhere'),
                               2, null, coalesce(key, 'wa-' || gen_random_uuid()), 'whatsapp', 'guest', now() + interval '2 days');
$$;
create function pg_temp.note(qid uuid) returns text language sql as $$ select string_agg(error, ' | ' order by created_at) from public.notify_sends where queue_id = qid; $$;
create function pg_temp.status(qid uuid) returns text language sql as $$ select status from public.notify_queue where id = qid; $$;
create function pg_temp.handed(r jsonb, qid uuid) returns boolean language sql as $$ select exists (select 1 from jsonb_array_elements(r) x where (x ->> 'id')::uuid = qid); $$;
create function pg_temp.sent(mid text, qid uuid default null, ago interval default '0') returns void language sql as $$
  insert into public.notify_sends (queue_id, channel, provider, status, provider_message_id, created_at) values (qid, 'whatsapp', 'whatsapp', 'sent', mid, clock_timestamp() - ago);
$$;
create function pg_temp.on_(n text) returns boolean language sql as $$ select bool_and(whatsapp_on) from public.notify_prefs where whatsapp_number = n; $$;
create function pg_temp.bot(msg text, n text, kw text, at timestamptz default now()) returns jsonb language sql as $$ select public.notify_wa_inbound(msg, n, kw, at); $$;

do $$
declare
  h uuid := pg_temp.newuser('Wa Host');
  a uuid := pg_temp.newuser('Wa Ada Obi'); b uuid := pg_temp.newuser('Wa Bayo'); c uuid := pg_temp.newuser('Wa Chidi'); d uuid := pg_temp.newuser('Wa Dayo');
  s1 uuid := pg_temp.newuser('Wa Share One'); s2 uuid := pg_temp.newuser('Wa Share Two'); g uuid := pg_temp.newuser('Wa guest session', true);
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid;
  r jsonb; r2 jsonb; n int; f record; q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; q6 uuid; t0 timestamptz := now();
  nums text[]; want text[]; i int; replies int; bud jsonb; ok_ boolean;
  NA text := '+2348011111111'; NB text := '+2348022222222'; NC text := '+2348033333333'; NSH text := '+2348044444444'; NX text := '+2347055555555';
begin
  -- ------------------------------------------------------------ who can call what, and the closed tables ---
  for f in select p.oid, p.oid::regprocedure as sig, p.proname as name
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and p.proname in ('_notify_wa_price', '_notify_wa_hash', '_notify_wa_mask', 'notify_wa_normalise', '_notify_wa_users', 'notify_wa_find', 'notify_wa_stop', 'notify_wa_start',
                                '_notify_wa_next_ticket', 'notify_wa_inbound', 'notify_wa_record_reply', '_notify_wa_month_start', 'notify_wa_budget', '_notify_wa_room',
                                'notify_wa_recheck', 'notify_wa_apply_statuses', '_notify_wa_check')
  loop
    perform pg_temp.ok(not has_function_privilege('anon', f.oid, 'execute') and not has_function_privilege('authenticated', f.oid, 'execute'), f.sig || ': anon and authenticated cannot call');
    perform pg_temp.ok(f.name ~ '^_' or has_function_privilege('service_role', f.oid, 'execute'), f.sig || ': the service role can call');
  end loop;
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.notify_set_my_whatsapp(text, boolean, text)', 'execute') and has_function_privilege('authenticated', 'public.notify_get_my_whatsapp()', 'execute')
                     and not has_function_privilege('anon', 'public.notify_set_my_whatsapp(text, boolean, text)', 'execute') and not has_function_privilege('anon', 'public.notify_get_my_whatsapp()', 'execute'),
                     'the checkout switch is for signed-in roles only');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.notify_wa_inbound', 'select') and not has_table_privilege('anon', 'public.notify_wa_inbound', 'select')
                     and not has_table_privilege('authenticated', 'public.notify_wa_inbound', 'insert'), 'the inbound log is closed to anon and authenticated');
  begin
    perform pg_temp.actor(a);
    perform public.notify_wa_stop(NA);
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a signed-in person must not call STOP for a number');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a signed-in person cannot call the bot functions');
  end;

  -- ------------------------------------------------------------ settings and seeds ---
  perform pg_temp.ok((select value from public.notify_config where key = 'whatsapp_monthly_budget_usd') = '50' and (select value from public.notify_config where key = 'whatsapp_reply_daily_max') = '6',
                     'the budget is seeded at 50 and the daily reply ceiling at 6');
  perform pg_temp.ok(public._notify_wa_price('utility') = 0.0067 and public._notify_wa_price('marketing') = 0.0516 and public._notify_wa_price('nonsense') = 0.0516, 'the price: utility 0.0067, an unknown category the dearest');
  perform public.notify_set_flag('notify_email', 'on'); perform public.notify_set_flag('notify_whatsapp', 'on');

  -- ------------------------------------------------------------ Nigerian number forms ---
  nums := array['08012345678', '0801 234 5678', '080-1234-5678', '2348012345678', '234 801 234 5678', '+234 801 234 5678', '+2348012345678', '+234 (0) 801 234 5678', '002348012345678', '8012345678',
                '(0801) 234.5678', ' +2348012345678 '];
  perform pg_temp.ok((select bool_and(public.notify_wa_normalise(x) = '+2348012345678') from unnest(nums) x), 'every Nigerian way of writing a number gives +2348012345678');
  perform pg_temp.ok(public.notify_wa_normalise('+14155552671') = '+14155552671' and public.notify_wa_normalise('0044 7911 123456') = '+447911123456', 'a foreign number written with its + (or 00) is kept');
  perform pg_temp.ok((select bool_and(public.notify_wa_normalise(x) is null) from unnest(array['4155552671', '0701234567', '+23480123', '+2346012345678', '+2341234567890', 'abc', '', '   ', '+', '0', '080123456789012345678901234567890', '+0123456789', '080123x5678']) x)
                     and public.notify_wa_normalise(null) is null, 'junk, too short, too long, a bad Nigerian prefix, or a foreign number with no + : null');
  perform pg_temp.ok(public._notify_wa_mask('+2348012345678') = '+234********78' and public._notify_wa_mask('junk') is null and public._notify_wa_mask(null) is null, 'the mask shows the country and the last two digits');

  -- ------------------------------------------------------------ the checkout switch, for a signed-in person ---
  perform pg_temp.actor(a);
  r := public.notify_set_my_whatsapp('0801 111 1111', true, 'checkout');
  perform pg_temp.admin();
  perform pg_temp.ok(r = jsonb_build_object('whatsapp_on', true, 'number', '+234********11'), 'the switch answers on, and the number masked');
  perform pg_temp.ok((select whatsapp_number from public.notify_prefs where user_id = a) = NA and (select whatsapp_on from public.notify_prefs where user_id = a)
                     and (select agreed_how from public.notify_prefs where user_id = a) = 'checkout' and (select agreed_at from public.notify_prefs where user_id = a) > now() - interval '1 minute',
                     'stored in E.164 with when and how they agreed');
  perform pg_temp.actor(a);
  r := public.notify_get_my_whatsapp();
  perform pg_temp.admin();
  perform pg_temp.ok(r ->> 'number' = '+234********11' and (r ->> 'whatsapp_on')::boolean, 'a person reads their own state, masked');
  perform pg_temp.actor(a);
  r := public.notify_set_my_whatsapp(null, false);
  perform pg_temp.admin();
  perform pg_temp.ok(r ->> 'whatsapp_on' = 'false' and (select whatsapp_number from public.notify_prefs where user_id = a) = NA and (select agreed_at from public.notify_prefs where user_id = a) is not null,
                     'off with no number needed: the switch is off, the record of the agreement stays');
  perform pg_temp.actor(a);
  r := public.notify_set_my_whatsapp('+234 802 222 2222', true, 'settings');
  perform pg_temp.admin();
  perform pg_temp.ok((select whatsapp_number from public.notify_prefs where user_id = a) = NB and (select agreed_how from public.notify_prefs where user_id = a) = 'settings'
                     and (select wa_stopped_at from public.notify_prefs where user_id = a) is null, 'a new number replaces the old one and the agreement is the new one');
  begin
    perform pg_temp.actor(a);
    perform public.notify_set_my_whatsapp('not a number', true);
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a bad number must be refused');
  exception when invalid_parameter_value then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a bad number is refused');
  end;
  begin
    perform pg_temp.actor(a);
    perform public.notify_set_my_whatsapp(NA, true, 'whatever');
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'an unknown way of agreeing must be refused');
  exception when invalid_parameter_value then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'an unknown way of agreeing is refused');
  end;
  begin
    perform pg_temp.actor(g);
    perform public.notify_set_my_whatsapp(NA, true);
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a guest session must be refused');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a guest session (no account) cannot switch WhatsApp on');
  end;
  begin
    perform pg_temp.anon();
    perform public.notify_get_my_whatsapp();
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must be refused');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot read or switch');
  end;
  perform pg_temp.ok((select count(*) from public.notify_prefs where user_id <> a) = 0, 'nobody else got a row');
  delete from public.notify_prefs;

  -- ------------------------------------------------------------ find, and a number two people share ---
  perform pg_temp.num(b, NB); perform pg_temp.num(s1, NSH); perform pg_temp.num(s2, NSH); perform pg_temp.num(c, NC, false, true);
  perform pg_temp.ok(public.notify_wa_find('0802 222 2222') = array[b] and public.notify_wa_find(NX) = '{}' and public.notify_wa_find('junk') = '{}', 'find: one person, nobody, and junk');
  perform pg_temp.ok(cardinality(public.notify_wa_find('08044444444')) = 2 and public.notify_wa_find('08044444444') @> array[s1, s2], 'find: two people can share a number');

  -- ------------------------------------------------------------ STOP ---
  n := public.notify_wa_stop('08044444444');
  perform pg_temp.ok(n = 2 and (select not bool_or(whatsapp_on) from public.notify_prefs where whatsapp_number = NSH)
                     and (select bool_and(wa_stopped_at is not null) from public.notify_prefs where whatsapp_number = NSH), 'STOP, in a local form, switches off every person with the number');
  perform pg_temp.ok(pg_temp.on_(NB) is true, 'and nobody else');
  perform pg_temp.ok(public.notify_wa_stop('08044444444') = 0 and public.notify_wa_stop(NX) = 0 and public.notify_wa_stop('junk') = 0 and public.notify_wa_stop(null) = 0, 'STOP again, for a stranger, junk or null: nothing changes');
  perform pg_temp.ok((select count(*) from public.notify_prefs where whatsapp_number = NX) = 0, 'STOP from a stranger writes nothing');
  perform pg_temp.ok((select agreed_at from public.notify_prefs where user_id = s1) is not null and (select agreed_how from public.notify_prefs where user_id = s1) = 'checkout', 'STOP keeps the record of the agreement');

  -- ------------------------------------------------------------ START ---
  n := public.notify_wa_start(NX);
  perform pg_temp.ok(n = 0 and (select count(*) from public.notify_prefs where whatsapp_number = NX) = 0, 'START from a stranger: nothing is created, nothing is switched on');
  perform pg_temp.num(d, '+2348066666666', false, false);
  n := public.notify_wa_start('+2348066666666');
  perform pg_temp.ok(n = 0 and (select whatsapp_on from public.notify_prefs where user_id = d) is false,
                     'START for a number with no agreement behind it (never opted in): stays off');
  n := public.notify_wa_start(NC);
  perform pg_temp.ok(n = 1 and (select whatsapp_on from public.notify_prefs where user_id = c), 'START for a person who agreed before: back on');
  n := public.notify_wa_start('0804 444 4444');
  perform pg_temp.ok(n = 2 and (select bool_and(whatsapp_on and wa_stopped_at is null) from public.notify_prefs where whatsapp_number = NSH), 'START for a shared number: everyone who agreed is back on');
  perform pg_temp.ok(public.notify_wa_start(NSH) = 0, 'START when already on changes nothing');
  delete from public.notify_prefs;

  -- ------------------------------------------------------------ the message from a guest: STOP, replays, START ---
  perform pg_temp.num(a, NA); perform pg_temp.num(b, NB); perform pg_temp.num(c, NC, false, false);
  r := pg_temp.bot('wamid.S1', NA, 'stop', t0);
  perform pg_temp.ok(r ->> 'status' = 'ok' and r ->> 'reply' = 'stop' and pg_temp.on_(NA) is false and pg_temp.on_(NB) is true, 'STOP: off for that number, the confirmation is the reply');
  perform pg_temp.num(a, NA); -- the guest turns it back on at checkout
  r := pg_temp.bot('wamid.S1', NA, 'stop', t0 + interval '2 hours');
  perform pg_temp.ok(r ->> 'status' = 'duplicate' and r ->> 'reply' is null and pg_temp.on_(NA) is true, 'a replayed message does nothing: no second STOP, no second reply');
  r := pg_temp.bot('wamid.S2', NA, 'stop', t0 + interval '3 hours');
  perform pg_temp.ok(r ->> 'status' = 'ok' and pg_temp.on_(NA) is false, 'a new STOP message is acted on');
  r := pg_temp.bot('wamid.T1', NA, 'start', t0 + interval '4 hours');
  perform pg_temp.ok(r ->> 'reply' = 'start' and pg_temp.on_(NA) is true, 'START by a number that agreed before: on again, reply start');
  r := pg_temp.bot('wamid.T2', NX, 'start', t0 + interval '4 hours');
  perform pg_temp.ok(r ->> 'reply' = 'start_no' and (select count(*) from public.notify_prefs where whatsapp_number = NX) = 0, 'START by a stranger: no consent is made up, the reply says to turn it on at checkout');
  r := pg_temp.bot('wamid.T3', '+2348033333333', 'start', t0 + interval '4 hours');
  perform pg_temp.ok(r ->> 'reply' = 'start_no' and pg_temp.on_(NC) is false, 'START for a number stored without any agreement: stays off');
  r := pg_temp.bot('wamid.T4', NB, 'start', t0 + interval '4 hours');
  perform pg_temp.ok(r ->> 'reply' = 'start', 'START when already on: just the confirmation');
  for i in 1..3 loop
    r := pg_temp.bot('wamid.junk' || i, case i when 1 then 'junk' when 2 then null else NA end, case i when 3 then 'dance' else 'help' end, t0);
    perform pg_temp.ok(r ->> 'status' = 'ignored' and r ->> 'reply' is null, 'junk input ' || i || ' is ignored');
  end loop;
  perform pg_temp.ok(public.notify_wa_inbound(null, NA, 'help', t0) ->> 'status' = 'ignored' and public.notify_wa_inbound('', NA, 'help', t0) ->> 'status' = 'ignored', 'no message id: ignored');
  perform pg_temp.ok(not exists (select 1 from public.notify_wa_inbound w where to_jsonb(w)::text like '%80111%' or to_jsonb(w)::text like '%80222%'), 'the inbound log holds a hash of the number, never the number');
  perform pg_temp.ok((select count(*) from public.notify_wa_inbound where msg_id = 'wamid.S1') = 1, 'one log row per message id');
  delete from public.notify_prefs; delete from public.notify_wa_inbound;

  -- ------------------------------------------------------------ reply limits and loops ---
  r := pg_temp.bot('wamid.H1', NX, 'help', t0);
  r2 := pg_temp.bot('wamid.H2', NX, 'other', t0 + interval '10 minutes');
  perform pg_temp.ok(r ->> 'reply' = 'help' and r2 ->> 'reply' is null and r2 ->> 'why' = 'hourly limit', 'a second help within the hour gets no reply');
  r := pg_temp.bot('wamid.H3', NX, 'start', t0 + interval '20 minutes');
  perform pg_temp.ok(r ->> 'reply' is null, 'start_no counts as help text: still the same hour, no reply');
  r := pg_temp.bot('wamid.H4', NX, 'ticket', t0 + interval '30 minutes');
  perform pg_temp.ok(r ->> 'reply' is null, 'a TICKET from an unknown number is answered with the help text, so it is limited the same way');
  r := pg_temp.bot('wamid.H5', NX, 'help', t0 + interval '61 minutes');
  perform pg_temp.ok(r ->> 'reply' = 'help', 'after the hour the help text goes again');
  r := pg_temp.bot('wamid.H6', NSH, 'help', t0);
  perform pg_temp.ok(r ->> 'reply' = 'help', 'the limit is per number: another number still gets its reply');
  -- a loop: another bot answers every reply, 40 messages in an hour
  replies := 0;
  for i in 1..40 loop
    r := pg_temp.bot('wamid.LOOP' || i, NB, 'other', t0 + (i * interval '1 minute'));
    if r ->> 'reply' is not null then replies := replies + 1; end if;
  end loop;
  perform pg_temp.ok(replies = 1, 'a bot that answers every reply gets one help reply an hour: ' || replies || ' reply in 40 messages');
  -- STOP once an hour
  r := pg_temp.bot('wamid.ST1', NC, 'stop', t0);
  r2 := pg_temp.bot('wamid.ST2', NC, 'stop', t0 + interval '5 minutes');
  perform pg_temp.ok(r ->> 'reply' = 'stop' and r2 ->> 'reply' is null, 'the STOP confirmation is sent once, not for every STOP');
  perform pg_temp.ok((select count(*) from public.notify_wa_inbound where msg_id in ('wamid.ST1', 'wamid.ST2')) = 2, 'both messages are logged');
  -- the daily ceiling, using a reply kind with no hourly limit (START by someone on)
  perform pg_temp.num(a, NA);
  perform public.set_notify_config('whatsapp_reply_daily_max', '3');
  replies := 0;
  for i in 1..6 loop
    r := pg_temp.bot('wamid.DAY' || i, NA, 'start', t0 + (i * interval '2 hours'));
    if r ->> 'reply' is not null then replies := replies + 1; end if;
  end loop;
  perform pg_temp.ok(replies = 3, 'at most whatsapp_reply_daily_max replies to a number in 24 hours (3 of 6 messages in 12 hours)');
  r := pg_temp.bot('wamid.DAY7', NA, 'start', t0 + interval '30 hours');
  perform pg_temp.ok(r ->> 'reply' = 'start', 'a day later the ceiling has room again');
  perform public.set_notify_config('whatsapp_reply_daily_max', '6');
  delete from public.notify_prefs; delete from public.notify_wa_inbound;

  -- ------------------------------------------------------------ TICKET ---
  e1 := pg_temp.ev(h, 'Wa Late Night', now() + interval '10 days');
  e2 := pg_temp.ev(h, 'Wa Soon Night', now() + interval '2 days');
  e3 := pg_temp.ev(h, 'Wa Over Night', now() - interval '2 days');
  e4 := pg_temp.ev(h, 'Wa Cancelled Night', now() + interval '3 days', 'cancelled');
  e5 := pg_temp.ev(h, 'Wa Their Night', now() + interval '1 day');
  perform pg_temp.num(a, NA); perform pg_temp.num(b, NB); perform pg_temp.num(c, NC); perform pg_temp.num(s1, NSH); perform pg_temp.num(s2, NSH); perform pg_temp.num(d, '+2348066666666');
  perform pg_temp.reg(e1, a); perform pg_temp.tkt(e1, a, 1, 'valid');
  perform pg_temp.reg(e2, a); perform pg_temp.tkt(e2, a, 1, 'valid');
  perform pg_temp.reg(e3, a); perform pg_temp.tkt(e3, a, 1, 'valid');
  perform pg_temp.reg(e5, c); perform pg_temp.tkt(e5, c, 1, 'valid');
  perform pg_temp.reg(e2, b); perform pg_temp.tkt(e2, b, 1, 'used');
  perform pg_temp.reg(e5, s1); perform pg_temp.tkt(e5, s1, 1, 'valid');
  r := pg_temp.bot('wamid.K1', NA, 'ticket', t0);
  perform pg_temp.ok(r ->> 'reply' = 'ticket' and r #>> '{ticket,title}' = 'Wa Soon Night' and (r #>> '{ticket,event_id}')::uuid = e2, 'TICKET: the next upcoming ticket (not the later one, not the one that is over)');
  perform pg_temp.ok(r::text not like '%' || a::text || '%' and r::text not like '%Ada%' and r::text not like '%@evtest%' and r::text not like '%80111%', 'and nothing about the person in the answer');
  r := pg_temp.bot('wamid.K2', NB, 'ticket', t0);
  perform pg_temp.ok(r ->> 'reply' = 'ticket_none' and r ->> 'ticket' is null, 'TICKET with only a used ticket: no upcoming ticket');
  r := pg_temp.bot('wamid.K3', '+2348066666666', 'ticket', t0);
  perform pg_temp.ok(r ->> 'reply' = 'ticket_none', 'TICKET for a known number with no ticket at all');
  r := pg_temp.bot('wamid.K4', NX, 'ticket', t0);
  perform pg_temp.ok(r ->> 'reply' = 'help' and r ->> 'ticket' is null and r::text not like '%Wa %', 'TICKET from a number that matches nobody: the help text, no details');
  r := pg_temp.bot('wamid.K5', NSH, 'ticket', t0);
  perform pg_temp.ok(r ->> 'reply' = 'help' and r ->> 'ticket' is null and r::text not like '%Their Night%', 'TICKET from a number two people share: the help text, nobody''s ticket');
  r := pg_temp.bot('wamid.K6', NC, 'ticket', t0);
  perform pg_temp.ok(r #>> '{ticket,title}' = 'Wa Their Night', 'each person gets their own ticket');
  update public.events set status = 'cancelled' where id = e2;
  r := pg_temp.bot('wamid.K7', NA, 'ticket', t0 + interval '2 hours');
  perform pg_temp.ok(r #>> '{ticket,title}' = 'Wa Late Night', 'a cancelled event is skipped: the next one is the later night');
  delete from public.notify_prefs; delete from public.notify_wa_inbound;

  -- ------------------------------------------------------------ the claim: the paid-guest rule, STOP at once, and the channel gate ---
  e1 := pg_temp.ev(h, 'Wa Claim Night', now() + interval '1 day');
  perform pg_temp.num(a, NA); perform pg_temp.num(b, NB); perform pg_temp.num(c, NC); perform pg_temp.num(d, '+2348066666666'); perform pg_temp.num(s1, NSH, false, true);
  perform pg_temp.reg(e1, a); perform pg_temp.paid(e1, a);
  perform pg_temp.reg(e1, b); -- no order: a free ticket
  perform pg_temp.reg(e1, c); perform pg_temp.paid(e1, c, 'refunded');
  perform pg_temp.reg(e1, d); perform pg_temp.paid(e1, d, 'refund_pending');
  perform pg_temp.reg(e1, s1); perform pg_temp.paid(e1, s1);
  q1 := pg_temp.wa(a, e1); q2 := pg_temp.wa(b, e1); q3 := pg_temp.wa(c, e1); q4 := pg_temp.wa(d, e1); q5 := pg_temp.wa(s1, e1);
  perform pg_temp.ok(q1 is not null and q5 is not null, 'five WhatsApp rows are queued');
  -- the channel gate: a caller with no WhatsApp sender is never handed a WhatsApp row, and the rows keep their tries
  r := public.notify_claim_due(500, array['log'], now(), array['email']);
  perform pg_temp.ok(jsonb_array_length(r) = 0 and (select count(*) from public.notify_queue where status = 'queued' and channel = 'whatsapp') = 5 and (select max(tries) from public.notify_queue where channel = 'whatsapp') = 0,
                     'no WhatsApp sender: the WhatsApp rows stay queued, untouched, no try spent');
  r := public.notify_claim_due(500, array[]::text[], now(), array['whatsapp']);
  perform pg_temp.ok(pg_temp.handed(r, q1) and not pg_temp.handed(r, q2) and not pg_temp.handed(r, q3) and not pg_temp.handed(r, q4) and not pg_temp.handed(r, q5),
                     'a WhatsApp-only caller is handed the paid guest and nobody else');
  perform pg_temp.ok((select x ->> 'whatsapp_number' from jsonb_array_elements(r) x where (x ->> 'id')::uuid = q1) = NA, 'the row carries the number');
  perform pg_temp.ok(pg_temp.note(q2) = 'skipped: no paid order' and pg_temp.note(q3) = 'skipped: no paid order' and pg_temp.note(q4) = 'skipped: no paid order' and pg_temp.note(q5) = 'skipped: WhatsApp is off',
                     'the free guest, the refunded guest and the guest mid-refund are skipped as unpaid, the one who is off as off');
  perform pg_temp.ok(pg_temp.status(q2) = 'skipped' and pg_temp.status(q3) = 'skipped' and pg_temp.status(q4) = 'skipped', 'and those rows are settled');
  -- STOP at once, for a row already queued
  q6 := pg_temp.wa(a, e1, 'reminder_hour');
  perform public.notify_wa_stop(NA);
  r := public.notify_claim_due(500, array[]::text[], now(), array['whatsapp']);
  perform pg_temp.ok(not pg_temp.handed(r, q6) and pg_temp.note(q6) = 'skipped: WhatsApp is off' and pg_temp.status(q6) = 'skipped', 'STOP takes effect at once: a row already queued is skipped at the claim');
  -- the recheck, for a row already claimed
  perform pg_temp.num(a, NA);
  q6 := pg_temp.wa(a, e1, 'reminder_hour', 'wa-again');
  r := public.notify_claim_due(500, array[]::text[], now(), array['whatsapp']);
  perform pg_temp.ok(pg_temp.handed(r, q6) and public.notify_wa_recheck(q6) = NA, 'recheck: a claimed row of a guest who is on and paid gives the number');
  perform public.notify_wa_stop(NA);
  perform pg_temp.ok(public.notify_wa_recheck(q6) is null, 'recheck: after a STOP that came in between the claim and the send, null');
  perform pg_temp.num(a, NA);
  update public.ev_orders set status = 'refunded' where buyer_id = a and event_id = e1;
  perform pg_temp.ok(public.notify_wa_recheck(q6) is null, 'recheck: after a refund in between, null');
  perform pg_temp.ok(public.notify_wa_recheck(q1) is null and public.notify_wa_recheck(gen_random_uuid()) is null, 'recheck: a row that is not claimed, or does not exist, gives null');
  update public.ev_orders set status = 'paid' where buyer_id = a and event_id = e1;
  -- event_cancelled still reaches a guest whose refund has started
  perform pg_temp.num(d, '+2348066666666');
  q3 := pg_temp.wa(d, e1, 'event_cancelled', 'wa-cancel-d');
  q4 := pg_temp.wa(d, e1, 'event_changed', 'wa-change-d');
  r := public.notify_claim_due(500, array[]::text[], now(), array['whatsapp']);
  perform pg_temp.ok(pg_temp.handed(r, q3), 'event_cancelled is sent to a paid guest whose refund has started (refund_pending)');
  perform pg_temp.ok(not pg_temp.handed(r, q4) and pg_temp.note(q4) = 'skipped: no paid order', 'event_changed is not: the paid rule holds for every other kind');
  -- email callers get email only
  perform pg_temp.reg(e1, h); update auth.users set email = 'wa-host@evtest.invalid' where id = h;
  q2 := public.notify_enqueue(h, 'registered', e1, '{"title":"x"}', 1, null, 'wa-mail-1', 'email', 'guest', null);
  q1 := pg_temp.wa(a, e1, 'reminder_hour', 'wa-mixed');
  r := public.notify_claim_due(500, array['log'], now(), array['email']);
  perform pg_temp.ok(pg_temp.handed(r, q2) and not pg_temp.handed(r, q1) and pg_temp.status(q1) = 'queued', 'an email-only caller gets the email and leaves the WhatsApp row queued');
  r := public.notify_claim_due(500, array['log'], now());
  perform pg_temp.ok(pg_temp.handed(r, q1), 'a caller that names no channels gets both, as before');
  delete from public.notify_queue; delete from public.notify_sends; delete from public.notify_prefs;

  -- ------------------------------------------------------------ the monthly budget ---
  bud := public.notify_wa_budget();
  perform pg_temp.ok((bud ->> 'budget_usd')::numeric = 50 and (bud ->> 'spent_usd')::numeric = 0 and (bud ->> 'room')::int = 7462 and (bud ->> 'percent')::numeric = 0, 'the default: $50, nothing spent, room for 7462 messages at $0.0067');
  perform public.set_notify_config('whatsapp_monthly_budget_usd', '0.02');
  perform pg_temp.ok((public.notify_wa_budget() ->> 'room')::int = 2, 'a budget of $0.02 pays for 2 messages');
  perform pg_temp.sent('wamid.B1');
  bud := public.notify_wa_budget();
  perform pg_temp.ok((bud ->> 'unpriced')::int = 1 and (bud ->> 'room')::int = 1 and (bud ->> 'projected_usd')::numeric = 0.0067, 'a sent message not yet priced counts at the estimate');
  perform pg_temp.sent('wamid.B2');
  perform pg_temp.ok((public.notify_wa_budget() ->> 'room')::int = 0 and public._notify_wa_room(now()) = 0, 'two of them use the budget up: room 0');
  insert into public.notify_sends (channel, provider, status, provider_message_id, cost_usd, pricing) values ('whatsapp', 'whatsapp', 'delivered', 'wamid.B1', 0.0067, 'utility');
  bud := public.notify_wa_budget();
  perform pg_temp.ok((bud ->> 'unpriced')::int = 1 and (bud ->> 'spent_usd')::numeric = 0.0067 and (bud ->> 'projected_usd')::numeric = 0.0134, 'once priced, a message counts its real cost and no longer as an estimate');
  insert into public.notify_sends (channel, provider, status, provider_message_id, cost_usd, pricing) values ('whatsapp', 'whatsapp', 'delivered', 'wamid.B2', 0, 'service:free');
  bud := public.notify_wa_budget();
  perform pg_temp.ok((bud ->> 'unpriced')::int = 0 and (bud ->> 'projected_usd')::numeric = 0.0067 and (bud ->> 'room')::int = 1, 'a message priced as free counts nothing');
  perform pg_temp.sent('wamid.B3'); perform pg_temp.sent('wamid.B3');
  perform pg_temp.ok((public.notify_wa_budget() ->> 'unpriced')::int = 1, 'one message id logged twice counts once');
  insert into public.notify_sends (channel, provider, status, provider_message_id, error) values ('whatsapp', 'whatsapp', 'failed', 'wamid.B3', '131026: undeliverable');
  perform pg_temp.ok((public.notify_wa_budget() ->> 'unpriced')::int = 0, 'a message that failed after Meta took it is not billed, so not counted');
  perform pg_temp.sent('wamid.OLD', null, interval '45 days');
  insert into public.notify_sends (channel, provider, status, provider_message_id, cost_usd, pricing, created_at) values ('whatsapp', 'whatsapp', 'delivered', 'wamid.OLD2', 9.99, 'utility', now() - interval '45 days');
  bud := public.notify_wa_budget();
  perform pg_temp.ok((bud ->> 'unpriced')::int = 0 and (bud ->> 'spent_usd')::numeric = 0.0067, 'last month''s sends and costs are not this month''s');
  insert into public.notify_sends (channel, provider, status, provider_message_id) values ('whatsapp', 'whatsapp_log', 'sent', 'walog_1');
  insert into public.notify_sends (channel, provider, status, provider_message_id, cost_usd) values ('email', 'brevo', 'sent', 'mail_1', 5);
  bud := public.notify_wa_budget();
  perform pg_temp.ok((bud ->> 'unpriced')::int = 0 and (bud ->> 'spent_usd')::numeric = 0.0067, 'the log sender and email are not counted');
  -- in flight
  e1 := pg_temp.ev(h, 'Wa Budget Night', now() + interval '1 day');
  perform pg_temp.num(a, NA); perform pg_temp.reg(e1, a); perform pg_temp.paid(e1, a);
  perform pg_temp.num(b, NB); perform pg_temp.reg(e1, b); perform pg_temp.paid(e1, b);
  perform pg_temp.num(c, NC); perform pg_temp.reg(e1, c); perform pg_temp.paid(e1, c);
  q1 := pg_temp.wa(a, e1); q2 := pg_temp.wa(b, e1); q3 := pg_temp.wa(c, e1);
  perform public.set_notify_config('whatsapp_monthly_budget_usd', '0.0134');
  -- spent 0.0067 + one claim's worth of room: room = floor((0.0134 - 0.0067) / 0.0067) = 1
  r := public.notify_claim_due(500, array[]::text[], now(), array['whatsapp']);
  perform pg_temp.ok(jsonb_array_length(r) = 1, 'one claim never hands out more than the room left in the budget: 1 of 3');
  perform pg_temp.ok((select count(*) from public.notify_queue where id in (q1, q2, q3) and status = 'skipped') = 2
                     and (select count(*) from public.notify_sends where queue_id in (q1, q2, q3) and error = 'skipped: WhatsApp monthly budget reached') = 2,
                     'the rest are skipped with the reason');
  perform pg_temp.ok((public.notify_wa_budget() ->> 'in_flight')::int = 1 and (public.notify_wa_budget() ->> 'room')::int = 0, 'the row handed out and not settled counts as in flight');
  -- email still goes while WhatsApp is over budget
  perform pg_temp.reg(e1, h); update auth.users set email = 'wa-host2@evtest.invalid' where id = h;
  q4 := public.notify_enqueue(h, 'registered', e1, '{"title":"x"}', 1, null, 'wa-mail-2', 'email', 'guest', null);
  q5 := pg_temp.wa(a, e1, 'reminder_hour', 'wa-over');
  r := public.notify_claim_due(500, array['log']);
  perform pg_temp.ok(pg_temp.handed(r, q4) and not pg_temp.handed(r, q5) and pg_temp.note(q5) = 'skipped: WhatsApp monthly budget reached', 'over budget, WhatsApp is skipped and email still goes');
  -- the budget is changed with one line
  perform public.set_notify_config('whatsapp_monthly_budget_usd', '5');
  q6 := pg_temp.wa(b, e1, 'reminder_hour', 'wa-after-raise');
  r := public.notify_claim_due(500, array[]::text[], now(), array['whatsapp']);
  perform pg_temp.ok(pg_temp.handed(r, q6), 'raising the budget with one line lets WhatsApp go again');
  perform public.set_notify_config('whatsapp_monthly_budget_usd', '0');
  perform pg_temp.ok((public.notify_wa_budget() ->> 'room')::int = 0 and (public.notify_wa_budget() ->> 'percent')::numeric = 100, 'a budget of 0 switches WhatsApp off');
  perform public.set_notify_config('whatsapp_monthly_budget_usd', 'a lot');
  perform pg_temp.ok((public.notify_wa_budget() ->> 'budget_usd')::numeric = 50, 'a budget that is not a number falls back to the default 50');
  delete from public.notify_queue; delete from public.notify_sends; delete from public.notify_prefs;
  perform public.set_notify_config('whatsapp_monthly_budget_usd', '0.1');
  insert into public.notify_sends (channel, provider, status, provider_message_id, cost_usd, pricing) values ('whatsapp', 'whatsapp', 'delivered', 'wamid.P1', 0.08, 'utility');
  perform pg_temp.ok((public.notify_wa_budget() ->> 'percent')::numeric = 80.0, 'the share used is reported for the 80 percent warning');
  -- the bot over budget: only the STOP confirmation
  perform public.set_notify_config('whatsapp_monthly_budget_usd', '0');
  r := pg_temp.bot('wamid.BG1', NX, 'help', t0);
  r2 := pg_temp.bot('wamid.BG2', NX, 'stop', t0);
  perform pg_temp.ok(r ->> 'reply' is null and r ->> 'why' = 'budget reached' and r2 ->> 'reply' = 'stop', 'over budget the bot sends only the STOP confirmation');
  perform public.set_notify_config('whatsapp_monthly_budget_usd', '50');
  delete from public.notify_sends; delete from public.notify_wa_inbound;

  -- ------------------------------------------------------------ Meta's status events ---
  insert into public.notify_queue (id, user_id, kind, channel, dedupe_key, status) values (gen_random_uuid(), a, 'reminder_day', 'whatsapp', 'wa-st-1', 'sent') returning id into q1;
  perform pg_temp.sent('wamid.M1', q1); perform pg_temp.sent('wamid.M2', q1); perform pg_temp.sent('wamid.M3', q1); perform pg_temp.sent('wamid.M4', q1);
  r := public.notify_wa_apply_statuses('[{"message_id":"wamid.M1","status":"delivered","priced":true,"billable":true,"category":"utility"}]');
  perform pg_temp.ok(r = '{"applied":1,"duplicate":0,"unmatched":0,"ignored":0}'::jsonb, 'a delivered status with pricing is applied');
  perform pg_temp.ok((select cost_usd from public.notify_sends where provider_message_id = 'wamid.M1' and status = 'delivered') = 0.0067 and (select pricing from public.notify_sends where provider_message_id = 'wamid.M1' and status = 'delivered') = 'utility',
                     'the cost is the price of the category Meta billed it in');
  r := public.notify_wa_apply_statuses('[{"message_id":"wamid.M1","status":"delivered","priced":true,"billable":true,"category":"utility"}]');
  perform pg_temp.ok(r ->> 'duplicate' = '1' and (select count(*) from public.notify_sends where provider_message_id = 'wamid.M1' and status = 'delivered') = 1, 'a replay changes nothing: still one delivered line');
  r := public.notify_wa_apply_statuses('[{"message_id":"wamid.M1","status":"read","priced":false,"billable":false}]');
  perform pg_temp.ok(r ->> 'applied' = '1' and (select count(*) from public.notify_sends where provider_message_id = 'wamid.M1' and status = 'read') = 1, 'read is logged on its own line');
  r := public.notify_wa_apply_statuses('[{"message_id":"wamid.M1","status":"read","priced":true,"billable":true,"category":"utility"}]');
  perform pg_temp.ok(r ->> 'duplicate' = '1' and (select sum(cost_usd) from public.notify_sends where provider_message_id = 'wamid.M1') = 0.0067, 'a message is priced once, whichever status carries it');
  r := public.notify_wa_apply_statuses('[{"message_id":"wamid.M2","status":"sent","priced":true,"billable":true,"category":"marketing"},{"message_id":"wamid.M2","status":"sent","priced":true,"billable":true,"category":"marketing"}]');
  perform pg_temp.ok(r ->> 'applied' = '1' and r ->> 'duplicate' = '1' and (select sum(cost_usd) from public.notify_sends where provider_message_id = 'wamid.M2') = 0.0516, 'pricing in the sent status is applied once, at the marketing price');
  r := public.notify_wa_apply_statuses('[{"message_id":"wamid.M3","status":"delivered","priced":true,"billable":false,"category":"service"}]');
  perform pg_temp.ok((select cost_usd from public.notify_sends where provider_message_id = 'wamid.M3' and status = 'delivered') = 0 and (select pricing from public.notify_sends where provider_message_id = 'wamid.M3' and status = 'delivered') = 'service:free',
                     'not billable: cost 0, marked free');
  r := public.notify_wa_apply_statuses('[{"message_id":"wamid.M4","status":"failed","error":"131026: Message undeliverable to +2348012345678"}]');
  perform pg_temp.ok(r ->> 'applied' = '1' and (select error from public.notify_sends where provider_message_id = 'wamid.M4' and status = 'failed') = '131026: Message undeliverable to ***', 'a failed status is logged and a number in its text is removed');
  r := public.notify_wa_apply_statuses('[{"message_id":"wamid.M4","status":"failed","error":"131026: Message undeliverable to +2348012345678"}]');
  perform pg_temp.ok(r ->> 'duplicate' = '1', 'and a replayed failure changes nothing');
  r := public.notify_wa_apply_statuses('[{"message_id":"wamid.NOPE","status":"delivered","priced":true,"billable":true,"category":"utility"},{"message_id":"wamid.M1","status":"played"},{"status":"read"},"junk",{"message_id":"wamid.M1","status":"sent"}]');
  perform pg_temp.ok(r ->> 'unmatched' = '1' and r ->> 'ignored' = '3' and (select count(*) from public.notify_sends where provider_message_id = 'wamid.NOPE') = 0, 'a message we did not send is dropped, and junk is ignored');
  perform pg_temp.ok(public.notify_wa_apply_statuses(null) = '{"applied":0,"duplicate":0,"unmatched":0,"ignored":0}'::jsonb and public.notify_wa_apply_statuses('{}') ->> 'applied' = '0', 'null or a non-array: nothing');
  perform pg_temp.ok((select count(*) from public.notify_sends where queue_id = q1 and status = 'sent' and pricing is null) = 4 and (select count(*) from public.notify_sends where queue_id = q1 and cost_usd = 0 and pricing is null) >= 4,
                     'the original sent lines are untouched (the log is append only)');
  -- replies are logged so their pricing can be matched
  perform pg_temp.ok(public.notify_wa_record_reply('wamid.R1') is true and public.notify_wa_record_reply('wamid.R1') is false and public.notify_wa_record_reply('') is false and public.notify_wa_record_reply(null) is false,
                     'a reply is logged once');
  r := public.notify_wa_apply_statuses('[{"message_id":"wamid.R1","status":"delivered","priced":true,"billable":false,"category":"service"}]');
  perform pg_temp.ok(r ->> 'applied' = '1' and (select queue_id from public.notify_sends where provider_message_id = 'wamid.R1' and status = 'delivered') is null, 'and Meta''s status for a reply finds it (it has no queue row)');
  perform pg_temp.ok(not exists (select 1 from public.notify_sends s where to_jsonb(s)::text ~ '\+?234[0-9]{7,}'), 'no phone number is anywhere in the send log');
  delete from public.notify_queue; delete from public.notify_sends; delete from public.notify_prefs;

  raise notice 'ALL NOTIFY WHATSAPP TESTS PASSED';
end $$;
rollback;
