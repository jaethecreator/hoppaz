-- DRAFT FOR OLA, NOT RUN ANYWHERE. The room transfer, the claim request and the switch to Hoppaz tickets
-- (supabase/events_r1_transfer.sql). LOCAL ONLY: everything rolls back.
-- Needs the older files, events_r1_room_profile.sql, events_r1_registrations.sql, events_r1_pay.sql, events_r1_listings.sql and
-- events_r1_transfer.sql loaded (events_r1_outreach.sql too if you have it: one extra check uses ev_o_ensure_room).
-- Ends with ALL EVENTS R1 TRANSFER TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_transfer_test.sql
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
create function pg_temp.svc() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;
-- run a query as a signed-in person / nobody / the service role, give back the jsonb
create function pg_temp.j(u uuid, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin perform pg_temp.actor(u); execute q into r; perform pg_temp.admin(); return r; end $$;
create function pg_temp.an(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin perform pg_temp.anon(); execute q into r; perform pg_temp.admin(); return r; end $$;
create function pg_temp.s(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin perform pg_temp.svc(); execute q into r; perform pg_temp.admin(); return r; end $$;
-- sha256 hex of a token, like the admin route
create function pg_temp.h(tok text) returns text language sql as $$ select encode(sha256(convert_to(tok, 'UTF8')), 'hex'); $$;
create function pg_temp.newuser(shown text, mail text, confirmed boolean default true) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail, case when confirmed then now() end, mail is null, '{}',
          json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
-- a room by hand: the crew, its owner, its profile
create function pg_temp.mkroom(owner uuid, nm text, mode text, made timestamptz default now()) returns uuid language plpgsql as $$
declare c uuid := gen_random_uuid();
begin
  insert into public.crews (id, name, created_by, visibility, created_at) values (c, nm, owner, case when mode = 'open' then 'open' else 'private' end, made);
  insert into public.crew_members (crew_id, user_id, role) values (c, owner, 'owner');
  insert into public.ev_room_profiles (crew_id, slug, join_mode) values (c, 'xf-' || substr(md5(c::text), 1, 10), mode);
  return c;
end $$;
create function pg_temp.mkorg(nm text, room uuid, stg text default 'listed') returns uuid language sql as $$
  insert into public.ev_organisers (name, name_key, room_id, stage) values (nm, lower(regexp_replace(nm, '[^a-zA-Z0-9]', '', 'g')), room, stg) returning id;
$$;
create function pg_temp.mkev(host uuid, room uuid, org uuid, ttl text, starts timestamptz, ends timestamptz default null, mode text default 'external') returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, ends_at, status, host_id, room_id, organiser_id, visibility, source, ticket_mode, ticket_url)
  values (ttl, 'Somewhere', starts, ends, 'live', host, room, org, 'public', 'partner', mode, 'https://tix.example/' || md5(ttl)) returning id;
$$;

-- ===================================================================== 1. the claim, start to end ========
do $$
declare
  L uuid := pg_temp.newuser('XF Listings', 'listings@xf.test');
  A uuid := pg_temp.newuser('XF Anna', 'a@xf.test');
  W uuid := pg_temp.newuser('XF Wrong', 'w@xf.test');
  Un uuid := pg_temp.newuser('XF Unconfirmed', 'un@xf.test', false);
  Gh uuid := pg_temp.newuser('XF Ghost', null);
  H2 uuid := pg_temp.newuser('XF Other host', 'h2@xf.test');
  r1 uuid; o1 uuid; od uuid;
  e_past uuid; e_up uuid; e_live uuid; e_can uuid; e_noroom uuid; e_h2 uuid;
  r jsonb; r2 jsonb; t1 uuid; t2 uuid; v text;
begin
  perform pg_temp.ok(public.ev_listings_set_account('listings@xf.test') = 'ok', 'the Listings account is set');
  r1 := pg_temp.mkroom(L, 'XF Room One', 'invite');
  o1 := pg_temp.mkorg('XF Org One', r1);
  e_past := pg_temp.mkev(L, r1, o1, 'XF past', now() - interval '2 days');
  e_up := pg_temp.mkev(L, r1, o1, 'XF up', now() + interval '3 days');
  e_live := pg_temp.mkev(L, r1, o1, 'XF live now', now() - interval '1 hour');
  e_can := pg_temp.mkev(L, r1, o1, 'XF cancelled', now() + interval '4 days');
  update public.events set status = 'cancelled' where id = e_can;
  e_noroom := pg_temp.mkev(L, null, o1, 'XF no room', now() + interval '5 days');
  e_h2 := pg_temp.mkev(H2, r1, o1, 'XF other host', now() + interval '6 days');

  -- ---------------------------------------------------- staff makes the link
  r := pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L, 14, %L)', o1, ' A@XF.test ', pg_temp.h('tok-a'), 'Tester'));
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'transfer' ->> 'to_email' = 'a@xf.test' and r -> 'transfer' ->> 'kind' = 'claim'
                     and r -> 'transfer' ->> 'status' = 'pending' and r -> 'transfer' ->> 'room_name' = 'XF Room One', 'a link is made, the email lower-cased');
  t1 := (r -> 'transfer' ->> 'id')::uuid;
  perform pg_temp.ok(not (r::text like '%' || pg_temp.h('tok-a') || '%') and not (r -> 'transfer' ? 'token_hash'), 'the answer never carries the hash');
  perform pg_temp.ok((select token_hash from public.ev_transfers where id = t1) = pg_temp.h('tok-a'), 'only the sha256 hex is stored');
  perform pg_temp.ok((select stage from public.ev_organisers where id = o1) = 'offered', 'the organiser moves to offered');
  perform pg_temp.ok((select count(*) from public.ev_organiser_log where organiser_id = o1 and kind = 'transfer') = 1, 'a log line was written');
  perform pg_temp.ok(pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o1, 'a@xf.test', pg_temp.h('tok-a2'))) ->> 'reason' = 'already_pending', 'a second open link for the same email: already_pending');
  perform pg_temp.ok(pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o1, 'b@xf.test', pg_temp.h('tok-a'))) ->> 'reason' = 'invalid_link', 'the same hash twice: invalid_link');
  perform pg_temp.ok(pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o1, 'nope', pg_temp.h('tok-x'))) ->> 'reason' = 'bad_email', 'a bad email');
  perform pg_temp.ok(pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o1, 'b@xf.test', 'short')) ->> 'reason' = 'invalid_link', 'a bad hash');
  perform pg_temp.ok(pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', gen_random_uuid(), 'b@xf.test', pg_temp.h('tok-y'))) ->> 'reason' = 'not_found', 'no such organiser');
  r2 := pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o1, 'b@xf.test', pg_temp.h('tok-b')));
  perform pg_temp.ok((r2 ->> 'ok')::boolean, 'a second link, for another email');
  t2 := (r2 -> 'transfer' ->> 'id')::uuid;
  od := pg_temp.mkorg('XF Org Said No', null, 'declined');
  perform pg_temp.ok(pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', od, 'z@xf.test', pg_temp.h('tok-z'))) ->> 'reason' = 'organiser_declined', 'a declined organiser: organiser_declined');
  od := pg_temp.mkorg('XF Org Dnc', null, 'listed');
  update public.ev_organisers set do_not_contact = true where id = od;
  perform pg_temp.ok(pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', od, 'z@xf.test', pg_temp.h('tok-z'))) ->> 'reason' = 'organiser_declined', 'do not contact: organiser_declined');
  od := pg_temp.mkorg('XF Org Claimed', null, 'claimed');
  perform pg_temp.ok(pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', od, 'z@xf.test', pg_temp.h('tok-z'))) ->> 'reason' = 'is_claimed', 'a claimed organiser: is_claimed');

  -- ----------------------------------------------------------- the preview
  r := pg_temp.an(format('select public.ev_transfer_preview(%L)', pg_temp.h('tok-a')));
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'email_hint' = 'a***@xf.test' and r ->> 'kind' = 'claim' and r ->> 'organiser_name' = 'XF Org One', 'the preview works for a visitor, email as a***@xf.test');
  perform pg_temp.ok(jsonb_array_length(r -> 'events') = 2
                     and (select bool_and(x ->> 'title' in ('XF up', 'XF live now')) from jsonb_array_elements(r -> 'events') x), 'it lists only the two upcoming events that would move');
  perform pg_temp.ok(r::text not like '%a@xf.test%' and r::text not like '%token%' and r::text not like '%' || pg_temp.h('tok-a') || '%', 'the preview leaks no full email and no hash');
  perform pg_temp.ok(array(select jsonb_object_keys(r)) <@ array['ok', 'kind', 'room', 'events', 'email_hint', 'organiser_name', 'expires_at']
                     and array(select jsonb_object_keys(r -> 'room')) <@ array['name', 'slug', 'logo_url', 'about'], 'only the documented keys');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_transfer_preview(%L)', pg_temp.h('nothing'))) = '{"ok": false, "reason": "not_found"}'::jsonb, 'an unknown link: not_found and nothing else');
  perform pg_temp.ok(pg_temp.an('select public.ev_transfer_preview(''garbage'')') = '{"ok": false, "reason": "not_found"}'::jsonb, 'garbage: not_found');

  -- ------------------------------------------------ wrong people are turned away
  r := pg_temp.j(W, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-a')));
  perform pg_temp.ok(r ->> 'reason' = 'wrong_email', 'another account: wrong_email');
  perform pg_temp.ok((select attempts from public.ev_transfers where id = t1) = 1 and (select status from public.ev_transfers where id = t1) = 'pending', 'it counted one attempt and the link is not used up');
  perform pg_temp.ok((select role from public.crew_members where crew_id = r1 and user_id = L) = 'owner' and not exists (select 1 from public.crew_members where crew_id = r1 and user_id = W), 'nothing changed');
  perform pg_temp.ok(pg_temp.j(Un, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-a'))) ->> 'reason' = 'wrong_email', 'an unconfirmed email is refused too');
  perform pg_temp.ok(pg_temp.j(Gh, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-a'))) ->> 'reason' = 'need_account', 'a guest with no email: need_account');
  perform pg_temp.ok(pg_temp.j(A, format('select public.ev_transfer_accept(%L)', 'zz')) ->> 'reason' = 'invalid_link', 'a garbage link: invalid_link');
  perform pg_temp.ok(pg_temp.j(A, format('select public.ev_transfer_accept(%L)', pg_temp.h('never-made'))) ->> 'reason' = 'invalid_link', 'an unknown link: invalid_link');

  -- ------------------------------------------------------ the right person
  r := pg_temp.j(A, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-a')));
  perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'room_id')::uuid = r1 and (r ->> 'moved_events')::int = 2 and (r ->> 'already_owned_other')::boolean = false, 'the right email accepts: two events moved, no other room');
  perform pg_temp.ok(r ->> 'slug' = (select slug from public.ev_room_profiles where crew_id = r1), 'the answer carries the room slug');
  perform pg_temp.ok((select role from public.crew_members where crew_id = r1 and user_id = A) = 'owner', 'Anna is the owner');
  perform pg_temp.ok(not exists (select 1 from public.crew_members where crew_id = r1 and user_id = L), 'Hoppaz Listings left the room');
  perform pg_temp.ok((select created_by from public.crews where id = r1) = A, 'crews.created_by is Anna');
  perform pg_temp.ok((select host_id from public.events where id = e_up) = A and (select host_id from public.events where id = e_live) = A, 'the upcoming and the under way events moved');
  perform pg_temp.ok((select host_id from public.events where id = e_past) = L, 'the past event kept its old host');
  perform pg_temp.ok((select host_id from public.events where id = e_can) = L, 'the cancelled event kept its old host');
  perform pg_temp.ok((select host_id from public.events where id = e_noroom) = L, 'an event in no room did not move');
  perform pg_temp.ok((select host_id from public.events where id = e_h2) = H2, 'another host''s event in the room did not move');
  perform pg_temp.ok((select join_mode from public.ev_room_profiles where crew_id = r1) = 'open' and (select visibility from public.crews where id = r1) = 'open', 'the dormant room opened');
  perform pg_temp.ok((select stage from public.ev_organisers where id = o1) = 'claimed' and (select claimed_by from public.ev_organisers where id = o1) = A
                     and (select claimed_at from public.ev_organisers where id = o1) is not null and (select email from public.ev_organisers where id = o1) = 'a@xf.test', 'the organiser is claimed, email filled in');
  perform pg_temp.ok((select status from public.ev_transfers where id = t1) = 'accepted' and (select accepted_by from public.ev_transfers where id = t1) = A
                     and (select accepted_at from public.ev_transfers where id = t1) is not null, 'the link is marked accepted');
  perform pg_temp.ok((select status from public.ev_transfers where id = t2) = 'revoked' and (select revoked_at from public.ev_transfers where id = t2) is not null, 'the other open link of the room was cancelled');
  perform pg_temp.ok((select count(*) from public.ev_organiser_log where organiser_id = o1 and kind = 'transfer') >= 3, 'the log has the lines');
  perform pg_temp.ok(pg_temp.j(A, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-a'))) ->> 'reason' = 'link_used', 'a second accept: link_used');
  perform pg_temp.ok(pg_temp.j(W, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-a'))) ->> 'reason' = 'link_used', 'and for anyone else: link_used');
  perform pg_temp.ok(pg_temp.j(A, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-b'))) ->> 'reason' = 'link_revoked', 'the cancelled link: link_revoked');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_transfer_preview(%L)', pg_temp.h('tok-a'))) ->> 'reason' = 'used', 'preview of a used link: used');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_transfer_preview(%L)', pg_temp.h('tok-b'))) ->> 'reason' = 'revoked', 'preview of a cancelled link: revoked');
  perform pg_temp.ok(pg_temp.s(format('select public.ev_o_transfer_revoke(%L)', t1)) ->> 'reason' = 'link_used', 'staff cannot revoke an accepted link');
  perform pg_temp.ok(pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o1, 'c@xf.test', pg_temp.h('tok-c'))) ->> 'reason' = 'is_claimed', 'no new link for a claimed organiser');
end $$;

-- ===================================================================== 2. wrong email, expiry, revoke, no account yet ========
do $$
declare
  L uuid := public._ev_listings_uid();
  C uuid := pg_temp.newuser('XF Carla', 'c@xf.test');
  W uuid := pg_temp.newuser('XF Wrong2', 'w2@xf.test');
  r2 uuid; o2 uuid; r3 uuid; o3 uuid; r4 uuid; o4 uuid;
  r jsonb; t uuid; i integer; v_last jsonb; N uuid;
begin
  -- ten wrong emails lock the link
  r2 := pg_temp.mkroom(L, 'XF Room Two', 'invite'); o2 := pg_temp.mkorg('XF Org Two', r2);
  t := (pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o2, 'c@xf.test', pg_temp.h('tok-lock'))) -> 'transfer' ->> 'id')::uuid;
  for i in 1..9 loop
    v_last := pg_temp.j(W, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-lock')));
    perform pg_temp.ok(v_last ->> 'reason' = 'wrong_email', 'wrong email, try ' || i);
  end loop;
  perform pg_temp.ok((select attempts from public.ev_transfers where id = t) = 9 and (select status from public.ev_transfers where id = t) = 'pending', 'nine tries: still open');
  v_last := pg_temp.j(W, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-lock')));
  perform pg_temp.ok(v_last ->> 'reason' = 'link_revoked' and (select status from public.ev_transfers where id = t) = 'revoked', 'the tenth cancels the link');
  perform pg_temp.ok(pg_temp.j(C, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-lock'))) ->> 'reason' = 'link_revoked', 'then even the right person is told link_revoked');
  perform pg_temp.ok((select role from public.crew_members where crew_id = r2 and user_id = L) = 'owner', 'the room did not move');

  -- a few wrong tries do not stop the right person
  r3 := pg_temp.mkroom(L, 'XF Room Three', 'invite'); o3 := pg_temp.mkorg('XF Org Three', r3);
  perform pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o3, 'c@xf.test', pg_temp.h('tok-three')));
  perform pg_temp.j(W, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-three')));
  perform pg_temp.j(W, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-three')));
  r := pg_temp.j(C, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-three')));
  perform pg_temp.ok((r ->> 'ok')::boolean, 'two wrong tries, then the right person still gets in');
  perform pg_temp.ok((select role from public.crew_members where crew_id = r3 and user_id = C) = 'owner', 'and owns the room');

  -- expired
  r4 := pg_temp.mkroom(L, 'XF Room Four', 'invite'); o4 := pg_temp.mkorg('XF Org Four', r4);
  t := (pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L, 1)', o4, 'late@xf.test', pg_temp.h('tok-late'))) -> 'transfer' ->> 'id')::uuid;
  N := pg_temp.newuser('XF Late', 'late@xf.test');
  update public.ev_transfers set expires_at = now() - interval '1 minute' where id = t;
  perform pg_temp.ok(pg_temp.j(N, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-late'))) ->> 'reason' = 'link_expired', 'an expired link: link_expired');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_transfer_preview(%L)', pg_temp.h('tok-late'))) ->> 'reason' = 'expired', 'preview: expired');
end $$;

do $$
declare
  L uuid := public._ev_listings_uid();
  C uuid := pg_temp.newuser('XF Rita', 'rita@xf.test');
  r5 uuid; o5 uuid; t uuid; r jsonb; N uuid; r6 uuid; o6 uuid;
begin
  -- revoked by staff
  r5 := pg_temp.mkroom(L, 'XF Room Five', 'invite'); o5 := pg_temp.mkorg('XF Org Five', r5);
  t := (pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o5, 'rita@xf.test', pg_temp.h('tok-rev'))) -> 'transfer' ->> 'id')::uuid;
  r := pg_temp.s(format('select public.ev_o_transfer_revoke(%L, %L)', t, 'Tester'));
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'transfer' ->> 'status' = 'revoked', 'staff revokes a link');
  perform pg_temp.ok((pg_temp.s(format('select public.ev_o_transfer_revoke(%L)', t)) ->> 'ok')::boolean, 'revoking twice is fine');
  perform pg_temp.ok(pg_temp.s(format('select public.ev_o_transfer_revoke(%L)', gen_random_uuid())) ->> 'reason' = 'not_found', 'revoke of nothing: not_found');
  perform pg_temp.ok(pg_temp.j(C, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-rev'))) ->> 'reason' = 'link_revoked', 'a revoked link: link_revoked');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_transfer_preview(%L)', pg_temp.h('tok-rev'))) ->> 'reason' = 'revoked', 'preview: revoked');
  -- a new one can be made after a revoke
  perform pg_temp.ok((pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o5, 'rita@xf.test', pg_temp.h('tok-rev2'))) ->> 'ok')::boolean, 'a new link after a cancelled one');

  -- an email that matches but is not confirmed is refused; once confirmed it works
  declare
    Uc uuid := pg_temp.newuser('XF Unconfirmed2', 'unc@xf.test', false); r12 uuid := pg_temp.mkroom(L, 'XF Room Twelve', 'invite'); o12 uuid;
  begin
    o12 := pg_temp.mkorg('XF Org Twelve', r12);
    perform pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o12, 'unc@xf.test', pg_temp.h('tok-unc')));
    perform pg_temp.ok(pg_temp.j(Uc, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-unc'))) ->> 'reason' = 'wrong_email', 'the right address but not confirmed: wrong_email');
    update auth.users set email_confirmed_at = now() where id = Uc;
    perform pg_temp.ok((pg_temp.j(Uc, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-unc'))) ->> 'ok')::boolean, 'once confirmed the same link works');
  end;

  -- no account yet: the link is made first, the person signs up with that email after
  r6 := pg_temp.mkroom(L, 'XF Room Six', 'invite'); o6 := pg_temp.mkorg('XF Org Six', r6);
  perform pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o6, 'newbie@xf.test', pg_temp.h('tok-new')));
  N := pg_temp.newuser('XF Newbie', 'newbie@xf.test');
  r := pg_temp.j(N, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-new')));
  perform pg_temp.ok((r ->> 'ok')::boolean and (select role from public.crew_members where crew_id = r6 and user_id = N) = 'owner', 'a brand new account with that email takes the room');
end $$;

-- ===================================================================== 3. paid sales ========
do $$
declare
  L uuid := public._ev_listings_uid();
  P uuid := pg_temp.newuser('XF Paula', 'paula@xf.test');
  B uuid := pg_temp.newuser('XF Buyer', 'buyer@xf.test');
  r7 uuid; o7 uuid; e_paid uuid; e_free uuid; t uuid; r jsonb;
  r8 uuid; o8 uuid; e_old uuid; e_exp uuid; e_open uuid; e_ref uuid; t8 uuid;
  Q uuid := pg_temp.newuser('XF Quentin', 'quentin@xf.test');
  r9 uuid; o9 uuid; e_rp uuid;
begin
  r7 := pg_temp.mkroom(L, 'XF Room Seven', 'invite'); o7 := pg_temp.mkorg('XF Org Seven', r7);
  -- a paid order can only be written while the event is a Hoppaz event; then it becomes a listing again
  e_paid := pg_temp.mkev(L, r7, o7, 'XF paid night', now() + interval '2 days', null, 'hoppaz');
  e_free := pg_temp.mkev(L, r7, o7, 'XF free night', now() + interval '3 days');
  insert into public.ev_orders (buyer_id, event_id, quantity, unit_price_kobo, gross_kobo, platform_fee_kobo, status, host_account, bachs_reference, expires_at, paid_at)
  values (B, e_paid, 1, 500000, 500000, 50000, 'paid', 'acct', 'xf-ref-1', now() + interval '1 day', now());
  update public.events set ticket_mode = 'external' where id = e_paid;
  t := (pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o7, 'paula@xf.test', pg_temp.h('tok-paid'))) -> 'transfer' ->> 'id')::uuid;
  r := pg_temp.j(P, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-paid')));
  perform pg_temp.ok(r ->> 'reason' = 'paid_sales', 'a paid order on an upcoming event: paid_sales');
  perform pg_temp.ok((select role from public.crew_members where crew_id = r7 and user_id = L) = 'owner' and not exists (select 1 from public.crew_members where crew_id = r7 and user_id = P), 'nothing changed: the owner');
  perform pg_temp.ok((select host_id from public.events where id = e_paid) = L and (select host_id from public.events where id = e_free) = L and (select created_by from public.crews where id = r7) = L, 'nothing changed: events and created_by');
  perform pg_temp.ok((select status from public.ev_transfers where id = t) = 'pending' and (select attempts from public.ev_transfers where id = t) = 0, 'the link is still open and no attempt was counted');
  perform pg_temp.ok((select join_mode from public.ev_room_profiles where crew_id = r7) = 'invite' and (select stage from public.ev_organisers where id = o7) = 'offered', 'nothing changed: the room is still dormant, the organiser not claimed');

  -- refund_pending counts too
  r9 := pg_temp.mkroom(L, 'XF Room Nine', 'invite'); o9 := pg_temp.mkorg('XF Org Nine', r9);
  e_rp := pg_temp.mkev(L, r9, o9, 'XF refund night', now() + interval '2 days', null, 'hoppaz');
  insert into public.ev_orders (buyer_id, event_id, quantity, unit_price_kobo, gross_kobo, platform_fee_kobo, status, host_account, bachs_reference, expires_at)
  values (B, e_rp, 1, 500000, 500000, 50000, 'refund_pending', 'acct', 'xf-ref-2', now() + interval '1 day');
  update public.events set ticket_mode = 'external' where id = e_rp;
  perform pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o9, 'quentin@xf.test', pg_temp.h('tok-rp')));
  perform pg_temp.ok(pg_temp.j(Q, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-rp'))) ->> 'reason' = 'paid_sales', 'a refund_pending order: paid_sales');

  -- orders that do not block: a paid order on a past event, an expired and an open order on an upcoming one
  r8 := pg_temp.mkroom(L, 'XF Room Eight', 'invite'); o8 := pg_temp.mkorg('XF Org Eight', r8);
  e_old := pg_temp.mkev(L, r8, o8, 'XF old paid night', now() - interval '3 days', null, 'hoppaz');
  e_exp := pg_temp.mkev(L, r8, o8, 'XF expired order night', now() + interval '2 days', null, 'hoppaz');
  e_open := pg_temp.mkev(L, r8, o8, 'XF open order night', now() + interval '3 days', null, 'hoppaz');
  insert into public.ev_orders (buyer_id, event_id, quantity, unit_price_kobo, gross_kobo, platform_fee_kobo, status, host_account, bachs_reference, expires_at, paid_at)
  values (B, e_old, 1, 500000, 500000, 50000, 'paid', 'acct', 'xf-ref-3', now() + interval '1 day', now() - interval '4 days'),
         (B, e_exp, 1, 500000, 500000, 50000, 'expired', 'acct', 'xf-ref-4', now() - interval '1 day', null),
         (B, e_open, 1, 500000, 500000, 50000, 'open', 'acct', 'xf-ref-5', now() + interval '1 day', null);
  update public.events set ticket_mode = 'external' where id in (e_old, e_exp, e_open);
  perform pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o8, 'paula@xf.test', pg_temp.h('tok-ok')));
  r := pg_temp.j(P, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-ok')));
  perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'moved_events')::int = 2, 'a past paid event, an expired and an open order do not block; two events move');
  perform pg_temp.ok((select host_id from public.events where id = e_old) = L and (select host_id from public.events where id = e_exp) = P, 'the past event stays, the upcoming ones moved');
  perform pg_temp.ok((r ->> 'already_owned_other')::boolean = false, 'owning a room Hoppaz Listings only held does not count');
end $$;

-- ===================================================================== 4. someone who already owns a room ========
do $$
declare
  L uuid := public._ev_listings_uid();
  P uuid := pg_temp.newuser('XF Pat', 'pat@xf.test');
  Q uuid := pg_temp.newuser('XF Hqowner', 'hqowner@xf.test');
  mine uuid; r10 uuid; o10 uuid; hq uuid; r11 uuid; o11 uuid; r jsonb; ev uuid;
begin
  mine := pg_temp.mkroom(P, 'XF Pats Own Room', 'open', now() - interval '30 days');
  r10 := pg_temp.mkroom(L, 'XF Room Ten', 'invite'); o10 := pg_temp.mkorg('XF Org Ten', r10);
  ev := pg_temp.mkev(L, r10, o10, 'XF ten night', now() + interval '2 days');
  perform pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o10, 'pat@xf.test', pg_temp.h('tok-pat')));
  r := pg_temp.j(P, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-pat')));
  perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'already_owned_other')::boolean, 'a person who owns a room: allowed, already_owned_other true');
  perform pg_temp.ok((select count(*) from public.crew_members where user_id = P and role = 'owner' and crew_id in (mine, r10)) = 2, 'they own both rooms');
  perform pg_temp.ok((select host_id from public.events where id = ev) = P, 'the event moved');
  perform pg_temp.ok(public._ev_host_room(P) = mine, 'new events without a room still go to their older room');

  -- Lagos HQ does not count as "another room"
  select h.crew_id into hq from public.ev_hq h;
  if hq is null then
    hq := pg_temp.mkroom(Q, 'XF Pretend HQ', 'open');
    insert into public.ev_hq (crew_id) values (hq);
  else
    insert into public.crew_members (crew_id, user_id, role) values (hq, Q, 'owner') on conflict (crew_id, user_id) do update set role = 'owner';
  end if;
  r11 := pg_temp.mkroom(L, 'XF Room Eleven', 'invite'); o11 := pg_temp.mkorg('XF Org Eleven', r11);
  perform pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o11, 'hqowner@xf.test', pg_temp.h('tok-hq')));
  r := pg_temp.j(Q, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-hq')));
  perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'already_owned_other')::boolean = false, 'owning Lagos HQ is not another room');
