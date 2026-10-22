-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Release 1 Pops (supabase/events_r1_pops.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, crew_announcements.sql, events_r1_events.sql, events_r1_registrations.sql and
-- events_r1_pops.sql loaded. Ends with ALL EVENTS R1 POPS TESTS PASSED.
-- If Ola's own Pops tables replace this file, this test shows the shapes the front end expects from them.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_pops_test.sql
begin;
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
          case when guest then null else 'pop-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
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
-- A live event made straight in the table.
create function pg_temp.ev(host uuid, ttl text, starts timestamptz default now() + interval '2 days', room uuid default null,
                           kind text default 'in_person', made timestamptz default null) returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id, room_id, kind, created_at)
  values (ttl, 'Somewhere', starts, 'live', host, room, kind, coalesce(made, now())) returning id;
$$;
create function pg_temp.reg(ev uuid, u uuid, st text) returns void language sql as $$
  insert into public.ev_registrations (event_id, user_id, status, name) values (ev, u, st, 'x');
$$;
create function pg_temp.send(u uuid, ev uuid, body text, aud text default 'going', also boolean default true, sat timestamptz default null) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_send_pop(%L, %L, %L, %L, %L)', ev, body, aud, also, sat));
end $$;
create function pg_temp.seen(u uuid, ev uuid) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_event_pops(%L)', ev));
end $$;
create function pg_temp.has(u uuid, ev uuid, body text) returns boolean language plpgsql as $$
begin
  return exists (select 1 from jsonb_array_elements(pg_temp.seen(u, ev)) x where x ->> 'body' = body);
end $$;
create function pg_temp.dispatch() returns integer language sql as $$ select public.ev_dispatch_due_pops(); $$;
create function pg_temp.autos(ev uuid) returns int language sql as $$
  select count(*)::int from public.ev_pops where event_id = ev and auto is not null;
$$;

do $$
declare
  h uuid := pg_temp.newuser('Pop Host'); a uuid := pg_temp.newuser('Pop Ada'); b uuid := pg_temp.newuser('Pop Bola'); c uuid := pg_temp.newuser('Pop Chike');
  d uuid := pg_temp.newuser('Pop Dayo'); x uuid := pg_temp.newuser('Pop Stranger'); m uuid := pg_temp.newuser('Pop Member');
  room uuid := gen_random_uuid();
  e1 uuid; e2 uuid; e3 uuid; ea uuid; ed uuid; eo uuid; en uuid; ef uuid; ec uuid;
  r jsonb; n int; pid uuid; sid uuid; i int; f record; long text := repeat('x', 500); items jsonb; k int;
