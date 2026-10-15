-- ============================================================================
-- Hoppaz: crew = friends. Waves build friendship, DMs follow from crew.
--
-- RUN ORDER: schema.sql, chat_accounts.sql, crew_rooms.sql, crew_rails.sql, then THIS file.
--            (hotspots.sql may be anywhere before or after; this file does not touch it.)
--            Safe to run again, in one transaction. Run it after any later re-run of crew_rails.sql or
--            chat_accounts.sql too, although nothing here is undone by those two: every function below has a NEW
--            name (crew_friend_*), so the old wave, DM and crew calls are left exactly as they were.
--
-- THE MODEL
--   * A crew room is a place. Your crew is your friends.
--   * SAY HI to someone who is not your crew is a crew request (crew_friend_wave). If they wave back, you are crew,
--     both ways, and a private chat opens. That is the whole flow; there is no separate "add to crew".
--   * Only crew can DM each other. A NEW chat opens only between two people who are crew both ways
--     (crew_friend_open_dm, or the mutual wave itself). Chats that already exist stay as they are.
--   * People already in your crew get POKE instead of SAY HI (crew_friend_poke): a light nudge, rate limited, live.
--   * The one who waved first hears the answer live as a 'crew' ping (crew_pings), in the room or anywhere in the app.
--   * Unread messages are tracked per person per chat (dm_reads, crew_friend_read), so the app can badge the Chat tab
--     and say who messaged you (crew_friend_inbox).
--   * Being on the map is YOURS to switch on: crew_map_share, default off (crew_friend_map). Being crew puts nobody on a
--     map. Nothing draws friends on the map yet; the day something does, it must read this and show only people who said yes.
--
-- WHAT THIS FILE ADDS (nothing existing is changed)
--   tables     crew_pings (a poke, or "you are crew now", between two people; private, live)
--              dm_reads   (when each person last read each chat)
--              crew_map_share (who has chosen to be on their crew's map; no row means no)
--   functions  crew_friend_wave(crew, peer)      SAY HI in a crew room: request, or the answer that makes you crew
--              crew_friend_respond(wave, accept) WAVE BACK / PASS from the Chat tab (no room needed)
--              crew_friend_open_dm(peer)         MESSAGE: the chat with a crew friend (made if there is none yet)
--              crew_friend_poke(peer)            POKE a crew friend
--              crew_friend_read(dm)              I have read this chat up to now
--              crew_friend_inbox()               waves waiting, crew faces, chats with unread counts, in one read
--              crew_friend_map(on)               SHOW ME ON THE MAP: my own switch, off until I turn it on
--              crew_friend_staff(crew)           the room's owner and admins, for the panel the owner's logo opens
--
-- WHAT IS NOT CHANGED, ON PURPOSE
--   * Event rooms, group chats, move chats and the Hop keep send_wave / respond_wave / add_to_crew as they are: a
--     mutual wave there opens a chat and writes no crew rows. crew_friend_respond answers those the old way.
--   * Hotspot rooms keep their aliases and never come near any function here (a hotspot key has no user id on it and
--     has no crew room).
--   * The old crew_room_wave still works for people on an older app. To make crew the ONLY way into a room chat once
--     the new app is live, run the one line at the bottom of this file (it is commented out).
--   * A one-way crew row (the old ADD TO CREW) stays. It shows in the list, but it unlocks nothing: crew means both ways.
--
-- LIMITS
--   waves   30 a day per person (same count as the old wave: one waves table, one count)
--   pokes   1 a minute to the same person, 30 a day in all
--   A block either way delivers nothing and still answers "sent": a block is never revealed.
-- ============================================================================
begin;

-- ------------------------------------------------------------------ tables ---
-- A ping is a tap between two people: kind 'poke' (the nudge) or 'crew' (you are crew now: it goes to the one who
-- waved first, so they hear it come back wherever they are). Only the two can read it, and Realtime delivers it.
create table if not exists public.crew_pings (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('poke', 'crew')),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create index if not exists crew_pings_from_idx on public.crew_pings (from_user, to_user, created_at desc);
create index if not exists crew_pings_to_idx on public.crew_pings (to_user, created_at desc);
alter table public.crew_pings enable row level security;

-- When each person last read each chat. Created once; on that first run everything already said counts as read, so
-- nobody opens the app to a badge for old chats. A run again does not touch it.
do $do$
begin
  if to_regclass('public.dm_reads') is null then
    create table public.dm_reads (
      user_id uuid not null references public.profiles(id) on delete cascade,
      dm_id   uuid not null references public.dms(id) on delete cascade,
      read_at timestamptz not null default now(),
      primary key (user_id, dm_id)
    );
    insert into public.dm_reads (user_id, dm_id)
      select a, id from public.dms
      union
      select b, id from public.dms
    on conflict do nothing;
  end if;
end $do$;
alter table public.dm_reads enable row level security;

-- One row per person who has ever touched the switch. No row means off. Own row only; the switch is a function.
create table if not exists public.crew_map_share (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  on_map     boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.crew_map_share enable row level security;

-- ----------------------------------------------------------------- helpers ---
-- Both people have the other in their crew.
create or replace function public._cf_mutual(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crew where user_id = p_a and friend_id = p_b)
     and exists (select 1 from crew where user_id = p_b and friend_id = p_a);
$$;

-- The row policies cannot call is_blocked (it is not granted to the app), so they call this.
create or replace function public._cf_visible(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() in (p_a, p_b) and not public.is_blocked(p_a, p_b);
$$;

-- The name the room shows for someone: display name, then handle. Same words as the room's snapshot.
create or replace function public._cf_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(display_name), ''), handle, 'A crew member') from profiles where id = p_user;
$$;

-- A crew they are both in (the verified, oldest one first), or null.
create or replace function public._cf_shared_crew(p_a uuid, p_b uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id
    from crews c
    join crew_members x on x.crew_id = c.id and x.user_id = p_a
    join crew_members y on y.crew_id = c.id and y.user_id = p_b
   order by c.verified desc, c.created_at, c.id
   limit 1;
$$;

-- Crew, both ways. A row that is already there is left alone.
create or replace function public._cf_make_crew(p_a uuid, p_b uuid) returns void
language sql security definer set search_path = public as $$
  insert into crew (user_id, friend_id) values (p_a, p_b), (p_b, p_a) on conflict do nothing;
$$;

-- The chat between two people: the one that is there, or a new one (the pair has one thread, ever).
create or replace function public._cf_dm(p_from uuid, p_to uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  select id into d from dms
   where least(a, b) = least(p_from, p_to) and greatest(a, b) = greatest(p_from, p_to);
  if d is not null then return d; end if;
  insert into dms (a, b, a_alias, b_alias, event_id)
  values (p_from, p_to,
          coalesce((select handle from profiles where id = p_from), 'A Hopper'),
          coalesce((select handle from profiles where id = p_to), 'A Hopper'),
          null)
  on conflict do nothing
  returning id into d;
  if d is null then
    select id into d from dms
     where least(a, b) = least(p_from, p_to) and greatest(a, b) = greatest(p_from, p_to);
  end if;
  return d;
end $$;

revoke all on function public._cf_mutual(uuid, uuid), public._cf_name(uuid), public._cf_shared_crew(uuid, uuid),
  public._cf_make_crew(uuid, uuid), public._cf_dm(uuid, uuid) from public, anon, authenticated;
revoke all on function public._cf_visible(uuid, uuid) from public, anon;
grant execute on function public._cf_visible(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- policies ---
drop policy if exists crew_pings_read on public.crew_pings;
create policy crew_pings_read on public.crew_pings for select to authenticated
  using (public._cf_visible(from_user, to_user));
revoke all on public.crew_pings from anon, authenticated;
grant select on public.crew_pings to authenticated;

drop policy if exists crew_map_share_own on public.crew_map_share;
create policy crew_map_share_own on public.crew_map_share for select to authenticated using (user_id = auth.uid());
revoke all on public.crew_map_share from anon, authenticated;
grant select on public.crew_map_share to authenticated;

drop policy if exists dm_reads_own on public.dm_reads;
create policy dm_reads_own on public.dm_reads for select to authenticated using (user_id = auth.uid());
revoke all on public.dm_reads from anon, authenticated;
grant select on public.dm_reads to authenticated;

do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crew_pings') then
    alter publication supabase_realtime add table public.crew_pings;
  end if;
end $do$;

-- ------------------------------------------------------------ SAY HI (room) ---
-- Returns: sent | crew:<dm id> | already | blocked | slow_down | self | gone | not_met | no_session | need_account
--   sent       the request is out (the one who waves back becomes crew)
--   crew:<dm>  you are crew now (they had waved first, or you already were): the chat to open
--   already    you waved, or they waved and it was passed
--   gone       (no longer answered: a first wave to someone who is not in the room waits for them in their inbox, and the
--              tap on the shoulder is sent only if they are in the room right now)
--   not_met    one of you is not in this crew
create or replace function public.crew_friend_wave(p_crew uuid, p_peer uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  fresh timestamptz := clock_timestamp() - public._crew_room_ttl();
  back waves; mine waves; n int; dm uuid;
begin
  if me is null then return 'no_session'; end if;
  if not public.has_account() then return 'need_account'; end if;
  if p_peer is null or p_peer = me then return 'self'; end if;
  if not exists (select 1 from crew_members where crew_id = p_crew and user_id = me)
     or not exists (select 1 from crew_members where crew_id = p_crew and user_id = p_peer) then
    return 'not_met';
  end if;
  if exists (select 1 from blocks where blocker = me and blocked = p_peer) then return 'blocked'; end if;
  if exists (select 1 from blocks where blocker = p_peer and blocked = me) then return 'sent'; end if;

  -- Already crew both ways: nothing to ask. The chat is the answer.
  if public._cf_mutual(me, p_peer) then return 'crew:' || public._cf_dm(me, p_peer)::text; end if;

  -- They waved at me first: waving back is the answer. Crew, both ways, and a chat.
  select * into back from waves where from_user = p_peer and to_user = me;
  if found then
    if back.status = 'pending' then
      update waves set status = 'accepted', responded_at = now() where id = back.id;
    end if;
    if back.status in ('pending', 'accepted') then
      perform public._cf_make_crew(me, p_peer);
      dm := public._cf_dm(back.from_user, back.to_user);
      if back.status = 'pending' then
        -- The one who waved first hears it come back, wherever they are: a 'crew' ping, live.
        insert into crew_pings (from_user, to_user, kind) values (me, p_peer, 'crew');
      end if;
      return 'crew:' || dm::text;
    end if;
    return 'already';   -- they waved and it was passed: no second try
  end if;

  -- My own wave, already answered (or still waiting).
  select * into mine from waves where from_user = me and to_user = p_peer;
  if found then
    if mine.status = 'accepted' then
      perform public._cf_make_crew(me, p_peer);
      return 'crew:' || public._cf_dm(me, p_peer)::text;
    end if;
    return 'already';
  end if;

  -- A first wave. They need not be in the room: it waits in their inbox (and the owner's logo can ask the owner who is away).
  -- The tap on the shoulder, live, goes only to someone who is in the room right now.
  select count(*) into n from waves where from_user = me and created_at > now() - interval '1 day';
  if n >= 30 then return 'slow_down'; end if;
  insert into waves (from_user, to_user, event_id, from_alias, to_alias)
  values (me, p_peer, null,
          (select coalesce(handle, 'A Hopper') from profiles where id = me),
          (select coalesce(handle, 'A Hopper') from profiles where id = p_peer));
  if exists (select 1 from crew_room_presence where crew_id = p_crew and user_id = p_peer and last_seen > fresh) then
    insert into crew_room_vibes (crew_id, from_user, to_user, sticker) values (p_crew, me, p_peer, 'wave');
  end if;
  return 'sent';
end $$;

-- ----------------------------------------------- WAVE BACK / PASS (Chat tab) ---
-- Answer a wave that is waiting for me, from anywhere (the room is not needed). Returns:
--   crew:<dm id>  a room wave, now crew both ways: the chat to open
--   dm:<dm id>    a wave from an event room, group chat, move or the Hop: a chat opens, no crew rows (as before)
--   passed | gone | blocked | no_session | need_account
create or replace function public.crew_friend_respond(p_wave uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  w waves; shared uuid; dm uuid;
begin
  if me is null then return 'no_session'; end if;
  if p_accept and not public.has_account() then return 'need_account'; end if;
  select * into w from waves where id = p_wave and to_user = me and status = 'pending';
  if not found then return 'gone'; end if;
  if not p_accept then
    update waves set status = 'declined', responded_at = now() where id = w.id;
    return 'passed';
  end if;
  if public.is_blocked(w.from_user, me) then return 'blocked'; end if;
  update waves set status = 'accepted', responded_at = now() where id = w.id returning * into w;

  -- A wave with no event, between two people who share a crew, was made in a crew room.
  shared := case when w.event_id is null then public._cf_shared_crew(w.from_user, me) end;
  if shared is not null then
    perform public._cf_make_crew(me, w.from_user);
    dm := public._cf_dm(w.from_user, me);
    insert into crew_pings (from_user, to_user, kind) values (me, w.from_user, 'crew');
    return 'crew:' || dm::text;
  end if;
  return 'dm:' || public.open_dm(w)::text;
end $$;

-- ------------------------------------------------------------ MESSAGE (crew) ---
-- The chat with a crew friend; made on the spot when there is none. Returns: dm:<id> | not_crew | blocked | self |
-- no_session | need_account. Crew means both ways: a one-way row opens nothing.
create or replace function public.crew_friend_open_dm(p_peer uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return 'no_session'; end if;
  if not public.has_account() then return 'need_account'; end if;
  if p_peer is null or p_peer = me then return 'self'; end if;
  if exists (select 1 from blocks where blocker = me and blocked = p_peer) then return 'blocked'; end if;
  if exists (select 1 from blocks where blocker = p_peer and blocked = me) then return 'not_crew'; end if;
  if not public._cf_mutual(me, p_peer) then return 'not_crew'; end if;
  return 'dm:' || public._cf_dm(me, p_peer)::text;
end $$;

-- ------------------------------------------------------------------- POKE ---
-- Returns: sent | slow_down | daily | not_crew | blocked | self | no_session | need_account
--   slow_down  a poke to this person already went in the last minute
--   daily      30 pokes today
create or replace function public.crew_friend_poke(p_peer uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n_pair int; n_day int;
begin
  if me is null then return 'no_session'; end if;
  if not public.has_account() then return 'need_account'; end if;
  if p_peer is null or p_peer = me then return 'self'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crew-poke:' || me::text, 0));
  if not public._cf_mutual(me, p_peer) then return 'not_crew'; end if;
  if exists (select 1 from blocks where blocker = me and blocked = p_peer) then return 'blocked'; end if;
  select count(*) filter (where to_user = p_peer and created_at > now() - interval '1 minute'), count(*)
    into n_pair, n_day
    from crew_pings where from_user = me and kind = 'poke' and created_at > now() - interval '1 day';
  if n_pair >= 1 then return 'slow_down'; end if;
  if n_day >= 30 then return 'daily'; end if;
  if exists (select 1 from blocks where blocker = p_peer and blocked = me) then return 'sent'; end if;   -- never revealed
  insert into crew_pings (from_user, to_user, kind) values (me, p_peer, 'poke');
  if random() < 0.05 then delete from crew_pings where created_at < now() - interval '2 days'; end if;
  return 'sent';
end $$;

-- ----------------------------------------------------------------- unread ---
-- "I have read this chat up to now." Called when a chat is open and a message comes in.
create or replace function public.crew_friend_read(p_dm uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from dms where id = p_dm and auth.uid() in (a, b)) then return; end if;
  insert into dm_reads (user_id, dm_id, read_at) values (auth.uid(), p_dm, clock_timestamp())
  on conflict (user_id, dm_id) do update set read_at = excluded.read_at;
end $$;

-- --------------------------------------------------------- SHOW ME ON THE MAP ---
-- My own switch. Returns the new state, or null without a session or an account. Off until I turn it on.
create or replace function public.crew_friend_map(p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_account() then return null; end if;
  insert into crew_map_share (user_id, on_map, updated_at) values (auth.uid(), coalesce(p_on, false), now())
  on conflict (user_id) do update set on_map = excluded.on_map, updated_at = now();
  return coalesce(p_on, false);
end $$;

-- ---------------------------------------------------------- owner and admins ---
-- The people who run a room, for the panel the owner's logo opens: id, name (as the room shows it), look, role, since
-- (when they joined), me (it is me), crew (they are my crew, so MESSAGE; otherwise SAY HI). Members of the room only.
-- Roles today are owner and member; any other role that is ever added shows here as it is. Someone I have blocked, or who
-- blocked me, is left out.
create or replace function public.crew_friend_staff(p_crew uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from crew_members where crew_id = p_crew and user_id = me) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', m.user_id, 'name', public._cf_name(m.user_id), 'look', p.avatar, 'role', m.role,
             'since', m.joined_at, 'me', m.user_id = me, 'crew', public._cf_mutual(me, m.user_id))
           order by (m.role = 'owner') desc, m.joined_at)
      from crew_members m
      join profiles p on p.id = m.user_id
     where m.crew_id = p_crew and m.role <> 'member' and not public.is_blocked(me, m.user_id)), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------- the Chat tab ---
-- One read for the whole tab, and for the badge and the "who messaged me" toast:
--   waves  waiting for me: id, from (their user id, room waves only), name, look, where (the crew, or the event), room, at
--   crew   my crew friends (both ways): id, name, look, dm (the chat id or null), unread
--   dms    my chats, newest first: the my_dms columns, plus other_id (crew friends only), unread, crew
--   unread messages waiting, in all
--   on_map my own SHOW ME ON THE MAP switch (false until I turn it on)
-- Names: a crew friend or a room wave shows the name the room showed (display name, then handle). Anyone else keeps the
-- old rule: the handle until both have revealed.
create or replace function public.crew_friend_inbox() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); v_waves jsonb; v_crew jsonb; v_dms jsonb; v_unread int;
begin
  if me is null then
    return jsonb_build_object('waves', '[]'::jsonb, 'crew', '[]'::jsonb, 'dms', '[]'::jsonb, 'unread', 0);
  end if;

  select coalesce(jsonb_agg(t.x order by t.at desc), '[]'::jsonb) into v_waves from (
    select k.created_at as at,
           jsonb_build_object(
             'id', k.id,
             'from', case when k.room then k.from_user end,
             'name', case when k.room then public._cf_name(k.from_user) else coalesce(p.handle, k.from_alias) end,
             'look', p.avatar,
             'where', case when k.room then k.crew_name else e.title end,
             'room', k.room,
             'at', k.created_at) as x
      from (select w.id, w.from_user, w.from_alias, w.event_id, w.created_at,
                   (w.event_id is null and public._cf_shared_crew(w.from_user, w.to_user) is not null) as room,
                   (select c.name from crews c where c.id = public._cf_shared_crew(w.from_user, w.to_user)) as crew_name
              from waves w
             where w.to_user = me and w.status = 'pending' and not public.is_blocked(w.from_user, w.to_user)) k
      join profiles p on p.id = k.from_user
      left join events e on e.id = k.event_id
     order by k.created_at desc
     limit 50) t;

  select coalesce(jsonb_agg(t.x order by t.at desc nulls last, t.nm), '[]'::jsonb) into v_crew from (
    select l.last_at as at, public._cf_name(f.friend_id) as nm,
           jsonb_build_object(
             'id', f.friend_id, 'name', public._cf_name(f.friend_id), 'look', p.avatar,
             'dm', dm.id, 'unread', coalesce(un.n, 0)) as x
      from crew f
      join crew back on back.user_id = f.friend_id and back.friend_id = f.user_id
      join profiles p on p.id = f.friend_id
      left join dms dm on least(dm.a, dm.b) = least(f.user_id, f.friend_id) and greatest(dm.a, dm.b) = greatest(f.user_id, f.friend_id)
      left join lateral (select max(created_at) as last_at from dm_messages m where m.dm_id = dm.id) l on true
      left join lateral (select count(*)::int as n from dm_messages m
                          where m.dm_id = dm.id and m.from_a = (dm.b = me)
                            and m.created_at > coalesce((select read_at from dm_reads r where r.user_id = me and r.dm_id = dm.id), dm.created_at)) un on true
     where f.user_id = me and not public.is_blocked(f.user_id, f.friend_id)
     limit 80) t;

  select coalesce(jsonb_agg(t.x order by t.at desc), '[]'::jsonb), coalesce(sum(t.unread), 0)::int into v_dms, v_unread from (
    select coalesce(l.created_at, x.created_at) as at, x.unread,
           jsonb_build_object(
             'id', x.id, 'i_am_a', x.i_am_a,
             'other_id', case when x.crew then x.other end,
             'other_name', case when x.crew or x.both then public._cf_name(x.other)
                                else coalesce(p.handle, case when x.i_am_a then x.b_alias else x.a_alias end) end,
             'other_handle', p.handle, 'other_look', p.avatar,
             'revealed', x.crew or x.both,
             'me_revealed', x.crew or case when x.i_am_a then x.a_revealed else x.b_revealed end,
             'them_revealed', x.crew or case when x.i_am_a then x.b_revealed else x.a_revealed end,
             'my_alias', case when x.i_am_a then x.a_alias else x.b_alias end,
             'event_title', e.title,
             'last_body', case when l.body = '' and l.image_path is not null then '📷 Photo' else l.body end,
             'last_at', coalesce(l.created_at, x.created_at),
             'unread', x.unread,
             'crew', x.crew) as x
      from (select dm.id, dm.a, dm.b, dm.a_alias, dm.b_alias, dm.a_revealed, dm.b_revealed, dm.event_id, dm.created_at,
                   (dm.a = me) as i_am_a,
                   case when dm.a = me then dm.b else dm.a end as other,
                   (dm.a_revealed and dm.b_revealed) as both,
                   public._cf_mutual(dm.a, dm.b) as crew,
                   (select count(*)::int from dm_messages m
                     where m.dm_id = dm.id and m.from_a = (dm.b = me)
                       and m.created_at > coalesce((select read_at from dm_reads r where r.user_id = me and r.dm_id = dm.id), dm.created_at)) as unread
              from dms dm
             where me in (dm.a, dm.b) and not public.is_blocked(dm.a, dm.b)) x
      join profiles p on p.id = x.other
      left join events e on e.id = x.event_id
      left join lateral (select body, image_path, created_at from dm_messages where dm_id = x.id
                          order by created_at desc limit 1) l on true
     order by coalesce(l.created_at, x.created_at) desc
     limit 100) t;

  return jsonb_build_object('waves', v_waves, 'crew', v_crew, 'dms', v_dms, 'unread', v_unread,
                            'on_map', coalesce((select m.on_map from crew_map_share m where m.user_id = me), false));
end $$;

-- ------------------------------------------------------------------ grants ---
revoke all on function public.crew_friend_wave(uuid, uuid), public.crew_friend_respond(uuid, boolean),
  public.crew_friend_open_dm(uuid), public.crew_friend_poke(uuid), public.crew_friend_read(uuid),
  public.crew_friend_inbox(), public.crew_friend_map(boolean), public.crew_friend_staff(uuid) from public, anon;
grant execute on function public.crew_friend_wave(uuid, uuid), public.crew_friend_respond(uuid, boolean),
  public.crew_friend_open_dm(uuid), public.crew_friend_poke(uuid), public.crew_friend_read(uuid),
  public.crew_friend_inbox(), public.crew_friend_map(boolean), public.crew_friend_staff(uuid) to authenticated;

-- ------------------------------------------------------------ OPTIONAL, LATER ---
-- Once the new app is live for everyone, close the old way into a room chat, so a chat from a crew room can only come
-- from crew_friend_wave. Left commented out: an app that has not updated yet still waves through the old call.
--   revoke execute on function public.crew_room_wave(uuid, uuid) from authenticated;
-- (A later run of crew_rails.sql grants it again; run this line again then.)

commit;
