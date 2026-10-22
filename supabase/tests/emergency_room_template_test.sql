-- The Emergency Room room template (supabase/emergency_room_template.sql) and its brand crew (supabase/setup_emergencyroom.sql).
-- LOCAL ONLY: every fixture user, crew and room rolls back. Ends with ALL EMERGENCY ROOM TEMPLATE TESTS PASSED.
-- Needs, loaded in this order: crew_rooms.sql, crew_rails.sql, crew_reactions.sql, game_time.sql, crew_rooms_scale.sql,
-- emergency_room_template.sql (run it twice if you like). The setup file is run from a copy with the owner email filled in:
--   sed "s/OWNER_EMAIL_HERE/roomtest-er-owner@roomtest.invalid/g" supabase/setup_emergencyroom.sql \
--     | docker exec -i supabase_db_hoppaz-local sh -c 'cat > /tmp/er_setup.sql'
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway db> -v ON_ERROR_STOP=1 < supabase/tests/emergency_room_template_test.sql
\set setup `cat /tmp/er_setup.sql`
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
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', coalesce(mail, 'ertest-' || u || '@roomtest.invalid'),
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
-- Run the setup file's text and say how it went: 'ok', or the error it raised.
create function pg_temp.run_setup(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

-- ---------------------------------------------------------------------------------------------- the layouts ---
do $$
declare
  w int; l record; z jsonb; sx int; sy int; walkable int; reached int; ok boolean;
begin
  perform pg_temp.ok(char_length(:'setup') > 500 and position('OWNER_EMAIL_HERE' in :'setup') = 0,
    'the setup file copy is there with the owner email filled in (see the header)');
  for w in select unnest(array[30, 36]) loop
    select * into l from public.crew_room_layouts where template = 'emergency-room' and width = w;
    perform pg_temp.ok(l.template is not null, format('the emergency-room layout exists at width %s', w));
    sx := (l.data->'spawn'->>'x')::int; sy := (l.data->'spawn'->>'y')::int;
    perform pg_temp.ok((l.data->'grid'->>'width')::int = w and (l.data->'grid'->>'height')::int = 20 and l.gw = w and l.gh = 20
                       and char_length(l.walk) = w * 20 and array_length(l.area_at, 1) = w * 20,
                       format('the grid (walk and area look-up) is filled at width %s', w));
    perform pg_temp.ok(sx = w / 2 and sy = 17 and public._crew_room_walkable('emergency-room', w, sx, sy), format('the spawn is the middle of the room and walkable at width %s', w));
    -- The door (entry-map-table, two tiles left of the spawn) blocks; the tiles in front of it walk.
    perform pg_temp.ok(not public._crew_room_walkable('emergency-room', w, sx - 2, 16) and not public._crew_room_walkable('emergency-room', w, sx - 1, 16)
                       and public._crew_room_walkable('emergency-room', w, sx - 2, 17) and public._crew_room_walkable('emergency-room', w, sx - 1, 17),
                       format('the entry door blocks and the tiles in front of it walk at width %s', w));
    -- The deck, the lit plinth at its foot and the outer wall block; the lane between the gate and the deck walks.
    perform pg_temp.ok(not public._crew_room_walkable('emergency-room', w, sx - 1, 9) and not public._crew_room_walkable('emergency-room', w, sx - 1, 12)
                       and not public._crew_room_walkable('emergency-room', w, 0, 5) and not public._crew_room_walkable('emergency-room', w, w - 1, 5)
                       and public._crew_room_walkable('emergency-room', w, sx, 14) and public._crew_room_walkable('emergency-room', w, sx, 13),
                       format('the deck and the plinth block, the lane to them walks at width %s', w));
    perform pg_temp.ok(jsonb_array_length(l.data->'zones') = 7 and exists (select 1 from jsonb_array_elements(l.data->'zones') q where q->>'id' = 'stage'),
                       format('seven zones, and the deck is the stage zone at width %s', w));
    -- Every tile reachable from the spawn (two sealed tiles allowed) and every zone stop among them.
    with recursive cells as (
      select x, y from generate_series(0, l.gw - 1) x cross join generate_series(0, l.gh - 1) y where substr(l.walk, y * l.gw + x + 1, 1) = '1'),
    r(x, y) as (select sx, sy union select c.x, c.y from r join cells c on abs(c.x - r.x) + abs(c.y - r.y) = 1)
    select (select count(*) from cells), (select count(*) from r) into walkable, reached;
    perform pg_temp.ok(walkable >= 120 and walkable - reached <= 2, format('the whole floor is reachable from the spawn (%s of %s) at width %s', reached, walkable, w));
    ok := true;
    for z in select * from jsonb_array_elements(l.data->'zones') loop
      with recursive cells as (
        select x, y from generate_series(0, l.gw - 1) x cross join generate_series(0, l.gh - 1) y where substr(l.walk, y * l.gw + x + 1, 1) = '1'),
      r(x, y) as (select sx, sy union select c.x, c.y from r join cells c on abs(c.x - r.x) + abs(c.y - r.y) = 1)
      select exists (select 1 from r where x = (z->'stop'->>'x')::int and y = (z->'stop'->>'y')::int) into reached;
      ok := ok and reached::int = 1;
    end loop;
    perform pg_temp.ok(ok, format('every zone stop is reachable from the spawn at width %s', w));
    perform pg_temp.ok(((select z2->'link' from jsonb_array_elements(l.data->'zones') z2 where z2->>'id' = 'experiences')->>'url') = 'https://www.instagram.com/emergencyroombysos/',
                       format('the Experiences zone carries the Instagram link as data at width %s', w));
  end loop;
  perform pg_temp.ok((select count(*) from public.crew_room_layouts where template = 'clubhouse') = 2, 'the clubhouse layouts are still there');
end $$;

-- ------------------------------------------------------------------------------------- picking it, walking in it ---
do $$
declare
  a uuid := pg_temp.newuser(); b uuid := pg_temp.newuser(); c uuid := pg_temp.newuser();
  crew uuid := gen_random_uuid(); sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  res jsonb; x0 int;
begin
  insert into public.crews (id, name, created_by) values (crew, 'ER template test crew', a);
  insert into public.crew_members (crew_id, user_id, role) values (crew, a, 'owner'), (crew, b, 'member');
  perform pg_temp.actor(a); res := public.crew_room_enter(crew, sa); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'clubhouse', 'a new room starts on the clubhouse');
  perform pg_temp.fail_as(b, format('select public.crew_room_set_template(%L,%L)', crew, 'emergency-room'), 'owner_only');
  perform pg_temp.fail_as(c, format('select public.crew_room_set_template(%L,%L)', crew, 'emergency-room'), 'not_in_crew');
  perform pg_temp.fail_as(a, format('select public.crew_room_set_template(%L,%L)', crew, 'emergency-rooms'), 'invalid_template');
  perform pg_temp.actor(a); res := public.crew_room_set_template(crew, 'emergency-room'); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'emergency-room' and (res->'room'->>'version')::int > 1, 'the owner picks the Emergency Room template');
  perform pg_temp.ok((select x = 15 and y = 17 from public.crew_room_presence where crew_id = crew and user_id = a), 'the walker is back at the new entrance');
  perform pg_temp.actor(b); res := public.crew_room_enter(crew, sb); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'emergency-room' and (res->'self'->>'x')::int = 15 and (res->'self'->>'y')::int = 17, 'a member enters at the entrance of the Emergency Room');
  -- A member walks the lane from the gate towards the deck, one batch, then is turned back by the plinth and the deck.
  perform pg_temp.place(crew, b, 15, 17);
  res := pg_temp.mv(b, crew, sb, 1, '[{"x":15,"y":16},{"x":15,"y":15},{"x":15,"y":14},{"x":15,"y":13}]');
  perform pg_temp.ok((res->>'x')::int = 15 and (res->>'y')::int = 13 and (res->>'seq')::int = 1, 'a member walks the lane from the gate to the foot of the deck');
  perform pg_temp.fail_as(b, format('select public.crew_room_move(%L,%L,2,%L)', crew, sb, '[{"x":15,"y":12}]'), 'invalid_movement');
  res := pg_temp.mv(b, crew, sb, 2, '[{"x":14,"y":13},{"x":13,"y":13},{"x":13,"y":12},{"x":13,"y":11}]');
  perform pg_temp.fail_as(b, format('select public.crew_room_move(%L,%L,3,%L)', crew, sb, '[{"x":14,"y":11}]'), 'invalid_movement');
  perform pg_temp.ok((res->>'x')::int = 13 and (res->>'y')::int = 11, 'the ring beside the deck walks, the plinth and the deck block');
  -- The wide room: the owner makes the room 36 wide; the walkers go back to the new spawn and walk it.
  perform pg_temp.actor(a);
  res := public.crew_room_settings(crew, 36, jsonb_build_object('brand', 'Emergency Room by SOS'));
  perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'emergency-room' and (res->'room'->>'width')::int = 36, 'the owner sets the wide room');
  perform pg_temp.ok((select x = 18 and y = 17 from public.crew_room_presence where crew_id = crew and user_id = b), 'the walker is at the 36 wide entrance');
  perform pg_temp.place(crew, b, 18, 17);
  res := pg_temp.mv(b, crew, sb, 1, '[{"x":18,"y":16},{"x":18,"y":15},{"x":18,"y":14},{"x":18,"y":13}]');
  perform pg_temp.ok((res->>'x')::int = 18 and (res->>'y')::int = 13, 'a member walks the wide room too');
  perform pg_temp.fail_as(b, format('select public.crew_room_move(%L,%L,2,%L)', crew, sb, '[{"x":18,"y":12}]'), 'invalid_movement');
  -- The same grid answers through the old entry point an open phone may still call.
  perform pg_temp.actor(b); res := public.crew_room_state(crew); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'emergency-room', 'the room snapshot says which template it is');
