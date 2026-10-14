-- ============================================================================
-- Game Time (supabase/game_time.sql). LOCAL ONLY. Ends with ALL GAME TIME TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/game_time_test.sql
--
-- Part 1 is one transaction that always rolls back: every user, crew, game, box and win is undone.
-- Part 2 (50 searches at the same moment) needs 50 real database sessions, so it commits its own
-- fixtures (users gtconc-NN@gametime.invalid and a crew named GT CONCURRENCY), starts the sessions
-- with psql's \! (which runs inside the database container, as the command above does), and removes
-- the fixtures again. A run that stopped half way leaves them behind; the next run clears them first.
--
-- Covers: the staff calls and their refusals; the hiding places; who may search and from where; the
-- 2.5 s pace; eligibility and the one-win-per-campaign limit; the atomic first-finder claim, also with 50
-- Hoppers at once; the hot, warm and cold hint; opening, closing, time up and all found; relocation;
-- the opening push; and that no Hopper (anon or authenticated) can read a code or a hiding place through
-- any table, view or function.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

create temp table fx (k text primary key, v text);
create function pg_temp.set(k text, v text) returns void language sql as $$
  insert into fx values (k, v) on conflict (k) do update set v = excluded.v;
$$;
create function pg_temp.get(k text) returns text language sql as $$ select v from fx where fx.k = $1; $$;
create function pg_temp.id(k text) returns uuid language sql as $$ select v::uuid from fx where fx.k = $1; $$;

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
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

create function pg_temp.newuser(guest boolean default false, nm text default 'Tester') returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          case when guest then null else 'gt-' || u || '@gametime.invalid' end, guest, '{}', json_build_object('name', nm)::jsonb, now(), now());
  update public.profiles set display_name = nm, handle = lower(nm) || '_' || substr(u::text, 1, 6) where id = u;
  return u;
end $$;

-- Runs q as u and wants the error text to contain `want`.
create function pg_temp.fail_as(u uuid, q text, want text) returns void language plpgsql as $$
declare reason text;
begin
  perform pg_temp.actor(u);
  begin execute q; exception when others then reason := sqlerrm; end;
  perform pg_temp.admin();
  perform pg_temp.ok(reason like '%' || want || '%', 'rejects ' || want || coalesce(' (got: ' || reason || ')', ' (no error)'));
end $$;
create function pg_temp.fail_anon(q text, want text) returns void language plpgsql as $$
declare reason text;
begin
  perform pg_temp.anon();
  begin execute q; exception when others then reason := sqlerrm; end;
  perform pg_temp.admin();
  perform pg_temp.ok(reason like '%' || want || '%', 'anon is refused: ' || want || coalesce(' (got: ' || reason || ')', ' (no error)'));
end $$;

-- A staff call answers {"ok": false, "reason": want}.
create function pg_temp.create_refuses(a jsonb, want text) returns void language plpgsql as $$
declare r jsonb;
begin
  r := public.admin_game_time_create(a);
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'reason' = want, 'create refuses ' || want || ' (got ' || coalesce(r->>'reason', 'ok') || ')');
end $$;
create function pg_temp.update_refuses(g uuid, patch jsonb, want text) returns void language plpgsql as $$
declare r jsonb;
begin
  r := public.admin_game_time_update(g, patch);
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'reason' = want, 'update refuses ' || want || ' (got ' || coalesce(r->>'reason', 'ok') || ')');
end $$;

-- A walker in the room at (x, y), heartbeat now.
create function pg_temp.place(c uuid, u uuid, x int, y int) returns void language plpgsql as $$
begin
  insert into public.crew_room_presence (crew_id, user_id, session_id, x, y, last_seen)
  values (c, u, gen_random_uuid(), x, y, clock_timestamp())
  on conflict (crew_id, user_id) do update set x = excluded.x, y = excluded.y, last_seen = clock_timestamp();
end $$;

-- Walk to (x, y), then search o (a fresh gap unless told otherwise).
create function pg_temp.go(c uuid, u uuid, x int, y int, o text, fresh boolean default true) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute 'reset role';
  perform pg_temp.place(c, u, x, y);
  if fresh then delete from public.game_time_rate where user_id = u; end if;
  perform pg_temp.actor(u);
  r := public.game_time_search(c, o);
  perform pg_temp.admin();
  return r;
end $$;

-- Search and want the refusal `want`; hands back the error detail (the wait for slow_down).
create function pg_temp.refuse(c uuid, u uuid, o text, want text, fresh boolean default true, beat boolean default true) returns text language plpgsql as $$
declare reason text; dtl text;
begin
  execute 'reset role';
  if fresh then delete from public.game_time_rate where user_id = u; end if;
  if beat then update public.crew_room_presence set last_seen = clock_timestamp() where crew_id = c and user_id = u; end if;
  perform pg_temp.actor(u);
  begin
    perform public.game_time_search(c, o);
  exception when others then
    reason := sqlerrm;
    get stacked diagnostics dtl = pg_exception_detail;
  end;
  perform pg_temp.admin();
  perform pg_temp.ok(reason = want, 'search refused with ' || want || coalesce(' (got ' || reason || ')', ' (no error)'));
  return dtl;
end $$;

