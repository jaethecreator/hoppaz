-- The Emergency Room room template (supabase/emergency_room_template.sql) and its brand crew (supabase/setup_emergencyroom.sql).
-- LOCAL ONLY: every fixture user, crew and room rolls back. Ends with ALL EMERGENCY ROOM TEMPLATE TESTS PASSED.
-- Needs, loaded in this order: crew_rooms.sql, crew_rails.sql, crew_reactions.sql, game_time.sql, crew_rooms_scale.sql,
-- emergency_room_template.sql (run it twice if you like). The Emergency Room is locked to its own crew (crew_room_template_locks and
-- the trigger on crew_rooms, both in emergency_room_template.sql; the setup file adds the crew's lock row): the section "the lock"
-- below tries it from another crew, from the Emergency Room crew, on a template with no lock rows, and from SQL.
-- The setup file is run from a copy with the owner email filled in:
--   sed "s/OWNER_EMAIL_HERE/roomtest-er-owner@roomtest.invalid/g" supabase/setup_emergencyroom.sql \
--     | docker exec -i supabase_db_hoppaz-local sh -c 'cat > /tmp/er_setup.sql'
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway db> -v ON_ERROR_STOP=1 < supabase/tests/emergency_room_template_test.sql
-- Second mode, for a database where the setup file has been run for real (committed) and then crew_rooms.sql, crew_rooms_scale.sql and
-- emergency_room_template.sql were run again, in that order (notes/emergency-room/replay_er.sh does this): add  -v after_rerun=1  and
-- only the section "the lock after a re-run" runs (it rolls back). It ends with ALL EMERGENCY ROOM LOCK RE-RUN TESTS PASSED.
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

-- Run a statement as the database owner and say whether it raised `want`.
create function pg_temp.admin_fail(q text, want text) returns void language plpgsql as $$
declare reason text;
begin
  perform pg_temp.admin();
  begin execute q; exception when others then reason := sqlerrm; end;
  perform pg_temp.ok(reason like '%' || want || '%', 'sql rejects ' || want || coalesce(' (got: ' || reason || ')', ' (no error)'));
end $$;

-- ------------------------------------------------------------------------------------- the lock after a re-run ---
-- Mode 2 (-v after_rerun=1): the committed Emergency Room crew from a real setup run, after crew_rooms.sql, crew_rooms_scale.sql and
-- emergency_room_template.sql were run again. The lock must still work: a trigger sits on the table, so replacing functions does not remove it.
\if :{?after_rerun}
do $$
declare
  crew uuid := (select id from public.crews where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'emergencyroom');
  own uuid := (select created_by from public.crews where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'emergencyroom');
  so uuid := pg_temp.newuser(); sc uuid := gen_random_uuid(); res jsonb;
begin
  perform pg_temp.ok(crew is not null and exists (select 1 from public.crew_rooms where crew_id = crew and template = 'emergency-room'),
                     'the Emergency Room crew from the real setup run is there, on its template');
  perform pg_temp.ok((select count(*) from public.crew_room_template_locks where template = 'emergency-room') = 1
                     and exists (select 1 from public.crew_room_template_locks where template = 'emergency-room' and crew_id = crew),
                     'after crew_rooms.sql, crew_rooms_scale.sql and the template file again: still one lock row, the Emergency Room crew''s');
  perform pg_temp.ok(exists (select 1 from pg_trigger where tgrelid = 'public.crew_rooms'::regclass and tgname = 'crew_room_template_lock' and not tgisinternal and tgenabled = 'O'),
                     'the lock trigger is still on crew_rooms and enabled');
  insert into public.crews (id, name, created_by) values (sc, 'Rerun stranger crew', so);
  insert into public.crew_members (crew_id, user_id, role) values (sc, so, 'owner');
  perform pg_temp.actor(so); res := public.crew_room_enter(sc, gen_random_uuid()); perform pg_temp.admin();
  perform pg_temp.fail_as(so, format('select public.crew_room_set_template(%L,%L)', sc, 'emergency-room'), 'template_locked');
  perform pg_temp.ok((select template from public.crew_rooms where crew_id = sc) = 'clubhouse', 'the other crew''s room stays on the clubhouse');
  perform pg_temp.actor(own); res := public.crew_room_set_template(crew, 'clubhouse'); perform pg_temp.admin();
  perform pg_temp.actor(own); res := public.crew_room_set_template(crew, 'emergency-room'); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'emergency-room', 'the Emergency Room crew can still leave its template and come back');
  perform pg_temp.admin_fail(format('update public.crew_rooms set template = %L where crew_id = %L', 'emergency-room', sc), 'template_locked');
  raise notice 'ALL EMERGENCY ROOM LOCK RE-RUN TESTS PASSED';
