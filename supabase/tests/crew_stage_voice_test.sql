-- Crew admins and the stage list (supabase/crew_stage_voice.sql). LOCAL ONLY: the file under test is run INSIDE this
-- transaction, and the whole thing (the new role check, the new calls, every fixture user, crew and presence row)
-- rolls back at the end. Ends with ALL CREW STAGE TESTS PASSED.
--   docker exec supabase_db_hoppaz-local mkdir -p /tmp/hoppaz-sql-voice-stage
--   docker cp supabase/crew_stage_voice.sql supabase_db_hoppaz-local:/tmp/hoppaz-sql-voice-stage/
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < supabase/tests/crew_stage_voice_test.sql
-- (add  -v sqldir=/some/other/folder  to read the file from somewhere else)
\if :{?sqldir}
\else
  \set sqldir /tmp/hoppaz-sql-voice-stage
\endif

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
          case when guest then null else 'stagetest-' || u || '@stagetest.invalid' end, guest, '{}', '{"name":"Stage tester"}', now(), now());
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
create function pg_temp.stage_as(u uuid, c uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(u);
  r := public.crew_room_stage(c);
  perform pg_temp.admin();
  return r;
end $$;
-- Put a walker on a tile (the server owns the tile; the test writes it as the database owner) and refresh the beat.
create function pg_temp.put(c uuid, u uuid, px int, py int) returns void language plpgsql as $$
begin
  update public.crew_room_presence set x = px, y = py, last_seen = clock_timestamp() where crew_id = c and user_id = u;
  if not found then raise exception 'no walker for %', u; end if;
end $$;

-- The file under test, inside the transaction.
\i :sqldir/crew_stage_voice.sql
-- Run again straight away: it must be re-runnable.
\i :sqldir/crew_stage_voice.sql

do $$
declare
  o uuid := pg_temp.newuser(); a1 uuid := pg_temp.newuser(); a2 uuid := pg_temp.newuser(); a3 uuid := pg_temp.newuser();
  m uuid := pg_temp.newuser(); outsider uuid := pg_temp.newuser(); g uuid := pg_temp.newuser(true); bl uuid := pg_temp.newuser();
  crew uuid := gen_random_uuid();
  so uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid(); sm uuid := gen_random_uuid();
  res jsonb; ids uuid[];
begin
  insert into public.crews (id, name, created_by) values (crew, 'Stage test crew', o);
  insert into public.crew_members (crew_id, user_id, role, joined_at)
  values (crew, o, 'owner', now() - interval '5 days'), (crew, a1, 'member', now() - interval '4 days'),
         (crew, a2, 'member', now() - interval '3 days'), (crew, a3, 'member', now() - interval '2 days'), (crew, m, 'member', now() - interval '1 day'),
         (crew, g, 'member', now()), (crew, bl, 'member', now());
  perform pg_temp.actor(o); perform public.crew_room_enter(crew, so); perform pg_temp.admin();
  perform pg_temp.actor(a1); perform public.crew_room_enter(crew, s1); perform pg_temp.admin();
  perform pg_temp.actor(a2); perform public.crew_room_enter(crew, s2); perform pg_temp.admin();
  perform pg_temp.actor(a3); perform public.crew_room_enter(crew, s3); perform pg_temp.admin();
  perform pg_temp.actor(m); perform public.crew_room_enter(crew, sm); perform pg_temp.admin();

  -- The role check allows the new value and still refuses a made-up one.
  perform pg_temp.ok((select pg_get_constraintdef(oid) like '%admin%' from pg_constraint where conname = 'crew_members_role_check'), 'the role check allows admin');
  perform pg_temp.ok((select count(*) = 1 from pg_constraint where conrelid = 'public.crew_members'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%role%'),
    'one role check, even after a second run');
  begin
    update public.crew_members set role = 'boss' where crew_id = crew and user_id = m;
    perform pg_temp.ok(false, 'a made-up role is refused');
  exception when check_violation then
    perform pg_temp.ok(true, 'a made-up role is refused');
  end;

  -- crew_set_role: owner only, never on the owner, only admin or member.
  perform pg_temp.fail_as(a1, format('select public.crew_set_role(%L,%L,%L)', crew, a1, 'admin'), 'owner_only');
  perform pg_temp.fail_as(m, format('select public.crew_set_role(%L,%L,%L)', crew, m, 'admin'), 'owner_only');
  perform pg_temp.fail_as(outsider, format('select public.crew_set_role(%L,%L,%L)', crew, m, 'admin'), 'owner_only');
  perform pg_temp.fail_as(g, format('select public.crew_set_role(%L,%L,%L)', crew, m, 'admin'), 'need_account');
  perform pg_temp.fail_as(o, format('select public.crew_set_role(%L,%L,%L)', crew, o, 'member'), 'owner_role_fixed');
  perform pg_temp.fail_as(o, format('select public.crew_set_role(%L,%L,%L)', crew, m, 'owner'), 'bad_role');
  perform pg_temp.fail_as(o, format('select public.crew_set_role(%L,%L,%L)', crew, outsider, 'admin'), 'not_in_crew');

  perform pg_temp.actor(o);
  perform public.crew_set_role(crew, a1, 'admin'); perform public.crew_set_role(crew, a2, 'admin'); perform public.crew_set_role(crew, a3, 'admin');
  perform pg_temp.admin();
  perform pg_temp.ok((select role = 'admin' from public.crew_members where crew_id = crew and user_id = a1), 'the owner makes an admin');
  perform pg_temp.fail_as(a1, format('select public.crew_set_role(%L,%L,%L)', crew, a2, 'member'), 'owner_only');
  perform pg_temp.actor(o); perform public.crew_set_role(crew, a3, 'member'); perform pg_temp.admin();
  perform pg_temp.ok((select role = 'member' from public.crew_members where crew_id = crew and user_id = a3), 'the owner takes the role back');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.crew_set_role(uuid,uuid,text)', 'execute'), 'anon cannot call crew_set_role');

  -- Staff elsewhere in the app now includes an admin (crew_friends.sql, when it is applied here).
  if to_regprocedure('public.crew_friend_staff(uuid)') is not null then
    perform pg_temp.actor(m);
    perform pg_temp.ok(exists (select 1 from jsonb_array_elements(public.crew_friend_staff(crew)) s where s->>'id' = a1::text and s->>'role' = 'admin'),
      'crew_friend_staff lists the admin');
    perform pg_temp.admin();
  end if;

  -- The stage: nobody stands on it yet. Everyone enters at the entrance.
  perform pg_temp.ok(pg_temp.stage_as(m, crew)->'stage' = '[]'::jsonb, 'nobody on the stage, an empty list');
  perform pg_temp.ok((pg_temp.stage_as(o, crew)->>'is_owner')::boolean and (pg_temp.stage_as(o, crew)->>'is_staff')::boolean, 'the owner is staff and owner');
  perform pg_temp.ok(not (pg_temp.stage_as(a1, crew)->>'is_owner')::boolean and (pg_temp.stage_as(a1, crew)->>'is_staff')::boolean, 'an admin is staff, not owner');
  perform pg_temp.ok(not (pg_temp.stage_as(m, crew)->>'is_staff')::boolean, 'a member is not staff');
  perform pg_temp.ok(pg_temp.stage_as(a1, crew)->'admins' = '[]'::jsonb, 'an admin is not told who the admins are');
  perform pg_temp.ok(jsonb_array_length(pg_temp.stage_as(o, crew)->'admins') = 2, 'the owner is told who the admins are');

  -- The layout's stage is x 10..19, y 1..6 (clubhouse, 30 wide).
  perform pg_temp.put(crew, o, 15, 4);
  perform pg_temp.ok(pg_temp.stage_as(m, crew)->'stage' = to_jsonb(array[o]), 'the owner on the stage is listed');
  perform pg_temp.put(crew, a1, 12, 3);
  perform pg_temp.ok(pg_temp.stage_as(m, crew)->'stage' = to_jsonb(array[o, a1]), 'an admin on the stage is listed after the owner');
  perform pg_temp.put(crew, m, 14, 4);
  perform pg_temp.ok(pg_temp.stage_as(m, crew)->'stage' = to_jsonb(array[o, a1]), 'a member on the stage is not listed');
  perform pg_temp.ok((pg_temp.stage_as(m, crew)->>'is_staff')::boolean is not true, 'a member on the stage is still not staff');

  -- Off the stage (the edge: x 20 is outside, x 19 is inside, y 7 is outside).
  perform pg_temp.put(crew, a1, 20, 4);
  perform pg_temp.ok(pg_temp.stage_as(m, crew)->'stage' = to_jsonb(array[o]), 'staff one tile past the stage (x 20) are not listed');
  perform pg_temp.put(crew, a1, 19, 6);
  perform pg_temp.ok(pg_temp.stage_as(m, crew)->'stage' = to_jsonb(array[o, a1]), 'the last stage tile (19, 6) counts');
  perform pg_temp.put(crew, a1, 15, 7);
  perform pg_temp.ok(pg_temp.stage_as(m, crew)->'stage' = to_jsonb(array[o]), 'staff one tile below the stage (y 7) are not listed');

  -- A stale heartbeat is not on the stage.
  perform pg_temp.put(crew, a1, 12, 3);
  update public.crew_room_presence set last_seen = clock_timestamp() - interval '60 seconds' where crew_id = crew and user_id = a1;
  perform pg_temp.ok(pg_temp.stage_as(m, crew)->'stage' = to_jsonb(array[o]), 'a stale heartbeat (60 s) is not on the stage');
  perform pg_temp.put(crew, a1, 12, 3);

  -- At most three, the owner first, then by when they joined.
  perform pg_temp.actor(o); perform public.crew_set_role(crew, a3, 'admin'); perform public.crew_set_role(crew, m, 'admin'); perform pg_temp.admin();
  perform pg_temp.put(crew, a2, 11, 2); perform pg_temp.put(crew, a3, 13, 2); perform pg_temp.put(crew, m, 17, 5);
  ids := (select array_agg(x::uuid) from jsonb_array_elements_text(pg_temp.stage_as(m, crew)->'stage') x);
  perform pg_temp.ok(array_length(ids, 1) = 3 and ids[1] = o and ids[2] = a1 and ids[3] = a2, 'five staff on the stage: the list is three, owner then by join date');

  -- A blocked speaker is hidden from the person who blocked them (either way round), and only from them.
  insert into public.blocks (blocker, blocked, label) values (bl, a1, 'Test admin');
  perform pg_temp.ok(not (pg_temp.stage_as(bl, crew)->'stage' @> to_jsonb(array[a1])), 'a blocked speaker is hidden from the blocker');
  perform pg_temp.ok(pg_temp.stage_as(m, crew)->'stage' @> to_jsonb(array[a1]), 'and still listed for everyone else');
  delete from public.blocks where blocker = bl and blocked = a1;
  perform pg_temp.actor(o); perform public.crew_set_role(crew, m, 'member'); perform pg_temp.admin();
  perform pg_temp.ok(not (pg_temp.stage_as(bl, crew)->'stage' @> to_jsonb(array[m])), 'an admin made a member again drops off the stage list');
  perform pg_temp.put(crew, m, 14, 4);

  -- The service-role list takes no viewer, so it leaves nobody out; Hoppers cannot call it at all.
  perform pg_temp.ok(array_length(public._crew_room_stage_list(crew, null), 1) = 3, 'the server list with no viewer is the same three');
  perform pg_temp.fail_as(o, format('select public._crew_room_stage_list(%L, null)', crew), 'permission denied');
  perform pg_temp.fail_as(a1, format('select public._crew_room_stage_list(%L, null)', crew), 'permission denied');
  perform pg_temp.ok(has_function_privilege('service_role', 'public._crew_room_stage_list(uuid,uuid)', 'execute'), 'the service role can call the server list');

  -- Who may ask: crew members with an account only.
  perform pg_temp.fail_as(outsider, format('select public.crew_room_stage(%L)', crew), 'not_in_crew');
  perform pg_temp.fail_as(g, format('select public.crew_room_stage(%L)', crew), 'need_account');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.crew_room_stage(uuid)', 'execute'), 'anon cannot ask who is on the stage');

  -- Another crew's stage is its own.
  perform pg_temp.ok(public._crew_room_stage_list(gen_random_uuid(), null) = '{}', 'a crew with no room has an empty stage');
  raise notice 'ALL CREW STAGE TESTS PASSED';
end $$;
rollback;
