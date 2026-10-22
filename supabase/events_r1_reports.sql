-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1, file 5 of 6: Report this event, the automatic hide, and the staff desk.
-- Written from src/lib/events-r1/fake/reports.ts and section 5 of notes/luma/08-ticketing-framework.md ("fake events or scam hosts:
-- silent posting rate limit, Report button, events with several reports hidden until staff check").
--
-- RUN ORDER: schema.sql, chat_accounts.sql, crew_rooms.sql, events_r1_events.sql, then THIS FILE (it needs only events, profiles,
--            has_account() and the helpers of the events file). The registrations file is not needed. Safe to run again.
--
-- WHAT IT IS. Nobody waits in a queue to publish an event. Instead anyone with an account can report an event, and an event that
-- three different people have reported (and staff have not yet looked at) is hidden by itself until staff check it.
--
--   ev_reports                 one row per report: the event, the reporter, the reason (fake_or_scam | wrong_place | offensive | other),
--                              a note (up to 1000 characters), status open | reviewed. unique (event_id, reporter_id): one report per
--                              person per event. Closed to anon and authenticated.
--
--   ev_report_event(event, reason, note)   a person with an account. Text: ok | no_session | need_account | not_found | bad_reason |
--                              note_too_long | own_event | already_reported | slow_down (20 reports a day per person). A guest with no
--                              email cannot report, so three throwaway guest sessions cannot hide someone's event.
--                              AUTO-HIDE: when an event has 3 or more OPEN reports from 3 different ACCOUNTS THAT ARE MORE THAN 7 DAYS OLD
--                              (auth.users.created_at: accounts are free, so a fresh one counts for nothing), its status becomes
--                              'hidden' (a value events_r1_events.sql added to the status check). Never auto-hidden: an event with no host
--                              (an old listing), or an event with a paid order (paid, refund pending or refunded): those are for staff only.
--                              A hidden event is not listed, cannot be opened by anyone but its host and staff, takes no registrations and
--                              sends no Pops. Its guests and registrations are not touched, and its DOOR STILL WORKS (scan, manual check in, counts):
--                              hidden is for the lists only, so a report can never shut a door. Hosts see it in ev_my_events with status hidden.
--   ev_admin_reports()                     staff only: every report, newest first, as { id, event_id, event_title, event_status,
--                              reporter_id, reporter_name, reason, note, created_at, status, open_reports } (the Report type with
--                              three extra fields for the desk).
--   ev_admin_review_report(report, restore)  staff only. Marks the report reviewed. With restore true it also marks every open report on
--                              that event reviewed and puts a hidden event back (live, or unlisted if it is community or invite only),
--                              so it takes three NEW reports to hide it again. Without restore the event stays hidden.
--                              { ok, event_status } or { ok: false, reason: not_found }.
--
-- THE STAFF DESK. How staff work in this repo today: /admin pages call server routes (src/app/api/admin/*/route.ts) that check the shared
-- token HOPPAZ_ADMIN_TOKEN and then use the service role key (createClient with SUPABASE_SECRET_KEY) to call the database. This file
-- mirrors that: ev_admin_reports and ev_admin_review_report are executable by service_role ONLY (revoked from public, anon and
-- authenticated), and read no auth.uid(). A route src/app/api/admin/event-reports/route.ts has to be written, like the game-time
-- one, calling these two with the service client. The staff are not named, as today (one shared token). The framework doc says
-- refunds and payouts need named staff and an audit log before money flows; that is for Release 2, not here.
--
-- One thing to decide: three people with week-old accounts can still hide a rival's (free, hosted) event from the lists until staff look.
-- That is the price of "no queue, publish at once". Raise the number in ev_report_event (the 3) if it is too easy.
-- ============================================================================
begin;

create table if not exists public.ev_reports (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null check (reason in ('fake_or_scam', 'wrong_place', 'offensive', 'other')),
  note        text not null default '' check (char_length(note) <= 1000),
  status      text not null default 'open' check (status in ('open', 'reviewed')),
  created_at  timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  unique (event_id, reporter_id)
);
create index if not exists ev_reports_event_idx on public.ev_reports (event_id, status);
create index if not exists ev_reports_open_idx on public.ev_reports (created_at desc) where status = 'open';
create index if not exists ev_reports_reporter_idx on public.ev_reports (reporter_id, created_at desc);
alter table public.ev_reports enable row level security;
revoke all on public.ev_reports from anon, authenticated;
grant all on public.ev_reports to service_role;

create or replace function public.ev_report_event(p_event uuid, p_reason text, p_note text default '') returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me     uuid := auth.uid();
  e      public.events;
  v_note text := btrim(coalesce(p_note, ''));
  v_id   uuid;
  v_paid boolean := false;
begin
  if not public._ev_open() then return 'not_open'; end if;
  if me is null then return 'no_session'; end if;
  if not public.has_account() then return 'need_account'; end if;
  select * into e from public.events where id = p_event;
  if e.id is null or not public._ev_can_open(p_event) then return 'not_found'; end if;
  if p_reason is null or p_reason not in ('fake_or_scam', 'wrong_place', 'offensive', 'other') then return 'bad_reason'; end if;
  if char_length(v_note) > 1000 then return 'note_too_long'; end if;
  if me = coalesce(e.host_id, e.created_by) then return 'own_event'; end if;
  if (select count(*) from public.ev_reports x where x.reporter_id = me and x.created_at > now() - interval '1 day') >= 20 then
    return 'slow_down';
  end if;

  -- One at a time per event, so two reports that arrive together are both counted.
  perform pg_advisory_xact_lock(hashtextextended('ev-report:' || p_event::text, 0));
  insert into public.ev_reports (event_id, reporter_id, reason, note) values (p_event, me, p_reason, v_note)
  on conflict (event_id, reporter_id) do nothing
  returning id into v_id;
  if v_id is null then return 'already_reported'; end if;

  -- Three different accounts older than 7 days, still open: hide it from the lists until staff check. Not an event with no host (an old
  -- listing), and not one that has a paid order: money is involved, so only staff decide. (The orders table comes with events_r1_pay.sql.)
  if to_regclass('public.ev_orders') is not null then
    execute 'select exists (select 1 from public.ev_orders o where o.event_id = $1 and o.status in (''paid'', ''refund_pending'', ''refunded''))' into v_paid using p_event;
  end if;
  if e.host_id is not null and not v_paid
     and (select count(distinct x.reporter_id)
            from public.ev_reports x
            join auth.users u on u.id = x.reporter_id
           where x.event_id = p_event and x.status = 'open' and u.created_at < now() - interval '7 days') >= 3 then
    update public.events set status = 'hidden' where id = p_event and status in ('live', 'unlisted');
  end if;
  return 'ok';
end $$;

-- ---------------------------------------------------------- the staff desk ---
create or replace function public.ev_admin_reports() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'event_id', t.event_id, 'event_title', t.title, 'event_status', public._ev_status_text(t.estatus, t.starts_at, t.ends_at),
           'reporter_id', t.reporter_id, 'reporter_name', t.rname, 'reason', t.reason, 'note', t.note,
           'created_at', t.created_at, 'status', t.status, 'open_reports', t.open_reports) order by t.created_at desc, t.id), '[]'::jsonb)
    from (
      select r.id, r.event_id, e.title, e.status as estatus, e.starts_at, e.ends_at, r.reporter_id, r.reason, r.note, r.created_at, r.status,
             coalesce(nullif(btrim(p.display_name), ''), p.handle) as rname,
             (select count(*) from public.ev_reports o where o.event_id = r.event_id and o.status = 'open') as open_reports
        from public.ev_reports r
        join public.events e on e.id = r.event_id
        left join public.profiles p on p.id = r.reporter_id
       order by r.created_at desc, r.id
       limit 500) t;
$$;

create or replace function public.ev_admin_review_report(p_id uuid, p_restore boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.ev_reports;
  v_status text;
begin
  select * into r from public.ev_reports where id = p_id for update;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  update public.ev_reports set status = 'reviewed', reviewed_at = coalesce(reviewed_at, now()) where id = r.id;
  if coalesce(p_restore, false) then
    update public.ev_reports set status = 'reviewed', reviewed_at = coalesce(reviewed_at, now()) where event_id = r.event_id and status = 'open';
    -- Back to live; ev_events_sync_status makes it unlisted when it is community or invite only.
    update public.events set status = 'live' where id = r.event_id and status = 'hidden';
  end if;
  select e.status into v_status from public.events e where e.id = r.event_id;
  return jsonb_build_object('ok', true, 'event_status', v_status);
end $$;

-- ----------------------------------------------------------------- access ---
revoke all on function public.ev_report_event(uuid, text, text), public.ev_admin_reports(), public.ev_admin_review_report(uuid, boolean) from public, anon;
grant execute on function public.ev_report_event(uuid, text, text) to authenticated;
-- Supabase gives service_role execute on new public functions by default; reporting needs a signed-in person, so take it back.
revoke all on function public.ev_report_event(uuid, text, text) from service_role;
revoke all on function public.ev_admin_reports(), public.ev_admin_review_report(uuid, boolean) from authenticated;
grant execute on function public.ev_admin_reports(), public.ev_admin_review_report(uuid, boolean) to service_role;

notify pgrst, 'reload schema';
commit;