end $$;
rollback;
\q
\endif

-- psql does not substitute variables inside a $$ body, so the setup file's facts go in through settings first.
select set_config('er.setup_len', char_length(:'setup')::text, true), set_config('er.setup_placeholder', position('OWNER_EMAIL_HERE' in :'setup')::text, true);

-- ---------------------------------------------------------------------------------------------- the layouts ---
do $$
declare
  w int; l record; z jsonb; sx int; sy int; walkable int; reached int; hit boolean; all_ok boolean;
begin
  perform pg_temp.ok(current_setting('er.setup_len')::int > 500 and current_setting('er.setup_placeholder')::int = 0,
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
    -- The deck and the outer wall block; the lane between the gate and the deck walks, and so does the plinth at the deck's foot
    -- (a floor prop: it is not solid, so Game Time never hides a box in it).
    perform pg_temp.ok(not public._crew_room_walkable('emergency-room', w, sx - 1, 9) and not public._crew_room_walkable('emergency-room', w, sx, 11)
                       and not public._crew_room_walkable('emergency-room', w, 0, 5) and not public._crew_room_walkable('emergency-room', w, w - 1, 5)
                       and public._crew_room_walkable('emergency-room', w, sx, 14) and public._crew_room_walkable('emergency-room', w, sx, 13)
                       and public._crew_room_walkable('emergency-room', w, sx - 1, 12) and public._crew_room_walkable('emergency-room', w, sx, 12),
                       format('the deck blocks, the lane to it and the plinth at its foot walk at width %s', w));
    perform pg_temp.ok(jsonb_array_length(l.data->'zones') = 7 and exists (select 1 from jsonb_array_elements(l.data->'zones') q where q->>'id' = 'stage'),
                       format('seven zones, and the deck is the stage zone at width %s', w));
    -- Every tile reachable from the spawn (two sealed tiles allowed) and every zone stop among them.
    with recursive cells as (
      select x, y from generate_series(0, l.gw - 1) x cross join generate_series(0, l.gh - 1) y where substr(l.walk, y * l.gw + x + 1, 1) = '1'),
    r(x, y) as (select sx, sy union select c.x, c.y from r join cells c on abs(c.x - r.x) + abs(c.y - r.y) = 1)
    select (select count(*) from cells), (select count(*) from r) into walkable, reached;
    perform pg_temp.ok(walkable >= 120 and walkable - reached <= 2, format('the whole floor is reachable from the spawn (%s of %s) at width %s', reached, walkable, w));
    all_ok := true;
    for z in select * from jsonb_array_elements(l.data->'zones') loop
      with recursive cells as (
        select x, y from generate_series(0, l.gw - 1) x cross join generate_series(0, l.gh - 1) y where substr(l.walk, y * l.gw + x + 1, 1) = '1'),
      r(x, y) as (select sx, sy union select c.x, c.y from r join cells c on abs(c.x - r.x) + abs(c.y - r.y) = 1)
      select exists (select 1 from r where x = (z->'stop'->>'x')::int and y = (z->'stop'->>'y')::int) into hit;
      all_ok := all_ok and hit;
    end loop;
    perform pg_temp.ok(all_ok, format('every zone stop is reachable from the spawn at width %s', w));
    perform pg_temp.ok(((select z2->'link' from jsonb_array_elements(l.data->'zones') z2 where z2->>'id' = 'experiences')->>'url') = 'https://www.instagram.com/emergencyroombysos/',
                       format('the Experiences zone carries the Instagram link as data at width %s', w));
  end loop;
  perform pg_temp.ok((select count(*) from public.crew_room_layouts where template = 'clubhouse') = 2, 'the clubhouse layouts are still there');
end $$;

-- ------------------------------------------------------------------------------------- picking it, walking in it ---
-- No lock row exists yet at this point (the setup file adds it further down), so any crew can pick the template to walk in it.
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
  -- The owner already stands on the spawn tile, so the server puts the new walker on the nearest free tile beside it.
  perform pg_temp.ok(res->'room'->>'template' = 'emergency-room'
                     and abs((res->'self'->>'x')::int - 15) <= 2 and abs((res->'self'->>'y')::int - 17) <= 2
                     and not ((res->'self'->>'x')::int = 15 and (res->'self'->>'y')::int = 17)
                     and public._crew_room_walkable('emergency-room', 30, (res->'self'->>'x')::int, (res->'self'->>'y')::int),
                     'a member enters on a free walkable tile beside the entrance of the Emergency Room');
  -- A member walks the lane from the gate towards the deck, one batch, then is turned back by the deck.
  perform pg_temp.place(crew, b, 15, 17);
  res := pg_temp.mv(b, crew, sb, 1, '[{"x":15,"y":16},{"x":15,"y":15},{"x":15,"y":14},{"x":15,"y":13}]');
  perform pg_temp.ok((res->>'x')::int = 15 and (res->>'y')::int = 13 and (res->>'seq')::int = 1, 'a member walks the lane from the gate to the foot of the deck');
  res := pg_temp.mv(b, crew, sb, 2, '[{"x":15,"y":12},{"x":14,"y":12},{"x":13,"y":12},{"x":12,"y":12}]');
  perform pg_temp.ok((res->>'x')::int = 12 and (res->>'y')::int = 12, 'the plinth at the foot of the deck and the ring beside it walk');
  perform pg_temp.fail_as(b, format('select public.crew_room_move(%L,%L,3,%L)', crew, sb, '[{"x":13,"y":12},{"x":13,"y":11}]'), 'invalid_movement');
  -- The wide room: the owner makes the room 36 wide; the walkers go back to the new spawn and walk it.
  perform pg_temp.actor(a);
  res := public.crew_room_settings(crew, 36, jsonb_build_object('brand', 'Emergency Room by SOS'));
  perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'emergency-room' and (res->'room'->>'width')::int = 36, 'the owner sets the wide room');
  perform pg_temp.ok((select x = 18 and y = 17 from public.crew_room_presence where crew_id = crew and user_id = b), 'the walker is at the 36 wide entrance');
  perform pg_temp.place(crew, b, 18, 17);
  res := pg_temp.mv(b, crew, sb, 1, '[{"x":18,"y":16},{"x":18,"y":15},{"x":18,"y":14},{"x":18,"y":13}]');
  perform pg_temp.ok((res->>'x')::int = 18 and (res->>'y')::int = 13, 'a member walks the wide room too');
  perform pg_temp.fail_as(b, format('select public.crew_room_move(%L,%L,2,%L)', crew, sb, '[{"x":18,"y":12},{"x":18,"y":11}]'), 'invalid_movement');
  -- The same grid answers through the old entry point an open phone may still call.
  perform pg_temp.actor(b); res := public.crew_room_state(crew); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'emergency-room', 'the room snapshot says which template it is');
