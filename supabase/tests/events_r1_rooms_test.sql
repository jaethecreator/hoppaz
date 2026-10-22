-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Release 1 rooms (supabase/events_r1_rooms.sql). LOCAL ONLY: everything rolls back, including the
-- Hoppaz HQ room and the staff flags this test clears so it starts from "no HQ yet".
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, crew_announcements.sql, events_r1_events.sql, events_r1_registrations.sql, events_r1_pops.sql
-- and events_r1_rooms.sql loaded. Ends with ALL EVENTS R1 ROOMS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_rooms_test.sql
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
create function pg_temp.chat(u uuid, ev uuid) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_event_chat(%L)', ev));
end $$;
create function pg_temp.rev(u uuid, room uuid) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_room_events(%L)', room));
end $$;
create function pg_temp.sees(arr jsonb, ev uuid) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(arr) q where q ->> 'id' = ev::text or q ->> 'event_id' = ev::text);
$$;
create function pg_temp.mine_of(u uuid, room uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := pg_temp.j(u, 'select public.ev_rooms_for_me()');
  return (select q from jsonb_array_elements(r -> 'mine') q where q ->> 'id' = room::text);
end $$;

do $$
declare
  st uuid := pg_temp.newuser('Room Staff'); h uuid := pg_temp.newuser('Room Host'); a uuid := pg_temp.newuser('Room Ada');
  b uuid := pg_temp.newuser('Room Bola'); c uuid := pg_temp.newuser('Room Chike'); m uuid := pg_temp.newuser('Room Member');
  x uuid := pg_temp.newuser('Room Stranger'); g uuid := pg_temp.newuser('Room Guest', true);
  u1 uuid := pg_temp.newuser('Room U1'); u2 uuid := pg_temp.newuser('Room U2');
  room uuid := gen_random_uuid(); rdisc uuid := gen_random_uuid(); rpriv uuid := gen_random_uuid();
  hq uuid; hq2 uuid; e uuid; ecom uuid; einv uuid; ecan uuid; epast uuid; eapp uuid; eold uuid; eclosed uuid; ediscgo uuid; enoroom uuid;
  r jsonb; n int; ann uuid; f record; j jsonb; k int;
begin
  -- ===================================================== Hoppaz HQ ========
  update public.profiles set is_admin = false where is_admin;
  delete from public.ev_hq;
  delete from public.crews where lower(btrim(name)) = 'hoppaz hq';
  perform pg_temp.ok(public.ev_ensure_hq() is null, 'with no staff account there is nobody to own HQ: null');
  perform pg_temp.ok(pg_temp.j(a, 'select public.ev_rooms_for_me()') -> 'hq' = 'null'::jsonb, 'and the Rooms tab says no HQ rather than failing');
  update public.profiles set is_admin = true where id = st;

  -- The first read by someone with an account makes HQ and joins them.
  r := pg_temp.j(a, 'select public.ev_rooms_for_me()');
  hq := (r -> 'hq' ->> 'id')::uuid;
  perform pg_temp.ok(hq is not null and r -> 'hq' ->> 'kind' = 'hq' and r -> 'hq' ->> 'name' = 'Hoppaz HQ' and (r -> 'hq' ->> 'verified')::boolean and (r -> 'hq' ->> 'joined')::boolean,
                     'the first read makes Hoppaz HQ: kind hq, verified, and the reader is in');
  perform pg_temp.ok(exists (select 1 from public.crews where id = hq and verified and visibility = 'open' and created_by = st and name = 'Hoppaz HQ')
                     and (select capacity from public.crew_rooms where crew_id = hq) = 500 and (select count(*) from public.ev_hq) = 1, 'it is an open verified crew owned by the staff account, with the largest walker capacity the check allows');
  perform pg_temp.ok(exists (select 1 from public.crew_members where crew_id = hq and user_id = st and role = 'owner') and exists (select 1 from public.crew_members where crew_id = hq and user_id = a and role = 'member'),
                     'the staff account owns it, the reader is a member');
  perform pg_temp.ok(public._ev_is_hq(hq) and not public._ev_is_hq(gen_random_uuid()), 'the HQ test knows it');
  hq2 := public.ev_ensure_hq();
  perform pg_temp.ok(hq2 = hq and (select count(*) from public.crews where lower(btrim(name)) = 'hoppaz hq') = 1, 'asking again gives the same room, never a second one');
  hq2 := pg_temp.t(b, 'select public.ev_ensure_hq()')::uuid;
  perform pg_temp.ok(hq2 = hq and exists (select 1 from public.crew_members where crew_id = hq and user_id = b), 'every account joins on its first read');
  hq2 := pg_temp.t(b, 'select public.ev_ensure_hq()')::uuid;
  perform pg_temp.ok(hq2 = hq and (select count(*) from public.crew_members where crew_id = hq and user_id = b) = 1, 'and only once');
  hq2 := pg_temp.t(g, 'select public.ev_ensure_hq()')::uuid;
  perform pg_temp.ok(hq2 = hq and not exists (select 1 from public.crew_members where crew_id = hq and user_id = g), 'a guest with no account is not added');
  r := pg_temp.j(g, 'select public.ev_rooms_for_me()');
  perform pg_temp.ok(r -> 'hq' ->> 'id' = hq::text and not (r -> 'hq' ->> 'joined')::boolean, 'a guest sees HQ but is not in it');
  perform pg_temp.ok(public._ev_host_room(st) is null, 'the owner of HQ does not get HQ as their events'' room');

  -- Adopting a crew Ola made by hand.
  delete from public.ev_hq;
  hq2 := public.ev_ensure_hq();
  perform pg_temp.ok(hq2 = hq and (select count(*) from public.ev_hq) = 1 and (select count(*) from public.crews where lower(btrim(name)) = 'hoppaz hq') = 1,
                     'if the pointer is lost but a verified crew called Hoppaz HQ exists, it is adopted, not duplicated');

  -- The backfill.
  n := public.ev_hq_backfill();
  perform pg_temp.ok(n >= 2 and exists (select 1 from public.crew_members where crew_id = hq and user_id = u1) and exists (select 1 from public.crew_members where crew_id = hq and user_id = u2)
                     and not exists (select 1 from public.crew_members where crew_id = hq and user_id = g), 'the backfill puts every account in HQ, and no guest');
  n := public.ev_hq_backfill();
  perform pg_temp.ok(n = 0, 'and a second run adds nobody');
  perform pg_temp.ok(not exists (select 1 from information_schema.table_privileges where table_name = 'ev_hq' and grantee in ('anon', 'authenticated')), 'the HQ pointer table is closed');

  -- ===================================================== event chat ========
  insert into public.crews (id, name, created_by, visibility) values (room, 'Room One', h, 'open'), (rdisc, 'Room Discover', x, 'open'), (rpriv, 'Room Private', x, 'private');
  insert into public.crew_members (crew_id, user_id, role) values (room, h, 'owner'), (room, m, 'member'), (rdisc, x, 'owner'), (rpriv, x, 'owner');
  e := pg_temp.ev(h, 'Chat night', now() + interval '2 hours', room);
  perform pg_temp.reg(e, a, 'going'); perform pg_temp.reg(e, b, 'requested'); perform pg_temp.reg(e, c, 'waitlisted');
  r := pg_temp.chat(x, e);
  perform pg_temp.ok(r ->> 'state' = 'upcoming' and r ->> 'room_id' = room::text and r ->> 'event_title' = 'Chat night' and not (r ->> 'can_enter')::boolean, 'two hours before: upcoming, and a stranger may not enter');
  perform pg_temp.ok((r ->> 'opens_at')::timestamptz = (select starts_at - interval '1 hour' from public.events where id = e)
                     and (r ->> 'closes_at')::timestamptz = (select starts_at + interval '3 hours 3 days' from public.events where id = e), 'it opens 1 hour before the start and closes 3 days after the end (3 hours after the start with no end)');
  perform pg_temp.ok((pg_temp.chat(a, e) ->> 'can_enter')::boolean, 'a person who is going may enter');
  perform pg_temp.ok(not (pg_temp.chat(b, e) ->> 'can_enter')::boolean and not (pg_temp.chat(c, e) ->> 'can_enter')::boolean, 'someone waiting for approval and someone on the waitlist may not');
  perform pg_temp.ok(not (pg_temp.chat(m, e) ->> 'can_enter')::boolean, 'a room member who has not registered for a public event may not');
  perform pg_temp.ok((pg_temp.chat(h, e) ->> 'can_enter')::boolean and (pg_temp.chat(st, e) ->> 'can_enter')::boolean, 'the host and staff always may');
  perform pg_temp.anon();
  select public.ev_event_chat(e) into r;
  perform pg_temp.admin();
  perform pg_temp.ok(r ->> 'state' = 'upcoming' and not (r ->> 'can_enter')::boolean, 'a visitor with no account sees the state and cannot enter');
  update public.events set starts_at = now() + interval '30 minutes' where id = e;
  perform pg_temp.ok(pg_temp.chat(a, e) ->> 'state' = 'open', '30 minutes before the start the chat is open');
  update public.events set starts_at = now() - interval '5 hours', ends_at = now() - interval '1 hour' where id = e;
  perform pg_temp.ok(pg_temp.chat(a, e) ->> 'state' = 'open' and (pg_temp.chat(a, e) ->> 'can_enter')::boolean, 'an hour after the end it is still open');
  update public.events set starts_at = now() - interval '4 days', ends_at = null where id = e;
  r := pg_temp.chat(a, e);
  perform pg_temp.ok(r ->> 'state' = 'closed' and not (r ->> 'can_enter')::boolean, 'more than 3 days after the event it is closed and nobody enters');
  update public.events set starts_at = now() + interval '30 minutes' where id = e;
  update public.events set status = 'cancelled' where id = e;
  perform pg_temp.ok(pg_temp.chat(a, e) ->> 'state' = 'closed' and not (pg_temp.chat(a, e) ->> 'can_enter')::boolean, 'a cancelled event''s chat is closed');
  enoroom := pg_temp.ev(h, 'No room event');
  perform pg_temp.ok(pg_temp.chat(h, enoroom) is null, 'an event with no room has no chat');
  perform pg_temp.ok(pg_temp.chat(a, gen_random_uuid()) is null, 'and an unknown event has none');

  -- A community event's chat is for the room's members, registered or not. Approval: approved only.
  ecom := pg_temp.ev(h, 'Community chat', now() + interval '30 minutes', room, 'community');
  perform pg_temp.ok((pg_temp.chat(m, ecom) ->> 'can_enter')::boolean and (pg_temp.chat(m, ecom) ->> 'state') = 'open', 'community: a room member enters without registering');
  perform pg_temp.ok(pg_temp.chat(x, ecom) is null, 'community: someone outside the room cannot even see it');
  eapp := pg_temp.ev(h, 'Approval chat', now() + interval '30 minutes', room, 'public', 'live', true);
  perform pg_temp.reg(eapp, a, 'going'); perform pg_temp.reg(eapp, b, 'requested');
  perform pg_temp.ok((pg_temp.chat(a, eapp) ->> 'can_enter')::boolean and not (pg_temp.chat(b, eapp) ->> 'can_enter')::boolean, 'approval: the approved may enter, the waiting may not');
  r := pg_temp.j(st, format('select public.ev_event_chat(%L)', ecom));
  perform pg_temp.ok(r is not null, 'staff can read any chat state');
  perform pg_temp.ok(public._ev_chat_can_enter(e, a) is not null and public._ev_chat_can_enter(eapp, a) and not public._ev_chat_can_enter(eapp, b) and not public._ev_chat_can_enter(eapp, null), 'the internal rule, for a given user, answers the same');

  -- ===================================================== the room's events ========
  einv := pg_temp.ev(h, 'Invite in room', now() + interval '3 hours', room, 'invite');
  ecan := pg_temp.ev(h, 'Cancelled in room', now() + interval '4 hours', room); update public.events set status = 'cancelled' where id = ecan;
  epast := pg_temp.ev(h, 'Past in room', now() - interval '2 days', room);
  e := pg_temp.ev(h, 'Public in room', now() + interval '2 hours', room);
  r := pg_temp.rev(m, room);
  perform pg_temp.ok(pg_temp.sees(r, e) and pg_temp.sees(r, ecom) and pg_temp.sees(r, epast) and not pg_temp.sees(r, einv) and not pg_temp.sees(r, ecan), 'a room member sees public, community and past events; not invite only, not cancelled');
  r := pg_temp.rev(x, room);
  perform pg_temp.ok(pg_temp.sees(r, e) and pg_temp.sees(r, epast) and not pg_temp.sees(r, ecom) and not pg_temp.sees(r, einv) and not pg_temp.sees(r, ecan), 'a stranger sees only the public ones');
  r := pg_temp.rev(h, room);
  perform pg_temp.ok(pg_temp.sees(r, e) and pg_temp.sees(r, ecom) and pg_temp.sees(r, einv) and pg_temp.sees(r, ecan) and pg_temp.sees(r, epast), 'the host sees all of them');
  r := pg_temp.rev(m, room);
  perform pg_temp.ok((r -> (jsonb_array_length(r) - 1) ->> 'id') = epast::text and r -> 0 ->> 'title' is not null and (r -> 0 ->> 'going') is not null, 'upcoming first, the past one last, with the full event shape');
  perform pg_temp.anon();
  select public.ev_room_events(room) into r;
  perform pg_temp.admin();
  perform pg_temp.ok(pg_temp.sees(r, e) and not pg_temp.sees(r, ecom), 'a visitor with no account sees the public ones');

  -- ===================================================== the Rooms tab ========
  r := pg_temp.mine_of(m, room);
  perform pg_temp.ok(r ->> 'name' = 'Room One' and r ->> 'kind' = 'crew' and (r ->> 'members')::int = 2 and (r ->> 'joined')::boolean and (r ->> 'unread')::int = 0 and r -> 'latest_announcement' = 'null'::jsonb,
                     'mine lists my room with no news yet');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(pg_temp.j(m, 'select public.ev_rooms_for_me()') -> 'mine') q where q ->> 'kind' = 'hq')
                     and pg_temp.j(m, 'select public.ev_rooms_for_me()') -> 'hq' ->> 'id' = hq::text, 'HQ is on its own, not in mine');
  insert into public.crew_announcements (crew_id, author_id, body, created_at) values (room, h, 'Event news', clock_timestamp()) returning id into ann;
  insert into public.ev_announcement_event (announcement_id, event_id) values (ann, e);
  r := pg_temp.mine_of(m, room);
  perform pg_temp.ok((r ->> 'unread')::int = 1 and r -> 'latest_announcement' ->> 'body' = 'Event news' and r -> 'latest_announcement' ->> 'event_title' = 'Public in room'
                     and r -> 'latest_announcement' ->> 'event_id' = e::text, 'a new announcement: one unread, and the latest carries its event tag');
  perform pg_temp.actor(m); perform public.ev_room_mark_read(room); perform pg_temp.admin();
  perform pg_temp.ok((pg_temp.mine_of(m, room) ->> 'unread')::int = 0, 'opening the room marks it read');
  insert into public.crew_announcements (crew_id, author_id, body, created_at) values (room, h, 'Plain note', clock_timestamp());
  r := pg_temp.mine_of(m, room);
  perform pg_temp.ok((r ->> 'unread')::int = 1 and r -> 'latest_announcement' ->> 'body' = 'Plain note' and r -> 'latest_announcement' ->> 'event_title' is null, 'a plain announcement is news too, with no event tag');
  perform pg_temp.ok(pg_temp.mine_of(x, room) is null, 'someone not in the room does not have it in mine');
  r := pg_temp.j(m, 'select public.ev_rooms_for_me()');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r -> 'discover') q where q ->> 'id' = rdisc::text)
                     and not exists (select 1 from jsonb_array_elements(r -> 'discover') q where q ->> 'id' in (room::text, rpriv::text, hq::text)), 'discover shows open rooms I am not in, not my own, not private ones, not HQ');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r -> 'discover') q where q ->> 'id' = rdisc::text and q -> 'latest_announcement' = 'null'::jsonb and not (q ->> 'joined')::boolean),
                     'and shows no announcement of a room I am not in');

  -- Event chats on the tab.
  eold := pg_temp.ev(h, 'Long closed', now() - interval '20 days', room);
  eclosed := pg_temp.ev(h, 'Recently closed', now() - interval '5 days', room);
  ediscgo := pg_temp.ev(x, 'Elsewhere I am going', now() + interval '1 day', rdisc);
  perform pg_temp.reg(ediscgo, m, 'going');
  r := pg_temp.j(m, 'select public.ev_rooms_for_me()') -> 'eventChats';
  perform pg_temp.ok(pg_temp.sees(r, e) and pg_temp.sees(r, ecom) and pg_temp.sees(r, eclosed) and pg_temp.sees(r, ediscgo), 'event chats: events of my rooms, a closed one from the last 2 weeks, and one I am going to in another room');
  perform pg_temp.ok(not pg_temp.sees(r, einv) and not pg_temp.sees(r, ecan) and not pg_temp.sees(r, eold) and not pg_temp.sees(r, enoroom), 'not invite only, not cancelled, not closed over 2 weeks ago, not an event with no room');
  perform pg_temp.ok((select q ->> 'state' from jsonb_array_elements(r) q where q ->> 'event_id' = eclosed::text) = 'closed'
                     and (r -> (jsonb_array_length(r) - 1) ->> 'state') = 'closed' and (r -> 0 ->> 'state') in ('open', 'upcoming'), 'open and upcoming chats come before closed ones');
  perform pg_temp.ok((select (q ->> 'can_enter')::boolean from jsonb_array_elements(r) q where q ->> 'event_id' = ediscgo::text), 'and I can enter the one I am going to');
  r := pg_temp.j(h, 'select public.ev_rooms_for_me()') -> 'eventChats';
  perform pg_temp.ok(pg_temp.sees(r, einv), 'the host sees the chat of their own invite only event');

  -- One room.
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_room(%L)', room)) ->> 'name' = 'Room One' and not (pg_temp.j(x, format('select public.ev_room(%L)', room)) ->> 'joined')::boolean
                     and pg_temp.j(x, format('select public.ev_room(%L)', room)) -> 'latest_announcement' = 'null'::jsonb, 'a stranger can see an open room, without its news');
  perform pg_temp.ok(pg_temp.j(m, format('select public.ev_room(%L)', rpriv)) is null and pg_temp.j(x, format('select public.ev_room(%L)', rpriv)) ->> 'name' = 'Room Private', 'a private room is shown to its members only');
  perform pg_temp.ok(pg_temp.j(m, format('select public.ev_room(%L)', gen_random_uuid())) is null, 'an unknown room is null');

  -- Access.
  for f in select p.oid, p.oid::regprocedure as sig, p.proname as name
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and p.proname in ('ev_event_chat', 'ev_room_events', 'ev_room', 'ev_rooms_for_me', 'ev_room_mark_read', 'ev_ensure_hq', 'ev_hq_backfill',
                                '_ev_chat_can_enter', '_ev_chat_json', '_ev_room_json', '_ev_is_hq')
  loop
    perform pg_temp.ok(has_function_privilege('anon', f.oid, 'execute') = (f.name in ('ev_event_chat', 'ev_room_events', 'ev_room')),
                       f.sig || ': anon access is as designed');
    perform pg_temp.ok(has_function_privilege('authenticated', f.oid, 'execute') = (f.name in ('ev_event_chat', 'ev_room_events', 'ev_room', 'ev_rooms_for_me', 'ev_room_mark_read', 'ev_ensure_hq')),
                       f.sig || ': authenticated access is as designed');
  end loop;
  perform pg_temp.ok(has_function_privilege('service_role', 'public.ev_hq_backfill()', 'execute') and has_function_privilege('service_role', 'public.ev_ensure_hq()', 'execute'), 'the service role can run the backfill and ensure HQ');
  raise notice 'ALL EVENTS R1 ROOMS TESTS PASSED';
end $$;
rollback;
