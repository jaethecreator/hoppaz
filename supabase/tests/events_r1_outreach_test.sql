-- DRAFT FOR OLA, NOT RUN ANYWHERE. Outreach flow, the staff desk (supabase/events_r1_outreach.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, events_r1_events.sql, events_r1_registrations.sql, events_r1_pay.sql, events_r1_room_profile.sql,
-- events_r1_listings.sql and events_r1_outreach.sql loaded. Every function under test is service role only, so this runs as the superuser.
-- Ends with ALL EVENTS R1 OUTREACH TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_outreach_test.sql
begin;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$
begin
  if v is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.newuser(shown text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ol-' || u || '@evtest.invalid', false, '{}',
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
    'ticket_url', null, 'flyer_url', null, 'category', null, 'organiser_name', org, 'organiser_handle', handle, 'event_handle', null,
    'organiser_email', null, 'organiser_phone', null, 'lineup', '[]'::jsonb, 'capacity', null,
    'last_seen', public._ev_o_iso(now()), 'confidence', case when days is null then 'lead' else 'confirmed' end) || extra;
$$;
create function pg_temp.batch(evs jsonb, sources text[] default '{}') returns jsonb language sql as $$
  select jsonb_build_object('run_id', 'test-run', 'scouted_at', public._ev_o_iso(now()), 'sources_covered', to_jsonb(sources), 'events', evs);
$$;
create function pg_temp.pid(site text, sid text) returns uuid language sql as $$
  select id from public.ev_pulled where source_site = site and source_id = sid;
$$;
create function pg_temp.cnt(q text) returns bigint language plpgsql as $$
declare n bigint;
begin execute q into n; return n; end $$;

do $$
declare
  lu uuid := pg_temp.newuser('Listings Test'); g uuid := pg_temp.newuser('Guest Test'); u2 uuid := pg_temp.newuser('Claimer Test');
  r jsonb; r2 jsonb; b jsonb; dry jsonb; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_g uuid; v_h uuid;
  ev_a uuid; ev_b uuid; ev_d uuid; org_g uuid; org_f uuid; org_l uuid; org_b uuid; room_g uuid; ev public.events; p public.ev_pulled;
  n_p bigint; n_o bigint; n_e bigint; n_c bigint; t1 timestamptz; q jsonb; cr uuid; s1 text; s2 text; v_order uuid;
begin
  -- ============================================================ first import ========
  b := pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'a', 'Gbedu Night', 10, 'Gbedu Collective', '@Gbedu.ng', jsonb_build_object(
      'venue', 'The Shrine', 'lat', 6.60, 'lng', 3.35, 'pin_by', 'venues', 'category', 'Afrobeats party', 'organiser_email', 'Hi@Gbedu.ng',
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Early', 'price_naira', 5000, 'sold_out', false), jsonb_build_object('name', 'Gate', 'price_naira', 8000, 'sold_out', false)),
      'ticket_url', 'https://tix.example/gbedu', 'flyer_url', 'https://img.example/gbedu.jpg')),
    pg_temp.sev('tix', 'b', 'Sunset Brunch', 12, 'Gbedu Collective', null),
    pg_temp.sev('tix', 'c', 'Mystery Lead', null, 'Lead Org', null),
    pg_temp.sev('tix', 'd', 'Comedy Hour', 9, 'Funny Co', 'funny.co', jsonb_build_object(
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Free', 'price_naira', 0, 'sold_out', false)),
      'ticket_url', 'https://tix.example/funny'))));

  n_p := pg_temp.cnt('select count(*) from public.ev_pulled'); n_o := pg_temp.cnt('select count(*) from public.ev_organisers');
  n_e := pg_temp.cnt('select count(*) from public.events'); n_c := pg_temp.cnt('select count(*) from public.crews');
  dry := public.ev_o_import(b, false);
  perform pg_temp.ok(dry ->> 'dry_run' = 'true' and (dry ->> 'new')::int = 4 and (dry ->> 'organisers_new')::int = 3, 'dry run reports 4 new and 3 new organisers');
  perform pg_temp.ok(pg_temp.cnt('select count(*) from public.ev_pulled') = n_p and pg_temp.cnt('select count(*) from public.ev_organisers') = n_o
                     and pg_temp.cnt('select count(*) from public.events') = n_e and pg_temp.cnt('select count(*) from public.crews') = n_c
                     and pg_temp.cnt('select count(*) from public.ev_organiser_log') = 0,
                     'dry run wrote nothing: no pulled rows, organisers, events, rooms or log lines');
  r := public.ev_o_import(b, true);
  perform pg_temp.ok(r ->> 'dry_run' = 'false' and (r ->> 'total')::int = 4 and (r ->> 'new')::int = 4 and (r ->> 'skipped')::int = 0 and (r ->> 'blocked')::int = 0,
                     'apply: 4 new, none skipped or blocked');
  perform pg_temp.ok((dry - 'dry_run') = (r - 'dry_run'), 'the dry run report is the same report as the apply');
  perform pg_temp.ok(pg_temp.cnt('select count(*) from public.ev_pulled') = n_p + 4 and pg_temp.cnt('select count(*) from public.ev_organisers') = n_o + 3,
                     '4 pulled rows and 3 organisers (Gbedu twice, matched by handle then name)');
  perform pg_temp.ok(jsonb_array_length(r -> 'lines') = 4 and r -> 'lines' -> 0 ->> 'action' = 'new' and r -> 'lines' -> 0 ->> 'name' = 'Gbedu Night'
                     and r -> 'lines' -> 0 ->> 'source_id' = 'a', 'one report line per event');
  v_a := pg_temp.pid('tix', 'a'); v_b := pg_temp.pid('tix', 'b'); v_c := pg_temp.pid('tix', 'c'); v_d := pg_temp.pid('tix', 'd');
  select o.id into org_g from public.ev_organisers o where o.ig_handle = 'gbedu.ng';
  perform pg_temp.ok(org_g is not null and (select count(*) from public.ev_organisers where name_key = 'gbeducollective') = 1, 'the handle is stored without @ and lower case');
  perform pg_temp.ok((select organiser_id from public.ev_pulled where id = v_a) = org_g and (select organiser_id from public.ev_pulled where id = v_b) = org_g,
                     'both Gbedu events point at the one organiser');
  perform pg_temp.ok((select email from public.ev_organisers where id = org_g) = 'hi@gbedu.ng' and (select stage from public.ev_organisers where id = org_g) = 'pulled',
                     'the organiser starts at stage pulled with the email lower-cased');
  perform pg_temp.ok((select flags from public.ev_pulled where id = v_a) = '{}'::text[], 'a full event has no flags');
  perform pg_temp.ok((select flags from public.ev_pulled where id = v_b) @> array['no_price', 'no_pin'] and not ((select flags from public.ev_pulled where id = v_b) @> array['no_time']),
                     'no tickets and no pin are flagged');
  perform pg_temp.ok((select flags from public.ev_pulled where id = v_c) @> array['no_time', 'no_pin', 'no_price'] and (select confidence from public.ev_pulled where id = v_c) = 'lead',
                     'a lead with no time is flagged and stays a lead');
  perform pg_temp.ok((select fields ->> 'starts_at' from public.ev_pulled where id = v_a) ~ '^\d{4}-\d\d-\d\dT20:00:00\+01:00$', 'times are kept as ISO with the Lagos offset');
  perform pg_temp.ok((select count(*) from public.ev_organiser_log where kind = 'scrape') = 3, 'a new organiser gets a "found" line');

  -- ============================================================ rerun: same rows ========
  r := public.ev_o_import(b, true);
  perform pg_temp.ok((r ->> 'new')::int = 0 and (r ->> 'unchanged')::int = 4 and (r ->> 'updated')::int = 0 and (r ->> 'organisers_new')::int = 0 and (r ->> 'organisers_matched')::int = 3,
                     'rerun: nothing new, 4 unchanged, 3 organisers matched');
  perform pg_temp.ok(pg_temp.cnt('select count(*) from public.ev_pulled') = n_p + 4 and pg_temp.cnt('select count(*) from public.ev_organisers') = n_o + 3,
                     'rerun makes no duplicate rows or organisers');
  perform pg_temp.ok(pg_temp.pid('tix', 'a') = v_a, 'rerun keeps the same row ids');

  -- ============================================================ bad lines are skipped, not fatal ========
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'bad1', 'Bad Time', 3, 'Skip Org', null, jsonb_build_object('starts_at', 'next friday')),
    pg_temp.sev('tix', 'bad2', '', 3, 'Skip Org', null),
    jsonb_build_object('source_site', 'tix', 'name', 'No id'),
    '"not an object"'::jsonb,
    pg_temp.sev('tix', 'good1', 'Good One', 3, 'Skip Org', null))), true);
  perform pg_temp.ok((r ->> 'total')::int = 5 and (r ->> 'skipped')::int = 4 and (r ->> 'new')::int = 1, 'four bad lines skipped, the good one still lands');
  perform pg_temp.ok(r -> 'lines' -> 0 ->> 'action' = 'skipped' and r -> 'lines' -> 0 ->> 'note' <> '', 'a skipped line says why');
  perform pg_temp.ok(not exists (select 1 from public.ev_pulled where source_id in ('bad1', 'bad2')), 'a skipped line leaves no row');
  perform pg_temp.ok(public.ev_o_import('{"events": 5}'::jsonb, true) ->> 'reason' = 'bad_batch' and public.ev_o_import(null, false) ->> 'reason' = 'bad_batch', 'a broken batch answers bad_batch');

  -- ============================================================ edited fields are kept ========
  r := public.ev_o_edit(v_d, jsonb_build_object('name', 'Comedy Hour Live', 'venue', 'Terra Kulture'));
  perform pg_temp.ok(r -> 'fields' ->> 'name' = 'Comedy Hour Live' and r -> 'fields' ->> 'venue' = 'Terra Kulture' and r -> 'edited' @> '["name", "venue"]'::jsonb,
                     'edit changes the fields and remembers which');
  perform pg_temp.ok(public.ev_o_edit(v_d, '{"starts_at": "soon"}'::jsonb) ->> 'reason' = 'bad_patch' and public.ev_o_edit(v_d, '{"name": ""}'::jsonb) ->> 'reason' = 'bad_patch', 'a bad edit is refused');
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'd', 'Comedy Hour', 9, 'Funny Co', 'funny.co', jsonb_build_object('venue', 'Somewhere Else', 'ticket_url', 'https://tix.example/funny',
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Free', 'price_naira', 2000, 'sold_out', false)))))), true);
  select * into p from public.ev_pulled where id = v_d;
  perform pg_temp.ok((r ->> 'updated')::int = 1, 'a changed price is an update');
  perform pg_temp.ok(p.fields ->> 'name' = 'Comedy Hour Live' and p.fields ->> 'venue' = 'Terra Kulture', 'rerun keeps the name and venue staff edited');
  perform pg_temp.ok((p.fields -> 'tickets' -> 0 ->> 'price_naira')::int = 2000, 'rerun still updates the fields staff did not edit');
  perform pg_temp.ok(not (p.flags @> array['no_price']), 'flags are worked out again');
  -- put the price back so later steps know it
  perform public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'd', 'Comedy Hour', 9, 'Funny Co', 'funny.co', jsonb_build_object('ticket_url', 'https://tix.example/funny',
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Free', 'price_naira', 0, 'sold_out', false)))))), true);

  -- ============================================================ duplicates ========
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('ticketspace', 'g1', 'GBEDU NIGHT!', 10, 'Gbedu Collective', 'gbedu.ng', jsonb_build_object('ticket_url', 'https://ts.example/gbedu')))), true);
  v_g := pg_temp.pid('ticketspace', 'g1');
  perform pg_temp.ok((select flags from public.ev_pulled where id = v_g) @> array['duplicate'] and (select duplicate_of from public.ev_pulled where id = v_g) = v_a,
                     'same Lagos night and same name key is flagged duplicate and points at the first row');
  perform pg_temp.ok(r -> 'lines' -> 0 ->> 'action' = 'new' and r -> 'lines' -> 0 ->> 'note' <> '', 'the report line says it looks like a duplicate');
  perform pg_temp.ok(not ((select flags from public.ev_pulled where id = v_b) @> array['duplicate']), 'a different night is not a duplicate');

  -- ============================================================ blocked organiser ========
  perform public.ev_o_import(pg_temp.batch(jsonb_build_array(pg_temp.sev('blk', 'e', 'Blocked Show', 6, 'Blocked Bros', 'blocked.bros'))), true);
  v_e := pg_temp.pid('blk', 'e');
  select o.id into org_b from public.ev_organisers o where o.ig_handle = 'blocked.bros';
  perform pg_temp.ok((select status from public.ev_pulled where id = v_e) = 'new', 'before they say no, the row waits as new');
  r := public.ev_o_set_stage(org_b, 'declined', 'jae');
  perform pg_temp.ok(r ->> 'stage' = 'declined' and (r ->> 'do_not_contact')::boolean and r ->> 'declined_at' is not null, 'declined sets do_not_contact and declined_at');
  perform pg_temp.ok((select status from public.ev_pulled where id = v_e) = 'blocked' and (select flags from public.ev_pulled where id = v_e) @> array['blocked'],
                     'declining blocks their waiting rows');
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(pg_temp.sev('blk', 'e', 'Blocked Show', 6, 'Blocked Bros', 'blocked.bros'),
                                                          pg_temp.sev('blk', 'f', 'Blocked Show Two', 7, 'Blocked Bros', 'blocked.bros'))), true);
  v_f := pg_temp.pid('blk', 'f');
  perform pg_temp.ok((r ->> 'blocked')::int = 2 and (r ->> 'new')::int = 0 and (select status from public.ev_pulled where id = v_f) = 'blocked', 'a new event of a blocked organiser comes in blocked');
  perform pg_temp.ok(r -> 'lines' -> 1 ->> 'action' = 'blocked', 'and the report line says blocked');
  perform pg_temp.ok(public.ev_o_approve(v_f, 'jae', null) ->> 'reason' = 'blocked' and public.ev_o_approve(v_e, 'jae', null) ->> 'reason' = 'blocked', 'approve refuses blocked rows');
  perform pg_temp.ok((select count(*) from public.ev_organisers where name_key = 'blockedbros') = 1, 'no second organiser was made for them');
  q := public.ev_o_queue();
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(q) x where x ->> 'id' = v_f::text and x ->> 'status' = 'blocked'), 'the queue shows blocked rows');

  -- ============================================================ approve needs the Listings account ========
  perform pg_temp.ok(public.ev_o_approve(v_a, 'jae', null) ->> 'reason' = 'no_listings_account', 'approve answers no_listings_account before it is set up');
  perform pg_temp.ok(public.ev_listings_set_account('ol-' || lu || '@evtest.invalid') = 'ok', 'the Listings account is set');
  perform pg_temp.ok(public.ev_o_approve(gen_random_uuid(), 'jae', null) ->> 'reason' = 'not_found', 'approve of an unknown row is not_found');
  perform pg_temp.ok(public.ev_o_approve(v_c, 'jae', null) ->> 'reason' = 'no_time', 'a lead with no start time cannot be approved');
  perform pg_temp.ok(public.ev_o_approve(v_c, 'jae', '{"starts_at": "garbage"}'::jsonb) ->> 'reason' = 'bad_patch', 'and a bad patch is refused');
  perform pg_temp.ok((select status from public.ev_pulled where id = v_c) = 'new', 'a refused approve changes nothing');

  -- ============================================================ approve: the listing ========
  r := public.ev_o_approve(v_a, 'jae', null);
  perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'organiser_id')::uuid = org_g and (r ->> 'event_id') is not null, 'approve answers ok with the event and organiser');
  ev_a := (r ->> 'event_id')::uuid;
  select * into ev from public.events where id = ev_a;
  perform pg_temp.ok(ev.ticket_mode = 'external' and ev.host_id = lu and ev.status = 'live' and ev.source = 'partner' and ev.visibility = 'public', 'the event is a live external listing hosted by Listings');
  perform pg_temp.ok(ev.listed_price = 5000 and ev.listed_price_max = 8000 and not ev.listing_sold_out, 'price is the lowest and highest known ticket price');
  perform pg_temp.ok(ev.ticket_url = 'https://tix.example/gbedu' and ev.ig_url = ev.ticket_url and ev.instagram_url = 'https://www.instagram.com/gbedu.ng/', 'ticket link, ig_url and instagram link');
  perform pg_temp.ok(ev.title = 'Gbedu Night' and ev.venue_name = 'The Shrine' and ev.flyer_url = 'https://img.example/gbedu.jpg' and ev.vibe = 'afro' and ev.kind = 'in_person', 'title, venue, flyer, vibe from the category');
  perform pg_temp.ok(ev.geog is not null and round(st_y(ev.geog::geometry)::numeric, 2) = 6.60 and round(st_x(ev.geog::geometry)::numeric, 2) = 3.35, 'the pin comes from lat and lng');
  perform pg_temp.ok(ev.source_site = 'tix' and ev.source_id = 'a' and ev.organiser_id = org_g and ev.created_by = lu and ev.slug is not null, 'source ids, organiser and slug are set');
  select * into p from public.ev_pulled where id = v_a;
  perform pg_temp.ok(p.status = 'approved' and p.event_id = ev_a and p.decided_by = 'jae' and p.decided_at is not null, 'the pulled row is approved and linked');
  select o.room_id into room_g from public.ev_organisers o where o.id = org_g;
  perform pg_temp.ok(room_g is not null and ev.room_id = room_g, 'the listing sits in the organiser''s room');
  perform pg_temp.ok((select created_by from public.crews where id = room_g) = lu and (select name from public.crews where id = room_g) = 'Gbedu Collective', 'the room is made by Listings and named for the organiser');
  perform pg_temp.ok((select role from public.crew_members where crew_id = room_g and user_id = lu) = 'owner' and (select count(*) from public.crew_members where crew_id = room_g) = 1, 'Listings is the only member, as owner');
  perform pg_temp.ok((select join_mode from public.ev_room_profiles where crew_id = room_g) = 'invite' and (select slug from public.ev_room_profiles where crew_id = room_g) = 'gbedu-collective'
                     and (select visibility from public.crews where id = room_g) = 'private', 'the room is dormant: invite only, private, slug from the name');
  perform pg_temp.ok((select stage from public.ev_organisers where id = org_g) = 'listed', 'the organiser moves to listed');
  perform pg_temp.ok(exists (select 1 from public.ev_organiser_log where organiser_id = org_g and kind = 'stage' and body = 'Stage: listed' and by_name = 'jae'), 'and a log line says so');

  -- the second event of the same organiser: same room, a patch applied and remembered
  r := public.ev_o_approve(v_b, 'jae', '{"venue": "Lekki Gardens"}'::jsonb);
  ev_b := (r ->> 'event_id')::uuid;
  select * into ev from public.events where id = ev_b;
  perform pg_temp.ok((r ->> 'ok')::boolean and ev.room_id = room_g and (select room_id from public.ev_organisers where id = org_g) = room_g, 'a second event of the organiser reuses the one room');
  perform pg_temp.ok((select count(*) from public.crews where created_by = lu) = 1 and (select count(*) from public.ev_room_profiles where crew_id = room_g) = 1, 'still exactly one room for the organiser');
  perform pg_temp.ok(ev.venue_name = 'Lekki Gardens' and (select edited from public.ev_pulled where id = v_b) @> array['venue'], 'a patch on approve is applied and remembered in edited');
  perform pg_temp.ok(ev.listed_price is null and ev.listed_price_max is null and ev.geog is null, 'no known price stays null, and no pin means no geog');
  perform pg_temp.ok(public.ev_o_ensure_room(org_g) = room_g and public.ev_o_ensure_room(org_g) = room_g, 'ensure_room twice gives the same room');
  perform pg_temp.ok(public.ev_o_approve(v_a, 'jae', null) ->> 'event_id' = ev_a::text and (select count(*) from public.events where source_site = 'tix' and source_id = 'a') = 1, 'approving an approved row updates its event, no second event');

  -- a free event (price 0 is a price) and a sold out one
  r := public.ev_o_approve(v_d, 'jae', null);
  ev_d := (r ->> 'event_id')::uuid;
  select * into ev from public.events where id = ev_d;
  perform pg_temp.ok(ev.listed_price = 0 and ev.listed_price_max = 0 and ev.title = 'Comedy Hour Live' and ev.venue_name = 'Terra Kulture', 'free is 0, and the edited name and venue go onto the event');
  select o.id into org_f from public.ev_organisers o where o.ig_handle = 'funny.co';
  perform pg_temp.ok((select room_id from public.ev_organisers where id = org_f) <> room_g, 'another organiser gets their own room');

  -- an event with no venue name
  r := public.ev_o_approve(pg_temp.pid('tix', 'good1'), 'jae', null);
  perform pg_temp.ok((select venue_name from public.events where id = (r ->> 'event_id')::uuid) = 'To be announced', 'no venue becomes the placeholder To be announced');

  -- ============================================================ a listing cannot be registered or bought ========
  begin
    insert into public.ev_registrations (event_id, user_id, status, name) values (ev_a, g, 'going', 'x');
    perform pg_temp.ok(false, 'a registration on a listing is refused');
  exception when others then
    perform pg_temp.ok(sqlerrm = 'external_tickets', 'registering on a listing is refused by the trigger: external_tickets');
  end;
  begin
    insert into public.ev_orders (buyer_id, event_id, quantity, unit_price_kobo, gross_kobo, platform_fee_kobo, host_account, bachs_reference, expires_at)
    values (g, ev_a, 1, 500000, 500000, 10000, 'acct', 'ref-' || gen_random_uuid(), now() + interval '1 hour');
    perform pg_temp.ok(false, 'an order on a listing is refused');
  exception when others then
    perform pg_temp.ok(sqlerrm = 'external_tickets', 'an order on a listing is refused by the trigger: external_tickets');
  end;

  -- ============================================================ reruns after approval ========
  -- unclaimed: price, sold out, link and time follow the source; a moved start is flagged
  t1 := (select starts_at from public.events where id = ev_a);
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'a', 'Gbedu Night', 10, 'Gbedu Collective', 'gbedu.ng', jsonb_build_object(
      'venue', 'The Shrine', 'lat', 6.60, 'lng', 3.35, 'pin_by', 'venues', 'category', 'Afrobeats party',
      'starts_at', public._ev_o_iso(t1 + interval '1 hour'),
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Early', 'price_naira', 6000, 'sold_out', true), jsonb_build_object('name', 'Gate', 'price_naira', 9000, 'sold_out', true)),
      'ticket_url', 'https://tix.example/gbedu-new', 'flyer_url', 'https://img.example/gbedu2.jpg')))), true);
  select * into ev from public.events where id = ev_a;
  perform pg_temp.ok((r ->> 'updated')::int = 1 and r -> 'lines' -> 0 ->> 'note' <> '', 'the rerun of an approved row is an update');
  perform pg_temp.ok(ev.listed_price = 6000 and ev.listed_price_max = 9000 and ev.listing_sold_out and ev.ticket_url = 'https://tix.example/gbedu-new' and ev.flyer_url = 'https://img.example/gbedu2.jpg',
                     'an unclaimed listing follows the source: price, sold out, link, flyer');
  perform pg_temp.ok(ev.starts_at = t1 + interval '1 hour', 'and the new start time');
  perform pg_temp.ok((select flags from public.ev_pulled where id = v_a) @> array['moved'], 'a moved start is flagged moved');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(public.ev_o_queue()) x where x ->> 'id' = v_a::text and x ->> 'status' = 'approved'), 'an approved row with a flag is back in the queue');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.ev_o_queue()) x where x ->> 'id' = v_b::text), 'an approved row with no flag is not');

  -- staff edit of an approved row goes to the event and clears the flag; a rerun then keeps it
  r := public.ev_o_edit(v_a, jsonb_build_object('ticket_url', 'https://edited.example/a'));
  perform pg_temp.ok(r -> 'edited' @> '["ticket_url"]'::jsonb and not (r -> 'flags' @> '["moved"]'::jsonb), 'edit marks the link edited and clears the moved flag');
  perform pg_temp.ok((select ticket_url from public.events where id = ev_a) = 'https://edited.example/a', 'the edit reaches the live listing');
  perform public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'a', 'Gbedu Night', 10, 'Gbedu Collective', 'gbedu.ng', jsonb_build_object(
      'venue', 'The Shrine', 'lat', 6.60, 'lng', 3.35, 'starts_at', public._ev_o_iso(t1 + interval '1 hour'),
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Early', 'price_naira', 7000, 'sold_out', false)),
      'ticket_url', 'https://tix.example/gbedu-newer')))), true);
  select * into ev from public.events where id = ev_a;
  perform pg_temp.ok(ev.ticket_url = 'https://edited.example/a' and ev.listed_price = 7000 and not ev.listing_sold_out, 'a rerun keeps the edited link on the event and still updates the rest');

  -- claimed: never touched, only flagged changed
  update public.events set host_id = u2 where id = ev_d;
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'd', 'Comedy Hour', 11, 'Funny Co', 'funny.co', jsonb_build_object('ticket_url', 'https://tix.example/funny-moved',
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Free', 'price_naira', 3000, 'sold_out', true)))))), true);
  select * into ev from public.events where id = ev_d;
  select * into p from public.ev_pulled where id = v_d;
  perform pg_temp.ok(ev.listed_price = 0 and ev.starts_at = (select (fields ->> 'starts_at')::timestamptz from public.ev_pulled where id = v_d) and ev.ticket_url = 'https://tix.example/funny' and not ev.listing_sold_out and ev.host_id = u2,
                     'a claimed listing is not touched by a rerun');
  perform pg_temp.ok(p.flags @> array['changed'] and (p.fields -> 'tickets' -> 0 ->> 'price_naira')::int = 0, 'it is flagged changed, and the pulled fields are left as they were');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(public.ev_o_queue()) x where x ->> 'id' = v_d::text), 'and it shows in the queue');
  update public.events set host_id = lu where id = ev_d;

  -- ============================================================ gone ========
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'a', 'Gbedu Night', 10, 'Gbedu Collective', 'gbedu.ng', jsonb_build_object('lat', 6.60, 'lng', 3.35, 'venue', 'The Shrine',
      'starts_at', public._ev_o_iso(t1 + interval '1 hour'), 'tickets', jsonb_build_array(jsonb_build_object('name', 'Early', 'price_naira', 7000, 'sold_out', false)))),
    pg_temp.sev('tix', 'd', 'Comedy Hour', 9, 'Funny Co', 'funny.co')), array['tix']), true);
  perform pg_temp.ok((r ->> 'flagged_gone')::int = 2 and (select count(*) from public.ev_pulled where source_site = 'tix' and flags @> array['gone']) = 2, 'two upcoming rows of the covered source were not seen: gone (the lead with no time cannot be judged)');
  select * into p from public.ev_pulled where id = v_b;
  perform pg_temp.ok(p.missing_since is not null and p.flags @> array['gone'], 'it gets missing_since and the gone flag');
  perform pg_temp.ok(not ((select flags from public.ev_pulled where id = v_g) @> array['gone']) and (select missing_since from public.ev_pulled where id = v_g) is null, 'a source the run did not cover is left alone');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(public.ev_o_queue()) x where x ->> 'id' = v_b::text), 'a gone approved row shows in the queue');
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'a', 'Gbedu Night', 10, 'Gbedu Collective', 'gbedu.ng', jsonb_build_object('lat', 6.60, 'lng', 3.35, 'venue', 'The Shrine',
      'starts_at', public._ev_o_iso(t1 + interval '1 hour'), 'tickets', jsonb_build_array(jsonb_build_object('name', 'Early', 'price_naira', 7000, 'sold_out', false)))),
    pg_temp.sev('tix', 'b', 'Sunset Brunch', 12, 'Gbedu Collective', null, jsonb_build_object('venue', 'Lekki Gardens')),
    pg_temp.sev('tix', 'd', 'Comedy Hour', 9, 'Funny Co', 'funny.co')), array['tix']), true);
  select * into p from public.ev_pulled where id = v_b;
  perform pg_temp.ok(p.missing_since is null and not (p.flags @> array['gone']) and (r ->> 'flagged_gone')::int = 0, 'seen again clears gone and missing_since');
  -- dry run flags nothing
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(pg_temp.sev('tix', 'a', 'Gbedu Night', 10, 'Gbedu Collective', 'gbedu.ng')), array['tix']), false);
  perform pg_temp.ok((r ->> 'flagged_gone')::int >= 1 and (select missing_since from public.ev_pulled where id = v_b) is null, 'a dry run reports gone rows but flags none');

  -- ============================================================ merge ========
  perform pg_temp.ok(public.ev_o_merge(v_g, v_g, 'jae') ->> 'reason' = 'same_row', 'merge of a row into itself is refused');
  perform pg_temp.ok(public.ev_o_merge(v_a, v_g, 'jae') ->> 'reason' = 'already_listed', 'a row that made a listing cannot be the loser');
  perform pg_temp.ok(public.ev_o_merge(v_g, gen_random_uuid(), 'jae') ->> 'reason' = 'not_found', 'merge into nothing is not_found');
  perform pg_temp.ok((public.ev_o_merge(v_g, v_a, 'jae') ->> 'ok')::boolean, 'merge the duplicate into the first row');
  select * into p from public.ev_pulled where id = v_g;
  perform pg_temp.ok(p.status = 'merged' and p.duplicate_of = v_a, 'the loser is merged and points at the winner');
  perform pg_temp.ok((select also_at -> 0 ->> 'source_site' from public.ev_pulled where id = v_a) = 'ticketspace' and (select also_at -> 0 ->> 'ticket_url' from public.ev_pulled where id = v_a) = 'https://ts.example/gbedu',
                     'its source is kept on the winner as also_at');
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(pg_temp.sev('ticketspace', 'g1', 'GBEDU NIGHT!', 10, 'Gbedu Collective', 'gbedu.ng'))), true);
  perform pg_temp.ok((r ->> 'unchanged')::int = 1 and (select status from public.ev_pulled where id = v_g) = 'merged', 'a rerun does not bring a merged row back');
  perform pg_temp.ok(public.ev_o_merge(v_c, v_g, 'jae') ->> 'reason' = 'bad_target', 'a merged row is not a target');
  perform pg_temp.ok(public.ev_o_reject(v_a, 'jae', 'x') ->> 'reason' = 'already_listed', 'a row with a live listing is not rejected');
  r := public.ev_o_reject(v_c, 'jae', 'not a real show');
  perform pg_temp.ok((r ->> 'ok')::boolean and (select status from public.ev_pulled where id = v_c) = 'rejected'
                     and (select reject_reason from public.ev_pulled where id = v_c) = 'not a real show', 'reject closes the row with the reason');
  r := public.ev_o_import(b, true);
  perform pg_temp.ok((select status from public.ev_pulled where id = v_c) = 'rejected', 'a rerun does not bring a rejected row back');

  -- ============================================================ organisers ========
  r := public.ev_o_organisers();
  perform pg_temp.ok(jsonb_typeof(r) = 'array' and jsonb_array_length(r) = (select count(*) from public.ev_organisers), 'the organiser list');
  select x into q from jsonb_array_elements(r) x where x ->> 'id' = org_g::text;
  perform pg_temp.ok(q ->> 'room_id' = room_g::text and q ->> 'room_slug' = 'gbedu-collective' and q ->> 'room_name' = 'Gbedu Collective' and q ->> 'stage' = 'listed'
                     and (q ->> 'events_total')::int = 2 and (q ->> 'events_upcoming')::int = 2 and (q ->> 'pulled_waiting')::int = 0 and not (q ->> 'transfer_pending')::boolean and (q ->> 'claim_requests')::int = 0,
                     'an Organiser has the fields of the type');
  perform pg_temp.ok(q ?& array['id', 'name', 'ig_handle', 'handles', 'email', 'phone', 'room_id', 'room_slug', 'room_name', 'stage', 'do_not_contact', 'last_contacted_at', 'last_contacted_by', 'notes',
                                 'claimed_at', 'declined_at', 'created_at', 'events_total', 'events_upcoming', 'pulled_waiting', 'transfer_pending', 'claim_requests'], 'and no field is missing');
  r := public.ev_o_organiser(org_g);
  perform pg_temp.ok(r ?& array['organiser', 'log', 'events', 'transfers'] and jsonb_array_length(r -> 'events') = 2 and jsonb_array_length(r -> 'log') >= 3, 'an OrganiserDetail has organiser, log, events and transfers');
  perform pg_temp.ok(r -> 'events' -> 0 ?& array['id', 'title', 'starts_at', 'status', 'ticket_url', 'upcoming'] and (r -> 'events' -> 0 ->> 'upcoming')::boolean and r -> 'events' -> 0 ->> 'status' = 'live', 'event rows have the fields of the type');
  perform pg_temp.ok(r -> 'log' -> 0 ?& array['id', 'organiser_id', 'at', 'by', 'kind', 'channel', 'body'], 'log rows have the fields of the type');
  perform pg_temp.ok(public.ev_o_organiser(gen_random_uuid()) ->> 'reason' = 'not_found', 'an unknown organiser is not_found');
  r := public.ev_o_save_organiser(org_g, '{"notes": "Met at the Shrine", "phone": "+2348000000000", "name": "Gbedu Collective Lagos", "email": "Team@Gbedu.ng"}'::jsonb);
  perform pg_temp.ok(r ->> 'notes' = 'Met at the Shrine' and r ->> 'phone' = '+2348000000000' and r ->> 'email' = 'team@gbedu.ng' and r ->> 'name' = 'Gbedu Collective Lagos', 'save changes only the keys sent');
  perform pg_temp.ok((select name_key from public.ev_organisers where id = org_g) = 'gbeducollectivelagos', 'a new name makes a new name key');
  perform pg_temp.ok(public.ev_o_save_organiser(org_g, '{"ig_handle": "@funny.co"}'::jsonb) ->> 'reason' = 'handle_taken', 'a handle another organiser has is handle_taken');
  perform pg_temp.ok(public.ev_o_save_organiser(org_g, '{"ig_handle": "bad handle!"}'::jsonb) ->> 'reason' = 'bad_handle' and public.ev_o_save_organiser(org_g, '{"email": "nope"}'::jsonb) ->> 'reason' = 'bad_email'
                     and public.ev_o_save_organiser(org_g, '{"name": " "}'::jsonb) ->> 'reason' = 'bad_name', 'bad handle, email and name are refused');
  perform pg_temp.ok(public.ev_o_save_organiser(org_g, '{"ig_handle": "@Gbedu.NG"}'::jsonb) ->> 'ig_handle' = 'gbedu.ng', 'saving their own handle again is fine');
  perform pg_temp.ok(public.ev_o_save_organiser(org_g, '{"handles": {"website": "https://gbedu.ng", "x": "gbedu"}}'::jsonb) -> 'handles' ->> 'website' = 'https://gbedu.ng'
                     and public.ev_o_save_organiser(org_g, '{"handles": {"myspace": "x"}}'::jsonb) ->> 'reason' = 'bad_input', 'handles accept only the known keys');
  perform public.ev_o_save_organiser(org_g, '{"name": "Gbedu Collective"}'::jsonb);

  -- ============================================================ contact log, stages, claim requests ========
  perform pg_temp.ok((public.ev_o_log(org_f, 'jae', 'contact', 'whatsapp', 'Sent the offer') ->> 'ok')::boolean, 'log a contact');
  perform pg_temp.ok((select last_contacted_by from public.ev_organisers where id = org_f) = 'jae' and (select last_contacted_at from public.ev_organisers where id = org_f) is not null, 'a contact sets last contacted');
  perform public.ev_o_log(org_f, 'ada', 'contact', 'instagram', 'Followed up');
  perform public.ev_o_log(org_f, 'jae', 'reply', 'instagram', 'They are interested');
  perform pg_temp.ok((select stage from public.ev_organisers where id = org_f) = 'listed', 'logging never changes the stage');
  perform pg_temp.ok(public.ev_o_log(org_f, 'jae', 'note', null, 'Call Friday') ->> 'ok' = 'true' and (select last_contacted_by from public.ev_organisers where id = org_f) = 'ada', 'a note does not count as contact');
  perform pg_temp.ok(public.ev_o_log(org_f, 'jae', 'stage', null, 'x') ->> 'reason' = 'bad_kind' and public.ev_o_log(org_f, 'jae', 'note', 'pigeon', 'x') ->> 'reason' = 'bad_channel'
                     and public.ev_o_log(gen_random_uuid(), 'jae', 'note', null, 'x') ->> 'reason' = 'not_found', 'bad kind, bad channel and unknown organiser are refused');
  r := public.ev_o_set_stage(org_f, 'offered', 'jae');
  perform pg_temp.ok(r ->> 'stage' = 'offered', 'set the stage to offered');

  insert into public.ev_claim_requests (event_id, organiser_id, name, email) values (ev_a, org_g, 'Ada Obi', 'ada@evtest.invalid') returning id into cr;
  insert into public.ev_organiser_log (organiser_id, kind, body) values (org_g, 'claim_request', 'Is this your event? from Ada Obi');
  r := public.ev_o_claim_requests();
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'event_title' = 'Gbedu Night' and r -> 0 ->> 'organiser_name' = 'Gbedu Collective' and r -> 0 ->> 'status' = 'new' and r -> 0 ->> 'email' = 'ada@evtest.invalid',
                     'claim requests list with the event title and organiser name');
  perform pg_temp.ok((select (x ->> 'claim_requests')::int from jsonb_array_elements(public.ev_o_organisers()) x where x ->> 'id' = org_g::text) = 1, 'and the organiser counts it');

  -- the week
  update public.ev_organisers set last_contacted_at = now() - interval '10 days' where id = org_g;
  insert into public.ev_organiser_log (organiser_id, at, kind, body)
  select org_g, now() - interval '9 days', 'contact', 'earlier' from generate_series(1, 3);
  insert into public.ev_organiser_log (organiser_id, at, kind, body) values (org_g, now() - interval '20 days', 'contact', 'long ago');
  r := public.ev_o_week();
  perform pg_temp.ok((r ->> 'contacted')::int = 2 and (r ->> 'replies')::int = 1 and (r ->> 'offers')::int = 1 and (r ->> 'claimed')::int = 0, 'week: contacted 2, replies 1, offers 1, claimed 0');
  perform pg_temp.ok((r ->> 'listed')::int = 3 and (r ->> 'declined')::int = 1 and (r ->> 'claim_requests')::int = 1, 'week: listed 3 (Gbedu, Funny Co, Skip Org), declined 1, claim requests 1');
  perform pg_temp.ok((r ->> 'pulled_new')::int = (select count(*) from public.ev_pulled) and (r ->> 'rejected')::int = 1, 'week: new pulled rows and rejections come from the pulled table');
  perform pg_temp.ok((r -> 'previous' ->> 'contacted')::int = 3 and (r -> 'previous' ->> 'replies')::int = 0, 'the week before is counted apart (3 contacts nine days ago, none 20 days ago)');
  perform pg_temp.ok((r -> 'stages' ->> 'listed')::int + (r -> 'stages' ->> 'pulled')::int + (r -> 'stages' ->> 'offered')::int + (r -> 'stages' ->> 'declined')::int + (r -> 'stages' ->> 'claimed')::int = (select count(*) from public.ev_organisers)
                     and (r -> 'stages' ->> 'declined')::int = 1 and (r -> 'stages' ->> 'offered')::int = 1, 'week: organisers by stage now');
  perform pg_temp.ok(jsonb_array_length(r -> 'waiting') = 1 and r -> 'waiting' -> 0 ->> 'id' = org_g::text and (r -> 'waiting' -> 0 ->> 'days')::int = 10, 'waiting: listed with no contact for 7 days or more');
  perform pg_temp.ok(r ?& array['from', 'to', 'contacted', 'replies', 'offers', 'claimed', 'declined', 'listed', 'pulled_new', 'rejected', 'claim_requests', 'stages', 'waiting', 'previous'], 'the week has every field of the type');
  r := public.ev_o_handle_claim_request(cr, 'jae');
  perform pg_temp.ok((r ->> 'ok')::boolean and (select status from public.ev_claim_requests where id = cr) = 'handled'
                     and public.ev_o_handle_claim_request(gen_random_uuid(), 'jae') ->> 'reason' = 'not_found', 'handle a claim request');
  perform pg_temp.ok(public.ev_o_claim_requests() -> 0 ->> 'status' = 'handled', 'a handled request still shows for a while, marked handled');

  -- ============================================================ stage rules ========
  perform pg_temp.ok(public.ev_o_set_stage(org_f, 'claimed', 'jae') ->> 'reason' = 'bad_stage' and public.ev_o_set_stage(org_f, 'pulled', 'jae') ->> 'reason' = 'bad_stage', 'claimed and pulled cannot be set by hand');
  perform pg_temp.ok(public.ev_o_set_stage(gen_random_uuid(), 'listed', 'jae') ->> 'reason' = 'not_found', 'an unknown organiser is not_found');
  perform pg_temp.ok(public.ev_o_set_stage(org_b, 'offered', 'jae') ->> 'reason' = 'organiser_declined', 'a declined organiser cannot be offered until reopened');
  select o.id into org_l from public.ev_organisers o where o.name_key = 'leadorg';
  update public.ev_organisers set stage = 'claimed', claimed_at = now() where id = org_l;
  perform pg_temp.ok(public.ev_o_set_stage(org_l, 'declined', 'jae') ->> 'reason' = 'is_claimed' and public.ev_o_set_stage(org_l, 'listed', 'jae') ->> 'reason' = 'is_claimed', 'a claimed organiser cannot be moved');
  update public.ev_organisers set stage = 'pulled', claimed_at = null where id = org_l;
  r := public.ev_o_set_stage(org_b, 'listed', 'jae');
  perform pg_temp.ok(r ->> 'stage' = 'listed' and not (r ->> 'do_not_contact')::boolean and r ->> 'declined_at' is null, 'listed reopens: stage listed, do_not_contact cleared, declined_at cleared');
  perform pg_temp.ok((select status from public.ev_pulled where id = v_e) = 'new' and (select status from public.ev_pulled where id = v_f) = 'new'
                     and not ((select flags from public.ev_pulled where id = v_e) @> array['blocked']), 'and their blocked rows are free again');
  perform pg_temp.ok((select (x ->> 'pulled_waiting')::int from jsonb_array_elements(public.ev_o_organisers()) x where x ->> 'id' = org_b::text) = 2, 'the organiser shows 2 rows waiting');
  r := public.ev_o_save_organiser(org_b, '{"do_not_contact": true}'::jsonb);
  perform pg_temp.ok((r ->> 'do_not_contact')::boolean and (select status from public.ev_pulled where id = v_e) = 'blocked', 'do_not_contact alone also blocks');
  perform pg_temp.ok(public.ev_o_approve(v_e, 'jae', null) ->> 'reason' = 'blocked', 'and approve refuses');
  perform public.ev_o_save_organiser(org_b, '{"do_not_contact": false}'::jsonb);
  perform pg_temp.ok((select status from public.ev_pulled where id = v_e) = 'new', 'switching it off frees them');

  -- ============================================================ one room each, even with the same name ========
  perform public.ev_o_import(pg_temp.batch(jsonb_build_array(pg_temp.sev('dup', '1', 'Dup One', 20, 'Same Name Crew', 'same.one'), pg_temp.sev('dup', '2', 'Dup Two', 21, 'Same Name Crew', 'same.two'))), true);
  perform pg_temp.ok((select count(*) from public.ev_organisers where name_key = 'samenamecrew') = 2, 'same name but different handles are two organisers');
  r := public.ev_o_approve(pg_temp.pid('dup', '1'), 'jae', null); r2 := public.ev_o_approve(pg_temp.pid('dup', '2'), 'jae', null);
  select p1.slug, p2.slug into s1, s2 from public.ev_room_profiles p1, public.ev_room_profiles p2
   where p1.crew_id = (select room_id from public.ev_organisers where id = (r ->> 'organiser_id')::uuid) and p2.crew_id = (select room_id from public.ev_organisers where id = (r2 ->> 'organiser_id')::uuid);
  perform pg_temp.ok(s1 = 'same-name-crew' and s2 = 'same-name-crew-2', 'two rooms with the same name get different addresses');

  -- ============================================================ delete ========
  -- a guest holds a place on Sunset Brunch (made while the event was still a Hoppaz one), and Funny Co has a paid order
  update public.events set ticket_mode = 'hoppaz' where id in (ev_b, ev_d);
  insert into public.ev_registrations (event_id, user_id, status, name) values (ev_b, g, 'going', 'Guest');
  insert into public.ev_orders (buyer_id, event_id, quantity, unit_price_kobo, gross_kobo, platform_fee_kobo, host_account, bachs_reference, expires_at, status)
  values (g, ev_d, 1, 500000, 500000, 10000, 'acct', 'ref-' || gen_random_uuid(), now() + interval '1 hour', 'paid') returning id into v_order;
  update public.events set ticket_mode = 'external' where id in (ev_b, ev_d);

  perform pg_temp.ok(public.ev_o_delete(org_g, 'wrong name', 'jae') ->> 'reason' = 'confirm_name' and public.ev_o_delete(org_g, null, 'jae') ->> 'reason' = 'confirm_name', 'delete needs the organiser name typed');
  perform pg_temp.ok(public.ev_o_delete(gen_random_uuid(), 'x', 'jae') ->> 'reason' = 'not_found', 'an unknown organiser is not_found');
  r := public.ev_o_delete(org_g, 'Gbedu Collective', 'jae');
  perform pg_temp.ok(r ->> 'reason' = 'has_registrations' and jsonb_array_length(r -> 'events') = 1 and r -> 'events' -> 0 ->> 'title' = 'Sunset Brunch' and (r -> 'events' -> 0 ->> 'count')::int = 1,
                     'delete is refused while someone is registered, and names the event and the count');
  perform pg_temp.ok(exists (select 1 from public.events where id = ev_b) and exists (select 1 from public.crews where id = room_g), 'a refused delete removes nothing');
  r := public.ev_o_delete(org_f, 'funny co', 'jae');
  perform pg_temp.ok(r ->> 'reason' = 'has_registrations' and r -> 'events' -> 0 ->> 'title' = 'Comedy Hour Live', 'a paid order also blocks delete');
  update public.ev_orders set status = 'expired' where id = v_order;
  update public.ev_registrations set status = 'cancelled' where event_id = ev_b;

  -- a claimed organiser cannot be deleted
  update public.ev_organisers set stage = 'claimed' where id = org_f;
  perform pg_temp.ok(public.ev_o_delete(org_f, 'Funny Co', 'jae') ->> 'reason' = 'is_claimed', 'a claimed organiser cannot be deleted');
  update public.ev_organisers set stage = 'offered' where id = org_f;

  r := public.ev_o_delete(org_g, 'Gbedu Collective', 'jae');
  perform pg_temp.ok((r ->> 'ok')::boolean and (r ->> 'events')::int = 2, 'once the registration is cancelled the delete goes through (2 events)');
  perform pg_temp.ok(not exists (select 1 from public.events where organiser_id = org_g) and not exists (select 1 from public.events where id in (ev_a, ev_b)), 'the events are gone');
  perform pg_temp.ok(not exists (select 1 from public.crews where id = room_g) and not exists (select 1 from public.ev_room_profiles where crew_id = room_g), 'the room is gone');
  select * into p from public.ev_pulled where id = v_a;
  perform pg_temp.ok(exists (select 1 from public.ev_organisers where id = org_g and stage = 'declined' and do_not_contact and room_id is null and declined_at is not null), 'the organiser row stays: declined, do not contact, no room');
  perform pg_temp.ok(p.status = 'rejected' and p.event_id is null and p.reject_reason is not null, 'their approved rows are closed');
  perform pg_temp.ok(exists (select 1 from public.ev_organiser_log where organiser_id = org_g and kind = 'delete' and by_name = 'jae'), 'a delete line is logged');
  -- the next scrape does not list them again
  r := public.ev_o_import(pg_temp.batch(jsonb_build_array(
    pg_temp.sev('tix', 'a', 'Gbedu Night', 10, 'Gbedu Collective', 'gbedu.ng'),
    pg_temp.sev('tix', 'h', 'Gbedu New Show', 14, 'Gbedu Collective', 'gbedu.ng'))), true);
  v_h := pg_temp.pid('tix', 'h');
  perform pg_temp.ok((r ->> 'blocked')::int = 1 and (r ->> 'new')::int = 0 and (select status from public.ev_pulled where id = v_h) = 'blocked' and (select organiser_id from public.ev_pulled where id = v_h) = org_g,
                     'the next import blocks their new event and uses the same organiser');
  perform pg_temp.ok((select status from public.ev_pulled where id = v_a) = 'rejected' and not exists (select 1 from public.events where source_id = 'a' and source_site = 'tix'), 'and the deleted event does not come back');
  perform pg_temp.ok(public.ev_o_approve(v_h, 'jae', null) ->> 'reason' = 'blocked', 'approve refuses them');
  -- delete with an expired order: the order goes with the event
  r := public.ev_o_delete(org_f, 'Funny Co', 'jae');
  perform pg_temp.ok((r ->> 'ok')::boolean and not exists (select 1 from public.ev_orders where id = v_order) and not exists (select 1 from public.events where id = ev_d), 'an expired order does not stop a delete and goes with the event');

  -- ============================================================ access ========
  perform pg_temp.ok(not has_function_privilege('anon', 'public.ev_o_import(jsonb, boolean)', 'execute') and not has_function_privilege('authenticated', 'public.ev_o_import(jsonb, boolean)', 'execute')
                     and has_function_privilege('service_role', 'public.ev_o_import(jsonb, boolean)', 'execute'), 'ev_o_import is service role only');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.ev_o_delete(uuid, text, text)', 'execute') and not has_function_privilege('authenticated', 'public.ev_o_approve(uuid, text, jsonb)', 'execute')
                     and not has_function_privilege('authenticated', 'public.ev_o_ensure_room(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.ev_o_week()', 'execute')
                     and not has_function_privilege('authenticated', 'public._ev_name_key(text)', 'execute') and has_function_privilege('service_role', 'public.ev_o_week()', 'execute'),
                     'the rest are service role only too');
  perform pg_temp.ok(public._ev_name_key('Café Ọ̀ṣun #1 !') = 'cafeosun1' and public._ev_name_key(null) = '' and public._ev_name_key('GBEDU night') = 'gbedunight', 'the name key folds accents and drops everything but letters and digits');
  raise notice 'ALL EVENTS R1 OUTREACH TESTS PASSED';
end $$;
rollback;