create function pg_temp.state(c uuid, u uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(u);
  r := public.game_time_state(c);
  perform pg_temp.admin();
  return r;
end $$;

-- Put the unfound boxes of a game on exactly these objects (codes[i] on spots[i]).
create function pg_temp.arrange(g uuid, codes text[], spots text[]) returns void language plpgsql as $$
begin
  update public.game_time_boxes set spot_id = 'tmp-' || id::text where game_id = g and claimed_by is null;
  update public.game_time_boxes b set spot_id = a.s
    from unnest(codes, spots) as a(c, s) where b.game_id = g and b.code = a.c and b.claimed_by is null;
end $$;

create function pg_temp.args(crew uuid) returns jsonb language sql as $$
  select jsonb_build_object('crew_id', crew, 'title', 'Find the box',
    'opens_at', clock_timestamp() + interval '1 hour', 'closes_at', clock_timestamp() + interval '2 hours',
    'codes', jsonb_build_array('T-ONE', 'T-TWO'),
    'objects', jsonb_build_array('mixing-desk', 'studio-speaker-l', 'courtyard-fountain', 'record-wall', 'artist-counter'));
$$;
create function pg_temp.spot_of(g uuid, code text) returns text language sql as $$
  select spot_id from public.game_time_boxes where game_id = g and game_time_boxes.code = $2;
$$;

-- ------------------------------------------------------------------ fixtures ---
do $t$
declare
  a uuid := pg_temp.newuser(false, 'Ada');   b uuid := pg_temp.newuser(false, 'Bayo');
  c uuid := pg_temp.newuser(false, 'Chi');   d uuid := pg_temp.newuser(false, 'Dami');
  e uuid := pg_temp.newuser(false, 'Efe');   f uuid := pg_temp.newuser(false, 'Fola');
  h uuid := pg_temp.newuser(false, 'Hauwa'); n uuid := pg_temp.newuser(false, 'Nonmember');
  g uuid := pg_temp.newuser(true, 'Guest');  q uuid := pg_temp.newuser(false, 'Queen');
  crew uuid := gen_random_uuid(); pcrew uuid := gen_random_uuid();
begin
  insert into public.crews (id, name, created_by, visibility) values (crew, 'Test 360 Play List', a, 'open'), (pcrew, 'Private hunt', q, 'private');
  insert into public.crew_members (crew_id, user_id, role) values
    (crew, a, 'owner'), (crew, b, 'member'), (crew, c, 'member'), (crew, d, 'member'), (crew, e, 'member'),
    (crew, f, 'member'), (crew, h, 'member'), (crew, g, 'member'), (pcrew, q, 'owner'), (pcrew, a, 'member');
  perform public._crew_room_ensure(crew);
  perform public._crew_room_ensure(pcrew);
  update public.crew_rooms set content = jsonb_set(content, '{brand}', '"360 Play List"') where crew_id = crew;
  perform pg_temp.set('crew', crew::text); perform pg_temp.set('pcrew', pcrew::text);
  perform pg_temp.set('a', a::text); perform pg_temp.set('b', b::text); perform pg_temp.set('c', c::text);
  perform pg_temp.set('d', d::text); perform pg_temp.set('e', e::text); perform pg_temp.set('f', f::text);
  perform pg_temp.set('h', h::text); perform pg_temp.set('n', n::text); perform pg_temp.set('g', g::text); perform pg_temp.set('q', q::text);
end $t$;

-- ============================================================ 1. staff create ===
do $t$
declare
  crew uuid := pg_temp.id('crew'); pcrew uuid := pg_temp.id('pcrew');
  a jsonb := pg_temp.args(crew);
  r jsonb; gid uuid; k int;
begin
  perform pg_temp.create_refuses('"nope"'::jsonb, 'bad_args');
  perform pg_temp.create_refuses(a || '{"bogus": 1}', 'unknown_field');
  perform pg_temp.create_refuses(a || '{"crew_id": "nope"}', 'bad_crew');
  perform pg_temp.create_refuses(a || jsonb_build_object('crew_id', gen_random_uuid()), 'bad_crew');
  perform pg_temp.create_refuses(a || '{"title": "x"}', 'bad_title');
  perform pg_temp.create_refuses(a || '{"title": 5}', 'bad_title');
  perform pg_temp.create_refuses(a - 'opens_at', 'bad_times');
  perform pg_temp.create_refuses(a || '{"opens_at": "garbage"}', 'bad_times');
  perform pg_temp.create_refuses(a || jsonb_build_object('closes_at', clock_timestamp() + interval '30 minutes'), 'bad_times');
  perform pg_temp.create_refuses(a || jsonb_build_object('opens_at', clock_timestamp() - interval '3 hours', 'closes_at', clock_timestamp() - interval '2 hours'), 'in_past');
  perform pg_temp.create_refuses(a || jsonb_build_object('closes_at', clock_timestamp() + interval '9 days'), 'too_long');
  perform pg_temp.create_refuses(a || '{"start_now": "yes"}', 'bad_args');
  perform pg_temp.create_refuses(a || '{"start_now": true}', 'bad_times');
  perform pg_temp.create_refuses((a - 'opens_at' - 'closes_at') || '{"start_now": true}', 'bad_times');
  perform pg_temp.create_refuses((a - 'closes_at') || '{"duration_minutes": 0}', 'bad_times');
  perform pg_temp.create_refuses((a - 'closes_at') || '{"duration_minutes": 99999}', 'bad_times');
  perform pg_temp.create_refuses(a || '{"duration_minutes": 30}', 'bad_times');
  perform pg_temp.create_refuses(a - 'codes', 'bad_codes');
  perform pg_temp.create_refuses(a || '{"codes": []}', 'bad_codes');
  perform pg_temp.create_refuses(a || '{"codes": ["1","2","3","4","5","6","7","8","9","10","11"]}', 'bad_codes');
  perform pg_temp.create_refuses(a || '{"codes": ["Abc", "aBC"]}', 'dup_codes');
  perform pg_temp.create_refuses(a || '{"codes": ["   "]}', 'bad_codes');
  perform pg_temp.create_refuses(a || '{"codes": [7]}', 'bad_codes');
  perform pg_temp.create_refuses(a || jsonb_build_object('codes', jsonb_build_array(E'A\nB')), 'bad_codes');
  perform pg_temp.create_refuses(a || jsonb_build_object('codes', jsonb_build_array(repeat('x', 81))), 'bad_codes');
  perform pg_temp.create_refuses(a - 'objects', 'bad_objects');
  perform pg_temp.create_refuses(a || '{"objects": []}', 'bad_objects');
  perform pg_temp.create_refuses(a || '{"objects": [5]}', 'bad_objects');
  perform pg_temp.create_refuses(a || '{"objects": ["mixing-desk", "mixing-desk"]}', 'bad_objects');
  perform pg_temp.create_refuses(a || '{"objects": ["Mixing Desk"]}', 'bad_objects');
  perform pg_temp.create_refuses(a || '{"codes": ["A"], "objects": ["record-rug"]}', 'unknown_objects');
  perform pg_temp.create_refuses(a || '{"codes": ["A"], "objects": ["entry-map-table"]}', 'unknown_objects');
  perform pg_temp.create_refuses(a || '{"codes": ["A"], "objects": ["no-such-prop"]}', 'unknown_objects');
  perform pg_temp.create_refuses(a || '{"codes": ["A"], "objects": [{"id": "mixing-desk", "x": 9, "y": 9, "w": 1, "h": 1}]}', 'unknown_objects');
  perform pg_temp.create_refuses(a || '{"codes": ["A", "B", "C"], "objects": ["mixing-desk"]}', 'not_enough_spots');
  perform pg_temp.create_refuses(a || '{"room_template": "lounge", "room_width": 30}', 'room_changed');
  perform pg_temp.create_refuses(a || '{"room_template": "clubhouse", "room_width": 36}', 'room_changed');
  perform pg_temp.create_refuses(a || '{"room_template": "clubhouse"}', 'bad_objects');
  perform pg_temp.create_refuses(a || '{"relocate_minutes": 721}', 'bad_relocate');
  perform pg_temp.create_refuses(a || '{"relocate_minutes": -1}', 'bad_relocate');
  perform pg_temp.create_refuses(a || '{"relocate_minutes": "x"}', 'bad_relocate');
  perform pg_temp.create_refuses(a || '{"hot_tiles": 0}', 'bad_tiles');
  perform pg_temp.create_refuses(a || '{"hot_tiles": 5, "warm_tiles": 3}', 'bad_tiles');
  perform pg_temp.create_refuses(a || '{"hot_tiles": 500}', 'bad_tiles');
  perform pg_temp.create_refuses(a || jsonb_build_object('campaign_key', E'bad\nkey'), 'bad_campaign');
  perform pg_temp.create_refuses(a || jsonb_build_object('campaign_key', repeat('k', 81)), 'bad_campaign');
  perform pg_temp.ok((select count(*) from public.game_times where crew_id = crew) = 0, 'no refusal left a game behind');

  -- A good game: opens in an hour, two codes, five objects.
  r := public.admin_game_time_create(a);
  perform pg_temp.ok(r->>'ok' = 'true', 'staff create a game');
  gid := (r->'game'->>'id')::uuid;
  perform pg_temp.set('g1', gid::text);
  perform pg_temp.ok(r->'game'->>'status' = 'upcoming' and r->'game'->>'boxes_total' = '2' and r->'game'->>'boxes_left' = '2'
    and r->'game'->>'campaign_key' = 'crew:' || crew::text and r->'game'->>'relocate_minutes' = '10'
    and r->'game'->>'brand' = '360Playlist' and r->'game'->>'room_template' = 'clubhouse' and r->'game'->>'room_width' = '30',
    'the game is upcoming with its defaults and the brand written 360Playlist');
  perform pg_temp.ok((select array_agg(code order by code) from public.game_time_boxes where game_id = gid) = array['T-ONE', 'T-TWO'], 'one box per code');
  perform pg_temp.ok((select count(distinct spot_id) from public.game_time_boxes where game_id = gid) = 2
    and not exists (select 1 from public.game_time_boxes b where b.game_id = gid and b.spot_id not in (select s.object_id from public.game_time_spots s where s.game_id = gid)),
    'each box hides on its own eligible object');
  perform pg_temp.ok((select x || ',' || y || ',' || w || ',' || h from public.game_time_spots where game_id = gid and object_id = 'mixing-desk') = '2,2,5,1',
    'the rectangle of an object is the room layout''s, not the caller''s');
  perform pg_temp.ok(r->'game' ? 'boxes' and jsonb_array_length(r->'game'->'boxes') = 2 and r->'game'->'boxes'->0 ? 'code', 'staff see the codes and where the boxes hide');

  -- Two games of one crew never overlap; a later window is fine; duration counts from the opening.
  perform pg_temp.create_refuses(a || jsonb_build_object('opens_at', clock_timestamp() + interval '90 minutes', 'closes_at', clock_timestamp() + interval '3 hours'), 'overlaps');
  r := public.admin_game_time_create(((a - 'closes_at') || jsonb_build_object('opens_at', clock_timestamp() + interval '3 hours', 'duration_minutes', 30, 'codes', '["Z-1"]'::jsonb)));
  perform pg_temp.ok(r->>'ok' = 'true' and (r->'game'->>'closes_at')::timestamptz - (r->'game'->>'opens_at')::timestamptz = interval '30 minutes', 'duration_minutes counts from the opening');
  perform pg_temp.ok((public.admin_game_time_close((r->'game'->>'id')::uuid))->>'closed' = 'true', 'staff can cancel a game that has not opened');
  r := public.admin_game_time_create(a || jsonb_build_object('opens_at', clock_timestamp() + interval '5 hours', 'closes_at', clock_timestamp() + interval '6 hours', 'hot_tiles', 100, 'warm_tiles', 200.5));
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'reason' = 'bad_tiles', 'warm tiles go up to 200');
  r := public.admin_game_time_create(a || jsonb_build_object('opens_at', clock_timestamp() + interval '5 hours', 'closes_at', clock_timestamp() + interval '6 hours', 'hot_tiles', 100, 'warm_tiles', 200));
  perform pg_temp.ok(r->>'ok' = 'true' and r->'game'->>'hot_tiles' = '100' and r->'game'->>'warm_tiles' = '200', 'hot tiles go up to 100 and warm to 200');
  perform public.admin_game_time_close((r->'game'->>'id')::uuid);
  perform pg_temp.ok(public._crew_room_hunt_busy(crew), 'a scheduled game keeps the room as it is');

  -- Explicit rectangles are accepted when they match the layout; the private crew gets its own game.
  r := public.admin_game_time_create(jsonb_build_object('crew_id', pcrew, 'title', 'Private hunt', 'opens_at', clock_timestamp() + interval '30 minutes',
    'closes_at', clock_timestamp() + interval '90 minutes', 'codes', '["P-1"]'::jsonb, 'campaign_key', 'gt-shared-key',
    'objects', '[{"id": "mixing-desk", "x": 2, "y": 2, "w": 5, "h": 1}, "studio-speaker-l"]'::jsonb,
    'room_template', 'clubhouse', 'room_width', 30));
  perform pg_temp.ok(r->>'ok' = 'true', 'objects may come with the layout''s own rectangles');
  perform pg_temp.set('gp', r->'game'->>'id');
end $t$;

-- ===================================================== 2. before it opens ===
do $t$
declare
  crew uuid := pg_temp.id('crew'); pcrew uuid := pg_temp.id('pcrew'); gid uuid := pg_temp.id('g1');
  a uuid := pg_temp.id('a'); b uuid := pg_temp.id('b'); n uuid := pg_temp.id('n'); q uuid := pg_temp.id('q');
  s jsonb; l jsonb;
