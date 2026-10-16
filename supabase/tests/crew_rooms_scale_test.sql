-- Crew rooms that hold a crowd (supabase/crew_rooms_scale.sql): the move rules, the room read and the triggers.
-- LOCAL ONLY: everything rolls back. Ends with ALL CREW ROOM SCALE TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/crew_rooms_scale_test.sql
-- "Only what changed since the last read" needs separate transactions, so it is checked through the API: every
-- after-mode run of scripts/load/crew-room-load.mjs compares each phone's room with the server's at the end ("view").
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
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.newuser() returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scaletest-' || u || '@roomtest.invalid',
          '{}', '{"name":"Scale tester"}', now(), now());
  update public.profiles set display_name = 'Tester ' || left(u::text, 4), avatar = '{"v":1,"skin":2}' where id = u;
  return u;
end $$;
create function pg_temp.fail_as(u uuid, q text, want text) returns void language plpgsql as $$
declare reason text;
begin
  perform pg_temp.actor(u);
  begin execute q; exception when others then reason := sqlerrm; end;
  perform pg_temp.admin();
  perform pg_temp.ok(reason like '%' || want || '%', 'rejects ' || want || coalesce(' (got: ' || reason || ')', ' (no error)'));
end $$;
-- Put a walker on a tile with a full move allowance (the test, not a Hopper, does this).
create function pg_temp.place(c uuid, u uuid, px int, py int) returns void language sql as $$
  update public.crew_room_presence set x = px, y = py, seq = 0, move_credit = 16, credit_at = clock_timestamp() - interval '10 seconds',
         last_seen = clock_timestamp() where crew_id = c and user_id = u;
$$;
create function pg_temp.mv(u uuid, c uuid, s uuid, q int, steps text) returns jsonb language plpgsql as $$
declare res jsonb;
begin
  perform pg_temp.actor(u);
  res := public.crew_room_move(c, s, q, steps::jsonb);
  perform pg_temp.admin();
  return res;
end $$;

