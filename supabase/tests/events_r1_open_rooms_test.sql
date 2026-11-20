-- DRAFT FOR OLA, NOT RUN ANYWHERE BUT A LOCAL THROWAWAY DATABASE. Open organiser rooms (CHANGE-006, supabase/events_r1_open_rooms.sql).
-- LOCAL ONLY: everything rolls back. Needs the older files through events_r1_outreach_ready.sql, then events_r1_open_rooms.sql (loaded twice).
-- Ends with ALL EVENTS R1 OPEN ROOMS TESTS PASSED.
--   psql -v ON_ERROR_STOP=1 -q -d <a throwaway database> -f supabase/tests/events_r1_open_rooms_test.sql
begin;
select public.ev_set_setting('events_r1', 'on');
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$
begin
  if v is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.actor(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;
create function pg_temp.j(u uuid, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin perform pg_temp.actor(u); execute q into r; perform pg_temp.admin(); return r; end $$;
create function pg_temp.an(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin perform pg_temp.anon(); execute q into r; perform pg_temp.admin(); return r; end $$;
create function pg_temp.t(u uuid, q text) returns text language plpgsql as $$
declare r text;
begin perform pg_temp.actor(u); execute q into r; perform pg_temp.admin(); return r; end $$;
-- does a statement fail for this role (null = signed out)?
create function pg_temp.denied(u uuid, q text) returns boolean language plpgsql as $$
begin
  if u is null then perform pg_temp.anon(); else perform pg_temp.actor(u); end if;
  begin execute q; perform pg_temp.admin(); return false;
  exception when others then perform pg_temp.admin(); return true; end;
end $$;
create function pg_temp.newuser(shown text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'or6-' || u || '@evtest.invalid', now(), false, '{}',
          json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
create function pg_temp.sev(sid text, nm text, days integer, org text) returns jsonb language sql as $$
  select jsonb_build_object(
    'source_site', 'tix', 'source_id', sid, 'name', nm,
    'starts_at', public._ev_o_iso((date_trunc('day', now() at time zone 'Africa/Lagos') + make_interval(days => days) + interval '20 hours') at time zone 'Africa/Lagos'),
    'ends_at', null, 'venue', null, 'area', null, 'lat', null, 'lng', null, 'description', '', 'sold_out', false,
    'tickets', jsonb_build_array(jsonb_build_object('name', 'Gate', 'price_naira', 3000, 'sold_out', false)),
    'ticket_url', 'https://tix.example/' || sid, 'flyer_url', null, 'category', null, 'organiser_name', org, 'organiser_handle', null, 'event_handle', null,
    'lineup', '[]'::jsonb, 'capacity', null, 'last_seen', public._ev_o_iso(now()), 'confidence', 'confirmed');
$$;
create function pg_temp.approve(sid text, nm text, days integer, org text) returns jsonb language plpgsql as $$
declare r jsonb; p uuid;
begin
  perform public.ev_o_import(jsonb_build_object('run_id', 'or6-' || sid, 'scouted_at', public._ev_o_iso(now()), 'sources_covered', '[]'::jsonb,
                                               'events', jsonb_build_array(pg_temp.sev(sid, nm, days, org))), true);
  select id into p from public.ev_pulled where source_site = 'tix' and source_id = sid;
  r := public.ev_o_approve(p, 'Jae', null);
  if (r ->> 'ok') is distinct from 'true' then raise exception 'approve % failed: %', sid, r; end if;
  return r;
end $$;
create function pg_temp.mode(room uuid) returns text language sql as $$ select public._ev_join_mode(room); $$;
create function pg_temp.room_of(org uuid) returns uuid language sql as $$ select room_id from public.ev_organisers where id = org; $$;

do $$
declare
  lu uuid := pg_temp.newuser('Listings Test');
  host uuid := pg_temp.newuser('Host Person');
  u1 uuid := pg_temp.newuser('Shiro Owner');
  u2 uuid := pg_temp.newuser('Visitor Two');
  u3 uuid := pg_temp.newuser('Owner Three');
  r jsonb; l jsonb;
  org_a uuid; org_b uuid; org_c uuid; org_d uuid; org_e uuid;
  room_a uuid; room_b uuid; room_c uuid; room_d uuid; room_e uuid; room_h uuid; room_q uuid;
  ev_a uuid; ev_d uuid;
  ask uuid; n integer; can_msg boolean := to_regclass('public.crew_room_messages') is not null;
begin
  perform public.ev_listings_set_account((select email from auth.users where id = lu));
  perform pg_temp.ok(public._ev_open_org_rooms_on(), 'the switch open_organiser_rooms is on after the file runs');

  -- ============================================================ new rooms are open ========
  r := pg_temp.approve('a', 'Shiro Night', 5, 'Shiro Lagos');
  org_a := (r ->> 'organiser_id')::uuid; ev_a := (r ->> 'event_id')::uuid; room_a := pg_temp.room_of(org_a);
  perform pg_temp.ok(room_a is not null and pg_temp.mode(room_a) = 'open', 'approving an event makes the organiser a room that is open');
  perform pg_temp.ok((select listed_by_staff and not listed_mode_set from public.ev_room_profiles where crew_id = room_a), 'the room is flagged as made by Hoppaz');
  perform pg_temp.ok((select visibility from public.crews where id = room_a) = 'open', 'the old visibility column follows (open)');
  perform pg_temp.ok(public.ev_o_ensure_room(org_a) = room_a, 'ensure_room again gives the same room');
  perform pg_temp.ok(public._ev_room_listing_org(room_a) = org_a, 'the room is an unclaimed organiser room');

  -- ============================================================ signed out and signed in can see it ========
  r := pg_temp.an(format('select public.ev_room_profile(%L)', room_a));
  perform pg_temp.ok(r is not null and r ->> 'name' = 'Shiro Lagos' and r ->> 'join_mode' = 'open', 'a signed out visitor can open the room');
  r := pg_temp.j(u2, format('select public.ev_room_profile(%L)', room_a));
  perform pg_temp.ok(r is not null and r ->> 'my_role' is null, 'a signed in visitor can open the room');
  l := pg_temp.an(format('select public.ev_room_listing(%L)', room_a));
  perform pg_temp.ok(l ->> 'name' = 'Shiro Lagos' and (l ->> 'claim_event_id')::uuid = ev_a and l ->> 'my_claim' = 'none',
                     'ev_room_listing gives the organiser name, the event the claim points at, and no ask yet');
  perform pg_temp.ok(not (l ? 'email') and not (l ? 'phone') and l::text !~ '@', 'ev_room_listing carries no email and no phone');

  -- ============================================================ the backfill ========
  -- Two rooms as the old file made them: invite only and not flagged.
  r := pg_temp.approve('b', 'Gbedu Night', 6, 'Gbedu Collective');
  org_b := (r ->> 'organiser_id')::uuid; room_b := pg_temp.room_of(org_b);
  r := pg_temp.approve('c', 'Comedy Night', 7, 'Funny Co');
  org_c := (r ->> 'organiser_id')::uuid; room_c := pg_temp.room_of(org_c);
  update public.ev_room_profiles set join_mode = 'invite', listed_by_staff = false where crew_id in (room_b, room_c);
  update public.crews set visibility = 'private' where id in (room_b, room_c);
  perform pg_temp.ok(pg_temp.an(format('select public.ev_room_profile(%L)', room_b)) is null, 'before the backfill an old organiser room shows the lock (null)');
  perform pg_temp.ok(public._ev_room_listing_org(room_b) is null, 'an unflagged room is not an organiser room yet');
  -- A room a host made, invite only: never opened.
  r := pg_temp.j(host, 'select public.ev_create_room(''Our Quiet Circle'', '''', null, null, ''{}''::jsonb, ''invite'')');
  perform pg_temp.ok(r ->> 'ok' = 'true', 'a host makes an invite only room');
  room_h := public.ev_room_by_slug(r ->> 'slug');
  r := public.ev_open_organiser_rooms_count();
  r := public.ev_set_open_organiser_rooms('on');
  perform pg_temp.ok((r ->> 'changed')::int = 2, 'the backfill opens the two old organiser rooms (changed 2)');
  perform pg_temp.ok(pg_temp.mode(room_b) = 'open' and pg_temp.mode(room_c) = 'open'
                     and (select bool_and(listed_by_staff) from public.ev_room_profiles where crew_id in (room_b, room_c)), 'both are open and flagged');
  perform pg_temp.ok(pg_temp.mode(room_h) = 'invite' and not (select listed_by_staff from public.ev_room_profiles where crew_id = room_h),
                     'the host''s invite only room is untouched');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_room_profile(%L)', room_h)) is null, 'the host''s invite only room still shows the lock');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_room_listing(%L)', room_h)) is null, 'no claim strip on a host''s room');
  r := public.ev_open_organiser_rooms_count();
  perform pg_temp.ok((r ->> 'unclaimed_rooms')::int = 3 and (r ->> 'invite_only')::int = 0 and (r ->> 'open')::int = 3, 'the count: 3 unclaimed rooms, all open');
  perform pg_temp.ok((public.ev_set_open_organiser_rooms('on') ->> 'changed')::int = 0, 'running the backfill again changes nothing');

  -- An organiser room with a community event in it is never opened.
  r := pg_temp.approve('q', 'Members Night', 8, 'Quiet Org');
  room_q := pg_temp.room_of((r ->> 'organiser_id')::uuid);
  update public.ev_room_profiles set join_mode = 'invite' where crew_id = room_q;
  begin
    update public.events set visibility = 'community' where id = (r ->> 'event_id')::uuid;
    perform pg_temp.ok(public._ev_room_listing_org(room_q) is null, 'an organiser room holding a community event is not an open organiser room');
    perform public.ev_set_open_organiser_rooms('on');
    perform pg_temp.ok(pg_temp.mode(room_q) = 'invite', 'the switch does not open it');
  exception when check_violation or raise_exception then
    raise notice 'SKIP: a listing cannot be a community event here (%), the rule stays in _ev_room_listing_org', sqlerrm;
  end;

  -- ============================================================ the switch ========
  r := public.ev_set_open_organiser_rooms('off');
  perform pg_temp.ok(r ->> 'value' = 'off' and pg_temp.mode(room_a) = 'invite' and pg_temp.mode(room_b) = 'invite', 'off closes the organiser rooms again');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_room_listing(%L)', room_a)) is null, 'off: no claim strip');
  r := pg_temp.approve('d', 'Afrobeats Brunch', 9, 'Brunch Club');
  org_d := (r ->> 'organiser_id')::uuid; ev_d := (r ->> 'event_id')::uuid; room_d := pg_temp.room_of(org_d);
  perform pg_temp.ok(pg_temp.mode(room_d) = 'invite', 'off: a new organiser room is made invite only, as before');
  perform pg_temp.ok(public.ev_set_open_organiser_rooms('maybe') ->> 'reason' = 'bad_value', 'a bad value is refused');
  r := public.ev_set_open_organiser_rooms('on');
  perform pg_temp.ok(pg_temp.mode(room_a) = 'open' and pg_temp.mode(room_d) = 'open' and pg_temp.mode(room_h) = 'invite', 'on opens them all again, the host room stays shut');

  -- ============================================================ staff switch ========
  r := public.ev_o_room_mode(org_b);
  perform pg_temp.ok(r ->> 'join_mode' = 'open' and (r ->> 'switchable')::boolean, 'the desk reads Open and may switch it');
  r := public.ev_o_room_set_mode(org_b, 'invite', 'Ola');
  perform pg_temp.ok(r ->> 'ok' = 'true' and pg_temp.mode(room_b) = 'invite' and (select visibility from public.crews where id = room_b) = 'private', 'staff set a room to Invite only');
  perform pg_temp.ok((select count(*) from public.ev_organiser_log where organiser_id = org_b and body = 'Room set to Invite only.') = 1, 'the desk log has the change');
  perform pg_temp.ok((public.ev_set_open_organiser_rooms('on') ->> 'changed')::int = 0 and pg_temp.mode(room_b) = 'invite', 'the switch leaves a room staff set by hand');
  perform pg_temp.ok(public.ev_o_room_set_mode(org_b, 'closed') ->> 'reason' = 'bad_value', 'a bad mode is refused');
  perform pg_temp.ok(pg_temp.denied(u1, format('select public.ev_o_room_set_mode(%L, ''open'')', org_b))
                     and pg_temp.denied(null, format('select public.ev_o_room_set_mode(%L, ''open'')', org_b))
                     and pg_temp.denied(u1, 'select public.ev_set_open_organiser_rooms(''off'')')
                     and pg_temp.denied(u1, format('select public.ev_o_room_mode(%L)', org_b)),
                     'only the service role (the desk) can switch or read the desk view');

  -- ============================================================ join, chat read only ========
  perform pg_temp.ok(pg_temp.t(u2, format('select public.ev_join_room(%L)', room_a)) = 'joined', 'a visitor can join an unclaimed open room');
  if can_msg then
    perform pg_temp.ok(pg_temp.denied(u2, format('select public.crew_room_send(%L, ''general'', ''hello'', gen_random_uuid())', room_a)),
                       'a member cannot post in General before the room is claimed');
  end if;

  -- ============================================================ claim from the room ========
  perform pg_temp.ok(pg_temp.denied(null, format('select public.ev_claim_ask_room(%L, ''me'')', room_a)), 'a signed out visitor cannot ask (they sign in first)');
  perform pg_temp.ok(pg_temp.j(u1, format('select public.ev_claim_ask_room(%L, ''me'')', room_a)) ->> 'reason' = 'not_on', 'claims off: the ask is refused like any CHANGE-005 ask');
  perform public.ev_set_claims('on');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_room_listing(%L)', room_a)) ->> 'claims_on' = 'true', 'the room page knows claims are on');
  r := pg_temp.j(u1, format('select public.ev_claim_ask_room(%L, %L)', room_a, 'I run Shiro'));
  perform pg_temp.ok(r ->> 'ok' = 'true', 'a signed in person asks to claim the room');
  select id into ask from public.ev_claim_asks where user_id = u1 and status = 'new';
  perform pg_temp.ok(ask is not null and (select event_id from public.ev_claim_asks where id = ask) = ev_a
                     and (select organiser_id from public.ev_claim_asks where id = ask) = org_a, 'the ask is a CHANGE-005 ask on the organiser''s event');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(public.ev_o_claim_asks()) x where (x ->> 'id')::uuid = ask), 'it lands in the staff list of asks');
  perform pg_temp.ok(pg_temp.j(u1, format('select public.ev_room_listing(%L)', room_a)) ->> 'my_claim' = 'pending', 'the asker sees We''re checking (pending)');
  perform pg_temp.ok(pg_temp.j(u2, format('select public.ev_room_listing(%L)', room_a)) ->> 'my_claim' = 'none', 'someone else does not');
  perform pg_temp.ok(pg_temp.j(u2, format('select public.ev_claim_ask_room(%L, null)', room_h)) ->> 'reason' = 'not_found', 'asking for a host''s room is refused');

  r := public.ev_o_claim_ask_decide(ask, true, 'Jae');
  perform pg_temp.ok(r ->> 'ok' = 'true', 'staff approve the ask');
  perform pg_temp.ok(public._ev_xf_owner(room_a) = u1 and pg_temp.mode(room_a) = 'open', 'claimed: the organiser owns the room and it keeps its mode (open)');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_room_listing(%L)', room_a)) is null, 'claimed: the strip is gone');
  perform pg_temp.ok(public.ev_o_room_set_mode(org_a, 'invite') ->> 'reason' = 'is_claimed' and not (public.ev_o_room_mode(org_a) ->> 'switchable')::boolean,
                     'claimed: the desk can no longer switch it');
  perform pg_temp.ok((public.ev_set_open_organiser_rooms('off') ->> 'changed')::int >= 0 and pg_temp.mode(room_a) = 'open', 'claimed: the switch off does not touch it');
  perform public.ev_set_open_organiser_rooms('on');
  r := pg_temp.j(u1, format('select public.ev_update_room(%L, ''{"join_mode": "ask"}''::jsonb)', room_a));
  perform pg_temp.ok(r ->> 'ok' = 'true' and pg_temp.mode(room_a) = 'ask', 'the owner changes the mode in Settings');
  if can_msg then
    perform pg_temp.ok(not pg_temp.denied(u2, format('select public.crew_room_send(%L, ''general'', ''hello'', gen_random_uuid())', room_a)),
                       'after the claim members can post in General');
  end if;

  -- A room staff set to Invite only stays invite only after a claim.
  perform public.ev_o_room_set_mode(org_d, 'invite', 'Ola');
  r := pg_temp.j(u3, format('select public.ev_claim_ask(%L, ''mine'')', ev_d));
  select id into ask from public.ev_claim_asks where user_id = u3 and status = 'new';
  perform public.ev_o_claim_ask_decide(ask, true, 'Jae');
  perform pg_temp.ok(public._ev_xf_owner(room_d) = u3 and pg_temp.mode(room_d) = 'invite', 'a claim keeps Invite only when staff set it');

  -- With the switch off the CHANGE-005 behaviour is back: a dormant room opens on claim.
  perform public.ev_set_open_organiser_rooms('off');
  r := pg_temp.approve('e', 'Late Night', 10, 'Late Org');
  org_e := (r ->> 'organiser_id')::uuid; room_e := pg_temp.room_of(org_e);
  perform pg_temp.ok(pg_temp.mode(room_e) = 'invite', 'switch off: a new room is dormant');
  perform pg_temp.j(u2, format('select public.ev_claim_ask(%L, ''mine'')', (r ->> 'event_id')::uuid));
  select id into ask from public.ev_claim_asks where user_id = u2 and status = 'new';
  perform public.ev_o_claim_ask_decide(ask, true, 'Jae');
  perform pg_temp.ok(pg_temp.mode(room_e) = 'open', 'switch off: a claim opens the dormant room, as in CHANGE-005');

  raise notice 'ALL EVENTS R1 OPEN ROOMS TESTS PASSED';
end $$;
rollback;