end $$;

-- ------------------------------------------------------------------------------------------- the setup file ---
create function pg_temp.er_crews() returns bigint language sql as $$
  select count(*) from public.crews where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'emergencyroom';
$$;
select set_config('er.owner', pg_temp.newuser('roomtest-er-owner@roomtest.invalid')::text, true);
select set_config('er.first', pg_temp.run_setup(:'setup'), true);
select set_config('er.second', pg_temp.run_setup(:'setup'), true);
select set_config('er.no_owner', pg_temp.run_setup(replace(:'setup', 'roomtest-er-owner@roomtest.invalid', 'nobody-here@roomtest.invalid')), true);

do $$
declare
  own uuid := current_setting('er.owner')::uuid;
  crew uuid; r public.crew_rooms; c public.crews; res jsonb; v int;
begin
  perform pg_temp.ok(current_setting('er.first') = 'ok' and current_setting('er.second') = 'ok',
    format('the setup file runs, and runs again (%s / %s)', current_setting('er.first'), current_setting('er.second')));
  perform pg_temp.ok(current_setting('er.no_owner') like '%owner account not found%', 'it stops when the owner account does not exist');
  perform pg_temp.ok(pg_temp.er_crews() = 1, 'running it twice leaves one Emergency Room crew');
  select * into c from public.crews where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'emergencyroom';
  crew := c.id;
  perform pg_temp.ok(c.name = 'Emergency Room' and c.created_by = own and c.visibility = 'open' and c.verified and c.logo_url = '/brands/emergency-room-sos.jpg'
                     and c.header_images = '{}', 'the crew is open, verified, owned by the account, with the round logo and no header pictures');
  perform pg_temp.ok((select role = 'owner' from public.crew_members where crew_id = crew and user_id = own) and (select count(*) from public.crew_members where crew_id = crew) = 1,
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
  perform pg_temp.actor(own);
  res := public.crew_room_settings(crew, 30, jsonb_build_object('brand', 'Emergency Room by SOS', 'strapline', 'Our own line', 'eventKeywords', 'Emergency Room, SOS, Afrotech'));
  perform pg_temp.admin();
  perform pg_temp.actor(own); res := public.crew_room_set_template(crew, 'clubhouse'); perform pg_temp.admin();
  perform pg_temp.ok((select template from public.crew_rooms where crew_id = crew) = 'clubhouse', 'the owner moved the room to the clubhouse');
  perform set_config('er.version', (select version from public.crew_rooms where crew_id = crew)::text, true);
end $$;

-- ----------------------------------------------------------------------------------------------------- the lock ---
-- The setup file has run twice: the Emergency Room crew is the only crew locked in, and its room is on the clubhouse right now.
do $$
declare
  own uuid := current_setting('er.owner')::uuid;
  crew uuid := (select id from public.crews where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'emergencyroom');
  wc uuid := (select id from public.crews where name = 'ER template test crew');
  wo uuid := (select created_by from public.crews where name = 'ER template test crew');
  so uuid := pg_temp.newuser(); sc uuid := gen_random_uuid(); nc uuid := gen_random_uuid();
  res jsonb; reason text; ver int;
begin
  perform pg_temp.ok((select count(*) from public.crew_room_template_locks where template = 'emergency-room') = 1
                     and exists (select 1 from public.crew_room_template_locks where template = 'emergency-room' and crew_id = crew)
                     and not exists (select 1 from public.crew_room_template_locks where template = 'clubhouse'),
                     'the setup file, run twice, left one lock row: the Emergency Room crew on emergency-room, and none on the clubhouse');
  -- The table is closed to the app: row security on with no policies, and no grants for anon or authenticated.
  perform pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.crew_room_template_locks'::regclass)
                     and not exists (select 1 from pg_policy where polrelid = 'public.crew_room_template_locks'::regclass)
                     and not has_table_privilege('anon', 'public.crew_room_template_locks', 'select')
                     and not has_table_privilege('authenticated', 'public.crew_room_template_locks', 'select'),
                     'the lock table has row security on, no policies and no grants for the app');
  perform pg_temp.fail_as(so, 'select count(*) from public.crew_room_template_locks', 'permission denied');
  perform pg_temp.fail_as(so, 'insert into public.crew_room_template_locks(template, crew_id) values (''emergency-room'', gen_random_uuid())', 'permission denied');
  begin
    execute 'reset role'; execute 'set local role anon';
    perform count(*) from public.crew_room_template_locks;
  exception when others then reason := sqlerrm; end;
  perform pg_temp.admin();
  perform pg_temp.ok(reason like 'permission denied%', 'anon cannot read the lock table either');
  -- The trigger fires on insert and on a write to the template column only, before the row, once per row.
  perform pg_temp.ok(exists (select 1 from pg_trigger t where t.tgrelid = 'public.crew_rooms'::regclass and t.tgname = 'crew_room_template_lock' and not t.tgisinternal
                             and t.tgtype & 1 = 1 and t.tgtype & 2 = 2 and t.tgtype & 4 = 4 and t.tgtype & 16 = 16 and t.tgtype & (8 | 32) = 0
                             and t.tgattr::text = (select attnum::text from pg_attribute where attrelid = 'public.crew_rooms'::regclass and attname = 'template')),
                     'the lock is a row trigger before insert or update of template on crew_rooms, and nothing else');

  -- Another crew's owner cannot put the room on the Emergency Room, however they ask; the room is left as it was.
  insert into public.crews (id, name, created_by) values (sc, 'Stranger crew', so);
  insert into public.crew_members (crew_id, user_id, role) values (sc, so, 'owner');
  perform pg_temp.actor(so); res := public.crew_room_enter(sc, gen_random_uuid()); perform pg_temp.admin();
  ver := (res->'room'->>'version')::int;
  perform pg_temp.fail_as(so, format('select public.crew_room_set_template(%L,%L)', sc, 'emergency-room'), 'template_locked');
  perform pg_temp.ok((select template = 'clubhouse' and version = ver from public.crew_rooms where crew_id = sc), 'the other crew''s room is still on the clubhouse, untouched');
  -- Not even from SQL, and not by making the room with that template either.
  perform pg_temp.admin_fail(format('update public.crew_rooms set template = %L where crew_id = %L', 'emergency-room', sc), 'template_locked');
  insert into public.crews (id, name, created_by) values (nc, 'Another new crew', so);
  perform pg_temp.admin_fail(format('insert into public.crew_rooms(crew_id, template) values (%L, %L)', nc, 'emergency-room'), 'template_locked');
  insert into public.crew_rooms(crew_id) values (nc);
  perform pg_temp.ok((select template from public.crew_rooms where crew_id = nc) = 'clubhouse', 'a room made without a template is a clubhouse as before');

  -- A template with no lock rows (the clubhouse, and a spare one made for this test) works for every crew, the locked-out ones included.
  perform pg_temp.actor(so); res := public.crew_room_set_template(sc, 'clubhouse'); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'clubhouse', 'the clubhouse (no lock rows) works for the other crew');
  insert into public.crew_room_layouts(template, width, data) select 'zz-open', width, data from public.crew_room_layouts where template = 'clubhouse';
  perform pg_temp.actor(so); res := public.crew_room_set_template(sc, 'zz-open'); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'zz-open', 'a template with no lock rows can be picked by the other crew');
  perform pg_temp.actor(so); res := public.crew_room_set_template(sc, 'clubhouse'); perform pg_temp.admin();
  perform pg_temp.actor(own); res := public.crew_room_set_template(crew, 'zz-open'); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'zz-open', 'the Emergency Room crew can use an unlocked template too');
  perform pg_temp.actor(own); res := public.crew_room_set_template(crew, 'clubhouse'); perform pg_temp.admin();

  -- The Emergency Room crew (it has the lock row) can have its room on the Emergency Room, leave it and come back.
  perform pg_temp.actor(own); res := public.crew_room_set_template(crew, 'emergency-room'); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'emergency-room', 'the Emergency Room crew picks the Emergency Room template');
  perform pg_temp.actor(own); res := public.crew_room_set_template(crew, 'clubhouse'); perform pg_temp.admin();
  perform pg_temp.ok((select template from public.crew_rooms where crew_id = crew) = 'clubhouse', 'and can leave it again (the setup run below puts it back)');

  -- A room that was on the template before the lock stays valid: other writes, even a write of the same template, are not blocked.
  perform pg_temp.ok((select template from public.crew_rooms where crew_id = wc) = 'emergency-room', 'the earlier test crew''s room is on the Emergency Room, not in the lock');
  update public.crew_rooms set template = template where crew_id = wc;
  update public.crew_rooms set version = version + 1 where crew_id = wc;
  perform pg_temp.actor(wo); res := public.crew_room_settings(wc, 30, jsonb_build_object('brand', 'Emergency Room by SOS')); perform pg_temp.admin();
  perform pg_temp.ok(res->'room'->>'template' = 'emergency-room' and (res->'room'->>'width')::int = 30, 'a room already on the template keeps working: settings, versions and rewrites of the same template pass');
  perform pg_temp.actor(wo); res := public.crew_room_set_template(wc, 'clubhouse'); perform pg_temp.admin();
  perform pg_temp.fail_as(wo, format('select public.crew_room_set_template(%L,%L)', wc, 'emergency-room'), 'template_locked');
  perform pg_temp.ok((select template from public.crew_rooms where crew_id = wc) = 'clubhouse', 'once it leaves, a locked-out crew cannot come back');

  perform set_config('er.version', (select version from public.crew_rooms where crew_id = crew)::text, true);