begin
  s := pg_temp.state(crew, b);
  perform pg_temp.ok(s->'game'->>'status' = 'upcoming' and s->'game'->>'id' = gid::text and s->'game'->'objects' = '[]'::jsonb
    and (s->'game'->>'opens_at')::timestamptz > (s->>'server_now')::timestamptz and s->'me'->>'member' = 'true' and s->'me'->>'can_search' = 'false',
    'a member sees the countdown, no objects, and cannot search yet');
  s := pg_temp.state(crew, n);
  perform pg_temp.ok(s->'game'->>'status' = 'upcoming' and s->'me'->>'member' = 'false' and s->'me'->>'can_search' = 'false',
    'a non-member of an open crew sees the game and is told they are not in');
  perform pg_temp.anon();
  s := public.game_time_state(crew);
  perform pg_temp.admin();
  perform pg_temp.ok(s->'game'->>'status' = 'upcoming', 'a visitor with no session reads the countdown of an open crew');
  perform pg_temp.ok(pg_temp.state(pcrew, n) is null, 'a private crew''s game is not shown to someone outside it');
  perform pg_temp.ok(pg_temp.state(pcrew, q)->'game'->>'title' = 'Private hunt', 'it is shown to its members');

  perform pg_temp.actor(n); l := public.game_time_list(); perform pg_temp.admin();
  perform pg_temp.ok((select count(*) from jsonb_array_elements(l->'games') x where x->>'crew_id' = pcrew::text) = 0
    and (select count(*) from jsonb_array_elements(l->'games') x where x->>'id' = gid::text and x->>'is_member' = 'false' and x->>'brand' = '360Playlist') = 1,
    'the global ping lists the open crew''s game for a non-member (JOIN THE CREW TO HUNT)');
  perform pg_temp.actor(a); l := public.game_time_list(); perform pg_temp.admin();
  perform pg_temp.ok((select count(*) from jsonb_array_elements(l->'games') x where x->>'crew_id' in (crew::text, pcrew::text) and x->>'is_member' = 'true') = 2,
    'a member sees both games, and that they are in (ENTER ROOM)');
  perform pg_temp.anon(); l := public.game_time_list(); perform pg_temp.admin();
  perform pg_temp.ok((select count(*) from jsonb_array_elements(l->'games') x where x->>'crew_id' = crew::text) = 1
    and (select count(*) from jsonb_array_elements(l->'games') x where x->>'crew_id' = pcrew::text) = 0, 'a visitor sees the open crew''s game only');

  perform pg_temp.refuse(crew, b, 'mixing-desk', 'not_open_yet');
  perform pg_temp.ok((select push_sent_at from public.game_times where id = gid) is null, 'the opening push waits for the opening');
end $t$;

-- ==================================================== 3. live: who and where ===
do $t$
declare
  crew uuid := pg_temp.id('crew'); gid uuid := pg_temp.id('g1');
  a uuid := pg_temp.id('a'); b uuid := pg_temp.id('b'); c uuid := pg_temp.id('c'); d uuid := pg_temp.id('d');
  g uuid := pg_temp.id('g'); n uuid := pg_temp.id('n');
  r jsonb; dtl text; s jsonb;
begin
  r := public.admin_game_time_start_now(gid);
  perform pg_temp.ok(r->>'ok' = 'true' and r->>'started' = 'true' and r->'game'->>'status' = 'live'
    and abs(extract(epoch from (r->'game'->>'opens_at')::timestamptz - clock_timestamp())) < 5, 'START NOW opens the game this second');
  perform pg_temp.ok((public.admin_game_time_start_now(gid))->>'started' = 'false', 'START NOW on a live game changes nothing');
  perform pg_temp.arrange(gid, array['T-ONE', 'T-TWO'], array['mixing-desk', 'courtyard-fountain']);

  s := pg_temp.state(crew, b);
  perform pg_temp.ok(s->'game'->>'status' = 'live' and s->'game'->'objects' = '["artist-counter","courtyard-fountain","mixing-desk","record-wall","studio-speaker-l"]'::jsonb
    and s->'me'->>'can_search' = 'true' and s->'game'->>'boxes_left' = '2' and s->'game'->>'search_gap_ms' = '3000', 'live: a member gets the eligible objects and may search');
  s := pg_temp.state(crew, n);
  perform pg_temp.ok(s->'game'->'objects' = '[]'::jsonb and s->'me'->>'can_search' = 'false', 'a non-member gets no objects');
  s := pg_temp.state(crew, g);
  perform pg_temp.ok(s->'me'->>'member' = 'true' and s->'me'->>'can_search' = 'false', 'a guest (no email) cannot search');

  -- who
  perform pg_temp.refuse(crew, n, 'mixing-desk', 'not_in_crew');
  perform pg_temp.refuse(crew, g, 'mixing-desk', 'need_account');
  perform pg_temp.fail_anon(format('select public.game_time_search(%L, %L)', crew, 'mixing-desk'), 'permission denied');
  perform pg_temp.refuse(crew, d, 'mixing-desk', 'not_in_room');                          -- never walked in
  perform pg_temp.place(crew, d, 3, 3);
  update public.crew_room_presence set last_seen = clock_timestamp() - interval '2 minutes' where crew_id = crew and user_id = d;
  perform pg_temp.refuse(crew, d, 'mixing-desk', 'not_in_room', true, false);              -- walker timed out
  perform pg_temp.refuse(pg_temp.id('pcrew'), pg_temp.id('a'), 'mixing-desk', 'not_open_yet');   -- the private crew's game is still ahead

  -- where: a Hopper at the right tile, an object that is not in the game, and tiles that are too far
  perform pg_temp.place(crew, b, 3, 3);
  perform pg_temp.refuse(crew, b, 'record-rug', 'unknown_object');
  perform pg_temp.refuse(crew, b, 'no-such-prop', 'unknown_object');
  perform pg_temp.refuse(crew, b, null, 'unknown_object');
  perform pg_temp.refuse(crew, b, 'entry-map-table', 'unknown_object');
  perform pg_temp.place(crew, b, 8, 3);      -- two columns past the desk
  perform pg_temp.refuse(crew, b, 'mixing-desk', 'too_far');
  perform pg_temp.place(crew, b, 4, 4);      -- two rows below the desk
  perform pg_temp.refuse(crew, b, 'mixing-desk', 'too_far');
  perform pg_temp.place(crew, b, 14, 14);
  perform pg_temp.refuse(crew, b, 'courtyard-fountain', 'too_far');
  perform pg_temp.place(crew, b, 17, 9);     -- fountain is x 14..15, so x 17 is two away
  perform pg_temp.refuse(crew, b, 'courtyard-fountain', 'too_far');
  perform pg_temp.ok((select count(*) from public.game_time_players where game_id = gid) = 0, 'a refused search is not counted');
  perform pg_temp.ok((select count(*) from public.game_time_rate where user_id = b) = 0, 'a refused search does not use the gap');

  -- diagonals count as one tile away (a watcher past the room cap has no walker, which is the not_in_room above)
  r := pg_temp.go(crew, b, 3, 4, 'studio-speaker-l');
  perform pg_temp.ok(r->>'result' = 'nothing', 'one tile away on the diagonal is close enough');

  -- pace: a second search straight away is refused with the wait in the error detail
  dtl := pg_temp.refuse(crew, b, 'studio-speaker-l', 'slow_down', false);
  perform pg_temp.ok(dtl::int between 1 and 2500, 'slow_down says how long to wait, in ms (' || dtl || ')');
  update public.game_time_rate set last_at = last_at - interval '3 seconds' where user_id = b;
  r := pg_temp.go(crew, b, 3, 4, 'studio-speaker-l', false);
  perform pg_temp.ok(r->>'result' = 'nothing' and r->>'retry_ms' = '3000', 'after the gap a search goes through, and tells the app to wait 3000 ms');
  update public.game_time_rate set last_at = last_at - interval '3 seconds' where user_id = b;
  perform pg_temp.place(crew, b, 14, 14);
  perform pg_temp.refuse(crew, b, 'courtyard-fountain', 'too_far', false);
  r := pg_temp.go(crew, b, 3, 4, 'studio-speaker-l', false);
  perform pg_temp.ok(r->>'result' = 'nothing', 'a refused search in between did not eat the gap');

  perform pg_temp.ok((select searches from public.game_time_players where game_id = gid and user_id = b) = 3, 'counted searches: the three that were answered');
end $t$;

-- ============================================================= 4. the hint ===
do $t$
declare
  crew uuid := pg_temp.id('crew'); gid uuid := pg_temp.id('g1'); b uuid := pg_temp.id('b'); c uuid := pg_temp.id('c');
  r jsonb;