do $$
declare
  a uuid := pg_temp.newuser(); b uuid := pg_temp.newuser(); c uuid := pg_temp.newuser();
  crew uuid := gen_random_uuid();
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  res jsonb; seen timestamptz; circle uuid; v int;
begin
  insert into public.crews (id, name, created_by) values (crew, 'Scale test crew', a);
  insert into public.crew_members (crew_id, user_id, role) values (crew, a, 'owner'), (crew, b, 'member');
  perform pg_temp.actor(a); perform public.crew_room_enter(crew, sa); perform pg_temp.admin();
  perform pg_temp.actor(b); perform public.crew_room_enter(crew, sb); perform pg_temp.admin();

  -- The grid gives the old answers (crew_rooms.sql scanned the furniture list).
  perform pg_temp.ok(public._crew_room_walkable('clubhouse', 30, 15, 15) and not public._crew_room_walkable('clubhouse', 30, 15, 10)
                     and not public._crew_room_walkable('clubhouse', 30, 0, 5) and not public._crew_room_walkable('clubhouse', 30, 29, 5),
                     'walkable tiles come from the grid: floor yes, the fountain and the outer walls no');
  perform pg_temp.ok(public._crew_room_area('clubhouse', 30, 13, 12) = 'courtyard-corner' and public._crew_room_area('clubhouse', 30, 15, 15) is null,
                     'areas come from the grid');

  -- Moves.
  perform pg_temp.place(crew, a, 15, 15);
  perform set_config('synchronous_commit', 'on', true);
  res := pg_temp.mv(a, crew, sa, 1, '[{"x":15,"y":14}]');
  perform pg_temp.ok(current_setting('synchronous_commit') = 'off', 'a move does not wait for the disk (to the end of its transaction)');
  perform pg_temp.ok(res->>'x' = '15' and res->>'y' = '14' and res->>'seq' = '1' and pg_column_size(res) < 200,
                     'a move answers with where I stand, in a few bytes');
  perform pg_temp.fail_as(a, format('select public.crew_room_move(%L,%L,2,%L)', crew, sa, '[{"x":16,"y":13}]'), 'invalid_movement');
  perform pg_temp.fail_as(a, format('select public.crew_room_move(%L,%L,2,%L)', crew, sa, '[{"x":3,"y":3}]'), 'invalid_movement');
  perform pg_temp.fail_as(a, format('select public.crew_room_move(%L,%L,2,%L)', crew, sa, '[{"x":15,"y":13},{"x":15,"y":12},{"x":15,"y":11},{"x":15,"y":10}]'), 'invalid_movement');
  perform pg_temp.ok((select x = 15 and y = 14 and seq = 1 from public.crew_room_presence where crew_id = crew and user_id = a),
                     'a refused batch moves nobody: no diagonal, no jump, no walking into the fountain');
  perform pg_temp.fail_as(a, format('select public.crew_room_move(%L,%L,5,%L)', crew, sa, '[{"x":15,"y":13}]'), 'invalid_sequence');
  res := pg_temp.mv(a, crew, sa, 1, '[{"x":15,"y":13}]');
  perform pg_temp.ok(res->>'y' = '14' and res->>'seq' = '1', 'a retried batch changes nothing');
  perform pg_temp.fail_as(a, format('select public.crew_room_move(%L,%L,2,%L)', crew, sa,
    (select jsonb_agg(jsonb_build_object('x', 15, 'y', 14 - (i % 2))) from generate_series(1, 17) i)), 'invalid_movement');
  update public.crew_room_presence set move_credit = 0, credit_at = clock_timestamp() where crew_id = crew and user_id = a;
  perform pg_temp.fail_as(a, format('select public.crew_room_move(%L,%L,2,%L)', crew, sa, '[{"x":15,"y":13},{"x":15,"y":14},{"x":15,"y":13}]'), 'moving_too_fast');
  perform pg_temp.fail_as(a, format('select public.crew_room_move(%L,%L,2,%L)', crew, gen_random_uuid(), '[{"x":15,"y":13}]'), 'room_session_replaced');
  perform pg_temp.fail_as(c, format('select public.crew_room_move(%L,%L,1,%L)', crew, gen_random_uuid(), '[]'), 'room_session_expired');

  -- A beat writes at most every 3 s.
  update public.crew_room_presence set last_seen = clock_timestamp() - interval '1 second' where crew_id = crew and user_id = a;
  select last_seen into seen from public.crew_room_presence where crew_id = crew and user_id = a;
  perform pg_temp.mv(a, crew, sa, 1, '[]');
  perform pg_temp.ok((select last_seen = seen from public.crew_room_presence where crew_id = crew and user_id = a), 'a beat right after another writes nothing');
  update public.crew_room_presence set last_seen = clock_timestamp() - interval '10 seconds' where crew_id = crew and user_id = a;
  perform pg_temp.mv(a, crew, sa, 1, '[]');
  perform pg_temp.ok((select last_seen > clock_timestamp() - interval '2 seconds' from public.crew_room_presence where crew_id = crew and user_id = a),
                     'a beat 10 s after the last one keeps the walker');
  update public.crew_room_presence set last_seen = clock_timestamp() - interval '50 seconds' where crew_id = crew and user_id = a;
  perform pg_temp.fail_as(a, format('select public.crew_room_move(%L,%L,2,%L)', crew, sa, '[]'), 'room_session_expired');

  -- Walking into an area joins its conversation; the second walker gets the same session.
  perform pg_temp.place(crew, a, 15, 15);
  res := pg_temp.mv(a, crew, sa, 1, '[{"x":15,"y":14},{"x":15,"y":13},{"x":14,"y":13},{"x":13,"y":13},{"x":13,"y":12}]');
  circle := (res->>'circle_id')::uuid;
  perform pg_temp.ok(circle is not null and (select section from public.crew_room_circles where id = circle) = 'courtyard-corner',
                     'crossing into an area joins its conversation');
  perform pg_temp.place(crew, b, 13, 13);
  res := pg_temp.mv(b, crew, sb, 1, '[{"x":12,"y":13},{"x":12,"y":12}]');
  perform pg_temp.ok((res->>'circle_id')::uuid = circle, 'a second walker in the area shares the session');
  res := pg_temp.mv(b, crew, sb, 2, '[{"x":12,"y":13}]');
  perform pg_temp.ok(res->'circle_id' = 'null'::jsonb, 'walking out leaves the conversation');

  -- Reading the room.
  perform pg_temp.actor(b); res := public.crew_room_tick(crew, null, 0); perform pg_temp.admin();
  perform pg_temp.ok((res->>'full')::boolean and (res->>'walkers')::int = 2 and jsonb_array_length(res->'ids') = 2
                     and res->'room'->>'template' = 'clubhouse' and res->'crew'->>'name' = 'Scale test crew' and res->'self'->>'x' = '12',
                     'a first read has the room, the crew, every walker and me');
  perform pg_temp.ok((select bool_and(jsonb_array_length(m) = 6 and m->>4 like 'Tester %' and m->5 ? 'skin') from jsonb_array_elements(res->'moved') m),
                     'a first read has every walker with a name and a look');
  v := (res->>'version')::int;
  perform pg_temp.actor(b); res := public.crew_room_tick(crew, (res->>'at')::bigint, v); perform pg_temp.admin();
  perform pg_temp.ok(res->'room' = 'null'::jsonb and res->'crew' = 'null'::jsonb and not (res->>'full')::boolean,
                     'a later read leaves out the room and the crew when nothing changed');
  update public.crew_room_presence set last_seen = clock_timestamp() - interval '30 seconds' where crew_id = crew and user_id = a;
  perform pg_temp.actor(b); res := public.crew_room_tick(crew, null, 0); perform pg_temp.admin();
  perform pg_temp.ok(res->'away' = jsonb_build_array(a), 'a walker with no beat for 25 s is marked away');
  update public.crew_room_presence set last_seen = clock_timestamp() where crew_id = crew and user_id = a;

  -- Blocks hide people both ways, as the old snapshot did.
  insert into public.blocks (blocker, blocked, label) values (a, b, 'test');
  perform pg_temp.actor(b); res := public.crew_room_tick(crew, null, 0); perform pg_temp.admin();
  perform pg_temp.ok((res->>'walkers')::int = 1 and res->'ids' = jsonb_build_array(b), 'someone who blocked me is not in my room read');
  perform pg_temp.actor(a); res := public.crew_room_tick(crew, null, 0); perform pg_temp.admin();
  perform pg_temp.ok(res->'ids' = jsonb_build_array(a), 'someone I blocked is not in my room read');
  perform pg_temp.actor(b); res := public.crew_room_state(crew); perform pg_temp.admin();
  perform pg_temp.ok(jsonb_array_length(res->'peers') = 1, 'the old room read hides blocked people too');
  delete from public.blocks where blocker = a and blocked = b;
  perform pg_temp.fail_as(c, format('select public.crew_room_tick(%L, null, 0)', crew), 'not_in_crew');

  -- Leaving the crew leaves the room at once.
  delete from public.crew_members where crew_id = crew and user_id = b;
  perform pg_temp.ok(not exists (select 1 from public.crew_room_presence where crew_id = crew and user_id = b), 'leaving the crew leaves the room');
  perform pg_temp.ok((select roster_xid = pg_current_xact_id() from public.crew_room_live where crew_id = crew), 'a departure marks the walker list as changed');

  -- The old step of earlier app versions keeps its rules and its full answer.
  perform pg_temp.place(crew, a, 15, 15);
  perform pg_temp.actor(a); res := public.crew_room_step(crew, sa, 1, '[{"x":15,"y":14}]'); perform pg_temp.admin();
  perform pg_temp.ok(res->'self'->>'y' = '14' and res ? 'peers' and res ? 'room', 'the old step still answers with the whole room');
  perform pg_temp.fail_as(a, format('select public.crew_room_step(%L,%L,2,%L)', crew, sa, '[{"x":16,"y":13}]'), 'invalid_movement');
  perform pg_temp.fail_as(a, format('select public.crew_room_step(%L,%L,2,%L)', crew, sa,
    (select jsonb_agg(jsonb_build_object('x', 15, 'y', 14 - (i % 2))) from generate_series(1, 9) i)), 'invalid_movement');
  raise notice 'ALL CREW ROOM SCALE TESTS PASSED';
end $$;
rollback;
