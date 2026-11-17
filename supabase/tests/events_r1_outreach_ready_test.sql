-- DRAFT FOR OLA, NOT RUN ANYWHERE. Outreach readiness: source and organiser fields, claim an event, outside ticket taps and bulk approve
-- (supabase/events_r1_outreach_ready.sql). LOCAL ONLY: everything rolls back.
-- Needs the older files, events_r1_room_profile.sql, events_r1_registrations.sql, events_r1_pay.sql, events_r1_listings.sql, events_r1_outreach.sql,
-- events_r1_transfer.sql and events_r1_outreach_ready.sql loaded. Run it with the file loaded twice (the second load checks it is safe to run again).
-- NOTE: tests/events_r1_outreach_test.sql checks that a scout email is kept on the organiser. events_r1_outreach_ready.sql stops that on purpose
-- (no emails or phone numbers in the database), so run the old outreach test BEFORE loading this file; this test covers the new behaviour.
-- Ends with ALL EVENTS R1 OUTREACH READY TESTS PASSED.
--   psql -v ON_ERROR_STOP=1 -q -d <a throwaway database> -f supabase/tests/events_r1_outreach_ready_test.sql
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
-- run a query as a signed-in person / nobody, give back the jsonb. The role goes back to the superuser after.
create function pg_temp.j(u uuid, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin perform pg_temp.actor(u); execute q into r; perform pg_temp.admin(); return r; end $$;
create function pg_temp.an(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin perform pg_temp.anon(); execute q into r; perform pg_temp.admin(); return r; end $$;
-- does a statement fail for this role? (a permission error, any error)
create function pg_temp.denied(u uuid, q text) returns boolean language plpgsql as $$
declare r jsonb;
begin
  if u is null then perform pg_temp.anon(); else perform pg_temp.actor(u); end if;
  begin execute q into r; perform pg_temp.admin(); return false;
  exception when others then perform pg_temp.admin(); return true; end;
end $$;
create function pg_temp.h(tok text) returns text language sql as $$ select encode(sha256(convert_to(tok, 'UTF8')), 'hex'); $$;
create function pg_temp.newuser(shown text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'or-' || u || '@evtest.invalid', now(), false, '{}',
          json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
-- One scout event. days = whole days from today at 20:00 Lagos (null = no time). extra is laid over it.
create function pg_temp.sev(site text, sid text, nm text, days integer, org text, handle text, extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'source_site', site, 'source_id', sid, 'name', nm,
    'starts_at', case when days is null then null
                      else public._ev_o_iso((date_trunc('day', now() at time zone 'Africa/Lagos') + make_interval(days => days) + interval '20 hours') at time zone 'Africa/Lagos') end,
    'ends_at', null, 'venue', null, 'area', null, 'lat', null, 'lng', null, 'description', '', 'tickets', '[]'::jsonb, 'sold_out', false,
    'ticket_url', 'https://tix.example/' || sid, 'flyer_url', null, 'category', null, 'organiser_name', org, 'organiser_handle', handle, 'event_handle', null,
    'lineup', '[]'::jsonb, 'capacity', null,
    'last_seen', public._ev_o_iso(now()), 'confidence', case when days is null then 'lead' else 'confirmed' end) || extra;
$$;
create function pg_temp.batch(evs jsonb) returns jsonb language sql as $$
  select jsonb_build_object('run_id', 'ready-test', 'scouted_at', public._ev_o_iso(now()), 'sources_covered', '[]'::jsonb, 'events', evs);
$$;
create function pg_temp.pid(site text, sid text) returns uuid language sql as $$ select id from public.ev_pulled where source_site = site and source_id = sid; $$;
create function pg_temp.cnt(q text) returns bigint language plpgsql as $$ declare n bigint; begin execute q into n; return n; end $$;

do $$
declare
  lu uuid := pg_temp.newuser('Listings Test');
  u1 uuid := pg_temp.newuser('Claimer One');
  u2 uuid := pg_temp.newuser('Claimer Two');
  u3 uuid := pg_temp.newuser('Asker Three');
  u4 uuid := pg_temp.newuser('Asker Four');
  v_guest uuid := pg_temp.newuser('Random Guest');
  r jsonb; r2 jsonb; b jsonb;
  p_a uuid; p_b uuid; p_c uuid; p_d uuid; p_e uuid; p_f uuid; p_g uuid;
  ev_a uuid; ev_b uuid; ev_c uuid; ev_d uuid; ev_e uuid; ev_f uuid;
  org_a uuid; org_b uuid; org_c uuid; org_d uuid; room_a uuid; room_c uuid;
  ev public.events; o public.ev_organisers; lid uuid; lid2 uuid; n bigint; k integer; ids uuid[];
  l jsonb;
begin
  perform public.ev_listings_set_account((select email from auth.users where id = lu));

  -- ============================================================ B: new fields on events ========
  perform pg_temp.ok((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'events'
                       and column_name in ('ticket_platform', 'source_url', 'flyer_credit', 'organiser_name', 'organiser_ig', 'organiser_x', 'ticket_url', 'source_site', 'source_id')) = 9,
                     'events has the source and organiser columns (three were there already)');
  b := pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'a', 'Gbedu Night', 10, 'Gbedu Collective', '@Gbedu.ng', jsonb_build_object(
      'ticket_platform', '  Tix  ', 'source_url', 'https://tix.example/pages/gbedu-night', 'flyer_credit', 'Flyer by @designbyk',
      'organiser_x', '@Gbedu_NG', 'organiser_email', 'Hi@Gbedu.ng', 'organiser_phone', '+234 803 000 0000',
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Early', 'price_naira', 5000, 'sold_out', false)))),
    pg_temp.sev('tix', 'b', 'Phone In Credit', 11, 'Gbedu Collective', '@Gbedu.ng', jsonb_build_object(
      'flyer_credit', 'Design: call 0803 000 0000', 'ticket_platform', 'mail me@x.com', 'source_url', 'not a link', 'organiser_x', 'two words',
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Gate', 'price_naira', 2000, 'sold_out', false)))),
    pg_temp.sev('tix', 'c', 'Lekki Comedy', 12, 'Funny Co', 'funny.co', jsonb_build_object(
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Free', 'price_naira', 0, 'sold_out', false)))),
    pg_temp.sev('tix', 'd', 'Detty Warm Up', 13, 'Detty Crew', 'detty.crew'),
    pg_temp.sev('tix', 'e', 'No Time Lead', null, 'Lead Org', null),
    pg_temp.sev('tix', 'f', 'X', 14, 'Short Name Org', null),
    pg_temp.sev('tix', 'g', 'Third Funny Night', 15, 'Funny Co', 'funny.co')));
  r := public.ev_o_import(b, true);
  perform pg_temp.ok((r ->> 'new')::int = 7 and (r ->> 'skipped')::int = 0, 'import: 7 rows, none skipped');
  p_a := pg_temp.pid('tix', 'a'); p_b := pg_temp.pid('tix', 'b'); p_c := pg_temp.pid('tix', 'c'); p_d := pg_temp.pid('tix', 'd');
  p_e := pg_temp.pid('tix', 'e'); p_f := pg_temp.pid('tix', 'f'); p_g := pg_temp.pid('tix', 'g');
  perform pg_temp.ok((select fields ->> 'ticket_platform' from public.ev_pulled where id = p_a) = 'Tix'
                     and (select fields ->> 'source_url' from public.ev_pulled where id = p_a) = 'https://tix.example/pages/gbedu-night'
                     and (select fields ->> 'flyer_credit' from public.ev_pulled where id = p_a) = 'Flyer by @designbyk'
                     and (select fields ->> 'organiser_x' from public.ev_pulled where id = p_a) = 'gbedu_ng',
                     'the new scout fields are cleaned and kept (platform trimmed, X handle without @ and lower case)');
  perform pg_temp.ok((select fields ->> 'organiser_email' from public.ev_pulled where id = p_a) is null
                     and (select fields ->> 'organiser_phone' from public.ev_pulled where id = p_a) is null,
                     'an organiser email and phone sent by an older scout file are not stored on the row');
  perform pg_temp.ok((select count(*) from public.ev_organisers where email is not null or phone is not null) = 0
                     and (select count(*) from public.ev_pulled where fields::text ~ '@Gbedu\.ng|Hi@|803 000') = 0,
                     'no organiser has an email or a phone number, and the text of the scout file holds none either');
  perform pg_temp.ok((select fields ->> 'flyer_credit' from public.ev_pulled where id = p_b) is null
                     and (select fields ->> 'ticket_platform' from public.ev_pulled where id = p_b) is null
                     and (select fields ->> 'source_url' from public.ev_pulled where id = p_b) is null
                     and (select fields ->> 'organiser_x' from public.ev_pulled where id = p_b) is null,
                     'a credit with a phone number, a platform with an email, a source that is not a link and an X handle with spaces are all dropped');

  r := public.ev_o_approve(p_a, 'Jae', null);
  perform pg_temp.ok((r ->> 'ok') = 'true', 'approve the first row');
  ev_a := (r ->> 'event_id')::uuid; org_a := (r ->> 'organiser_id')::uuid;
  select * into ev from public.events where id = ev_a;
  perform pg_temp.ok(ev.ticket_platform = 'Tix' and ev.source_url = 'https://tix.example/pages/gbedu-night' and ev.flyer_credit = 'Flyer by @designbyk'
                     and ev.organiser_name = 'Gbedu Collective' and ev.organiser_ig = 'gbedu.ng' and ev.organiser_x = 'gbedu_ng'
                     and ev.source_site = 'tix' and ev.source_id = 'a' and ev.ticket_url = 'https://tix.example/a',
                     'approve fills platform, source page, flyer credit, organiser name and the Instagram and X handles on the event');
  l := public.ev_listings() -> ev_a::text;
  perform pg_temp.ok(l ->> 'ticket_platform' = 'Tix' and l ->> 'flyer_credit' = 'Flyer by @designbyk' and l ->> 'organiser_ig' = 'gbedu.ng' and l ->> 'organiser_x' = 'gbedu_ng'
                     and l ->> 'organiser_name' = 'Gbedu Collective' and not (l ? 'source_url'),
                     'ev_listings carries the platform, credit and handles to the page, and not the source page');
  perform pg_temp.ok(public.ev_listings() -> ev_a::text ->> 'ticket_url' = 'https://tix.example/a' and (public.ev_listings() -> ev_a::text ->> 'price_from')::int = 5000,
                     'ev_listings still carries what it did before (link and price)');

  -- a rerun that says more fills it in; the Instagram handle of the organiser stays
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'a', 'Gbedu Night', 10, 'Gbedu Collective', '@Gbedu.ng', jsonb_build_object(
      'ticket_platform', 'Tix', 'source_url', 'https://tix.example/pages/gbedu-night', 'flyer_credit', 'Flyer by @newdesigner',
      'organiser_x', 'gbedu_ng', 'tickets', jsonb_build_array(jsonb_build_object('name', 'Early', 'price_naira', 5000, 'sold_out', false)))))), true);
  perform pg_temp.ok((r ->> 'updated')::int = 1 and (select flyer_credit from public.events where id = ev_a) = 'Flyer by @newdesigner', 'a rerun updates the flyer credit of an unclaimed listing');
  -- staff edit: a hand-set credit is kept by the next rerun
  r := public.ev_o_edit(p_a, '{"flyer_credit": "Flyer by Staff Hand"}'::jsonb);
  perform pg_temp.ok((select flyer_credit from public.events where id = ev_a) = 'Flyer by Staff Hand', 'a staff edit of the flyer credit reaches the listing');
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'a', 'Gbedu Night', 10, 'Gbedu Collective', '@Gbedu.ng', jsonb_build_object('flyer_credit', 'Flyer by @newdesigner',
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Early', 'price_naira', 5000, 'sold_out', false)))))), true);
  perform pg_temp.ok((select flyer_credit from public.events where id = ev_a) = 'Flyer by Staff Hand', 'a rerun never overwrites what staff edited');
  r := public.ev_o_edit(p_a, '{"organiser_x": "not valid at all!"}'::jsonb);
  perform pg_temp.ok((select fields ->> 'organiser_x' from public.ev_pulled where id = p_a) is null,
                     'a bad X handle in a staff edit is dropped, never stored as text');

  -- the checks on the table itself
  begin update public.events set flyer_credit = 'call 08012345678' where id = ev_a; perform pg_temp.ok(false, 'a phone number in the flyer credit is refused by the table');
  exception when check_violation then perform pg_temp.ok(true, 'a phone number in the flyer credit is refused by the table'); end;
  begin update public.events set organiser_name = 'write to boss@example.com' where id = ev_a; perform pg_temp.ok(false, 'an email in the organiser name is refused by the table');
  exception when check_violation then perform pg_temp.ok(true, 'an email in the organiser name is refused by the table'); end;
  begin update public.events set organiser_x = 'has space' where id = ev_a; perform pg_temp.ok(false, 'a bad X handle is refused by the table');
  exception when check_violation then perform pg_temp.ok(true, 'a bad X handle is refused by the table'); end;

  -- ============================================================ bulk approve ========
  -- p_b: fine, Gbedu again (second event of one organiser). p_c, p_d: fine. p_e: no time. p_f: name of one character. p_g: Funny Co's second.
  r := public.ev_o_approve_many(array[p_b, p_c, p_e, p_f, p_d, p_a, gen_random_uuid(), p_b], 'Jae');
  perform pg_temp.ok((r ->> 'ok') = 'true' and jsonb_array_length(r -> 'approved') = 3, 'bulk approve: the three good rows go live (a repeated id is asked once)');
  perform pg_temp.ok((select array_agg(x ->> 'reason' order by x ->> 'name') from jsonb_array_elements(r -> 'skipped') x) is not null
                     and (r -> 'skipped') @> '[{"reason": "no_time"}]'::jsonb and (r -> 'skipped') @> '[{"reason": "bad_name"}]'::jsonb
                     and (r -> 'skipped') @> '[{"reason": "already_listed"}]'::jsonb and (r -> 'skipped') @> '[{"reason": "not_found"}]'::jsonb
                     and jsonb_array_length(r -> 'skipped') = 4,
                     'bulk approve: no time, a bad name, an already live row and an unknown id are skipped with their reasons');
  perform pg_temp.ok((select x ->> 'name' from jsonb_array_elements(r -> 'skipped') x where x ->> 'reason' = 'no_time') = 'No Time Lead', 'a skipped row names the event');
  perform pg_temp.ok((select status from public.ev_pulled where id = p_b) = 'approved' and (select status from public.ev_pulled where id = p_e) = 'new'
                     and (select status from public.ev_pulled where id = p_f) = 'new', 'approved rows are approved; skipped ones stay in the queue');
  perform pg_temp.ok((select count(*) from public.events where source_site = 'tix' and ticket_mode = 'external') = 4, 'bulk approve made the listings (4 with the first one)');
  ev_b := (select event_id from public.ev_pulled where id = p_b); ev_c := (select event_id from public.ev_pulled where id = p_c); ev_d := (select event_id from public.ev_pulled where id = p_d);
  perform pg_temp.ok(ev_b is not null and ev_c is not null and ev_d is not null and (select organiser_id from public.events where id = ev_b) = org_a,
                     'the second Gbedu event joins the first one''s organiser');
  -- an organiser who said no blocks their row; a failing row does not undo the others
  perform public.ev_o_set_stage((select id from public.ev_organisers where ig_handle = 'detty.crew'), 'declined', 'Jae');
  select * into o from public.ev_organisers where ig_handle = 'detty.crew';
  perform pg_temp.ok(o.stage = 'declined', 'Detty Crew said no');
  r := public.ev_o_approve_many(array[p_g], 'Jae');
  perform pg_temp.ok(jsonb_array_length(r -> 'approved') = 1, 'bulk approve: one row on its own');
  perform pg_temp.ok(public.ev_o_approve_many(array[]::uuid[], 'Jae') ->> 'reason' = 'bad_ids' and public.ev_o_approve_many(null, 'Jae') ->> 'reason' = 'bad_ids', 'bulk approve: nothing picked is bad_ids');
  perform pg_temp.ok(public.ev_o_approve_many((select array_agg(gen_random_uuid()) from generate_series(1, 101)), 'Jae') ->> 'reason' = 'too_many', 'bulk approve: more than 100 is too_many');
  perform pg_temp.ok(pg_temp.denied(u1, 'select public.ev_o_approve_many(array[gen_random_uuid()], ''x'')') and pg_temp.denied(null, 'select public.ev_o_approve_many(array[gen_random_uuid()], ''x'')'),
                     'bulk approve is service role only');
  -- a blocked organiser's new row cannot be approved in bulk either
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(pg_temp.sev('tix', 'h', 'Detty Second', 16, 'Detty Crew', 'detty.crew'))), true);
  r := public.ev_o_approve_many(array[pg_temp.pid('tix', 'h')], 'Jae');
  perform pg_temp.ok(jsonb_array_length(r -> 'approved') = 0 and (r -> 'skipped') @> '[{"reason": "blocked"}]'::jsonb, 'bulk approve: a blocked organiser''s row is skipped as blocked');

  -- ============================================================ C: claim an event ========
  org_c := (select organiser_id from public.events where id = ev_c);            -- Funny Co
  room_a := (select room_id from public.ev_organisers where id = org_a);          -- Gbedu Collective
  perform pg_temp.ok((select value from public.ev_settings where key = 'event_claims') = 'off', 'the switch starts off');
  perform pg_temp.ok(public.ev_o_claim_link_create(org_a, null, pg_temp.h('t-off'), 'Jae') ->> 'reason' = 'not_on', 'switch off: staff cannot make a claim link');
  perform pg_temp.ok(pg_temp.j(u3, format('select public.ev_claim_ask(%L, %L)', ev_a, 'mine')) ->> 'reason' = 'not_on', 'switch off: an ask is refused');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_link_preview(%L)', pg_temp.h('t-off'))) ->> 'reason' = 'not_found', 'switch off: a preview says not found');
  perform pg_temp.ok(pg_temp.j(u1, format('select public.ev_claim_link_accept(%L)', pg_temp.h('t-off'))) ->> 'reason' = 'not_on', 'switch off: an accept is refused');
  perform pg_temp.ok(public.ev_o_claimable() = '[]'::jsonb and public.ev_o_claim_asks() = '[]'::jsonb, 'switch off: the staff lists are empty');
  perform pg_temp.ok(public.ev_set_claims('maybe') = 'bad_value' and pg_temp.denied(u1, 'select public.ev_set_claims(''on'')') and pg_temp.denied(null, 'select public.ev_set_claims(''on'')'),
                     'only the service role can switch claims, and only on or off');
  perform pg_temp.ok(public.ev_set_claims('on') = 'ok', 'switch on');
  perform pg_temp.ok(public._ev_claims_on(), 'the switch reads on');

  -- make a link for the organiser
  r := public.ev_o_claim_link_create(org_a, null, pg_temp.h('tok-a1'), 'Jae');
  perform pg_temp.ok((r ->> 'ok') = 'true' and r -> 'link' ->> 'status' = 'pending' and r -> 'link' ->> 'room_id' = room_a::text, 'staff make a claim link for the organiser''s room');
  lid := (r -> 'link' ->> 'id')::uuid;
  perform pg_temp.ok((select token_hash from public.ev_claim_links where id = lid) = pg_temp.h('tok-a1') and not (r::text like '%tok-a1%') and not (r::text like '%' || pg_temp.h('tok-a1') || '%'),
                     'only the hash is stored, and neither the token nor the hash comes back');
  perform pg_temp.ok((select count(*) from information_schema.columns where table_name = 'ev_claim_links' and column_name ~ 'token$|^token') = 1, 'the links table has one token column and it is the hash (token_hash)');
  perform pg_temp.ok((select expires_at from public.ev_claim_links where id = lid) between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour', 'a link lasts 14 days');
  perform pg_temp.ok((select stage from public.ev_organisers where id = org_a) = 'offered', 'making a link moves the organiser to offered');
  perform pg_temp.ok((select count(*) from public.ev_organiser_log where organiser_id = org_a and kind = 'transfer' and body like 'Claim link made%') = 1, 'the log has a line for the link (no token in it)');

  -- anyone with the link sees the room, never an email
  r := pg_temp.an(format('select public.ev_claim_link_preview(%L)', pg_temp.h('tok-a1')));
  perform pg_temp.ok((r ->> 'ok') = 'true' and r ->> 'kind' = 'link' and r ->> 'email_hint' is null and r -> 'room' ->> 'name' = 'Gbedu Collective'
                     and jsonb_array_length(r -> 'events') = 2 and r ->> 'organiser_name' = 'Gbedu Collective', 'the preview shows the room and its two upcoming events and no email');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_link_preview(%L)', pg_temp.h('nothing'))) ->> 'reason' = 'not_found'
                     and pg_temp.an('select public.ev_claim_link_preview(''not a hash'')') ->> 'reason' = 'not_found', 'a hash that is not a link answers not found');
  -- who may accept: nobody signed out; a guest without an account is asked to sign in
  perform pg_temp.ok(pg_temp.denied(null, format('select public.ev_claim_link_accept(%L)', pg_temp.h('tok-a1'))), 'a signed out visitor cannot accept (the function is not theirs to run)');
  perform pg_temp.ok(pg_temp.j(u1, format('select public.ev_claim_link_accept(%L)', pg_temp.h('tok-unknown'))) ->> 'reason' = 'invalid_link', 'a hash that is no link at all is invalid_link');

  -- accept: no email match, no review
  r := pg_temp.j(u1, format('select public.ev_claim_link_accept(%L)', pg_temp.h('tok-a1')));
  perform pg_temp.ok((r ->> 'ok') = 'true' and (r ->> 'moved_events')::int = 2 and (r ->> 'room_id')::uuid = room_a and (r ->> 'already_owned_other')::boolean = false, 'accepting hands over the room and its 2 upcoming events');
  perform pg_temp.ok((select role from public.crew_members where crew_id = room_a and user_id = u1) = 'owner'
                     and not exists (select 1 from public.crew_members where crew_id = room_a and user_id = lu)
                     and (select created_by from public.crews where id = room_a) = u1, 'the claimer owns the room and Hoppaz Listings left it');
  perform pg_temp.ok((select host_id from public.events where id = ev_a) = u1 and (select host_id from public.events where id = ev_b) = u1, 'the upcoming events have the new host');
  perform pg_temp.ok((select stage from public.ev_organisers where id = org_a) = 'claimed' and (select claimed_by from public.ev_organisers where id = org_a) = u1, 'the organiser is claimed');
  perform pg_temp.ok((select join_mode from public.ev_room_profiles where crew_id = room_a) = 'open', 'a dormant room opens');
  perform pg_temp.ok((select status from public.ev_claim_links where id = lid) = 'used' and (select used_by from public.ev_claim_links where id = lid) = u1, 'the link is used');
  perform pg_temp.ok(pg_temp.j(u2, format('select public.ev_claim_link_accept(%L)', pg_temp.h('tok-a1'))) ->> 'reason' = 'link_used', 'a second person with the same link: link_used');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_claim_link_preview(%L)', pg_temp.h('tok-a1'))) ->> 'reason' = 'used', 'the preview of a used link says used');
  perform pg_temp.ok((select (public.ev_listings() -> ev_a::text ->> 'claimed')::boolean), 'the listing now reads as claimed');
  perform pg_temp.ok(public.ev_o_claim_link_create(org_a, null, pg_temp.h('tok-a2'), 'Jae') ->> 'reason' = 'is_claimed', 'staff cannot make a link for a claimed organiser');
  perform pg_temp.ok(not exists (select 1 from public.ev_organisers where id = org_a and (email is not null or phone is not null)), 'no email or phone was stored by claiming');
  -- the host (new owner) sees the tap count; a stranger does not
  perform pg_temp.ok(pg_temp.j(v_guest, format('select public.ev_ticket_tap_count(%L)', ev_a)) ->> 'reason' = 'not_allowed', 'a stranger cannot read the tap count');

  -- a link made from a listing row, revoked, expired, rate limited
  r := public.ev_o_claim_link_create(null, ev_c, pg_temp.h('tok-c1'), 'Jae');
  perform pg_temp.ok((r ->> 'ok') = 'true' and (r -> 'link' ->> 'event_id')::uuid = ev_c and (r -> 'link' ->> 'organiser_id')::uuid = org_c, 'a link made from a listing row remembers the listing and finds its organiser');
  lid := (r -> 'link' ->> 'id')::uuid;
  perform pg_temp.ok(public.ev_o_claim_link_create(org_c, null, pg_temp.h('tok-c1'), 'Jae') ->> 'reason' = 'invalid_link', 'the same token cannot be used for two links');
  r := public.ev_o_claim_link_revoke(lid, 'Jae');
  perform pg_temp.ok((r ->> 'ok') = 'true' and r -> 'link' ->> 'status' = 'revoked', 'staff revoke a link');
  perform pg_temp.ok(pg_temp.j(u2, format('select public.ev_claim_link_accept(%L)', pg_temp.h('tok-c1'))) ->> 'reason' = 'link_revoked'
                     and pg_temp.an(format('select public.ev_claim_link_preview(%L)', pg_temp.h('tok-c1'))) ->> 'reason' = 'revoked', 'a revoked link cannot be used or previewed');
  perform pg_temp.ok(public.ev_o_claim_link_revoke(lid, 'Jae') ->> 'reason' = 'link_revoked' and public.ev_o_claim_link_revoke(gen_random_uuid(), 'Jae') ->> 'reason' = 'not_found', 'revoking twice or an unknown link is refused');
  r := public.ev_o_claim_link_create(org_c, null, pg_temp.h('tok-c2'), 'Jae');
  lid2 := (r -> 'link' ->> 'id')::uuid;
  update public.ev_claim_links set expires_at = now() - interval '1 minute' where id = lid2;
  perform pg_temp.ok(pg_temp.j(u2, format('select public.ev_claim_link_accept(%L)', pg_temp.h('tok-c2'))) ->> 'reason' = 'link_expired'
                     and pg_temp.an(format('select public.ev_claim_link_preview(%L)', pg_temp.h('tok-c2'))) ->> 'reason' = 'expired', 'an expired link cannot be used');
  perform pg_temp.ok(public.ev_o_claim_link_revoke(lid2, 'Jae') ->> 'reason' = 'link_expired', 'an expired link cannot be revoked');
  perform pg_temp.ok((select (public._ev_cl_json(cl)) ->> 'status' from public.ev_claim_links cl where cl.id = lid2) = 'expired', 'an open link past its time reads expired');
  -- five open links per room
  for k in 1..5 loop
    r := public.ev_o_claim_link_create(org_c, null, pg_temp.h('tok-many-' || k), 'Jae');
    exit when (r ->> 'ok') <> 'true';
  end loop;
  perform pg_temp.ok(public.ev_o_claim_link_create(org_c, null, pg_temp.h('tok-many-6'), 'Jae') ->> 'reason' = 'try_again_later', 'at most 5 open links per room');
  -- wrong tries: 10 an hour, then try_again_later (the earlier wrong tries of u1 and u2 count too)
  delete from public.ev_claim_attempts;
  for k in 1..10 loop
    r := pg_temp.j(u4, format('select public.ev_claim_link_accept(%L)', pg_temp.h('wrong-' || k)));
  end loop;
  perform pg_temp.ok(r ->> 'reason' = 'invalid_link', 'ten wrong tries are each invalid_link');
  perform pg_temp.ok(pg_temp.j(u4, format('select public.ev_claim_link_accept(%L)', pg_temp.h('wrong-11'))) ->> 'reason' = 'try_again_later', 'the eleventh wrong try in an hour is try_again_later');
  perform pg_temp.ok(pg_temp.j(u4, format('select public.ev_claim_link_accept(%L)', pg_temp.h('tok-many-1'))) ->> 'reason' = 'try_again_later', 'even a good link waits out the limit');
  perform pg_temp.ok(pg_temp.j(u3, format('select public.ev_claim_link_accept(%L)', pg_temp.h('wrong-x'))) ->> 'reason' = 'invalid_link', 'the limit is per person');
  update public.ev_claim_attempts set at = now() - interval '2 hours';
  perform pg_temp.ok(pg_temp.j(u4, format('select public.ev_claim_link_accept(%L)', pg_temp.h('wrong-12'))) ->> 'reason' = 'invalid_link', 'an hour later the person may try again');
  -- an organiser who said no, and a hash that is an email transfer, not a claim link
  org_d := (select id from public.ev_organisers where ig_handle = 'detty.crew');
  perform pg_temp.ok(public.ev_o_claim_link_create(org_d, null, pg_temp.h('tok-d1'), 'Jae') ->> 'reason' = 'organiser_declined', 'staff cannot make a link for an organiser who said no');
  perform pg_temp.ok(public.ev_o_claim_link_create(gen_random_uuid(), null, pg_temp.h('tok-z'), 'Jae') ->> 'reason' = 'not_found'
                     and public.ev_o_claim_link_create(org_c, null, 'short', 'Jae') ->> 'reason' = 'invalid_link', 'an unknown organiser and a bad hash are refused');
  perform pg_temp.ok(pg_temp.denied(u1, 'select public.ev_o_claim_link_create(null, null, repeat(''a'', 64), ''x'')') and pg_temp.denied(null, 'select public.ev_o_claim_link_revoke(gen_random_uuid(), ''x'')')
                     and pg_temp.denied(u1, 'select public.ev_o_claimable()') and pg_temp.denied(u1, 'select public.ev_o_claim_asks()') and pg_temp.denied(u1, 'select public.ev_o_claim_ask_decide(gen_random_uuid(), true, ''x'')')
                     and pg_temp.denied(u1, 'select public.ev_o_tap_counts()') and pg_temp.denied(u1, 'select public.ev_o_claim_links(gen_random_uuid())'),
                     'every staff function is service role only');

  -- the staff list of claimable listings
  r := public.ev_o_claimable();
  perform pg_temp.ok(jsonb_array_length(r) = 3 and not (r @> jsonb_build_array(jsonb_build_object('event_id', ev_a))), 'claimable lists the unclaimed listings still to come, not the claimed ones');
  perform pg_temp.ok((select (x ->> 'link_open')::boolean from jsonb_array_elements(r) x where x ->> 'event_id' = ev_c::text) and (select x ->> 'organiser_name' from jsonb_array_elements(r) x where x ->> 'event_id' = ev_c::text) = 'Funny Co',
                     'a row says when a link is open and who the organiser is');
  perform pg_temp.ok(jsonb_array_length(public.ev_o_claim_links(org_c)) = 7, 'the organiser''s links are listed (7 made)');

  -- ============================================================ the ask ========
  ev_e := (select event_id from public.ev_pulled where id = p_g);   -- Third Funny Night, same organiser as ev_c
  perform pg_temp.ok(pg_temp.denied(null, format('select public.ev_claim_ask(%L, ''x'')', ev_c)), 'a signed out visitor cannot ask (they sign in first)');
  perform pg_temp.ok(pg_temp.j(u3, format('select public.ev_claim_ask(%L, %L)', ev_c, 'I run Funny Co')) ->> 'ok' = 'true', 'a signed in person asks to claim');
  perform pg_temp.ok(pg_temp.j(u3, format('select public.ev_claim_ask(%L, %L)', ev_c, 'again')) ->> 'ok' = 'true' and (select count(*) from public.ev_claim_asks where event_id = ev_c and user_id = u3) = 1, 'asking twice is one ask');
  perform pg_temp.ok(pg_temp.j(u4, format('select public.ev_claim_ask(%L, %L)', ev_e, 'also me')) ->> 'ok' = 'true', 'another person asks about another event of the same organiser');
  perform pg_temp.ok(pg_temp.j(u3, format('select public.ev_claim_ask(%L, %L)', ev_a, 'claimed already')) ->> 'reason' = 'is_claimed', 'asking about a claimed listing is refused');
  perform pg_temp.ok(pg_temp.j(u3, format('select public.ev_claim_ask(%L, %L)', gen_random_uuid(), 'x')) ->> 'reason' = 'not_found', 'an unknown event is not found');
  perform pg_temp.ok(pg_temp.j(u3, format('select public.ev_claim_ask(%L, %L)', ev_c, repeat('x', 501))) ->> 'reason' = 'bad_note', 'a note over 500 characters is refused');
  perform pg_temp.ok(not exists (select 1 from information_schema.columns where table_name = 'ev_claim_asks' and column_name ~ 'mail|phone'), 'the asks table has no email or phone column');
  r := public.ev_o_claim_asks();
  perform pg_temp.ok(jsonb_array_length(r) = 2 and r @> '[{"name": "Asker Three", "status": "new", "event_title": "Lekki Comedy"}]'::jsonb, 'staff see the asks with the name on the account and the event');
  perform pg_temp.ok((select (x ->> 'asks')::int from jsonb_array_elements(public.ev_o_claimable()) x where x ->> 'event_id' = ev_c::text) = 1, 'the claimable row counts the open asks');
  -- decline
  r := public.ev_o_claim_ask_decide((select id from public.ev_claim_asks where user_id = u4), false, 'Jae');
  perform pg_temp.ok((r ->> 'ok') = 'true' and (r ->> 'moved_events')::int = 0, 'decline: answers ok and moves nothing');
  perform pg_temp.ok((select status from public.ev_claim_asks where user_id = u4) = 'declined' and (select host_id from public.events where id = ev_e) = lu, 'decline: the ask is declined and the listing stays with Hoppaz');
  perform pg_temp.ok(public.ev_o_claim_ask_decide((select id from public.ev_claim_asks where user_id = u4), true, 'Jae') ->> 'reason' = 'already_handled', 'a decided ask cannot be decided again');
  -- approve
  r := public.ev_o_claim_ask_decide((select id from public.ev_claim_asks where user_id = u3), true, 'Jae');
  perform pg_temp.ok((r ->> 'ok') = 'true' and (r ->> 'moved_events')::int = 2, 'approve: the room and its 2 upcoming events go to the asker now');
  room_c := (select room_id from public.ev_organisers where id = org_c);
  perform pg_temp.ok((select role from public.crew_members where crew_id = room_c and user_id = u3) = 'owner' and (select host_id from public.events where id = ev_c) = u3
                     and (select host_id from public.events where id = ev_e) = u3 and (select stage from public.ev_organisers where id = org_c) = 'claimed', 'the asker owns the room, hosts its events, and the organiser is claimed');
  perform pg_temp.ok((select count(*) from public.ev_claim_links where room_id = room_c and status = 'pending') = 0, 'every other open link of that room is cancelled');
  perform pg_temp.ok(not exists (select 1 from public.ev_claim_asks where status = 'new'), 'no ask is left open for that room');
  -- rate limit on asks: 3 a day per person
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'r1', 'Rate One', 20, 'Rate Org One', null), pg_temp.sev('tix', 'r2', 'Rate Two', 20, 'Rate Org Two', null),
    pg_temp.sev('tix', 'r3', 'Rate Three', 20, 'Rate Org Three', null), pg_temp.sev('tix', 'r4', 'Rate Four', 20, 'Rate Org Four', null))), true);
  r := public.ev_o_approve_many(array[pg_temp.pid('tix', 'r1'), pg_temp.pid('tix', 'r2'), pg_temp.pid('tix', 'r3'), pg_temp.pid('tix', 'r4')], 'Jae');
  select array_agg(event_id order by source_id) into ids from public.ev_pulled where source_id in ('r1', 'r2', 'r3', 'r4');
  perform pg_temp.ok(pg_temp.j(v_guest, format('select public.ev_claim_ask(%L, ''a'')', ids[1])) ->> 'ok' = 'true' and pg_temp.j(v_guest, format('select public.ev_claim_ask(%L, ''a'')', ids[2])) ->> 'ok' = 'true'
                     and pg_temp.j(v_guest, format('select public.ev_claim_ask(%L, ''a'')', ids[3])) ->> 'ok' = 'true', 'three asks in a day are fine');
  perform pg_temp.ok(pg_temp.j(v_guest, format('select public.ev_claim_ask(%L, ''a'')', ids[4])) ->> 'reason' = 'try_again_later', 'the fourth ask in a day is try_again_later');

  -- ============================================================ D: outside ticket taps ========
  perform pg_temp.ok(pg_temp.an(format('select public.ev_ticket_tap(%L, %L)', ev_d, 'device-aaaa-1111')) ->> 'ok' = 'true', 'a signed out tap with a device id is answered ok');
  perform pg_temp.ok((select count(*) from public.ev_ticket_taps where event_id = ev_d) = 1, 'and counted');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_ticket_tap(%L, %L)', ev_d, 'device-aaaa-1111')) ->> 'ok' = 'true', 'the same device again the same day is answered ok');
  perform pg_temp.ok((select count(*) from public.ev_ticket_taps where event_id = ev_d) = 1, 'but it is still one row');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_ticket_tap(%L, %L)', ev_d, 'device-bbbb-2222')) ->> 'ok' = 'true', 'another device taps');
  perform pg_temp.ok((select count(*) from public.ev_ticket_taps where event_id = ev_d) = 2, 'and is a second row');
  perform pg_temp.ok(pg_temp.j(v_guest, format('select public.ev_ticket_tap(%L, %L)', ev_d, 'device-bbbb-2222')) ->> 'ok' = 'true', 'a signed in person taps (their device id is ignored: they count by account)');
  perform pg_temp.ok(pg_temp.j(v_guest, format('select public.ev_ticket_tap(%L, null)', ev_d)) ->> 'ok' = 'true', 'and taps again');
  perform pg_temp.ok((select count(*) from public.ev_ticket_taps where event_id = ev_d) = 3 and exists (select 1 from public.ev_ticket_taps where event_id = ev_d and who = 'u:' || v_guest::text),
                     'a signed in person is counted by account, once');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_ticket_tap(%L, null)', ev_d)) ->> 'reason' = 'bad_input' and pg_temp.an(format('select public.ev_ticket_tap(%L, %L)', ev_d, 'x y')) ->> 'reason' = 'bad_input', 'no person and no usable device is bad_input');
  perform pg_temp.ok(pg_temp.an(format('select public.ev_ticket_tap(%L, %L)', gen_random_uuid(), 'device-aaaa-1111')) ->> 'reason' = 'not_found', 'an unknown event is not found');
  -- a tap on a different Lagos day is a new row (backdate one, tap again)
  update public.ev_ticket_taps set day = day - 1 where event_id = ev_d and who = 'd:device-aaaa-1111';
  perform pg_temp.an(format('select public.ev_ticket_tap(%L, %L)', ev_d, 'device-aaaa-1111'));
  perform pg_temp.ok((select count(*) from public.ev_ticket_taps where event_id = ev_d) = 4 and (select count(distinct who) from public.ev_ticket_taps where event_id = ev_d) = 3, 'another day is another row but the same person or device counts once in the total');
  -- not a listing: a Hoppaz event cannot be tapped
  insert into public.events (id, title, venue_name, geog, starts_at, host_id, ticket_mode, source, slug, status, visibility, kind)
  values (gen_random_uuid(), 'Own Hoppaz Event', 'Somewhere', st_point(3.4, 6.5)::geography, now() + interval '3 days', u1, 'hoppaz', 'hoppaz', 'own-hoppaz-event-x1', 'live', 'public', 'in_person')
  returning id into ev_f;
  perform pg_temp.ok(pg_temp.an(format('select public.ev_ticket_tap(%L, %L)', ev_f, 'device-aaaa-1111')) ->> 'reason' = 'not_found', 'a Hoppaz event has no outside button to tap');
  -- the numbers
  perform pg_temp.ok(public.ev_o_tap_counts() -> 'events' ->> ev_d::text = '3', 'staff: people who went to buy, by event (3)');
  perform pg_temp.ok(public.ev_o_tap_counts() -> 'organisers' ->> (select organiser_id::text from public.events where id = ev_d) = '3', 'staff: and by organiser');
  perform pg_temp.ok((select x ->> 'went_to_buy' from jsonb_array_elements(public.ev_o_claimable()) x where x ->> 'event_id' = ev_d::text) is null
                     or (select (x ->> 'went_to_buy')::int from jsonb_array_elements(public.ev_o_claimable()) x where x ->> 'event_id' = ev_d::text) = 3, 'the claimable list carries the same number');
  -- a host reads the count for their own event (Gbedu event a is u1's now)
  perform pg_temp.an(format('select public.ev_ticket_tap(%L, %L)', ev_a, 'device-cccc-3333'));
  perform pg_temp.ok(pg_temp.j(u1, format('select public.ev_ticket_tap_count(%L)', ev_a)) = '{"ok": true, "count": 1}'::jsonb, 'the host reads "1 person went to buy" on their own event');
  perform pg_temp.ok(pg_temp.j(u2, format('select public.ev_ticket_tap_count(%L)', ev_a)) ->> 'reason' = 'not_allowed' and pg_temp.denied(null, format('select public.ev_ticket_tap_count(%L)', ev_a)), 'someone else cannot read it, and signed out cannot call it');

  -- ============================================================ closed tables ========
  perform pg_temp.ok(pg_temp.denied(null, 'select count(*) from public.ev_claim_links') and pg_temp.denied(u1, 'select count(*) from public.ev_claim_links')
                     and pg_temp.denied(null, 'select count(*) from public.ev_claim_asks') and pg_temp.denied(u1, 'select count(*) from public.ev_claim_asks')
                     and pg_temp.denied(null, 'select count(*) from public.ev_ticket_taps') and pg_temp.denied(u1, 'select count(*) from public.ev_ticket_taps')
                     and pg_temp.denied(u1, 'select count(*) from public.ev_claim_attempts'), 'the new tables are closed to anon and signed in people');
  perform pg_temp.ok(pg_temp.denied(u1, 'insert into public.ev_ticket_taps (event_id, day, who) values (gen_random_uuid(), now()::date, ''u:x'')'), 'nobody can write a tap by hand');
  perform pg_temp.ok(not exists (select 1 from information_schema.columns where table_name in ('ev_ticket_taps', 'ev_claim_links', 'ev_claim_attempts') and column_name ~ 'mail|phone|ip|ua|agent'), 'no email, phone, address or browser string is kept by taps, links or attempts');
  perform pg_temp.ok(public.ev_listings() ? ev_d::text and (public.ev_listings() -> ev_d::text) ? 'ticket_platform', 'ev_listings answers for an external event to anyone');
  perform pg_temp.ok(pg_temp.an('select public.ev_listings() -> ' || quote_literal(ev_d::text)) ->> 'ticket_url' is not null, 'anon can read ev_listings');

  raise notice 'ALL EVENTS R1 OUTREACH READY TESTS PASSED';
end $$;
rollback;
