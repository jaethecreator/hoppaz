-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1, file 6 of 6: events and rooms together. The event chat, the room's events, the Rooms tab, and Hoppaz HQ.
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
--   ev_rooms_for_me()         the Rooms tab: { hq, mine, discover, eventChats }. hq is Hoppaz HQ (made and joined on first read: see below).
--                             mine: rooms I am in, latest announcement first, each with its latest announcement (with the event tag where
--                             there is one) and my unread count. discover: up to 20 open rooms I am not in, biggest first. eventChats: the event
--                             chats I may care about (events of my rooms that are listed for me, events I am going to or run), open first, then
--                             about to open, then closed; a chat closed more than 14 days ago is dropped.
--   ev_room_mark_read(room)   I have seen the room's announcements: unread goes to 0 (it calls crew_announcement_seen).
--   ev_ensure_hq()            the id of Hoppaz HQ (see HOPPAZ HQ). The Rooms tab calls it for you; a screen may call it too.
--   ev_hq_backfill()          service role: puts every account in HQ now, instead of waiting for each person's first read.
--   _ev_chat_can_enter(event, user)   internal. The same rule as can_enter, for a given user, so a later change to in_room (the check the
--                             messages table uses) can call it. NOT done here: the existing in_room works from checkins and swipes and still
--                             decides who can post in the event channel. To make event chat messages follow registrations, in_room needs an
--                             event branch that calls _ev_chat_can_enter(event id, user), and room_closes_at should use the same close time
--                             (end + 3 days; it uses ends_at or start + 8 hours). That edit is Ola's.
--
-- HOPPAZ HQ. One room that everybody is in, chat first. There is no "kind" column on crews, so HQ is the crew pointed to by the one row
-- of ev_hq. ev_ensure_hq():
--   * finds the HQ crew, or adopts a verified crew already named Hoppaz HQ (if Ola made one), or makes it: a crew named Hoppaz HQ, open,
--     verified, owned by the oldest staff account (profiles.is_admin). If there is no staff account it answers null: make one first.
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

-- ----------------------------------------------------------------- Hoppaz HQ ---
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
      select c.id into v_crew from public.crews c where c.verified and lower(btrim(c.name)) = 'hoppaz hq' order by c.created_at, c.id limit 1;
      if v_crew is null then
        select p.id into v_owner from public.profiles p where p.is_admin order by p.created_at, p.id limit 1;
        if v_owner is null then return null; end if;
        insert into public.crews (name, created_by, visibility, verified) values ('Hoppaz HQ', v_owner, 'open', true) returning id into v_crew;
        insert into public.crew_members (crew_id, user_id, role) values (v_crew, v_owner, 'owner') on conflict do nothing;
      end if;
      insert into public.crew_rooms (crew_id, width, content, capacity)
      values (v_crew, 30, jsonb_build_object('brand', 'Hoppaz HQ', 'strapline', 'Everyone is here.', 'musicTitle', '', 'musicUrl', '', 'audioUrl', '',
                                             'artistTitle', '', 'artistNote', '', 'awards', '[]'::jsonb), 500)
      on conflict (crew_id) do update set capacity = greatest(crew_rooms.capacity, 500);
      insert into public.ev_hq (id, crew_id) values (true, v_crew) on conflict (id) do nothing;
    end if;
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
    'verified', c.verified, 'joined', v_joined is not null, 'unread', v_unread, 'latest_announcement', v_latest);
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

-- ----------------------------------------------------------------- access ---
revoke all on function public.ev_event_chat(uuid), public.ev_room_events(uuid), public.ev_room(uuid), public.ev_rooms_for_me(),
  public.ev_room_mark_read(uuid), public.ev_ensure_hq(), public.ev_hq_backfill() from public, anon;
-- The event page and the room home also work for a visitor with no account.
grant execute on function public.ev_event_chat(uuid), public.ev_room_events(uuid), public.ev_room(uuid) to anon, authenticated;
grant execute on function public.ev_rooms_for_me(), public.ev_room_mark_read(uuid), public.ev_ensure_hq() to authenticated;
-- The backfill is for Ola (the SQL editor) and the service role.
revoke all on function public.ev_hq_backfill() from authenticated;
grant execute on function public.ev_hq_backfill() to service_role;

notify pgrst, 'reload schema';
commit;
