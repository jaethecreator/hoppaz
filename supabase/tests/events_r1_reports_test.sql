-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Release 1 reports (supabase/events_r1_reports.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, events_r1_events.sql and events_r1_reports.sql loaded (the registrations file is used for
-- one check if it is loaded too). Ends with ALL EVENTS R1 REPORTS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_reports_test.sql
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
-- The staff desk's door: the service role, as the admin routes use.
create function pg_temp.svc() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.newuser(shown text, guest boolean default false) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          case when guest then null else 'rep-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
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
create function pg_temp.ev(host uuid, ttl text, vis text default 'public') returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id, visibility)
  values (ttl, 'Somewhere', now() + interval '2 days', 'live', host, vis) returning id;
$$;
create function pg_temp.rep(u uuid, ev uuid, reason text default 'fake_or_scam', note text default '') returns text language plpgsql as $$
begin
  return pg_temp.t(u, format('select public.ev_report_event(%L, %L, %L)', ev, reason, note));
end $$;
create function pg_temp.listed(u uuid, ev uuid) returns boolean language plpgsql as $$
begin
  return exists (select 1 from jsonb_array_elements(pg_temp.j(u, 'select public.ev_list_events()')) q where q ->> 'id' = ev::text);
end $$;
create function pg_temp.stat(ev uuid) returns text language sql as $$ select status from public.events where id = ev; $$;
create function pg_temp.desk() returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.svc();
  select public.ev_admin_reports() into r;
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.review(rid uuid, restore boolean default false) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.svc();
  select public.ev_admin_review_report(rid, restore) into r;
  perform pg_temp.admin();
  return r;
end $$;

do $$
declare
  h uuid := pg_temp.newuser('Rep Host'); x uuid := pg_temp.newuser('Rep Stranger'); g uuid := pg_temp.newuser('Rep Guest', true);
  r1 uuid := pg_temp.newuser('Rep One'); r2 uuid := pg_temp.newuser('Rep Two'); r3 uuid := pg_temp.newuser('Rep Three');
  r4 uuid := pg_temp.newuser('Rep Four'); r5 uuid := pg_temp.newuser('Rep Five'); r6 uuid := pg_temp.newuser('Rep Six');
  e1 uuid; e2 uuid; e3 uuid; ex uuid; rid uuid; r jsonb; n int; f record; i int;
