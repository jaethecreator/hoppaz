-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Release 1 looks (supabase/events_r1_looks.sql). LOCAL ONLY: every fixture row rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, crew_stage_voice.sql (crew_members.role 'admin'), events_r1_events.sql and
-- events_r1_looks.sql loaded. Ends with ALL EVENTS R1 LOOKS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_looks_test.sql
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
          case when guest then null else 'look-' || u || '@looktest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
-- ev_set_look as a signed-in user. For anon (u null) the call itself is refused: 'denied'.
create function pg_temp.setl(u uuid, kind text, id uuid, look jsonb) returns text language plpgsql as $$
declare r text;
begin
  if u is null then perform pg_temp.anon(); else perform pg_temp.actor(u); end if;
  begin
    select public.ev_set_look(kind, id, look) into r;
  exception when insufficient_privilege then r := 'denied';
  end;
  perform pg_temp.admin();
  return r;
end $$;
-- ev_get_look as a signed-in user (u null = anon).
create function pg_temp.getl(u uuid, kind text, id uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if u is null then perform pg_temp.anon(); else perform pg_temp.actor(u); end if;
  select public.ev_get_look(kind, id) into r;
  perform pg_temp.admin();
  return r;
end $$;
-- Run a statement as the given role and report whether it was refused with "permission denied".
create function pg_temp.denied(role_name text, q text) returns boolean language plpgsql as $$
declare reason text;
begin
  perform pg_temp.admin();
  begin
    execute 'set local role ' || role_name;
    execute q;
  exception when others then reason := sqlerrm;
  end;
  perform pg_temp.admin();
  return coalesce(reason like 'permission denied%', false);
end $$;
create function pg_temp.ev(host uuid, ttl text, room uuid default null, vis text default 'public', st text default 'live') returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id, room_id, visibility)
  values (ttl, 'Somewhere', now() + interval '2 hours', st, host, room, vis) returning id;
$$;

do $$
declare
  h uuid := pg_temp.newuser('Look Host'); s uuid := pg_temp.newuser('Look Stranger'); ro uuid := pg_temp.newuser('Look Room Owner');
  ra uuid := pg_temp.newuser('Look Room Admin'); rm uuid := pg_temp.newuser('Look Room Member'); st uuid := pg_temp.newuser('Look Staff');
  g uuid := pg_temp.newuser('Look Guest', true);
  e uuid; ecom uuid; epend uuid; e2 uuid; room uuid := gen_random_uuid(); room2 uuid := gen_random_uuid();
  look constant jsonb := '{"pack":"glow","mood":"day","hue":210,"chroma":0.12,"auto":false,"two_d":{"on":true,"template":"clubhouse"}}';
  r jsonb; n int; role_name text; i int;
