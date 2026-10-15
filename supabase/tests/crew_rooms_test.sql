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
  base text; ev uuid; failed text; seen int;
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
  perform pg_temp.ok(res->'room'->>'template' = 'clubhouse' and res->'crew'->>'owner_id' = a::text and res->'crew' ? 'logo_url'
    and res->'room'->'featured_event_id' = 'null'::jsonb and res->'room'->>'featured_ribbon' = '',
    'the room snapshot carries its template, the owner, the logo and no featured event');

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

  -- ----------------------------------------------------------- the look of a crew ---
  base := '/storage/v1/object/public/crew-images/' || crew || '/';
  perform pg_temp.fail_as(c, format('select public.crew_update_look(%L,%L,%L)', crew, '/brands/360playlist.jpg', '{}'::text[]), 'owner_only');
  perform pg_temp.fail_as(d, format('select public.crew_update_look(%L,null,%L)', crew, '{}'::text[]), 'owner_only');
  perform pg_temp.fail_as(g, format('select public.crew_update_look(%L,null,%L)', crew, '{}'::text[]), 'need_account');
  perform pg_temp.fail_as(a, format('select public.crew_update_look(%L,null,%L)', crew, array[base||'1.jpg',base||'2.jpg',base||'3.jpg',base||'4.jpg',base||'5.jpg',base||'6.jpg']), 'too_many_images');
  perform pg_temp.fail_as(a, format('select public.crew_update_look(%L,null,%L)', crew, array['/storage/v1/object/public/crew-images/' || other_crew || '/x.jpg']), 'invalid_image');
  -- Only a path: a link to any host, ours included, is refused (a crew owner cannot point a logo at a server of their own).
  perform pg_temp.fail_as(a, format('select public.crew_update_look(%L,%L,%L)', crew, 'https://evil.example' || base || 'x.jpg', '{}'::text[]), 'invalid_image');
  perform pg_temp.fail_as(a, format('select public.crew_update_look(%L,null,%L)', crew, array['http://127.0.0.1:54321' || base || 'x.jpg']), 'invalid_image');
  perform pg_temp.fail_as(a, format('select public.crew_update_look(%L,null,%L)', crew, array['javascript:alert(1)']), 'invalid_image');
  perform pg_temp.fail_as(a, format('select public.crew_update_look(%L,%L,%L)', crew, base||'logo.gif', '{}'::text[]), 'invalid_image');
  perform pg_temp.fail_as(a, format('select public.crew_update_look(%L,%L,%L)', crew, base||'sub/logo.jpg', '{}'::text[]), 'invalid_image');
  perform pg_temp.fail_as(a, format('select public.crew_update_look(%L,%L,%L)', crew, '/brands/../etc/x.jpg', '{}'::text[]), 'invalid_image');
  perform pg_temp.fail_as(a, format('select public.crew_update_look(%L,null,%L)', crew, array[null]::text[]), 'invalid_image');
  perform pg_temp.actor(a);
  res := public.crew_update_look(crew, '/brands/360playlist.jpg', array[base||'one.jpg', base||'two.png', '/brands/360playlist.jpg']);
  perform pg_temp.admin();
  perform pg_temp.ok(res->>'logo_url' = '/brands/360playlist.jpg' and jsonb_array_length(res->'header_images') = 3
    and res->'header_images'->>0 = base||'one.jpg' and res->'header_images'->>1 = base||'two.png', 'the owner sets a logo and header pictures, in order');
  perform pg_temp.actor(c); res := public.crew_card(crew, null); perform pg_temp.admin();
  perform pg_temp.ok(jsonb_array_length(res->'header_images') = 3 and res->>'logo_url' = '/brands/360playlist.jpg' and res->>'template' = 'clubhouse',
    'members see the look and the template on the crew card');
  perform pg_temp.actor(c); res := public.crew_room_state(crew); perform pg_temp.admin();
  perform pg_temp.ok(res->'crew'->>'logo_url' = '/brands/360playlist.jpg', 'the room snapshot carries the logo');
  perform pg_temp.actor(a); res := public.crew_update_look(crew, '', '{}'::text[]); perform pg_temp.admin();
  perform pg_temp.ok(res->'logo_url' = 'null'::jsonb and res->'header_images' = '[]'::jsonb, 'the owner clears the look');
  perform pg_temp.fail_as(a, format('update public.crews set logo_url = %L where id = %L', base||'x.jpg', crew), 'permission denied');
  begin
    update public.crews set logo_url = 'https://evil.example/logo.jpg' where id = crew;
    failed := null;
  exception when check_violation then failed := sqlerrm; end;
  perform pg_temp.ok(failed like '%crews_look_valid%', 'the table itself refuses a picture that is not ours (' || coalesce(failed, 'no error') || ')');
  begin
    update public.crews set header_images = array[base||'1.jpg',base||'2.jpg',base||'3.jpg',base||'4.jpg',base||'5.jpg',base||'6.jpg'] where id = crew;
    failed := null;
  exception when check_violation then failed := sqlerrm; end;
  perform pg_temp.ok(failed like '%crews_look_valid%', 'the table itself refuses a sixth header picture');

  -- ------------------------------------------------------------ the crew pictures bucket ---
  perform pg_temp.ok((select public and file_size_limit = 2097152 and allowed_mime_types @> array['image/jpeg','image/png','image/webp'] and cardinality(allowed_mime_types) = 3
                        from storage.buckets where id = 'crew-images'), 'crew-images is public, 2 MB, images only');
  perform pg_temp.actor(a);
  insert into storage.objects (bucket_id, name) values ('crew-images', crew || '/one.jpg'), ('crew-images', crew || '/logo.png');
  perform pg_temp.admin();
  perform pg_temp.ok((select count(*) = 2 from storage.objects where bucket_id = 'crew-images' and name like crew::text || '/%'), 'the owner uploads under the crew folder');
  perform pg_temp.fail_as(c, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', crew || '/member.jpg'), 'row-level security');
  perform pg_temp.fail_as(d, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', crew || '/other.jpg'), 'row-level security');
  perform pg_temp.fail_as(g, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', crew || '/guest.jpg'), 'row-level security');
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', other_crew || '/mine.jpg'), 'row-level security');
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', crew || '/deeper/x.jpg'), 'row-level security');
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', crew || '/x.gif'), 'row-level security');
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', 'x.jpg'), 'row-level security');
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', 'not-a-uuid/x.jpg'), 'row-level security');
  perform pg_temp.actor(c); select count(*) into seen from storage.objects where bucket_id = 'crew-images' and name like crew::text || '/%'; perform pg_temp.admin();
  perform pg_temp.ok(seen = 0, 'members cannot list the owner''s folder (the public link is how pictures are read)');
  -- The Storage API sets this flag for its own deletes; the row policies still decide which rows go.
  perform set_config('storage.allow_delete_query', 'true', true);
  perform pg_temp.actor(c); delete from storage.objects where bucket_id = 'crew-images' and name = crew || '/one.jpg'; perform pg_temp.admin();
  perform pg_temp.ok(exists (select 1 from storage.objects where bucket_id = 'crew-images' and name = crew || '/one.jpg'), 'a member cannot remove a picture');
  perform pg_temp.actor(a); delete from storage.objects where bucket_id = 'crew-images' and name = crew || '/one.jpg'; perform pg_temp.admin();
  perform pg_temp.ok(not exists (select 1 from storage.objects where bucket_id = 'crew-images' and name = crew || '/one.jpg'), 'the owner removes a picture');

  -- ------------------------------------------------------------- the room template ---
  perform pg_temp.fail_as(c, format('select public.crew_room_set_template(%L,%L)', crew, 'clubhouse'), 'owner_only');
  perform pg_temp.fail_as(a, format('select public.crew_room_set_template(%L,%L)', crew, 'lounge'), 'invalid_template');
  perform pg_temp.fail_as(a, format('select public.crew_room_set_template(%L,null)', crew), 'invalid_template');
  perform pg_temp.actor(a); res := public.crew_room_set_template(crew, 'clubhouse'); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'clubhouse', 'choosing the template you have changes nothing');
  perform pg_temp.ok(not exists (select 1 from public.crew_room_layouts where template = 'test-lounge'), 'the test starts without a second template');
  insert into public.crew_room_layouts (template, width, data)
  select 'test-lounge', width, jsonb_set(data, '{spawn}', '{"x":16,"y":17}') from public.crew_room_layouts where template = 'clubhouse';
  perform pg_temp.actor(a); perform public.crew_room_enter(crew, sa); perform pg_temp.admin();
  perform pg_temp.ok(exists (select 1 from public.crew_room_presence where crew_id = crew), 'someone is walking when the template changes');
  -- Not while a Game Time is scheduled or live.
  create or replace function public._crew_room_hunt_busy(p_crew uuid) returns boolean language sql as 'select true';
  perform pg_temp.fail_as(a, format('select public.crew_room_set_template(%L,%L)', crew, 'test-lounge'), 'hunt_in_progress');
  perform pg_temp.fail_as(a, format('select public.crew_room_settings(%L,30,%L)', crew, (select content from public.crew_rooms where crew_id = crew)), 'hunt_in_progress');
  perform pg_temp.ok((select template = 'clubhouse' and width = 36 from public.crew_rooms where crew_id = crew), 'a refused change leaves the room as it was');
  perform pg_temp.actor(a); res := public.crew_room_set_template(crew, 'clubhouse'); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'clubhouse', 'a hunt does not block choosing the template you already have');
  create or replace function public._crew_room_hunt_busy(p_crew uuid) returns boolean language sql as 'select false';
  perform pg_temp.actor(a); res := public.crew_room_set_template(crew, 'test-lounge'); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'test-lounge' and (res->'room'->>'version')::int > 1, 'the owner picks another template');
  perform pg_temp.ok((select count(*) > 0 and bool_and(x = 16 and y = 17 and seq = 0) from public.crew_room_presence where crew_id = crew),
    'a template change walks everyone back to the new entrance');
  perform pg_temp.ok(not exists (select 1 from public.crew_room_circles where crew_id = crew), 'area sessions end with the old layout');
  perform pg_temp.ok(public._crew_room_walkable('test-lounge', 36, 16, 17) and not public._crew_room_walkable('test-lounge', 36, 0, 0), 'the walkable grid is read from the room''s own template');
  perform pg_temp.actor(c); res := public.crew_card(crew, null); perform pg_temp.admin();
  perform pg_temp.ok(res->>'template' = 'test-lounge', 'the crew card names the template');
  perform pg_temp.fail_as(a, format('update public.crew_rooms set template = %L where crew_id = %L', 'clubhouse', crew), 'permission denied');
  perform pg_temp.actor(a); res := public.crew_room_set_template(crew, 'clubhouse'); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'clubhouse', 'the owner picks the clubhouse again');
  delete from public.crew_room_layouts where template = 'test-lounge';
  begin
    update public.crew_rooms set template = 'nope' where crew_id = crew;
    failed := null;
  exception when foreign_key_violation then failed := sqlerrm; end;
  perform pg_temp.ok(failed like '%crew_rooms_layout_fkey%', 'a room can only point at a template that exists');

  -- --------------------------------------------------------------- the featured event ---
  select id into ev from public.events where status = 'live' limit 1;
  if ev is not null then
    perform pg_temp.fail_as(c, format('select public.crew_room_set_featured(%L,%L,%L)', crew, ev, 'FREE'), 'owner_only');
    perform pg_temp.fail_as(a, format('select public.crew_room_set_featured(%L,%L,%L)', crew, gen_random_uuid(), 'FREE'), 'invalid_event');
    perform pg_temp.fail_as(a, format('select public.crew_room_set_featured(%L,%L,%L)', crew, ev, 'THIS RIBBON IS FAR TOO LONG'), 'invalid_ribbon');
    perform pg_temp.fail_as(a, format('select public.crew_room_set_featured(%L,%L,%L)', crew, ev, E'FR\nEE'), 'invalid_ribbon');
    perform pg_temp.actor(a); res := public.crew_room_set_featured(crew, ev, '  FREE '); perform pg_temp.admin();
    perform pg_temp.ok(res->'room'->>'featured_event_id' = ev::text and res->'room'->>'featured_ribbon' = 'FREE', 'the owner features an event with the ribbon they typed');
    perform pg_temp.actor(c); res := public.crew_room_state(crew); perform pg_temp.admin();
    perform pg_temp.ok(res->'room'->>'featured_event_id' = ev::text and res->'room'->>'featured_ribbon' = 'FREE', 'the whole crew sees the featured event');
    perform pg_temp.actor(c); res := public.crew_card(crew, null); perform pg_temp.admin();
    perform pg_temp.ok(res->>'featured_event_id' = ev::text, 'members see it on the crew card');
    perform pg_temp.actor(d); res := public.crew_card(null, (select invite_code from public.crews where id = crew)); perform pg_temp.admin();
    perform pg_temp.ok(res->'featured_event_id' is not null, 'the card of a crew you joined shows it too');
    perform pg_temp.actor(g); res := public.crew_card(null, later_code); perform pg_temp.admin();
    perform pg_temp.ok(res->'featured_event'->>'id' = ev::text and res->>'featured_ribbon' = 'FREE' and res->'featured_event' ? 'title',
      'anyone with the invite sees the featured event and its ribbon on the card');
    update public.events set status = 'pending' where id = ev;
    perform pg_temp.actor(a); res := public.crew_card(crew, null); perform pg_temp.admin();
    perform pg_temp.ok(res->'featured_event' = 'null'::jsonb and res->>'featured_ribbon' = '', 'an event that is no longer live is not shown');
    perform pg_temp.fail_as(a, format('select public.crew_room_set_featured(%L,%L,%L)', crew, ev, 'FREE'), 'invalid_event');
    update public.events set status = 'live' where id = ev;
    perform pg_temp.actor(a); res := public.crew_room_set_featured(crew, null, 'FREE'); perform pg_temp.admin();
    perform pg_temp.ok(res->'room'->'featured_event_id' = 'null'::jsonb and res->'room'->>'featured_ribbon' = '', 'clearing the event clears its ribbon');
    perform pg_temp.actor(a); res := public.crew_room_set_featured(crew, ev, ''); perform pg_temp.admin();
    perform pg_temp.ok(res->'room'->>'featured_ribbon' = '', 'no ribbon is no ribbon: nothing is free unless the owner says so');
  end if;

  raise notice 'ALL CREW ROOM TESTS PASSED';
