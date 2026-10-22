-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1, file 6 of 6: events and rooms together. The event chat, the room's events, the Rooms tab, Lagos HQ, and the 3D room switch.
-- Written from src/lib/events-r1/fake/rooms.ts and rules.ts. Hotspots are not touched.
--
-- RUN ORDER: schema.sql, chat_accounts.sql, crew_rooms.sql, crew_announcements.sql, events_r1_events.sql, events_r1_registrations.sql,
--            events_r1_pops.sql (the room's latest announcement carries the event tag from there), then THIS FILE. Safe to run again.
--            It replaces the stub _ev_is_hq that events_r1_events.sql wrote. Tickets and reports are not needed.
--
-- WHAT IT ADDS.
--   events.room_id (from file 1) is the link: an event made by a host who owns a room is tied to that room when it is made.
--   ev_event_chat(event)      the event chat state: { event_id, event_title, room_id, opens_at, closes_at, state, can_enter } or null (no room,
--                             or the viewer may not open the event). It opens 1 hour before the start and closes 3 days after the end
--                             (3 hours after the start when there is no end time). state: upcoming | open | closed (a cancelled or hidden
--                             event is closed). WHO MAY ENTER (can_enter) follows the event: the host and staff always; a community event:
--                             members of the room; any other event, with or without approval: people whose registration is going or checked
--                             in (approval on means approved). A waitlisted or requested person cannot enter. NOTE: the fake layer lets a
--                             waitlisted person in on an event with no approval; this file follows the framework doc (rule 10, going only).
--   ev_room_events(room)      the room's events as full events, upcoming first then past: public ones, community ones for room members, the
--                             host's own; invite only never for others; cancelled ones only for the host.
--   ev_room(room)             one room as the room home needs it (the RoomSummary type); null for a private room the viewer is not in.
--   ev_rooms_for_me()         the Rooms tab: { hq, mine, discover, eventChats }. hq is Lagos HQ (made and joined on first read: see below).
--                             mine: rooms I am in, latest announcement first, each with its latest announcement (with the event tag where
--                             there is one) and my unread count. discover: up to 20 open rooms I am not in, biggest first. eventChats: the event
--                             chats I may care about (events of my rooms that are listed for me, events I am going to or run), open first, then
--                             about to open, then closed; a chat closed more than 14 days ago is dropped.
--   ev_room_mark_read(room)   I have seen the room's announcements: unread goes to 0 (it calls crew_announcement_seen).
--   ev_ensure_hq()            the id of Lagos HQ (see LAGOS HQ). The Rooms tab calls it for you; a screen may call it too.
--   ev_hq_backfill()          service role: puts every account in HQ now, instead of waiting for each person's first read.
--   _ev_chat_can_enter(event, user)   internal. The same rule as can_enter, for a given user, so a later change to in_room (the check the
--                             messages table uses) can call it. NOT done here: the existing in_room works from checkins and swipes and still
--                             decides who can post in the event channel. To make event chat messages follow registrations, in_room needs an
--                             event branch that calls _ev_chat_can_enter(event id, user), and room_closes_at should use the same close time
--                             (end + 3 days; it uses ends_at or start + 8 hours). That edit is Ola's.
--   ev_set_room_3d(room, on)  the owner of the room (crew_members role owner) or staff (profiles.is_admin) switches the walkable 3D room on or
--                             off. Off = chat only. Answers 'ok', or a reason: need_account, bad_value, not_allowed, not_found.
--   ev_room_3d_allowed(room)  is the 3D room switched on for this room? The default, when nobody has set it: ON for a room that has a layout
--                             (every crew does: the walkable room is made on first entry from the default template), OFF for Lagos HQ until
--                             its owner or staff switch it on. The ENTRY function must ask it: see "THE 3D ROOM SWITCH" below.
--   ev_admin_rooms()          staff only (profiles.is_admin): every room as a room summary (null for anyone else), Lagos HQ first, then the biggest.
--   _ev_room_json now also says  has_3d (a walkable room can be made: there is a layout) and  three_d_on (the switch). Enter room shows
--                             only when both are true.
--
-- LAGOS HQ. One room that everybody is in, chat first. It used to be called Hoppaz HQ and starts fresh under the new name: no old hotspot
-- message is moved into it. The code names stay (kind 'hq', slug 'hq', the ev_hq table). There is no "kind" column on crews, so HQ is the crew
-- pointed to by the one row of ev_hq. ev_ensure_hq():
--   * finds the HQ crew, or adopts a verified crew already named Lagos HQ (or, if Ola made one under the old name, Hoppaz HQ: it is renamed
--     to Lagos HQ), or makes it: a crew named Lagos HQ, open, verified, owned by the oldest staff account (profiles.is_admin). If there is
--     no staff account it answers null: make one first. A pointed-to crew still named Hoppaz HQ is renamed the next time this runs.
--     A signed-in guest with no account cannot make it (the crews table asks for an account); the SQL editor and the service role can.
--   * adds the caller as a member if they have an account (a guest is not added: chat needs an account anyway). So every account joins
--     the first time it opens the Rooms tab. ev_hq_backfill() does it for everyone at once.
--   * makes the HQ room row with capacity 500.
-- What Ola must know about the walker cap. crew_rooms.capacity is the number of WALKERS in the 3D room (60 by default, a check allows 1 to
-- 500). It does not limit members and it does not limit chat: General chat (crew_room_send with scope general) needs only membership
-- and an account, and a member who enters a full room is let in to watch. So chat first never meets the cap. HQ is set to 500, the most the
-- check allows; if the 3D room is ever opened to the whole of HQ it will need a smarter limit than that. Nothing in crews or crew_members
-- caps the number of members. One cost to watch: a General message reaches the whole crew, so every message in HQ is delivered to every member
-- who has the room open; if HQ gets large, look at the realtime load before it does.
--
-- THE 3D ROOM SWITCH. The owner of a room, and staff, can switch its walkable 3D room on or off. Off = chat only (Announcements, General,
-- event chats) and the app hides "Enter room". The switch is a row in the closed table ev_room_settings (room_id, three_d_on, updated_by,
-- updated_at). No row = the default (ev_room_3d_allowed above). Nothing existing is edited by this file, so the ENTRY function is not
-- changed here: Ola must add one line to it, or a person can still walk in by calling it directly. Read in crew_rooms_scale.sql, the live
-- version (crew_rooms_scale.sql replaces the one in crew_rooms.sql; no later file redefines it):
--     public.crew_room_enter(p_crew uuid, p_session uuid)      crew_rooms_scale.sql, line 371
-- Add this line right after   perform _crew_room_require(p_crew);   (line 383), and the same line after the same call in the older
-- copy in crew_rooms.sql (line 419, so a fresh database that runs only that file is guarded too):
--     if not public.ev_room_3d_allowed(p_crew) then raise exception 'room_off'; end if;
-- The app turns the text room_off into "The 3D room is off" and the client also refuses to offer Enter room. Switching a room off does not
-- throw out people already walking (crew_room_step and the heartbeat are not changed): they leave when they leave, and nobody new comes in.
-- ============================================================================
begin;

create table if not exists public.ev_hq (
  id         boolean primary key default true check (id),
  crew_id    uuid not null references public.crews(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.ev_hq enable row level security;
revoke all on public.ev_hq from anon, authenticated;
grant all on public.ev_hq to service_role;

create or replace function public._ev_is_hq(p_crew uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_crew is not null and exists (select 1 from public.ev_hq h where h.crew_id = p_crew);
$$;
revoke all on function public._ev_is_hq(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------- Lagos HQ ---
create or replace function public.ev_ensure_hq() returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me      uuid := auth.uid();
  v_crew  uuid;
  v_owner uuid;
begin
  select h.crew_id into v_crew from public.ev_hq h;
  if v_crew is null then
    -- A signed-in guest with no account cannot make it; the service role and the SQL editor (no session) can.
    if me is not null and not public.has_account() then return null; end if;
    perform pg_advisory_xact_lock(hashtextextended('ev-hq', 0));
    select h.crew_id into v_crew from public.ev_hq h;
    if v_crew is null then
      -- A crew already named Lagos HQ wins; one still named Hoppaz HQ is adopted too (and renamed below).
      select c.id into v_crew from public.crews c where c.verified and lower(btrim(c.name)) in ('lagos hq', 'hoppaz hq')
       order by (lower(btrim(c.name)) = 'lagos hq') desc, c.created_at, c.id limit 1;
      if v_crew is null then
        select p.id into v_owner from public.profiles p where p.is_admin order by p.created_at, p.id limit 1;
        if v_owner is null then return null; end if;
        insert into public.crews (name, created_by, visibility, verified) values ('Lagos HQ', v_owner, 'open', true) returning id into v_crew;
        insert into public.crew_members (crew_id, user_id, role) values (v_crew, v_owner, 'owner') on conflict do nothing;
      end if;
      insert into public.crew_rooms (crew_id, width, content, capacity)
      values (v_crew, 30, jsonb_build_object('brand', 'Lagos HQ', 'strapline', 'Everyone is here.', 'musicTitle', '', 'musicUrl', '', 'audioUrl', '',
                                             'artistTitle', '', 'artistNote', '', 'awards', '[]'::jsonb), 500)
      on conflict (crew_id) do update set capacity = greatest(crew_rooms.capacity, 500);
      insert into public.ev_hq (id, crew_id) values (true, v_crew) on conflict (id) do nothing;
    end if;
  end if;
  -- Under its old name: rename it (the crew and the room's brand line), once.
  if exists (select 1 from public.crews c where c.id = v_crew and lower(btrim(c.name)) = 'hoppaz hq') then
    update public.crews set name = 'Lagos HQ' where id = v_crew;
    update public.crew_rooms set content = jsonb_set(content, '{brand}', '"Lagos HQ"') where crew_id = v_crew and lower(btrim(content ->> 'brand')) = 'hoppaz hq';
  end if;
  -- The reader joins on first read.
  if me is not null and public.has_account()
     and not exists (select 1 from public.crew_members m where m.crew_id = v_crew and m.user_id = me) then
    insert into public.crew_members (crew_id, user_id) values (v_crew, me) on conflict do nothing;
  end if;
  return v_crew;
end $$;

create or replace function public.ev_hq_backfill() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_crew uuid := public.ev_ensure_hq();
  v_n    integer;
begin
  if v_crew is null then return 0; end if;
  insert into public.crew_members (crew_id, user_id)
  select v_crew, p.id from public.profiles p join auth.users u on u.id = p.id where coalesce(u.email, '') <> ''
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ------------------------------------------------------------ the 3D room switch ---
-- One row per room that someone has set. Closed like every other ev_ table: the functions below are the only way in.
create table if not exists public.ev_room_settings (
  room_id     uuid primary key references public.crews(id) on delete cascade,
  three_d_on  boolean not null,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.ev_room_settings enable row level security;
revoke all on public.ev_room_settings from anon, authenticated;
grant all on public.ev_room_settings to service_role;

-- Can this room be walked at all: does it have a layout? A room with no crew_rooms row yet is made on first entry from the default
-- template (clubhouse, 30 wide), so it counts when that layout exists. Internal.
create or replace function public._ev_room_has_layout(p_room uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.crews c where c.id = p_room)
     and exists (select 1 from public.crew_room_layouts l
                  where l.template = coalesce((select r.template from public.crew_rooms r where r.crew_id = p_room), 'clubhouse')
                    and l.width = coalesce((select r.width from public.crew_rooms r where r.crew_id = p_room), 30));
$$;
revoke all on function public._ev_room_has_layout(uuid) from public, anon, authenticated;

-- Is the 3D room switched on? A saved switch wins. With none: on for a room with a layout, off for Lagos HQ (until its room is ready and
-- its owner or staff switch it on), off for a room that does not exist. This is the function the entry function asks.
create or replace function public.ev_room_3d_allowed(p_room uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public._ev_room_has_layout(p_room)
     and coalesce((select s.three_d_on from public.ev_room_settings s where s.room_id = p_room), not public._ev_is_hq(p_room));
$$;

-- Owner or staff. Answers ok, or a reason: need_account (a guest or nobody), bad_value, not_allowed, not_found.
create or replace function public.ev_set_room_3d(p_room uuid, p_on boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null or not public.has_account() then return 'need_account'; end if;
  if p_on is null then return 'bad_value'; end if;
  if not (public._ev_staff() or exists (select 1 from public.crew_members m where m.crew_id = p_room and m.user_id = me and m.role = 'owner')) then
    return 'not_allowed';
  end if;
  if not exists (select 1 from public.crews c where c.id = p_room) then return 'not_found'; end if;
  insert into public.ev_room_settings (room_id, three_d_on, updated_by, updated_at) values (p_room, p_on, me, now())
  on conflict (room_id) do update set three_d_on = excluded.three_d_on, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return 'ok';
end $$;

-- --------------------------------------------------------------- event chat ---
-- May this user come into the event's chat? (the rule only; the caller decides what to do with it)
create or replace function public._ev_chat_can_enter(p_event uuid, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e public.events;
begin
  if p_user is null then return false; end if;
  select * into e from public.events where id = p_event;
  if e.id is null or e.room_id is null then return false; end if;
  if p_user = coalesce(e.host_id, e.created_by)
     or exists (select 1 from public.profiles pr where pr.id = p_user and pr.is_admin) then
    return true;
  end if;
  if e.status not in ('live', 'unlisted', 'ended') then return false; end if;
  if e.visibility = 'community' then return public._ev_in_room(e.room_id, p_user); end if;
  return coalesce(public._ev_reg_status(p_event, p_user), '') in ('going', 'checked_in');
end $$;
revoke all on function public._ev_chat_can_enter(uuid, uuid) from public, anon, authenticated;

create or replace function public._ev_chat_json(p_event uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  e        public.events;
  v_opens  timestamptz;
  v_closes timestamptz;
  v_state  text;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or e.room_id is null then return null; end if;
  v_opens := e.starts_at - interval '1 hour';
  v_closes := coalesce(e.ends_at, e.starts_at + interval '3 hours') + interval '3 days';
  v_state := case when e.status in ('cancelled', 'hidden', 'rejected', 'pending') or now() >= v_closes then 'closed'
                  when now() >= v_opens then 'open' else 'upcoming' end;
  return jsonb_build_object('event_id', e.id, 'event_title', e.title, 'room_id', e.room_id, 'opens_at', v_opens, 'closes_at', v_closes,
                            'state', v_state, 'can_enter', public._ev_chat_can_enter(p_event, p_user) and v_state <> 'closed');
end $$;
revoke all on function public._ev_chat_json(uuid, uuid) from public, anon, authenticated;

create or replace function public.ev_event_chat(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._ev_can_open(p_event) then return null; end if;
  return public._ev_chat_json(p_event, auth.uid());
end $$;

-- ------------------------------------------------------------ a room's events ---
create or replace function public.ev_room_events(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  return coalesce((
    select jsonb_agg(public._ev_event_json(t.id)
                     order by (t.finish < now()), case when t.finish >= now() then t.starts_at end,
                              case when t.finish < now() then t.starts_at end desc, t.id)
      from (
        select e.id, e.starts_at, coalesce(e.ends_at, e.starts_at + interval '3 hours') as finish
          from public.events e
         where e.room_id = p_room
           and ((me is not null and coalesce(e.host_id, e.created_by) = me and e.status in ('live', 'unlisted', 'cancelled'))
                or (e.status in ('live', 'unlisted')
                    and (e.visibility = 'public' or (e.visibility = 'community' and public._ev_in_room(e.room_id, me)))))
         order by e.starts_at desc
         limit 200) t
  ), '[]'::jsonb);
end $$;

-- --------------------------------------------------------------- room summary ---
-- A room as the Rooms tab and the room home need it (the RoomSummary type). slug is the room id (crews have no slug).
create or replace function public._ev_room_json(p_room uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c        public.crews;
  v_joined timestamptz;
  v_since  timestamptz;
  v_unread integer := 0;
  v_latest jsonb := null;
begin
  select * into c from public.crews where id = p_room;
  if c.id is null then return null; end if;
  if p_user is not null then
    select m.joined_at into v_joined from public.crew_members m where m.crew_id = p_room and m.user_id = p_user;
  end if;
  if v_joined is not null then
    -- Unseen means made after the last time I opened the panel (or after I joined) and not made by me, as in crew_announcements().
    v_since := coalesce((select s.seen_at from public.crew_announcement_seen s where s.user_id = p_user and s.crew_id = p_room), v_joined);
    select count(*)::int into v_unread from public.crew_announcements a
     where a.crew_id = p_room and a.deleted_at is null and a.created_at > v_since and a.author_id is distinct from p_user;
    select jsonb_build_object(
             'id', a.id, 'room_id', a.crew_id, 'body', a.body, 'created_at', a.created_at,
             'author_name', coalesce(nullif(btrim(pr.display_name), ''), pr.handle, 'The owner'),
             'event_id', l.event_id, 'event_title', ev.title)
      into v_latest
      from public.crew_announcements a
      left join public.profiles pr on pr.id = a.author_id
      left join public.ev_announcement_event l on l.announcement_id = a.id
      left join public.events ev on ev.id = l.event_id
     where a.crew_id = p_room and a.deleted_at is null
     order by a.created_at desc, a.id limit 1;
  end if;
  return jsonb_build_object(
    'id', c.id, 'slug', c.id::text, 'name', c.name,
    'kind', case when public._ev_is_hq(c.id) then 'hq' when c.verified then 'brand' else 'crew' end,
    'logo_url', c.logo_url, 'wallpaper_url', c.header_images[1],
    'members', (select count(*)::int from public.crew_members m where m.crew_id = c.id),
    'verified', c.verified, 'joined', v_joined is not null, 'unread', v_unread, 'latest_announcement', v_latest,
    'has_3d', public._ev_room_has_layout(c.id), 'three_d_on', public.ev_room_3d_allowed(c.id));
end $$;
revoke all on function public._ev_room_json(uuid, uuid) from public, anon, authenticated;

create or replace function public.ev_room(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.crews;
begin
  select * into c from public.crews where id = p_room;
  if c.id is null then return null; end if;
  if c.visibility <> 'open' and not public._ev_in_room(p_room, auth.uid()) and not public._ev_staff() then return null; end if;
  return public._ev_room_json(p_room, auth.uid());
end $$;

create or replace function public.ev_rooms_for_me() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me     uuid := auth.uid();
  v_hq   uuid := public.ev_ensure_hq();
  v_mine jsonb;
  v_disc jsonb;
  v_chat jsonb;
begin
  if me is not null then
    select coalesce(jsonb_agg(x.js order by x.last_at desc nulls last, (x.js ->> 'members')::int desc, x.js ->> 'id'), '[]'::jsonb) into v_mine
      from (select public._ev_room_json(m.crew_id, me) as js,
                   (select max(a.created_at) from public.crew_announcements a where a.crew_id = m.crew_id and a.deleted_at is null) as last_at
              from public.crew_members m
             where m.user_id = me and (v_hq is null or m.crew_id <> v_hq)
             limit 100) x
     where x.js is not null;

    select coalesce(jsonb_agg(x.js order by (x.js ->> 'members')::int desc, x.js ->> 'id'), '[]'::jsonb) into v_disc
      from (select public._ev_room_json(c.id, me) as js
              from public.crews c
             where c.visibility = 'open' and (v_hq is null or c.id <> v_hq)
               and not exists (select 1 from public.crew_members m where m.crew_id = c.id and m.user_id = me)
             order by (select count(*) from public.crew_members m2 where m2.crew_id = c.id) desc, c.id
             limit 20) x
     where x.js is not null;

    -- Event chats: events of my rooms that are listed for me, events I am going to, events I run. A chat closed 2 weeks ago is gone.
    select coalesce(jsonb_agg(y.js order by y.rk, y.opens, y.js ->> 'event_id'), '[]'::jsonb) into v_chat
      from (select z.js,
                   case z.js ->> 'state' when 'open' then 0 when 'upcoming' then 1 else 2 end as rk,
                   (z.js ->> 'opens_at')::timestamptz as opens
              from (select public._ev_chat_json(e.id, me) as js
                      from public.events e
                     where e.room_id is not null and e.status in ('live', 'unlisted')
                       and e.starts_at between now() - interval '25 days' and now() + interval '45 days'
                       and (coalesce(e.host_id, e.created_by) = me
                            or public._ev_reg_status(e.id, me) in ('going', 'checked_in')
                            or (e.visibility <> 'invite' and public._ev_in_room(e.room_id, me)))
                     limit 200) z
             where z.js is not null) y
     where not (y.js ->> 'state' = 'closed' and (y.js ->> 'closes_at')::timestamptz < now() - interval '14 days');
  end if;
  return jsonb_build_object(
    'hq', case when v_hq is null then null else public._ev_room_json(v_hq, me) end,
    'mine', coalesce(v_mine, '[]'::jsonb), 'discover', coalesce(v_disc, '[]'::jsonb), 'eventChats', coalesce(v_chat, '[]'::jsonb));
end $$;

create or replace function public.ev_room_mark_read(p_room uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.crew_announcement_seen(p_room);
end $$;

-- Staff: every room, Lagos HQ first, then the biggest. Null for anyone who is not staff (an empty list is '[]').
create or replace function public.ev_admin_rooms() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._ev_staff() then return null; end if;
  return coalesce((
    select jsonb_agg(public._ev_room_json(t.id, auth.uid()) order by t.is_hq desc, t.members desc, t.name, t.id)
      from (select c.id, c.name, public._ev_is_hq(c.id) as is_hq, (select count(*) from public.crew_members m where m.crew_id = c.id) as members
              from public.crews c order by 3 desc, 4 desc, c.name, c.id limit 500) t
  ), '[]'::jsonb);
end $$;

-- ----------------------------------------------------------------- access ---
revoke all on function public.ev_event_chat(uuid), public.ev_room_events(uuid), public.ev_room(uuid), public.ev_rooms_for_me(),
  public.ev_room_mark_read(uuid), public.ev_ensure_hq(), public.ev_hq_backfill(),
  public.ev_room_3d_allowed(uuid), public.ev_set_room_3d(uuid, boolean), public.ev_admin_rooms() from public, anon;
-- The event page and the room home also work for a visitor with no account.
grant execute on function public.ev_event_chat(uuid), public.ev_room_events(uuid), public.ev_room(uuid) to anon, authenticated;
grant execute on function public.ev_rooms_for_me(), public.ev_room_mark_read(uuid), public.ev_ensure_hq(),
  public.ev_room_3d_allowed(uuid), public.ev_set_room_3d(uuid, boolean), public.ev_admin_rooms() to authenticated;
-- The backfill is for Ola (the SQL editor) and the service role.
revoke all on function public.ev_hq_backfill() from authenticated;
grant execute on function public.ev_hq_backfill() to service_role;

notify pgrst, 'reload schema';
commit;