begin
  -- boxes: T-ONE on the mixing desk (centre 4,2) and T-TWO on the fountain (centre 14.5,9.5)
  r := pg_temp.go(crew, b, 3, 3, 'studio-speaker-l');      -- centre 2,3: 2.2 tiles from the desk
  perform pg_temp.ok(r->>'result' = 'nothing' and r->>'hint' = 'hot' and r->>'boxes_left' = '2' and r->>'object' = 'studio-speaker-l', 'hot: a box is within 5 tiles');
  r := pg_temp.go(crew, b, 2, 12, 'record-wall');           -- centre 2.5,11: 9.1 tiles from the desk
  perform pg_temp.ok(r->>'hint' = 'warm', 'warm: a box is within 10 tiles');
  r := pg_temp.go(crew, b, 23, 16, 'artist-counter');       -- centre 23,17: 11.3 tiles from the fountain
  perform pg_temp.ok(r->>'hint' = 'cold', 'cold: nothing within 10 tiles');
  perform pg_temp.ok(not (r ? 'code') and not (r ? 'spot') and not (r ? 'box') and not (r ? 'near'), 'an empty search tells nothing but hot, warm or cold');
  -- staff can tune the rings while the game is live
  perform pg_temp.ok((public.admin_game_time_update(gid, '{"hot_tiles": 12, "warm_tiles": 30}'))->>'ok' = 'true', 'staff tune the hint rings');
  r := pg_temp.go(crew, b, 23, 16, 'artist-counter');
  perform pg_temp.ok(r->>'hint' = 'hot', 'a wider hot ring makes the same search hot');
  perform pg_temp.update_refuses(gid, '{"hot_tiles": 20, "warm_tiles": 10}', 'bad_tiles');
  perform public.admin_game_time_update(gid, '{"hot_tiles": 5, "warm_tiles": 10}');
  -- the hint is measured to the boxes still hiding, never to one that was found
  update public.game_time_boxes set claimed_by = c, claimed_at = clock_timestamp() where game_id = gid and code = 'T-ONE';
  r := pg_temp.go(crew, b, 3, 3, 'studio-speaker-l');
  perform pg_temp.ok(r->>'hint' = 'cold' and r->>'boxes_left' = '1', 'a found box no longer warms the room');
  update public.game_time_boxes set claimed_by = null, claimed_at = null where game_id = gid and code = 'T-ONE';
end $t$;

-- ========================================================= 5. winning and ends ===
do $t$
declare
  crew uuid := pg_temp.id('crew'); gid uuid := pg_temp.id('g1');
  a uuid := pg_temp.id('a'); b uuid := pg_temp.id('b'); c uuid := pg_temp.id('c');
  r jsonb; s jsonb; sb jsonb; w jsonb; txt text;
begin
  -- Ada finds the box on the mixing desk
  r := pg_temp.go(crew, a, 3, 3, 'mixing-desk');
  perform pg_temp.ok(r->>'result' = 'win' and r->>'code' = 'T-ONE' and r->>'boxes_left' = '1' and r->>'object' = 'mixing-desk'
    and r->>'game_id' = gid::text and r->>'title' = 'Find the box' and r ? 'won_at' and r->>'game_over' = 'false' and r->>'retry_ms' = '3000'
    and r->>'feed_tail' = (select max(id)::text from public.game_time_feed where game_id = gid), 'the first finder wins the code, and learns where the feed stands');
  perform pg_temp.ok((select claimed_by from public.game_time_boxes where game_id = gid and code = 'T-ONE') = a, 'the box is hers');
  perform pg_temp.ok((select count(*) from public.game_time_wins where game_id = gid) = 1, 'one win is recorded');
  perform pg_temp.ok((select name || '/' || object_id || '/' || boxes_left from public.game_time_feed where game_id = gid) = 'Ada/mixing-desk/1', 'the room is told Ada found a box, not what code');
  -- one win per account per campaign
  perform pg_temp.refuse(crew, a, 'courtyard-fountain', 'already_won');
  s := pg_temp.state(crew, a);
  perform pg_temp.ok(s->'me'->>'won' = 'true' and s->'me'->>'code' = 'T-ONE' and s->'me'->>'can_search' = 'false', 'the winner is shown their code and cannot search again');
  -- everyone else
  sb := pg_temp.state(crew, b);
  txt := sb::text;
  perform pg_temp.ok(sb->'game'->>'boxes_left' = '1' and sb->'game'->'found'->0->>'name' = 'Ada' and sb->'game'->'found'->0->>'object' = 'mixing-desk'
    and sb->'game'->>'feed_tail' = (select max(id)::text from public.game_time_feed where game_id = gid), 'the box is gone for the room: one left, and who found it');
  perform pg_temp.ok(txt not like '%T-ONE%' and txt not like '%T-TWO%' and sb->'me'->>'code' is null, 'no other Hopper''s state ever holds a code');
  perform pg_temp.ok(not (sb::text like '%"spot"%'), 'nor where a box hides');
  r := pg_temp.go(crew, b, 3, 3, 'mixing-desk');
  perform pg_temp.ok(r->>'result' = 'nothing' and r->>'boxes_left' = '1' and r->>'feed_tail' = (select max(id)::text from public.game_time_feed where game_id = gid),
    'searching where the box was found now finds nothing, and the answer carries the feed tail so the app sees the find at once');
  perform pg_temp.actor(a); w := public.my_game_time_wins(); perform pg_temp.admin();
  perform pg_temp.ok(jsonb_array_length(w) = 1 and w->0->>'code' = 'T-ONE' and w->0->>'title' = 'Find the box' and w->0->>'brand' = '360Playlist', 'Your tickets lists the code');
  perform pg_temp.actor(b); w := public.my_game_time_wins(); perform pg_temp.admin();
  perform pg_temp.ok(w = '[]'::jsonb, 'and only to its winner');
  perform pg_temp.fail_anon('select public.my_game_time_wins()', 'permission denied');

  -- Bayo finds the last one: the game is over for everyone
  r := pg_temp.go(crew, b, 13, 9, 'courtyard-fountain');
  perform pg_temp.ok(r->>'result' = 'win' and r->>'code' = 'T-TWO' and r->>'boxes_left' = '0' and r->>'game_over' = 'true', 'the last box is won, and the answer says the game is over');
  s := pg_temp.state(crew, c);
  perform pg_temp.ok(s->'game'->>'status' = 'over' and s->'game'->>'over_reason' = 'all_found' and s->'game'->'objects' = '[]'::jsonb
    and s->'game'->>'boxes_left' = '0' and s->'game'->>'ended_at' is not null and s->'me'->>'can_search' = 'false',
    'all found: the end state is clear and the objects stop shimmering');
  perform pg_temp.place(crew, c, 3, 3);
  perform pg_temp.refuse(crew, c, 'mixing-desk', 'all_found');
  perform pg_temp.ok((public.admin_game_time_close(gid))->>'closed' = 'false', 'CLOSE NOW on a finished game changes nothing');
  perform pg_temp.update_refuses(gid, '{"title": "Late"}', 'ended');
  perform pg_temp.ok((public.admin_game_time_start_now(gid))->>'reason' = 'ended', 'START NOW on a finished game is refused');
  perform pg_temp.ok(not public._crew_room_hunt_busy(crew), 'a finished game no longer holds the room');
  perform pg_temp.ok((select count(*) from public.game_time_feed where game_id = gid) = 2, 'two finds, two lines in the feed');
end $t$;

-- ======================================== 6. campaigns, closing, time up, staff ===
do $t$
declare
  crew uuid := pg_temp.id('crew'); pcrew uuid := pg_temp.id('pcrew');
  a uuid := pg_temp.id('a'); b uuid := pg_temp.id('b'); c uuid := pg_temp.id('c'); q uuid := pg_temp.id('q');
  g1 uuid := pg_temp.id('g1'); g2 uuid; g3 uuid; gp uuid := pg_temp.id('gp');
  r jsonb; s jsonb; l jsonb; rows jsonb;
