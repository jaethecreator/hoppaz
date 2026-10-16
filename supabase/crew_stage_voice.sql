-- ============================================================================
-- Hoppaz: crew admins, and who is on the stage (staff on the stage talk to the whole room)
-- Run order: schema.sql, chat_accounts.sql, crew_rooms.sql, then this file. Additive and safe to run again: it
-- replaces no existing function, so crew_rooms.sql and crew_friends.sql need no rerun after it. Behaviour:
-- docs/ROOM-GAME-DESIGN.md section 14.4. Nothing in the app reads any of this unless the stage voice flag is on
-- (NEXT_PUBLIC_ROOM_STAGE_VOICE=1), so running it early changes nothing people can see, except that an owner can
-- make an admin.
--
-- What it adds:
--   crew_members.role   owner, admin or member (the check allowed owner and member only). An admin is staff: the
--                       calls that say "role <> 'member'" (crew_friend_staff, the announcements) now include them.
--   crew_set_role       the owner makes a member an admin, or an admin a member. Nobody else, and never the owner.
--   _crew_room_stage_list(crew, viewer)
--                       the user ids of the staff (owner first, then admins by when they joined, at most 3)
--                       who are standing on the stage right now: a live heartbeat (under _crew_room_ttl) and a
--                       server-checked tile inside the layout's stage zone. The client never says where it is.
--                       `viewer` leaves out anyone the viewer has blocked; null (the LiveKit routes, which run as
--                       the service role) leaves nobody out. Not callable by Hoppers.
--   crew_room_stage     what the room asks every couple of seconds while stage voice is on: { stage, is_staff,
--                       is_owner, admins }. `admins` is filled for the owner only (it feeds MAKE / REMOVE ADMIN).
-- ============================================================================

-- ----------------------------------------------------------------- the role ---
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.crew_members'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%role%'
  loop
    execute format('alter table public.crew_members drop constraint %I', c);
  end loop;
  alter table public.crew_members add constraint crew_members_role_check check (role in ('owner', 'admin', 'member'));
end $$;

-- The owner makes an admin, or takes the role back. Returns { user_id, role }.
create or replace function public.crew_set_role(p_crew uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if auth.uid() is null or not public.has_account() then raise exception 'need_account'; end if;
  if not exists (select 1 from crew_members where crew_id = p_crew and user_id = auth.uid() and role = 'owner') then
    raise exception 'owner_only';
  end if;
  if p_role is null or p_role not in ('admin', 'member') then raise exception 'bad_role'; end if;
  select role into cur from crew_members where crew_id = p_crew and user_id = p_user for update;
  if not found then raise exception 'not_in_crew'; end if;
  if cur = 'owner' then raise exception 'owner_role_fixed'; end if;
  update crew_members set role = p_role where crew_id = p_crew and user_id = p_user;
  return jsonb_build_object('user_id', p_user, 'role', p_role);
end $$;

-- ---------------------------------------------------------------- the stage ---
-- Zone ids that count as the stage. crew rooms have "stage"; the event templates call theirs "booth" or "deck"
-- (src/lib/campaign/layout.ts, stageZoneId says the same).
create or replace function public._crew_room_stage_list(p_crew uuid, p_viewer uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array(
    select m.user_id
      from crew_rooms r
      join crew_room_layouts l on l.template = r.template and l.width = r.width
      join crew_room_presence p on p.crew_id = r.crew_id
      join crew_members m on m.crew_id = r.crew_id and m.user_id = p.user_id and m.role in ('owner', 'admin')
     where r.crew_id = p_crew
       and p.last_seen > clock_timestamp() - _crew_room_ttl()
       and exists (
             select 1 from jsonb_array_elements(l.data->'zones') z
              where z->>'id' in ('stage', 'booth', 'deck')
                and p.x >= (z->>'x')::int and p.x < (z->>'x')::int + (z->>'w')::int
                and p.y >= (z->>'y')::int and p.y < (z->>'y')::int + (z->>'h')::int)
       and (p_viewer is null or not public.is_blocked(p_viewer, m.user_id))
     order by (m.role = 'owner') desc, m.joined_at, m.user_id
     limit 3), '{}'::uuid[]);
$$;

create or replace function public.crew_room_stage(p_crew uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mine text;
begin
  perform _crew_room_require(p_crew);
  select role into mine from crew_members where crew_id = p_crew and user_id = auth.uid();
  return jsonb_build_object(
    'stage', to_jsonb(_crew_room_stage_list(p_crew, auth.uid())),
    'is_staff', mine in ('owner', 'admin'),
    'is_owner', mine = 'owner',
    'admins', case when mine = 'owner'
                   then coalesce((select jsonb_agg(user_id order by joined_at) from crew_members where crew_id = p_crew and role = 'admin'), '[]'::jsonb)
                   else '[]'::jsonb end);
end $$;

revoke all on function public._crew_room_stage_list(uuid, uuid) from public, anon, authenticated;
grant execute on function public._crew_room_stage_list(uuid, uuid) to service_role;
revoke all on function public.crew_set_role(uuid, uuid, text), public.crew_room_stage(uuid) from public, anon;
grant execute on function public.crew_set_role(uuid, uuid, text), public.crew_room_stage(uuid) to authenticated;
