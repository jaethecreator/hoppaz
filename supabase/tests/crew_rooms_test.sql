-- Crew rooms (supabase/crew_rooms.sql). LOCAL ONLY: every fixture user, crew and
-- message rolls back. Ends with ALL CREW ROOM TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/crew_rooms_test.sql
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
create function pg_temp.newuser(guest boolean default false) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          case when guest then null else 'roomtest-' || u || '@roomtest.invalid' end, guest, '{}', '{"name":"Room tester"}', now(), now());
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
create function pg_temp.visible(u uuid, m uuid) returns boolean language plpgsql as $$
declare seen boolean;
begin
  perform pg_temp.actor(u);
  select exists (select 1 from public.crew_room_messages where id = m) into seen;
  perform pg_temp.admin();
  return seen;
end $$;
create function pg_temp.row_at(c uuid, u uuid) returns tid language sql as $$
  select ctid from public.crew_room_presence where crew_id = c and user_id = u;
$$;

do $$
declare
  i int;
  a uuid := pg_temp.newuser(); b uuid := pg_temp.newuser(); c uuid := pg_temp.newuser(); d uuid := pg_temp.newuser();
  g uuid := pg_temp.newuser(true);
  crew uuid := gen_random_uuid(); other_crew uuid := gen_random_uuid();
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); sc uuid := gen_random_uuid();
  res jsonb; circle uuid; general uuid; near uuid; later uuid; req uuid := gen_random_uuid(); body jsonb; before_x int;
  at_b tid; at_c tid; code text; later_code text;