begin
  -- The crew's next game shares one limit: Ada and Bayo have won, Chi has not.
  r := public.admin_game_time_create((pg_temp.args(crew) - 'opens_at' - 'closes_at') || '{"start_now": true, "duration_minutes": 60, "codes": ["T-3", "T-4"]}');
  perform pg_temp.ok(r->>'ok' = 'true' and r->'game'->>'status' = 'live', 'staff create a game that starts now');
  g2 := (r->'game'->>'id')::uuid;
  perform pg_temp.arrange(g2, array['T-3', 'T-4'], array['record-wall', 'artist-counter']);
  perform pg_temp.refuse(crew, a, 'record-wall', 'already_won');
  perform pg_temp.refuse(crew, b, 'record-wall', 'already_won');
  r := pg_temp.go(crew, c, 2, 12, 'record-wall');
  perform pg_temp.ok(r->>'result' = 'win' and r->>'code' = 'T-3', 'a Hopper who has not won yet can');
  perform pg_temp.update_refuses(g2, '{"campaign_key": "other"}', 'campaign_locked');
  perform pg_temp.update_refuses(g2, '{"codes": ["Q-1", "Q-2"]}', 'codes_locked');

  -- A staff-chosen campaign key is its own limit, and it is shared across crews that use it.
  perform pg_temp.ok((public.admin_game_time_close(g2))->>'closed' = 'true', 'CLOSE NOW ends a live game');
  s := pg_temp.state(crew, b);
  perform pg_temp.ok(s->'game'->>'status' = 'over' and s->'game'->>'over_reason' = 'closed', 'closed: the end state says so');
  perform pg_temp.place(crew, b, 23, 16);
  perform pg_temp.refuse(crew, b, 'artist-counter', 'game_closed');
  update public.game_times set ended_at = clock_timestamp() - interval '31 minutes' where id in (g1, g2);
  perform pg_temp.ok(pg_temp.state(crew, b)->'game' = 'null'::jsonb, 'half an hour after it ended the room stops talking about it');
  perform pg_temp.refuse(crew, b, 'artist-counter', 'no_game');

  r := public.admin_game_time_create((pg_temp.args(crew) - 'opens_at' - 'closes_at') || '{"start_now": true, "duration_minutes": 60, "campaign_key": "gt-shared-key", "codes": ["K-1", "K-2"]}');
  g3 := (r->'game'->>'id')::uuid;
  perform pg_temp.arrange(g3, array['K-1', 'K-2'], array['mixing-desk', 'courtyard-fountain']);
  r := pg_temp.go(crew, a, 3, 3, 'mixing-desk');
  perform pg_temp.ok(r->>'result' = 'win' and r->>'code' = 'K-1', 'Ada has won the crew''s campaign, but a new campaign key is a new limit');
  perform pg_temp.refuse(crew, a, 'courtyard-fountain', 'already_won');
  -- the private crew's game uses the same key: Ada cannot win twice across crews, Queen can
  perform public.admin_game_time_start_now(gp);
  perform pg_temp.arrange(gp, array['P-1'], array['mixing-desk']);
  perform pg_temp.place(pcrew, a, 3, 3);
  perform pg_temp.refuse(pcrew, a, 'mixing-desk', 'already_won');
  r := pg_temp.go(pcrew, q, 3, 3, 'mixing-desk');
  perform pg_temp.ok(r->>'result' = 'win' and r->>'code' = 'P-1', 'one limit per campaign key across crews');

  -- Time up: the window ran out without anyone closing it.
  update public.game_times set opens_at = clock_timestamp() - interval '2 hours', closes_at = clock_timestamp() - interval '1 second' where id = g3;
  s := pg_temp.state(crew, b);
  perform pg_temp.ok(s->'game'->>'status' = 'over' and s->'game'->>'over_reason' = 'time_up', 'time up: the end state says so');
  perform pg_temp.place(crew, c, 13, 9);
  perform pg_temp.refuse(crew, c, 'courtyard-fountain', 'game_closed');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements((select public.game_time_list()->'games')) x where x->>'id' = g3::text), 'a game out of time leaves the ping');

  -- staff: list, status, winners, export rows
  l := public.admin_game_time_list();
  perform pg_temp.ok(l->>'ok' = 'true' and jsonb_array_length(l->'games') >= 4 and not (l->'games'->0 ? 'boxes'), 'the staff list holds every game, newest first, without the codes');
  r := public.admin_game_time_status(g1);
  perform pg_temp.ok(r->'game'->>'claims' = '2' and r->'game'->>'searchers' = '2' and jsonb_array_length(r->'game'->'boxes') = 2
    and (select bool_and(x ? 'code' and x->>'claimed_by' is not null and x->>'handle' is not null) from jsonb_array_elements(r->'game'->'boxes') x),
    'staff see who found which box');
  perform pg_temp.ok((public.admin_game_time_status(gen_random_uuid()))->>'reason' = 'not_found', 'an unknown game is not found');
  rows := (public.admin_game_time_winners(g1))->'winners';
  perform pg_temp.ok(jsonb_array_length(rows) = 2 and rows->0->>'code' = 'T-ONE' and rows->0->>'name' = 'Ada' and rows->0->>'handle' like 'ada\_%'
    and rows->0->>'email' like 'gt-%@gametime.invalid' and rows->1->>'code' = 'T-TWO' and rows->0->>'object' = 'mixing-desk' and rows->0->>'crew_name' = 'Test 360 Play List',
    'winners: handle, name, email, code, object, oldest first');
  perform pg_temp.ok(jsonb_array_length((public.admin_game_time_winners(null))->'winners') >= 5, 'all winners, every game');
end $t$;

-- ============================================ 7. relocation and a changed room ===
do $t$
declare
  crew uuid := pg_temp.id('crew');
  a uuid := pg_temp.id('a'); d uuid := pg_temp.id('d'); h uuid := pg_temp.id('h');
  g5 uuid; r jsonb; s jsonb; old1 text; old2 text; moved int;
begin
  r := public.admin_game_time_create((pg_temp.args(crew) - 'opens_at' - 'closes_at') || '{"start_now": true, "duration_minutes": 120, "relocate_minutes": 1, "codes": ["R-1", "R-2"]}');
  perform pg_temp.ok(r->>'ok' = 'true', 'a game for relocation');
  g5 := (r->'game'->>'id')::uuid;
  perform pg_temp.arrange(g5, array['R-1', 'R-2'], array['mixing-desk', 'courtyard-fountain']);

  -- the time is counted from the later of the box's last placement and the opening
  update public.game_time_boxes set placed_at = clock_timestamp() - interval '2 minutes' where game_id = g5;
  perform pg_temp.ok(public._gt_relocate(g5) = 0, 'a box does not move for time before the game opened');
  update public.game_times set opens_at = clock_timestamp() - interval '1 hour' where id = g5;
  update public.game_time_boxes set placed_at = clock_timestamp() - interval '30 seconds' where game_id = g5;
  perform pg_temp.ok(public._gt_relocate(g5) = 0, 'a box that has waited under the time does not move');
  update public.game_time_boxes set placed_at = clock_timestamp() - interval '2 minutes' where game_id = g5;
  old1 := pg_temp.spot_of(g5, 'R-1'); old2 := pg_temp.spot_of(g5, 'R-2');
  moved := public._gt_relocate(g5);
  perform pg_temp.ok(moved = 2 and pg_temp.spot_of(g5, 'R-1') <> old1 and pg_temp.spot_of(g5, 'R-2') <> old2, 'a box nobody found for the time moves to another object');
  perform pg_temp.ok(pg_temp.spot_of(g5, 'R-1') <> pg_temp.spot_of(g5, 'R-2')
    and pg_temp.spot_of(g5, 'R-1') in (select object_id from public.game_time_spots where game_id = g5)
    and pg_temp.spot_of(g5, 'R-2') in (select object_id from public.game_time_spots where game_id = g5), 'on an eligible object, never two boxes on one');
  perform pg_temp.ok((select min(placed_at) from public.game_time_boxes where game_id = g5) > clock_timestamp() - interval '10 seconds', 'and its clock starts again');

  -- a search that arrives after the time moves the box first: R-1 is overdue on the desk, R-2 is not
  perform pg_temp.arrange(g5, array['R-1', 'R-2'], array['mixing-desk', 'courtyard-fountain']);
  update public.game_time_boxes set placed_at = clock_timestamp() where game_id = g5;
  update public.game_time_boxes set placed_at = clock_timestamp() - interval '2 minutes' where game_id = g5 and code = 'R-1';
  r := pg_temp.go(crew, h, 3, 3, 'mixing-desk');
  perform pg_temp.ok(r->>'result' = 'nothing' and pg_temp.spot_of(g5, 'R-1') <> 'mixing-desk' and pg_temp.spot_of(g5, 'R-2') = 'courtyard-fountain',
    'a box that had waited too long is not where the searcher expected, and the other box stayed');

  -- a box that is not overdue is where it was put; a found box never moves
  perform pg_temp.arrange(g5, array['R-1', 'R-2'], array['mixing-desk', 'courtyard-fountain']);
  update public.game_time_boxes set placed_at = clock_timestamp() where game_id = g5;
  r := pg_temp.go(crew, h, 3, 3, 'mixing-desk');
  perform pg_temp.ok(r->>'result' = 'win' and r->>'code' = 'R-1', 'a box inside its time is still where it was put');
  update public.game_time_boxes set placed_at = clock_timestamp() - interval '2 minutes' where game_id = g5;
  perform public._gt_relocate(g5);
  perform pg_temp.ok(pg_temp.spot_of(g5, 'R-1') = 'mixing-desk' and pg_temp.spot_of(g5, 'R-2') <> 'courtyard-fountain', 'a found box does not move; the one still hiding does');

  -- relocate_minutes 0 never moves; with one object left there is nowhere to go, so the box stays and waits again
  perform public.admin_game_time_update(g5, '{"relocate_minutes": 0}');
  update public.game_time_boxes set placed_at = clock_timestamp() - interval '9 hours' where game_id = g5;
  old2 := pg_temp.spot_of(g5, 'R-2');
  moved := public._gt_relocate(g5);
  perform pg_temp.ok(moved = 0 and pg_temp.spot_of(g5, 'R-2') = old2, 'relocate_minutes 0: never');
  r := public.admin_game_time_update(g5, '{"relocate_minutes": 1, "objects": ["courtyard-fountain"]}');
  perform pg_temp.ok(r->>'ok' = 'true' and (select count(*) from public.game_time_spots where game_id = g5) = 1 and pg_temp.spot_of(g5, 'R-2') = 'courtyard-fountain',
    'staff narrow the objects; a box on a removed object moves to a free one');
  update public.game_time_boxes set placed_at = clock_timestamp() - interval '9 hours' where game_id = g5 and claimed_by is null;
  moved := public._gt_relocate(g5);
  perform pg_temp.ok(moved = 0 and pg_temp.spot_of(g5, 'R-2') = 'courtyard-fountain'
    and (select placed_at from public.game_time_boxes where game_id = g5 and code = 'R-2') > clock_timestamp() - interval '10 seconds', 'no free object: the box stays and waits again');
  s := public.game_time_tick();
  perform pg_temp.ok(s ? 'pushed' and s ? 'moved' and (s->>'failed')::int = 0, 'the minute tick runs');
  perform pg_temp.update_refuses(g5, '{"objects": ["courtyard-fountain", "record-rug"]}', 'unknown_objects');
  perform pg_temp.update_refuses(g5, '{"objects": []}', 'bad_objects');
  perform pg_temp.update_refuses(g5, '{"codes": ["R-1", "R-2", "R-3"]}', 'codes_locked');

  -- the room changes under the game (someone widens it): searches stop until staff save the objects again
  perform public.admin_game_time_update(g5, '{"objects": ["courtyard-fountain", "record-wall", "artist-counter"]}');
  update public.crew_rooms set width = 36 where crew_id = crew;
  s := pg_temp.state(crew, d);
  perform pg_temp.ok(s->'game'->>'room_ok' = 'false' and s->'game'->'objects' = '[]'::jsonb and s->'me'->>'can_search' = 'false', 'room changed: nobody may search');
  perform pg_temp.place(crew, d, 13, 9);
  perform pg_temp.refuse(crew, d, 'courtyard-fountain', 'room_changed');
  perform pg_temp.update_refuses(g5, '{"objects": ["courtyard-fountain"], "room_template": "clubhouse", "room_width": 30}', 'room_changed');
  perform pg_temp.update_refuses(g5, '{"room_width": 36}', 'bad_objects');
  r := public.admin_game_time_update(g5, '{"objects": ["courtyard-fountain", "record-wall", "artist-counter"], "room_template": "clubhouse", "room_width": 36}');
  perform pg_temp.ok(r->>'ok' = 'true' and r->'game'->>'room_ok' = 'true' and r->'game'->>'room_width' = '36', 'staff save the objects again for the new room');
  perform pg_temp.ok((select x from public.game_time_spots where game_id = g5 and object_id = 'courtyard-fountain') = 17, 'the rectangles follow the wider room');
  perform pg_temp.ok(pg_temp.state(crew, d)->'game'->>'room_ok' = 'true', 'and the room can search again');
  perform pg_temp.ok((select count(*) from public.game_time_boxes where game_id = g5 and claimed_by is null and spot_id in (select object_id from public.game_time_spots where game_id = g5)) = 1,
    'the box still hiding is still on an eligible object');
  update public.crew_rooms set width = 30 where crew_id = crew;

  -- a live game holds the room: the owner cannot resize it or swap its template until it ends
  perform pg_temp.fail_as(a, format('select public.crew_room_settings(%L, 36, (select content from public.crew_rooms where crew_id = %L))', crew, crew), 'hunt_in_progress');
  perform pg_temp.ok(public._crew_room_hunt_busy(crew), 'a live game holds the room');
  perform public.admin_game_time_close(g5);
  perform pg_temp.ok(not public._crew_room_hunt_busy(crew), 'closing it frees the room');

  -- the search never takes the room lock, and the claim is a conditional update
  perform pg_temp.ok(position('_crew_room_lock' in pg_get_functiondef('public.game_time_search(uuid,text)'::regprocedure)) = 0, 'a search does not wait on the crew room lock');
  perform pg_temp.ok(pg_get_functiondef('public.game_time_search(uuid,text)'::regprocedure) ~ 'update game_time_boxes set claimed_by = me[^;]*claimed_by is null', 'the claim is a conditional update');
