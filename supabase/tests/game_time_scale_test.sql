-- Game Time searches that do not queue behind the disk (supabase/game_time_scale.sql). LOCAL ONLY: everything rolls back.
-- Ends with ALL GAME TIME SCALE TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/game_time_scale_test.sql
begin;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$
begin
  if v is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.search_as(u uuid, c uuid, o text) returns jsonb language plpgsql as $$
declare res jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := public.game_time_search(c, o);
  execute 'reset role';
  return res;
end $$;

do $$
declare
  a uuid := gen_random_uuid(); crew uuid := gen_random_uuid(); game uuid := gen_random_uuid(); res jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gtscale-' || a || '@roomtest.invalid', now(),
          '{}', '{}', now(), now());
  update public.profiles set display_name = 'Hunter' where id = a;
  insert into public.crews (id, name, created_by) values (crew, 'GT scale crew', a);
  insert into public.crew_members (crew_id, user_id, role, joined_at) values (crew, a, 'owner', now() - interval '1 day');
  perform public._crew_room_ensure(crew);
  insert into public.crew_room_presence (crew_id, user_id, session_id, x, y) values (crew, a, gen_random_uuid(), 3, 3);
  insert into public.game_times (id, crew_id, title, opens_at, closes_at, campaign_key, room_template, room_width, push_sent_at, push_count)
  values (game, crew, 'Scale hunt', now() - interval '1 minute', now() + interval '1 hour', 'gt-scale-test', 'clubhouse', 30, now(), 0);
  insert into public.game_time_spots (game_id, object_id, x, y, w, h) values (game, 'mixing-desk', 2, 2, 5, 1), (game, 'studio-plant', 7, 6, 1, 1);
  insert into public.game_time_boxes (game_id, code, spot_id) values (game, 'GTS-1', 'studio-plant');

  perform set_config('synchronous_commit', 'on', true);
  res := pg_temp.search_as(a, crew, 'mixing-desk');
  perform pg_temp.ok(res->>'result' = 'nothing', 'a search with nothing there answers nothing');
  perform pg_temp.ok(current_setting('synchronous_commit') = 'off', 'a search with nothing there does not wait for the disk');

  update public.crew_room_presence set x = 6, y = 6 where crew_id = crew and user_id = a;
  update public.game_time_rate set last_at = clock_timestamp() - interval '5 seconds' where user_id = a;
  res := pg_temp.search_as(a, crew, 'studio-plant');
  perform pg_temp.ok(res->>'result' = 'win' and res->>'code' = 'GTS-1', 'the box is found');
  perform pg_temp.ok(current_setting('synchronous_commit') = 'on', 'a win waits for the disk: the ticket is saved before the answer leaves');
  raise notice 'ALL GAME TIME SCALE TESTS PASSED';
end $$;
rollback;
