-- The Lagos HQ room template (supabase/lagos_hq_template.sql).
-- LOCAL ONLY: every fixture user, crew and room rolls back. Ends with ALL LAGOS HQ TEMPLATE TESTS PASSED.
-- Needs, loaded in this order: crew_rooms.sql, crew_rails.sql, crew_reactions.sql, game_time.sql, crew_rooms_scale.sql,
-- lagos_hq_template.sql (run it twice if you like). Run it in a throwaway database, never in production:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway db> -v ON_ERROR_STOP=1 < supabase/tests/lagos_hq_template_test.sql
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
create function pg_temp.newuser(mail text default null) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', coalesce(mail, 'lhqtest-' || u || '@roomtest.invalid'),
          '{}', '{"name":"Room tester"}', now(), now());
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

-- ---------------------------------------------------------------------------------------------- the layouts ---
do $$
declare
  w int; l record; z jsonb; sx int; sy int; walkable int; reached int; hit boolean; all_ok boolean;
begin
  for w in select unnest(array[30, 36]) loop
    select * into l from public.crew_room_layouts where template = 'lagos-hq' and width = w;
    perform pg_temp.ok(l.template is not null, format('the lagos-hq layout exists at width %s', w));
    sx := (l.data->'spawn'->>'x')::int; sy := (l.data->'spawn'->>'y')::int;
    perform pg_temp.ok((l.data->'grid'->>'width')::int = w and (l.data->'grid'->>'height')::int = 20 and l.gw = w and l.gh = 20
                       and char_length(l.walk) = w * 20 and array_length(l.area_at, 1) = w * 20,
                       format('the grid (walk and area look-up) is filled at width %s', w));
    perform pg_temp.ok(sx = w / 2 and sy = 17 and public._crew_room_walkable('lagos-hq', w, sx, sy), format('the spawn is the middle of the room and walkable at width %s', w));
    -- The door (entry-map-table, two tiles left of the spawn) blocks; the tiles in front of it walk.
    perform pg_temp.ok(not public._crew_room_walkable('lagos-hq', w, sx - 2, 16) and not public._crew_room_walkable('lagos-hq', w, sx - 1, 16)
                       and public._crew_room_walkable('lagos-hq', w, sx - 2, 17) and public._crew_room_walkable('lagos-hq', w, sx - 1, 17),
                       format('the entry door blocks and the tiles in front of it walk at width %s', w));
    -- The lane from the gate north walks as far as the foot of the stage; the DJ desk, the danfo beside the lane and the lagoon block;
    -- the outer ring blocks. The plinth at the stage's foot is a floor prop, so it walks.
    perform pg_temp.ok(public._crew_room_walkable('lagos-hq', w, sx, 14) and public._crew_room_walkable('lagos-hq', w, sx, 11) and public._crew_room_walkable('lagos-hq', w, sx, 7)
                       and public._crew_room_walkable('lagos-hq', w, sx, 6) and not public._crew_room_walkable('lagos-hq', w, sx, 5)
                       and not public._crew_room_walkable('lagos-hq', w, sx - 1, 11) and not public._crew_room_walkable('lagos-hq', w, 2, 2)
                       and not public._crew_room_walkable('lagos-hq', w, 0, 5) and not public._crew_room_walkable('lagos-hq', w, w - 1, 5),
                       format('the lane to the stage walks, the desk, a danfo and the lagoon block at width %s', w));
    perform pg_temp.ok(jsonb_array_length(l.data->'zones') = 6 and exists (select 1 from jsonb_array_elements(l.data->'zones') q where q->>'id' = 'stage'),
                       format('six zones, and one of them is the stage zone at width %s', w));
    -- The scenery people are not in the database: the layout data carries no cast.
    perform pg_temp.ok(not (l.data ? 'ambient'), format('the stored layout carries no scenery people at width %s', w));
    -- Every tile reachable from the spawn (two sealed tiles allowed) and every zone stop among them.
    with recursive cells as (
      select x, y from generate_series(0, l.gw - 1) x cross join generate_series(0, l.gh - 1) y where substr(l.walk, y * l.gw + x + 1, 1) = '1'),
    r(x, y) as (select sx, sy union select c.x, c.y from r join cells c on abs(c.x - r.x) + abs(c.y - r.y) = 1)
    select (select count(*) from cells), (select count(*) from r) into walkable, reached;
    perform pg_temp.ok(walkable >= 300 and walkable - reached <= 2, format('the whole floor is reachable from the spawn (%s of %s) at width %s', reached, walkable, w));
    all_ok := true;
    for z in select * from jsonb_array_elements(l.data->'zones') loop
      with recursive cells as (
        select x, y from generate_series(0, l.gw - 1) x cross join generate_series(0, l.gh - 1) y where substr(l.walk, y * l.gw + x + 1, 1) = '1'),
      r(x, y) as (select sx, sy union select c.x, c.y from cells c join r on abs(c.x - r.x) + abs(c.y - r.y) = 1)
      select exists (select 1 from r where x = (z->'stop'->>'x')::int and y = (z->'stop'->>'y')::int) into hit;
      all_ok := all_ok and hit;
    end loop;
    perform pg_temp.ok(all_ok, format('every zone stop is reachable from the spawn at width %s', w));
  end loop;
  perform pg_temp.ok((select count(*) from public.crew_room_layouts where template = 'clubhouse') = 2, 'the clubhouse layouts are still there');
