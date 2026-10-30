-- DRAFT FOR OLA, NOT RUN ANYWHERE. Release 1 leave a room (supabase/events_r1_room_leave.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, crew_stage_voice.sql, events_r1_events.sql, events_r1_registrations.sql,
-- events_r1_rooms.sql, events_r1_room_profile.sql and events_r1_room_leave.sql loaded. Ends with ALL EVENTS R1 ROOM LEAVE TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_room_leave_test.sql
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
          case when guest then null else 'leave-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
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

do $$
declare
  o uuid := pg_temp.newuser('Leave Owner'); m uuid := pg_temp.newuser('Leave Member'); a uuid := pg_temp.newuser('Leave Asker');
  x uuid := pg_temp.newuser('Leave Stranger'); g uuid := pg_temp.newuser('Leave Guest', true);
  room uuid; askroom uuid; hq uuid; r jsonb; req uuid;
begin
  r := pg_temp.j(o, $q$select public.ev_create_room('Leave Room', '', null, null, '{}', 'open', null)$q$);
  room := (r ->> 'id')::uuid;
  r := pg_temp.j(o, $q$select public.ev_create_room('Leave Ask Room', '', null, null, '{}', 'ask', null)$q$);
  askroom := (r ->> 'id')::uuid;
  perform pg_temp.t(m, format('select public.ev_join_room(%L)', room)::text);

  -- ===================================================== who may leave ========
  perform pg_temp.ok(exists (select 1 from public.crew_members where crew_id = room and user_id = m), 'the member is in the room');
  perform pg_temp.ok(pg_temp.t(m, format('select public.ev_leave_room(%L)', room)) = 'ok', 'a member leaves: ok');
  perform pg_temp.ok(not exists (select 1 from public.crew_members where crew_id = room and user_id = m), 'and is no longer a member');
  perform pg_temp.ok(pg_temp.t(m, format('select public.ev_leave_room(%L)', room)) = 'not_member', 'leaving twice: not_member');
  perform pg_temp.ok(pg_temp.t(x, format('select public.ev_leave_room(%L)', room)) = 'not_member', 'a stranger cannot leave a room they are not in: not_member');
  perform pg_temp.ok(pg_temp.t(o, format('select public.ev_leave_room(%L)', room)) = 'owner_fixed', 'the owner cannot leave: owner_fixed');
  perform pg_temp.ok(exists (select 1 from public.crew_members where crew_id = room and user_id = o and role = 'owner'), 'and is still the owner');
  perform pg_temp.ok(pg_temp.t(m, format('select public.ev_leave_room(%L)', gen_random_uuid())) = 'not_found', 'an unknown room: not_found');
  perform pg_temp.ok(pg_temp.t(g, format('select public.ev_leave_room(%L)', room)) = 'need_account', 'a guest account: need_account');

  -- ===================================================== join again ========
  perform pg_temp.ok(pg_temp.t(m, format('select public.ev_join_room(%L)', room)) is not null and exists (select 1 from public.crew_members where crew_id = room and user_id = m),
                     'a person who left can join an open room again');

  -- ===================================================== ask rooms ========
  perform pg_temp.t(a, format('select public.ev_join_room(%L)', askroom));
  select id into req from public.ev_room_requests where crew_id = askroom and user_id = a;
  perform pg_temp.ok(req is not null, 'the asker has a request');
  perform pg_temp.t(o, format('select public.ev_decide_room_request(%L, true)', req));
  perform pg_temp.ok(exists (select 1 from public.crew_members where crew_id = askroom and user_id = a), 'approved: the asker is in');
  perform pg_temp.ok(pg_temp.t(a, format('select public.ev_leave_room(%L)', askroom)) = 'ok', 'the approved member leaves the ask room: ok');
  perform pg_temp.ok(not exists (select 1 from public.ev_room_requests where crew_id = askroom and user_id = a), 'their old request row is cleared');
  perform pg_temp.t(a, format('select public.ev_join_room(%L)', askroom));
  perform pg_temp.ok((select status from public.ev_room_requests where crew_id = askroom and user_id = a) = 'pending', 'they can ask again: a new pending request');

  -- ===================================================== Lagos HQ ========
  begin hq := public.ev_ensure_hq_id(); exception when others then hq := null; end;
  if hq is not null then
    perform pg_temp.ok(pg_temp.t(m, format('select public.ev_leave_room(%L)', hq)) = 'hq_fixed', 'nobody leaves Lagos HQ: hq_fixed');
  end if;

  -- ===================================================== peek ========
  r := pg_temp.j(o, $q$select public.ev_create_room('Peek Room', 'A quiet place.', 'peek-room', null, '{}', 'invite', null)$q$);
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_room_peek(%L)', (r ->> 'id')::uuid)) ->> 'name' = 'Peek Room'
                     and pg_temp.j(x, format('select public.ev_room_peek(%L)', (r ->> 'id')::uuid)) ->> 'join_mode' = 'invite'
                     and pg_temp.j(x, format('select public.ev_room_peek(%L)', (r ->> 'id')::uuid)) ->> 'slug' = 'peek-room', 'a stranger can peek at an invite only room: its name, address and mode');
  perform pg_temp.ok(not (pg_temp.j(x, format('select public.ev_room_peek(%L)', (r ->> 'id')::uuid)) ? 'members'), 'and learns nothing about who is in it');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_room_peek(%L)', gen_random_uuid())) = 'null'::jsonb, 'an unknown room peeks as null');

  -- ===================================================== switch off and access ========
  update public.ev_settings set value = 'off' where key = 'events_r1';
  perform pg_temp.ok(pg_temp.t(m, format('select public.ev_leave_room(%L)', room)) = 'not_open', 'with the switch off: not_open');
  update public.ev_settings set value = 'on' where key = 'events_r1';
  perform pg_temp.ok(has_function_privilege('anon', 'public.ev_leave_room(uuid)', 'execute') = false, 'anon cannot execute ev_leave_room');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.ev_leave_room(uuid)', 'execute'), 'authenticated can execute ev_leave_room');
  perform pg_temp.ok(has_function_privilege('anon', 'public.ev_room_peek(uuid)', 'execute'), 'anon can execute ev_room_peek');
  raise notice 'ALL EVENTS R1 ROOM LEAVE TESTS PASSED';
end $$;
rollback;