begin
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ev_reports', 'select') and not has_table_privilege('anon', 'public.ev_reports', 'select'),
                     'the reports table is closed to anon and authenticated');
  e1 := pg_temp.ev(h, 'Report me');

  -- Who may report, and the checks.
  perform pg_temp.ok(pg_temp.rep(g, e1) = 'need_account', 'a guest with no account cannot report');
  begin
    perform pg_temp.anon();
    perform public.ev_report_event(e1, 'other', '');
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not report');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot call ev_report_event');
  end;
  perform pg_temp.ok(pg_temp.rep(h, e1) = 'own_event', 'a host cannot report their own event');
  perform pg_temp.ok(pg_temp.rep(x, gen_random_uuid()) = 'not_found', 'an unknown event is not_found');
  perform pg_temp.ok(pg_temp.rep(x, e1, 'rude') = 'bad_reason', 'an unknown reason is refused');
  perform pg_temp.ok(pg_temp.rep(x, e1, 'other', repeat('n', 1001)) = 'note_too_long', 'a note over 1000 characters is refused');
  perform pg_temp.ok(pg_temp.rep(x, e1, 'wrong_place', 'The map pin is in the lagoon') = 'ok', 'a report goes');
  perform pg_temp.ok(pg_temp.rep(x, e1, 'offensive') = 'already_reported' and (select count(*) from public.ev_reports where event_id = e1 and reporter_id = x) = 1, 'one report per person per event');
  perform pg_temp.ok((select reason from public.ev_reports where event_id = e1 and reporter_id = x) = 'wrong_place' and (select note from public.ev_reports where event_id = e1 and reporter_id = x) like '%lagoon%',
                     'the first report is the one kept, with its note');

  -- Two reports are not enough; three different people hide it.
  perform pg_temp.ok(pg_temp.rep(r1, e1, 'fake_or_scam') = 'ok', 'a second person reports');
  perform pg_temp.ok(pg_temp.stat(e1) = 'live' and pg_temp.listed(r2, e1), 'two reports: still live and listed');
  perform pg_temp.ok(pg_temp.rep(r2, e1, 'offensive') = 'ok', 'a third person reports');
  perform pg_temp.ok(pg_temp.stat(e1) = 'hidden', 'three reports from three people: hidden');
  perform pg_temp.ok(not pg_temp.listed(r3, e1) and not pg_temp.listed(x, e1), 'a hidden event is not in the list');
  perform pg_temp.ok(pg_temp.j(r3, format('select public.ev_get_event(%L)', e1)) is null, 'and a stranger cannot open it');
  perform pg_temp.ok(pg_temp.j(h, format('select public.ev_get_event(%L)', e1)) ->> 'status' = 'hidden', 'but the host can, and sees it is hidden');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(pg_temp.j(h, 'select public.ev_my_events()')) q where q ->> 'id' = e1::text and q ->> 'status' = 'hidden'), 'and sees it in their own events as hidden');
  perform pg_temp.ok(pg_temp.rep(r3, e1) = 'not_found', 'nobody else can report a hidden event any more');
  perform pg_temp.actor(x);
  select count(*) into n from public.events where id = e1;
  perform pg_temp.admin();
  perform pg_temp.ok(n = 0, 'the old public read policy does not show a hidden event either');
  if to_regprocedure('public.ev_register(uuid, jsonb)') is not null then
    perform pg_temp.ok(pg_temp.j(r4, format('select public.ev_register(%L, %L::jsonb)', e1, '{}')) ->> 'reason' = 'not_found', 'a hidden event takes no registrations');
  end if;

  -- Fewer than three different people never hide, whatever they do.
  e2 := pg_temp.ev(h, 'Two reporters');
  perform pg_temp.rep(r1, e2); perform pg_temp.rep(r1, e2, 'other'); perform pg_temp.rep(r2, e2);
  perform pg_temp.ok(pg_temp.stat(e2) = 'live', 'the same person twice does not count twice');

  -- The staff desk.
  r := pg_temp.desk();
  perform pg_temp.ok(jsonb_typeof(r) = 'array' and jsonb_array_length(r) >= 5 and (r -> 0 ->> 'created_at')::timestamptz >= (r -> 4 ->> 'created_at')::timestamptz, 'staff see the reports, newest first');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r) q where q ->> 'event_id' = e1::text and q ->> 'event_title' = 'Report me' and q ->> 'event_status' = 'hidden'
                                and q ->> 'reporter_name' = 'Rep Stranger' and q ->> 'reason' = 'wrong_place' and q ->> 'status' = 'open' and (q ->> 'open_reports')::int = 3),
                     'each report carries the event name and status, the reporter, the reason and how many are open on that event');
  begin
    perform pg_temp.actor(x);
    perform public.ev_admin_reports();
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a signed-in user must not read the desk');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a signed-in user cannot call ev_admin_reports');
  end;
  begin
    perform pg_temp.actor(h);
    perform public.ev_admin_review_report(gen_random_uuid(), true);
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a host must not review reports');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a signed-in user cannot call ev_admin_review_report');
  end;
  begin
    perform pg_temp.anon();
    perform public.ev_admin_reports();
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not read the desk');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot call ev_admin_reports');
  end;

  -- Reviewing without restoring leaves it hidden.
  select id into rid from public.ev_reports where event_id = e1 and reporter_id = x;
  r := pg_temp.review(rid);
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'event_status' = 'hidden' and (select status from public.ev_reports where id = rid) = 'reviewed'
                     and (select reviewed_at from public.ev_reports where id = rid) is not null, 'marking one report reviewed keeps the event hidden');
  perform pg_temp.ok(pg_temp.review(gen_random_uuid()) ->> 'reason' = 'not_found', 'an unknown report is not_found');
  -- Restoring puts it back and starts the count again.
  r := pg_temp.review(rid, true);
  perform pg_temp.ok((r ->> 'ok')::boolean and r ->> 'event_status' = 'live' and pg_temp.stat(e1) = 'live' and pg_temp.listed(r3, e1)
                     and not exists (select 1 from public.ev_reports where event_id = e1 and status = 'open'), 'restore: every open report is reviewed and the event is back');
  perform pg_temp.ok(pg_temp.rep(r4, e1) = 'ok', 'a new person reports');
  perform pg_temp.ok(pg_temp.rep(r5, e1) = 'ok', 'and another');
  perform pg_temp.ok(pg_temp.stat(e1) = 'live', 'it takes three new reports to hide it again: two do not');
  perform pg_temp.ok(pg_temp.rep(r6, e1) = 'ok', 'the third new report');
  perform pg_temp.ok(pg_temp.stat(e1) = 'hidden', 'hides it again');

  -- A community or invite event goes back to unlisted, never to the public list.
  e3 := pg_temp.ev(h, 'Invite only report', 'invite');
  perform pg_temp.ok(pg_temp.stat(e3) = 'unlisted', 'an invite event is stored unlisted');
  perform pg_temp.rep(r1, e3); perform pg_temp.rep(r2, e3); perform pg_temp.rep(r3, e3);
  perform pg_temp.ok(pg_temp.stat(e3) = 'hidden', 'three reports hide an unlisted event too');
  select id into rid from public.ev_reports where event_id = e3 limit 1;
  r := pg_temp.review(rid, true);
  perform pg_temp.ok(r ->> 'event_status' = 'unlisted' and pg_temp.stat(e3) = 'unlisted' and not pg_temp.listed(x, e3), 'restoring an invite event makes it unlisted again, not public');

  -- The daily limit.
  for i in 1..21 loop
    ex := pg_temp.ev(h, 'Spam target ' || i);
    perform pg_temp.rep(r6, ex);
  end loop;
  perform pg_temp.ok((select count(*) from public.ev_reports where reporter_id = r6 and created_at > now() - interval '1 day') = 20, 'a person can send 20 reports a day, no more');
  perform pg_temp.ok(pg_temp.rep(r6, pg_temp.ev(h, 'One more')) = 'slow_down', 'the next one is slow_down');

  -- Access.
  for f in select p.oid::regprocedure as sig, p.proname as name
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.proname in ('ev_report_event', 'ev_admin_reports', 'ev_admin_review_report')
  loop
    perform pg_temp.ok(not has_function_privilege('anon', f.oid, 'execute'), f.sig || ': anon cannot call');
    perform pg_temp.ok(has_function_privilege('authenticated', f.oid, 'execute') = (f.name = 'ev_report_event'), f.sig || ': authenticated access is as designed');
    perform pg_temp.ok(has_function_privilege('service_role', f.oid, 'execute') = (f.name <> 'ev_report_event'), f.sig || ': service role access is as designed');
  end loop;
  raise notice 'ALL EVENTS R1 REPORTS TESTS PASSED';
end $$;
rollback;