begin
  update public.profiles set is_admin = true where id = st;
  insert into public.crews (id, name, created_by, visibility) values (room, 'Look Room', ro, 'open'), (room2, 'Look Room Two', ro, 'open');
  insert into public.crew_members (crew_id, user_id, role) values (room, ro, 'owner'), (room, ra, 'admin'), (room, rm, 'member'), (room2, ro, 'owner');
  e := pg_temp.ev(h, 'Look night');
  e2 := pg_temp.ev(h, 'Look night two');
  ecom := pg_temp.ev(h, 'Look community night', room, 'community');
  epend := pg_temp.ev(h, 'Look pending night', null, 'public', 'pending');

  -- ================================================================ the table is closed ===
  perform pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.ev_looks'::regclass), 'ev_looks: row level security is on');
  foreach role_name in array array['anon', 'authenticated'] loop
    perform pg_temp.ok(not has_table_privilege(role_name, 'public.ev_looks', 'select') and not has_table_privilege(role_name, 'public.ev_looks', 'insert')
                       and not has_table_privilege(role_name, 'public.ev_looks', 'update') and not has_table_privilege(role_name, 'public.ev_looks', 'delete'),
                       role_name || ' has no privilege on ev_looks');
  end loop;

  -- ================================================================ events ===
  perform pg_temp.ok(pg_temp.getl(h, 'event', e) is null, 'no look yet: ev_get_look answers null');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, look) = 'ok', 'the host sets an event look');
  r := pg_temp.getl(h, 'event', e);
  perform pg_temp.ok(r ->> 'pack' = 'glow' and r ->> 'mood' = 'day' and (r ->> 'hue')::real = 210 and (r ->> 'chroma')::real = 0.12::real
                     and (r ->> 'auto')::boolean = false and r -> 'two_d' ->> 'template' = 'clubhouse', 'and reads it back, every field');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{}') = 'ok', 'an empty look is fine and takes the defaults');
  r := pg_temp.getl(h, 'event', e);
  perform pg_temp.ok(r ->> 'pack' = 'minimal' and r ->> 'mood' = 'night' and (r ->> 'hue')::real = 40 and (r ->> 'chroma')::real = 0.03::real
                     and (r ->> 'auto')::boolean and r -> 'two_d' = 'null'::jsonb, 'the defaults are minimal, night, hue 40, chroma 0.03, auto on, no 2D');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, look) = 'ok' and pg_temp.setl(h, 'event', e, look) = 'ok', 'setting again answers ok');
  perform pg_temp.ok((select count(*) from public.ev_looks where event_id = e) = 1, 'setting again updates in place: still one row');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"pack":"owambe"}') = 'ok' and pg_temp.getl(h, 'event', e) ->> 'pack' = 'owambe'
                     and (select count(*) from public.ev_looks where event_id = e) = 1, 'a changed look replaces the old one');
  perform pg_temp.ok((select updated_by from public.ev_looks where event_id = e) = h, 'the row remembers who set it');

  perform pg_temp.ok(pg_temp.setl(s, 'event', e, look) = 'not_allowed', 'a stranger cannot set an event look');
  perform pg_temp.ok(pg_temp.getl(h, 'event', e) ->> 'pack' = 'owambe', 'and the look is unchanged');
  perform pg_temp.ok(pg_temp.setl(null, 'event', e, look) = 'denied', 'anon cannot even call ev_set_look');
  perform pg_temp.ok(pg_temp.setl(g, 'event', e, look) = 'need_account', 'a guest with no account cannot set a look');
  perform pg_temp.ok(pg_temp.setl(h, 'party', e, look) = 'bad_kind', 'a bad kind answers bad_kind');
  perform pg_temp.ok(pg_temp.setl(h, 'Event', e, look) = 'bad_kind' and pg_temp.setl(h, '', e, look) = 'bad_kind', 'kinds are exact');
  perform pg_temp.ok(pg_temp.getl(h, 'party', e) is null, 'ev_get_look with a bad kind answers null');

  -- Bad looks (the host is allowed, the look is not).
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"pack":"disco"}') = 'bad_look', 'a bad pack answers bad_look');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"mood":"dusk"}') = 'bad_look', 'a bad mood answers bad_look');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"hue":360}') = 'bad_look' and pg_temp.setl(h, 'event', e, '{"hue":-1}') = 'bad_look', 'hue out of range answers bad_look');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"chroma":0.38}') = 'bad_look' and pg_temp.setl(h, 'event', e, '{"chroma":-0.01}') = 'bad_look', 'chroma out of range answers bad_look');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"hue":"red"}') = 'bad_look' and pg_temp.setl(h, 'event', e, '{"chroma":"lots"}') = 'bad_look', 'a non-numeric hue or chroma answers bad_look');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"hue":"NaN"}') = 'bad_look' and pg_temp.setl(h, 'event', e, '{"chroma":"Infinity"}') = 'bad_look', 'NaN and infinity answer bad_look');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"auto":"maybe"}') = 'bad_look', 'a bad auto answers bad_look (no cast error)');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"auto":7}') = 'bad_look' and pg_temp.setl(h, 'event', e, '{"auto":{"x":1}}') = 'bad_look', 'a numeric or object auto answers bad_look');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '"glow"') = 'bad_look' and pg_temp.setl(h, 'event', e, '[1]') = 'bad_look' and pg_temp.setl(h, 'event', e, 'null') = 'bad_look', 'a look that is not an object answers bad_look');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, ('{"two_d":{"x":"' || repeat('a', 600) || '"}}')::jsonb) = 'bad_look', 'a huge two_d answers bad_look');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"two_d":"clubhouse"}') = 'ok' and pg_temp.getl(h, 'event', e) -> 'two_d' = 'null'::jsonb, 'a two_d that is not an object is dropped');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"auto":"true","hue":"90"}') = 'ok' and (pg_temp.getl(h, 'event', e) ->> 'hue')::real = 90, 'numbers and booleans in text are accepted');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"pack":"minimal","hue":0,"chroma":0.37}') = 'ok', 'the edges of the ranges are fine');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, look) = 'ok', 'a good look is saved again after all those');
  perform pg_temp.ok(pg_temp.setl(h, 'event', e, '{"pack":"disco"}') = 'bad_look' and pg_temp.getl(h, 'event', e) ->> 'pack' = 'glow', 'a rejected look leaves the saved one as it was');

  -- Staff, and ids that are not owners.
  perform pg_temp.ok(pg_temp.setl(st, 'event', e, look) = 'ok', 'staff can set any event look');
  perform pg_temp.ok(pg_temp.setl(st, 'event', gen_random_uuid(), look) = 'not_allowed', 'staff on an event that does not exist: not_allowed, no error');
  perform pg_temp.ok(pg_temp.setl(h, 'event', gen_random_uuid(), look) = 'not_allowed', 'the host on an event that does not exist: not_allowed');
  perform pg_temp.ok(pg_temp.setl(h, 'event', null, look) = 'not_allowed' and pg_temp.setl(st, 'event', null, look) = 'not_allowed', 'a null id: not_allowed');
  perform pg_temp.ok(pg_temp.setl(h, 'event', room, look) = 'not_allowed', 'a crew id passed as an event: not_allowed');
  perform pg_temp.ok(pg_temp.setl(ro, 'room', e, look) = 'not_allowed' and pg_temp.setl(st, 'room', e, look) = 'not_allowed', 'an event id passed as a room: not_allowed (staff too)');
  perform pg_temp.ok(pg_temp.setl(st, 'room', gen_random_uuid(), look) = 'not_allowed', 'staff on a room that does not exist: not_allowed, no error');
  perform pg_temp.ok((select count(*) from public.ev_looks) = 1, 'none of those made a row');

  -- ================================================================ who may read an event look ===
  perform pg_temp.ok(pg_temp.getl(null, 'event', e) ->> 'pack' = 'glow', 'anon reads the look of a public event');
  perform pg_temp.ok(pg_temp.getl(s, 'event', e) ->> 'pack' = 'glow', 'a stranger reads the look of a public event');
  perform pg_temp.ok(pg_temp.getl(g, 'event', e) ->> 'pack' = 'glow', 'a guest reads the look of a public event');
  perform pg_temp.ok(pg_temp.setl(h, 'event', ecom, look) = 'ok' and pg_temp.setl(h, 'event', epend, look) = 'ok', 'setup: looks on a community event and a pending event');
  perform pg_temp.ok(pg_temp.getl(null, 'event', ecom) is null and pg_temp.getl(s, 'event', ecom) is null, 'a community event the viewer is not in the room of: null');
  perform pg_temp.ok(pg_temp.getl(rm, 'event', ecom) ->> 'pack' = 'glow', 'a member of the room reads the community look');
  perform pg_temp.ok(pg_temp.getl(h, 'event', ecom) ->> 'pack' = 'glow', 'the host reads it');
  perform pg_temp.ok(pg_temp.getl(null, 'event', epend) is null and pg_temp.getl(s, 'event', epend) is null, 'a pending event the viewer may not open: null');
  perform pg_temp.ok(pg_temp.getl(h, 'event', epend) ->> 'pack' = 'glow' and pg_temp.getl(st, 'event', epend) ->> 'pack' = 'glow', 'the host and staff read the pending look');
  perform pg_temp.ok(pg_temp.getl(s, 'event', gen_random_uuid()) is null and pg_temp.getl(s, 'event', null) is null, 'an unknown or null event id: null');

  -- ================================================================ rooms ===
  perform pg_temp.ok(pg_temp.getl(s, 'room', room) is null, 'no room look yet: null');
  perform pg_temp.ok(pg_temp.setl(ro, 'room', room, look) = 'ok', 'the room owner sets a room look');
  perform pg_temp.ok(pg_temp.getl(rm, 'room', room) ->> 'pack' = 'glow' and pg_temp.getl(null, 'room', room) ->> 'mood' = 'day', 'and anyone reads it');
  perform pg_temp.ok(pg_temp.setl(ra, 'room', room, '{"pack":"detty","mood":"night"}') = 'ok' and pg_temp.getl(ro, 'room', room) ->> 'pack' = 'detty', 'a room admin sets a room look');
  perform pg_temp.ok((select count(*) from public.ev_looks where crew_id = room) = 1, 'owner and admin share one room row');
  perform pg_temp.ok(pg_temp.setl(rm, 'room', room, look) = 'not_allowed', 'a plain member cannot set a room look');
  perform pg_temp.ok(pg_temp.setl(s, 'room', room, look) = 'not_allowed', 'a stranger cannot set a room look');
  perform pg_temp.ok(pg_temp.setl(h, 'room', room, look) = 'not_allowed', 'an event host who is not in the room cannot');
  perform pg_temp.ok(pg_temp.setl(null, 'room', room, look) = 'denied' and pg_temp.setl(g, 'room', room, look) = 'need_account', 'anon is refused, a guest: need_account');
  perform pg_temp.ok(pg_temp.setl(ro, 'room', room, '{"pack":"disco"}') = 'bad_look' and pg_temp.setl(ro, 'room', room, '{"auto":"maybe"}') = 'bad_look', 'a bad room look answers bad_look');
  perform pg_temp.ok(pg_temp.getl(rm, 'room', room) ->> 'pack' = 'detty', 'the room look is unchanged by all of those');
  perform pg_temp.ok(pg_temp.setl(ro, 'room', room2, look) = 'ok' and pg_temp.setl(ra, 'room', room2, look) = 'not_allowed', 'an admin of one room cannot set the look of another');
  perform pg_temp.ok(pg_temp.setl(st, 'room', room2, '{"mood":"day"}') = 'ok', 'staff can set a room look');
  perform pg_temp.ok(pg_temp.getl(s, 'room', e) is null, 'an event id read as a room: null');
  -- A demoted admin loses the right.
  update public.crew_members set role = 'member' where crew_id = room and user_id = ra;
  perform pg_temp.ok(pg_temp.setl(ra, 'room', room, look) = 'not_allowed', 'an admin who becomes a member can no longer set it');
  update public.crew_members set role = 'admin' where crew_id = room and user_id = ra;

  -- ================================================================ no direct access ===
  foreach role_name in array array['anon', 'authenticated'] loop
    perform pg_temp.ok(pg_temp.denied(role_name, 'select count(*) from public.ev_looks'), role_name || ' cannot select from ev_looks');
    perform pg_temp.ok(pg_temp.denied(role_name, format('insert into public.ev_looks (owner_kind, event_id) values (%L, %L)', 'event', e2)), role_name || ' cannot insert into ev_looks');
    perform pg_temp.ok(pg_temp.denied(role_name, format('update public.ev_looks set pack = %L', 'glow')), role_name || ' cannot update ev_looks');
    perform pg_temp.ok(pg_temp.denied(role_name, 'delete from public.ev_looks'), role_name || ' cannot delete from ev_looks');
  end loop;
  perform pg_temp.ok(not has_function_privilege('anon', 'public.ev_set_look(text, uuid, jsonb)', 'execute') and has_function_privilege('authenticated', 'public.ev_set_look(text, uuid, jsonb)', 'execute'),
                     'ev_set_look: authenticated only');
  perform pg_temp.ok(has_function_privilege('anon', 'public.ev_get_look(text, uuid)', 'execute') and has_function_privilege('authenticated', 'public.ev_get_look(text, uuid)', 'execute'),
                     'ev_get_look: anon and authenticated');
  perform pg_temp.ok(not has_function_privilege('anon', 'public._ev_room_manage(uuid)', 'execute') and not has_function_privilege('authenticated', 'public._ev_room_manage(uuid)', 'execute'),
                     '_ev_room_manage: not callable by anon or authenticated');

  -- ================================================================ the table keeps itself tidy ===
  begin
    insert into public.ev_looks (owner_kind, event_id, crew_id) values ('event', e2, room);
    perform pg_temp.ok(false, 'a row with two owners is refused');
  exception when check_violation then perform pg_temp.ok(true, 'a row with two owners is refused'); end;
  begin
    insert into public.ev_looks (owner_kind, crew_id) values ('event', room);
    perform pg_temp.ok(false, 'an event row with the crew owner is refused');
  exception when check_violation then perform pg_temp.ok(true, 'an event row with the crew owner is refused'); end;
  begin
    insert into public.ev_looks (owner_kind) values ('room');
    perform pg_temp.ok(false, 'a row with no owner is refused');
  exception when check_violation then perform pg_temp.ok(true, 'a row with no owner is refused'); end;
  begin
    insert into public.ev_looks (owner_kind, event_id) values ('event', e);
    perform pg_temp.ok(false, 'a second row for the same event is refused');
  exception when unique_violation then perform pg_temp.ok(true, 'a second row for the same event is refused'); end;
  begin
    insert into public.ev_looks (owner_kind, event_id) values ('event', gen_random_uuid());
    perform pg_temp.ok(false, 'a look for an event that does not exist is refused');
  exception when foreign_key_violation then perform pg_temp.ok(true, 'a look for an event that does not exist is refused'); end;

  -- ================================================================ deleting the owner deletes the look ===
  perform pg_temp.ok(pg_temp.setl(h, 'event', e2, look) = 'ok', 'setup: a look on a second event');
  perform pg_temp.ok(exists (select 1 from public.ev_looks where event_id = e2), 'and it is stored');
  delete from public.events where id = e2;
  perform pg_temp.ok(not exists (select 1 from public.ev_looks where event_id = e2), 'deleting the event deletes its look');
  perform pg_temp.ok(exists (select 1 from public.ev_looks where event_id = e), 'and only that one');
  delete from public.crews where id = room2;
  perform pg_temp.ok(not exists (select 1 from public.ev_looks where crew_id = room2) and exists (select 1 from public.ev_looks where crew_id = room), 'deleting the crew deletes its room look, only that one');
  -- Deleting a person keeps their events (host_id goes to null), so the looks stay; the row just forgets who set it.
  delete from auth.users where id = h;
  perform pg_temp.ok(exists (select 1 from public.ev_looks where event_id = e) and not exists (select 1 from public.ev_looks where updated_by = h),
                     'deleting the person who set a look keeps the look and clears updated_by');
  delete from public.events where id = ecom;
  perform pg_temp.ok(not exists (select 1 from public.ev_looks where event_id = ecom) and exists (select 1 from public.ev_looks where event_id = epend), 'deleting a community event deletes its look only');

  raise notice 'ALL EVENTS R1 LOOKS TESTS PASSED';
end $$;
rollback;
