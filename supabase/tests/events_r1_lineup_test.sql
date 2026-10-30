-- DRAFT FOR OLA, NOT RUN ANYWHERE. Release 1 lineup or programme (supabase/events_r1_lineup.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, events_r1_events.sql and events_r1_lineup.sql loaded. Ends with ALL EVENTS R1 LINEUP TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_lineup_test.sql
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
create function pg_temp.anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.newuser(shown text, guest boolean default false) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          case when guest then null else 'lineup-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
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
create function pg_temp.t(u uuid, q text) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.actor(u);
  execute q into r;
  perform pg_temp.admin();
  return r;
end $$;

do $$
declare
  h uuid := pg_temp.newuser('Lineup Host'); x uuid := pg_temp.newuser('Lineup Stranger'); st uuid := pg_temp.newuser('Lineup Staff');
  e uuid; hidden uuid; ghost uuid := gen_random_uuid(); r jsonb; rows31 jsonb;
begin
  update public.profiles set is_admin = true where id = st;
  insert into public.events (title, venue_name, starts_at, status, host_id) values ('Lineup night', 'Somewhere', now() + interval '2 days', 'live', h) returning id into e;
  insert into public.events (title, venue_name, starts_at, status, host_id) values ('Lineup hidden', 'Somewhere', now() + interval '2 days', 'pending', h) returning id into hidden;

  -- closed table
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ev_event_lineups', 'select') and not has_table_privilege('anon', 'public.ev_event_lineups', 'select'), 'the lineup table is closed to anon and authenticated');

  -- empty by default, readable by anyone who can see the event
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_get_lineup(%L)', e)) = '{"kind":"lineup","rows":[]}'::jsonb, 'an event with no lineup answers kind lineup and no rows');
  perform pg_temp.anon();
  r := public.ev_get_lineup(e);
  perform pg_temp.admin();
  perform pg_temp.ok(r = '{"kind":"lineup","rows":[]}'::jsonb, 'a signed out visitor can read it');

  -- host writes
  perform pg_temp.ok(pg_temp.t(h, format($q$select public.ev_set_lineup(%L, %L::jsonb)$q$, e,
    '{"kind":"lineup","rows":[{"time":" 9:00 PM ","name":" DJ Naffy "},{"name":"Titanium","note":"Headliner"},{"time":"1AM","name":"   "}]}')) = 'ok', 'the host saves a lineup: ok');
  r := pg_temp.j(x, format('select public.ev_get_lineup(%L)', e));
  perform pg_temp.ok(r ->> 'kind' = 'lineup' and jsonb_array_length(r -> 'rows') = 2, 'a row with no name is not stored');
  perform pg_temp.ok(r -> 'rows' -> 0 = '{"time":"9:00 PM","name":"DJ Naffy"}'::jsonb, 'text is trimmed and an empty note or time is left out');
  perform pg_temp.ok(r -> 'rows' -> 1 = '{"name":"Titanium","note":"Headliner"}'::jsonb, 'the time is optional and a note is kept');

  -- programme kind and replace
  perform pg_temp.ok(pg_temp.t(h, format($q$select public.ev_set_lineup(%L, %L::jsonb)$q$, e, '{"kind":"programme","rows":[{"time":"5 PM","name":"Opening"}]}')) = 'ok', 'switching to programme: ok');
  r := pg_temp.j(h, format('select public.ev_get_lineup(%L)', e));
  perform pg_temp.ok(r ->> 'kind' = 'programme' and jsonb_array_length(r -> 'rows') = 1, 'the new rows replace the old ones');
  perform pg_temp.ok((select count(*) from public.ev_event_lineups where event_id = e) = 1, 'still one row per event');

  -- who may write
  perform pg_temp.ok(pg_temp.t(x, format($q$select public.ev_set_lineup(%L, '{"kind":"lineup","rows":[]}'::jsonb)$q$, e)) = 'not_allowed', 'a stranger cannot write: not_allowed');
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_get_lineup(%L)', e)) ->> 'kind' = 'programme', 'and nothing changed');
  perform pg_temp.ok(pg_temp.t(st, format($q$select public.ev_set_lineup(%L, '{"kind":"lineup","rows":[{"name":"Staff edit"}]}'::jsonb)$q$, e)) = 'ok', 'staff can write');
  perform pg_temp.ok(pg_temp.t(h, format($q$select public.ev_set_lineup(%L, '{"kind":"lineup","rows":[]}'::jsonb)$q$, ghost)) = 'not_found', 'an unknown event: not_found');
  begin
    perform pg_temp.anon();
    perform public.ev_set_lineup(e, '{"kind":"lineup","rows":[]}'::jsonb);
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not call ev_set_lineup');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot call ev_set_lineup');
  end;

  -- limits
  select jsonb_agg(jsonb_build_object('name', 'Act ' || n)) into rows31 from generate_series(1, 31) n;
  perform pg_temp.ok(pg_temp.t(h, format($q$select public.ev_set_lineup(%L, jsonb_build_object('kind', 'lineup', 'rows', %L::jsonb))$q$, e, rows31)) = 'bad_lineup', '31 rows is refused: bad_lineup');
  perform pg_temp.ok(pg_temp.t(h, format($q$select public.ev_set_lineup(%L, jsonb_build_object('kind', 'lineup', 'rows', %L::jsonb))$q$, e, (select jsonb_agg(jsonb_build_object('name', 'Act ' || n)) from generate_series(1, 30) n))) = 'ok', '30 rows is fine');
  perform pg_temp.ok(pg_temp.t(h, format($q$select public.ev_set_lineup(%L, '{"kind":"party","rows":[]}'::jsonb)$q$, e)) = 'bad_lineup', 'an unknown kind: bad_lineup');
  perform pg_temp.ok(pg_temp.t(h, format($q$select public.ev_set_lineup(%L, jsonb_build_object('kind', 'lineup', 'rows', jsonb_build_array(jsonb_build_object('name', %L))))$q$, e, repeat('a', 81))) = 'bad_lineup', 'a name over 80 characters: bad_lineup');
  perform pg_temp.ok(pg_temp.t(h, format($q$select public.ev_set_lineup(%L, '[1]'::jsonb)$q$, e)) = 'bad_lineup', 'a lineup that is not an object: bad_lineup');

  -- an event the viewer cannot open
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_get_lineup(%L)', hidden)) = 'null'::jsonb, 'an event not out yet answers null for a stranger');
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_get_lineup(%L)', hidden)) ->> 'kind' = 'lineup', 'and still answers its host');

  -- copy for Duplicate
  perform pg_temp.admin();
  perform public._ev_copy_lineup(e, hidden);
  perform pg_temp.ok((select jsonb_array_length(rows) from public.ev_event_lineups where event_id = hidden) = 30, '_ev_copy_lineup copies the rows to another event');

  -- the event goes, the lineup goes
  delete from public.events where id = hidden;
  perform pg_temp.ok(not exists (select 1 from public.ev_event_lineups where event_id = hidden), 'deleting the event deletes its lineup');

  -- switch off and access
  update public.ev_settings set value = 'off' where key = 'events_r1';
  perform pg_temp.ok(pg_temp.t(h, format($q$select public.ev_set_lineup(%L, '{"kind":"lineup","rows":[]}'::jsonb)$q$, e)) = 'not_open', 'with the switch off: not_open');
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_get_lineup(%L)', e)) = 'null'::jsonb, 'and the read answers null');
  update public.ev_settings set value = 'on' where key = 'events_r1';
  perform pg_temp.ok(has_function_privilege('anon', 'public.ev_get_lineup(uuid)', 'execute'), 'anon can execute ev_get_lineup');
  perform pg_temp.ok(has_function_privilege('anon', 'public.ev_set_lineup(uuid, jsonb)', 'execute') = false, 'anon cannot execute ev_set_lineup');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.ev_set_lineup(uuid, jsonb)', 'execute'), 'authenticated can execute ev_set_lineup');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public._ev_copy_lineup(uuid, uuid)', 'execute') = false, 'the copy helper is closed');
  raise notice 'ALL EVENTS R1 LINEUP TESTS PASSED';
end $$;
rollback;