end $t$;

-- ================================================================== 8. push ===
do $t$
declare
  crew uuid := pg_temp.id('crew');
  a uuid := pg_temp.id('a'); b uuid := pg_temp.id('b'); c uuid := pg_temp.id('c');
  e uuid := pg_temp.id('e'); f uuid := pg_temp.id('f'); n uuid := pg_temp.id('n');
  gid uuid := gen_random_uuid(); og uuid := gen_random_uuid();
  r jsonb; got uuid[]; want uuid[]; queued int; hour int; body jsonb; cnt int; sent int;
begin
  -- who hears: a subscription, alerts not Off, not walking in the room now, not already a winner of this campaign
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select u, 'https://fcm.googleapis.com/fcm/send/gt-' || u::text, repeat('p', 30), repeat('a', 12) from unnest(array[a, b, c, e, f, n]) u;
  insert into public.alert_prefs (user_id, alert_level) values (c, 'off');
  update public.crew_room_presence set last_seen = clock_timestamp() - interval '2 minutes' where crew_id = crew;   -- nobody is in the room ...
  perform pg_temp.place(crew, e, 15, 17);                                                                          -- ... except Efe
  -- an old game of the same campaign that Fola won, and the game that is about to open
  insert into public.game_times (id, crew_id, title, opens_at, closes_at, campaign_key, ended_at, ended_by)
  values (og, crew, 'Old push game', clock_timestamp() - interval '3 hours', clock_timestamp() - interval '2 hours', 'push-test-key', clock_timestamp() - interval '2 hours', 'closed');
  insert into public.game_time_spots (game_id, object_id, x, y, w, h) values (og, 'mixing-desk', 2, 2, 5, 1);
  insert into public.game_time_boxes (game_id, code, spot_id, claimed_by, claimed_at) values (og, 'OLD-1', 'mixing-desk', f, clock_timestamp() - interval '2 hours');
  insert into public.game_time_wins (game_id, box_id, user_id, campaign_key, code)
  values (og, (select id from public.game_time_boxes where game_id = og), f, 'push-test-key', 'OLD-1');
  insert into public.game_times (id, crew_id, title, opens_at, closes_at, campaign_key)
  values (gid, crew, 'Push game', clock_timestamp() + interval '1 hour', clock_timestamp() + interval '2 hours', 'push-test-key');
  insert into public.game_time_spots (game_id, object_id, x, y, w, h) values (gid, 'mixing-desk', 2, 2, 5, 1);
  insert into public.game_time_boxes (game_id, code, spot_id) values (gid, 'PUSH-1', 'mixing-desk');
  select array_agg(x order by x) into got from public._gt_open_recipients(gid) x;
  select array_agg(u order by u) into want from unnest(array[a, b]) u;
  perform pg_temp.ok(got = want, 'the opening push goes to members with a subscription, alerts not off, not in the room, not already winners');

  -- not before it opens
  sent := public._gt_notify_open(gid);
  perform pg_temp.ok(sent = 0 and (select push_sent_at from public.game_times where id = gid) is null, 'nothing is sent before the opening');

  -- set the push path up inside this transaction only (it rolls back with everything else)
  perform public.set_push_config('send_url', 'http://push.invalid/api/push/send');
  perform public.set_push_config('send_secret', 'test-secret-not-real');
  update public.game_times set opens_at = clock_timestamp() - interval '1 minute' where id = gid;
  hour := extract(hour from clock_timestamp() at time zone 'Africa/Lagos')::int;

  -- quiet hours: nothing is sent, and it is not tried again
  perform public.set_push_config('quiet_from_hour', hour::text);
  perform public.set_push_config('quiet_until_hour', ((hour + 1) % 24)::text);
  select count(*) into queued from net.http_request_queue;
  sent := public._gt_notify_open(gid);
  perform pg_temp.ok(sent = 0 and (select push_sent_at from public.game_times where id = gid) is not null
    and (select push_count from public.game_times where id = gid) = 0 and (select count(*) from net.http_request_queue) = queued,
    'quiet hours: no push, and the game is marked so it is not tried again');

  -- awake: one request to the existing send route, with the shared secret, for the right people
  update public.game_times set push_sent_at = null, push_count = null where id = gid;
  perform public.set_push_config('quiet_from_hour', ((hour + 2) % 24)::text);
  perform public.set_push_config('quiet_until_hour', ((hour + 3) % 24)::text);
  sent := public._gt_notify_open(gid);
  perform pg_temp.ok(sent = 2, 'the push is sent to the two Hoppers who should hear');
  select count(*) into cnt from net.http_request_queue where url = 'http://push.invalid/api/push/send';
  perform pg_temp.ok(cnt = 1, 'one request is queued for the existing send route');
  select convert_from(q.body, 'utf8')::jsonb into body from net.http_request_queue q where q.url = 'http://push.invalid/api/push/send';
  perform pg_temp.ok(jsonb_array_length(body->'alerts') = 2
    and body->'alerts'->0->>'url' = '/crew/' || crew::text || '/room' and body->'alerts'->0->>'tag' = 'game-time-' || gid::text
    and body->'alerts'->0->>'title' = 'GAME TIME in the 360Playlist room' and body->'alerts'->0->>'body' = '1 box is hiding. First to find it wins a ticket. Run!'
    and (select array_agg((x->>'user_id')::uuid order by (x->>'user_id')::uuid) from jsonb_array_elements(body->'alerts') x) = want,
    'each alert deep-links into the room, says 360Playlist, and goes to the right Hoppers');
  perform pg_temp.ok((select q.headers->>'Authorization' from net.http_request_queue q where q.url = 'http://push.invalid/api/push/send') = 'Bearer test-secret-not-real',
    'it is signed with the existing send secret, no new one');
  perform pg_temp.ok((select push_count from public.game_times where id = gid) = 2, 'the game remembers how many were alerted');
  sent := public._gt_notify_open(gid);
  perform pg_temp.ok(sent = 0, 'never twice');
  -- too late: more than 10 minutes after the opening is never sent
  update public.game_times set push_sent_at = null, opens_at = clock_timestamp() - interval '11 minutes' where id = gid;
  sent := public._gt_notify_open(gid);
  perform pg_temp.ok(sent = 0 and (select push_sent_at from public.game_times where id = gid) is null, 'never more than 10 minutes late');
  -- push not set up: nothing is sent and it can be tried again
  update public.game_times set opens_at = clock_timestamp() - interval '1 minute' where id = gid;
  perform public.set_push_config('send_secret', '');
  sent := public._gt_notify_open(gid);
  perform pg_temp.ok(sent = 0 and (select push_sent_at from public.game_times where id = gid) is null, 'push not set up: nothing sent, still to do');
  perform public.set_push_config('send_secret', 'test-secret-not-real');
  -- the tick sends it for a game that just opened
  r := public.game_time_tick();
  perform pg_temp.ok((r->>'pushed')::int >= 2 and (select push_sent_at from public.game_times where id = gid) is not null, 'the minute tick sends the opening push');
  -- reading the state sends it too when cron is off
  update public.game_times set push_sent_at = null, push_count = null where id = gid;
  perform pg_temp.state(crew, a);
  perform pg_temp.ok((select push_sent_at from public.game_times where id = gid) is not null, 'a Hopper loading the room sends it if cron is off');
  -- START NOW sends at once
  update public.game_times set push_sent_at = null, push_count = null, opens_at = clock_timestamp() + interval '1 hour', closes_at = clock_timestamp() + interval '2 hours' where id = gid;
  perform pg_temp.place(crew, e, 15, 17);
  r := public.admin_game_time_start_now(gid);
  perform pg_temp.ok((r->'game'->>'push_count')::int = 2, 'START NOW pushes at once');
  delete from public.game_times where id in (gid, og);
