-- ============================================================================
-- Hoppaz: hotspot_room_looks tests (real looks in hotspot rooms, alias names)
-- Run against a LOCAL database that has hotspots.sql and then hotspot_looks.sql applied:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/hotspot_looks_test.sql
--
-- One transaction that always rolls back, so nothing is kept. Every check raises an
-- exception on failure; the last line printed is ALL HOTSPOT LOOKS TESTS PASSED.
--
-- What it proves:
--   * the gates: no session, unknown hotspot, not in the room
--   * the looks of the people in the room, by their alias key, and nobody else's;
--     not yours; a Hopper with no look is left out
--   * nothing but the key and the look: no handle, no name, no user id in the answer
--   * a hotspot block hides the look both ways
--   * an author who spoke in the last 24 hours keeps a look after the head fades,
--     and someone who only stood there does not
--   * guests and anon cannot call it; hotspot_room still sends a null look
-- ============================================================================
begin;

create function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $f$
begin
  if p_cond is not true then raise exception 'TEST FAILED: %', p_msg; end if;
end $f$;

create function pg_temp.eq(p_got text, p_want text, p_msg text) returns void language plpgsql as $f$
begin
  if p_got is distinct from p_want then raise exception 'TEST FAILED: % (got %, wanted %)', p_msg, p_got, p_want; end if;
end $f$;

create function pg_temp.newuser() returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hltest-' || u || '@hltest.invalid', '{}', '{}', now(), now());
  return u;
end $f$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

create function pg_temp.as_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $f$;

create function pg_temp.as_admin() returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $f$;

create function pg_temp.confirm(p_uid uuid) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.confirm_adult(); perform pg_temp.as_admin(); return r; end $f$;

