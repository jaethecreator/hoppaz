-- DRAFT FOR OLA, NOT RUN ANYWHERE. Release 1 "Your tickets" on Me (supabase/events_r1_my_registrations.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, events_r1_events.sql, events_r1_registrations.sql and events_r1_my_registrations.sql loaded.
-- Ends with ALL EVENTS R1 MY REGISTRATIONS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_my_registrations_test.sql
begin;
select public.ev_set_setting('events_r1', 'on');
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
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.newuser(shown text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mine-' || u || '@evtest.invalid', false, '{}',
          json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
create function pg_temp.j(u uuid, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(u);
  execute q into r;
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.ev(host uuid, ttl text, starts timestamptz, ends timestamptz, st text) returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, ends_at, status, host_id, visibility, requires_approval)
  values (ttl, 'Somewhere', starts, ends, 'live', host, 'public', false) returning id;
$$;
create function pg_temp.reg(ev uuid, u uuid, st text) returns void language sql as $$
  insert into public.ev_registrations (event_id, user_id, status, name) values (ev, u, st, 'x');
$$;

do $$
declare
  h uuid := pg_temp.newuser('Mine Host'); g uuid := pg_temp.newuser('Mine Guest'); other uuid := pg_temp.newuser('Mine Other');
  soon uuid; later uuid; tonight uuid; over uuid; gone uuid; asked uuid; waiting uuid; inside uuid; r jsonb;
begin
  later := pg_temp.ev(h, 'Mine Later', now() + interval '5 days', null, 'live');
  soon := pg_temp.ev(h, 'Mine Soon', now() + interval '1 day', null, 'live');
  tonight := pg_temp.ev(h, 'Mine Tonight', now() - interval '1 hour', now() + interval '2 hours', 'live');
  over := pg_temp.ev(h, 'Mine Over', now() - interval '5 hours', null, 'live');
  gone := pg_temp.ev(h, 'Mine Cancelled', now() + interval '2 days', null, 'live');
  asked := pg_temp.ev(h, 'Mine Asked', now() + interval '2 days', null, 'live');
  waiting := pg_temp.ev(h, 'Mine Waiting', now() + interval '2 days', null, 'live');
  inside := pg_temp.ev(h, 'Mine Inside', now() - interval '30 minutes', null, 'live');
  update public.events set status = 'cancelled' where id = gone;
  perform pg_temp.reg(later, g, 'going');
  perform pg_temp.reg(soon, g, 'going');
  perform pg_temp.reg(tonight, g, 'going');
  perform pg_temp.reg(over, g, 'going');
  perform pg_temp.reg(gone, g, 'going');
  perform pg_temp.reg(asked, g, 'requested');
  perform pg_temp.reg(waiting, g, 'waitlisted');
  perform pg_temp.reg(inside, g, 'checked_in');
  perform pg_temp.reg(soon, other, 'going');

  -- ===================================================== what the guest gets ========
  r := pg_temp.j(g, 'select public.ev_my_registrations()');
  perform pg_temp.ok(jsonb_array_length(r) = 3, 'three: tonight, soon, later');
  perform pg_temp.ok(r -> 0 -> 'event' ->> 'title' = 'Mine Tonight' and r -> 1 -> 'event' ->> 'title' = 'Mine Soon' and r -> 2 -> 'event' ->> 'title' = 'Mine Later',
                     'soonest first, an event under way counts until it ends');
  perform pg_temp.ok(r -> 0 -> 'registration' ->> 'status' = 'going' and (r -> 0 -> 'registration' ->> 'user_id')::uuid = g, 'each carries the guest''s own registration');
  perform pg_temp.ok((r -> 1 -> 'registration' ->> 'event_id')::uuid = soon and (r -> 1 -> 'event' ->> 'id')::uuid = soon, 'the registration and the event match');

  -- ===================================================== only their own ========
  r := pg_temp.j(other, 'select public.ev_my_registrations()');
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 -> 'event' ->> 'title' = 'Mine Soon', 'someone else sees only their own');
  perform pg_temp.ok(jsonb_array_length(pg_temp.j(h, 'select public.ev_my_registrations()')) = 0, 'the host is not going: nothing');

  -- ===================================================== the switch and the session ========
  perform public.ev_set_setting('events_r1', 'off');
  perform pg_temp.ok(jsonb_array_length(pg_temp.j(g, 'select public.ev_my_registrations()')) = 0, 'switch off: nothing');
  perform public.ev_set_setting('events_r1', 'on');
  perform pg_temp.ok(jsonb_array_length(public.ev_my_registrations()) = 0, 'no session: nothing');

  perform pg_temp.ok(has_function_privilege('anon', 'public.ev_my_registrations()', 'execute') = false, 'anon cannot execute ev_my_registrations');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.ev_my_registrations()', 'execute'), 'authenticated can');
  raise notice 'ALL EVENTS R1 MY REGISTRATIONS TESTS PASSED';
end $$;
rollback;