end $$;

-- ===================================================================== 5. a handover by an owner ========
do $$
declare
  H uuid := pg_temp.newuser('XF Hannah', 'hannah@xf.test');
  M uuid := pg_temp.newuser('XF Member', 'member@xf.test');
  Ad uuid := pg_temp.newuser('XF Admin', 'admin@xf.test');
  N uuid := pg_temp.newuser('XF Nina', 'nina@xf.test');
  S uuid := pg_temp.newuser('XF Staff', 'staff@xf.test');
  Rnd uuid := pg_temp.newuser('XF Random', 'random@xf.test');
  rm uuid; e_up uuid; e_other uuid; e_past uuid; r jsonb; t uuid; t2 uuid; rm2 uuid; t3 uuid; Z uuid := pg_temp.newuser('XF Zed', 'zed@xf.test');
begin
  rm := pg_temp.mkroom(H, 'XF Hannahs Room', 'invite');
  insert into public.crew_members (crew_id, user_id, role) values (rm, M, 'member'), (rm, Ad, 'admin');
  e_up := pg_temp.mkev(H, rm, null, 'XF Hannah up', now() + interval '2 days', null, 'hoppaz');
  e_past := pg_temp.mkev(H, rm, null, 'XF Hannah past', now() - interval '5 days', null, 'hoppaz');
  e_other := pg_temp.mkev(H, null, null, 'XF Hannah no room', now() + interval '2 days', null, 'hoppaz');
  update public.profiles set is_admin = true where id = S;

  perform pg_temp.ok(pg_temp.j(M, format('select public.ev_transfer_create_owner(%L, %L, %L)', rm, 'nina@xf.test', pg_temp.h('tok-h0'))) ->> 'reason' = 'not_allowed', 'a member cannot start a handover');
  perform pg_temp.ok(pg_temp.j(Ad, format('select public.ev_transfer_create_owner(%L, %L, %L)', rm, 'nina@xf.test', pg_temp.h('tok-h0'))) ->> 'reason' = 'not_allowed', 'an admin cannot start a handover');
  perform pg_temp.ok(pg_temp.j(Rnd, format('select public.ev_transfer_create_owner(%L, %L, %L)', rm, 'nina@xf.test', pg_temp.h('tok-h0'))) ->> 'reason' = 'not_allowed', 'a stranger cannot start a handover');
  perform pg_temp.ok(pg_temp.j(H, format('select public.ev_transfer_create_owner(%L, %L, %L)', rm, 'hannah@xf.test', pg_temp.h('tok-h0'))) ->> 'reason' = 'bad_email', 'not to yourself');
  perform pg_temp.ok(pg_temp.j(H, format('select public.ev_transfer_create_owner(%L, %L, %L)', rm, 'nope', pg_temp.h('tok-h0'))) ->> 'reason' = 'bad_email', 'a bad email');
  perform pg_temp.ok(pg_temp.j(H, format('select public.ev_transfer_create_owner(%L, %L, %L)', rm, 'nina@xf.test', 'xx')) ->> 'reason' = 'invalid_link', 'a bad hash');
  r := pg_temp.j(H, format('select public.ev_transfer_create_owner(%L, %L, %L)', rm, ' Nina@XF.test', pg_temp.h('tok-h1')));
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'transfer' ->> 'kind' = 'handover' and r -> 'transfer' ->> 'to_email' = 'nina@xf.test'
                     and (select from_user from public.ev_transfers where token_hash = pg_temp.h('tok-h1')) = H, 'the owner starts a handover');
  t := (r -> 'transfer' ->> 'id')::uuid;
  perform pg_temp.ok(pg_temp.j(H, format('select public.ev_transfer_create_owner(%L, %L, %L)', rm, 'nina@xf.test', pg_temp.h('tok-h2'))) ->> 'reason' = 'already_pending', 'the same person twice: already_pending');

  r := pg_temp.j(H, format('select public.ev_transfers_for_room(%L)', rm));
  perform pg_temp.ok(jsonb_typeof(r) = 'array' and jsonb_array_length(r) = 1 and not (r::text like '%token%'), 'the owner lists the links of the room');
  perform pg_temp.ok(jsonb_typeof(pg_temp.j(S, format('select public.ev_transfers_for_room(%L)', rm))) = 'array', 'staff can list them too');
  perform pg_temp.ok(pg_temp.j(M, format('select public.ev_transfers_for_room(%L)', rm)) ->> 'reason' = 'not_allowed', 'a member cannot');
  perform pg_temp.ok(pg_temp.j(Ad, format('select public.ev_transfers_for_room(%L)', rm)) ->> 'reason' = 'not_allowed', 'an admin cannot');

  -- the preview for a handover
  r := pg_temp.an(format('select public.ev_transfer_preview(%L)', pg_temp.h('tok-h1')));
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'kind' = 'handover' and r ->> 'email_hint' = 'n***@xf.test' and jsonb_array_length(r -> 'events') = 1, 'the handover preview shows the one event that moves');

  -- revoke by the owner
  rm2 := pg_temp.mkroom(H, 'XF Hannahs Second', 'invite');
  t2 := (pg_temp.j(H, format('select public.ev_transfer_create_owner(%L, %L, %L)', rm2, 'zed@xf.test', pg_temp.h('tok-h3'))) -> 'transfer' ->> 'id')::uuid;
  perform pg_temp.ok(pg_temp.j(Rnd, format('select public.ev_transfer_revoke_owner(%L)', t2)) ->> 'reason' = 'not_allowed', 'a stranger cannot revoke it');
  r := pg_temp.j(H, format('select public.ev_transfer_revoke_owner(%L)', t2));
  perform pg_temp.ok((r ->> 'ok')::boolean and (select status from public.ev_transfers where id = t2) = 'revoked', 'the owner revokes a link');
  perform pg_temp.ok(pg_temp.j(Z, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-h3'))) ->> 'reason' = 'link_revoked', 'and it no longer works');

  -- accept: the previous owner becomes a plain member, the join mode is left alone (it was not a Listings room)
  r := pg_temp.j(N, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-h1')));
  perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'moved_events')::int = 1 and (r ->> 'already_owned_other')::boolean = false, 'the handover is accepted, one event moved');
  perform pg_temp.ok((select role from public.crew_members where crew_id = rm and user_id = N) = 'owner', 'Nina is the owner');
  perform pg_temp.ok((select role from public.crew_members where crew_id = rm and user_id = H) = 'member', 'Hannah is now a plain member');
  perform pg_temp.ok((select role from public.crew_members where crew_id = rm and user_id = Ad) = 'admin' and (select role from public.crew_members where crew_id = rm and user_id = M) = 'member', 'the others keep their roles');
  perform pg_temp.ok((select created_by from public.crews where id = rm) = N, 'created_by follows');
  perform pg_temp.ok((select host_id from public.events where id = e_up) = N and (select host_id from public.events where id = e_past) = H and (select host_id from public.events where id = e_other) = H, 'only the upcoming event of the room moved');
  perform pg_temp.ok((select join_mode from public.ev_room_profiles where crew_id = rm) = 'invite', 'the join mode did not change');
  perform pg_temp.ok(pg_temp.j(N, format('select public.ev_transfer_revoke_owner(%L)', t)) ->> 'reason' = 'link_used', 'an accepted link cannot be revoked');
  perform pg_temp.ok(pg_temp.j(H, format('select public.ev_transfer_create_owner(%L, %L, %L)', rm, 'zed@xf.test', pg_temp.h('tok-h4'))) ->> 'reason' = 'not_allowed', 'Hannah is no longer an owner: she cannot start another');

  -- a handover is only good while its maker still owns the room
  t3 := (pg_temp.j(N, format('select public.ev_transfer_create_owner(%L, %L, %L)', rm, 'zed@xf.test', pg_temp.h('tok-h5'))) -> 'transfer' ->> 'id')::uuid;
  update public.crew_members set role = 'member' where crew_id = rm and user_id = N;
  perform pg_temp.ok(pg_temp.j(Z, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-h5'))) ->> 'reason' = 'link_revoked', 'a stale handover (the maker lost ownership): link_revoked');
  perform pg_temp.ok((select role from public.crew_members where crew_id = rm and user_id = N) = 'member' and not exists (select 1 from public.crew_members where crew_id = rm and user_id = Z), 'and nothing moved');
end $$;

-- ===================================================================== 6. the claim request ========
do $$
declare
  L uuid := public._ev_listings_uid();
  U uuid := pg_temp.newuser('XF Asker', 'asker@xf.test');
  rr uuid; oo uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; e_h uuid; e_inv uuid; r jsonb; r_match jsonb; i integer;
begin
  rr := pg_temp.mkroom(L, 'XF Room Claimreq', 'invite'); oo := pg_temp.mkorg('XF Org Claimreq', rr);
  update public.ev_organisers set email = 'owner@real.test' where id = oo;
  e1 := pg_temp.mkev(L, rr, oo, 'XF cr one', now() + interval '2 days');
  e2 := pg_temp.mkev(L, rr, oo, 'XF cr two', now() + interval '3 days');
  e3 := pg_temp.mkev(L, rr, oo, 'XF cr three', now() + interval '4 days');
  e4 := pg_temp.mkev(L, rr, oo, 'XF cr four', now() + interval '5 days');
  e_h := pg_temp.mkev(L, rr, oo, 'XF cr hoppaz', now() + interval '5 days', null, 'hoppaz');
  e_inv := pg_temp.mkev(L, rr, oo, 'XF cr invite only', now() + interval '5 days');
  update public.events set visibility = 'invite' where id = e_inv;

  r := pg_temp.an(format('select public.ev_claim_request(%L, %L, %L, %L, %L)', e1, ' Jide ', ' Jide@Real.TEST ', '0801', 'it is mine'));
  perform pg_temp.ok(r = '{"ok": true}'::jsonb, 'a visitor with no account can ask; the answer is just ok');
  perform pg_temp.ok((select count(*) from public.ev_claim_requests where event_id = e1) = 1
                     and (select email from public.ev_claim_requests where event_id = e1) = 'jide@real.test'
                     and (select name from public.ev_claim_requests where event_id = e1) = 'Jide'
                     and (select organiser_id from public.ev_claim_requests where event_id = e1) = oo
                     and (select status from public.ev_claim_requests where event_id = e1) = 'new', 'one row, email lower-cased, tied to the organiser');
  perform pg_temp.ok((select count(*) from public.ev_organiser_log where organiser_id = oo and kind = 'claim_request') = 1, 'a claim_request line on the organiser');
  r := pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e1, 'Jide', 'JIDE@real.test'));
  perform pg_temp.ok(r = '{"ok": true}'::jsonb and (select count(*) from public.ev_claim_requests where event_id = e1) = 1, 'a repeat is ok and not a second row');
  perform pg_temp.ok((select count(*) from public.ev_organiser_log where organiser_id = oo and kind = 'claim_request') = 1, 'and not a second log line');
  -- the answer is the same whether or not the email is the organiser's
  r_match := pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e2, 'Jide', 'owner@real.test'));
  r := pg_temp.j(U, format('select public.ev_claim_request(%L, %L, %L)', e2, 'Asker', 'asker@xf.test'));
  perform pg_temp.ok(r_match = r and r = '{"ok": true}'::jsonb, 'the answer never says whether the email matches anything');
  perform pg_temp.ok((select user_id from public.ev_claim_requests where event_id = e2 and email = 'asker@xf.test') = U and (select user_id from public.ev_claim_requests where event_id = e2 and email = 'owner@real.test') is null, 'a signed in asker is recorded, a visitor is not');

  -- 3 per email per day
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e2, 'Jide', 'jide@real.test')) ->> 'ok' = 'true', 'second event, same email: ok');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e3, 'Jide', 'jide@real.test')) ->> 'ok' = 'true', 'third event, same email: ok');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e4, 'Jide', 'jide@real.test')) ->> 'reason' = 'try_again_later', 'the fourth in a day: try_again_later');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e1, 'Jide', 'jide@real.test')) ->> 'ok' = 'true', 'but a repeat of an open one is still ok');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e4, 'Other', 'someone.else@real.test')) ->> 'ok' = 'true', 'another email is not limited');
  update public.ev_claim_requests set created_at = now() - interval '2 days' where email = 'jide@real.test';
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e4, 'Jide', 'jide@real.test')) ->> 'ok' = 'true', 'a day later the email can ask again');

  -- 300 a day overall
  insert into public.ev_claim_requests (event_id, name, email, status, created_at)
  select e1, 'Bulk', 'bulk' || g || '@xf.test', 'handled', now() from generate_series(1, 300) g;
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e3, 'Fresh', 'fresh@xf.test')) ->> 'reason' = 'try_again_later', '300 in a day: try_again_later for anyone');
  update public.ev_claim_requests set created_at = now() - interval '2 days' where name = 'Bulk';
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e3, 'Fresh', 'fresh@xf.test')) ->> 'ok' = 'true', 'and the next day it works again');

  -- checks
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e1, '', 'x@xf.test')) ->> 'reason' = 'bad_name', 'an empty name');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e1, repeat('n', 81), 'x@xf.test')) ->> 'reason' = 'bad_name', 'a name over 80');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e1, 'X', 'not an email')) ->> 'reason' = 'bad_email', 'a bad email');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L, %L)', e1, 'X', 'x@xf.test', repeat('1', 41))) ->> 'reason' = 'bad_phone', 'a long phone');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L, %L, %L)', e1, 'X', 'x@xf.test', null, repeat('n', 501))) ->> 'reason' = 'bad_note', 'a long note');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e_h, 'X', 'x@xf.test')) ->> 'reason' = 'not_found', 'a Hoppaz event: not_found');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e_inv, 'X', 'x@xf.test')) ->> 'reason' = 'not_found', 'an invite only listing: not_found');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', gen_random_uuid(), 'X', 'x@xf.test')) ->> 'reason' = 'not_found', 'no such event: not_found');
  perform public.ev_set_setting('events_r1', 'off');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_request(%L, %L, %L)', e1, 'X', 'x2@xf.test')) ->> 'reason' = 'not_open', 'switch off: not_open');
  perform pg_temp.ok(pg_temp.j(U, format('select public.ev_transfer_accept(%L)', pg_temp.h('x'))) ->> 'reason' = 'not_open', 'accept: not_open');
  perform pg_temp.ok(pg_temp.j(U, format('select public.ev_transfer_create_owner(%L, %L, %L)', rr, 'x@xf.test', pg_temp.h('x'))) ->> 'reason' = 'not_open', 'create_owner: not_open');
  perform pg_temp.ok(pg_temp.j(U, format('select public.ev_listing_use_hoppaz(%L)', e1)) ->> 'reason' = 'not_open', 'use_hoppaz: not_open');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_transfer_preview(%L)', pg_temp.h('x'))) ->> 'reason' = 'not_found', 'preview is a read and still answers');
  perform public.ev_set_setting('events_r1', 'on');
