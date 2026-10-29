-- A join request that says "they bought a ticket". DRAFT FOR OLA, NOT RUN ANYWHERE (not even locally). Release 1, file 15 in the run order
-- (see EVENTS_R1_ORDER.md). Written from the fake layer (src/lib/events-r1/fake/rooms.ts: join with forEvent, requests), which is the spec.
-- Nothing in an older SQL file is edited and no existing function is replaced. Safe to run again.
--
-- WHY
--   Right after paying (or registering), "You're going" shows the host's room with "Join room". In an ask room the button says "Ask to join",
--   and the request tells the host the person bought a ticket. ev_room_requests (events_r1_room_profile.sql) has no place for that, so this
--   file adds one nullable column to it and two new functions. ev_join_room and ev_room_requests are untouched and keep working.
--
-- WHAT IT ADDS
--   ev_room_requests.ticket_event_id        the event the person held a ticket for when they asked (null for a plain request)
--   ev_join_room_for_ticket(room, event)    the same as ev_join_room(room) (same answers), and when the answer is 'requested' and the caller
--                                           is going to (or checked in at) that event of this room, the waiting request carries the event.
--                                           A request without the event (asked earlier from the room page) gets it now. Any other event,
--                                           or no ticket, is ignored quietly: the request is a plain one.
--   ev_room_requests_with_tickets(room)     ev_room_requests plus ticket_event_id and ticket_event_title. null for anyone who is not the owner,
--                                           an admin or staff, like ev_room_requests.
--
-- Needs (load first):
--   events_r1_events.sql                                   events.room_id
--   events_r1_registrations.sql                            ev_registrations
--   events_r1_room_profile.sql                             ev_room_requests, ev_join_room, _ev_room_admin, _ev_person_name
-- Test: supabase/tests/events_r1_room_request_ticket_test.sql
--
-- The app falls back to ev_join_room and ev_room_requests until this runs (src/lib/events-r1/real/roomProfile.ts): the request is sent,
-- the host just does not see the ticket line.

do $$
begin
  if to_regprocedure('public.ev_join_room(uuid, text)') is null or to_regprocedure('public._ev_room_admin(uuid)') is null
     or to_regclass('public.ev_registrations') is null then
    raise exception 'events_r1_room_request_ticket: run events_r1_registrations.sql and events_r1_room_profile.sql first';
  end if;
end $$;

alter table public.ev_room_requests add column if not exists ticket_event_id uuid references public.events(id) on delete set null;

create or replace function public.ev_join_room_for_ticket(p_room uuid, p_event uuid) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); out text;
begin
  out := public.ev_join_room(p_room, null);
  if out = 'requested' and me is not null and p_event is not null and exists (
       select 1 from public.ev_registrations r join public.events e on e.id = r.event_id
        where r.event_id = p_event and r.user_id = me and r.status in ('going', 'checked_in') and e.room_id = p_room) then
    update public.ev_room_requests set ticket_event_id = p_event
     where crew_id = p_room and user_id = me and status = 'pending' and ticket_event_id is null;
  end if;
  return out;
end $$;
revoke all on function public.ev_join_room_for_ticket(uuid, uuid) from public, anon;
grant execute on function public.ev_join_room_for_ticket(uuid, uuid) to authenticated;

create or replace function public.ev_room_requests_with_tickets(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._ev_room_admin(p_room) then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'room_id', r.crew_id, 'user_id', r.user_id,
                                        'name', public._ev_person_name(r.user_id), 'created_at', r.created_at,
                                        'ticket_event_id', r.ticket_event_id, 'ticket_event_title', e.title) order by r.created_at, r.id)
      from public.ev_room_requests r left join public.events e on e.id = r.ticket_event_id
     where r.crew_id = p_room and r.status = 'pending'), '[]'::jsonb);
end $$;
revoke all on function public.ev_room_requests_with_tickets(uuid) from public, anon;
grant execute on function public.ev_room_requests_with_tickets(uuid) to authenticated;
