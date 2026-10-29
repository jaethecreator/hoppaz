-- Leave a room. DRAFT FOR OLA, NOT RUN ANYWHERE (not even locally). Release 1, file 12 in the run order (see EVENTS_R1_ORDER.md).
-- Written from the fake layer (src/lib/events-r1/fake/rooms.ts, rooms.leave), which is the spec. Nothing in an older SQL file is edited and no
-- existing function is replaced. Safe to run again.
--
-- WHAT IT ADDS
--   ev_leave_room(room): a member leaves the room by themselves (the room page: phone menu > Leave room, desktop "Joined" > Leave room).
--   It takes the caller out of crew_members and clears their own join request row for the room (ev_room_requests is unique per person and
--   room, so an old approved row would otherwise block asking again). Tickets are not touched: a registration (ev_registrations) is
--   separate from membership, so tickets keep working and the person can still read and post in the chats of events they are going to.
--   The owner cannot leave (they transfer or delete the room in the room admin). Lagos HQ cannot be left: everyone is in it.
--
-- Needs (load first):
--   events_r1_events.sql                                   _ev_open()
--   events_r1_rooms.sql                                    _ev_is_hq(uuid)
--   events_r1_room_profile.sql                             _ev_room_role(uuid, uuid), ev_room_requests, has_account()
-- Test: supabase/tests/events_r1_room_leave_test.sql
--
-- Answers a short text: 'ok' or a reason code: not_open (the events_r1 switch is off), need_account, not_found, not_member, owner_fixed, hq_fixed.

do $$
begin
  if to_regprocedure('public._ev_room_role(uuid, uuid)') is null or to_regprocedure('public._ev_open()') is null or to_regprocedure('public._ev_is_hq(uuid)') is null then
    raise exception 'events_r1_room_leave: run events_r1_events.sql, events_r1_rooms.sql and events_r1_room_profile.sql first';
  end if;
end $$;

create or replace function public.ev_leave_room(p_room uuid) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); mine text;
begin
  if not public._ev_open() then return 'not_open'; end if;
  if me is null or not public.has_account() then return 'need_account'; end if;
  if p_room is null or not exists (select 1 from public.crews c where c.id = p_room) then return 'not_found'; end if;
  if public._ev_is_hq(p_room) then return 'hq_fixed'; end if;
  mine := public._ev_room_role(p_room, me);
  if mine is null then return 'not_member'; end if;
  if mine = 'owner' then return 'owner_fixed'; end if;
  delete from public.crew_members where crew_id = p_room and user_id = me;
  delete from public.ev_room_requests where crew_id = p_room and user_id = me;
  return 'ok';
end $$;
revoke all on function public.ev_leave_room(uuid) from public, anon;
grant execute on function public.ev_leave_room(uuid) to authenticated;