create function pg_temp.enter(p_uid uuid, p_slug text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.enter_hotspot(p_slug); perform pg_temp.as_admin(); return r; end $f$;

create function pg_temp.looks(p_uid uuid, p_slug text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.hotspot_room_looks(p_slug); perform pg_temp.as_admin(); return r; end $f$;

create function pg_temp.room(p_uid uuid, p_slug text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin perform pg_temp.as_user(p_uid); r := public.hotspot_room(p_slug); perform pg_temp.as_admin(); return r; end $f$;

create function pg_temp.say(p_uid uuid, p_channel text, p_body text) returns text language plpgsql as $f$
begin
  perform pg_temp.as_user(p_uid);
  begin
    insert into public.messages (channel, body) values (p_channel, p_body);
  exception when others then
    perform pg_temp.as_admin();
    return sqlerrm;
  end;
  perform pg_temp.as_admin();
  return 'ok';
end $f$;

create temp table who (name text primary key, id uuid);
grant all on who to public;
create function pg_temp.u(p_name text) returns uuid language sql as $f$ select id from who where name = p_name; $f$;
create function pg_temp.key_of(p_name text) returns uuid language sql as $f$
  select v.key from public.hotspot_visits v where v.user_id = pg_temp.u(p_name)
$f$;

-- ------------------------------------------------------------- fixtures ---
delete from public.hotspot_visits;
delete from public.hotspot_blocks;
delete from public.messages where channel like 'hotspot:%';

do $t$
declare n text;
begin
  perform public.admin_hotspot_set_status('yaba', 'open');
  update public.hotspots set slow_seconds = 0 where slug = 'yaba';   -- the real clock may be inside the night window
  foreach n in array array['a', 'b', 'c', 'd', 'e', 'outsider', 'nolook'] loop
    insert into who values (n, pg_temp.newuser());
  end loop;
  update public.profiles set avatar = '{"hat":"red","skin":3}'::jsonb   where id = pg_temp.u('a');
  update public.profiles set avatar = '{"hat":"blue","skin":5}'::jsonb  where id = pg_temp.u('b');
  update public.profiles set avatar = '{"hat":"green","skin":1}'::jsonb where id = pg_temp.u('c');
  update public.profiles set avatar = '{"hat":"gold","skin":2}'::jsonb  where id = pg_temp.u('d');
  update public.profiles set avatar = '{"hat":"pink","skin":4}'::jsonb  where id = pg_temp.u('e');
  update public.profiles set avatar = '{"hat":"grey","skin":6}'::jsonb  where id = pg_temp.u('outsider');
  update public.profiles set avatar = null where id = pg_temp.u('nolook');
  foreach n in array array['a', 'b', 'c', 'd', 'e', 'outsider', 'nolook'] loop
    perform pg_temp.confirm(pg_temp.u(n));
  end loop;
  foreach n in array array['a', 'b', 'c', 'd', 'nolook'] loop
    perform pg_temp.ok((pg_temp.enter(pg_temp.u(n), 'yaba'))->>'ok' = 'true', 'enter yaba: ' || n);
  end loop;
  raise notice 'ok: fixtures';
end $t$;

-- ----------------------------------------------------------------- gates ---
do $t$
declare r jsonb;
begin
  -- no session
  perform pg_temp.as_anon();
  begin
    perform public.hotspot_room_looks('yaba');
    perform pg_temp.as_admin();
    raise exception 'TEST FAILED: anon could call hotspot_room_looks';
  exception when insufficient_privilege then
    perform pg_temp.as_admin();
  end;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.hotspot_room_looks('yaba');
  perform pg_temp.as_admin();
  perform pg_temp.eq(r->>'reason', 'no_session', 'a token with no subject');
  -- unknown hotspot
  perform pg_temp.eq(pg_temp.looks(pg_temp.u('a'), 'nowhere')->>'reason', 'not_found', 'unknown hotspot');
  -- not in the room (a Hopper who never entered)
  perform pg_temp.eq(pg_temp.looks(pg_temp.u('outsider'), 'yaba')->>'reason', 'not_in_hotspot', 'not in the room');
  raise notice 'ok: gates';
end $t$;

-- -------------------------------------------------- who shows, and what ---
do $t$
declare
  r jsonb;
  l jsonb;
begin
  r := pg_temp.looks(pg_temp.u('a'), 'yaba');
  perform pg_temp.eq(r->>'ok', 'true', 'a reads the looks');
  l := r->'looks';
  -- b, c and d are here with a look; a is you; nolook has none to show
  perform pg_temp.eq((select count(*) from jsonb_object_keys(l))::text, '3', 'three looks: b, c, d');
  perform pg_temp.eq(l->(pg_temp.key_of('b')::text)->>'hat', 'blue', 'b has their own look');
  perform pg_temp.eq(l->(pg_temp.key_of('c')::text)->>'hat', 'green', 'c has their own look');
  perform pg_temp.eq(l->(pg_temp.key_of('d')::text)->>'hat', 'gold', 'd has their own look');
  perform pg_temp.ok(not (l ? (pg_temp.key_of('a')::text)), 'not your own');
  perform pg_temp.ok(not (l ? (pg_temp.key_of('nolook')::text)), 'a Hopper with no look is left out');
  -- keyed by the alias key the heads carry, and nothing else comes with it
  perform pg_temp.eq((select string_agg(k, ',' order by k) from jsonb_object_keys(r) k), 'looks,ok', 'the answer is ok and looks only');
  perform pg_temp.ok(r::text !~* '(@hltest|handle|display_name|user_id)', 'no email, handle, name or user id in the answer');
  perform pg_temp.ok(not exists (select 1 from who w where r::text like '%' || w.id::text || '%'), 'no user id anywhere in the answer');
  -- the keys are the heads' keys
  perform pg_temp.ok(
    (select bool_and(h->>'key' in (select k from jsonb_object_keys(l) k))
       from jsonb_array_elements(pg_temp.room(pg_temp.u('a'), 'yaba')->'heads') h
      where h->>'alias' <> (select alias from public.room_identities where id = pg_temp.key_of('nolook'))),
    'every head with a look is in the map by its key');
  -- hotspot_room is unchanged: its heads still carry a null look
  perform pg_temp.ok(
    (select bool_and(jsonb_typeof(h->'look') = 'null') from jsonb_array_elements(pg_temp.room(pg_temp.u('a'), 'yaba')->'heads') h),
    'hotspot_room still sends a null look');
  raise notice 'ok: looks by key';
end $t$;

-- ------------------------------------------------------------ blocks ---
do $t$
declare l jsonb;
begin
  -- a blocks c from hotspots: c's look is gone for a, and a's look is gone for c (both ways, like the heads)
  insert into public.hotspot_blocks (blocker, blocked, label) values (pg_temp.u('a'), pg_temp.u('c'), 'a face');
  l := pg_temp.looks(pg_temp.u('a'), 'yaba')->'looks';
  perform pg_temp.ok(not (l ? (pg_temp.key_of('c')::text)), 'a blocked c: no look for a');
  perform pg_temp.ok(l ? (pg_temp.key_of('b')::text), 'b is still there');
  l := pg_temp.looks(pg_temp.u('c'), 'yaba')->'looks';
  perform pg_temp.ok(not (l ? (pg_temp.key_of('a')::text)), 'a blocked c: no look for c either');
  delete from public.hotspot_blocks;
  raise notice 'ok: blocks';
end $t$;

-- ------------------------------------------- speakers outlive their head ---
do $t$
declare
  l jsonb;
  ch text := 'hotspot:' || (select id::text from public.hotspots where slug = 'yaba');
  kb uuid := pg_temp.key_of('b');
  kd uuid := pg_temp.key_of('d');
begin
  perform pg_temp.eq(pg_temp.say(pg_temp.u('b'), ch, 'hello yaba'), 'ok', 'b speaks');
  -- the heads of b and d fade
  update public.hotspot_visits set fades_at = now() - interval '1 second' where user_id in (pg_temp.u('b'), pg_temp.u('d'));
  l := pg_temp.looks(pg_temp.u('a'), 'yaba')->'looks';
  perform pg_temp.ok(l ? (kb::text), 'b spoke: the face stays after the head fades');
  perform pg_temp.ok(not (l ? (kd::text)), 'd only stood there and faded: no look');
  -- a day and an hour later the message is out of the window
  update public.messages set created_at = now() - interval '25 hours' where channel = ch;
  l := pg_temp.looks(pg_temp.u('a'), 'yaba')->'looks';
  perform pg_temp.ok(not (l ? (kb::text)), 'older than 24 hours: no look');
  raise notice 'ok: speakers';
end $t$;

select 'ALL HOTSPOT LOOKS TESTS PASSED' as result;
rollback;