end $t$;

-- ============================ 9. nobody can read a code or a hiding place ===
do $t$
declare
  crew uuid := pg_temp.id('crew');
  a uuid := pg_temp.id('a'); b uuid := pg_temp.id('b'); n uuid := pg_temp.id('n'); gid uuid := pg_temp.id('g1');
  t text; f record; role_name text; n_rows int;
  allowed_anon text[] := array['game_time_state', 'game_time_list'];
  allowed_auth text[] := array['game_time_state', 'game_time_list', 'game_time_search', 'my_game_time_wins'];
  g_live uuid; s jsonb; txt text;
begin
  -- a live game with an unfound box to look for
  g_live := (public.admin_game_time_create((pg_temp.args(crew) - 'opens_at' - 'closes_at') || '{"start_now": true, "duration_minutes": 60, "codes": ["SECRET-CODE"]}')->'game'->>'id')::uuid;
  perform pg_temp.arrange(g_live, array['SECRET-CODE'], array['record-wall']);

  -- every table: RLS on, nothing granted to anon, nothing to authenticated but the feed's SELECT
  for t in select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
            where ns.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and c.relname like 'game\_time%' loop
    perform pg_temp.ok((select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), t || ': RLS is on');
    foreach role_name in array array['anon', 'authenticated'] loop
      for f in select p from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p loop
        perform pg_temp.ok(has_table_privilege(role_name, 'public.' || t, f.p) = (role_name = 'authenticated' and t = 'game_time_feed' and f.p = 'select'),
          t || ': ' || role_name || ' ' || f.p || case when role_name = 'authenticated' and t = 'game_time_feed' and f.p = 'select' then ' (members, by RLS)' else ' is closed' end);
      end loop;
    end loop;
    perform pg_temp.ok(not exists (select 1 from information_schema.column_privileges cp where cp.table_schema = 'public' and cp.table_name = t
      and cp.grantee in ('anon', 'authenticated') and not (t = 'game_time_feed' and lower(cp.privilege_type) = 'select' and cp.grantee = 'authenticated')), t || ': no column grants either');
    if t <> 'game_time_feed' then
      perform pg_temp.fail_as(a, format('select * from public.%I', t), 'permission denied');
      perform pg_temp.fail_anon(format('select * from public.%I', t), 'permission denied');
      perform pg_temp.fail_as(a, format('delete from public.%I', t), 'permission denied');
    end if;
  end loop;
  perform pg_temp.ok((select count(*) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and c.relname like 'game\_time%' and c.relkind = 'r') = 7, 'seven tables, all checked');
  perform pg_temp.fail_anon('select * from public.game_time_feed', 'permission denied');
  perform pg_temp.fail_as(a, 'insert into public.game_time_feed (game_id, crew_id, name, object_id, boxes_left) values (gen_random_uuid(), gen_random_uuid(), ''x'', ''y'', 0)', 'permission denied');
  perform pg_temp.fail_as(a, 'select * from public.game_time_feed_id_seq', 'permission denied');
  -- the feed is the one thing members read: their crew's lines only, and no code or hiding place in it
  perform pg_temp.actor(a); select count(*) into n_rows from public.game_time_feed; perform pg_temp.admin();
  perform pg_temp.ok(n_rows >= 2, 'a member reads their crew''s feed');
  perform pg_temp.actor(n); select count(*) into n_rows from public.game_time_feed; perform pg_temp.admin();
  perform pg_temp.ok(n_rows = 0, 'a non-member reads none of it');
  perform pg_temp.ok((select array_agg(column_name::text order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'game_time_feed')
    = array['at', 'boxes_left', 'crew_id', 'game_id', 'id', 'name', 'object_id'], 'the feed has no code column');
  -- views, materialized views and anything else that reads the tables
  perform pg_temp.ok(not exists (select 1 from pg_views v where v.definition ilike '%game_time%') and not exists (select 1 from pg_matviews v where v.definition ilike '%game_time%'),
    'no view reads the game tables');
  perform pg_temp.ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'game\_time%' and tablename <> 'game_time_feed'),
    'Realtime carries the feed and no other game table');
  perform pg_temp.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'game_time_feed'), 'Realtime carries the feed');

  -- every function: only the four Hopper calls (and the two reads for a visitor) are open
  for f in select p.oid, p.proname::text as name, p.oid::regprocedure::text as sig
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and (p.proname like '\_gt\_%' or p.proname like 'game\_time\_%' or p.proname like 'admin\_game\_time\_%' or p.proname = 'my_game_time_wins'
                   or p.proname = '_crew_room_hunt_busy'
                   or (p.prokind in ('f', 'p') and pg_get_functiondef(p.oid) ~* 'game_time_(boxes|spots|wins|players|rate)')) loop
    perform pg_temp.ok(has_function_privilege('anon', f.oid, 'execute') = (f.name = any (allowed_anon)), f.sig || ': anon ' || case when f.name = any (allowed_anon) then 'may call' else 'cannot call' end);
    perform pg_temp.ok(has_function_privilege('authenticated', f.oid, 'execute') = (f.name = any (allowed_auth)), f.sig || ': authenticated ' || case when f.name = any (allowed_auth) then 'may call' else 'cannot call' end);
  end loop;
  perform pg_temp.ok((select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname like 'admin\_game\_time\_%') = 7, 'seven staff calls, all checked');
  perform pg_temp.fail_as(a, format('select public.admin_game_time_status(%L)', gid), 'permission denied');
  perform pg_temp.fail_as(a, format('select public.admin_game_time_winners(%L)', gid), 'permission denied');
  perform pg_temp.fail_as(a, 'select public.admin_game_time_winners(null)', 'permission denied');
  perform pg_temp.fail_as(a, 'select public.admin_game_time_list()', 'permission denied');
  perform pg_temp.fail_as(a, format('select public._gt_admin_view(%L)', gid), 'permission denied');
  perform pg_temp.fail_as(a, 'select public.game_time_tick()', 'permission denied');
  perform pg_temp.fail_as(a, 'select public.admin_game_time_create(''{}'')', 'permission denied');
  perform pg_temp.fail_as(a, format('select public.admin_game_time_close(%L)', gid), 'permission denied');
  perform pg_temp.fail_as(a, format('select public.admin_game_time_start_now(%L)', gid), 'permission denied');
  perform pg_temp.fail_as(a, format('select public.admin_game_time_update(%L, ''{}'')', gid), 'permission denied');
  perform pg_temp.fail_as(a, format('select public._gt_relocate(%L)', gid), 'permission denied');
  perform pg_temp.fail_as(a, format('select public._gt_notify_open(%L)', gid), 'permission denied');
  perform pg_temp.fail_anon('select public.game_time_tick()', 'permission denied');
  perform pg_temp.fail_anon(format('select public.admin_game_time_status(%L)', gid), 'permission denied');

  -- and what the open calls hand back never holds an unfound code or the object it hides on
  for role_name in select unnest(array['a', 'b', 'n']) loop
    s := pg_temp.state(crew, pg_temp.id(role_name));
    txt := s::text;
    perform pg_temp.ok(txt not like '%SECRET-CODE%' and txt not like '%"spot"%', 'state for ' || role_name || ' holds no unfound code and no hiding place');
  end loop;
  perform pg_temp.anon(); s := public.game_time_state(crew); txt := s::text || public.game_time_list()::text; perform pg_temp.admin();
  perform pg_temp.ok(txt not like '%SECRET-CODE%', 'nor does what a visitor with no session reads');
  perform pg_temp.arrange(g_live, array['SECRET-CODE'], array['mixing-desk']);
  txt := pg_temp.go(crew, pg_temp.id('d'), 2, 12, 'record-wall')::text;
  perform pg_temp.ok(txt not like '%SECRET-CODE%' and txt not like '%mixing-desk%', 'and an empty search does not name the object that holds the box');
  perform public.admin_game_time_close(g_live);
end $t$;

-- ========================================== 10. every prop can be searched ===
do $t$
declare bad text;
begin
  -- For every layout: each prop a game may use has a walkable tile within one tile of it that a walker can reach from the entrance.
  with recursive reach(tpl, w, x, y) as (
    select l.template, l.width, (l.data->'spawn'->>'x')::int, (l.data->'spawn'->>'y')::int from public.crew_room_layouts l
    union
    select r.tpl, r.w, r.x + d.dx, r.y + d.dy from reach r, (values (1, 0), (-1, 0), (0, 1), (0, -1)) d(dx, dy)
     where public._crew_room_walkable(r.tpl, r.w, r.x + d.dx, r.y + d.dy)
  )
  select string_agg(l.template || '/' || l.width || ' ' || (b->>'id'), ', ') into bad
    from public.crew_room_layouts l cross join lateral jsonb_array_elements(l.data->'blocks') b
   where b ? 'id' and (b->>'solid') = 'true' and coalesce(b->>'kind', '') <> 'maptable'
     and not exists (
           select 1 from reach r
            where r.tpl = l.template and r.w = l.width
              and not (r.x >= (b->>'x')::int and r.x < (b->>'x')::int + (b->>'w')::int and r.y >= (b->>'y')::int and r.y < (b->>'y')::int + (b->>'h')::int)
              and greatest((b->>'x')::int - r.x, 0, r.x - ((b->>'x')::int + (b->>'w')::int - 1)) <= 1
              and greatest((b->>'y')::int - r.y, 0, r.y - ((b->>'y')::int + (b->>'h')::int - 1)) <= 1);
  perform pg_temp.ok(bad is null, 'every prop a hiding place can be reached and searched in every room (' || coalesce(bad, 'none stranded') || ')');
