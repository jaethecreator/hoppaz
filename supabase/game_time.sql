-- ============================================================================
-- Hoppaz: Game Time (a ticket hunt inside a crew room)
-- Run order: schema.sql, chat_accounts.sql, ... play.sql, push.sql, crew_rooms.sql, then THIS
-- FILE. Standalone, additive and safe to run again. Guide: docs/GAME-TIME.md.
-- Test: tests/game_time_test.sql (ends with ALL GAME TIME TESTS PASSED).
--
-- The idea: staff hide 1 to 10 boxes (one per ticket code) in the objects of a crew
-- room for a window of time. Crew members walk next to an object and SEARCH. The
-- first finder of a box wins the code; one win per account per campaign key.
--
-- What it adds:
--   tables         game_times (the event), game_time_spots (the room objects that may
--                  hide a box, with their tile rectangle), game_time_boxes (one per
--                  code: the code, where it is hiding now, who found it),
--                  game_time_wins (who won which code), game_time_players (search
--                  counters), game_time_rate (the 3 second search gap), game_time_feed
--                  (what the room is told: "Ada found a box", no code, no hiding spot).
--                  RLS is on and every table is closed to anon and authenticated,
--                  except game_time_feed, which a crew member can read (and Realtime
--                  carries). The codes and the hiding spots are therefore readable by
--                  the service role only.
--   Hopper calls   game_time_state(crew)    the banner, the countdown, the eligible
--                                            objects while live, boxes left, who found
--                                            what, whether this Hopper can still search
--                  game_time_list()          games starting soon or live, for the global
--                                            ping (any crew the Hopper can see)
--                  game_time_search(crew, object)   one search; the only way to learn
--                                            anything about the boxes
--                  my_game_time_wins()       the Hopper's tickets, for Me
--   staff calls    admin_game_time_create / _update / _start_now / _close / _status /
--                  _list / _winners, game_time_tick. Service role only (the admin route
--                  src/app/api/admin/game-time/route.ts calls them behind the staff token).
--                  They answer {"ok": true, ...} or {"ok": false, "reason": "..."}.
--
-- Rules:
--   window        a game is upcoming until opens_at, live until closes_at, all boxes are
--                 found or staff close it. Two games of one crew never overlap.
--   who           members of the crew with an account. A guest (no email) is refused,
--                 a non-member is refused.
--   where         the search needs a live walker in the room whose server-side position
--                 (crew_room_presence) is within one tile of the object (diagonals count).
--                 A watcher past the room cap has no walker and cannot search.
--   pace          one search per 3 seconds per account, across every game. The app paces itself at the
--                 3000 ms every answer carries (retry_ms); the server refuses under 2.5 s, so a slow
--                 network that bunches two honest searches is not punished.
--   the answer    NOTHING HERE with a hint (hot, warm or cold: the distance from the
--                 searched object to the nearest box nobody has found, measured between
--                 object centres in tiles, hot up to hot_tiles (5), warm up to warm_tiles (10),
--                 else cold), or a WIN.
--   the win       an atomic first-finder claim: update ... where claimed_by is null. The
--                 code goes to the winner only. The room is told through game_time_feed
--                 and game_time_state, so the box is gone for everyone within a poll.
--   limit         one win per account per campaign_key (default 'crew:<crew id>', so every
--                 game of a crew shares one limit; staff can set another key).
--   moving        an unfound box moves to another eligible object that holds no box after
--                 relocate_minutes without being found (0: never). It is checked on every
--                 search and by game_time_tick (pg_cron, every minute).
--   push          when a game opens, the crew's members who have a push subscription,
--                 whose alerts are not Off, who are not in the room and have not already
--                 won the campaign get one push through the existing send route (push.sql
--                 config, quiet hours respected). It does not spend the spot-alert quota.
--                 game_time_tick sends it within a minute of opens_at; START NOW sends at
--                 once; a Hopper loading the state or the list sends it too if cron is off.
--                 Never more than once per game, never more than 10 minutes late.
-- ============================================================================
begin;

-- Fail with a plain sentence, not a missing table half way down, when the files before this one are not loaded.
do $guard$
begin
  if to_regclass('public.crew_room_presence') is null or to_regclass('public.crew_room_layouts') is null
     or to_regprocedure('public._crew_room_ttl()') is null then
    raise exception 'game_time.sql needs crew_rooms.sql loaded first (run order in the header of this file)';
  end if;
  if to_regclass('public.push_subscriptions') is null or to_regclass('public.alert_prefs') is null
     or to_regprocedure('public.push_cfg(text,text)') is null or to_regprocedure('public.push_in_quiet_hours(timestamptz)') is null then
    raise exception 'game_time.sql needs push.sql loaded first (run order in the header of this file)';
  end if;
  if to_regprocedure('public.has_account()') is null or to_regprocedure('public.is_crew_member(uuid)') is null then
    raise exception 'game_time.sql needs schema.sql and chat_accounts.sql loaded first (run order in the header of this file)';
  end if;
end $guard$;

-- ------------------------------------------------------------------ tables ---
create table if not exists public.game_times (
  id               uuid primary key default gen_random_uuid(),
  crew_id          uuid not null references public.crews(id) on delete cascade,
  title            text not null check (char_length(title) between 2 and 60),
  opens_at         timestamptz not null,
  closes_at        timestamptz not null,
  -- Set when the last box is found ('all_found') or staff press CLOSE NOW ('closed').
  ended_at         timestamptz,
  ended_by         text check (ended_by in ('all_found', 'closed')),
  campaign_key     text not null check (char_length(campaign_key) between 1 and 80),
  -- The room the object rectangles were taken from. If the crew changes template or width
  -- afterwards the rectangles no longer match the room, so searches stop until staff save the
  -- objects again (admin_game_time_update with objects).
  room_template    text not null default 'clubhouse' check (char_length(room_template) between 1 and 40),
  room_width       integer not null default 30 check (room_width between 10 and 100),
  relocate_minutes integer not null default 10 check (relocate_minutes between 0 and 720),
  hot_tiles        numeric not null default 5 check (hot_tiles > 0 and hot_tiles <= 100),
  warm_tiles       numeric not null default 10 check (warm_tiles >= hot_tiles and warm_tiles <= 200),
  push_sent_at     timestamptz,
  push_count       integer,
  created_at       timestamptz not null default clock_timestamp(),
  updated_at       timestamptz not null default clock_timestamp(),
  check (closes_at > opens_at),
  check ((ended_at is null) = (ended_by is null))
);
create index if not exists game_times_crew on public.game_times(crew_id, opens_at desc);
create index if not exists game_times_unannounced on public.game_times(opens_at)
  where push_sent_at is null and ended_at is null;

