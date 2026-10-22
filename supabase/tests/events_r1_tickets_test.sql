-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Release 1 tickets and door scan (supabase/events_r1_tickets.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, events_r1_events.sql, events_r1_registrations.sql and events_r1_tickets.sql loaded.
-- The test sets a test signing secret inside its own transaction (with replace = true) and the rollback puts the real one back.
-- Ends with ALL EVENTS R1 TICKETS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_tickets_test.sql
begin;
-- pgcrypto is in the extensions schema on Supabase; the check of the signature below uses hmac() directly.
set local search_path = public, extensions;
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
          case when guest then null else 'tix-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
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
create function pg_temp.ev(host uuid, ttl text, cap int default null, wl boolean default false) returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id, capacity, waitlist_on)
  values (ttl, 'Somewhere', now() + interval '2 days', 'live', host, cap, wl) returning id;
$$;
create function pg_temp.reg(u uuid, ev uuid) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_register(%L, %L::jsonb)', ev, '{}'));
end $$;
create function pg_temp.cancel(u uuid, ev uuid) returns text language plpgsql as $$
begin
  return pg_temp.t(u, format('select public.ev_cancel_registration(%L)', ev));
end $$;
create function pg_temp.mine(u uuid, ev uuid) returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_my_ticket(%L)', ev));
end $$;
create function pg_temp.scan(u uuid, ev uuid, tok text, mode text default 'standard') returns jsonb language plpgsql as $$
begin
  return pg_temp.j(u, format('select public.ev_scan(%L, %L, %L)', ev, tok, mode));
end $$;
create function pg_temp.rid(ev uuid, u uuid) returns uuid language sql as $$
  select id from public.ev_registrations where event_id = ev and user_id = u;
$$;
create function pg_temp.st(ev uuid, u uuid) returns text language sql as $$
  select status from public.ev_registrations where event_id = ev and user_id = u;
$$;

do $$
declare
  h uuid := pg_temp.newuser('Tix Host'); a uuid := pg_temp.newuser('Tix Ada'); b uuid := pg_temp.newuser('Tix Bola');
  c uuid := pg_temp.newuser('Tix Chike'); x uuid := pg_temp.newuser('Tix Stranger'); w uuid := pg_temp.newuser('Tix Waiter');
  secret text := 'test-secret-for-the-ticket-tests-0123456789abcdef';
  e1 uuid; e2 uuid; e3 uuid; ew uuid;
  ta jsonb; tb jsonb; ta2 jsonb; tw jsonb; r jsonb; n int; tok text; body text; sig text; code text; f record; p jsonb;