end $$;

-- ------------------------------------------------------------ the launch night: a crowd, the door, the card, the names ---
do $$
declare
  i int;
  boss uuid := pg_temp.newuser(); outsider uuid := pg_temp.newuser();
  crew2 uuid := gen_random_uuid(); fresh uuid; res jsonb; who uuid;
  users uuid[] := '{}';
  tiles int; near_door int; at_spawn int; far int;
begin
  -- 40 members walk in, one after another, the way a crowd arrives at the door of the 360Playlist room.
  insert into public.crews (id, name, created_by, visibility) values (crew2, 'Crowd test crew', boss, 'open');
  insert into public.crew_members (crew_id, user_id, role) values (crew2, boss, 'owner');
  for i in 1..40 loop
    who := pg_temp.newuser();
    users := users || who;
    insert into public.crew_members (crew_id, user_id, role) values (crew2, who, 'member');
  end loop;
  insert into public.crew_rooms (crew_id, capacity) values (crew2, 90);
  foreach who in array users loop
    perform pg_temp.actor(who); perform public.crew_room_enter(crew2, gen_random_uuid()); perform pg_temp.admin();
  end loop;
  select count(distinct (x, y)), count(*) filter (where x = 15 and y = 17) into tiles, at_spawn from public.crew_room_presence where crew_id = crew2;
  perform pg_temp.ok(tiles = 40, 'forty arrivals stand on forty different tiles (no pile on the spawn tile): ' || tiles);
  -- The door is at (13,16) 2 wide, 1 tall. Standing against it is one tile away or less.
  select count(*) into near_door from public.crew_room_presence
   where crew_id = crew2
     and greatest(13 - x, 0, x - 14) + greatest(16 - y, 0, y - 16) <= 1;
  perform pg_temp.ok(near_door = 0, 'nobody arrives touching the exit door, so the pill is never the first thing a Hopper sees: ' || near_door);
  select max(abs(x - 15) + abs(y - 17)) into far from public.crew_room_presence where crew_id = crew2;
  perform pg_temp.ok(far <= 8, 'a crowd of forty still lands around the entrance: ' || far);

  -- The crew card: faces for anyone, names and user ids only for the crew's members.
  perform pg_temp.actor(outsider); res := public.crew_card(crew2, null); perform pg_temp.admin();
  perform pg_temp.ok(jsonb_array_length(res->'heads') = 8 and (res->'heads'->0->>'name') = '' and (res->'heads'->0->>'id') like 'head-%'
    and not exists (select 1 from jsonb_array_elements(res->'heads') h where h->>'id' = any (select u::text from unnest(users) u)),
    'an outsider sees faces, not names or user ids');
  perform pg_temp.actor(users[1]); res := public.crew_card(crew2, null); perform pg_temp.admin();
  perform pg_temp.ok((res->'heads'->0->>'name') <> '' and exists (select 1 from jsonb_array_elements(res->'heads') h where h->>'id' = any (select u::text from unnest(users) u)),
    'a member sees names and ids of the faces in the room');
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.ok(jsonb_array_length(public.crew_card(crew2, null)->'heads') = 8 and (public.crew_card(crew2, null)->'heads'->0->>'name') = '',
    'the public key sees the same: faces without names');

  -- Names: nobody else can take the brand's name or a look-alike of it.
  perform pg_temp.fail_as(outsider, 'select public.create_crew(''360Playlist'', ''open'')', 'reserved_name');
  perform pg_temp.fail_as(outsider, 'select public.create_crew(''360 Play List'', ''open'')', 'reserved_name');
  perform pg_temp.fail_as(outsider, 'select public.create_crew(''3-6-0 PLAYLIST fans'', ''open'')', 'reserved_name');
  perform pg_temp.fail_as(boss, format('update public.crews set name = %L where id = %L', '360 playlist', crew2), 'reserved_name');
  perform pg_temp.actor(outsider); fresh := public.create_crew('Lekki Runners', 'open'); perform pg_temp.admin();
  perform pg_temp.ok(fresh is not null, 'an ordinary crew name is fine');
  perform set_config('request.jwt.claims', '', true);
  insert into public.crews (name, created_by, visibility, verified) values ('360Playlist', boss, 'open', true) returning id into fresh;
  perform pg_temp.ok(fresh is not null, 'staff (no app session) can make the real 360Playlist crew');
  perform pg_temp.actor(boss); update public.crews set name = '360Playlist' where id = fresh; perform pg_temp.admin();
  perform pg_temp.ok(true, 'the verified crew can be renamed by its owner without tripping the guard');

  -- Explore lists an open crew once it is verified or has people in it. A brand new empty one stays out of sight.
  perform set_config('request.jwt.claims', '', true);
  update public.crews set verified = false where id = fresh;
  delete from public.crews where id = fresh;
  insert into public.crews (id, name, created_by, visibility) values (gen_random_uuid(), 'Empty open crew', outsider, 'open') returning id into fresh;
  insert into public.crew_members (crew_id, user_id, role) values (fresh, outsider, 'owner');
  perform pg_temp.actor(users[1]); res := public.room_rails(crew2); perform pg_temp.admin();
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(res->'crews') c where c->>'id' = fresh::text), 'Explore leaves out a new open crew with one member');
  update public.crews set verified = true where id = fresh;
  perform pg_temp.actor(users[1]); res := public.room_rails(crew2); perform pg_temp.admin();
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(res->'crews') c where c->>'id' = fresh::text), 'Explore lists it once it is verified');
  update public.crews set verified = false where id = fresh;
  for i in 1..4 loop
    insert into public.crew_members (crew_id, user_id) values (fresh, pg_temp.newuser());
  end loop;
  perform pg_temp.actor(users[1]); res := public.room_rails(crew2); perform pg_temp.admin();
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(res->'crews') c where c->>'id' = fresh::text), 'Explore lists an unverified crew with five members');

  raise notice 'ALL LAUNCH NIGHT TESTS PASSED';
end $$;
rollback;