-- The objects of the room that may hide a box. The rectangle is copied from the room's
-- template when staff save the game (tile units), so the adjacency check never reads
-- anything a Hopper can change.
create table if not exists public.game_time_spots (
  game_id   uuid not null references public.game_times(id) on delete cascade,
  object_id text not null check (object_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  x         integer not null check (x between 0 and 200),
  y         integer not null check (y between 0 and 200),
  w         integer not null check (w between 1 and 60),
  h         integer not null check (h between 1 and 60),
  primary key (game_id, object_id)
);

-- One box per ticket code. claimed_by and the win are not foreign keys on purpose: deleting
-- an account must never put a found box back in play.
create table if not exists public.game_time_boxes (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.game_times(id) on delete cascade,
  code       text not null check (char_length(code) between 1 and 80),
  spot_id    text not null,
  placed_at  timestamptz not null default clock_timestamp(),
  claimed_by uuid,
  claimed_at timestamptz,
  unique (game_id, code),
  check ((claimed_by is null) = (claimed_at is null))
);
-- At most one unfound box per object.
create unique index if not exists game_time_boxes_one_per_spot on public.game_time_boxes(game_id, spot_id) where claimed_by is null;

create table if not exists public.game_time_wins (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.game_times(id) on delete cascade,
  box_id       uuid not null unique references public.game_time_boxes(id) on delete cascade,
  user_id      uuid not null,
  campaign_key text not null,
  code         text not null,
  created_at   timestamptz not null default clock_timestamp()
);
-- The last line of defence for "one win per account per campaign".
create unique index if not exists game_time_wins_one_per_campaign on public.game_time_wins(campaign_key, user_id);
create index if not exists game_time_wins_user on public.game_time_wins(user_id, created_at desc);

create table if not exists public.game_time_players (
  game_id  uuid not null references public.game_times(id) on delete cascade,
  user_id  uuid not null,
  searches integer not null default 0,
  first_at timestamptz not null default clock_timestamp(),
  last_at  timestamptz not null default clock_timestamp(),
  primary key (game_id, user_id)
);

-- When this account last searched (any game): the 3 second gap.
create table if not exists public.game_time_rate (
  user_id uuid primary key,
  last_at timestamptz not null
);

-- What the room is told. Names and an object id of a box that is already gone; nothing about
-- a box still hiding.
create table if not exists public.game_time_feed (
  id        bigint generated always as identity primary key,
  game_id   uuid not null references public.game_times(id) on delete cascade,
  crew_id   uuid not null references public.crews(id) on delete cascade,
  name      text not null,
  object_id text not null,
  boxes_left integer not null,
  at        timestamptz not null default clock_timestamp()
);
create index if not exists game_time_feed_game on public.game_time_feed(game_id, id desc);

-- ----------------------------------------------------------------- helpers ---
-- Nothing below is callable by a Hopper (the grants at the end revoke it all).

-- The gap between two searches of one account. The app waits 3 s (retry_ms); the server floor is a little
-- lower so a network that delivers two honest searches close together is not refused.
create or replace function public._gt_gap() returns interval
language sql immutable set search_path = public as $$
  select interval '2.5 seconds';
$$;

-- The brand as a person reads it: always 360Playlist, one word.
create or replace function public._gt_brand(p_crew uuid) returns text
language sql stable security definer set search_path = public as $$
  select regexp_replace(left(coalesce(nullif(btrim(r.content->>'brand'), ''), c.name), 40), '360[[:space:]]*play[[:space:]]*list', '360Playlist', 'gi')
    from crews c left join crew_rooms r on r.crew_id = c.id
   where c.id = p_crew;
$$;

-- upcoming | live | all_found | closed | time_up
create or replace function public._gt_phase(g public.game_times) returns text
language sql stable set search_path = public as $$
  select case
    when g.ended_at is not null then g.ended_by
    when clock_timestamp() < g.opens_at then 'upcoming'
    when clock_timestamp() >= g.closes_at then 'time_up'
    else 'live' end;
$$;

-- The game a crew's room is about right now: the live one, else the next one (opening
-- within 48 hours), else the one that ended in the last 30 minutes. Null when none.
create or replace function public._gt_current(p_crew uuid) returns public.game_times
language plpgsql stable security definer set search_path = public as $$
declare
  g public.game_times;
  t timestamptz := clock_timestamp();
begin
  select x.* into g from game_times x
   where x.crew_id = p_crew and x.ended_at is null and x.opens_at <= t and x.closes_at > t
   order by x.opens_at desc limit 1;
  if found then return g; end if;
  select x.* into g from game_times x
   where x.crew_id = p_crew and x.ended_at is null and x.opens_at > t and x.opens_at <= t + interval '48 hours'
   order by x.opens_at limit 1;
  if found then return g; end if;
  select x.* into g from game_times x
   where x.crew_id = p_crew and x.opens_at <= t
     and least(coalesce(x.ended_at, 'infinity'::timestamptz), x.closes_at) > t - interval '30 minutes'
   order by least(coalesce(x.ended_at, 'infinity'::timestamptz), x.closes_at) desc limit 1;
  if found then return g; end if;
  return null;
end $$;

create or replace function public._gt_lock(p_game uuid) returns void
language sql security definer set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('game-time:' || p_game::text, 0));
$$;

-- A timestamp from a jsonb field: null when the field is missing or null, an error when it is not a time.
create or replace function public._gt_ts(p jsonb, k text) returns timestamptz
language plpgsql stable set search_path = public as $$
begin
  if p->k is null or jsonb_typeof(p->k) = 'null' then return null; end if;
  if jsonb_typeof(p->k) <> 'string' then raise exception 'gt:bad_times'; end if;
  return (p->>k)::timestamptz;
exception when others then
  raise exception 'gt:bad_times';
end $$;

-- 1 to 10 ticket codes, trimmed, no control characters, no duplicates (case does not count).
create or replace function public._gt_codes(p_codes jsonb) returns text[]
language plpgsql immutable set search_path = public as $$
declare
  c   jsonb;
  v   text;
  res text[] := '{}';
begin
  if p_codes is null or jsonb_typeof(p_codes) <> 'array' or jsonb_array_length(p_codes) not between 1 and 10 then
    raise exception 'gt:bad_codes';
  end if;
  for c in select * from jsonb_array_elements(p_codes) loop
    if jsonb_typeof(c) <> 'string' then raise exception 'gt:bad_codes'; end if;
    v := btrim(c #>> '{}');
    if char_length(v) not between 1 and 80 or v ~ '[[:cntrl:]]' then raise exception 'gt:bad_codes'; end if;
    if lower(v) = any (select lower(o) from unnest(res) o) then raise exception 'gt:dup_codes'; end if;
    res := res || v;
  end loop;
  return res;
end $$;

-- The room a crew has now, as {template, width}. Rooms saved before templates existed are the
-- clubhouse; a crew that never opened its room has the default one (30 wide).
create or replace function public._gt_room(p_crew uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('template', coalesce(to_jsonb(r)->>'template', 'clubhouse'), 'width', r.width)
       from crew_rooms r where r.crew_id = p_crew),
    jsonb_build_object('template', 'clubhouse', 'width', 30));
$$;

-- Does the game's object list still match the crew's room?
create or replace function public._gt_room_ok(g public.game_times) returns boolean
language sql stable security definer set search_path = public as $$
  select (public._gt_room(g.crew_id)->>'template') = g.room_template and (public._gt_room(g.crew_id)->>'width')::integer = g.room_width;
$$;

