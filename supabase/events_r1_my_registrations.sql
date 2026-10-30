-- Your tickets on Me. DRAFT FOR OLA, NOT RUN ANYWHERE (not even locally). Release 1, file 16 in the run order (see EVENTS_R1_ORDER.md).
-- Written from the fake layer (src/lib/events-r1/fake/registrations.ts: mine), which is the spec.
-- Nothing in an older SQL file is edited and no existing function is replaced. Safe to run again.
--
-- WHY
--   Me shows "Your tickets": one small stub per event the person is going to, soonest first. ev_registrations is a closed table and
--   ev_my_tickets(event) answers for one event only, so there was no way to list them all. This file adds one read-only function.
--
-- WHAT IT ADDS
--   ev_my_registrations()   the caller's registrations with status 'going' for events that have not ended and are not cancelled or
--                           rejected, soonest first, at most 50. Each item is { registration: <_ev_reg_json>, event: <_ev_event_json> }.
--                           Answers [] for no session, and while the events_r1 switch is off. Checked in, requested, waitlisted,
--                           declined and cancelled registrations are left out. An event ends at ends_at, or 3 hours after it starts.
--
-- Needs (load first):
--   events_r1_events.sql                                   _ev_open(), _ev_event_json()
--   events_r1_registrations.sql                            ev_registrations, _ev_reg_json()
-- Test: supabase/tests/events_r1_my_registrations_test.sql
--
-- The app answers an empty list until this runs (src/lib/events-r1/real/registrations.ts: mine): Me then shows only the Game Time prize codes.

do $$
begin
  if to_regclass('public.ev_registrations') is null or to_regprocedure('public._ev_reg_json(public.ev_registrations)') is null
     or to_regprocedure('public._ev_event_json(uuid)') is null or to_regprocedure('public._ev_open()') is null then
    raise exception 'events_r1_my_registrations: run events_r1_events.sql and events_r1_registrations.sql first';
  end if;
end $$;

create or replace function public.ev_my_registrations() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null or not public._ev_open() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('registration', public._ev_reg_json(t.r), 'event', public._ev_event_json(t.event_id))
                     order by t.starts_at, t.event_id)
      from (
        select r, r.event_id, e.starts_at
          from public.ev_registrations r join public.events e on e.id = r.event_id
         where r.user_id = me and r.status = 'going'
           and e.status not in ('cancelled', 'rejected')
           and coalesce(e.ends_at, e.starts_at + interval '3 hours') > now()
         order by e.starts_at, e.id
         limit 50) t
  ), '[]'::jsonb);
end $$;
revoke all on function public.ev_my_registrations() from public, anon;
grant execute on function public.ev_my_registrations() to authenticated;
