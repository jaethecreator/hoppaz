-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Release 1 events (supabase/events_r1_events.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql and events_r1_events.sql loaded (later events_r1_ files may be loaded too).
-- Ends with ALL EVENTS R1 EVENTS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_events_test.sql
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
          case when guest then null else 'evt-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
-- Run one statement as a signed-in user and hand back its jsonb result.
create function pg_temp.j(u uuid, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(u);
  execute q into r;
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.mk(u uuid, draft jsonb) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_create_event(%L::jsonb)', draft::text));
end $$;
create function pg_temp.upd(u uuid, ev uuid, patch jsonb) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_update_event(%L, %L::jsonb)', ev, patch::text));
end $$;
create function pg_temp.get(u uuid, k text) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_get_event(%L)', k));
end $$;
-- Make the person's events old enough that the 5 an hour limit is not in the way.
create function pg_temp.relax(u uuid) returns void language sql as $$
  update public.events set created_at = now() - interval '2 hours' where host_id = u;
$$;
create function pg_temp.listed(u uuid, ev uuid) returns boolean language plpgsql as $$
declare r jsonb;
begin
  r := pg_temp.j(u, 'select public.ev_list_events()');
  return exists (select 1 from jsonb_array_elements(r) x where x ->> 'id' = ev::text);
end $$;

do $$
declare
  h uuid := pg_temp.newuser('Evt Host'); s uuid := pg_temp.newuser('Evt Stranger'); m uuid := pg_temp.newuser('Evt Member');
  g uuid := pg_temp.newuser('Evt Guest', true); st uuid := pg_temp.newuser('Evt Staff'); r5 uuid := pg_temp.newuser('Evt Rate');
  room uuid := gen_random_uuid();
  r jsonb; e jsonb; e2 jsonb; id1 uuid; id2 uuid; id3 uuid; id4 uuid; n int; i int; titles text[]; idt uuid; idl uuid; idp uuid; ida uuid; gid uuid; tt jsonb;
begin
  update public.profiles set is_admin = true where id = st;
  insert into public.areas (name, side, centroid) values ('EV Test Area', 'island', st_point(3.42, 6.45)::geography) on conflict (name) do nothing;

  -- Who may create.
  r := pg_temp.mk(g, '{"title":"Guest event"}');
  perform pg_temp.ok(r ->> 'reason' = 'need_account', 'a guest with no account cannot make an event');
  begin
    perform pg_temp.anon();
    perform public.ev_create_event('{"title":"Anon event"}');
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not be able to call ev_create_event');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot call ev_create_event');
  end;

  -- A name is enough.
  r := pg_temp.mk(h, '{"title":"  Rooftop Sundown  "}');
  perform pg_temp.ok((r ->> 'ok')::boolean, 'a name is enough');
  e := r -> 'event'; id1 := (e ->> 'id')::uuid;
  perform pg_temp.ok(e ->> 'title' = 'Rooftop Sundown' and e ->> 'status' = 'live' and e ->> 'kind' = 'in_person'
                     and e ->> 'visibility' = 'public' and e ->> 'timezone' = 'Africa/Lagos', 'defaults: trimmed name, live, in person, public, Lagos time');
  perform pg_temp.ok(e ->> 'lat' is null and e ->> 'venue_name' = '' and (e ->> 'capacity') is null and e ->> 'online_link' is null,
                     'no place means no pin, an empty venue name, no capacity and no link');
  perform pg_temp.ok((e -> 'host' ->> 'id')::uuid = h and e ->> 'slug' like 'rooftop-sundown-%' and (e ->> 'going')::int = 0, 'the host is the caller; a slug is made');
  perform pg_temp.ok((e ->> 'starts_at')::timestamptz > now() and (e ->> 'starts_at')::timestamptz < now() + interval '2 days', 'the default start is tomorrow evening');
  perform pg_temp.ok(exists (select 1 from public.events where id = id1 and status = 'live' and source = 'hopper' and host_id = h and created_by = h),
                     'stored as live, source hopper, host_id and created_by set (the trigger made it pending, the function flipped it)');
  perform pg_temp.ok(pg_temp.listed(s, id1), 'a public event is in a stranger''s list');

  -- Names.
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"   "}') ->> 'reason' = 'need_name', 'an empty name is refused');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"x"}') ->> 'reason' = 'name_too_short', 'a one letter name is refused');
  perform pg_temp.ok(pg_temp.mk(h, json_build_object('title', repeat('a', 121))::jsonb) ->> 'reason' = 'name_too_long', '121 characters is too long');

  -- Online: no pin, the link is closed, only the host and going people get it.
  r := pg_temp.mk(h, '{"title":"Online night","kind":"online","link_type":"zoom","online_link":"https://zoom.us/j/12345"}');
  e := r -> 'event'; id2 := (e ->> 'id')::uuid;
  perform pg_temp.ok((r ->> 'ok')::boolean and e ->> 'kind' = 'online' and e ->> 'link_type' = 'zoom' and e ->> 'lat' is null and e ->> 'venue_name' = '',
                     'an online event has a link type, no pin and no venue');
  perform pg_temp.ok(e ->> 'online_link' = 'https://zoom.us/j/12345', 'the host gets the link');
  perform pg_temp.ok(pg_temp.get(s, id2::text) ->> 'online_link' is null and pg_temp.get(s, id2::text) ->> 'link_type' = 'zoom',
                     'a stranger gets the link type but not the link');
  perform pg_temp.anon();
  select public.ev_get_event(id2::text) into e2;
  perform pg_temp.admin();
  perform pg_temp.ok(e2 ->> 'online_link' is null and e2 ->> 'title' = 'Online night', 'a visitor with no account sees the event and not the link');
  perform pg_temp.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name = 'online_link'),
                     'LEAK CHECK: the events table has no online_link column for the public read policy to expose');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ev_event_links', 'select') and not has_table_privilege('anon', 'public.ev_event_links', 'select'),
                     'LEAK CHECK: nobody but the service role can read the links table');
  begin
    perform pg_temp.actor(s);
    select count(*) into n from public.ev_event_links;
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a signed-in user must not read the links table');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'LEAK CHECK: reading the links table directly is refused');
  end;

  -- Link and kind checks.
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Bad link","kind":"online","online_link":"zoom.us/abc"}') ->> 'reason' = 'bad_link', 'a link must start with https://');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Bad type","kind":"online","online_link":"https://x.example/a","link_type":"skype"}') ->> 'reason' = 'bad_link_type', 'link types are zoom, meet, whatsapp, other');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Bad kind","kind":"virtual"}') ->> 'reason' = 'bad_kind', 'kinds are in_person, online, hybrid');
  r := pg_temp.mk(h, '{"title":"WhatsApp call","kind":"online","link_type":"whatsapp","online_link":"https://chat.whatsapp.com/abc"}');
  perform pg_temp.ok((r -> 'event' ->> 'capacity')::int = 32, 'a WhatsApp call defaults to 32 people');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Big call","kind":"online","link_type":"whatsapp","online_link":"https://chat.whatsapp.com/abc","capacity":40}') ->> 'reason' = 'whatsapp_max_32',
                     'a WhatsApp call cannot hold more than 32');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Zero","capacity":0}') ->> 'reason' = 'bad_capacity' and pg_temp.mk(h, '{"title":"Half","capacity":2.5}') ->> 'reason' = 'bad_capacity',
                     'capacity is a whole number of 1 or more');

  perform pg_temp.relax(h);
  -- Hybrid: place and link together.
  r := pg_temp.mk(h, '{"title":"Hybrid","kind":"hybrid","place_name":"Maroko Hall","lat":6.44,"lng":3.47,"link_type":"meet","online_link":"https://meet.google.com/abc-defg"}');
  e := r -> 'event';
  perform pg_temp.ok((r ->> 'ok')::boolean and (e ->> 'lat')::float = 6.44 and e ->> 'venue_name' = 'Maroko Hall' and e ->> 'online_link' is not null and e ->> 'area' is not null,
                     'a hybrid event has a pin, a venue, a link and a nearest area');

  perform pg_temp.relax(h);
  -- Place rules.
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Abuja","lat":9.07,"lng":7.4}') ->> 'reason' = 'lagos_only', 'a pin outside Lagos is refused');
  e := pg_temp.mk(h, '{"title":"By area","area":"EV Test Area","place_name":"The Hall"}') -> 'event';
  perform pg_temp.ok((e ->> 'lat')::float between 6.449 and 6.451 and e ->> 'area' = 'EV Test Area', 'an area with no coordinates puts the pin at the area centre');
  e := pg_temp.mk(h, '{"title":"Name only","place_name":"Somewhere nice"}') -> 'event';
  perform pg_temp.ok(e ->> 'lat' is null and e ->> 'venue_name' = 'Somewhere nice', 'a place name with no pin stays off the map but keeps its name');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Short place","place_name":"X"}') ->> 'reason' = 'bad_place', 'a one letter place is refused');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Bad time","starts_at":"tomorrow-ish"}') ->> 'reason' = 'bad_start', 'a start that is not a time is refused');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Backwards","starts_at":"2030-01-02T20:00:00Z","ends_at":"2030-01-02T19:00:00Z"}') ->> 'reason' = 'end_before_start', 'it cannot end before it starts');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Odd zone","timezone":"Mars/Olympus"}') ->> 'reason' = 'bad_timezone', 'an unknown time zone is refused');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Odd cover","cover_url":"javascript:alert(1)"}') ->> 'reason' = 'bad_cover', 'a cover must be an https link or a path');

  -- The silent limit: 5 an hour, then try_again_later. The 5 above were the host, so use a new person.
  for i in 1..5 loop
    perform pg_temp.ok((pg_temp.mk(r5, json_build_object('title', 'Rate ' || i)::jsonb) ->> 'ok')::boolean, 'event ' || i || ' of 5 goes');
  end loop;
  r := pg_temp.mk(r5, '{"title":"Rate 6"}');
  perform pg_temp.ok(r ->> 'reason' = 'try_again_later' and (r ->> 'ok')::boolean is false, 'the sixth in an hour is try_again_later and nothing more is said');
  update public.events set created_at = now() - interval '2 hours' where host_id = r5;
  perform pg_temp.ok((pg_temp.mk(r5, '{"title":"Rate 7"}') ->> 'ok')::boolean, 'an hour later the person can post again');

  perform pg_temp.relax(h);
  -- Visibility. Invite: unlisted, by link only. The old readers cannot see it.
  r := pg_temp.mk(h, '{"title":"Invite only night","visibility":"invite","place_name":"Secret spot","lat":6.45,"lng":3.42}');
  id3 := (r -> 'event' ->> 'id')::uuid;
  perform pg_temp.ok(r -> 'event' ->> 'status' = 'live' and r -> 'event' ->> 'visibility' = 'invite', 'an invite event reads as live');
  perform pg_temp.ok((select status from public.events where id = id3) = 'unlisted', 'LEAK CHECK: and is stored as unlisted, which every old reader ignores');
  perform pg_temp.ok(not pg_temp.listed(s, id3) and not pg_temp.listed(m, id3), 'an invite event is in nobody else''s list');
  perform pg_temp.ok(pg_temp.listed(h, id3), 'but the host sees their own in the list');
  perform pg_temp.ok(pg_temp.get(s, id3::text) ->> 'title' = 'Invite only night', 'a stranger with the link opens it');
  perform pg_temp.ok(pg_temp.get(s, (r -> 'event' ->> 'slug')) ->> 'id' = id3::text, 'by slug as well');
  perform pg_temp.actor(s);
  select count(*) into n from public.events where id = id3;
  perform pg_temp.admin();
  perform pg_temp.ok(n = 0, 'LEAK CHECK: the old public read policy shows a stranger no row for it');
  perform pg_temp.actor(h);
  select count(*) into n from public.events where id = id3;
  perform pg_temp.admin();
  perform pg_temp.ok(n = 1, 'the creator still reads their own row');
  select count(*) into n from public.events_near(6.45, 3.42, 100000, now() - interval '1 day', now() + interval '10 days') where id = id3;
  perform pg_temp.ok(n = 0, 'LEAK CHECK: events_near (map and /api/public/events) does not return it');

  -- Community: members of the host's room only.
  insert into public.crews (id, name, created_by, visibility) values (room, 'Evt Host Room', h, 'open');
  insert into public.crew_members (crew_id, user_id, role) values (room, h, 'owner'), (room, m, 'member');
  r := pg_temp.mk(h, '{"title":"Community night","visibility":"community"}');
  id4 := (r -> 'event' ->> 'id')::uuid;
  perform pg_temp.ok((r ->> 'ok')::boolean and (select room_id from public.events where id = id4) = room and (select status from public.events where id = id4) = 'unlisted',
                     'a community event is tied to the host''s room and stored unlisted');
  perform pg_temp.ok(pg_temp.listed(m, id4) and pg_temp.listed(h, id4) and not pg_temp.listed(s, id4), 'listed for room members and the host, not for a stranger');
  perform pg_temp.ok(pg_temp.get(m, id4::text) is not null and pg_temp.get(s, id4::text) is null, 'a member opens it; a stranger gets nothing');
  perform pg_temp.anon();
  select public.ev_get_event(id4::text) into e2;
  perform pg_temp.admin();
  perform pg_temp.ok(e2 is null, 'a visitor with no account gets nothing');
  perform pg_temp.ok(pg_temp.mk(s, '{"title":"No room","visibility":"community"}') ->> 'reason' = 'need_room', 'community needs a room');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Odd","visibility":"secret"}') ->> 'reason' = 'bad_visibility', 'visibility is public, community or invite');

  -- The trigger keeps live and public together, however it changes.
  update public.events set visibility = 'public' where id = id3;
  perform pg_temp.ok((select status from public.events where id = id3) = 'live', 'making it public makes it live');
  update public.events set visibility = 'invite' where id = id3;
  perform pg_temp.ok((select status from public.events where id = id3) = 'unlisted', 'making it invite again makes it unlisted');
  update public.events set status = 'live' where id = id3;
  perform pg_temp.ok((select status from public.events where id = id3) = 'unlisted', 'staff setting live on a non-public event cannot expose it');

  -- Status values.
  begin
    insert into public.events (title, venue_name, starts_at, status) values ('Bad status', 'Somewhere', now(), 'bogus');
    perform pg_temp.ok(false, 'a made-up status must be refused');
  exception when check_violation then
    perform pg_temp.ok(true, 'the status check refuses a made-up value');
  end;
  insert into public.events (title, venue_name, starts_at, status) values ('Hidden one', 'Somewhere', now() + interval '1 day', 'hidden');
  insert into public.events (title, venue_name, starts_at, status) values ('Pending one', 'Somewhere', now() + interval '1 day', 'pending');
  perform pg_temp.ok(true, 'hidden and pending are allowed');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(pg_temp.j(s, 'select public.ev_list_events()')) x where x ->> 'title' in ('Hidden one', 'Pending one')),
                     'hidden and pending events are not listed');
  perform pg_temp.ok(pg_temp.get(s, (select id::text from public.events where title = 'Hidden one')) is null
                     and pg_temp.get(s, (select id::text from public.events where title = 'Pending one')) is null, 'and cannot be opened by a stranger');
  perform pg_temp.ok(pg_temp.get(st, (select id::text from public.events where title = 'Hidden one')) ->> 'status' = 'hidden', 'staff can open a hidden event');

  -- The list window: 4 hours back, 45 days ahead.
  insert into public.events (title, venue_name, starts_at, status, host_id) values
    ('Win old', 'Somewhere', now() - interval '5 hours', 'live', h), ('Win recent', 'Somewhere', now() - interval '210 minutes', 'live', h),
    ('Win far', 'Somewhere', now() + interval '46 days', 'live', h), ('Win near', 'Somewhere', now() + interval '44 days', 'live', h);
  select array_agg(x ->> 'title') into titles from jsonb_array_elements(pg_temp.j(s, 'select public.ev_list_events()')) x where x ->> 'title' like 'Win %';
  perform pg_temp.ok(titles @> array['Win recent', 'Win near'] and not (titles && array['Win old', 'Win far']),
                     'the list holds 3.5 hours ago and 44 days ahead, not 5 hours ago or 46 days ahead');
  perform pg_temp.ok((select x ->> 'status' from jsonb_array_elements(pg_temp.j(s, 'select public.ev_list_events()')) x where x ->> 'title' = 'Win recent') = 'ended',
                     'an event that started 3.5 hours ago with no end time has ended (a 3 hour default)');
  perform pg_temp.ok(pg_temp.get(s, 'no-such-event') is null and pg_temp.get(s, '../etc') is null and pg_temp.get(s, gen_random_uuid()::text) is null, 'an unknown id or slug gives null');

  -- Update.
  perform pg_temp.ok(pg_temp.upd(s, id1, '{"title":"Hijack"}') ->> 'reason' = 'not_allowed', 'a stranger cannot edit it');
  r := pg_temp.upd(h, id1, '{"title":"Rooftop Sundown 2","description":"Bring a friend","capacity":50,"requires_approval":true}');
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'event' ->> 'title' = 'Rooftop Sundown 2' and r -> 'event' ->> 'description' = 'Bring a friend'
                     and (r -> 'event' ->> 'capacity')::int = 50 and (r -> 'event' ->> 'requires_approval')::boolean, 'the host edits several fields at once');
  r := pg_temp.upd(h, id1, '{"capacity":null}');
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'event' ->> 'capacity' is null, 'capacity null means no limit');
  r := pg_temp.upd(h, id1, '{"place_name":"New Hall","lat":6.5,"lng":3.4}');
  perform pg_temp.ok((r -> 'event' ->> 'lat')::float = 6.5, 'a place with coordinates gives a pin');
  r := pg_temp.upd(h, id1, '{"place_name":"Another Hall","area":null}');
  perform pg_temp.ok(r -> 'event' ->> 'venue_name' = 'Another Hall' and r -> 'event' ->> 'lat' is null, 'a new place name with no coordinates and no area drops the old pin');
  r := pg_temp.upd(h, id1, '{"visibility":"invite"}');
  perform pg_temp.ok(r -> 'event' ->> 'visibility' = 'invite' and (select status from public.events where id = id1) = 'unlisted', 'editing visibility to invite makes it unlisted');
  perform pg_temp.ok(not pg_temp.listed(s, id1), 'and a stranger''s list drops it');
  r := pg_temp.upd(h, id1, '{"visibility":"public"}');
  perform pg_temp.ok(r -> 'event' ->> 'status' = 'live' and pg_temp.listed(s, id1), 'back to public and it is live and listed again');
  perform pg_temp.ok(pg_temp.upd(h, id1, '{"title":""}') ->> 'reason' = 'need_name', 'an edit is checked like a create');
  r := pg_temp.upd(h, id2, '{"kind":"in_person"}');
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'event' ->> 'link_type' is null and not exists (select 1 from public.ev_event_links where event_id = id2),
                     'switching an online event to in person drops its link');
  r := pg_temp.upd(h, id2, '{"kind":"online","link_type":"meet","online_link":"https://meet.google.com/xyz-abcd-efg"}');
  perform pg_temp.ok(r -> 'event' ->> 'online_link' = 'https://meet.google.com/xyz-abcd-efg', 'and back to online with a new link');
  perform pg_temp.ok(pg_temp.upd(st, id2, '{"description":"Staff fix"}') ->> 'ok' = 'true', 'staff can edit any event');

  -- Cancel.
  perform pg_temp.ok(pg_temp.j(s, format('select public.ev_cancel_event(%L)', id1)) ->> 'reason' = 'not_allowed', 'a stranger cannot cancel');
  r := pg_temp.j(h, format('select public.ev_cancel_event(%L)', id1));
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'event' ->> 'status' = 'cancelled', 'the host cancels');
  perform pg_temp.ok(not pg_temp.listed(s, id1), 'a cancelled event leaves the list');
  perform pg_temp.ok(pg_temp.get(s, id1::text) ->> 'status' = 'cancelled', 'but its page still opens and says cancelled');
  perform pg_temp.ok((pg_temp.j(h, format('select public.ev_cancel_event(%L)', id1)) ->> 'ok')::boolean, 'cancelling twice is fine');
  update public.events set status = 'hidden' where id = id2;
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_cancel_event(%L)', id2)) ->> 'reason' = 'not_allowed', 'a host cannot cancel their way out of a staff hide');
  update public.events set status = 'live' where id = id2;

  -- Clone.
  perform pg_temp.relax(h);
  r := pg_temp.j(h, format('select public.ev_clone_event(%L)', id2));
  e := r -> 'event';
  perform pg_temp.ok((r ->> 'ok')::boolean and e ->> 'id' <> id2::text and e ->> 'slug' <> (select slug from public.events where id = id2) and e ->> 'title' = 'Online night',
                     'a clone is a new event with the same name');
  perform pg_temp.ok((e ->> 'starts_at')::timestamptz = (select starts_at from public.events where id = id2) + interval '7 days', 'a week on');
  perform pg_temp.ok(e ->> 'online_link' = 'https://meet.google.com/xyz-abcd-efg' and e ->> 'link_type' = 'meet' and (e -> 'host' ->> 'id')::uuid = h, 'with the same link and host');
  perform pg_temp.ok(pg_temp.j(s, format('select public.ev_clone_event(%L)', id2)) ->> 'reason' = 'not_allowed', 'a stranger cannot clone');

  -- My events.
  e := pg_temp.j(h, 'select public.ev_my_events()');
  perform pg_temp.ok(jsonb_array_length(e) >= 8 and exists (select 1 from jsonb_array_elements(e) x where x ->> 'status' = 'cancelled'), 'the host sees all their events, cancelled too');
  perform pg_temp.ok(jsonb_array_length(pg_temp.j(s, 'select public.ev_my_events()')) = 0, 'a stranger has none');
  perform pg_temp.ok((e -> 0 ->> 'starts_at')::timestamptz > now() - interval '1 hour', 'upcoming come first');

  -- ===================================================== ticket types ========
  update public.ev_settings set value = 'off' where key = 'paid_tickets';
  perform pg_temp.relax(h);
  r := pg_temp.mk(h, '{"title":"Default types"}');
  e := r -> 'event'; idt := (e ->> 'id')::uuid;
  perform pg_temp.ok(jsonb_array_length(e -> 'ticket_types') = 1 and e -> 'ticket_types' -> 0 ->> 'name' = 'General' and (e -> 'ticket_types' -> 0 ->> 'price_naira')::int = 0
                     and e -> 'ticket_types' -> 0 -> 'capacity' = 'null'::jsonb and (e -> 'ticket_types' -> 0 ->> 'sold')::int = 0 and e -> 'ticket_types' -> 0 -> 'spots_left' = 'null'::jsonb
                     and e -> 'ticket_types' -> 0 ->> 'event_id' = idt::text and (e ->> 'price_naira')::int = 0, 'every new event has one free General with no limit');
  perform pg_temp.ok((select count(*) from public.ev_ticket_types where event_id = idt) = 1, 'stored as one row');
  r := pg_temp.mk(h, '{"title":"Three kinds","capacity":10,"tickets":[{"name":"General","price_naira":0,"capacity":5},{"name":" VIP ","price_naira":0,"capacity":2},{"name":"Early"}]}');
  e := r -> 'event'; idl := (e ->> 'id')::uuid;
  perform pg_temp.ok((r ->> 'ok')::boolean and jsonb_array_length(e -> 'ticket_types') = 3 and e -> 'ticket_types' -> 0 ->> 'name' = 'General' and e -> 'ticket_types' -> 1 ->> 'name' = 'VIP'
                     and e -> 'ticket_types' -> 2 ->> 'name' = 'Early', 'a tickets list makes those types, in order, names trimmed');
  perform pg_temp.ok((e -> 'ticket_types' -> 0 ->> 'spots_left')::int = 5 and (e -> 'ticket_types' -> 1 ->> 'spots_left')::int = 2 and (e -> 'ticket_types' -> 2 ->> 'spots_left')::int = 10,
                     'spots_left is the tighter of the type''s own capacity and the event''s (no capacity of its own: the event''s 10)');
  perform pg_temp.ok(jsonb_array_length(pg_temp.get(s, idl::text) -> 'ticket_types') = 3 and exists (select 1 from jsonb_array_elements(pg_temp.j(s, 'select public.ev_list_events()')) q where q ->> 'id' = idl::text and jsonb_array_length(q -> 'ticket_types') = 3),
                     'the types come with get and with the list, for a stranger too');
  -- The checks.
  perform pg_temp.relax(h);
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"TT","tickets":[]}') ->> 'reason' = 'tickets_needed', 'an empty tickets list is refused');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"TT","tickets":[{"name":"a"},{"name":"b"},{"name":"c"},{"name":"d"},{"name":"e"},{"name":"f"}]}') ->> 'reason' = 'too_many_tickets', 'six types are too many');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"TT","tickets":[{"name":"  "}]}') ->> 'reason' = 'need_ticket_name', 'a type needs a name');
  perform pg_temp.ok(pg_temp.mk(h, json_build_object('title', 'TT', 'tickets', json_build_array(json_build_object('name', repeat('n', 61))))::jsonb) ->> 'reason' = 'ticket_name_too_long', 'and a name under 61 characters');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"TT","tickets":[{"name":"VIP"},{"name":"vip "}]}') ->> 'reason' = 'duplicate_ticket', 'names are unique ignoring case');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"TT","tickets":[{"name":"a","price_naira":2.5}]}') ->> 'reason' = 'bad_price' and pg_temp.mk(h, '{"title":"TT","tickets":[{"name":"a","price_naira":-1}]}') ->> 'reason' = 'bad_price'
                     and pg_temp.mk(h, '{"title":"TT","tickets":[{"name":"a","price_naira":"free"}]}') ->> 'reason' = 'bad_price', 'a price is a whole number from 0');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"TT","tickets":[{"name":"a","capacity":0}]}') ->> 'reason' = 'bad_ticket_capacity' and pg_temp.mk(h, '{"title":"TT","tickets":[{"name":"a","capacity":1.5}]}') ->> 'reason' = 'bad_ticket_capacity',
                     'a type capacity is empty or 1 and up');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"TT","tickets":"all of them"}') ->> 'reason' = 'bad_ticket' and pg_temp.mk(h, '{"title":"TT","tickets":["x"]}') ->> 'reason' = 'bad_ticket', 'a tickets value of the wrong shape is refused');
  perform pg_temp.ok((select count(*) from public.events where title = 'TT') = 0, 'and none of those made an event');
  -- Paid is switched off.
  r := pg_temp.mk(h, '{"title":"Paid","tickets":[{"name":"General","price_naira":0},{"name":"VIP","price_naira":5000,"capacity":10}]}');
  perform pg_temp.ok(r ->> 'reason' = 'currently_unavailable' and (r ->> 'ok')::boolean is false, 'a paid type is refused on create with exactly currently_unavailable');
  perform pg_temp.ok(pg_temp.upd(h, idt, '{"tickets":[{"name":"General"},{"name":"VIP","price_naira":1}]}') ->> 'reason' = 'currently_unavailable', 'and on update');
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_clone_event(%L)', idt)) ->> 'ok' = 'true', 'cloning a free event still works');
  begin
    perform pg_temp.actor(h);
    perform public.ev_set_setting('paid_tickets', 'on');
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a signed-in user must not flip the setting');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a signed-in user cannot call ev_set_setting');
  end;
  begin
    perform pg_temp.anon();
    perform public.ev_set_setting('paid_tickets', 'on');
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not flip the setting');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot call ev_set_setting');
  end;
  perform pg_temp.ok((select value from public.ev_settings where key = 'paid_tickets') = 'off', 'and it is still off');
  perform pg_temp.ok(public.ev_set_setting('other', 'on') = 'bad_key' and public.ev_set_setting('paid_tickets', 'maybe') = 'bad_value', 'only paid_tickets can be set, to on or off');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ev_ticket_types', 'select') and not has_table_privilege('anon', 'public.ev_ticket_types', 'select')
                     and not has_table_privilege('authenticated', 'public.ev_settings', 'select') and not has_table_privilege('anon', 'public.ev_settings', 'select')
                     and not has_table_privilege('authenticated', 'public.ev_settings', 'update') and not has_table_privilege('authenticated', 'public.ev_ticket_types', 'insert'),
                     'LEAK CHECK: ev_ticket_types and ev_settings are closed to anon and authenticated');
  -- With paid on, a paid type also needs a host whose Bachs account can take money.
  perform pg_temp.ok(public.ev_set_setting('paid_tickets', 'on') = 'ok', 'Ola switches paid tickets on');
  perform pg_temp.relax(h);
  r := pg_temp.mk(h, '{"title":"Paid early","tickets":[{"name":"VIP","price_naira":5000}]}');
  perform pg_temp.ok(r ->> 'reason' = 'payouts_not_ready', 'setting on but the host has no ready Bachs account: payouts_not_ready');
  perform pg_temp.ok(public.ev_pay_host_save_account(h, 'acct_evtesthost') = 'ok' and public.ev_pay_host_apply_capability('acct_evtesthost', 'bank_transfer', 'active') = 'ok', 'the host gets an account and one capability');
  perform pg_temp.ok(pg_temp.mk(h, '{"title":"Paid early","tickets":[{"name":"VIP","price_naira":5000}]}') ->> 'reason' = 'payouts_not_ready', 'a collection capability alone is not enough (payouts too)');
  perform pg_temp.ok(public.ev_pay_host_apply_capability('acct_evtesthost', 'payouts', 'active') = 'ok', 'payouts active: ready');
  r := pg_temp.mk(h, '{"title":"Paid two","tickets":[{"name":"General","price_naira":0},{"name":"VIP","price_naira":5000,"capacity":10}]}');
  idp := (r -> 'event' ->> 'id')::uuid;
  perform pg_temp.ok((r ->> 'ok')::boolean and (r -> 'event' ->> 'price_naira')::int = 0 and r -> 'event' -> 'ticket_types' -> 1 ->> 'price_naira' = '5000', 'on: a paid type saves; the event price is the lowest type price');
  r := pg_temp.mk(h, '{"title":"All paid","tickets":[{"name":"Ticket","price_naira":2000}]}');
  perform pg_temp.ok((r -> 'event' ->> 'price_naira')::int = 2000 and (select price_naira from public.events where title = 'All paid') = 2000, 'and when every type is paid the event price is the lowest of them');
  perform pg_temp.ok(public.ev_set_setting('paid_tickets', 'off') = 'ok', 'Ola switches it off again');
  r := pg_temp.j(h, format('select public.ev_clone_event(%L)', idp));
  perform pg_temp.ok(r ->> 'reason' = 'currently_unavailable', 'cloning an event that has a paid type is refused while it is off');
  perform pg_temp.ok(pg_temp.upd(h, idp, '{"title":"Paid two, renamed"}') ->> 'ok' = 'true', 'but editing its other fields is fine (the types are only checked when a tickets list is sent)');
  -- Editing the types.
  perform pg_temp.relax(h);
  select id into gid from public.ev_ticket_types where event_id = idl and name = 'General';
  r := pg_temp.upd(h, idl, '{"tickets":[{"name":"general","price_naira":0,"capacity":9},{"name":"Extra","capacity":3}]}');
  tt := r -> 'event' -> 'ticket_types';
  perform pg_temp.ok((r ->> 'ok')::boolean and jsonb_array_length(tt) = 2 and tt -> 0 ->> 'id' = gid::text and tt -> 0 ->> 'name' = 'general' and (tt -> 0 ->> 'capacity')::int = 9
                     and tt -> 1 ->> 'name' = 'Extra' and not exists (select 1 from public.ev_ticket_types where event_id = idl and name = 'VIP'),
                     'an edit with a list keeps the id of a name that stays (any case), adds the new one, drops the rest');
  perform pg_temp.ok(pg_temp.upd(h, idl, '{"tickets":[]}') ->> 'reason' = 'tickets_needed' and jsonb_array_length(pg_temp.get(h, idl::text) -> 'ticket_types') = 2, 'an empty list on edit is refused and nothing changes');
  r := pg_temp.upd(h, idl, '{"title":"Three kinds, edited"}');
  perform pg_temp.ok(jsonb_array_length(r -> 'event' -> 'ticket_types') = 2, 'an edit with no list leaves the types alone');
  r := pg_temp.j(h, format('select public.ev_clone_event(%L)', idl));
  perform pg_temp.ok((r ->> 'ok')::boolean and jsonb_array_length(r -> 'event' -> 'ticket_types') = 2 and r -> 'event' -> 'ticket_types' -> 0 ->> 'id' <> gid::text
                     and (r -> 'event' -> 'ticket_types' -> 0 ->> 'capacity')::int = 9 and r -> 'event' -> 'ticket_types' -> 1 ->> 'name' = 'Extra', 'a clone has the same types with new ids');
  -- An old event: no rows, a derived General, not backfilled.
  insert into public.events (title, venue_name, starts_at, status, price_naira) values ('Old free', 'Somewhere', now() + interval '3 days', 'live', 0) returning id into id1;
  insert into public.events (title, venue_name, starts_at, status, price_naira) values ('Old paid', 'Somewhere', now() + interval '3 days', 'live', 300) returning id into id2;
  e := pg_temp.get(s, id1::text);
  perform pg_temp.ok(jsonb_array_length(e -> 'ticket_types') = 1 and e -> 'ticket_types' -> 0 ->> 'name' = 'General' and e -> 'ticket_types' -> 0 ->> 'id' = md5('ticket-type:' || id1::text)::uuid::text
                     and (select count(*) from public.ev_ticket_types where event_id = id1) = 0, 'an old event reads as one derived General and is not backfilled');
  e := pg_temp.get(s, id2::text);
  perform pg_temp.ok((e ->> 'price_naira')::int = 300 and (e -> 'ticket_types' -> 0 ->> 'price_naira')::int = 300, 'an old paid event''s derived General has its price');
  -- Out of the room.
  insert into public.crews (id, name, created_by, visibility) values (gen_random_uuid(), 'Evt Types Room', st, 'open') returning id into idt;
  insert into public.crew_members (crew_id, user_id, role) values (idt, st, 'owner');
  r := pg_temp.mk(st, '{"title":"In my room"}');
  perform pg_temp.ok(r -> 'event' ->> 'room_id' = idt::text, 'a host with a room gets the event tied to it');
  r := pg_temp.mk(st, '{"title":"Not in my room","add_to_room":false}');
  perform pg_temp.ok(r -> 'event' -> 'room_id' = 'null'::jsonb and r -> 'event' -> 'host' ->> 'roomId' = idt::text, 'add_to_room false keeps it out of the room (the host card still shows their room)');
  -- An edit can put an event in the room or take it out; a community event cannot leave.
  ida := (r -> 'event' ->> 'id')::uuid;
  r := pg_temp.upd(st, ida, '{"add_to_room":true}');
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'event' ->> 'room_id' = idt::text, 'an edit with add_to_room true puts the event in the host''s room');
  r := pg_temp.upd(st, ida, '{"add_to_room":false,"title":"Out again"}');
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'event' -> 'room_id' = 'null'::jsonb and r -> 'event' ->> 'title' = 'Out again', 'with add_to_room false it leaves the room again');
  r := pg_temp.upd(st, ida, '{"title":"Still out"}');
  perform pg_temp.ok(r -> 'event' -> 'room_id' = 'null'::jsonb, 'an edit that does not mention it leaves the room as it was');
  r := pg_temp.upd(st, ida, '{"add_to_room":true,"visibility":"community"}');
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'event' ->> 'room_id' = idt::text, 'it can become a community event in the room');
  perform pg_temp.ok(pg_temp.upd(st, ida, '{"add_to_room":false}') ->> 'reason' = 'need_room', 'a community event cannot leave its room');
  perform pg_temp.ok(pg_temp.upd(s, ida, '{"add_to_room":true}') ->> 'reason' = 'not_allowed', 'and a stranger cannot move it');

  -- Access: only get and list are open to a visitor with no account.
  declare f record;
  begin
    for f in select p.oid, p.oid::regprocedure as sig, p.proname as name
               from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'public'
                and p.proname in ('ev_create_event', 'ev_update_event', 'ev_cancel_event', 'ev_clone_event', 'ev_get_event', 'ev_list_events', 'ev_my_events',
                                  '_ev_event_json', '_ev_normalize', '_ev_create_core', '_ev_staff', '_ev_can_open', '_ev_manage', 'ev_events_sync_status', 'ev_set_setting',
                                  '_ev_types', '_ev_paid_on', '_ev_apply_types', '_ev_ensure_types')
    loop
      perform pg_temp.ok(has_function_privilege('anon', f.oid, 'execute') = (f.name in ('ev_get_event', 'ev_list_events')),
                         f.sig || ': anon ' || case when f.name in ('ev_get_event', 'ev_list_events') then 'may call' else 'cannot call' end);
      perform pg_temp.ok(has_function_privilege('authenticated', f.oid, 'execute') = (f.name in ('ev_create_event', 'ev_update_event', 'ev_cancel_event', 'ev_clone_event', 'ev_get_event', 'ev_list_events', 'ev_my_events')),
                         f.sig || ': authenticated ' || case when f.name in ('ev_create_event', 'ev_update_event', 'ev_cancel_event', 'ev_clone_event', 'ev_get_event', 'ev_list_events', 'ev_my_events') then 'may call' else 'cannot call' end);
    end loop;
  end;
  raise notice 'ALL EVENTS R1 EVENTS TESTS PASSED';
end $$;
rollback;