end $$;

-- ------------------------------------------------------------------------------------------- the setup file ---
create function pg_temp.er_crews() returns bigint language sql as $$
  select count(*) from public.crews where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'emergencyroom';
$$;
select pg_temp.newuser('roomtest-er-owner@roomtest.invalid') as er_owner \gset
select set_config('er.owner', :'er_owner', true);
select pg_temp.run_setup(:'setup') as first_run \gset
select pg_temp.run_setup(:'setup') as second_run \gset
select pg_temp.run_setup(replace(:'setup', 'roomtest-er-owner@roomtest.invalid', 'nobody-here@roomtest.invalid')) as no_owner \gset

do $$
declare
  owner uuid := current_setting('er.owner')::uuid;
  crew uuid; r public.crew_rooms; c public.crews; res jsonb; v int;
begin
  perform pg_temp.ok(:'first_run' = 'ok' and :'second_run' = 'ok', format('the setup file runs, and runs again (%s / %s)', :'first_run', :'second_run'));
  perform pg_temp.ok(:'no_owner' like '%owner account not found%', 'it stops when the owner account does not exist');
  perform pg_temp.ok(pg_temp.er_crews() = 1, 'running it twice leaves one Emergency Room crew');
  select * into c from public.crews where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'emergencyroom';
  crew := c.id;
  perform pg_temp.ok(c.name = 'Emergency Room' and c.created_by = owner and c.visibility = 'open' and c.verified and c.logo_url = '/brands/emergency-room-sos.jpg'
                     and c.header_images = '{}', 'the crew is open, verified, owned by the account, with the round logo and no header pictures');
  perform pg_temp.ok((select role = 'owner' from public.crew_members where crew_id = crew and user_id = owner) and (select count(*) from public.crew_members where crew_id = crew) = 1,
                     'the owner is the only member, as owner');
  select * into r from public.crew_rooms where crew_id = crew;
  perform pg_temp.ok(r.template = 'emergency-room' and r.width = 30 and r.capacity = 90 and r.featured_event_id is null,
                     'the room is on the emergency-room template, 30 wide, with room for 90 and no featured event');
  perform pg_temp.ok(r.content->>'brand' = 'Emergency Room by SOS' and r.content->>'strapline' = 'Electronic music, every week'
                     and r.content->>'strapline' !~* '(hospital|patient|medical|doctor|clinic)' and r.content->>'eventKeywords' = 'Emergency Room, SOS',
                     'the owner content: brand, strapline without hospital wording, event words');
  perform pg_temp.ok(not exists (select 1 from public.game_times where crew_id = crew), 'no Game Time was made');
  perform pg_temp.ok((select invite_code from public.crews where id = crew) is not null, 'the crew has an invite code for the link it prints');
  -- A run again keeps what the owner typed, and puts a room that was moved back on the template.
  perform pg_temp.actor(owner);
  res := public.crew_room_settings(crew, 30, jsonb_build_object('brand', 'Emergency Room by SOS', 'strapline', 'Our own line', 'eventKeywords', 'Emergency Room, SOS, Afrotech'));
  perform pg_temp.admin();
  perform pg_temp.actor(owner); res := public.crew_room_set_template(crew, 'clubhouse'); perform pg_temp.admin();
  perform pg_temp.ok((select template from public.crew_rooms where crew_id = crew) = 'clubhouse', 'the owner moved the room to the clubhouse');
  v := (select version from public.crew_rooms where crew_id = crew);
  perform pg_temp.ok(pg_temp.run_setup(:'setup') = 'ok', 'the setup file runs again over a changed room');
  select * into r from public.crew_rooms where crew_id = crew;
  perform pg_temp.ok(r.template = 'emergency-room' and r.version > v and r.content->>'strapline' = 'Our own line' and r.content->>'eventKeywords' = 'Emergency Room, SOS, Afrotech'
                     and not exists (select 1 from public.crew_room_presence where crew_id = crew), 'the template is back, the owner''s own words stay, nobody stays on the old floor');
  -- It never takes over somebody else's crew of that name.
  delete from public.crews where id = crew;
  perform pg_temp.ok(pg_temp.er_crews() = 0, 'the test removed the brand crew to try the takeover case');
  perform set_config('er.stranger_crew', gen_random_uuid()::text, true);
  insert into public.crews (id, name, created_by) values (current_setting('er.stranger_crew')::uuid, 'EMERGENCY  room!', pg_temp.newuser());
  perform pg_temp.ok(true, 'another account has a crew with that name');
end $$;
select pg_temp.run_setup(:'setup') as takeover \gset
do $$
begin
  perform pg_temp.ok(:'takeover' like '%already exists and is not this owner%' and :'takeover' like '%' || current_setting('er.stranger_crew') || '%',
                     'it refuses to take over a crew of that name owned by someone else, and prints its id');
  perform pg_temp.ok(pg_temp.er_crews() = 1 and not exists (select 1 from public.crews c where c.created_by = current_setting('er.owner')::uuid),
                     'and it made nothing for the owner');
  raise notice 'ALL EMERGENCY ROOM TEMPLATE TESTS PASSED';
end $$;
rollback;