begin
  -- The secret, and everything closed.
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ev_ticket_secret', 'select') and not has_table_privilege('anon', 'public.ev_ticket_secret', 'select')
                     and not has_table_privilege('authenticated', 'public.ev_tickets', 'select') and not has_table_privilege('authenticated', 'public.ev_scans', 'select')
                     and not has_table_privilege('authenticated', 'public.ev_door_staff', 'select'), 'secret, tickets, scans and door staff are closed to anon and authenticated');
  begin
    perform pg_temp.actor(a);
    perform public.ev_set_ticket_secret(repeat('x', 40), true);
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a signed-in user must not set the secret');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a signed-in user cannot set the secret');
  end;
  perform pg_temp.ok(public.ev_set_ticket_secret('too short') = 'too_short', 'a short secret is refused');
  delete from public.ev_ticket_secret;
  e1 := pg_temp.ev(h, 'Door night');
  perform pg_temp.reg(a, e1);
  begin
    perform pg_temp.mine(a, e1);
    perform pg_temp.ok(false, 'no secret: showing a ticket must fail loudly');
  exception when others then
    perform pg_temp.admin();
    perform pg_temp.ok(sqlerrm = 'ticket_secret_missing', 'with no secret set, a ticket fails loudly: ticket_secret_missing');
  end;
  perform pg_temp.ok(pg_temp.scan(h, e1, 'aaa.bbb') ->> 'reason' = 'no_secret', 'and a scan of a token says no_secret');
  perform pg_temp.ok(public.ev_set_ticket_secret(secret) = 'ok', 'the secret is set');
  perform pg_temp.ok(public.ev_set_ticket_secret(secret) = 'already_set', 'setting it again is refused');
  perform pg_temp.ok(public.ev_set_ticket_secret(secret, true) = 'ok', 'unless replace is asked for');

  -- Issuing.
  perform pg_temp.ok((select count(*) from public.ev_tickets where event_id = e1) = 1, 'registering made one ticket for the person who is going');
  ta := pg_temp.mine(a, e1);
  perform pg_temp.ok(ta ->> 'holder_name' = 'Tix Ada' and ta ->> 'ticket_name' = 'General' and ta ->> 'status' = 'valid' and (ta ->> 'version')::int = 1
                     and ta ->> 'code' ~ '^[A-HJ-NP-Z2-9]{8}$', 'the ticket has the holder, General, version 1 and an 8 character code');
  tok := ta ->> 'token';
  body := split_part(tok, '.', 1); sig := split_part(tok, '.', 2);
  perform pg_temp.ok(array_length(string_to_array(tok, '.'), 1) = 2 and tok !~ '[+/=]', 'the token is two url-safe parts');
  perform pg_temp.ok(sig = translate(replace(encode(hmac(convert_to(body, 'UTF8'), convert_to(secret, 'UTF8'), 'sha256'), 'base64'), E'\n', ''), '+/=', '-_'),
                     'the second part is the HMAC-SHA256 of the first, keyed by the secret');
  p := convert_from(decode(translate(body, '-_', '+/') || repeat('=', (4 - length(body) % 4) % 4), 'base64'), 'UTF8')::jsonb;
  perform pg_temp.ok(p ->> 'e' = e1::text and p ->> 't' = ta ->> 'id' and (p ->> 'v')::int = 1 and (select count(*) from jsonb_object_keys(p)) = 3, 'the first part is {t, e, v}');
  perform pg_temp.ok(pg_temp.mine(x, e1) is null, 'someone who is not going has no ticket');
  perform pg_temp.ok(pg_temp.mine(a, e1) ->> 'token' = tok, 'the same ticket gives the same token');

  -- Scanning: who may.
  perform pg_temp.ok(pg_temp.scan(x, e1, tok) ->> 'reason' = 'not_allowed', 'a stranger cannot scan');
  perform pg_temp.ok(pg_temp.scan(a, e1, tok) ->> 'reason' = 'not_allowed', 'and neither can the ticket holder');
  begin
    perform pg_temp.anon();
    perform public.ev_scan(e1, tok, 'standard');
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not scan');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot call ev_scan');
  end;
  perform pg_temp.ok(pg_temp.scan(h, e1, tok, 'sideways') ->> 'reason' = 'bad_mode', 'a mode must be standard, express or confirm');

  -- Standard: look, then confirm.
  r := pg_temp.scan(h, e1, tok);
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'kind' = 'confirm' and r ->> 'name' = 'Tix Ada' and r ->> 'ticket' = 'General' and (r ->> 'total')::int = 1 and (r ->> 'checked_in')::int = 0,
                     'standard mode shows the person and checks nobody in');
  perform pg_temp.ok(pg_temp.st(e1, a) = 'going' and (select status from public.ev_tickets where event_id = e1) = 'valid', 'nothing changed');
  r := pg_temp.scan(h, e1, tok, 'confirm');
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'kind' = 'checked_in' and (r ->> 'checked_in')::int = 1 and (r ->> 'total')::int = 1, 'confirm checks them in');
  perform pg_temp.ok(pg_temp.st(e1, a) = 'checked_in' and (select status from public.ev_tickets where event_id = e1) = 'used' and pg_temp.mine(a, e1) ->> 'status' = 'used', 'the registration and the ticket are used');
  r := pg_temp.scan(h, e1, tok, 'express');
  perform pg_temp.ok(not (r ->> 'ok')::boolean and r ->> 'kind' = 'already_used' and r ->> 'name' = 'Tix Ada' and r ->> 'at' is not null, 'a second scan is already_used, with the name and the time');
  perform pg_temp.ok(pg_temp.scan(h, e1, tok) ->> 'kind' = 'already_used', 'standard mode says so as well');

  -- Express and a typed code.
  perform pg_temp.reg(b, e1);
  tb := pg_temp.mine(b, e1);
  code := tb ->> 'code';
  r := pg_temp.scan(h, e1, '  ' || lower(substr(code, 1, 4)) || '-' || lower(substr(code, 5)) || ' ', 'express');
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'kind' = 'checked_in' and r ->> 'name' = 'Tix Bola' and (r ->> 'checked_in')::int = 2 and (r ->> 'total')::int = 2,
                     'express checks in at once, and a typed code works in lower case with a dash and spaces');
  perform pg_temp.ok(pg_temp.scan(h, e1, 'ZZZZZZZZ') ->> 'reason' = 'unknown' and pg_temp.scan(h, e1, 'abc') ->> 'reason' = 'unknown', 'an unknown or too short code is unknown');

  -- Not valid.
  perform pg_temp.reg(c, e1);
  tok := pg_temp.mine(c, e1) ->> 'token';
  sig := split_part(tok, '.', 2);
  perform pg_temp.ok(pg_temp.scan(h, e1, split_part(tok, '.', 1) || '.' || left(sig, length(sig) - 1) || case when right(sig, 1) = 'A' then 'B' else 'A' end) ->> 'reason' = 'bad_signature'
                     and pg_temp.scan(h, e1, split_part(tok, '.', 1) || '.AAAAAAAA') ->> 'reason' = 'bad_signature', 'a changed signature is bad_signature');
  perform pg_temp.ok(pg_temp.scan(h, e1, 'not.atoken') ->> 'reason' = 'bad_signature' and pg_temp.scan(h, e1, 'a.b.c') ->> 'reason' = 'bad_signature', 'garbage with a dot is bad_signature');
  e2 := pg_temp.ev(h, 'Another night');
  perform pg_temp.ok(pg_temp.scan(h, e2, tok) ->> 'reason' = 'wrong_event', 'a ticket for another event is wrong_event');
  body := public._ev_b64url(convert_to(format('{"t":"%s","e":"%s","v":1}', gen_random_uuid(), e1), 'UTF8'));
  perform pg_temp.ok(pg_temp.scan(h, e1, body || '.' || public._ev_sign(body)) ->> 'reason' = 'unknown', 'a correctly signed token for a ticket that does not exist is unknown');
  body := public._ev_b64url(convert_to('{"t":"x","e":"y","v":"1"}', 'UTF8'));
  perform pg_temp.ok(pg_temp.scan(h, e1, body || '.' || public._ev_sign(body)) ->> 'reason' = 'bad_signature', 'a correctly signed token with the wrong shape is refused');

  -- Cancel voids the ticket; coming back makes a new version.
  ta2 := pg_temp.mine(c, e1);
  perform pg_temp.ok(pg_temp.cancel(c, e1) = 'ok', 'c cancels');
  perform pg_temp.ok((select status from public.ev_tickets where registration_id = pg_temp.rid(e1, c)) = 'void', 'a cancel voids the ticket');
  perform pg_temp.ok(pg_temp.scan(h, e1, ta2 ->> 'token') ->> 'reason' = 'void' and pg_temp.scan(h, e1, ta2 ->> 'code') ->> 'reason' = 'void', 'the old QR and the old code are void');
  perform pg_temp.ok(pg_temp.mine(c, e1) is null, 'a person who cancelled has no ticket to show');
  perform pg_temp.reg(c, e1);
  tok := pg_temp.mine(c, e1) ->> 'token';
  perform pg_temp.ok((pg_temp.mine(c, e1) ->> 'version')::int = 2 and tok <> ta2 ->> 'token' and (select count(*) from public.ev_tickets where registration_id = pg_temp.rid(e1, c)) = 1,
                     'registering again brings the same ticket back as version 2 with a different QR');
  perform pg_temp.ok(pg_temp.scan(h, e1, ta2 ->> 'token') ->> 'reason' = 'void' and (pg_temp.scan(h, e1, tok) ->> 'ok')::boolean, 'the old version stays void and the new one works');

  -- Auto-promotion issues a ticket.
  ew := pg_temp.ev(h, 'One place', 1, true);
  perform pg_temp.reg(a, ew); perform pg_temp.reg(w, ew);
  perform pg_temp.ok(pg_temp.st(ew, w) = 'waitlisted' and not exists (select 1 from public.ev_tickets where registration_id = pg_temp.rid(ew, w)), 'a waitlisted person has no ticket');
  perform pg_temp.cancel(a, ew);
  tw := pg_temp.mine(w, ew);
  perform pg_temp.ok(pg_temp.st(ew, w) = 'going' and exists (select 1 from public.ev_tickets where registration_id = pg_temp.rid(ew, w) and status = 'valid'), 'a waitlisted person who is promoted gets a valid ticket');
  perform pg_temp.ok(tw is not null and (pg_temp.scan(h, ew, tw ->> 'token', 'express') ->> 'ok')::boolean, 'which scans');

  -- Door staff.
  perform pg_temp.reg(x, e2);
  tok := pg_temp.mine(x, e2) ->> 'token';
  perform pg_temp.ok(pg_temp.scan(b, e2, tok) ->> 'reason' = 'not_allowed', 'a guest cannot scan at an event they do not run');
  perform pg_temp.ok(pg_temp.t(b, format('select public.ev_set_door_staff(%L, %L, true)', e2, b)) = 'not_allowed', 'a guest cannot make themselves door staff');
  perform pg_temp.ok(pg_temp.t(h, format('select public.ev_set_door_staff(%L, %L, true)', e2, b)) = 'ok', 'the host adds door staff');
  perform pg_temp.ok(pg_temp.t(h, format('select public.ev_set_door_staff(%L, %L, true)', e2, gen_random_uuid())) = 'no_such_user', 'but only real people');
  perform pg_temp.ok((pg_temp.scan(b, e2, tok, 'express') ->> 'ok')::boolean, 'door staff can scan');
  perform pg_temp.ok(pg_temp.t(b, format('select public.ev_set_door_staff(%L, %L, true)', e2, c)) = 'not_allowed', 'door staff cannot add more staff');
  perform pg_temp.ok(pg_temp.t(h, format('select public.ev_set_door_staff(%L, %L, false)', e2, b)) = 'ok', 'the host takes access away');
  perform pg_temp.ok(pg_temp.scan(b, e2, tok) ->> 'reason' = 'not_allowed', 'and it is gone');

  -- Manual check-in and search.
  perform pg_temp.reg(a, e2); perform pg_temp.reg(b, e2);
  r := pg_temp.j(h, format('select public.ev_checkin_manual(%L, %L)', e2, pg_temp.rid(e2, a)));
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'kind' = 'checked_in' and r ->> 'name' = 'Tix Ada', 'the host checks someone in by hand');
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_checkin_manual(%L, %L)', e2, pg_temp.rid(e2, a))) ->> 'kind' = 'already_used', 'twice is already_used');
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_checkin_manual(%L, %L)', e2, pg_temp.rid(e1, a))) ->> 'reason' = 'unknown', 'a registration of another event is unknown');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_checkin_manual(%L, %L)', e2, pg_temp.rid(e2, b))) ->> 'reason' = 'not_allowed', 'a stranger cannot check anyone in');
  r := pg_temp.j(h, format('select public.ev_door_search(%L, %L)', e2, 'tix'));
  perform pg_temp.ok(jsonb_array_length(r) = 3, 'the search finds the going people by name (Ada, Bola and Stranger)');
  r := pg_temp.j(h, format('select public.ev_door_search(%L, %L)', e2, 'tix-' || a::text));
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'name' = 'Tix Ada', 'and by email');
  perform pg_temp.ok(jsonb_array_length(pg_temp.j(h, format('select public.ev_door_search(%L, %L)', e2, '%'))) = 0, 'a % is searched as a letter, not a wildcard');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_door_search(%L, %L)', e2, 'tix')) ->> 'reason' = 'not_allowed', 'a stranger cannot search');

  -- Counts and the list for the offline scan.
  r := pg_temp.j(h, format('select public.ev_door_counts(%L)', e1));
  perform pg_temp.ok((r ->> 'going')::int = 3 and (r ->> 'checked_in')::int = 2 and (r ->> 'ok')::boolean, 'counts: going includes checked in');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_door_counts(%L)', e1)) ->> 'reason' = 'not_allowed', 'a stranger gets no counts');
  r := pg_temp.j(h, format('select public.ev_valid_tickets(%L)', e2));
  perform pg_temp.ok((r ->> 'ok')::boolean and jsonb_array_length(r -> 'tickets') = 1 and r -> 'tickets' -> 0 ->> 'v' = '1'
                     and (select count(*) from jsonb_object_keys(r -> 'tickets' -> 0)) = 2, 'the offline list holds only the tickets still valid: id and version, nothing else');
  perform pg_temp.ok(pg_temp.j(x, format('select public.ev_valid_tickets(%L)', e2)) ->> 'reason' = 'not_allowed', 'and only for the host and door staff');

  -- Offline scans are marked, and a cancelled event is void.
  tok := pg_temp.mine(b, e2) ->> 'token';
  perform pg_temp.actor(h);
  r := public.ev_scan(e2, tok, 'express', true, now() - interval '3 minutes');
  perform pg_temp.admin();
  perform pg_temp.ok((r ->> 'ok')::boolean and exists (select 1 from public.ev_scans where event_id = e2 and offline and device_at is not null and result = 'checked_in'), 'an offline scan is stored with the phone''s time');
  perform pg_temp.reg(c, e2);
  code := pg_temp.mine(c, e2) ->> 'code';
  update public.events set status = 'cancelled' where id = e2;
  perform pg_temp.ok(pg_temp.scan(h, e2, code) ->> 'reason' = 'void', 'a cancelled event: every scan is void');
  perform pg_temp.ok((select count(*) from public.ev_scans where event_id = e1 and result = 'not_valid') >= 8 and (select count(*) from public.ev_scans where event_id = e1 and result = 'checked_in') = 2,
                     'every scan, good or bad, is in the log');

  -- Access.
  for f in select p.oid, p.oid::regprocedure as sig, p.proname as name
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and p.proname in ('ev_my_ticket', 'ev_scan', 'ev_checkin_manual', 'ev_door_search', 'ev_door_counts', 'ev_valid_tickets', 'ev_set_door_staff',
                                'ev_set_ticket_secret', 'ev_issue_ticket', 'ev_void_ticket', '_ev_sign', '_ev_token', '_ev_code', '_ev_can_door', '_ev_not_valid')
  loop
    perform pg_temp.ok(not has_function_privilege('anon', f.oid, 'execute'), f.sig || ': anon cannot call');
    perform pg_temp.ok(has_function_privilege('authenticated', f.oid, 'execute') = (f.name in ('ev_my_ticket', 'ev_scan', 'ev_checkin_manual', 'ev_door_search', 'ev_door_counts', 'ev_valid_tickets', 'ev_set_door_staff')),
                       f.sig || ': authenticated access is as designed');
  end loop;
  perform pg_temp.ok(has_function_privilege('service_role', 'public.ev_set_ticket_secret(text, boolean)', 'execute') and has_function_privilege('service_role', 'public.ev_issue_ticket(uuid)', 'execute'),
                     'the service role can set the secret and issue tickets');
  raise notice 'ALL EVENTS R1 TICKETS TESTS PASSED';
end $$;
rollback;
