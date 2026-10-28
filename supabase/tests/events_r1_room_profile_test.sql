-- DRAFT FOR OLA, NOT RUN ANYWHERE. Release 1 room profile (supabase/events_r1_room_profile.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, crew_stage_voice.sql, events_r1_events.sql, events_r1_registrations.sql,
-- events_r1_rooms.sql and events_r1_room_profile.sql loaded. Ends with ALL EVENTS R1 ROOM PROFILE TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_room_profile_test.sql
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
          case when guest then null else 'room-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
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
-- Run one query as the service role (the staff desk's route), as jsonb text.
create function pg_temp.svc(q text) returns text language plpgsql as $$
declare r text;
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  execute 'select to_jsonb(x.v)::text from (' || q || ') as x(v)' into r;
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
create function pg_temp.ev(host uuid, ttl text, starts timestamptz default now() + interval '2 hours', room uuid default null,
                           vis text default 'public', st text default 'live', appr boolean default false, ends timestamptz default null) returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, ends_at, status, host_id, room_id, visibility, requires_approval)
  values (ttl, 'Somewhere', starts, ends, st, host, room, vis, appr) returning id;
$$;
create function pg_temp.reg(ev uuid, u uuid, st text) returns void language sql as $$
  insert into public.ev_registrations (event_id, user_id, status, name) values (ev, u, st, 'x');
$$;
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

do $$
declare
  o uuid := pg_temp.newuser('Prof Owner'); ad uuid := pg_temp.newuser('Prof Admin'); ho uuid := pg_temp.newuser('Prof Host');
  me uuid := pg_temp.newuser('Prof Member'); x uuid := pg_temp.newuser('Prof Stranger'); y uuid := pg_temp.newuser('Prof Asker');
  z uuid := pg_temp.newuser('Prof Asker Two'); st uuid := pg_temp.newuser('Prof Staff'); g uuid := pg_temp.newuser('Prof Guest', true);
  w1 uuid := pg_temp.newuser('Went One'); w2 uuid := pg_temp.newuser('Went Two'); w3 uuid := pg_temp.newuser('Went Three');
  r jsonb; room uuid; room2 uuid; room3 uuid; code text; req uuid; f record; mine uuid; e1 uuid; e2 uuid; e3 uuid;
  logo constant text := 'https://example.supabase.co/storage/v1/object/public/crew-images/room-logos/00000000-0000-4000-8000-000000000001/a1.jpg';
begin
  update public.profiles set is_admin = true where id = st;

  -- ===================================================== make a room ========
  r := pg_temp.j(o, $q$select public.ev_create_room('South Social', 'Lagos nights.', null, null, '{"instagram":"https://instagram.com/southsocial"}', 'open', null)$q$);
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'slug' = 'south-social', 'a room is made, its address built from the name');
  room := (r ->> 'id')::uuid;
  perform pg_temp.ok(exists (select 1 from public.crew_members where crew_id = room and user_id = o and role = 'owner'), 'the maker is the owner');
  perform pg_temp.ok((select visibility from public.crews where id = room) = 'open', 'open mode keeps crews.visibility open');
  r := pg_temp.j(o, $q$select public.ev_create_room('South Social', '', null, null, '{}', 'ask', null)$q$);
  perform pg_temp.ok(r ->> 'slug' = 'south-social-2', 'the same name again gets -2');
  room2 := (r ->> 'id')::uuid;
  perform pg_temp.ok((select visibility from public.crews where id = room2) = 'private' and public._ev_join_mode(room2) = 'ask', 'ask mode is private for old code');
  r := pg_temp.j(o, $q$select public.ev_create_room('Quiet', '', 'quiet-room', null, '{}', 'invite', null)$q$);
  room3 := (r ->> 'id')::uuid;
  perform pg_temp.ok((select visibility from public.crews where id = room3) = 'private' and public._ev_join_mode(room3) = 'invite', 'invite mode is private for old code');
  perform pg_temp.ok(pg_temp.j(x, $q$select public.ev_create_room('Quiet Two', '', 'quiet-room', null, '{}', 'open', null)$q$) ->> 'reason' = 'slug_taken', 'an address in use is slug_taken');
  perform pg_temp.ok(pg_temp.j(x, $q$select public.ev_create_room('Hq Try', '', 'hq', null, '{}', 'open', null)$q$) ->> 'reason' = 'bad_slug', 'a reserved word is bad_slug');
  perform pg_temp.ok(pg_temp.j(x, $q$select public.ev_create_room('Hq Try', '', 'AB', null, '{}', 'open', null)$q$) ->> 'reason' = 'bad_slug', 'two letters is bad_slug');
  perform pg_temp.ok(pg_temp.j(x, format($q$select public.ev_create_room('Hijack', '', %L, null, '{}', 'open', null)$q$, room::text)) ->> 'reason' = 'bad_slug', 'an address shaped like a room id is bad_slug');
  perform pg_temp.ok(pg_temp.j(x, $q$select public.ev_create_room('X', '', null, null, '{}', 'open', null)$q$) ->> 'reason' = 'bad_name', 'a one letter name is bad_name');
  perform pg_temp.ok(pg_temp.j(x, format($q$select public.ev_create_room('Long About', %L, null, null, '{}', 'open', null)$q$, repeat('a', 601))) ->> 'reason' = 'bad_about', 'about over 600 is bad_about');
  perform pg_temp.ok(pg_temp.j(x, $q$select public.ev_create_room('Mode', '', null, null, '{}', 'secret', null)$q$) ->> 'reason' = 'bad_mode', 'an unknown mode is bad_mode');
  perform pg_temp.ok(pg_temp.j(x, $q$select public.ev_create_room('Links', '', null, null, '{"tiktok":"https://x.com/a"}', 'open', null)$q$) ->> 'reason' = 'bad_links', 'an unknown link key is bad_links');
  perform pg_temp.ok(pg_temp.j(x, $q$select public.ev_create_room('Links', '', null, null, '{"website":"http://plain.example"}', 'open', null)$q$) ->> 'reason' = 'bad_links', 'a plain http link is bad_links');
  perform pg_temp.ok(pg_temp.j(x, $q$select public.ev_create_room('Logo', '', null, 'https://evil.example/a.jpg', '{}', 'open', null)$q$) ->> 'reason' = 'bad_logo', 'a logo outside room-logos is bad_logo');
  perform pg_temp.ok(pg_temp.j(g, $q$select public.ev_create_room('Guest Room', '', null, null, '{}', 'open', null)$q$) ->> 'reason' = 'need_account', 'a guest cannot make a room');
  r := pg_temp.j(x, format($q$select public.ev_create_room('With Logo', '', null, %L, '{}', 'open', null)$q$, logo));
  perform pg_temp.ok((r ->> 'ok')::boolean and (select logo_url from public.crews where id = (r ->> 'id')::uuid) = logo, 'a logo link in room-logos is kept on crews.logo_url');
  update public.ev_settings set value = 'off' where key = 'events_r1';
  perform pg_temp.ok(pg_temp.j(x, $q$select public.ev_create_room('Closed', '', null, null, '{}', 'open', null)$q$) ->> 'reason' = 'not_open', 'with the switch off: not_open');
  update public.ev_settings set value = 'on' where key = 'events_r1';

  -- ===================================================== read ========
  r := pg_temp.j(x, format('select public.ev_room_profile(%L)', room));
  perform pg_temp.ok(r ->> 'slug' = 'south-social' and r ->> 'about' = 'Lagos nights.' and r ->> 'join_mode' = 'open' and r -> 'my_role' = 'null'::jsonb
                     and r -> 'links' ->> 'instagram' = 'https://instagram.com/southsocial', 'a visitor reads the profile of an open room');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_room_profile(%L)', room2)) ->> 'join_mode' = 'ask', 'a visitor reads an ask room too');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_room_profile(%L)', room3)) = 'null'::jsonb, 'an invite room is hidden from a visitor with no code');
  code := pg_temp.t(o, format('select public.ev_room_invite_code(%L)', room3));
  perform pg_temp.ok(code is not null and pg_temp.t(x, format('select public.ev_room_invite_code(%L)', room3)) is null, 'only the owner gets the invite code');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_room_profile(%L, %L)', room3, code)) ->> 'join_mode' = 'invite', 'the code opens an invite room');
  perform pg_temp.ok(pg_temp.j(o, format('select public.ev_room_profile(%L)', room3)) ->> 'my_role' = 'owner', 'a member opens it without a code');
  perform pg_temp.ok(public.ev_room_by_slug('south-social') = room and public.ev_room_by_slug(room::text) = room and public.ev_room_by_slug('nope-nope') is null, 'an address finds its room (and so does the id)');
  r := pg_temp.j(x, 'select public.ev_discover_rooms()');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r) q where q ->> 'id' = room::text)
                     and exists (select 1 from jsonb_array_elements(r) q where q ->> 'id' = room2::text)
                     and not exists (select 1 from jsonb_array_elements(r) q where q ->> 'id' = room3::text), 'Discover lists open and ask rooms, never invite rooms');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(pg_temp.j(o, 'select public.ev_discover_rooms()')) q where q ->> 'id' = room::text), 'Discover leaves out rooms the viewer is in');

  -- ===================================================== change ========
  perform pg_temp.ok(pg_temp.j(x, format($q$select public.ev_update_room(%L, '{"about":"hi"}')$q$, room)) ->> 'reason' = 'not_allowed', 'a stranger cannot change a room');
  perform pg_temp.ok(pg_temp.j(o, format($q$select public.ev_update_room(%L, '{"slug":"quiet-room"}')$q$, room)) ->> 'reason' = 'slug_taken', 'a taken address is slug_taken');
  r := pg_temp.j(o, format('select public.ev_update_room(%L, %L)', room, json_build_object('slug', 'south-social-lagos', 'about', 'New words', 'name', 'South Social Lagos', 'links', json_build_object('x', 'https://x.com/ss', 'website', ''), 'logo_url', logo)::text));
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'slug' = 'south-social-lagos', 'the owner changes the address');
  r := pg_temp.j(x, format('select public.ev_room_profile(%L)', room));
  perform pg_temp.ok(r ->> 'slug' = 'south-social-lagos' and r ->> 'about' = 'New words' and r ->> 'name' = 'South Social Lagos' and r -> 'links' = '{"x":"https://x.com/ss"}'::jsonb and r ->> 'logo_url' = logo, 'the new profile reads back (empty links dropped)');
  perform pg_temp.ok(public.ev_room_by_slug('south-social') is null and public.ev_room_by_slug('south-social-lagos') = room, 'the old address stops, the new one works');
  perform pg_temp.ok(public.ev_slug_available('south-social-lagos', room) and not public.ev_slug_available('south-social-lagos', room2) and public.ev_slug_available('brand-new-one') and not public.ev_slug_available('Bad Slug'), 'ev_slug_available');
  perform pg_temp.ok(pg_temp.j(o, format($q$select public.ev_update_room(%L, '{"join_mode":"ask"}')$q$, room)) ->> 'ok' = 'true' and (select visibility from public.crews where id = room) = 'private', 'changing to ask makes visibility private');
  perform pg_temp.j(o, format($q$select public.ev_update_room(%L, '{"join_mode":"open"}')$q$, room));
  perform pg_temp.ok((select visibility from public.crews where id = room) = 'open', 'and back to open makes it open');
  perform pg_temp.ok(pg_temp.j(o, format($q$select public.ev_update_room(%L, '{"logo_url":null}')$q$, room)) ->> 'ok' = 'true' and (select logo_url from public.crews where id = room) is null, 'a null logo clears it');
  perform pg_temp.ok(pg_temp.j(st, format($q$select public.ev_update_room(%L, '{"about":"staff"}')$q$, room)) ->> 'ok' = 'true', 'staff may change a room');

  -- ===================================================== roles ========
  insert into public.crew_members (crew_id, user_id, role) values (room, ad, 'member'), (room, ho, 'member'), (room, me, 'member');
  perform pg_temp.ok(pg_temp.t(o, format($q$select public.ev_set_room_role(%L, %L, 'admin')$q$, room, ad)) = 'ok' and (select role from public.crew_members where crew_id = room and user_id = ad) = 'admin', 'the owner makes an admin');
  perform pg_temp.ok(pg_temp.t(ad, format($q$select public.ev_set_room_role(%L, %L, 'host')$q$, room, ho)) = 'ok' and (select role from public.crew_members where crew_id = room and user_id = ho) = 'host', 'an admin makes a host (the role check allows host)');
  perform pg_temp.ok(pg_temp.t(ad, format($q$select public.ev_set_room_role(%L, %L, 'admin')$q$, room, me)) = 'not_allowed', 'an admin cannot make an admin');
  perform pg_temp.ok(pg_temp.t(ho, format($q$select public.ev_set_room_role(%L, %L, 'host')$q$, room, me)) = 'not_allowed', 'a host cannot set roles');
  perform pg_temp.ok(pg_temp.t(o, format($q$select public.ev_set_room_role(%L, %L, 'member')$q$, room, o)) = 'owner_fixed', 'nobody changes the owner');
  perform pg_temp.ok(pg_temp.t(o, format($q$select public.ev_set_room_role(%L, %L, 'host')$q$, room, y)) = 'not_member', 'only members get a role');
  perform pg_temp.ok(pg_temp.t(o, format($q$select public.ev_set_room_role(%L, %L, 'boss')$q$, room, me)) = 'bad_role', 'an unknown role is bad_role');
  perform pg_temp.ok(pg_temp.j(ho, format($q$select public.ev_update_room(%L, '{"about":"h"}')$q$, room)) ->> 'reason' = 'not_allowed', 'a host cannot change the profile');
  perform pg_temp.ok(pg_temp.j(ad, format($q$select public.ev_update_room(%L, '{"about":"admin words"}')$q$, room)) ->> 'ok' = 'true', 'an admin can');
  perform pg_temp.ok(jsonb_array_length(pg_temp.j(me, format('select public.ev_room_members(%L)', room))) = 4 and pg_temp.j(me, format('select public.ev_room_members(%L)', room)) -> 0 ->> 'role' = 'owner', 'members list the room, owner first');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_room_members(%L)', room)) = 'null'::jsonb, 'a stranger gets no member list');

  -- ===================================================== join modes ========
  perform pg_temp.ok(pg_temp.t(x, format('select public.ev_join_room(%L)', room)) = 'joined', 'open: joined at once');
  perform pg_temp.ok(pg_temp.t(x, format('select public.ev_join_room(%L)', room)) = 'already', 'again: already');
  perform pg_temp.ok(pg_temp.t(g, format('select public.ev_join_room(%L)', room)) = 'need_account', 'a guest cannot join');
  perform pg_temp.ok(pg_temp.t(y, format('select public.ev_join_room(%L)', room2)) = 'requested' and pg_temp.t(y, format('select public.ev_join_room(%L)', room2)) = 'requested', 'ask: a request, and asking twice is the same request');
  perform pg_temp.ok((select count(*) from public.ev_room_requests where crew_id = room2 and user_id = y) = 1, 'one row for the two asks');
  perform pg_temp.ok(not exists (select 1 from public.crew_members where crew_id = room2 and user_id = y), 'a request is not a membership');
  perform pg_temp.ok(pg_temp.j(y, format('select public.ev_room_profile(%L)', room2)) ->> 'request' = 'pending', 'the asker sees pending');
  perform pg_temp.ok(pg_temp.t(z, format('select public.ev_join_room(%L)', room2)) = 'requested', 'a second asker');
  perform pg_temp.ok(pg_temp.j(y, format('select public.ev_room_requests(%L)', room2)) = 'null'::jsonb, 'an asker cannot list requests');
  r := pg_temp.j(o, format('select public.ev_room_requests(%L)', room2));
  perform pg_temp.ok(jsonb_array_length(r) = 2 and r -> 0 ->> 'name' = 'Prof Asker', 'the owner lists the two, oldest first, with names');
  perform pg_temp.ok((pg_temp.j(o, format('select public.ev_room_profile(%L)', room2)) ->> 'pending_requests')::int = 2, 'the owner sees the pending count');
  perform pg_temp.ok((pg_temp.j(y, format('select public.ev_room_profile(%L)', room2)) ->> 'pending_requests')::int = 0, 'the asker does not');
  req := (r -> 0 ->> 'id')::uuid;
  perform pg_temp.ok(pg_temp.t(y, format('select public.ev_decide_room_request(%L, true)', req)) = 'not_allowed', 'the asker cannot approve themselves');
  perform pg_temp.ok(pg_temp.t(o, format('select public.ev_decide_room_request(%L, true)', req)) = 'ok' and exists (select 1 from public.crew_members where crew_id = room2 and user_id = y and role = 'member'), 'approve: the person is a member');
  perform pg_temp.ok(pg_temp.t(o, format('select public.ev_decide_room_request(%L, true)', req)) = 'already_answered', 'answering twice is already_answered');
  r := pg_temp.j(y, 'select public.ev_my_room_notices()');
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'request_approved' and r -> 0 ->> 'room_id' = room2::text, 'approval leaves a notice');
  perform pg_temp.ok(pg_temp.t(y, format('select public.ev_mark_room_notices_seen(array[%L]::uuid[])', r -> 0 ->> 'id')) = 'ok' and jsonb_array_length(pg_temp.j(y, 'select public.ev_my_room_notices()')) = 0, 'and it is marked seen');
  perform pg_temp.ok(pg_temp.t(o, format('select public.ev_decide_room_request(%L, false)', (select id from public.ev_room_requests where crew_id = room2 and user_id = z))) = 'ok'
                     and not exists (select 1 from public.crew_members where crew_id = room2 and user_id = z), 'decline: not a member');
  perform pg_temp.ok(jsonb_array_length(pg_temp.j(z, 'select public.ev_my_room_notices()')) = 0, 'a decline sends no notice');
  perform pg_temp.ok(pg_temp.t(z, format('select public.ev_join_room(%L)', room2)) = 'declined' and pg_temp.j(z, format('select public.ev_room_profile(%L)', room2)) ->> 'request' = 'declined', 'a declined person is told declined');
  perform pg_temp.ok(pg_temp.t(z, format('select public.ev_join_room(%L, %L)', room2, pg_temp.t(o, format('select public.ev_room_invite_code(%L)', room2)))) = 'joined', 'but a right invite code gets into an ask room');
  perform pg_temp.ok(pg_temp.t(me, format('select public.ev_join_room(%L)', room3)) = 'invite_only', 'invite: refused with no code');
  perform pg_temp.ok(pg_temp.t(me, format($q$select public.ev_join_room(%L, 'WRONG')$q$, room3)) = 'invite_only', 'invite: refused with a wrong code');
  perform pg_temp.ok(pg_temp.t(me, format('select public.ev_join_room(%L, %L)', room3, lower(code))) = 'joined', 'invite: the code (any case) joins');
  perform pg_temp.ok(pg_temp.t(me, format('select public.ev_join_room(%L)', gen_random_uuid())) = 'not_found', 'no such room: not_found');

  -- ===================================================== went but have not joined ========
  e1 := pg_temp.ev(o, 'Room event one', now() + interval '1 day', room);
  e2 := pg_temp.ev(o, 'Room event two', now() + interval '2 days', room);
  e3 := pg_temp.ev(o, 'Room event cancelled', now() + interval '3 days', room, 'public', 'cancelled');
  perform pg_temp.reg(e1, w1, 'going'); perform pg_temp.reg(e2, w1, 'checked_in'); perform pg_temp.reg(e1, w2, 'going');
  perform pg_temp.reg(e1, w3, 'cancelled'); perform pg_temp.reg(e1, me, 'going'); perform pg_temp.reg(e3, w3, 'going');
  -- x joined the room above, so x is a member too and must not count.
  perform pg_temp.reg(e1, x, 'going');
  r := pg_temp.j(o, format('select public.ev_room_guests_not_joined(%L)', room));
  perform pg_temp.ok((r ->> 'count')::int = 2 and jsonb_array_length(r -> 'guests') = 2, 'guests not joined: two people (counted once for two events; cancelled, members and cancelled events left out)');
  perform pg_temp.ok(pg_temp.j(ho, format('select public.ev_room_guests_not_joined(%L)', room)) ->> 'count' = '2', 'a host sees the same');
  perform pg_temp.ok(pg_temp.j(me, format('select public.ev_room_guests_not_joined(%L)', room)) = 'null'::jsonb, 'a plain member gets null');
  insert into public.crew_members (crew_id, user_id) values (room, w1);
  perform pg_temp.ok(pg_temp.j(o, format('select public.ev_room_guests_not_joined(%L)', room)) ->> 'count' = '1', 'once someone joins they leave the count');

  -- ===================================================== post events as the room ========
  e1 := pg_temp.ev(ho, 'Host event', now() + interval '1 day', null);
  perform pg_temp.ok(pg_temp.j(ho, format('select public.ev_post_events_as_room(%L, array[%L]::uuid[])', room, e1)) ->> 'moved' = '1' and (select room_id from public.events where id = e1) = room, 'a host posts their own event as the room');
  e2 := pg_temp.ev(x, 'Stranger event', now() + interval '1 day', null);
  perform pg_temp.ok(pg_temp.j(ho, format('select public.ev_post_events_as_room(%L, array[%L]::uuid[])', room, e2)) ->> 'moved' = '0', 'but not someone else''s event');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_post_events_as_room(%L, array[%L]::uuid[])', room, e2)) ->> 'moved' = '0' or pg_temp.j(x, format('select public.ev_post_events_as_room(%L, array[%L]::uuid[])', room, e2)) ->> 'reason' = 'not_allowed', 'and a plain member cannot post at all');
  mine := pg_temp.ev(o, 'Mine before', now() + interval '1 day', null);
  r := pg_temp.j(o, format($q$select public.ev_create_room('Adopter', '', null, null, '{}', 'open', array[%L]::uuid[])$q$, mine));
  perform pg_temp.ok((select room_id from public.events where id = mine) = (r ->> 'id')::uuid, 'a new room takes the creator''s own events (event_ids)');

  -- ===================================================== the old column ========
  insert into public.crews (id, name, created_by, visibility) values (gen_random_uuid(), 'Old open', o, 'open'), (gen_random_uuid(), 'Old private', o, 'private');
  perform pg_temp.ok(public._ev_join_mode((select id from public.crews where name = 'Old open')) = 'open' and public._ev_join_mode((select id from public.crews where name = 'Old private')) = 'invite',
                     'a room with no profile reads open -> open, private -> invite');

  -- ===================================================== access ========
  for f in select p.oid, p.proname as name
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and p.proname in ('ev_room_by_slug', 'ev_room_profile', 'ev_discover_rooms', 'ev_create_room', 'ev_update_room', 'ev_slug_available', 'ev_join_room',
                                'ev_room_requests', 'ev_decide_room_request', 'ev_room_invite_code', 'ev_my_room_notices', 'ev_mark_room_notices_seen',
                                'ev_room_members', 'ev_set_room_role', 'ev_room_guests_not_joined', 'ev_post_events_as_room',
                                '_ev_slug_ok', '_ev_slug_from_name', '_ev_room_role', '_ev_room_admin', '_ev_room_can_host', '_ev_join_mode', '_ev_person_name',
                                '_ev_logo_ok', '_ev_links_clean', '_ev_room_profile_json', '_ev_post_events', 'ev_ensure_hq_id')
  loop
    perform pg_temp.ok(has_function_privilege('anon', f.oid, 'execute') = (f.name in ('ev_room_by_slug', 'ev_room_profile', 'ev_discover_rooms', 'ev_slug_available')),
                       f.name || ': anon access is as designed');
    perform pg_temp.ok(has_function_privilege('authenticated', f.oid, 'execute') = (left(f.name, 4) = 'ev_r' or f.name in ('ev_create_room', 'ev_update_room', 'ev_slug_available', 'ev_join_room', 'ev_discover_rooms', 'ev_decide_room_request', 'ev_my_room_notices', 'ev_mark_room_notices_seen', 'ev_set_room_role', 'ev_post_events_as_room')),
                       f.name || ': authenticated access is as designed');
  end loop;
  perform pg_temp.ok(pg_temp.denied('anon', 'select * from public.ev_room_profiles') and pg_temp.denied('authenticated', 'select * from public.ev_room_requests')
                     and pg_temp.denied('authenticated', 'select * from public.ev_room_notices'), 'the three new tables are closed to anon and authenticated');
  raise notice 'ALL EVENTS R1 ROOM PROFILE TESTS PASSED';
end $$;
rollback;