-- The first version took the list without the room; replaced by the three argument form below.
drop function if exists public._gt_objects(jsonb);
-- The objects staff chose, checked against the room's own layout (crew_room_layouts, made from
-- src/lib/campaign/templates.ts): 1 to 80 distinct ids, each the id of a solid prop of that template at that
-- width. An entry is an id ("mixing-desk") or {id, x, y, w, h}; either way the rectangle that is stored is the
-- layout's, and a rectangle that disagrees with the layout is refused. The door prop (kind maptable: tapping it
-- leaves for the map) never hides a box. Returns [{id, x, y, w, h}].
-- Reasons: bad_objects (not a list of ids), unknown_objects (not a prop of this room, or the wrong place).
create or replace function public._gt_objects(p_objects jsonb, p_template text, p_width integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o      jsonb;
  ids    text[] := '{}';
  res    jsonb := '[]';
  obj_id text;
  blk    jsonb;
  k      text;
begin
  if p_objects is null or jsonb_typeof(p_objects) <> 'array' or jsonb_array_length(p_objects) not between 1 and 80 then
    raise exception 'gt:bad_objects';
  end if;
  for o in select * from jsonb_array_elements(p_objects) loop
    if jsonb_typeof(o) = 'string' then
      obj_id := o #>> '{}';
    elsif jsonb_typeof(o) = 'object' and jsonb_typeof(o->'id') = 'string' then
      obj_id := o->>'id';
    else
      raise exception 'gt:bad_objects';
    end if;
    if obj_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' or obj_id = any (ids) then raise exception 'gt:bad_objects'; end if;
    select b into blk
      from crew_room_layouts l cross join lateral jsonb_array_elements(l.data->'blocks') b
     where l.template = p_template and l.width = p_width and b->>'id' = obj_id and (b->>'solid') = 'true'
       and coalesce(b->>'kind', '') <> 'maptable'
     limit 1;
    if blk is null then raise exception 'gt:unknown_objects'; end if;
    if jsonb_typeof(o) = 'object' then
      foreach k in array array['x', 'y', 'w', 'h'] loop
        if jsonb_typeof(o->k) is distinct from 'number' or (o->>k) is distinct from (blk->>k) then raise exception 'gt:unknown_objects'; end if;
      end loop;
    end if;
    ids := ids || obj_id;
    res := res || jsonb_build_object('id', obj_id, 'x', (blk->>'x')::integer, 'y', (blk->>'y')::integer,
                                     'w', (blk->>'w')::integer, 'h', (blk->>'h')::integer);
  end loop;
  return res;
end $$;

-- Checks the room a staff payload says its rectangles came from: both keys, or neither (then the
-- room as it is now). Returns {template, width}. Reason room_changed when it is not the room the crew has.
create or replace function public._gt_room_arg(p_crew uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  now_room jsonb := public._gt_room(p_crew);
begin
  if not (p ? 'room_template') and not (p ? 'room_width') then return now_room; end if;
  if jsonb_typeof(p->'room_template') is distinct from 'string' or coalesce(p->>'room_width', '') !~ '^[0-9]{2,3}$' then
    raise exception 'gt:bad_objects';
  end if;
  if (p->>'room_template') is distinct from (now_room->>'template') or (p->>'room_width')::integer is distinct from (now_room->>'width')::integer then
    raise exception 'gt:room_changed';
  end if;
  return now_room;
end $$;

-- Puts one box per code on its own random object of the game. The caller holds the game lock.
create or replace function public._gt_place(p_game uuid, p_codes text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from game_time_spots where game_id = p_game) < coalesce(array_length(p_codes, 1), 0) then
    raise exception 'gt:not_enough_spots';
  end if;
  insert into game_time_boxes (game_id, code, spot_id, placed_at)
  select p_game, c.code, s.object_id, clock_timestamp()
    from (select code, row_number() over (order by random()) rn from unnest(p_codes) as code) c
    join (select object_id, row_number() over (order by random()) rn from game_time_spots where game_id = p_game) s using (rn);
end $$;

-- True when another game of the crew (one still going) has a window that meets this one.
create or replace function public._gt_overlaps(p_crew uuid, p_opens timestamptz, p_closes timestamptz, p_except uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from game_times g
     where g.crew_id = p_crew and g.id is distinct from p_except and g.ended_at is null
       and g.opens_at < p_closes and p_opens < g.closes_at);
$$;

-- Moves every unfound box that has sat on its object for relocate_minutes (counted from the later of
-- its last placement and the opening) to a random other eligible object with no box on it. When there
-- is no free object it stays and the clock restarts. The caller holds the game lock.
create or replace function public._gt_relocate(p_game uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  g      public.game_times;
  b      public.game_time_boxes;
  target text;
  moved  integer := 0;
  t      timestamptz := clock_timestamp();
begin
  select * into g from game_times where id = p_game;
  if not found or g.relocate_minutes = 0 or g.ended_at is not null or t < g.opens_at or t >= g.closes_at then return 0; end if;
  for b in
    select x.* from game_time_boxes x
     where x.game_id = p_game and x.claimed_by is null
       and greatest(x.placed_at, g.opens_at) + make_interval(mins => g.relocate_minutes) <= t
     order by random()
  loop
    select s.object_id into target from game_time_spots s
     where s.game_id = p_game and s.object_id <> b.spot_id
       and not exists (select 1 from game_time_boxes o where o.game_id = p_game and o.spot_id = s.object_id and o.claimed_by is null)
     order by random() limit 1;
    if target is not null then
      update game_time_boxes set spot_id = target, placed_at = t where id = b.id;
      moved := moved + 1;
    else
      update game_time_boxes set placed_at = t where id = b.id;
    end if;
  end loop;
  return moved;
end $$;

-- ------------------------------------------------------------------- push ---
-- Who hears that a game opened: crew members with a push subscription whose alerts are not Off,
-- who are not walking in the room right now and have not already won this campaign.
create or replace function public._gt_open_recipients(p_game uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct m.user_id
    from game_times g
    join crew_members m on m.crew_id = g.crew_id
    left join alert_prefs ap on ap.user_id = m.user_id
   where g.id = p_game
     and coalesce(ap.alert_level, 'few') <> 'off'
     and exists (select 1 from push_subscriptions s where s.user_id = m.user_id)
     and not exists (select 1 from crew_room_presence p
                      where p.crew_id = g.crew_id and p.user_id = m.user_id and p.last_seen > clock_timestamp() - public._crew_room_ttl())
     and not exists (select 1 from game_time_wins w where w.campaign_key = g.campaign_key and w.user_id = m.user_id);
$$;

-- Is the push path ready (pg_net, and the send route's address and secret from push.sql)?
create or replace function public._gt_push_ready() returns boolean
language sql stable security definer set search_path = public as $$
  select to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null
     and public.push_cfg('send_url', '') <> '' and public.push_cfg('send_secret', '') <> '';
$$;

-- Sends the opening push once. Returns how many Hoppers were alerted. Quiet hours: nothing is sent and
-- the game is marked done. Push not set up yet: nothing is sent and the game is NOT marked, so a later
-- tick inside the 10 minute window can still send it. If queueing fails, the mark is undone.
create or replace function public._gt_notify_open(p_game uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  g           public.game_times;
  t           timestamptz := clock_timestamp();
  send_url    text := public.push_cfg('send_url', '');
  send_secret text := public.push_cfg('send_secret', '');
  brand       text;
  boxes       integer;
  alerts      jsonb;
  total       integer := 0;
begin
  select * into g from game_times where id = p_game;
  if not found or g.push_sent_at is not null or g.ended_at is not null
     or t < g.opens_at or t >= g.closes_at or t > g.opens_at + interval '10 minutes' then
    return 0;
  end if;
  if public.push_in_quiet_hours(t) then
    update game_times set push_sent_at = t, push_count = 0 where id = p_game and push_sent_at is null;
    return 0;
  end if;
  if not public._gt_push_ready() then return 0; end if;
  begin
    update game_times set push_sent_at = t where id = p_game and push_sent_at is null returning * into g;
    if not found then return 0; end if;
    brand := public._gt_brand(g.crew_id);
    select count(*) into boxes from game_time_boxes where game_id = p_game;
    for alerts in
      select jsonb_agg(jsonb_build_object(
               'user_id', r.uid,
               'title', 'GAME TIME in the ' || brand || ' room',
               'body', case when boxes = 1 then '1 box is hiding. First to find it wins a ticket. Run!'
                            else boxes::text || ' boxes are hiding. First to find one wins a ticket. Run!' end,
               'url', '/crew/' || g.crew_id::text || '/room',
               'tag', 'game-time-' || g.id::text))
        from (select u as uid, (row_number() over (order by u) - 1) / 500 as grp from public._gt_open_recipients(p_game) as u) r
       group by r.grp
    loop
      perform net.http_post(
        url := send_url,
        body := jsonb_build_object('alerts', alerts),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || send_secret),
        timeout_milliseconds := 8000);
      total := total + jsonb_array_length(alerts);
    end loop;
    update game_times set push_count = total where id = p_game;
    return total;
  exception when others then
    -- the sub-transaction undid the mark; a later tick inside the window tries again
    raise warning 'game time push failed: %', sqlerrm;
    return 0;
  end;
end $$;

-- Sends the opening push for any game that just opened and has not sent it. Called by every state read and by
-- the tick. Cheap when there is none (one indexed look). When another call is already sending, this one skips
-- instead of waiting, so a crowd all loading the room at the opening second does not queue behind the sender.
create or replace function public._gt_open_due() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  t timestamptz := clock_timestamp();
begin
  for r in
    select id from game_times
     where push_sent_at is null and ended_at is null and opens_at <= t and opens_at > t - interval '10 minutes' and closes_at > t
     limit 3
  loop
    if pg_try_advisory_xact_lock(hashtextextended('game-time-push:' || r.id::text, 0)) then
      perform public._gt_notify_open(r.id);
    end if;
  end loop;
end $$;

-- --------------------------------------------------------- Hopper reading ---
-- The room's view of its game. Null when the crew is private and the caller is not in it; otherwise
-- {server_now, game, me}. game is null when the crew has no game to show. Nothing here depends on where
-- a box is hiding or on any code. objects (the eligible objects) are given to members while the game is live.
create or replace function public.game_time_state(p_crew uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  g      public.game_times;
  phase  text;
  member boolean;
  total  integer;
  left_n integer;
  won    boolean;
  my_code text;
  my_won_at timestamptz;
  room_ok boolean;
begin
  perform public._gt_open_due();
  member := me is not null and exists (select 1 from crew_members where crew_id = p_crew and user_id = me);
  if not member and not exists (select 1 from crews where id = p_crew and visibility = 'open') then return null; end if;
  g := public._gt_current(p_crew);
  if g.id is null then
    return jsonb_build_object('server_now', clock_timestamp(), 'game', null,
                              'me', jsonb_build_object('member', member, 'won', false, 'code', null, 'won_at', null, 'can_search', false));
  end if;
  phase := public._gt_phase(g);
  room_ok := public._gt_room_ok(g);
  select count(*), count(*) filter (where claimed_by is null) into total, left_n from game_time_boxes where game_id = g.id;
  won := me is not null and exists (select 1 from game_time_wins w where w.campaign_key = g.campaign_key and w.user_id = me);
  select w.code, w.created_at into my_code, my_won_at from game_time_wins w where w.game_id = g.id and w.user_id = me;
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'game', jsonb_build_object(
      'id', g.id,
      'crew_id', g.crew_id,
      'crew_name', (select c.name from crews c where c.id = g.crew_id),
      'title', g.title,
      'brand', public._gt_brand(g.crew_id),
      'status', case when phase in ('upcoming', 'live') then phase else 'over' end,
      'over_reason', case when phase in ('all_found', 'closed', 'time_up') then phase end,
      'opens_at', g.opens_at,
      'closes_at', g.closes_at,
      'ended_at', coalesce(g.ended_at, case when phase = 'time_up' then g.closes_at end),
      'boxes_total', total,
      'boxes_left', left_n,
      'search_gap_ms', 3000,
      'room_ok', room_ok,
      'objects', case when member and phase = 'live' and room_ok
                      then (select coalesce(jsonb_agg(s.object_id order by s.object_id), '[]') from game_time_spots s where s.game_id = g.id)
                      else '[]'::jsonb end,
      'feed_tail', case when member then coalesce((select max(f.id) from game_time_feed f where f.game_id = g.id), 0) else 0 end,
      'found', case when member then coalesce((
                 select jsonb_agg(jsonb_build_object('id', f.id, 'at', f.at, 'name', f.name, 'object', f.object_id, 'boxes_left', f.boxes_left) order by f.id desc)
                   from (select * from game_time_feed where game_id = g.id order by id desc limit 10) f), '[]')
               else '[]'::jsonb end),
    'me', jsonb_build_object(
      'member', member,
      'won', coalesce(won, false),
      'code', my_code,
      'won_at', my_won_at,
      'can_search', member and phase = 'live' and room_ok and not coalesce(won, false) and public.has_account()));
end $$;

-- Games starting within 6 hours or live now, in crews the caller can see (open crews, and their own),
-- for the global ping. Each one says whether the caller is in the crew.
create or replace function public.game_time_list() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  t  timestamptz := clock_timestamp();
begin
  perform public._gt_open_due();
  return jsonb_build_object('server_now', t, 'games', coalesce((
    select jsonb_agg(q.j order by q.j->>'opens_at') from (
      select jsonb_build_object(
               'id', g.id, 'crew_id', g.crew_id, 'crew_name', c.name, 'brand', public._gt_brand(g.crew_id),
               'verified', c.verified, 'title', g.title,
               'status', case when g.opens_at > t then 'upcoming' else 'live' end,
               'opens_at', g.opens_at, 'closes_at', g.closes_at,
               'boxes_total', (select count(*) from game_time_boxes b where b.game_id = g.id),
               'boxes_left', (select count(*) from game_time_boxes b where b.game_id = g.id and b.claimed_by is null),
               'is_member', m.user_id is not null,
               'won', me is not null and exists (select 1 from game_time_wins w where w.campaign_key = g.campaign_key and w.user_id = me)) as j
        from game_times g
        join crews c on c.id = g.crew_id
        left join crew_members m on m.crew_id = g.crew_id and m.user_id = me
       where g.ended_at is null and g.closes_at > t and g.opens_at <= t + interval '6 hours'
         and (c.visibility = 'open' or m.user_id is not null)
         and exists (select 1 from game_time_boxes b where b.game_id = g.id and b.claimed_by is null)
       order by g.opens_at
       limit 5) q), '[]'));
end $$;

-- The Hopper's tickets, newest first.
create or replace function public.my_game_time_wins() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id, 'game_id', g.id, 'title', g.title, 'crew_id', g.crew_id, 'brand', public._gt_brand(g.crew_id),
           'code', w.code, 'won_at', w.created_at) order by w.created_at desc), '[]')
    from game_time_wins w join game_times g on g.id = w.game_id
   where w.user_id = auth.uid();
$$;

-- ------------------------------------------------------------- the search ---
-- One search. Refusals are errors (the message is the reason):
--   need_account    no session, or a guest without an email
--   not_in_crew     not a member of the crew
--   no_game         the crew has no game to search
--   not_open_yet    the game has not opened
--   all_found       every box is found
--   game_closed     time is up, or staff closed it
--   already_won     this account already won this campaign
--   not_in_room     no live walker in the room (left, timed out, or only watching a full room)
--   room_changed    the crew changed its room template or width after the objects were saved; staff save
--                   the objects again (until then nobody can search)
--   unknown_object  not one of the game's eligible objects
--   too_far         the walker is more than one tile from the object
--   slow_down       under 3 seconds since this account's last search
-- Answers:
--   {"result": "nothing", "hint": "hot" | "warm" | "cold", "boxes_left": n, "object": id, "feed_tail": n, "retry_ms": 3000}
--   {"result": "win", "code": "...", "game_id", "title", "object", "boxes_left": n, "game_over": bool, "won_at", "feed_tail": n, "retry_ms": 3000}
-- feed_tail is the id of the newest line of the room's feed, so the app can tell at once whether it has missed a find.
create or replace function public.game_time_search(p_crew uuid, p_object text) returns jsonb
language plpgsql security definer set search_path = public set lock_timeout = '4s' as $$
declare
  me       uuid := auth.uid();
  g        public.game_times;
  phase    text;
  pres     public.crew_room_presence;
  spot     public.game_time_spots;
  b        public.game_time_boxes;
  n        integer;
  dist     numeric;
  hint     text;
  win_code text;
  left_n   integer;
  who      text;
  t        timestamptz;
begin
  if me is null or not public.has_account() then raise exception 'need_account'; end if;
  if not exists (select 1 from crew_members where crew_id = p_crew and user_id = me) then raise exception 'not_in_crew'; end if;
  g := public._gt_current(p_crew);
  if g.id is null then raise exception 'no_game'; end if;
  phase := public._gt_phase(g);
  if phase <> 'live' then
    raise exception '%', case phase when 'upcoming' then 'not_open_yet' when 'all_found' then 'all_found' else 'game_closed' end;
  end if;
  if exists (select 1 from game_time_wins w where w.campaign_key = g.campaign_key and w.user_id = me) then raise exception 'already_won'; end if;
  if not public._gt_room_ok(g) then raise exception 'room_changed'; end if;
  select * into pres from crew_room_presence p
   where p.crew_id = p_crew and p.user_id = me and p.last_seen > clock_timestamp() - public._crew_room_ttl();
  if not found then raise exception 'not_in_room'; end if;
  select * into spot from game_time_spots s where s.game_id = g.id and s.object_id = p_object;
  if not found then raise exception 'unknown_object'; end if;
  -- Within one tile of the object's rectangle, diagonals included.
  if greatest(spot.x - pres.x, 0, pres.x - (spot.x + spot.w - 1)) > 1
     or greatest(spot.y - pres.y, 0, pres.y - (spot.y + spot.h - 1)) > 1 then
    raise exception 'too_far';
  end if;
  -- The gap: this row moves only when the last search is old enough, so two at once cannot both pass.
  -- A refusal further down rolls this back, so only a counted search uses the gap.
  insert into game_time_rate (user_id, last_at) values (me, clock_timestamp())
  on conflict (user_id) do update set last_at = excluded.last_at
   where game_time_rate.last_at <= clock_timestamp() - public._gt_gap();
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'slow_down' using detail = greatest(1, ceil(extract(epoch from
      (select r.last_at + public._gt_gap() - clock_timestamp() from game_time_rate r where r.user_id = me)) * 1000))::text;
  end if;

  -- Everything about one game's boxes happens one search at a time.
  perform public._gt_lock(g.id);
  select * into g from game_times where id = g.id;
  phase := public._gt_phase(g);
  if phase <> 'live' then
    raise exception '%', case phase when 'upcoming' then 'not_open_yet' when 'all_found' then 'all_found' else 'game_closed' end;
  end if;
  perform public._gt_relocate(g.id);
  insert into game_time_players (game_id, user_id, searches) values (g.id, me, 1)
  on conflict (game_id, user_id) do update set searches = game_time_players.searches + 1, last_at = clock_timestamp();

  select * into b from game_time_boxes x where x.game_id = g.id and x.spot_id = p_object and x.claimed_by is null;
  if found then
    -- The first finder: the box is theirs only if nobody took it between the read and now.
    t := clock_timestamp();
    update game_time_boxes set claimed_by = me, claimed_at = t
     where id = b.id and claimed_by is null and spot_id = p_object
    returning code into win_code;
  end if;

  if win_code is not null then
    begin
      insert into game_time_wins (game_id, box_id, user_id, campaign_key, code) values (g.id, b.id, me, g.campaign_key, win_code);
    exception when unique_violation then
      -- raising here also undoes the claim above
      raise exception 'already_won';
    end;
    select count(*) into left_n from game_time_boxes where game_id = g.id and claimed_by is null;
    if left_n = 0 then
      update game_times set ended_at = t, ended_by = 'all_found', updated_at = t where id = g.id;
    end if;
    select coalesce(nullif(btrim(pr.display_name), ''), 'A crew member') into who from profiles pr where pr.id = me;
    insert into game_time_feed (game_id, crew_id, name, object_id, boxes_left)
    values (g.id, g.crew_id, coalesce(who, 'A crew member'), p_object, left_n);
    return jsonb_build_object('result', 'win', 'code', win_code, 'game_id', g.id, 'title', g.title, 'object', p_object,
                              'boxes_left', left_n, 'game_over', left_n = 0, 'won_at', t, 'retry_ms', 3000,
                              'feed_tail', (select coalesce(max(f.id), 0) from game_time_feed f where f.game_id = g.id));
  end if;

  -- Nothing here. The hint is the distance, centre to centre, to the nearest box nobody has found.
  select min(sqrt(power((spot.x + (spot.w - 1) / 2.0) - (o.x + (o.w - 1) / 2.0), 2)
                + power((spot.y + (spot.h - 1) / 2.0) - (o.y + (o.h - 1) / 2.0), 2)))
    into dist
    from game_time_boxes x
    join game_time_spots o on o.game_id = x.game_id and o.object_id = x.spot_id
   where x.game_id = g.id and x.claimed_by is null;
  select count(*) into left_n from game_time_boxes where game_id = g.id and claimed_by is null;
  hint := case when dist <= g.hot_tiles then 'hot' when dist <= g.warm_tiles then 'warm' else 'cold' end;
  return jsonb_build_object('result', 'nothing', 'hint', hint, 'boxes_left', left_n, 'object', p_object, 'retry_ms', 3000,
                            'feed_tail', (select coalesce(max(f.id), 0) from game_time_feed f where f.game_id = g.id));
end $$;

-- ------------------------------------------------------------ staff calls ---
-- A room's template and width cannot change under a hunt: crew_room_set_template (crew_rooms.sql) asks this.
-- True while the crew has a game that is scheduled or live (not finished, not out of time).
create or replace function public._crew_room_hunt_busy(p_crew uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from game_times g where g.crew_id = p_crew and g.ended_at is null and g.closes_at > clock_timestamp());
$$;

-- Everything staff see about one game, codes and hiding spots included. Staff only.
create or replace function public._gt_admin_view(p_game uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  g     public.game_times;
  phase text;
begin
  select * into g from game_times where id = p_game;
  if not found then return null; end if;
  phase := public._gt_phase(g);
  return jsonb_build_object(
    'id', g.id,
    'crew_id', g.crew_id,
    'crew_name', (select name from crews where id = g.crew_id),
    'brand', public._gt_brand(g.crew_id),
    'title', g.title,
    'status', case when phase in ('upcoming', 'live') then phase else 'over' end,
    'phase', phase,
    'opens_at', g.opens_at,
    'closes_at', g.closes_at,
    'ended_at', g.ended_at,
    'campaign_key', g.campaign_key,
    'room_template', g.room_template,
    'room_width', g.room_width,
    'room_ok', public._gt_room_ok(g),
    'relocate_minutes', g.relocate_minutes,
    'hot_tiles', g.hot_tiles,
    'warm_tiles', g.warm_tiles,
    'push_sent_at', g.push_sent_at,
    'push_count', g.push_count,
    'push_ready', public._gt_push_ready(),
    'boxes_total', (select count(*) from game_time_boxes where game_id = g.id),
    'boxes_left', (select count(*) from game_time_boxes where game_id = g.id and claimed_by is null),
    'searches', coalesce((select sum(searches) from game_time_players where game_id = g.id), 0),
    'searchers', (select count(*) from game_time_players where game_id = g.id),
    'claims', (select count(*) from game_time_wins where game_id = g.id),
    'members', (select count(*) from crew_members where crew_id = g.crew_id),
    'in_room', (select count(*) from crew_room_presence p where p.crew_id = g.crew_id and p.last_seen > clock_timestamp() - public._crew_room_ttl()),
    'objects', coalesce((select jsonb_agg(jsonb_build_object('id', s.object_id, 'x', s.x, 'y', s.y, 'w', s.w, 'h', s.h) order by s.object_id)
                           from game_time_spots s where s.game_id = g.id), '[]'),
    'boxes', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', b.id, 'code', b.code, 'spot', b.spot_id, 'placed_at', b.placed_at,
                  'claimed_at', b.claimed_at, 'claimed_by', b.claimed_by, 'handle', pr.handle, 'name', pr.display_name)
                  order by b.code)
                 from game_time_boxes b left join profiles pr on pr.id = b.claimed_by where b.game_id = g.id), '[]'));
