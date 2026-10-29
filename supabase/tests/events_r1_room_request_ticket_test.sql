-- DRAFT FOR OLA, NOT RUN ANYWHERE. Release 1 join request with a ticket (supabase/events_r1_room_request_ticket.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, crew_stage_voice.sql, events_r1_events.sql, events_r1_registrations.sql,
-- events_r1_rooms.sql, events_r1_room_profile.sql and events_r1_room_request_ticket.sql loaded. Ends with ALL EVENTS R1 ROOM REQUEST TICKET TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_room_request_ticket_test.sql
begin;
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
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.newuser(shown text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rqt-' || u || '@evtest.invalid', false, '{}',
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
create function pg_temp.ev(host uuid, ttl text, room uuid) returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id, room_id, visibility, requires_approval)
  values (ttl, 'Somewhere', now() + interval '2 days', 'live', host, room, 'public', false) returning id;
$$;
create function pg_temp.reg(ev uuid, u uuid, st text) returns void language sql as $$
  insert into public.ev_registrations (event_id, user_id, status, name) values (ev, u, st, 'x');
$$;

do $$
declare
  o uuid := pg_temp.newuser('Rqt Owner'); buyer uuid := pg_temp.newuser('Rqt Buyer'); plain uuid := pg_temp.newuser('Rqt Plain');
  waiter uuid := pg_temp.newuser('Rqt Waiter'); later uuid := pg_temp.newuser('Rqt Later'); x uuid := pg_temp.newuser('Rqt Stranger');
  askroom uuid; openroom uuid; other uuid; e1 uuid; e2 uuid; r jsonb;
begin
  r := pg_temp.j(o, $q$select public.ev_create_room('Rqt Ask Room', '', null, null, '{}', 'ask', null)$q$);
  askroom := (r ->> 'id')::uuid;
  r := pg_temp.j(o, $q$select public.ev_create_room('Rqt Open Room', '', null, null, '{}', 'open', null)$q$);
  openroom := (r ->> 'id')::uuid;
  r := pg_temp.j(o, $q$select public.ev_create_room('Rqt Other Room', '', null, null, '{}', 'ask', null)$q$);
  other := (r ->> 'id')::uuid;
  e1 := pg_temp.ev(o, 'Halloween Edition', askroom);
  e2 := pg_temp.ev(o, 'Somewhere Else', other);
  perform pg_temp.reg(e1, buyer, 'going');
  perform pg_temp.reg(e1, waiter, 'waitlisted');
  perform pg_temp.reg(e2, plain, 'going');

  -- ===================================================== the ticket rides on the request ========
  perform pg_temp.ok(pg_temp.t(buyer, format('select public.ev_join_room_for_ticket(%L, %L)', askroom, e1)) = 'requested', 'a ticket holder asks: requested');
  perform pg_temp.ok((select ticket_event_id from public.ev_room_requests where crew_id = askroom and user_id = buyer) = e1, 'the request carries the event');
  r := pg_temp.j(o, format('select public.ev_room_requests_with_tickets(%L)', askroom));
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'ticket_event_title' = 'Halloween Edition' and r -> 0 ->> 'name' = 'Rqt Buyer',
                     'the owner sees who and which event');
  perform pg_temp.ok(pg_temp.t(buyer, format('select public.ev_join_room_for_ticket(%L, %L)', askroom, e1)) = 'requested'
                     and (select count(*) from public.ev_room_requests where crew_id = askroom and user_id = buyer) = 1, 'asking twice is the same request');

  -- ===================================================== no ticket, no line ========
  perform pg_temp.ok(pg_temp.t(waiter, format('select public.ev_join_room_for_ticket(%L, %L)', askroom, e1)) = 'requested'
                     and (select ticket_event_id from public.ev_room_requests where crew_id = askroom and user_id = waiter) is null, 'waitlisted is not a ticket: a plain request');
  perform pg_temp.ok(pg_temp.t(plain, format('select public.ev_join_room_for_ticket(%L, %L)', askroom, e2)) = 'requested'
                     and (select ticket_event_id from public.ev_room_requests where crew_id = askroom and user_id = plain) is null, 'a ticket to another room''s event: a plain request');

  -- ===================================================== an older request picks it up ========
  perform pg_temp.t(later, format('select public.ev_join_room(%L)', askroom));
  perform pg_temp.reg(e1, later, 'going');
  perform pg_temp.t(later, format('select public.ev_join_room_for_ticket(%L, %L)', askroom, e1));
  perform pg_temp.ok((select ticket_event_id from public.ev_room_requests where crew_id = askroom and user_id = later) = e1, 'a request asked earlier gets the ticket now');

  -- ===================================================== open rooms and the old functions ========
  perform pg_temp.ok(pg_temp.t(buyer, format('select public.ev_join_room_for_ticket(%L, %L)', openroom, e1)) = 'joined', 'an open room joins at once, like ev_join_room');
  perform pg_temp.ok(jsonb_array_length(pg_temp.j(o, format('select public.ev_room_requests(%L)', askroom))) = 4, 'ev_room_requests still lists them all');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_room_requests_with_tickets(%L)', askroom)) is null, 'a stranger gets null');
  perform pg_temp.ok(pg_temp.j(buyer, format('select public.ev_room_requests_with_tickets(%L)', askroom)) is null, 'the asker gets null too');

  -- ===================================================== the event goes ========
  delete from public.events where id = e1;
  perform pg_temp.ok((select ticket_event_id from public.ev_room_requests where crew_id = askroom and user_id = buyer) is null
                     and exists (select 1 from public.ev_room_requests where crew_id = askroom and user_id = buyer and status = 'pending'),
                     'a deleted event leaves a plain request');

  perform pg_temp.ok(has_function_privilege('anon', 'public.ev_join_room_for_ticket(uuid, uuid)', 'execute') = false, 'anon cannot execute ev_join_room_for_ticket');
  perform pg_temp.ok(has_function_privilege('anon', 'public.ev_room_requests_with_tickets(uuid)', 'execute') = false, 'anon cannot execute ev_room_requests_with_tickets');
  raise notice 'ALL EVENTS R1 ROOM REQUEST TICKET TESTS PASSED';
end $$;
rollback;