end $$;
select set_config('er.rerun', pg_temp.run_setup(:'setup'), true);
do $$
declare
  crew uuid := (select id from public.crews where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'emergencyroom');
  r public.crew_rooms; v int := current_setting('er.version')::int;
begin
  perform pg_temp.ok(current_setting('er.rerun') = 'ok', 'the setup file runs again over a changed room');
  select * into r from public.crew_rooms where crew_id = crew;
  perform pg_temp.ok(r.template = 'emergency-room' and r.version > v and r.content->>'strapline' = 'Our own line' and r.content->>'eventKeywords' = 'Emergency Room, SOS, Afrotech'
                     and not exists (select 1 from public.crew_room_presence where crew_id = crew), 'the template is back, the owner''s own words stay, nobody stays on the old floor');
  -- It never takes over somebody else's crew of that name.
  delete from public.crews where id = crew;
  perform pg_temp.ok(pg_temp.er_crews() = 0, 'the test removed the brand crew to try the takeover case');
  perform pg_temp.ok(exists (select 1 from public.crew_room_template_locks where template = 'emergency-room' and crew_id = crew), 'its lock row stays when the crew is deleted, so the template does not open to everyone');
  perform set_config('er.stranger_crew', gen_random_uuid()::text, true);
  insert into public.crews (id, name, created_by) values (current_setting('er.stranger_crew')::uuid, 'EMERGENCY  room!', pg_temp.newuser());
  perform pg_temp.ok(true, 'another account has a crew with that name');
end $$;
select set_config('er.takeover', pg_temp.run_setup(:'setup'), true);
do $$
begin
  perform pg_temp.ok(current_setting('er.takeover') like '%already exists and is not this owner%' and current_setting('er.takeover') like '%' || current_setting('er.stranger_crew') || '%',
                     'it refuses to take over a crew of that name owned by someone else, and prints its id');
  perform pg_temp.ok(pg_temp.er_crews() = 1 and not exists (select 1 from public.crews c where c.created_by = current_setting('er.owner')::uuid),
                     'and it made nothing for the owner');
  raise notice 'ALL EMERGENCY ROOM TEMPLATE TESTS PASSED';
end $$;
rollback;