begin
  insert into public.crews (id, name, created_by) values (crew, 'Room test crew', a), (other_crew, 'Different room', d);
  insert into public.crew_members (crew_id, user_id, role)
  values (crew, a, 'owner'), (crew, b, 'member'), (crew, c, 'member'), (crew, g, 'member'), (other_crew, d, 'owner');
  perform pg_temp.actor(a); res := public.crew_room_enter(crew, sa); perform pg_temp.admin();
  perform pg_temp.ok(res->'crew'->>'name' = 'Room test crew', 'crew owns a stable room');
  perform pg_temp.ok(res->'crew'->>'verified' = 'false' and res->'room'->>'capacity' = '60', 'a new room is unverified with 60 walking spots');
  perform pg_temp.actor(b); perform public.crew_room_enter(crew, sb); perform pg_temp.admin();
  perform pg_temp.actor(c); perform public.crew_room_enter(crew, sc); perform pg_temp.admin();
  perform pg_temp.fail_as(d, format('select public.crew_room_enter(%L,%L)', crew, gen_random_uuid()), 'not_in_crew');
  perform pg_temp.fail_as(g, format('select public.crew_room_enter(%L,%L)', crew, gen_random_uuid()), 'need_account');
  perform pg_temp.fail_as(d, format('select public.crew_room_state(%L)', crew), 'not_in_crew');
  perform pg_temp.fail_as(b, format('insert into public.crew_room_presence(crew_id,user_id,session_id,x,y) values(%L,%L,%L,5,5)', crew, b, gen_random_uuid()), 'permission denied');
  perform pg_temp.fail_as(b, format('select public._crew_room_snapshot(%L)', crew), 'permission denied');

  -- Verified is staff only: the owner can rename the crew, not verify it.
  perform pg_temp.fail_as(a, format('update public.crews set verified = true where id = %L', crew), 'permission denied');
  perform pg_temp.actor(a); update public.crews set name = 'Room test crew' where id = crew; perform pg_temp.admin();
  update public.crews set verified = true where id = crew;
  perform pg_temp.actor(b); res := public.crew_room_state(crew); perform pg_temp.admin();
  perform pg_temp.ok(res->'crew'->>'verified' = 'true', 'staff verification shows in the room');

  update public.crew_room_presence set x = case when user_id = a then 3 when user_id = b then 4 else 6 end,
    y = case when user_id = b then 6 else 4 end, last_moved_at = clock_timestamp() - interval '1 second', last_seen = clock_timestamp()
   where crew_id = crew;
  perform pg_temp.actor(a); res := public.crew_room_step(crew, sa, 0, '[]'); perform pg_temp.admin();
  circle := (res->'self'->>'circle_id')::uuid;
  perform pg_temp.ok(circle is not null, 'entering the same fixed area creates its conversation');
  perform pg_temp.ok((select circle_id = circle from public.crew_room_presence where crew_id = crew and user_id = b), 'members inside the same area share its audience');
  perform pg_temp.ok((select circle_id is not null and circle_id <> circle from public.crew_room_presence where crew_id = crew and user_id = c), 'an adjacent booth has a separate conversation');
  perform pg_temp.actor(a);
  general := public.crew_room_send(crew, 'general', 'General test', gen_random_uuid());
  near := public.crew_room_send(crew, 'nearby', 'Nearby test', req, circle);
  perform pg_temp.admin();
  perform pg_temp.ok(pg_temp.visible(a, near) and pg_temp.visible(b, near), 'area recipients can read their message');
  perform pg_temp.ok(not pg_temp.visible(c, near) and not pg_temp.visible(d, near), 'people outside the area and other crews cannot read it');
  perform pg_temp.ok(pg_temp.visible(c, general), 'general conversation reaches the whole crew');
  perform pg_temp.ok(not pg_temp.visible(d, general), 'general history does not cross crews');
  perform pg_temp.actor(a); later := public.crew_room_send(crew, 'nearby', 'Nearby test', req, circle); perform pg_temp.admin();
  perform pg_temp.ok(later = near, 'retrying a send does not duplicate it');
  perform pg_temp.fail_as(c, format('select public.crew_room_send(%L,%L,%L,%L,%L)', crew, 'nearby', 'Outside attempt', gen_random_uuid(), circle), 'conversation_changed');
  perform pg_temp.fail_as(a, format('select public.crew_room_send(%L,%L,%L,%L,%L)', crew, 'nearby', 'Stale circle', gen_random_uuid(), gen_random_uuid()), 'conversation_changed');

  -- A heartbeat with nothing to sweep writes only its own row.
  at_b := pg_temp.row_at(crew, b); at_c := pg_temp.row_at(crew, c);
  perform pg_temp.actor(a); perform public.crew_room_step(crew, sa, 0, '[]'); perform pg_temp.admin();
  perform pg_temp.ok(pg_temp.row_at(crew, b) = at_b and pg_temp.row_at(crew, c) = at_c, 'a quiet heartbeat leaves other walkers untouched');
  -- A sweep with nothing changed writes nothing.
  perform public._crew_room_reconcile(crew);
  perform pg_temp.ok(pg_temp.row_at(crew, b) = at_b and pg_temp.row_at(crew, c) = at_c, 'a sweep updates only walkers whose area changed');

  -- Entering later must not reveal earlier area history.
  update public.crew_room_presence set x = 4, y = 4, last_moved_at = clock_timestamp() - interval '1 second' where crew_id = crew and user_id = c;
  perform pg_temp.actor(c); perform public.crew_room_step(crew, sc, 0, '[]'); perform pg_temp.admin();
  perform pg_temp.ok((select circle_id = circle from public.crew_room_presence where crew_id = crew and user_id = c), 'a new arrival joins the area conversation');
  perform pg_temp.ok(pg_temp.row_at(crew, b) = at_b, 'someone walking into an area leaves the people already there untouched');
  perform pg_temp.ok(not pg_temp.visible(c, near), 'a new arrival cannot read messages sent before they came');
  perform pg_temp.actor(b); later := public.crew_room_send(crew, 'nearby', 'After arrival', gen_random_uuid(), circle); perform pg_temp.admin();
  perform pg_temp.ok(pg_temp.visible(c, later), 'a new arrival receives new area messages');
  update public.crew_room_presence set x = 6, y = 4, last_moved_at = clock_timestamp() - interval '1 second' where crew_id = crew and user_id = c;
  perform pg_temp.actor(c); perform public.crew_room_step(crew, sc, 0, '[]'); perform pg_temp.admin();
  perform pg_temp.actor(b); later := public.crew_room_send(crew, 'nearby', 'After leaving', gen_random_uuid(), circle); perform pg_temp.admin();
  perform pg_temp.ok(not pg_temp.visible(c, later), 'walking away stops new area messages');

  -- Blocks hide people and messages without moving the shared area boundary.
  insert into public.blocks (blocker, blocked, label) values (a, b, 'Test member');
  perform public._crew_room_reconcile(crew);
  perform pg_temp.actor(a); later := public.crew_room_send(crew, 'nearby', 'Blocked audience test', gen_random_uuid(), circle); perform pg_temp.admin();
  perform pg_temp.ok(not exists (select 1 from public.crew_room_message_audience where message_id = later and user_id = b), 'blocked members are left out of new message audiences');
  perform pg_temp.ok(not pg_temp.visible(b, near), 'blocked authors no longer expose message history');
  perform pg_temp.actor(a); res := public.crew_room_state(crew); perform pg_temp.admin();
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(res->'peers') p where p->>'id' = b::text), 'blocked peers are hidden in room snapshots');
  perform pg_temp.actor(a); select count(*) into before_x from public.crew_room_presence where crew_id = crew and user_id = b; perform pg_temp.admin();
  perform pg_temp.ok(before_x = 0, 'presence reads also respect blocks');
  delete from public.blocks where blocker = a and blocked = b;

  -- Adjacent areas stay separate even when avatars stand one tile apart.
  update public.crew_room_presence set circle_id = null, x = case when user_id = a then 4 else 5 end, y = 4,
    last_moved_at = clock_timestamp() - interval '1 second' where crew_id = crew and user_id in (a, b);
  perform public._crew_room_reconcile(crew);
  perform pg_temp.ok((select count(distinct circle_id) = 2 from public.crew_room_presence where crew_id = crew and user_id in (a, b)), 'adjacent booths do not share a conversation');

  -- Occupants can roam inside a large area regardless of distance.
  update public.crew_room_presence set x = case when user_id = a then 3 else 6 end, y = case when user_id = a then 13 else 17 end,
    last_seen = clock_timestamp() where crew_id = crew and user_id in (a, b);
  perform public._crew_room_reconcile(crew);
  select circle_id into circle from public.crew_room_presence where crew_id = crew and user_id = a;
  perform pg_temp.ok((select circle_id = circle from public.crew_room_presence where crew_id = crew and user_id = b), 'people far apart in one area still share its conversation');
  update public.crew_room_presence set x = 5, y = 16 where crew_id = crew and user_id = a;
  perform public._crew_room_reconcile(crew);
  perform pg_temp.ok((select circle_id = circle from public.crew_room_presence where crew_id = crew and user_id = a), 'walking inside an area keeps its conversation');
  update public.crew_room_presence set x = 15, y = 12 where crew_id = crew and user_id = a;
  perform public._crew_room_reconcile(crew);
  perform pg_temp.ok((select circle_id = circle from public.crew_room_presence where crew_id = crew and user_id = b), 'one person remaining keeps an area conversation open');
  update public.crew_room_presence set x = 16, y = 12 where crew_id = crew and user_id = b;
  perform public._crew_room_reconcile(crew);
  perform pg_temp.ok((select count(*) = 0 from public.crew_room_presence where crew_id = crew and user_id in (a, b) and circle_id is not null), 'neighbours in public space do not form moving groups');
  perform pg_temp.ok(not exists (select 1 from public.crew_room_circles where id = circle), 'an empty area ends its conversation session');

  update public.crew_room_presence set x = 15, y = 12, seq = 0, move_credit = 3, credit_at = clock_timestamp(), last_seen = clock_timestamp()
   where crew_id = crew and user_id = a;
  perform pg_temp.fail_as(a, format('select public.crew_room_step(%L,%L,1,%L)', crew, sa, '[{"x":24,"y":14}]'), 'invalid_movement');
  perform pg_temp.fail_as(a, format('select public.crew_room_step(%L,%L,2,%L)', crew, sa, '[{"x":15,"y":11}]'), 'invalid_sequence');
  perform pg_temp.fail_as(a, format('select public.crew_room_step(%L,%L,1,%L)', crew, sa, '[{"x":15,"y":11},{"x":15,"y":10}]'), 'invalid_movement');
  perform pg_temp.ok((select x = 15 and y = 12 from public.crew_room_presence where crew_id = crew and user_id = a), 'failed movement leaves the server position unchanged');
  perform pg_temp.actor(a); res := public.crew_room_step(crew, sa, 1, '[{"x":16,"y":12},{"x":17,"y":12},{"x":17,"y":13}]'); perform pg_temp.admin();
  perform pg_temp.ok(res->'self'->>'x' = '17' and res->'self'->>'y' = '13', 'ordered walkable steps are accepted');
  perform pg_temp.actor(a); res := public.crew_room_step(crew, sa, 1, '[{"x":18,"y":13}]'); perform pg_temp.admin();
  perform pg_temp.ok(res->'self'->>'x' = '17', 'a repeated movement batch is idempotent');
  perform pg_temp.fail_as(a, format('select public.crew_room_step(%L,%L,2,%L)', crew, sa, '[{"x":18,"y":13},{"x":19,"y":13},{"x":19,"y":14}]'), 'moving_too_fast');
  perform pg_temp.fail_as(a, format('select public.crew_room_step(%L,%L,2,%L)', crew, gen_random_uuid(), '[]'), 'room_session_replaced');

  select content into body from public.crew_rooms where crew_id = crew;
  perform pg_temp.fail_as(b, format('select public.crew_room_settings(%L,36,%L)', crew, body), 'owner_only');
  perform pg_temp.fail_as(a, format('select public.crew_room_settings(%L,30,%L)', crew, body || '{"musicUrl":"javascript:alert(1)"}'::jsonb), 'invalid_link');
  perform pg_temp.actor(a); res := public.crew_room_settings(crew, 36, body); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'width' = '36', 'owner settings are shared by the crew');
  perform pg_temp.ok((select count(*) = 3 from public.crew_room_presence where crew_id = crew and x = 18 and y = 17 and seq = 0), 'a width change safely repositions every walker');

  -- A phone screen lock: 30 s without a heartbeat keeps the walker; 45 s does not.
  update public.crew_room_presence set last_seen = clock_timestamp() - interval '30 seconds' where crew_id = crew and user_id = c;
  perform pg_temp.actor(a); res := public.crew_room_step(crew, sa, 0, '[]'); perform pg_temp.admin();
  perform pg_temp.ok(jsonb_array_length(res->'peers') = 3, 'a walker 30 s quiet is still in the room');
  perform pg_temp.actor(c); res := public.crew_room_step(crew, sc, 0, '[]'); perform pg_temp.admin();
  perform pg_temp.ok(res->'self'->>'session_id' = sc::text, 'their next heartbeat carries on in the same session');
  update public.crew_room_presence set last_seen = clock_timestamp() - interval '1 minute' where crew_id = crew and user_id = c;
  perform pg_temp.actor(a); res := public.crew_room_step(crew, sa, 0, '[]'); perform pg_temp.admin();
  perform pg_temp.ok(jsonb_array_length(res->'peers') = 2, 'disconnected avatars expire');
  perform pg_temp.fail_as(c, format('select public.crew_room_step(%L,%L,0,%L)', crew, sc, '[]'), 'room_session_expired');
  perform pg_temp.actor(c); res := public.crew_room_enter(crew, sc); perform pg_temp.admin();
  perform pg_temp.ok(res->'self' is not null and res->>'took_over' = 'false', 'an expired walker enters again cleanly');

  -- A second tab takes over, and the first is told.
  perform pg_temp.actor(b); res := public.crew_room_enter(crew, gen_random_uuid()); perform pg_temp.admin();
  perform pg_temp.ok(res->>'took_over' = 'true', 'a second tab knows it took over');
  perform pg_temp.fail_as(b, format('select public.crew_room_step(%L,%L,0,%L)', crew, sb, '[]'), 'room_session_replaced');
  perform pg_temp.ok((select count(*) = 1 from public.crew_room_presence where crew_id = crew and user_id = b), 'one walker per Hopper');

  -- A full room lets members watch: no walker, General chat only.
  update public.crew_rooms set capacity = 2 where crew_id = crew;
  delete from public.crew_room_presence where crew_id = crew and user_id = c;
  perform pg_temp.actor(c); res := public.crew_room_enter(crew, sc); perform pg_temp.admin();
  perform pg_temp.ok(res->>'watching' = 'true' and res->'self' = 'null'::jsonb, 'past the cap a member enters to watch');
  perform pg_temp.ok(jsonb_array_length(res->'peers') = 2, 'a watcher sees the walkers live');
  perform pg_temp.ok((select count(*) = 2 from public.crew_room_presence where crew_id = crew), 'the server keeps the cap');
  perform pg_temp.actor(c); later := public.crew_room_send(crew, 'general', 'Watching from the door', gen_random_uuid()); perform pg_temp.admin();
  perform pg_temp.ok(pg_temp.visible(a, later), 'a watcher can send General');
  perform pg_temp.fail_as(c, format('select public.crew_room_send(%L,%L,%L,%L,%L)', crew, 'nearby', 'Watcher area attempt', gen_random_uuid(), gen_random_uuid()), 'conversation_changed');
  perform pg_temp.fail_as(c, format('select public.crew_room_step(%L,%L,1,%L)', crew, sc, '[{"x":18,"y":16}]'), 'room_session_expired');
  perform pg_temp.actor(a); perform public.crew_room_leave(crew, sa); perform pg_temp.admin();
  perform pg_temp.actor(c); res := public.crew_room_enter(crew, sc); perform pg_temp.admin();
  perform pg_temp.ok(res->'self' is not null and res->>'watching' is null, 'a watcher walks in when a spot opens');
  update public.crew_rooms set capacity = 60 where crew_id = crew;

  perform pg_temp.actor(c); perform public.crew_room_leave(crew, sc); perform pg_temp.admin();
  perform pg_temp.ok((select count(*) = 1 from public.crew_room_presence where crew_id = crew), 'leaving removes only that room session');
  delete from public.crew_members where crew_id = crew and user_id = b;
  perform pg_temp.ok(not pg_temp.visible(b, general), 'revoked crew membership loses General access');
  perform pg_temp.ok(not pg_temp.visible(b, near), 'revoked crew membership loses area history');

  -- The crew hub and invite links.
  select invite_code into code from public.crews where id = crew;
  perform pg_temp.actor(d); res := public.crew_card(crew, null); perform pg_temp.admin();
  perform pg_temp.ok(res is null, 'a private crew card is hidden from outsiders without the code');
  perform pg_temp.actor(d); res := public.crew_card(null, lower(code)); perform pg_temp.admin();
  perform pg_temp.ok(res->>'name' = 'Room test crew' and (res->>'members')::int = 3 and res->>'is_member' = 'false',
    'the invite code shows the crew, its members and that you are not in it');
  perform pg_temp.ok((res->>'in_room')::int = 1 and jsonb_array_length(res->'heads') = 1, 'the invite shows who is in the room now');
  perform pg_temp.ok(res->'invite_code' = 'null'::jsonb and res->'recent' = '[]'::jsonb, 'outsiders get neither the code nor the chat');
  perform pg_temp.actor(a); res := public.crew_card(crew, null); perform pg_temp.admin();
  perform pg_temp.ok(res->>'is_owner' = 'true' and res->>'invite_code' = code and jsonb_array_length(res->'recent') = 2, 'the owner sees the code and recent General chat');
  perform pg_temp.fail_as(g, format('select public.crew_join_code(%L)', code), 'need_account');
  perform pg_temp.actor(d); res := public.crew_join_code('NOPE000000'); perform pg_temp.admin();
  perform pg_temp.ok(res->>'ok' = 'false' and res->>'reason' = 'invalid_code', 'a wrong code is turned down');
  perform pg_temp.actor(d); res := public.crew_join_code(' ' || lower(code) || ' '); perform pg_temp.admin();
  perform pg_temp.ok(res->>'crew_id' = crew::text and res->>'joined' = 'true', 'a valid code joins the crew');
  perform pg_temp.actor(d); res := public.crew_join_code(code); perform pg_temp.admin();
  perform pg_temp.ok(res->>'joined' = 'false' and (select count(*) = 1 from public.crew_members where crew_id = crew and user_id = d), 'joining twice adds the membership once');
  perform pg_temp.fail_as(c, format('select public.crew_invite_reset(%L)', crew), 'owner_only');
  perform pg_temp.actor(a); later_code := public.crew_invite_reset(crew); perform pg_temp.admin();
  perform pg_temp.ok(later_code is not null and later_code <> code, 'the owner makes a new invite code');
  perform pg_temp.actor(g); res := public.crew_card(null, code); perform pg_temp.admin();
  perform pg_temp.ok(res is null, 'the old link stops working');
  for i in 1..7 loop
    perform pg_temp.actor(d); perform public.crew_join_code('WRONG' || i); perform pg_temp.admin();
  end loop;
  perform pg_temp.fail_as(d, format('select public.crew_join_code(%L)', later_code), 'slow_down');
  raise notice 'ALL CREW ROOM TESTS PASSED';
end $$;
rollback;
