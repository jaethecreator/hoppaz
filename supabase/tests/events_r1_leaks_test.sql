-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Release 1 leak checks across all six events_r1_ files. LOCAL ONLY: everything rolls back.
-- Needs all six events_r1_ files loaded (and starter_quests.sql if you use it: the starter quest checks skip themselves if it is missing).
-- Proves, with the real roles anon and authenticated:
--   1. none of the new tables can be read or written by anon or authenticated, and every one has row level security on;
--   2. the online link cannot be read from the events table, the links table, the old read policy, or any list; ev_get_event gives it to
--      the host and to people who are going only (not to a stranger, a visitor, a person waiting for approval, or a declined person);
--   3. invite and community events are not returned by events_near (the /api/public/events read), events_deck, claim_checkin or a plain
--      select on events, for anon or a stranger;
--   4. the starter quests hazard notes in events_r1_events.sql and EVENTS_R1_ORDER.md are accurate.
-- Ends with ALL EVENTS R1 LEAK TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_leaks_test.sql
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
create function pg_temp.newuser(shown text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leak-' || u || '@evtest.invalid', false, '{}', json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
-- Run one statement as a signed-in user (or as anon when u is null) and hand back its jsonb result.
create function pg_temp.j(u uuid, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if u is null then perform pg_temp.anon(); else perform pg_temp.actor(u); end if;
  execute q into r;
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.mk(u uuid, draft jsonb) returns jsonb language plpgsql as $$
begin
  update public.events set created_at = now() - interval '2 hours' where host_id = u;
  return pg_temp.j(u, format('select public.ev_create_event(%L::jsonb)', draft::text));
end $$;
create function pg_temp.link_of(u uuid, ev uuid) returns text language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_get_event(%L)', ev::text)) ->> 'online_link';
end $$;
-- Everything readable about events, read as the given role (null = anon), as one string.
create function pg_temp.surfaces(u uuid) returns text language plpgsql as $$
declare t text := '';
begin
  if u is null then perform pg_temp.anon(); else perform pg_temp.actor(u); end if;
  select t || coalesce(string_agg(to_jsonb(e)::text, ' '), '') into t from public.events e;
  select t || coalesce(public.ev_list_events()::text, '') into t;
  if u is not null then
    select t || coalesce(public.ev_my_events()::text, '') into t;
    select t || coalesce(public.ev_rooms_for_me()::text, '') into t;
  end if;
  select t || coalesce(string_agg(to_jsonb(n)::text, ' '), '') into t from public.events_near(6.45, 3.42, 100000, now() - interval '1 day', now() + interval '30 days') n;
  select t || coalesce(string_agg(to_jsonb(d)::text, ' '), '') into t from public.events_deck(6.45, 3.42, 100) d;
  perform pg_temp.admin();
  return t;
end $$;

do $$
declare
  h uuid := pg_temp.newuser('Leak Host'); s uuid := pg_temp.newuser('Leak Stranger'); m uuid := pg_temp.newuser('Leak Member');
  go uuid := pg_temp.newuser('Leak Going'); wt uuid := pg_temp.newuser('Leak Waiting'); dc uuid := pg_temp.newuser('Leak Declined');
  room uuid := gen_random_uuid();
  link constant text := 'https://zoom.us/j/LEAKCHECK778899';
  r jsonb; ev_online uuid; ev_appr uuid; ev_pub uuid; ev_inv uuid; ev_com uuid; n int; t text; f record; role_name text; reg uuid;
begin
  insert into public.areas (name, side, centroid) values ('EV Test Area', 'island', st_point(3.42, 6.45)::geography) on conflict (name) do nothing;
  insert into public.crews (id, name, created_by, visibility) values (room, 'Leak Host Room', h, 'open');
  insert into public.crew_members (crew_id, user_id, role) values (room, h, 'owner'), (room, m, 'member');

  -- ============================================================ 1. the new tables ===
  for f in select c.oid, c.relname, c.relrowsecurity from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname like 'ev\_%'
  loop
    perform pg_temp.ok(f.relrowsecurity, f.relname || ': row level security is on');
    foreach role_name in array array['anon', 'authenticated'] loop
      perform pg_temp.ok(not has_table_privilege(role_name, f.oid, 'select') and not has_table_privilege(role_name, f.oid, 'insert')
                         and not has_table_privilege(role_name, f.oid, 'update') and not has_table_privilege(role_name, f.oid, 'delete'),
                         f.relname || ': ' || role_name || ' has no privilege on it');
      begin
        execute 'set local role ' || role_name;
        execute format('select count(*) from public.%I', f.relname) into n;
        execute 'reset role';
        perform pg_temp.ok(false, f.relname || ': ' || role_name || ' must not read it');
      exception when insufficient_privilege then
        execute 'reset role';
        perform pg_temp.ok(true, f.relname || ': a real read as ' || role_name || ' is refused');
      end;
    end loop;
  end loop;
  perform pg_temp.ok((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'ev\_%') >= 11,
                     'all eleven new tables were found (so the loop above did look at them)');

  -- ============================================================ 2. the online link ===
  r := pg_temp.mk(h, json_build_object('title', 'Leak online night', 'kind', 'online', 'link_type', 'zoom', 'online_link', link)::jsonb);
  ev_online := (r -> 'event' ->> 'id')::uuid;
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'event' ->> 'online_link' = link, 'setup: a public online event with a link');
  perform pg_temp.ok(not exists (select 1 from public.events e where to_jsonb(e)::text like '%LEAKCHECK778899%'), 'the link is in no column of the events table');
  perform pg_temp.ok(exists (select 1 from public.ev_event_links l where l.event_id = ev_online and l.link = 'https://zoom.us/j/LEAKCHECK778899'), 'it is in the closed links table');

  -- Registered people: going, waiting for approval, declined.
  perform pg_temp.ok((pg_temp.j(go, format('select public.ev_register(%L, ''{}''::jsonb)', ev_online)) ->> 'ok')::boolean, 'setup: a person registers and is going');
  r := pg_temp.mk(h, json_build_object('title', 'Leak approval night', 'kind', 'online', 'link_type', 'zoom', 'online_link', link, 'requires_approval', true)::jsonb);
  ev_appr := (r -> 'event' ->> 'id')::uuid;
  r := pg_temp.j(wt, format('select public.ev_register(%L, ''{}''::jsonb)', ev_appr));
  perform pg_temp.ok((r ->> 'ok')::boolean and (select status from public.ev_registrations where event_id = ev_appr and user_id = wt) = 'requested', 'setup: a person waits for approval');
  perform pg_temp.j(dc, format('select public.ev_register(%L, ''{}''::jsonb)', ev_appr));
  select id into reg from public.ev_registrations where event_id = ev_appr and user_id = dc;
  r := pg_temp.j(h, format('select public.ev_decide(%L, ''decline'')', reg));
  perform pg_temp.ok((r ->> 'ok')::boolean and (select status from public.ev_registrations where event_id = ev_appr and user_id = dc) = 'declined', 'setup: a person is declined');

  -- ev_get_event.
  perform pg_temp.ok(pg_temp.link_of(h, ev_online) = link, 'the host gets the link from ev_get_event');
  perform pg_temp.ok(pg_temp.link_of(go, ev_online) = link, 'a person who is going gets it');
  perform pg_temp.ok(pg_temp.link_of(s, ev_online) is null and pg_temp.j(s, format('select public.ev_get_event(%L)', ev_online::text)) ->> 'title' = 'Leak online night',
                     'a signed-in stranger opens the event and gets no link');
  perform pg_temp.ok(pg_temp.link_of(null, ev_online) is null and pg_temp.j(null, format('select public.ev_get_event(%L)', ev_online::text)) ->> 'title' = 'Leak online night',
                     'a visitor with no account (anon) opens the event and gets no link');
  perform pg_temp.ok(pg_temp.link_of(go, ev_appr) is null and pg_temp.link_of(wt, ev_appr) is null and pg_temp.link_of(dc, ev_appr) is null,
                     'someone not registered for the approval event, waiting, or declined gets no link');
  perform pg_temp.ok(pg_temp.link_of(m, ev_online) is null, 'a member of the host''s room who has not registered gets no link');
  perform pg_temp.ok(coalesce(pg_temp.j(s, format('select public.ev_get_event(%L)', (select slug from public.events where id = ev_online)))::text, '') not like '%LEAKCHECK778899%',
                     'opening by slug gives a stranger no link either');
  perform pg_temp.ok(pg_temp.j(s, format('select public.ev_viewer_state(%L)', ev_online))::text not like '%LEAKCHECK778899%', 'ev_viewer_state carries no link');

  -- Direct reads and the old events read policy, as anon and as a stranger.
  perform pg_temp.ok(pg_temp.surfaces(null) not like '%LEAKCHECK778899%', 'anon: events, lists, events_near and events_deck carry no link');
  perform pg_temp.ok(pg_temp.surfaces(s) not like '%LEAKCHECK778899%', 'a stranger: events, lists, events_near, events_deck, my events and rooms carry no link');
  perform pg_temp.anon();
  select count(*) into n from public.events where id = ev_online;
  perform pg_temp.admin();
  perform pg_temp.ok(n = 1, 'control: the old read policy does show anon the public event row itself (so the checks above are not vacuous)');
  begin
    perform pg_temp.actor(s);
    perform l.link from public.ev_event_links l;
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a stranger must not read ev_event_links');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a stranger reading ev_event_links directly is refused');
  end;
  begin
    perform pg_temp.anon();
    perform l.link from public.ev_event_links l;
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not read ev_event_links');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon reading ev_event_links directly is refused');
  end;
  begin
    perform pg_temp.actor(s);
    execute 'select online_link from public.events';
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'events has no online_link column');
  exception when undefined_column then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'selecting online_link from events is an error: no such column');
  end;
  -- The host's own policy branch (created_by = auth.uid()) only widens rows, never columns: the link stays out of the row.
  perform pg_temp.actor(h);
  select string_agg(to_jsonb(e)::text, ' ') into t from public.events e where e.id = ev_online;
  perform pg_temp.admin();
  perform pg_temp.ok(t is not null and t not like '%LEAKCHECK778899%', 'even the host reading the row from the table gets no link there (only ev_get_event gives it)');

  -- ===================================== 3. invite and community events on the old readers ===
  r := pg_temp.mk(h, '{"title":"Leak public night","place_name":"Leak Hall","lat":6.45,"lng":3.42}');
  ev_pub := (r -> 'event' ->> 'id')::uuid;
  r := pg_temp.mk(h, '{"title":"Leak invite night","visibility":"invite","place_name":"Leak Secret","lat":6.45,"lng":3.42}');
  ev_inv := (r -> 'event' ->> 'id')::uuid;
  r := pg_temp.mk(h, '{"title":"Leak community night","visibility":"community","place_name":"Leak Clubhouse","lat":6.45,"lng":3.42}');
  ev_com := (r -> 'event' ->> 'id')::uuid;
  perform pg_temp.ok(ev_pub is not null and ev_inv is not null and ev_com is not null
                     and (select status from public.events where id = ev_pub) = 'live'
                     and (select status from public.events where id = ev_inv) = 'unlisted'
                     and (select status from public.events where id = ev_com) = 'unlisted', 'setup: one public, one invite and one community event, all with a pin');

  -- events_near is what /api/public/events calls (src/app/api/public/events/route.ts).
  foreach role_name in array array['anon', 'authenticated'] loop
    if role_name = 'anon' then perform pg_temp.anon(); else perform pg_temp.actor(s); end if;
    select count(*) into n from public.events_near(6.45, 3.42, 100000, now() - interval '1 day', now() + interval '30 days') where id in (ev_inv, ev_com);
    perform pg_temp.admin();
    perform pg_temp.ok(n = 0, role_name || ': events_near returns no invite or community event');
    if role_name = 'anon' then perform pg_temp.anon(); else perform pg_temp.actor(s); end if;
    select count(*) into n from public.events_near(6.45, 3.42, 100000, now() - interval '1 day', now() + interval '30 days') where id = ev_pub;
    perform pg_temp.admin();
    perform pg_temp.ok(n = 1, role_name || ': control, events_near does return the public event with a pin');
    if role_name = 'anon' then perform pg_temp.anon(); else perform pg_temp.actor(s); end if;
    select count(*) into n from public.events where id in (ev_inv, ev_com);
    perform pg_temp.admin();
    perform pg_temp.ok(n = 0, role_name || ': a plain select on events shows no invite or community event');
  end loop;
  -- A room member: the old readers still do not know the community event (the new ev_ functions are the way in).
  perform pg_temp.actor(m);
  select count(*) into n from public.events_near(6.45, 3.42, 100000, now() - interval '1 day', now() + interval '30 days') where id in (ev_inv, ev_com);
  perform pg_temp.ok(n = 0, 'a room member: events_near still returns no community event');
  select count(*) into n from public.events where id in (ev_inv, ev_com);
  perform pg_temp.admin();
  perform pg_temp.ok(n = 0, 'a room member: the old read policy still shows no community row');

  -- events_deck reads event_heat; the public control event must appear before the others count.
  perform pg_temp.actor(s);
  select count(*) into n from public.events_deck(6.45, 3.42, 100) where id in (ev_inv, ev_com);
  perform pg_temp.ok(n = 0, 'events_deck returns no invite or community event');
  select count(*) into n from public.events_deck(6.45, 3.42, 100) where id = ev_pub;
  perform pg_temp.admin();
  perform pg_temp.ok(n = 1, 'control: events_deck does return the public event');

  -- claim_checkin only finds status = live.
  r := pg_temp.j(s, format('select public.claim_checkin(%L, 6.45, 3.42)', ev_inv));
  perform pg_temp.ok(r ->> 'ok' = 'false' and r ->> 'reason' = 'no_event' and not exists (select 1 from public.checkins where event_id = ev_inv),
                     'claim_checkin on an invite event answers no_event and records nothing');
  r := pg_temp.j(s, format('select public.claim_checkin(%L, 6.45, 3.42)', ev_com));
  perform pg_temp.ok(r ->> 'ok' = 'false' and r ->> 'reason' = 'no_event' and not exists (select 1 from public.checkins where event_id = ev_com),
                     'claim_checkin on a community event answers no_event and records nothing');
  -- Control: the public event is found (too far from this spot, so nothing is recorded and no scoring data is needed).
  r := pg_temp.j(s, format('select public.claim_checkin(%L, 7.2, 3.0)', ev_pub));
  perform pg_temp.ok(r ->> 'reason' = 'too_far', 'control: claim_checkin finds the public event (answers too_far from far away)');

  -- ====================================================== 4. the starter quests hazard ===
  if to_regprocedure('public.starter_checkin_title(text)') is null then
    raise notice 'SKIP: starter_quests.sql is not loaded, the hazard checks are skipped';
  else
    perform pg_temp.ok(public.starter_checkin_title(null) is null
                       and (select is_nullable = 'NO' from information_schema.columns where table_schema = 'public' and table_name = 'quests' and column_name = 'title'),
                       'hazard note: a null venue_name would make a null quest title, and quests.title is not null');
    begin
      insert into public.events (title, venue_name, starts_at, status) values ('Null venue hazard', null, now() + interval '1 day', 'live');
      perform pg_temp.ok(false, 'a live event with a null venue_name must fail while the starter quests trigger is installed');
    exception when not_null_violation then
      perform pg_temp.ok(true, 'hazard note: a live event with a null venue_name fails to publish (not null on the quest title)');
    end;
    perform pg_temp.ok((select venue_name from public.events where id = ev_online) = 'Online'
                       and (select title from public.quests where key = 'kit-' || ev_online || '-checkin') = 'Check in at Online',
                       'so an online event stores the placeholder Online, and its kit has a check-in quest "Check in at Online" nobody can finish (no pin)');
    perform pg_temp.ok((pg_temp.j(h, format('select public.ev_get_event(%L)', ev_online::text)) ->> 'venue_name') = '', 'while the functions still return an empty venue_name for it');
    -- Moving an in-person event online must not trip the follow trigger either.
    r := pg_temp.mk(h, '{"title":"Leak moves online","place_name":"Leak Hall 2","lat":6.45,"lng":3.42}');
    r := pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', r -> 'event' ->> 'id',
                             json_build_object('kind', 'online', 'link_type', 'meet', 'online_link', 'https://meet.google.com/abc-defg-hij')::text));
    perform pg_temp.ok((r ->> 'ok')::boolean, 'an in-person event can be moved online while the starter quest follow trigger is installed');
    -- Invite and community events get no starter kit (the trigger only fires for status live).
    perform pg_temp.ok(not exists (select 1 from public.quests where key like 'kit-' || ev_inv || '-%' or key like 'kit-' || ev_com || '-%'),
                       'invite and community events get no starter quests');
  end if;

  raise notice 'ALL EVENTS R1 LEAK TESTS PASSED';
end $$;
rollback;
