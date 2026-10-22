-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Release 1 registrations (supabase/events_r1_registrations.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, events_r1_events.sql and events_r1_registrations.sql loaded.
-- Ends with ALL EVENTS R1 REGISTRATIONS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_registrations_test.sql
--
-- What a single transaction cannot show: two people registering for the last place at the same instant. The protection is the
-- row lock on the event (select ... for update) at the top of ev_register, ev_cancel_registration, ev_decide and ev_promote, plus the
-- unique (event_id, user_id). To see it with real sessions, run two psql sessions that each call ev_register for the last place of
-- the same event with a begin; and no commit, and watch the second one wait.
begin;
-- Release 1 is switched on for the test (rolled back with everything else). The "off" cases switch it off again inside the test.
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
          case when guest then null else 'reg-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
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
-- A live event made straight in the table (as the service role would).
create function pg_temp.ev(host uuid, ttl text, cap int default null, appr boolean default false, wl boolean default false,
                           starts timestamptz default now() + interval '2 days') returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id, capacity, requires_approval, waitlist_on)
  values (ttl, 'Somewhere', starts, 'live', host, cap, appr, wl) returning id;
$$;
create function pg_temp.ty(ev uuid, nm text, price int default 0, cap int default null, srt int default 0) returns uuid language sql as $$
  insert into public.ev_ticket_types (event_id, name, price_naira, capacity, sort) values (ev, nm, price, cap, srt) returning id;
$$;
create function pg_temp.regt(u uuid, ev uuid, ty uuid) returns jsonb language plpgsql as $$
begin
  return pg_temp.reg(u, ev, json_build_object('ticketTypeId', ty)::jsonb);
end $$;
create function pg_temp.tname(ev uuid, u uuid) returns text language sql as $$
  select t.name from public.ev_registrations r join public.ev_ticket_types t on t.id = r.ticket_type_id where r.event_id = ev and r.user_id = u;
$$;
create function pg_temp.reg(u uuid, ev uuid, opts jsonb default '{}') returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_register(%L, %L::jsonb)', ev, opts::text));
end $$;
create function pg_temp.cancel(u uuid, ev uuid) returns text language plpgsql as $$
begin
  return pg_temp.t(u, format('select public.ev_cancel_registration(%L)', ev));
end $$;
create function pg_temp.decide(u uuid, rid uuid, act text) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_decide(%L, %L)', rid, act));
end $$;
create function pg_temp.st(ev uuid, u uuid) returns text language sql as $$
  select status from public.ev_registrations where event_id = ev and user_id = u;
$$;
create function pg_temp.pos(ev uuid, u uuid) returns int language sql as $$
  select waitlist_pos from public.ev_registrations where event_id = ev and user_id = u;
$$;
create function pg_temp.rid(ev uuid, u uuid) returns uuid language sql as $$
  select id from public.ev_registrations where event_id = ev and user_id = u;
$$;
create function pg_temp.vs(u uuid, ev uuid) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_viewer_state(%L)', ev));
end $$;

do $$
declare
  h uuid := pg_temp.newuser('Reg Host'); a uuid := pg_temp.newuser('Reg Ada'); b uuid := pg_temp.newuser('Reg Bola');
  c uuid := pg_temp.newuser('Reg Chike'); d uuid := pg_temp.newuser('Reg Dayo'); x uuid := pg_temp.newuser('Reg Stranger');
  g uuid := pg_temp.newuser('Reg Guest', true); room uuid := gen_random_uuid();
  ta uuid; tb uuid; tc uuid; tt1 jsonb; tv uuid; et1 uuid; et2 uuid; et3 uuid; et4 uuid; et5 uuid; et6 uuid; ey uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; e7 uuid; e8 uuid; eo uuid; ex uuid; e9 uuid; clone_id uuid;
  r jsonb; n int; rows jsonb; f record;