end $$;

-- ===================================================================== 7. switching to Hoppaz tickets ========
do $$
declare
  L uuid := public._ev_listings_uid();
  A uuid := pg_temp.newuser('XF Host Ada', 'ada@xf.test');
  Ad uuid := pg_temp.newuser('XF Room Admin', 'radmin@xf.test');
  Mb uuid := pg_temp.newuser('XF Room Member', 'rmember@xf.test');
  Rnd uuid := pg_temp.newuser('XF Stranger', 'stranger@xf.test');
  S uuid := pg_temp.newuser('XF Staff2', 'staff2@xf.test');
  G uuid := pg_temp.newuser('XF Guest', 'guest@xf.test');
  rm uuid; o uuid; e_un uuid; e1 uuid; e2 uuid; r jsonb; ok_before boolean := false; msg text; v_price integer;
begin
  update public.profiles set is_admin = true where id = S;
  -- an unclaimed listing
  rm := pg_temp.mkroom(L, 'XF Room Hoppaz', 'invite'); o := pg_temp.mkorg('XF Org Hoppaz', rm);
  e_un := pg_temp.mkev(L, rm, o, 'XF unclaimed', now() + interval '2 days');
  insert into public.ev_ticket_types (event_id, name, price_naira) values (e_un, 'Regular', 0);
  perform pg_temp.ok(pg_temp.j(S, format('select public.ev_listing_use_hoppaz(%L)', e_un)) ->> 'reason' = 'not_claimed', 'staff on an unclaimed listing: not_claimed');
  perform pg_temp.ok(pg_temp.j(Rnd, format('select public.ev_listing_use_hoppaz(%L)', e_un)) ->> 'reason' = 'not_allowed', 'a stranger: not_allowed');
  perform pg_temp.ok(pg_temp.j(Rnd, format('select public.ev_listing_use_hoppaz(%L)', gen_random_uuid())) ->> 'reason' = 'not_found', 'no such event: not_found');
  perform pg_temp.ok((select ticket_mode from public.events where id = e_un) = 'external', 'still a listing');

  -- the claim
  perform pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o, 'ada@xf.test', pg_temp.h('tok-ada')));
  e1 := pg_temp.mkev(L, rm, o, 'XF claimed one', now() + interval '3 days');
  e2 := pg_temp.mkev(L, rm, o, 'XF claimed two', now() + interval '4 days');
  r := pg_temp.j(A, format('select public.ev_transfer_accept(%L)', pg_temp.h('tok-ada')));
  perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'moved_events')::int = 3, 'Ada claims the room');
  insert into public.crew_members (crew_id, user_id, role) values (rm, Ad, 'admin'), (rm, Mb, 'member');
  perform pg_temp.ok((select ticket_mode from public.events where id = e1) = 'external', 'a claimed listing still sells on the organiser''s page');

  -- before the switch nobody can register
  begin
    r := pg_temp.j(G, format('select public.ev_register(%L)', e1));
    ok_before := coalesce((r ->> 'ok')::boolean, false);
  exception when others then
    msg := sqlerrm; ok_before := false;
  end;
  perform pg_temp.admin();
  perform pg_temp.ok(ok_before = false and not exists (select 1 from public.ev_registrations where event_id = e1), 'before the switch, registering is refused');

  -- no ticket rows yet
  perform pg_temp.ok(pg_temp.j(A, format('select public.ev_listing_use_hoppaz(%L)', e1)) ->> 'reason' = 'set_tickets_first', 'no ticket type rows: set_tickets_first');
  perform pg_temp.ok((select ticket_mode from public.events where id = e1) = 'external', 'nothing flipped');
  insert into public.ev_ticket_types (event_id, name, price_naira) values (e1, 'Early bird', 0), (e2, 'Regular', 0);

  perform pg_temp.ok(pg_temp.j(Rnd, format('select public.ev_listing_use_hoppaz(%L)', e1)) ->> 'reason' = 'not_allowed', 'a stranger still cannot');
  perform pg_temp.ok(pg_temp.j(Mb, format('select public.ev_listing_use_hoppaz(%L)', e1)) ->> 'reason' = 'not_allowed', 'a plain room member cannot');
  perform pg_temp.ok((select ticket_mode from public.events where id = e1) = 'external', 'still a listing');
  update public.events set listed_price = 7500, listed_price_max = 12000 where id = e1;
  r := pg_temp.j(A, format('select public.ev_listing_use_hoppaz(%L)', e1));
  perform pg_temp.ok((r ->> 'ok')::boolean and (select ticket_mode from public.events where id = e1) = 'hoppaz', 'the host switches to Hoppaz tickets');
  perform pg_temp.ok((select listed_price from public.events where id = e1) = 7500 and (select ticket_url from public.events where id = e1) is not null
                     and (select host_id from public.events where id = e1) = A, 'and nothing else was cleared');
  perform pg_temp.ok((pg_temp.j(A, format('select public.ev_listing_use_hoppaz(%L)', e1)) ->> 'ok')::boolean, 'a second call is fine');

  -- now registering works
  r := pg_temp.j(G, format('select public.ev_register(%L)', e1));
  perform pg_temp.ok((r ->> 'ok')::boolean and exists (select 1 from public.ev_registrations where event_id = e1 and user_id = G), 'after the switch a guest registers for the free type');

  -- a room admin and staff can switch too
  r := pg_temp.j(Ad, format('select public.ev_listing_use_hoppaz(%L)', e2));
  perform pg_temp.ok((r ->> 'ok')::boolean and (select ticket_mode from public.events where id = e2) = 'hoppaz', 'a room admin can switch');
  update public.events set ticket_mode = 'external' where id = e2;
  perform pg_temp.ok((pg_temp.j(S, format('select public.ev_listing_use_hoppaz(%L)', e2)) ->> 'ok')::boolean, 'staff can switch');
  -- the room's first listing moved to Ada with the room, and now she can switch it
  perform pg_temp.ok((select host_id from public.events where id = e_un) = A, 'the unclaimed listing of the room became Ada''s with the claim');
  r := pg_temp.j(A, format('select public.ev_listing_use_hoppaz(%L)', e_un));
  perform pg_temp.ok((r ->> 'ok')::boolean and (select ticket_mode from public.events where id = e_un) = 'hoppaz', 'and she can switch it too');