end $$;

-- ------------------------------------------------------------------------------------- picking it, walking in it ---
do $$
declare
  a uuid := pg_temp.newuser(); b uuid := pg_temp.newuser(); c uuid := pg_temp.newuser();
  crew uuid := gen_random_uuid(); sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  res jsonb;
begin
  insert into public.crews (id, name, created_by) values (crew, 'Lagos HQ template test crew', a);
  insert into public.crew_members (crew_id, user_id, role) values (crew, a, 'owner'), (crew, b, 'member');
  perform pg_temp.actor(a); res := public.crew_room_enter(crew, sa); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'clubhouse', 'a new room starts on the clubhouse');
  perform pg_temp.fail_as(b, format('select public.crew_room_set_template(%L,%L)', crew, 'lagos-hq'), 'owner_only');
  perform pg_temp.fail_as(c, format('select public.crew_room_set_template(%L,%L)', crew, 'lagos-hq'), 'not_in_crew');
  perform pg_temp.fail_as(a, format('select public.crew_room_set_template(%L,%L)', crew, 'lagos-hqs'), 'invalid_template');
  perform pg_temp.actor(a); res := public.crew_room_set_template(crew, 'lagos-hq'); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'lagos-hq' and (res->'room'->>'version')::int > 1, 'the owner picks the Lagos HQ template');
  perform pg_temp.ok((select x = 15 and y = 17 from public.crew_room_presence where crew_id = crew and user_id = a), 'the walker is back at the new entrance');
  perform pg_temp.actor(b); res := public.crew_room_enter(crew, sb); perform pg_temp.admin();
  -- The owner already stands on the spawn tile, so the server puts the new walker on the nearest free tile beside it.
  perform pg_temp.ok(res->'room'->>'template' = 'lagos-hq'
                     and abs((res->'self'->>'x')::int - 15) <= 2 and abs((res->'self'->>'y')::int - 17) <= 2
                     and not ((res->'self'->>'x')::int = 15 and (res->'self'->>'y')::int = 17)
                     and public._crew_room_walkable('lagos-hq', 30, (res->'self'->>'x')::int, (res->'self'->>'y')::int),
                     'a member enters on a free walkable tile beside the entrance of Lagos HQ');
  -- A member walks the lane from the gate, over the road and the zebra side, to the foot of the stage; the DJ desk turns them back.
  perform pg_temp.place(crew, b, 15, 17);
  res := pg_temp.mv(b, crew, sb, 1, '[{"x":15,"y":16},{"x":15,"y":15},{"x":15,"y":14},{"x":15,"y":13}]');
  perform pg_temp.ok((res->>'x')::int = 15 and (res->>'y')::int = 13 and (res->>'seq')::int = 1, 'a member walks the lane from the gate to the road');
  res := pg_temp.mv(b, crew, sb, 2, '[{"x":15,"y":12},{"x":15,"y":11},{"x":15,"y":10},{"x":15,"y":9}]');
  perform pg_temp.ok((res->>'x')::int = 15 and (res->>'y')::int = 9, 'and across the road');
  res := pg_temp.mv(b, crew, sb, 3, '[{"x":15,"y":8},{"x":15,"y":7},{"x":15,"y":6}]');
  perform pg_temp.ok((res->>'x')::int = 15 and (res->>'y')::int = 6, 'and over the NEXT UP plinth to the foot of the stage');
  perform pg_temp.fail_as(b, format('select public.crew_room_move(%L,%L,4,%L)', crew, sb, '[{"x":15,"y":5}]'), 'invalid_movement');
  perform pg_temp.place(crew, b, 15, 11);
  perform pg_temp.fail_as(b, format('select public.crew_room_move(%L,%L,1,%L)', crew, sb, '[{"x":14,"y":11}]'), 'invalid_movement');
  -- The wide room: the owner makes the room 36 wide; the walkers go back to the new spawn and walk it.
  perform pg_temp.actor(a);
  res := public.crew_room_settings(crew, 36, jsonb_build_object('brand', 'Lagos HQ'));
  perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'lagos-hq' and (res->'room'->>'width')::int = 36, 'the owner sets the wide room');
  perform pg_temp.ok((select x = 18 and y = 17 from public.crew_room_presence where crew_id = crew and user_id = b), 'the walker is at the 36 wide entrance');
  perform pg_temp.place(crew, b, 18, 17);
  res := pg_temp.mv(b, crew, sb, 1, '[{"x":18,"y":16},{"x":18,"y":15},{"x":18,"y":14},{"x":18,"y":13}]');
  perform pg_temp.ok((res->>'x')::int = 18 and (res->>'y')::int = 13, 'a member walks the wide room too');
  perform pg_temp.place(crew, b, 18, 6);
  perform pg_temp.fail_as(b, format('select public.crew_room_move(%L,%L,1,%L)', crew, sb, '[{"x":18,"y":5}]'), 'invalid_movement');
  -- The same grid answers through the old entry point an open phone may still call.
  perform pg_temp.actor(b); res := public.crew_room_state(crew); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'lagos-hq', 'the room snapshot says which template it is');
  -- No scenery person ever reaches the database: the room holds the two real walkers and nothing else.
  perform pg_temp.ok((select count(*) from public.crew_room_presence where crew_id = crew) = 2, 'the presence table holds the two real walkers only');
  raise notice 'ALL LAGOS HQ TEMPLATE TESTS PASSED';
end $$;
rollback;