end $$;

-- Make a game. p_args: {crew_id, title, opens_at | start_now: true, closes_at | duration_minutes, codes:[...],
-- objects:[id or {id,x,y,w,h}], room_template + room_width (the room the rectangles were taken from; both or
-- neither), relocate_minutes?, campaign_key?, hot_tiles?, warm_tiles?}. A game never opens by accident: say when
-- (opens_at) or say start_now true, which opens it this second and sends the push. duration_minutes (1 to 10080)
-- counts from the opening. Reasons: bad_args unknown_field bad_crew bad_title bad_times in_past too_long
-- bad_codes dup_codes bad_objects unknown_objects room_changed not_enough_spots bad_relocate bad_tiles
-- bad_campaign overlaps.
create or replace function public.admin_game_time_create(p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k       text;
  v_crew  uuid;
  v_title text;
  v_open  timestamptz;
  v_close timestamptz;
  v_codes text[];
  v_objs  jsonb;
  v_room  jsonb;
  v_reloc integer := 10;
  v_hot   numeric := 5;
  v_warm  numeric := 10;
  v_key   text;
  gid     uuid;
  t       timestamptz := clock_timestamp();
begin
  if p_args is null or jsonb_typeof(p_args) <> 'object' then raise exception 'gt:bad_args'; end if;
  for k in select jsonb_object_keys(p_args) loop
    if k not in ('crew_id', 'title', 'opens_at', 'closes_at', 'duration_minutes', 'codes', 'objects', 'room_template',
                 'room_width', 'relocate_minutes', 'campaign_key', 'hot_tiles', 'warm_tiles', 'start_now') then
      raise exception 'gt:unknown_field';
    end if;
  end loop;
  if coalesce(p_args->>'crew_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'gt:bad_crew'; end if;
  v_crew := (p_args->>'crew_id')::uuid;
  if not exists (select 1 from crews where id = v_crew) then raise exception 'gt:bad_crew'; end if;
  if jsonb_typeof(p_args->'title') is distinct from 'string' then raise exception 'gt:bad_title'; end if;
  v_title := btrim(p_args->>'title');
  if char_length(v_title) not between 2 and 60 then raise exception 'gt:bad_title'; end if;

  if p_args ? 'start_now' and jsonb_typeof(p_args->'start_now') <> 'boolean' then raise exception 'gt:bad_args'; end if;
  if p_args->'start_now' = 'true'::jsonb then
    if public._gt_ts(p_args, 'opens_at') is not null then raise exception 'gt:bad_times'; end if;
    v_open := t;
  else
    v_open := public._gt_ts(p_args, 'opens_at');
    if v_open is null then raise exception 'gt:bad_times'; end if;
  end if;
  if p_args ? 'duration_minutes' and public._gt_ts(p_args, 'closes_at') is not null then raise exception 'gt:bad_times'; end if;
  if p_args ? 'duration_minutes' then
    if coalesce(p_args->>'duration_minutes', '') !~ '^[0-9]{1,5}$' or (p_args->>'duration_minutes')::integer not between 1 and 10080 then
      raise exception 'gt:bad_times';
    end if;
    v_close := v_open + make_interval(mins => (p_args->>'duration_minutes')::integer);
  else
    v_close := public._gt_ts(p_args, 'closes_at');
  end if;
  if v_close is null or v_close <= v_open then raise exception 'gt:bad_times'; end if;
  if v_close <= t then raise exception 'gt:in_past'; end if;
  if v_close - v_open > interval '7 days' then raise exception 'gt:too_long'; end if;

  v_codes := public._gt_codes(p_args->'codes');
  -- The room cannot change while its hiding places are read: crew_room_settings holds this lock too.
  perform public._crew_room_lock(v_crew);
  v_room := public._gt_room_arg(v_crew, p_args);
  v_objs := public._gt_objects(p_args->'objects', v_room->>'template', (v_room->>'width')::integer);
  if jsonb_array_length(v_objs) < array_length(v_codes, 1) then raise exception 'gt:not_enough_spots'; end if;

  if p_args ? 'relocate_minutes' then
    if coalesce(p_args->>'relocate_minutes', '') !~ '^[0-9]{1,3}$' or (p_args->>'relocate_minutes')::integer > 720 then raise exception 'gt:bad_relocate'; end if;
    v_reloc := (p_args->>'relocate_minutes')::integer;
  end if;
  if p_args ? 'hot_tiles' then
    if coalesce(p_args->>'hot_tiles', '') !~ '^[0-9]{1,3}(\.[0-9])?$' or (p_args->>'hot_tiles')::numeric <= 0 then raise exception 'gt:bad_tiles'; end if;
    v_hot := (p_args->>'hot_tiles')::numeric;
  end if;
  if p_args ? 'warm_tiles' then
    if coalesce(p_args->>'warm_tiles', '') !~ '^[0-9]{1,3}(\.[0-9])?$' then raise exception 'gt:bad_tiles'; end if;
    v_warm := (p_args->>'warm_tiles')::numeric;
  end if;
  if v_warm < v_hot or v_hot > 100 or v_warm > 200 then raise exception 'gt:bad_tiles'; end if;
  v_key := coalesce(nullif(btrim(p_args->>'campaign_key'), ''), 'crew:' || v_crew::text);
  if char_length(v_key) > 80 or v_key ~ '[[:cntrl:]]' then raise exception 'gt:bad_campaign'; end if;

  perform pg_advisory_xact_lock(hashtextextended('game-time-crew:' || v_crew::text, 0));
  if public._gt_overlaps(v_crew, v_open, v_close, null) then raise exception 'gt:overlaps'; end if;

  insert into game_times (crew_id, title, opens_at, closes_at, campaign_key, room_template, room_width, relocate_minutes, hot_tiles, warm_tiles)
  values (v_crew, v_title, v_open, v_close, v_key, v_room->>'template', (v_room->>'width')::integer, v_reloc, v_hot, v_warm)
  returning id into gid;
  insert into game_time_spots (game_id, object_id, x, y, w, h)
  select gid, o.id, o.x, o.y, o.w, o.h from jsonb_to_recordset(v_objs) as o(id text, x integer, y integer, w integer, h integer);
  perform public._gt_place(gid, v_codes);
  if v_open <= t then perform public._gt_notify_open(gid); end if;
  return jsonb_build_object('ok', true, 'game', public._gt_admin_view(gid));
exception when others then
  if sqlerrm like 'gt:%' then return jsonb_build_object('ok', false, 'reason', substr(sqlerrm, 4)); end if;
  raise;
end $$;

-- Change a game. p_patch may hold: title, opens_at (only before it opens), closes_at (later than now; a game
-- whose time ran out opens again when it is pushed past now), relocate_minutes, hot_tiles, warm_tiles,
-- campaign_key (until someone has won), objects with room_template and room_width (the rectangles are taken
-- again from the room as it is now; boxes on a removed object move to a free one), codes (until someone has
-- won; sending the same codes again changes nothing). A finished game (all found, or closed) cannot be
-- changed. Extra reasons: not_found ended already_open codes_locked campaign_locked.
create or replace function public.admin_game_time_update(p_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g       public.game_times;
  b       public.game_time_boxes;
  phase   text;
  k       text;
  v_title text;
  v_open  timestamptz;
  v_close timestamptz;
  v_reloc integer;
  v_hot   numeric;
  v_warm  numeric;
  v_key   text;
  v_objs  jsonb;
  v_room  jsonb;
  v_codes text[];
  target  text;
  t       timestamptz := clock_timestamp();
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'gt:bad_args'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'opens_at', 'closes_at', 'codes', 'objects', 'room_template', 'room_width', 'relocate_minutes',
                 'campaign_key', 'hot_tiles', 'warm_tiles') then
      raise exception 'gt:unknown_field';
    end if;
  end loop;
  perform public._gt_lock(p_id);
  select * into g from game_times where id = p_id;
  if not found then raise exception 'gt:not_found'; end if;
  phase := public._gt_phase(g);
  if phase in ('all_found', 'closed') then raise exception 'gt:ended'; end if;
  -- One order for every staff call that takes both: the room lock, then the crew's game lock (create does the same).
  if p_patch ? 'objects' then perform public._crew_room_lock(g.crew_id); end if;
  perform pg_advisory_xact_lock(hashtextextended('game-time-crew:' || g.crew_id::text, 0));

  v_title := g.title; v_open := g.opens_at; v_close := g.closes_at;
  v_reloc := g.relocate_minutes; v_hot := g.hot_tiles; v_warm := g.warm_tiles; v_key := g.campaign_key;

  if p_patch ? 'title' then
    if jsonb_typeof(p_patch->'title') is distinct from 'string' then raise exception 'gt:bad_title'; end if;
    v_title := btrim(p_patch->>'title');
    if char_length(v_title) not between 2 and 60 then raise exception 'gt:bad_title'; end if;
  end if;
  if p_patch ? 'opens_at' then
    v_open := public._gt_ts(p_patch, 'opens_at');
    if v_open is null then raise exception 'gt:bad_times'; end if;
    if abs(extract(epoch from v_open - g.opens_at)) < 1 then
      v_open := g.opens_at;
    elsif phase <> 'upcoming' then
      raise exception 'gt:already_open';
    end if;
  end if;
  if p_patch ? 'closes_at' then
    v_close := public._gt_ts(p_patch, 'closes_at');
    if v_close is null then raise exception 'gt:bad_times'; end if;
    if abs(extract(epoch from v_close - g.closes_at)) < 1 then v_close := g.closes_at; end if;
  end if;
  if v_close <= v_open then raise exception 'gt:bad_times'; end if;
  if v_close is distinct from g.closes_at and v_close <= t then raise exception 'gt:in_past'; end if;
  if v_close - v_open > interval '7 days' then raise exception 'gt:too_long'; end if;
  if (v_open is distinct from g.opens_at or v_close is distinct from g.closes_at)
     and public._gt_overlaps(g.crew_id, v_open, v_close, g.id) then
    raise exception 'gt:overlaps';
  end if;

  if p_patch ? 'relocate_minutes' then
    if coalesce(p_patch->>'relocate_minutes', '') !~ '^[0-9]{1,3}$' or (p_patch->>'relocate_minutes')::integer > 720 then raise exception 'gt:bad_relocate'; end if;
    v_reloc := (p_patch->>'relocate_minutes')::integer;
  end if;
  if p_patch ? 'hot_tiles' then
    if coalesce(p_patch->>'hot_tiles', '') !~ '^[0-9]{1,3}(\.[0-9])?$' or (p_patch->>'hot_tiles')::numeric <= 0 then raise exception 'gt:bad_tiles'; end if;
    v_hot := (p_patch->>'hot_tiles')::numeric;
  end if;
  if p_patch ? 'warm_tiles' then
    if coalesce(p_patch->>'warm_tiles', '') !~ '^[0-9]{1,3}(\.[0-9])?$' then raise exception 'gt:bad_tiles'; end if;
    v_warm := (p_patch->>'warm_tiles')::numeric;
  end if;
  if v_warm < v_hot or v_hot > 100 or v_warm > 200 then raise exception 'gt:bad_tiles'; end if;
  if p_patch ? 'campaign_key' then
    v_key := coalesce(nullif(btrim(p_patch->>'campaign_key'), ''), 'crew:' || g.crew_id::text);
    if char_length(v_key) > 80 or v_key ~ '[[:cntrl:]]' then raise exception 'gt:bad_campaign'; end if;
    if v_key is distinct from g.campaign_key and exists (select 1 from game_time_wins where game_id = g.id) then raise exception 'gt:campaign_locked'; end if;
  end if;

  v_room := jsonb_build_object('template', g.room_template, 'width', g.room_width);
  if p_patch ? 'objects' then
    v_room := public._gt_room_arg(g.crew_id, p_patch);
    v_objs := public._gt_objects(p_patch->'objects', v_room->>'template', (v_room->>'width')::integer);
    insert into game_time_spots (game_id, object_id, x, y, w, h)
    select g.id, o.id, o.x, o.y, o.w, o.h from jsonb_to_recordset(v_objs) as o(id text, x integer, y integer, w integer, h integer)
    on conflict (game_id, object_id) do update set x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h;
    delete from game_time_spots s
     where s.game_id = g.id and s.object_id not in (select o.id from jsonb_to_recordset(v_objs) as o(id text));
    -- boxes still hiding on an object that is no longer eligible move to a free one
    for b in
      select x.* from game_time_boxes x
       where x.game_id = g.id and x.claimed_by is null
         and not exists (select 1 from game_time_spots s where s.game_id = g.id and s.object_id = x.spot_id)
    loop
      select s.object_id into target from game_time_spots s
       where s.game_id = g.id
         and not exists (select 1 from game_time_boxes o where o.game_id = g.id and o.spot_id = s.object_id and o.claimed_by is null)
       order by random() limit 1;
      if target is null then raise exception 'gt:not_enough_spots'; end if;
      update game_time_boxes set spot_id = target, placed_at = t where id = b.id;
    end loop;
  elsif p_patch ? 'room_template' or p_patch ? 'room_width' then
    raise exception 'gt:bad_objects';
  end if;

  if p_patch ? 'codes' then
    v_codes := public._gt_codes(p_patch->'codes');
    if (select array_agg(c order by c) from unnest(v_codes) c)
       is distinct from (select array_agg(bx.code order by bx.code) from game_time_boxes bx where bx.game_id = g.id) then
      if exists (select 1 from game_time_boxes bx where bx.game_id = g.id and bx.claimed_by is not null) then raise exception 'gt:codes_locked'; end if;
      delete from game_time_boxes bx where bx.game_id = g.id;
      perform public._gt_place(g.id, v_codes);
    end if;
  end if;

  if (select count(*) from game_time_spots sp where sp.game_id = g.id)
     < (select count(*) from game_time_boxes bx where bx.game_id = g.id and bx.claimed_by is null) then
    raise exception 'gt:not_enough_spots';
  end if;
  update game_times
     set title = v_title, opens_at = v_open, closes_at = v_close, relocate_minutes = v_reloc, hot_tiles = v_hot,
         warm_tiles = v_warm, campaign_key = v_key, room_template = v_room->>'template',
         room_width = (v_room->>'width')::integer, updated_at = t
   where id = g.id;
  if v_open is distinct from g.opens_at then
    update game_time_boxes bx set placed_at = t where bx.game_id = g.id and bx.claimed_by is null;
  end if;
  return jsonb_build_object('ok', true, 'game', public._gt_admin_view(g.id));
exception when others then
  if sqlerrm like 'gt:%' then return jsonb_build_object('ok', false, 'reason', substr(sqlerrm, 4)); end if;
  raise;
end $$;

-- START NOW: open an upcoming game this second and send the push. A live game is left alone ("started": false).
-- Reasons: not_found ended time_up overlaps.
create or replace function public.admin_game_time_start_now(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g     public.game_times;
  phase text;
  t     timestamptz := clock_timestamp();
begin
  perform public._gt_lock(p_id);
  select * into g from game_times where id = p_id;
  if not found then raise exception 'gt:not_found'; end if;
  phase := public._gt_phase(g);
  if phase in ('all_found', 'closed') then raise exception 'gt:ended'; end if;
  if phase = 'time_up' then raise exception 'gt:time_up'; end if;
  if phase = 'live' then
    return jsonb_build_object('ok', true, 'started', false, 'game', public._gt_admin_view(g.id));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('game-time-crew:' || g.crew_id::text, 0));
  if public._gt_overlaps(g.crew_id, t, g.closes_at, g.id) then raise exception 'gt:overlaps'; end if;
  update game_times set opens_at = t, updated_at = t where id = g.id;
  update game_time_boxes set placed_at = t where game_id = g.id and claimed_by is null;
  perform public._gt_notify_open(g.id);
  return jsonb_build_object('ok', true, 'started', true, 'game', public._gt_admin_view(g.id));
exception when others then
  if sqlerrm like 'gt:%' then return jsonb_build_object('ok', false, 'reason', substr(sqlerrm, 4)); end if;
  raise;
end $$;

-- CLOSE NOW: the game ends this second; boxes nobody found stay unfound. Closing a finished game changes
-- nothing ("closed": false). Reason: not_found.
create or replace function public.admin_game_time_close(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g public.game_times;
  t timestamptz := clock_timestamp();
begin
  perform public._gt_lock(p_id);
  select * into g from game_times where id = p_id;
  if not found then raise exception 'gt:not_found'; end if;
  if public._gt_phase(g) in ('all_found', 'closed', 'time_up') then
    return jsonb_build_object('ok', true, 'closed', false, 'game', public._gt_admin_view(g.id));
  end if;
  update game_times set ended_at = t, ended_by = 'closed', updated_at = t where id = g.id;
  return jsonb_build_object('ok', true, 'closed', true, 'game', public._gt_admin_view(g.id));
exception when others then
  if sqlerrm like 'gt:%' then return jsonb_build_object('ok', false, 'reason', substr(sqlerrm, 4)); end if;
  raise;
end $$;

-- One game in full: counts, the eligible objects, and every box with its code and where it is hiding now.
create or replace function public.admin_game_time_status(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := public._gt_admin_view(p_id);
begin
  if v is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'game', v);
end $$;

-- Every game, newest first (at most 100), without the boxes and objects.
create or replace function public.admin_game_time_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'games', coalesce((
    select jsonb_agg((public._gt_admin_view(q.id) - 'boxes' - 'objects') order by q.opens_at desc)
      from (select id, opens_at from game_times order by opens_at desc limit 100) q), '[]'));
$$;

-- The winners, oldest first: the Hopper's handle, name and email, and the code they won. One game, or all.
create or replace function public.admin_game_time_winners(p_id uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'winners', coalesce((
    select jsonb_agg(jsonb_build_object(
             'game_id', g.id, 'title', g.title, 'crew_name', c.name, 'user_id', w.user_id,
             'handle', pr.handle, 'name', pr.display_name, 'email', u.email,
             'code', w.code, 'object', b.spot_id, 'won_at', w.created_at) order by w.created_at)
      from game_time_wins w
      join game_times g on g.id = w.game_id
      join crews c on c.id = g.crew_id
      left join profiles pr on pr.id = w.user_id
      left join auth.users u on u.id = w.user_id
      left join game_time_boxes b on b.id = w.box_id
     where p_id is null or w.game_id = p_id), '[]'));
$$;

-- Housekeeping, run every minute by pg_cron (below): the opening push for games that just opened, and
-- the moving of boxes that waited long enough. One game failing never stops the others. Service role only.
create or replace function public.game_time_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r      record;
  pushed integer := 0;
  moved  integer := 0;
  failed integer := 0;
  t      timestamptz := clock_timestamp();
begin
  for r in
    select id from game_times
     where push_sent_at is null and ended_at is null and opens_at <= t and opens_at > t - interval '10 minutes' and closes_at > t
  loop
    begin
      pushed := pushed + public._gt_notify_open(r.id);
    exception when others then
      failed := failed + 1;
      raise warning 'game time push % failed: %', r.id, sqlerrm;
    end;
  end loop;
  for r in
    select g.id from game_times g
     where g.ended_at is null and g.relocate_minutes > 0 and g.opens_at <= t and g.closes_at > t
       and exists (select 1 from game_time_boxes b
                    where b.game_id = g.id and b.claimed_by is null
                      and greatest(b.placed_at, g.opens_at) + make_interval(mins => g.relocate_minutes) <= t)
  loop
    begin
      perform public._gt_lock(r.id);
      moved := moved + public._gt_relocate(r.id);
    exception when others then
      failed := failed + 1;
      raise warning 'game time move % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('pushed', pushed, 'moved', moved, 'failed', failed);
end $$;

-- Every minute. Needs pg_cron; without it the push still goes out when a Hopper loads the room or the
-- ping, and boxes still move on the next search.
do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'hoppaz-game-time-tick';
  perform cron.schedule('hoppaz-game-time-tick', '* * * * *', 'select public.game_time_tick()');
exception when others then
  raise notice 'pg_cron not available: enable it in Supabase (Database, Extensions), then run this file again.';
end $cron$;

-- ------------------------------------------------------------ access ---
alter table public.game_times enable row level security;
alter table public.game_time_spots enable row level security;
alter table public.game_time_boxes enable row level security;
alter table public.game_time_wins enable row level security;
alter table public.game_time_players enable row level security;
alter table public.game_time_rate enable row level security;
alter table public.game_time_feed enable row level security;

revoke all on public.game_times, public.game_time_spots, public.game_time_boxes, public.game_time_wins,
  public.game_time_players, public.game_time_rate, public.game_time_feed from anon, authenticated;
revoke all on sequence public.game_time_feed_id_seq from anon, authenticated;
grant all on public.game_times, public.game_time_spots, public.game_time_boxes, public.game_time_wins,
  public.game_time_players, public.game_time_rate, public.game_time_feed to service_role;

-- The one table a Hopper can read: the feed of what was found, for the crew (Realtime obeys this policy).
drop policy if exists game_time_feed_member_read on public.game_time_feed;
create policy game_time_feed_member_read on public.game_time_feed for select to authenticated
  using (public.is_crew_member(crew_id));
grant select on public.game_time_feed to authenticated;

-- Functions: close them all, then open the few a Hopper needs.
do $acl$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like '\_gt\_%' or p.proname like 'game\_time\_%' or p.proname like 'admin\_game\_time\_%' or p.proname = 'my_game_time_wins')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $acl$;
revoke all on function public._crew_room_hunt_busy(uuid) from public, anon, authenticated;
grant execute on function public.game_time_state(uuid), public.game_time_list() to anon, authenticated;
grant execute on function public.game_time_search(uuid, text), public.my_game_time_wins() to authenticated;
grant execute on function
  public.admin_game_time_create(jsonb), public.admin_game_time_update(uuid, jsonb), public.admin_game_time_start_now(uuid),
  public.admin_game_time_close(uuid), public.admin_game_time_status(uuid), public.admin_game_time_list(),
  public.admin_game_time_winners(uuid), public.game_time_tick()
  to service_role;

-- Realtime carries the feed (RLS decides who gets each row): the room hears a find within a moment.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'game_time_feed') then
      alter publication supabase_realtime add table public.game_time_feed;
    end if;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