end $$;

-- ===================================================================== 8. grants ========
do $$
declare f text;
begin
  foreach f in array array['public.ev_o_transfer_create(uuid, text, text, integer, text)', 'public.ev_o_transfer_revoke(uuid, text)'] loop
    perform pg_temp.ok(has_function_privilege('service_role', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), f || ': service role only');
  end loop;
  foreach f in array array['public.ev_claim_request(uuid, text, text, text, text)', 'public.ev_transfer_preview(text)'] loop
    perform pg_temp.ok(has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'), f || ': anon and authenticated');
  end loop;
  foreach f in array array['public.ev_transfer_accept(text)', 'public.ev_transfer_create_owner(uuid, text, text)', 'public.ev_transfers_for_room(uuid)',
                           'public.ev_transfer_revoke_owner(uuid)', 'public.ev_listing_use_hoppaz(uuid)'] loop
    perform pg_temp.ok(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), f || ': authenticated only');
  end loop;
  foreach f in array array['public._ev_xf_by(text)', 'public._ev_xf_my_email()', 'public._ev_xf_log(uuid, text, text)', 'public._ev_xf_owner(uuid)', 'public._ev_xf_moving(uuid, uuid)'] loop
    perform pg_temp.ok(not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'), f || ': helper is closed');
  end loop;
  -- a signed in person calling a staff function is refused by the database
  begin
    perform pg_temp.j(gen_random_uuid(), format('select public.ev_o_transfer_create(%L, %L, %L)', gen_random_uuid(), 'x@xf.test', pg_temp.h('g')));
    perform pg_temp.ok(false, 'authenticated must not run ev_o_transfer_create');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a signed in person calling ev_o_transfer_create: permission denied');
  end;
  perform pg_temp.admin();
  -- the closed tables stay closed
  perform pg_temp.ok(not has_table_privilege('anon', 'public.ev_transfers', 'select') and not has_table_privilege('authenticated', 'public.ev_transfers', 'select')
                     and not has_table_privilege('authenticated', 'public.ev_claim_requests', 'select'), 'ev_transfers and ev_claim_requests are closed to the app');
end $$;

-- ===================================================================== 9. with the outreach file ========
do $$
declare
  L uuid := public._ev_listings_uid();
  o uuid; r jsonb; v_room uuid;
begin
  if to_regprocedure('public.ev_o_ensure_room(uuid)') is null then
    raise notice 'SKIPPED: events_r1_outreach.sql is not loaded, so ev_o_ensure_room was not tested here';
    return;
  end if;
  o := pg_temp.mkorg('XF Org Roomless', null);
  r := pg_temp.s(format('select public.ev_o_transfer_create(%L, %L, %L)', o, 'roomless@xf.test', pg_temp.h('tok-roomless')));
  perform pg_temp.ok((r ->> 'ok')::boolean, 'an organiser with no room gets one when the link is made');
  v_room := (select room_id from public.ev_organisers where id = o);
  perform pg_temp.ok(v_room is not null and (r -> 'transfer' ->> 'room_id')::uuid = v_room, 'the link points at that room');
  perform pg_temp.ok(L is not null, 'the Listings account is still set');
end $$;

do $$ begin raise notice 'ALL EVENTS R1 TRANSFER TESTS PASSED'; end $$;
rollback;