begin
  -- Closed tables.
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ev_registrations', 'select') and not has_table_privilege('anon', 'public.ev_registrations', 'select')
                     and not has_table_privilege('authenticated', 'public.ev_registration_settings', 'select'), 'the registration tables are closed to anon and authenticated');

  -- Basic register.
  e1 := pg_temp.ev(h, 'Free for all');
  r := pg_temp.reg(a, e1);
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'registration' ->> 'status' = 'going' and r -> 'registration' ->> 'email' like '%@evtest.invalid'
                     and r -> 'registration' ->> 'name' = 'Reg Ada', 'a free event with no approval: going, with the name and email from the account');
  r := pg_temp.reg(a, e1);
  perform pg_temp.ok((r ->> 'ok')::boolean and (select count(*) from public.ev_registrations where event_id = e1 and user_id = a) = 1, 'registering twice is still one registration');
  perform pg_temp.ok(pg_temp.reg(g, e1) ->> 'reason' = 'need_account', 'a guest with no account cannot register');
  perform pg_temp.ok(pg_temp.reg(a, gen_random_uuid()) ->> 'reason' = 'not_found', 'an event that does not exist is not_found');
  begin
    perform pg_temp.anon();
    perform public.ev_register(e1, '{}');
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not call ev_register');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot call ev_register');
  end;
  begin
    insert into public.ev_registrations (event_id, user_id, status) values (e1, a, 'going');
    perform pg_temp.ok(false, 'a second row for the same person must be refused');
  exception when unique_violation then
    perform pg_temp.ok(true, 'the table itself allows one registration per person per event');
  end;

  -- Capacity, no waitlist.
  e2 := pg_temp.ev(h, 'Two places', 2);
  perform pg_temp.reg(a, e2); perform pg_temp.reg(b, e2);
  perform pg_temp.ok(pg_temp.reg(c, e2) ->> 'reason' = 'full', 'the third person gets full when there is no waitlist');
  perform pg_temp.ok(pg_temp.cancel(a, e2) = 'ok', 'a cancel answers ok');
  perform pg_temp.ok(pg_temp.st(e2, a) = 'cancelled', 'and the registration is cancelled');
  perform pg_temp.ok(pg_temp.reg(c, e2) -> 'registration' ->> 'status' = 'going', 'and frees a place');
  perform pg_temp.ok(pg_temp.cancel(a, e2) = 'ok', 'cancelling twice is ok');
  perform pg_temp.ok(pg_temp.cancel(x, e2) = 'not_registered', 'a person who never registered is not_registered');

  -- The waitlist and the automatic promotion.
  e3 := pg_temp.ev(h, 'One place', 1, false, true);
  perform pg_temp.reg(a, e3); perform pg_temp.reg(b, e3); perform pg_temp.reg(c, e3);
  perform pg_temp.ok(pg_temp.st(e3, a) = 'going' and pg_temp.st(e3, b) = 'waitlisted' and pg_temp.pos(e3, b) = 1 and pg_temp.pos(e3, c) = 2, 'full with a waitlist: waitlisted in order, 1 and 2');
  perform pg_temp.ok(pg_temp.cancel(a, e3) = 'ok', 'the person with the place cancels');
  perform pg_temp.ok(pg_temp.st(e3, b) = 'going' and pg_temp.pos(e3, b) is null and pg_temp.st(e3, c) = 'waitlisted' and pg_temp.pos(e3, c) = 1,
                     'the next waitlisted person is promoted in the same transaction and the rest move up');
  perform pg_temp.reg(d, e3);
  perform pg_temp.ok(pg_temp.st(e3, d) = 'waitlisted' and pg_temp.pos(e3, d) = 2, 'a new person joins the back');
  perform pg_temp.cancel(c, e3);
  perform pg_temp.ok(pg_temp.pos(e3, d) = 1 and pg_temp.pos(e3, c) is null, 'someone leaving the waitlist moves the others up');
  perform pg_temp.reg(a, e3);
  perform pg_temp.ok(pg_temp.st(e3, a) = 'waitlisted' and pg_temp.pos(e3, a) = 2, 'a person who cancelled and comes back goes to the back');
  perform pg_temp.ok((select count(*) from public.ev_registrations where event_id = e3 and status in ('going', 'checked_in')) = 1, 'never more going than the capacity');

  -- Approval.
  e4 := pg_temp.ev(h, 'Approval needed', null, true);
  perform pg_temp.ok(pg_temp.reg(a, e4) -> 'registration' ->> 'status' = 'requested', 'approval on: requested');
  perform pg_temp.reg(b, e4);
  perform pg_temp.ok(pg_temp.decide(x, pg_temp.rid(e4, a), 'approve') ->> 'reason' = 'not_allowed', 'a stranger cannot approve');
  perform pg_temp.ok(pg_temp.decide(h, pg_temp.rid(e4, a), 'maybe') ->> 'reason' = 'bad_action', 'an unknown action is refused');
  r := pg_temp.decide(h, pg_temp.rid(e4, a), 'approve');
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'registration' ->> 'status' = 'going', 'the host approves: going');
  perform pg_temp.ok(pg_temp.decide(h, pg_temp.rid(e4, a), 'approve') ->> 'reason' = 'nothing_to_approve', 'approving someone who is already in does nothing');
  r := pg_temp.decide(h, pg_temp.rid(e4, b), 'decline');
  perform pg_temp.ok((r ->> 'ok')::boolean and pg_temp.st(e4, b) = 'declined', 'the host declines');
  perform pg_temp.ok(pg_temp.reg(b, e4) ->> 'reason' = 'declined', 'a declined person cannot register again');
  perform pg_temp.ok(pg_temp.decide(h, gen_random_uuid(), 'approve') ->> 'reason' = 'not_found', 'an unknown registration is not_found');
  r := pg_temp.decide(h, pg_temp.rid(e4, a), 'decline');
  perform pg_temp.ok((r ->> 'ok')::boolean and pg_temp.st(e4, a) = 'declined', 'the host can also decline someone who was going');

  -- Approval with a capacity: the yes of the host cannot overfill, and the waitlist feeds the host's queue.
  e5 := pg_temp.ev(h, 'Approval and one place', 1, true, true);
  perform pg_temp.reg(a, e5); perform pg_temp.reg(b, e5);
  perform pg_temp.ok(pg_temp.st(e5, a) = 'requested' and pg_temp.st(e5, b) = 'requested', 'waiting for approval does not use a place: both are requested');
  perform pg_temp.decide(h, pg_temp.rid(e5, a), 'approve');
  perform pg_temp.decide(h, pg_temp.rid(e5, b), 'approve');
  perform pg_temp.ok(pg_temp.st(e5, a) = 'going' and pg_temp.st(e5, b) = 'waitlisted' and pg_temp.pos(e5, b) = 1, 'approving past the capacity puts the person on the waitlist');
  perform pg_temp.reg(c, e5);
  perform pg_temp.ok(pg_temp.st(e5, c) = 'waitlisted' and pg_temp.pos(e5, c) = 2, 'a new person joins the waitlist behind');
  perform pg_temp.cancel(a, e5);
  perform pg_temp.ok(pg_temp.st(e5, b) = 'requested' and pg_temp.st(e5, c) = 'waitlisted' and pg_temp.pos(e5, c) = 1,
                     'with approval on, a free place moves only the next waitlisted person to requested: the host still decides');

  -- Promote and a bigger capacity.
  e6 := pg_temp.ev(h, 'Promote me', 1, false, true);
  perform pg_temp.reg(a, e6); perform pg_temp.reg(b, e6);
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_promote(%L)', pg_temp.rid(e6, b))) ->> 'reason' = 'no_free_place', 'promote when full is no_free_place');
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_promote(%L)', pg_temp.rid(e6, a))) ->> 'reason' = 'not_waitlisted', 'promote someone who is not waitlisted is refused');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_promote(%L)', pg_temp.rid(e6, b))) ->> 'reason' = 'not_allowed', 'a stranger cannot promote');
  r := pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', e6, '{"capacity":2}'));
  perform pg_temp.ok((r ->> 'ok')::boolean and pg_temp.st(e6, b) = 'going', 'raising the capacity promotes the waitlist by itself');
  perform pg_temp.reg(c, e6);
  update public.events set capacity = 5 where id = e6;
  perform pg_temp.ok(pg_temp.st(e6, c) = 'waitlisted', 'a capacity changed straight in the table does not move anyone');
  r := pg_temp.j(h, format('select public.ev_promote(%L)', pg_temp.rid(e6, c)));
  perform pg_temp.ok((r ->> 'ok')::boolean and pg_temp.st(e6, c) = 'going' and pg_temp.pos(e6, c) is null, 'the host promotes someone now');

  -- Checked in people keep their place.
  e7 := pg_temp.ev(h, 'Door', 1);
  perform pg_temp.reg(a, e7);
  update public.ev_registrations set status = 'checked_in', checked_in_at = now() where event_id = e7 and user_id = a;
  perform pg_temp.ok(pg_temp.reg(b, e7) ->> 'reason' = 'full', 'a checked-in person still uses a place');
  perform pg_temp.ok(pg_temp.cancel(a, e7) = 'already_checked_in', 'a checked-in person cannot cancel');
  perform pg_temp.ok(pg_temp.decide(h, pg_temp.rid(e7, a), 'decline') ->> 'reason' = 'already_checked_in', 'and cannot be declined');

  -- Audience and export.
  perform pg_temp.reg(b, e1, json_build_object('referrerId', a)::jsonb);
  r := pg_temp.j(h, format('select public.ev_audience(%L)', e1));
  perform pg_temp.ok((r ->> 'ok')::boolean and (r -> 'counts' ->> 'going')::int = 2 and jsonb_array_length(r -> 'registrations') = 2, 'the host sees the counts and the rows');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r -> 'registrations') q where q ->> 'name' = 'Reg Bola' and q ->> 'referrer_name' = 'Reg Ada' and q ->> 'email' like '%@evtest.invalid'),
                     'with name, email and who invited them');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_audience(%L)', e1)) ->> 'reason' = 'not_allowed', 'a stranger cannot see the audience');
  perform pg_temp.ok(pg_temp.j(a, format('select public.ev_audience(%L)', e1)) ->> 'reason' = 'not_allowed', 'a guest of the event cannot either');
  r := pg_temp.j(h, format('select public.ev_audience(%L)', e5));
  perform pg_temp.ok((r -> 'counts' ->> 'pending')::int = 1 and (r -> 'counts' ->> 'waitlist')::int = 1 and (r -> 'counts' ->> 'going')::int = 0 and jsonb_array_length(r -> 'registrations') = 2,
                     'pending and waitlist counts; cancelled people are left out of the rows');
  perform pg_temp.reg(c, e1, json_build_object('referrerId', c)::jsonb);
  perform pg_temp.ok((select referrer_id from public.ev_registrations where event_id = e1 and user_id = c) is null, 'inviting yourself does nothing');
  perform pg_temp.reg(d, e1, '{"referrerId":"not-a-uuid"}');
  perform pg_temp.ok(pg_temp.st(e1, d) = 'going', 'a bad referrer is ignored, the registration still works');
  perform pg_temp.actor(h);
  select count(*) into n from public.ev_export(e1);
  perform pg_temp.admin();
  perform pg_temp.ok(n = 4, 'the host exports every row');
  perform pg_temp.actor(x);
  select count(*) into n from public.ev_export(e1);
  perform pg_temp.admin();
  perform pg_temp.ok(n = 0, 'a stranger exports nothing');
  perform pg_temp.actor(h);
  select count(*) into n from public.ev_export(e1) where invited_by = 'Reg Ada' and name = 'Reg Bola';
  perform pg_temp.admin();
  perform pg_temp.ok(n = 1, 'the export says who invited whom');

  -- Settings: questions and messages.
  r := pg_temp.j(a, format('select public.ev_get_registration_settings(%L)', e1));
  perform pg_temp.ok(jsonb_array_length(r -> 'questions') = 3 and r -> 'messages' ->> 'going' = 'You''re in. See you there.', 'defaults: Name, Email, Phone (off) and the three messages');
  perform pg_temp.ok(pg_temp.t(x, format('select public.ev_set_registration_settings(%L, %L::jsonb)', e1, '{"messages":{"going":"hi"}}')) = 'not_allowed', 'a stranger cannot change the settings');
  perform pg_temp.ok(pg_temp.t(h, format('select public.ev_set_registration_settings(%L, %L::jsonb)', e1,
       '{"questions":[{"id":"name","label":"Name","required":false,"builtin":"name"},{"id":"email","label":"Email","builtin":"email","enabled":false},{"id":"diet","label":"Dietary needs","required":true},{"id":"plus","label":"Plus one","required":true,"enabled":false}],"messages":{"going":"See you soon"}}')) = 'ok',
       'the host sets a custom question and a message');
  r := pg_temp.j(a, format('select public.ev_get_registration_settings(%L)', e1));
  perform pg_temp.ok(r -> 'messages' ->> 'going' = 'See you soon' and r -> 'messages' ->> 'pending' like 'Your request is in%', 'a changed message is kept and the others stay at their default');
  perform pg_temp.ok((select bool_and((q ->> 'required')::boolean and (q ->> 'enabled')::boolean) from jsonb_array_elements(r -> 'questions') q where q ->> 'builtin' in ('name', 'email')),
                     'Name and Email are always asked and required, whatever was sent');
  e8 := e1;
  perform pg_temp.ok(pg_temp.reg(x, e8) ->> 'reason' = 'answer_needed' and pg_temp.reg(x, e8) ->> 'question' = 'Dietary needs', 'a required custom question needs an answer');
  r := pg_temp.reg(x, e8, '{"answers":{"diet":"  no pork  ","plus":"","Bad Key!":"x","phone":"0801"}}');
  perform pg_temp.ok((r ->> 'ok')::boolean and r -> 'registration' -> 'answers' = '{"diet":"no pork","phone":"0801"}'::jsonb and r -> 'registration' ->> 'phone' = '0801',
                     'answers are trimmed, empty ones and keys with odd characters are dropped, phone shows as phone');
  perform pg_temp.ok(pg_temp.t(h, format('select public.ev_set_registration_settings(%L, %L::jsonb)', e1, '{"questions":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}')) = 'name_and_email_stay'
                     and pg_temp.t(h, format('select public.ev_set_registration_settings(%L, %L::jsonb)', e1,
                         '{"questions":[{"id":"name","label":"Name","builtin":"name"},{"id":"email","label":"Email","builtin":"email"},{"id":"q1","label":"A"},{"id":"q1","label":"B"}]}')) = 'duplicate_question',
                     'questions cannot lose Name or Email or share an id');
  perform pg_temp.ok(pg_temp.t(h, format('select public.ev_set_registration_settings(%L, %L::jsonb)', e1, json_build_object('messages', json_build_object('going', repeat('x', 501)))::text)) = 'bad_message',
                     'a message over 500 characters is refused');

  -- Clone keeps the settings.
  update public.events set created_at = now() - interval '3 hours' where host_id = h;
  r := pg_temp.j(h, format('select public.ev_clone_event(%L)', e1));
  clone_id := (r -> 'event' ->> 'id')::uuid;
  perform pg_temp.ok((r ->> 'ok')::boolean and (select count(*) from public.ev_registrations where event_id = clone_id) = 0, 'a clone has no guests');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(pg_temp.j(a, format('select public.ev_get_registration_settings(%L)', clone_id)) -> 'questions') q where q ->> 'id' = 'diet')
                     and pg_temp.j(a, format('select public.ev_get_registration_settings(%L)', clone_id)) -> 'messages' ->> 'going' = 'See you soon', 'but it keeps the questions and messages');

  -- The button, for each kind of viewer.
  perform pg_temp.anon();
  select public.ev_viewer_state(e3) into r;
  perform pg_temp.admin();
  perform pg_temp.ok(r ->> 'button' = 'waitlist' and (r ->> 'signedIn')::boolean is false and r -> 'registration' = 'null'::jsonb, 'a visitor with no account sees the button for a full event with a waitlist');
  perform pg_temp.ok(pg_temp.vs(x, e4) ->> 'button' = 'request' and pg_temp.vs(x, e6) ->> 'button' = 'register', 'request for approval events, register otherwise');
  perform pg_temp.ok(pg_temp.vs(a, e1) ->> 'button' = 'going' and pg_temp.vs(a, e1) -> 'registration' ->> 'status' = 'going', 'going');
  perform pg_temp.ok(pg_temp.vs(b, e5) ->> 'button' = 'pending' and pg_temp.vs(c, e5) ->> 'button' = 'waitlisted' and pg_temp.vs(a, e4) ->> 'button' = 'declined', 'pending, waitlisted, declined');
  perform pg_temp.ok(pg_temp.vs(x, e7) ->> 'button' = 'closed', 'full with no waitlist is closed');
  perform pg_temp.ok((pg_temp.vs(h, e1) ->> 'isHost')::boolean and not (pg_temp.vs(a, e1) ->> 'isHost')::boolean, 'the host is told they are the host');
  insert into public.swipes (user_id, event_id, decision) values (x, e1, 'in');
  perform pg_temp.ok((pg_temp.vs(x, e1) ->> 'interested')::boolean, 'a swipe right shows as interested');
  perform pg_temp.ok(pg_temp.vs(a, e1) ->> 'button' = 'going' and (select status from public.ev_registrations where event_id = e1 and user_id = x) = 'going', 'and the swipe and the registration are separate things');

  -- Online: the link and the Join call window.
  eo := pg_temp.ev(h, 'Online soon', null, false, false, now() + interval '10 minutes');
  update public.events set kind = 'online', venue_name = 'Online', link_type = 'zoom' where id = eo;
  insert into public.ev_event_links (event_id, link) values (eo, 'https://zoom.us/j/999');
  perform pg_temp.reg(a, eo);
  perform pg_temp.ok((pg_temp.vs(a, eo) ->> 'canSeeOnlineLink')::boolean and (pg_temp.vs(a, eo) ->> 'joinCallOpen')::boolean, 'a registered person sees the link, and Join call is open 10 minutes before');
  perform pg_temp.ok(not (pg_temp.vs(b, eo) ->> 'canSeeOnlineLink')::boolean and not (pg_temp.vs(b, eo) ->> 'joinCallOpen')::boolean, 'someone not registered gets neither');
  perform pg_temp.ok(pg_temp.j(a, format('select public.ev_get_event(%L)', eo)) ->> 'online_link' = 'https://zoom.us/j/999'
                     and pg_temp.j(b, format('select public.ev_get_event(%L)', eo)) ->> 'online_link' is null, 'the link is in the event for the going person only');
  perform pg_temp.ok((pg_temp.vs(h, eo) ->> 'canSeeOnlineLink')::boolean, 'and for the host');
  update public.events set starts_at = now() + interval '20 minutes' where id = eo;
  perform pg_temp.ok((pg_temp.vs(a, eo) ->> 'canSeeOnlineLink')::boolean and not (pg_temp.vs(a, eo) ->> 'joinCallOpen')::boolean, 'Join call is not open 20 minutes before');
  perform pg_temp.cancel(a, eo);
  perform pg_temp.ok(pg_temp.j(a, format('select public.ev_get_event(%L)', eo)) ->> 'online_link' is null, 'a person who cancels loses the link');
  ex := pg_temp.ev(h, 'In person soon', null, false, false, now() + interval '5 minutes');
  perform pg_temp.reg(a, ex);
  perform pg_temp.ok(not (pg_temp.vs(a, ex) ->> 'joinCallOpen')::boolean, 'an in-person event has no Join call');

  -- Events that cannot be registered for.
  ex := pg_temp.ev(h, 'Long over', null, false, false, now() - interval '5 hours');
  perform pg_temp.ok(pg_temp.reg(a, ex) ->> 'reason' = 'event_over', 'an event that is over is event_over');
  ex := pg_temp.ev(h, 'Cancelled soon'); update public.events set status = 'cancelled' where id = ex;
  perform pg_temp.ok(pg_temp.reg(a, ex) ->> 'reason' = 'cancelled' and pg_temp.vs(a, ex) ->> 'button' = 'closed', 'a cancelled event: cancelled, and the button is closed');
  ex := pg_temp.ev(h, 'Paid one'); update public.events set price_naira = 5000 where id = ex;
  perform pg_temp.ok(pg_temp.vs(a, ex) ->> 'button' = 'register', 'an old listing with a door price of 5000: the button is register');
  r := pg_temp.reg(a, ex);
  perform pg_temp.ok((r ->> 'ok')::boolean and (select price_naira from public.ev_ticket_types where event_id = ex) = 0,
                     'an old listing with a door price of 5000 has a FREE derived General: the button is register, and registering works (the door price is information only)');
  ex := pg_temp.ev(h, 'Hidden one'); update public.events set status = 'hidden' where id = ex;
  perform pg_temp.ok(pg_temp.reg(a, ex) ->> 'reason' = 'not_found' and pg_temp.vs(a, ex) is null, 'a hidden event cannot be registered for or opened');
  insert into public.crews (id, name, created_by, visibility) values (room, 'Reg Room', h, 'open');
  insert into public.crew_members (crew_id, user_id, role) values (room, h, 'owner'), (room, b, 'member');
  e9 := pg_temp.ev(h, 'Community only'); update public.events set visibility = 'community', room_id = room where id = e9;
  perform pg_temp.ok(pg_temp.reg(c, e9) ->> 'reason' = 'not_found' and (pg_temp.reg(b, e9) ->> 'ok')::boolean, 'a community event takes room members only');

  -- ===================================================== ticket types ========
  -- Pick and count: a type with its own capacity, the first free type with room by default, a type asked for.
  et1 := pg_temp.ev(h, 'Types one', null, false, true);
  ta := pg_temp.ty(et1, 'Early', 0, 1, 1); tb := pg_temp.ty(et1, 'Regular', 0, null, 2);
  r := pg_temp.reg(a, et1);
  perform pg_temp.ok(r -> 'registration' ->> 'status' = 'going' and r -> 'registration' ->> 'ticket_name' = 'Early' and r -> 'registration' ->> 'ticket_type_id' = ta::text, 'no type asked for: the first free type with room (Early)');
  r := pg_temp.reg(b, et1);
  perform pg_temp.ok(r -> 'registration' ->> 'status' = 'going' and r -> 'registration' ->> 'ticket_name' = 'Regular', 'Early is full, so the next free type with room (Regular)');
  r := pg_temp.regt(c, et1, ta);
  perform pg_temp.ok(r -> 'registration' ->> 'status' = 'waitlisted' and (r -> 'registration' ->> 'waitlist_pos')::int = 1 and r -> 'registration' ->> 'ticket_name' = 'Early', 'asking for a full type: waitlisted, as the event waitlist is on');
  r := pg_temp.regt(d, et1, tb);
  perform pg_temp.ok(r -> 'registration' ->> 'status' = 'going' and pg_temp.tname(et1, d) = 'Regular', 'asking for a type with room: in');
  tt1 := pg_temp.j(x, format('select public.ev_get_event(%L)', et1)) -> 'ticket_types';
  perform pg_temp.ok((tt1 -> 0 ->> 'sold')::int = 1 and (tt1 -> 0 ->> 'spots_left')::int = 0 and (tt1 -> 1 ->> 'sold')::int = 2 and tt1 -> 1 -> 'spots_left' = 'null'::jsonb, 'sold and spots_left per type (waiting people are not sold)');
  perform pg_temp.cancel(a, et1);
  perform pg_temp.ok(pg_temp.st(et1, c) = 'going', 'the person who held the full type cancels: the waiter for that type moves in');
  perform pg_temp.ok(pg_temp.reg(x, et1, json_build_object('ticketTypeId', gen_random_uuid())::jsonb) ->> 'reason' = 'bad_ticket' and pg_temp.reg(x, et1, '{"ticketTypeId":"nope"}') ->> 'reason' = 'bad_ticket',
                     'a type that is not the event''s is bad_ticket');
  perform pg_temp.ok(pg_temp.regt(x, pg_temp.ev(h, 'Other event'), ta) ->> 'reason' = 'bad_ticket', 'and so is a type of another event');
  -- Back in line with another type.
  r := pg_temp.regt(a, et1, tb);
  perform pg_temp.ok(r -> 'registration' ->> 'status' = 'going' and pg_temp.tname(et1, a) = 'Regular', 'someone who cancelled and registers again can take a different type');

  -- A full type is skipped, a spare place in another type does not move a waiter.
  et2 := pg_temp.ev(h, 'Types two', 10, false, true);
  ta := pg_temp.ty(et2, 'A', 0, 1, 1); tb := pg_temp.ty(et2, 'B', 0, 5, 2);
  perform pg_temp.regt(a, et2, ta); perform pg_temp.regt(b, et2, ta); perform pg_temp.regt(c, et2, tb);
  perform pg_temp.ok(pg_temp.st(et2, a) = 'going' and pg_temp.st(et2, b) = 'waitlisted' and pg_temp.st(et2, c) = 'going', 'A holds one, the second asker waits, B is open');
  perform pg_temp.cancel(c, et2);
  perform pg_temp.ok(pg_temp.st(et2, b) = 'waitlisted' and pg_temp.pos(et2, b) = 1, 'a place frees in B: the person waiting for A does not move');
  perform pg_temp.cancel(a, et2);
  perform pg_temp.ok(pg_temp.st(et2, b) = 'going', 'a place frees in A: they do');
  -- Skipping inside the line: the first in line wants a full type, the second wants an open one.
  et3 := pg_temp.ev(h, 'Types three', 2, false, true);
  ta := pg_temp.ty(et3, 'A', 0, 1, 1); tb := pg_temp.ty(et3, 'B', 0, null, 2);
  perform pg_temp.regt(a, et3, ta); perform pg_temp.regt(b, et3, tb);
  perform pg_temp.regt(c, et3, ta); perform pg_temp.regt(d, et3, tb);
  perform pg_temp.ok(pg_temp.st(et3, c) = 'waitlisted' and pg_temp.pos(et3, c) = 1 and pg_temp.st(et3, d) = 'waitlisted' and pg_temp.pos(et3, d) = 2, 'the event is full (2 of 2): both wait, c first');
  perform pg_temp.cancel(b, et3);
  perform pg_temp.ok(pg_temp.st(et3, c) = 'waitlisted' and pg_temp.st(et3, d) = 'going', 'one place opens: c wants the full type A so is skipped, d takes it');

  -- No waitlist: type_full, and full when the event itself is full.
  et4 := pg_temp.ev(h, 'Types four', null, false, false);
  ta := pg_temp.ty(et4, 'A', 0, 1, 1); tb := pg_temp.ty(et4, 'B', 0, 5, 2);
  perform pg_temp.regt(a, et4, ta);
  perform pg_temp.ok(pg_temp.regt(b, et4, ta) ->> 'reason' = 'type_full' and (pg_temp.regt(b, et4, tb) ->> 'ok')::boolean, 'a full type with no waitlist is type_full; another type is still open');
  et5 := pg_temp.ev(h, 'Types five', 2, false, false);
  ta := pg_temp.ty(et5, 'A', 0, 5, 1); tb := pg_temp.ty(et5, 'B', 0, 5, 2);
  perform pg_temp.regt(a, et5, ta); perform pg_temp.regt(b, et5, tb);
  perform pg_temp.ok(pg_temp.regt(c, et5, ta) ->> 'reason' = 'full', 'when the event is full the reason is full, whatever the type');
  tt1 := pg_temp.j(x, format('select public.ev_get_event(%L)', et5)) -> 'ticket_types';
  perform pg_temp.ok((tt1 -> 0 ->> 'spots_left')::int = 0 and (tt1 -> 1 ->> 'spots_left')::int = 0, 'spots_left is the tighter: the event''s 0, not the type''s 4');

  -- Approval applies to the free types; the host's yes respects the type.
  et6 := pg_temp.ev(h, 'Types six', null, true, true);
  ta := pg_temp.ty(et6, 'A', 0, 1, 1); tb := pg_temp.ty(et6, 'B', 0, null, 2);
  perform pg_temp.regt(a, et6, ta); perform pg_temp.regt(b, et6, ta);
  perform pg_temp.ok(pg_temp.st(et6, a) = 'requested' and pg_temp.st(et6, b) = 'requested', 'approval on: both requested (requests do not use a place)');
  perform pg_temp.decide(h, pg_temp.rid(et6, a), 'approve');
  r := pg_temp.decide(h, pg_temp.rid(et6, b), 'approve');
  perform pg_temp.ok(pg_temp.st(et6, a) = 'going' and pg_temp.st(et6, b) = 'waitlisted', 'approving into a full type puts the person on the waitlist');
  r := pg_temp.j(h, format('select public.ev_promote(%L)', pg_temp.rid(et6, b)));
  perform pg_temp.ok(r ->> 'reason' = 'no_free_place', 'promote into a full type is no_free_place, even though the event has room');
  r := pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', et6, '{"tickets":[{"name":"A","capacity":2},{"name":"B"}]}'));
  perform pg_temp.ok((r ->> 'ok')::boolean, 'the host raises the capacity of A');
  perform pg_temp.ok(pg_temp.st(et6, b) = 'requested', 'with approval on, the waiter moves to requested (the host still decides)');
  -- Editing and holding.
  et1 := pg_temp.ev(h, 'Types hold');
  ta := pg_temp.ty(et1, 'A', 0, null, 1); tb := pg_temp.ty(et1, 'B', 0, null, 2);
  perform pg_temp.regt(a, et1, ta);
  r := pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', et1, '{"title":"Types hold","tickets":[{"name":"B"}]}'));
  perform pg_temp.ok(r ->> 'reason' = 'ticket_in_use' and r ->> 'ticket' = 'A', 'a type people hold cannot be dropped');
  perform pg_temp.ok((select count(*) from public.ev_ticket_types where event_id = et1) = 2 and (select title from public.events where id = et1) = 'Types hold', 'and nothing else in the edit was applied');
  r := pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', et1, '{"tickets":[{"name":"A"},{"name":"C","capacity":4}]}'));
  perform pg_temp.ok((r ->> 'ok')::boolean and exists (select 1 from public.ev_ticket_types where event_id = et1 and name = 'C') and not exists (select 1 from public.ev_ticket_types where event_id = et1 and name = 'B'),
                     'a type nobody holds can be dropped, and a new one added');
  perform pg_temp.cancel(a, et1);
  r := pg_temp.j(h, format('select public.ev_update_event(%L, %L::jsonb)', et1, '{"tickets":[{"name":"C"}]}'));
  perform pg_temp.ok((r ->> 'ok')::boolean, 'a cancelled person holds nothing: the type can go');
  -- Registered people keep their type name on the lists.
  r := pg_temp.j(h, format('select public.ev_audience(%L)', et1));
  perform pg_temp.ok((r ->> 'ok')::boolean, 'audience still answers');
  r := pg_temp.j(h, format('select public.ev_audience(%L)', et2));
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r -> 'registrations') q where q ->> 'ticket_name' = 'A' and q ->> 'ticket_type_id' is not null), 'the audience rows carry the ticket name and type id');
  perform pg_temp.actor(h);
  select count(*) into n from public.ev_export(et2) where ticket = 'A' and status = 'going';
  perform pg_temp.admin();
  perform pg_temp.ok(n = 1, 'and the export has a Ticket column');
  -- An old registration with no type holds the event''s first type; an old event gets its General row at the first register.
  ey := pg_temp.ev(h, 'Old event');
  perform pg_temp.ok(not exists (select 1 from public.ev_ticket_types where event_id = ey), 'a direct-made event has no type rows');
  insert into public.ev_registrations (event_id, user_id, status, name) values (ey, a, 'going', 'Ada old');
  r := pg_temp.j(h, format('select public.ev_audience(%L)', ey));
  perform pg_temp.ok(r -> 'registrations' -> 0 ->> 'ticket_name' = 'General' and r -> 'registrations' -> 0 ->> 'ticket_type_id' = md5('ticket-type:' || ey::text)::uuid::text, 'a registration with no type reads as the derived General');
  tt1 := pg_temp.j(x, format('select public.ev_get_event(%L)', ey)) -> 'ticket_types';
  perform pg_temp.ok((tt1 -> 0 ->> 'sold')::int = 1, 'and counts as sold on it');
  perform pg_temp.reg(b, ey);
  perform pg_temp.ok((select count(*) from public.ev_ticket_types where event_id = ey) = 1 and pg_temp.tname(ey, b) = 'General'
                     and (select id from public.ev_ticket_types where event_id = ey) = md5('ticket-type:' || ey::text)::uuid, 'the first register makes the General row, with the same id the event already showed');

  -- Paid types: never taken. Setting on or off.
  update public.ev_settings set value = 'off' where key = 'paid_tickets';
  ey := pg_temp.ev(h, 'Mixed prices');
  ta := pg_temp.ty(ey, 'Free', 0, null, 1); tv := pg_temp.ty(ey, 'VIP', 5000, 10, 2);
  perform pg_temp.ok(pg_temp.reg(x, ey) -> 'registration' ->> 'ticket_name' = 'Free', 'with a free and a paid type, the default is the free one');
  perform pg_temp.cancel(x, ey);
  perform pg_temp.ok(pg_temp.regt(x, ey, tv) ->> 'reason' = 'currently_unavailable', 'asking for the paid type: currently_unavailable');
  perform pg_temp.ok(public.ev_set_setting('paid_tickets', 'on') = 'ok', 'paid switched on');
  perform pg_temp.ok(pg_temp.regt(x, ey, tv) ->> 'reason' = 'use_checkout' and pg_temp.st(ey, x) = 'cancelled', 'with it on the paid type is still not registered for: use_checkout (the buyer goes to checkout)');
  perform pg_temp.ok(pg_temp.vs(b, ey) ->> 'button' = 'register', 'a mix of free and paid: the button is Register');
  ey := pg_temp.ev(h, 'All paid');
  perform pg_temp.ty(ey, 'Ticket', 3000, null, 1);
  perform pg_temp.ok(pg_temp.vs(b, ey) ->> 'button' = 'get_ticket' and pg_temp.reg(b, ey) ->> 'reason' = 'use_checkout', 'every type paid: get_ticket, and a plain register is use_checkout (setting on)');
  perform public.ev_set_setting('paid_tickets', 'off');
  -- The button with every free type full.
  ey := pg_temp.ev(h, 'Free full', null, false, false);
  ta := pg_temp.ty(ey, 'Free', 0, 1, 1); perform pg_temp.ty(ey, 'VIP', 5000, null, 2);
  perform pg_temp.reg(a, ey);
  perform pg_temp.ok(pg_temp.vs(x, ey) ->> 'button' = 'closed', 'every free type full, no waitlist: closed (the paid one does not open it)');
  update public.events set waitlist_on = true where id = ey;
  perform pg_temp.ok(pg_temp.vs(x, ey) ->> 'button' = 'waitlist', 'with the waitlist on: waitlist');
  r := pg_temp.reg(x, ey);
  perform pg_temp.ok(r -> 'registration' ->> 'status' = 'waitlisted' and r -> 'registration' ->> 'ticket_name' = 'Free', 'and registering with no type waits for the first free type');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ev_ticket_types', 'select') and not has_table_privilege('authenticated', 'public.ev_registrations', 'update'), 'the type and registration tables are still closed');

  -- A guest (the app's anonymous session) is not signed in: the screens must open the sign-in sheet. Nobody at all is not signed in either.
  e1 := pg_temp.ev(h, 'Guest button');
  perform pg_temp.ok((pg_temp.vs(a, e1) ->> 'signedIn')::boolean, 'viewer state: a person with an account is signedIn');
  perform pg_temp.ok(not (pg_temp.vs(g, e1) ->> 'signedIn')::boolean and pg_temp.vs(g, e1) ->> 'button' = 'register', 'viewer state: a guest session (auth.uid() but no account) is NOT signedIn');
  perform pg_temp.anon();
  r := public.ev_viewer_state(e1);
  perform pg_temp.admin();
  perform pg_temp.ok(not (r ->> 'signedIn')::boolean, 'viewer state: no session at all is not signedIn');
  perform pg_temp.ok(pg_temp.reg(g, e1) ->> 'reason' = 'need_account', 'and a guest who registers anyway is told need_account');

  -- The switch: with events_r1 off every write answers not_open and changes nothing; reads still work.
  e2 := pg_temp.ev(h, 'Switch test', 1, false, true);
  perform pg_temp.reg(a, e2);
  perform pg_temp.reg(b, e2);
  perform pg_temp.ok(pg_temp.st(e2, b) = 'waitlisted', 'switch test setup: a is going, b is waitlisted');
  perform public.ev_set_setting('events_r1', 'off');
  perform pg_temp.ok(pg_temp.reg(c, e2) ->> 'reason' = 'not_open' and pg_temp.st(e2, c) is null, 'events_r1 off: register answers not_open and writes nothing');
  perform pg_temp.ok(pg_temp.cancel(a, e2) = 'not_open' and pg_temp.st(e2, a) = 'going', 'events_r1 off: cancel answers not_open');
  perform pg_temp.ok(pg_temp.decide(h, pg_temp.rid(e2, b), 'decline') ->> 'reason' = 'not_open' and pg_temp.st(e2, b) = 'waitlisted', 'events_r1 off: decide answers not_open');
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_promote(%L)', pg_temp.rid(e2, b))) ->> 'reason' = 'not_open', 'events_r1 off: promote answers not_open');
  perform pg_temp.ok(pg_temp.t(h, format('select public.ev_set_registration_settings(%L, %L::jsonb)', e2, '{"messages":{"going":"Hi"}}')) = 'not_open', 'events_r1 off: registration settings answer not_open');
  perform pg_temp.ok(pg_temp.vs(a, e2) ->> 'button' = 'going' and pg_temp.j(a, format('select public.ev_audience(%L)', e2)) ->> 'reason' = 'not_allowed' and
                     (pg_temp.j(h, format('select public.ev_audience(%L)', e2)) ->> 'ok')::boolean, 'events_r1 off: reads (viewer state, audience) keep working');
  perform public.ev_set_setting('events_r1', 'on');
  perform pg_temp.ok(pg_temp.cancel(a, e2) = 'ok' and pg_temp.st(e2, b) = 'going', 'events_r1 on again: it all works');

  -- Access.
  for f in select p.oid, p.oid::regprocedure as sig, p.proname as name
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and p.proname in ('ev_register', 'ev_cancel_registration', 'ev_decide', 'ev_promote', 'ev_audience', 'ev_export', 'ev_get_registration_settings',
                                'ev_set_registration_settings', 'ev_viewer_state', '_ev_going', '_ev_fill_waitlist', '_ev_reg_json', '_ev_settings', 'ev_issue_ticket', 'ev_void_ticket')
  loop
    perform pg_temp.ok(has_function_privilege('anon', f.oid, 'execute') = (f.name = 'ev_viewer_state'), f.sig || ': anon ' || case when f.name = 'ev_viewer_state' then 'may call' else 'cannot call' end);
    perform pg_temp.ok(has_function_privilege('authenticated', f.oid, 'execute') =
                         (f.name in ('ev_register', 'ev_cancel_registration', 'ev_decide', 'ev_promote', 'ev_audience', 'ev_export', 'ev_get_registration_settings', 'ev_set_registration_settings', 'ev_viewer_state')),
                       f.sig || ': authenticated access is as designed');
  end loop;
  raise notice 'ALL EVENTS R1 REGISTRATIONS TESTS PASSED';
end $$;
rollback;