end $t$;

rollback;

-- ============================================================================
-- Part 2: 50 Hoppers search the same object at the same moment.
-- ============================================================================
create function pg_temp.must(v boolean, label text) returns void language plpgsql as $$
begin
  if v is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

-- A clean slate (a run that stopped half way may have left fixtures).
delete from public.game_time_rate where user_id in (select id from auth.users where email like 'gtconc-%@gametime.invalid');
delete from public.crews where name = 'GT CONCURRENCY';
delete from auth.users where email like 'gtconc-%@gametime.invalid';

-- 52 Hoppers: 01 to 50 are the crowd, 51 searches against itself, 52 is spare. One private crew, one live game with three boxes.
begin;
insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'gtconc-' || lpad(i::text, 2, '0') || '@gametime.invalid', false, '{}', json_build_object('name', 'Crowd ' || i)::jsonb, now(), now()
  from generate_series(1, 52) i;
insert into public.crews (id, name, created_by, visibility)
select gen_random_uuid(), 'GT CONCURRENCY', id, 'private' from auth.users where email = 'gtconc-01@gametime.invalid';
insert into public.crew_members (crew_id, user_id, role)
select (select id from public.crews where name = 'GT CONCURRENCY'), u.id, case when u.email = 'gtconc-01@gametime.invalid' then 'owner' else 'member' end
  from auth.users u where u.email like 'gtconc-%@gametime.invalid';
select public._crew_room_ensure(id) from public.crews where name = 'GT CONCURRENCY';
-- everyone stands at (3,3): next to the mixing desk (x 2..6, y 2) and the left speaker (2,3)
insert into public.crew_room_presence (crew_id, user_id, session_id, x, y, last_seen)
select (select id from public.crews where name = 'GT CONCURRENCY'), u.id, gen_random_uuid(), 3, 3, clock_timestamp()
  from auth.users u where u.email like 'gtconc-%@gametime.invalid';
select public.admin_game_time_create(jsonb_build_object(
  'crew_id', (select id from public.crews where name = 'GT CONCURRENCY'), 'title', 'Crowd test', 'start_now', true, 'duration_minutes', 30,
  'relocate_minutes', 0, 'codes', '["CONC-1", "CONC-2", "CONC-3"]'::jsonb,
  'objects', '["mixing-desk", "studio-speaker-l", "courtyard-fountain", "record-wall"]'::jsonb)) as created \gset
select pg_temp.must(:'created'::jsonb->>'ok' = 'true', 'the crowd game is created');
-- boxes: CONC-1 on the desk, CONC-2 on the fountain, CONC-3 on the record wall; the speaker holds none
update public.game_time_boxes set spot_id = 'tmp-' || id::text where game_id = (select id from public.game_times where title = 'Crowd test');
update public.game_time_boxes set spot_id = case code when 'CONC-1' then 'mixing-desk' when 'CONC-2' then 'courtyard-fountain' else 'record-wall' end
 where game_id = (select id from public.game_times where title = 'Crowd test');
commit;

-- The script every round runs: one psql session per line of /tmp/gt_conc.in, each doing one search. All of them wait on the
-- game's lock (held=yes means every session was seen waiting) and are let go together.
-- Written from SQL so this file stays one piece.
select $sh$
D=/tmp/gt_conc
OBJ="$1"
CREW=$(psql -U postgres -d postgres -At -X -c "select id from public.crews where name = 'GT CONCURRENCY'")
GAME=$(psql -U postgres -d postgres -At -X -c "select id from public.game_times where crew_id = '$CREW'")
rm -rf $D.out $D.go; mkdir -p $D.out
# The holder takes the game's lock first, so every searcher stops at the same place and is let go together.
( echo "begin;"; echo "select public._gt_lock('$GAME');"; until [ -f $D.go ]; do sleep 0.1; done; echo "commit;" ) | psql -U postgres -d postgres -At -X -q > /dev/null 2>&1 &
i=0
until [ "$(psql -U postgres -d postgres -At -X -c "select not pg_try_advisory_xact_lock(hashtextextended('game-time:$GAME', 0))")" = "t" ] || [ $i -gt 100 ]; do sleep 0.1; i=$((i+1)); done
n=0
while read U; do
  n=$((n+1))
  ( psql -U postgres -d postgres -At -X -q -c "set role authenticated; select set_config('request.jwt.claims', json_build_object('sub', '$U', 'role', 'authenticated')::text, false); select public.game_time_search('$CREW', '$OBJ')" > $D.out/$n.txt 2>&1 ) &
done < $D.in
TOTAL=$n
i=0
until [ "$(psql -U postgres -d postgres -At -X -c "select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%game_time_search%' and pid <> pg_backend_pid()")" -ge "$TOTAL" ] || [ $i -gt 300 ]; do sleep 0.1; i=$((i+1)); done
if [ $i -gt 300 ]; then HELD=no; else HELD=yes; fi
touch $D.go
wait
W=$(cat $D.out/*.txt | grep -c '"result": "win"')
N=$(cat $D.out/*.txt | grep -c '"result": "nothing"')
S=$(cat $D.out/*.txt | grep -c 'slow_down')
A=$(cat $D.out/*.txt | grep -c 'all_found')
echo "sessions=$TOTAL held=$HELD wins=$W nothing=$N slow_down=$S all_found=$A"
$sh$ as script \gset
\o /tmp/gt_conc.sh
\qecho :script
\o

-- Round 1: 01 to 50 all search the desk where CONC-1 hides.
\copy (select id from auth.users where email like 'gtconc-%@gametime.invalid' and email not in ('gtconc-51@gametime.invalid', 'gtconc-52@gametime.invalid') order by email) to '/tmp/gt_conc.in'
\set round1 `sh /tmp/gt_conc.sh mixing-desk`
select pg_temp.must(:'round1' = 'sessions=50 held=yes wins=1 nothing=49 slow_down=0 all_found=0',
  '50 Hoppers search the same object at the same moment: exactly one wins, 49 find nothing (' || :'round1' || ')');
select pg_temp.must((select count(*) from public.game_time_wins) = 1 and (select count(*) from public.game_time_boxes where claimed_by is not null) = 1,
  'the database agrees: one win, one box claimed');

select pg_sleep(3);
-- Round 2: one Hopper fires 10 searches at once at the fountain where CONC-2 hides: one goes through, nine wait their turn.
update public.crew_room_presence set x = 13, y = 9, last_seen = clock_timestamp()
 where user_id = (select id from auth.users where email = 'gtconc-51@gametime.invalid');
\copy (select u.id from auth.users u, generate_series(1, 10) where u.email = 'gtconc-51@gametime.invalid') to '/tmp/gt_conc.in'
\set round2 `sh /tmp/gt_conc.sh courtyard-fountain`
select pg_temp.must(:'round2' = 'sessions=10 held=yes wins=1 nothing=0 slow_down=9 all_found=0',
  'one Hopper searching 10 times at once is answered once and told to wait nine times (' || :'round2' || ')');

select pg_sleep(3);
-- Round 3: 20 Hoppers who have not won go for the last box on the record wall: one wins, the game ends, the rest are told it is over.
update public.crew_room_presence set x = 2, y = 12, last_seen = clock_timestamp()
 where user_id in (select u.id from auth.users u where u.email like 'gtconc-%@gametime.invalid');
\copy (select u.id from auth.users u where u.email like 'gtconc-%@gametime.invalid' and not exists (select 1 from public.game_time_wins w where w.user_id = u.id) order by u.email limit 20) to '/tmp/gt_conc.in'
\set round3 `sh /tmp/gt_conc.sh record-wall`
select pg_temp.must(:'round3' = 'sessions=20 held=yes wins=1 nothing=0 slow_down=0 all_found=19',
  '20 Hoppers going for the last box: one winner, the other 19 are told all found (' || :'round3' || ')');

-- What the database says after the crowd.
select pg_temp.must((select count(*) = 3 and count(distinct user_id) = 3 and count(distinct box_id) = 3 and count(distinct code) = 3
                       from public.game_time_wins w where w.game_id = (select id from public.game_times where title = 'Crowd test')),
  'three boxes, three wins, three different Hoppers, three different codes');
select pg_temp.must((select ended_by = 'all_found' from public.game_times where title = 'Crowd test')
  and (select count(*) from public.game_time_boxes b where b.game_id = (select id from public.game_times where title = 'Crowd test') and b.claimed_by is null) = 0,
  'the crowd game ended all found');

-- Clean up.
delete from public.game_time_rate where user_id in (select id from auth.users where email like 'gtconc-%@gametime.invalid');
delete from public.crews where name = 'GT CONCURRENCY';
delete from auth.users where email like 'gtconc-%@gametime.invalid';
\! rm -rf /tmp/gt_conc.out /tmp/gt_conc.in /tmp/gt_conc.go /tmp/gt_conc.sh
select pg_temp.must((select count(*) from auth.users where email like 'gtconc-%@gametime.invalid') = 0 and (select count(*) from public.crews where name = 'GT CONCURRENCY') = 0,
  'the crowd fixtures are gone');

do $$ begin raise notice 'ALL GAME TIME TESTS PASSED'; end $$;