begin
  insert into public.crews (id, name, created_by, visibility) values (room, 'Pop Room', h, 'open');
  insert into public.crew_members (crew_id, user_id, role) values (room, h, 'owner'), (room, m, 'member');
  e1 := pg_temp.ev(h, 'Pop party', now() + interval '2 days', room);
  perform pg_temp.reg(e1, a, 'going'); perform pg_temp.reg(e1, d, 'checked_in'); perform pg_temp.reg(e1, b, 'requested'); perform pg_temp.reg(e1, c, 'waitlisted');

  -- Closed tables.
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ev_pops', 'select') and not has_table_privilege('authenticated', 'public.ev_announcement_event', 'select')
                     and not has_table_privilege('anon', 'public.ev_pops', 'select'), 'the Pops tables are closed to anon and authenticated');

  -- Who may send, and the checks.
  perform pg_temp.ok(pg_temp.send(x, e1, 'hi') ->> 'reason' = 'not_allowed', 'a stranger cannot send a Pop');
  perform pg_temp.ok(pg_temp.send(a, e1, 'hi') ->> 'reason' = 'not_allowed', 'and neither can a guest of the event');
  perform pg_temp.ok(pg_temp.send(h, e1, '   ') ->> 'reason' = 'empty', 'an empty Pop is refused');
  perform pg_temp.ok(pg_temp.send(h, e1, repeat('x', 501)) ->> 'reason' = 'too_long', '501 characters is too long');
  perform pg_temp.ok(pg_temp.send(h, e1, 'hi', 'nobody') ->> 'reason' = 'bad_audience', 'an unknown audience is refused');
  perform pg_temp.ok(pg_temp.send(h, e1, 'hi', 'going', true, now() + interval '91 days') ->> 'reason' = 'too_far', 'a Pop more than 90 days ahead is refused');
  perform pg_temp.ok(pg_temp.send(h, gen_random_uuid(), 'hi') ->> 'reason' = 'not_found', 'an unknown event is not_found');
  begin
    perform pg_temp.anon();
    perform public.ev_send_pop(e1, 'hi', 'going', true, null);
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not send');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot call ev_send_pop');
  end;

  -- Send now, to going: who it reaches, who sees it.
  r := pg_temp.send(h, e1, 'Doors at 8, bring your ticket');
  pid := (r -> 'pop' ->> 'id')::uuid;
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'pop' ->> 'status' = 'sent' and (r -> 'pop' ->> 'recipients')::int = 2 and r -> 'pop' ->> 'sent_at' is not null
                     and (r -> 'pop' ->> 'also_room')::boolean and r -> 'pop' ->> 'author_name' = 'Pop Host' and r -> 'pop' ->> 'event_title' = 'Pop party' and r -> 'pop' ->> 'auto' is null,
                     'a Pop to going: sent, 2 recipients (going and checked in), also in the room');
  perform pg_temp.ok(pg_temp.has(a, e1, 'Doors at 8, bring your ticket') and pg_temp.has(d, e1, 'Doors at 8, bring your ticket') and pg_temp.has(h, e1, 'Doors at 8, bring your ticket'),
                     'people who are going, and the host, see it on the event page');
  perform pg_temp.ok(not pg_temp.has(b, e1, 'Doors at 8, bring your ticket') and not pg_temp.has(c, e1, 'Doors at 8, bring your ticket') and not pg_temp.has(x, e1, 'Doors at 8, bring your ticket'),
                     'someone waiting for approval, a waitlisted person and a stranger do not');
  perform pg_temp.send(h, e1, 'Your request is in', 'pending', false);
  perform pg_temp.send(h, e1, 'You are on the waitlist', 'waitlist', false);
  perform pg_temp.send(h, e1, 'Hello everybody', 'everyone', false);
  perform pg_temp.ok(pg_temp.has(b, e1, 'Your request is in') and not pg_temp.has(a, e1, 'Your request is in'), 'a pending Pop is for people waiting for approval');
  perform pg_temp.ok(pg_temp.has(c, e1, 'You are on the waitlist') and not pg_temp.has(b, e1, 'You are on the waitlist'), 'a waitlist Pop is for the waitlist');
  perform pg_temp.ok(pg_temp.has(a, e1, 'Hello everybody') and pg_temp.has(b, e1, 'Hello everybody') and pg_temp.has(c, e1, 'Hello everybody') and not pg_temp.has(x, e1, 'Hello everybody'),
                     'an everyone Pop reaches all three, and still not a stranger');
  perform pg_temp.ok((select recipients from public.ev_pops where body = 'Hello everybody') = 4, 'and counts 4 recipients');
  perform pg_temp.ok(jsonb_array_length(pg_temp.seen(x, e1)) = 0, 'a stranger sees no Pops at all');

  -- The copy into the room.
  perform pg_temp.ok((select count(*) from public.ev_announcement_event where event_id = e1) = 1, 'only the Pop that asked for the room was copied');
  r := pg_temp.j(m, format('select public.ev_room_announcements(%L)', room));
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'body' = 'Doors at 8, bring your ticket' and r -> 0 ->> 'event_id' = e1::text and r -> 0 ->> 'event_title' = 'Pop party'
                     and r -> 0 ->> 'author_name' = 'Pop Host' and r -> 0 ->> 'room_id' = room::text, 'a room member reads it in the room, tagged with the event');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_room_announcements(%L)', room)) = '[]'::jsonb, 'a non-member reads nothing');
  insert into public.crew_announcements (crew_id, author_id, body) values (room, h, 'A plain room note');
  r := pg_temp.j(m, format('select public.ev_room_announcements(%L)', room));
  perform pg_temp.ok(jsonb_array_length(r) = 2 and exists (select 1 from jsonb_array_elements(r) q where q ->> 'body' = 'A plain room note' and q ->> 'event_id' is null and q ->> 'event_title' is null),
                     'a plain room announcement has no event tag');
  perform pg_temp.ok(not pg_temp.has(h, e1, 'A plain room note') and not pg_temp.has(a, e1, 'A plain room note'), 'ONE WAY: a plain room announcement never shows on the event');
  perform pg_temp.ok(pg_temp.t(h, format('select public.crew_announce(%L, %L)', room, 'Owner post')) = 'slow_down',
                     'KNOWN: the copy of an event Pop counts toward the room owner''s 2 announcements a day (see the header of the Pops file)');

  -- A long Pop is cut for the room, kept whole for the event.
  r := pg_temp.send(h, e1, long);
  perform pg_temp.ok(char_length(r -> 'pop' ->> 'body') = 500 and (select char_length(body) from public.crew_announcements where body like 'xxx%' and crew_id = room) = 280
                     and (select body from public.crew_announcements where body like 'xxx%' and crew_id = room) like '%...', 'a 500 character Pop is cut to 280 with three dots in the room and kept whole on the event');
  perform pg_temp.ok((select count(*) from public.ev_announcement_event l join public.crew_announcements a2 on a2.id = l.announcement_id where a2.body like 'xxx%') = 1, 'with its event tag');
  r := pg_temp.send(h, e1, repeat('y', 280));
  perform pg_temp.ok((select char_length(body) from public.crew_announcements where body like 'yyy%') = 280 and (select body from public.crew_announcements where body like 'yyy%') = repeat('y', 280), 'a 280 character Pop is copied as it is');
  r := pg_temp.send(h, e1, 'Not for the room', 'going', false);
  perform pg_temp.ok(not exists (select 1 from public.crew_announcements where body = 'Not for the room') and not (r -> 'pop' ->> 'also_room')::boolean, 'also_room off: nothing in the room');
  e2 := pg_temp.ev(h, 'No room event');
  r := pg_temp.send(h, e2, 'Hello', 'going', true);
  perform pg_temp.ok((r ->> 'ok')::boolean and not (r -> 'pop' ->> 'also_room')::boolean, 'an event with no room: also_room is quietly off');

  -- Scheduled Pops.
  r := pg_temp.send(h, e1, 'See you tomorrow', 'everyone', true, now() + interval '2 hours');
  sid := (r -> 'pop' ->> 'id')::uuid;
  perform pg_temp.ok(r -> 'pop' ->> 'status' = 'scheduled' and r -> 'pop' ->> 'sent_at' is null and r -> 'pop' ->> 'send_at' is not null, 'a later send_at makes a scheduled Pop');
  perform pg_temp.ok(not pg_temp.has(a, e1, 'See you tomorrow'), 'a scheduled Pop is not on the event page yet');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(pg_temp.j(h, format('select public.ev_host_pops(%L)', e1))) q where q ->> 'body' = 'See you tomorrow' and q ->> 'status' = 'scheduled'), 'but the host sees it in the Pops tab');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_host_pops(%L)', e1)) = '[]'::jsonb and pg_temp.j(a, format('select public.ev_host_pops(%L)', e1)) = '[]'::jsonb, 'and nobody else does');
  n := pg_temp.dispatch();
  perform pg_temp.ok((select status from public.ev_pops where id = sid) = 'scheduled', 'the tick does nothing before the time');
  update public.ev_pops set send_at = now() - interval '1 minute' where id = sid;
  n := pg_temp.dispatch();
  perform pg_temp.ok(n >= 1 and (select status from public.ev_pops where id = sid) = 'sent' and (select recipients from public.ev_pops where id = sid) = 4
                     and (select sent_at from public.ev_pops where id = sid) is not null, 'at the time the tick sends it, with its recipients');
  perform pg_temp.ok(pg_temp.has(b, e1, 'See you tomorrow') and exists (select 1 from public.crew_announcements where body = 'See you tomorrow'), 'it is on the event page and in the room');
  n := pg_temp.dispatch();
  perform pg_temp.ok(n = 0 and (select count(*) from public.crew_announcements where body = 'See you tomorrow') = 1, 'a second tick sends nothing and copies nothing again');

  -- A cancelled event sends nothing.
  ec := pg_temp.ev(h, 'Cancelled one', now() + interval '2 days', room);
  r := pg_temp.send(h, ec, 'Later', 'going', true, now() + interval '1 hour');
  pid := (r -> 'pop' ->> 'id')::uuid;
  update public.events set status = 'cancelled' where id = ec;
  update public.ev_pops set send_at = now() - interval '1 minute' where id = pid;
  n := pg_temp.dispatch();
  perform pg_temp.ok((select status from public.ev_pops where id = pid) = 'cancelled' and not exists (select 1 from public.crew_announcements where body = 'Later'), 'a scheduled Pop of a cancelled event is cancelled, not sent');
  perform pg_temp.ok(pg_temp.send(h, ec, 'After the fact') ->> 'reason' = 'event_closed', 'and a cancelled event takes no new Pops');

  -- The limit: 10 an hour per event.
  e3 := pg_temp.ev(h, 'Chatty host');
  for i in 1..10 loop
    perform pg_temp.ok((pg_temp.send(h, e3, 'Pop ' || i, 'going', false) ->> 'ok')::boolean, 'Pop ' || i || ' of 10 goes');
  end loop;
  perform pg_temp.ok(pg_temp.send(h, e3, 'Pop 11', 'going', false) ->> 'reason' = 'slow_down', 'the 11th in an hour is slow_down');

  -- Automatic Pops.
  ea := pg_temp.ev(h, 'Hour party', now() + interval '50 minutes', null, 'in_person', now() - interval '2 hours');
  ed := pg_temp.ev(h, 'Day party', now() + interval '23 hours 50 minutes', null, 'in_person', now() - interval '3 days');
  eo := pg_temp.ev(h, 'Call night', now() - interval '1 minute', null, 'online', now() - interval '1 day');
  en := pg_temp.ev(h, 'Just made', now() + interval '30 minutes');
  ef := pg_temp.ev(h, 'Far away', now() + interval '3 days');
  perform pg_temp.reg(ea, a, 'going'); perform pg_temp.reg(ea, b, 'going'); perform pg_temp.reg(ea, c, 'requested');
  n := pg_temp.dispatch();
  perform pg_temp.ok(pg_temp.autos(ea) = 1 and (select body from public.ev_pops where event_id = ea and auto = 'hour_before') = 'Hour party starts in 1 hour.'
                     and (select status from public.ev_pops where event_id = ea and auto = 'hour_before') = 'sent' and (select recipients from public.ev_pops where event_id = ea) = 2
                     and (select audience from public.ev_pops where event_id = ea) = 'going', 'the hour before Pop is made and sent to the people who are going');
  perform pg_temp.ok(pg_temp.has(a, ea, 'Hour party starts in 1 hour.') and not pg_temp.has(c, ea, 'Hour party starts in 1 hour.'), 'and shows on the event page for them');
  perform pg_temp.ok(pg_temp.autos(ed) = 1 and (select body from public.ev_pops where event_id = ed and auto = 'day_before') like 'Tomorrow at %: Day party. See you there.', 'the day before Pop says tomorrow, the time and the name');
  perform pg_temp.ok(pg_temp.autos(eo) = 1 and (select body from public.ev_pops where event_id = eo and auto = 'doors_open') = 'The call for Call night is open. Join from the event page.', 'an online event''s doors open Pop is about the call');
  perform pg_temp.ok(pg_temp.autos(en) = 0, 'an event made less than an hour before it starts sends no stale hour before Pop');
  perform pg_temp.ok(pg_temp.autos(ef) = 0, 'an event days away has none yet');
  n := pg_temp.dispatch();
  perform pg_temp.ok(n = 0 and pg_temp.autos(ea) = 1 and pg_temp.autos(ed) = 1 and pg_temp.autos(eo) = 1, 'a second tick makes no second automatic Pop');
  r := pg_temp.j(h, format('select public.ev_host_pops(%L)', ef));
  perform pg_temp.ok(jsonb_array_length(r) = 3 and (select count(*) from jsonb_array_elements(r) q where q ->> 'status' = 'scheduled' and q ->> 'auto' is not null) = 3
                     and exists (select 1 from jsonb_array_elements(r) q where q ->> 'auto' = 'hour_before' and q ->> 'body' = 'Far away starts in 1 hour.'),
                     'the Pops tab shows the three automatic Pops still to come');
  r := pg_temp.j(h, format('select public.ev_host_pops(%L)', ea));
  perform pg_temp.ok(jsonb_array_length(r) = 2 and exists (select 1 from jsonb_array_elements(r) q where q ->> 'auto' = 'hour_before' and q ->> 'status' = 'sent')
                     and exists (select 1 from jsonb_array_elements(r) q where q ->> 'auto' = 'doors_open' and q ->> 'status' = 'scheduled'),
                     'and once one has gone it shows as sent, with the others still to come');
  update public.events set status = 'hidden' where id = ef;
  update public.events set starts_at = now() + interval '30 minutes', created_at = now() - interval '2 days' where id = ef;
  n := pg_temp.dispatch();
  perform pg_temp.ok(pg_temp.autos(ef) = 0, 'a hidden event gets no automatic Pops');

  -- Who a Pop is for, for the delivery.
  select id into pid from public.ev_pops where body = 'Hello everybody';
  select count(*) into n from public.ev_pop_recipient_ids(pid);
  perform pg_temp.ok(n = 4, 'the delivery list for an everyone Pop is the 4 people');
  select id into pid from public.ev_pops where body = 'Doors at 8, bring your ticket';
  select count(*) into n from public.ev_pop_recipient_ids(pid);
  perform pg_temp.ok(n = 2, 'and for a going Pop the 2');

  -- Access.
  for f in select p.oid, p.oid::regprocedure as sig, p.proname as name
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and p.proname in ('ev_send_pop', 'ev_event_pops', 'ev_host_pops', 'ev_room_announcements', 'ev_dispatch_due_pops', 'ev_pop_recipient_ids',
                                '_ev_copy_pop_to_room', '_ev_pop_json', '_ev_auto_text', '_ev_audience_count')
  loop
    perform pg_temp.ok(not has_function_privilege('anon', f.oid, 'execute'), f.sig || ': anon cannot call');
    perform pg_temp.ok(has_function_privilege('authenticated', f.oid, 'execute') = (f.name in ('ev_send_pop', 'ev_event_pops', 'ev_host_pops', 'ev_room_announcements')),
                       f.sig || ': authenticated access is as designed');
  end loop;
  perform pg_temp.ok(has_function_privilege('service_role', 'public.ev_dispatch_due_pops()', 'execute') and has_function_privilege('service_role', 'public.ev_pop_recipient_ids(uuid)', 'execute'),
                     'the service role can run the tick and read recipients');
  raise notice 'ALL EVENTS R1 POPS TESTS PASSED';
end $$;
rollback;
