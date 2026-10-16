-- ============================================================================
-- Hoppaz: crew rooms that hold a crowd (load hardening, 16 Oct 2026)
-- Run order: after crew_rooms.sql (and after crew_rails.sql, crew_reactions.sql,
-- game_time.sql, xp_rewards.sql if those are loaded). Run it again after any run
-- of crew_rooms.sql, which puts the old helpers back. Additive and safe to run twice.
--
-- Why: the 360Playlist room fell over at about 20 people (16 Oct). Every step took
-- the room's lock and held it while it built a snapshot of the whole room (about
-- 450 bytes a walker) and while the commit waited for the disk. One room could then
-- take only a few dozen steps a second; the waiters filled the API's connections,
-- and every other call in the app queued behind them. Measured with
-- scripts/load/crew-room-load.mjs (README there).
--
-- What changes (the rules of the room do not):
--   grids        each layout carries its walkable tiles and areas as a ready-made
--                grid (crew_room_layouts.walk, area_at), kept by a trigger. A step
--                and an area look-up read one character instead of scanning every
--                piece of furniture.
--   moves        crew_room_move: the same checks as crew_room_step (one tile at a
--                time, walkable, at most 12 tiles a second, in sequence, this
--                session), up to 16 tiles a batch, and a small answer (where I stand).
--                The room lock is taken only when the walker crosses an area's edge
--                (the area's conversation audience changes). Position writes do not
--                wait for the disk (synchronous_commit off): a crash can lose the last
--                fraction of a second of walking, never a win, a ticket or a message.
--   reading      crew_room_tick(p_crew, p_since, p_version): only what changed since
--                the phone's last read (walkers who moved, names and looks only for
--                new arrivals, the walker list only when someone left), the room only
--                when the owner changed it. p_since is the "at" of the last answer, a
--                transaction watermark (pg_snapshot_xmin), so a move that committed
--                late is never missed. Blocked people are left out as before.
--   heartbeat    a beat writes at most once every 3 s per walker.
--   sweeps       stale walkers are swept by whoever reads first and gets the lock
--                without waiting; leaving a crew removes the walker at once (trigger).
--   old phones   crew_room_step, crew_room_state and crew_room_enter keep their exact
--                answers for app versions still open during a deploy, made cheaper:
--                no lock unless an area edge is crossed, the grids, one block list per
--                read instead of a function call per walker.
-- Anti-cheat is unchanged: the server checks every tile, the speed and the sequence;
-- searches, wins, tickets and area audiences read the server's position only.
-- ============================================================================
begin;

do $guard$
begin
  if to_regclass('public.crew_room_presence') is null or to_regprocedure('public._crew_room_reconcile(uuid)') is null then
    raise exception 'crew_rooms_scale.sql needs crew_rooms.sql loaded first';
  end if;
end $guard$;

-- ------------------------------------------------------------------- grids ---
alter table public.crew_room_layouts add column if not exists gw integer;
alter table public.crew_room_layouts add column if not exists gh integer;
-- One character per tile, row by row: '1' walkable, '0' not.
alter table public.crew_room_layouts add column if not exists walk text;
-- The conversation area at each tile (same order), null off the areas and on anything not walkable.
alter table public.crew_room_layouts add column if not exists area_at text[];

create or replace function public._crew_room_layout_grids() returns trigger
language plpgsql set search_path = public as $$
declare
  w int := (new.data->'grid'->>'width')::int;
  h int := (new.data->'grid'->>'height')::int;
begin
  new.gw := w;
  new.gh := h;
  with t as (
    select x, y,
           x > 0 and y > 0 and x < w - 1 and y < h - 1
           and not exists (select 1 from jsonb_array_elements(new.data->'blocks') b
                            where x >= (b->>'x')::int and x < (b->>'x')::int + (b->>'w')::int
                              and y >= (b->>'y')::int and y < (b->>'y')::int + (b->>'h')::int) as ok
      from generate_series(0, h - 1) y cross join generate_series(0, w - 1) x)
  select string_agg(case when ok then '1' else '0' end, '' order by y, x),
         array_agg(case when ok then
                     (select a->>'id' from jsonb_array_elements(new.data->'privateAreas') with ordinality as pa(a, n)
                       where x >= (a->>'x')::int and x < (a->>'x')::int + (a->>'w')::int
                         and y >= (a->>'y')::int and y < (a->>'y')::int + (a->>'h')::int
                       order by n limit 1)
                   end order by y, x)
    into new.walk, new.area_at
    from t;
  return new;
end $$;
drop trigger if exists crew_room_layout_grids on public.crew_room_layouts;
create trigger crew_room_layout_grids before insert or update of data on public.crew_room_layouts
  for each row execute function public._crew_room_layout_grids();
update public.crew_room_layouts set data = data where walk is null or area_at is null or gw is null;

-- Same answers as the crew_rooms.sql versions, from the grid.
create or replace function public._crew_room_walkable(p_template text, p_width int, p_x int, p_y int) returns boolean
language sql stable security definer set search_path = public as $$
  select p_x >= 0 and p_y >= 0 and p_x < l.gw and p_y < l.gh and substr(l.walk, p_y * l.gw + p_x + 1, 1) = '1'
    from crew_room_layouts l where l.template = p_template and l.width = p_width;
$$;
create or replace function public._crew_room_area(p_template text, p_width int, p_x int, p_y int) returns text
language sql stable security definer set search_path = public as $$
  select case when p_x >= 0 and p_y >= 0 and p_x < l.gw and p_y < l.gh then l.area_at[p_y * l.gw + p_x + 1] end
    from crew_room_layouts l where l.template = p_template and l.width = p_width;
$$;

-- ---------------------------------------------------------------- presence ---
-- What others need to know about a walker changed in this transaction (a move, an area, a new session), and when they
-- last walked in (names and looks are sent once per arrival). xid8: a reader's watermark is a transaction id, so a
-- write that commits late is still "newer" than the last read (see crew_room_tick).
alter table public.crew_room_presence add column if not exists rev_xid xid8;
alter table public.crew_room_presence add column if not exists entered_xid xid8;
create or replace function public._crew_room_presence_rev() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.session_id is distinct from old.session_id then
    new.entered_xid := pg_current_xact_id();
    new.rev_xid := new.entered_xid;
  elsif new.x is distinct from old.x or new.y is distinct from old.y or new.circle_id is distinct from old.circle_id then
    new.rev_xid := pg_current_xact_id();
  end if;
  return new;
end $$;
drop trigger if exists crew_room_presence_rev on public.crew_room_presence;
create trigger crew_room_presence_rev before insert or update on public.crew_room_presence
  for each row execute function public._crew_room_presence_rev();
update public.crew_room_presence set rev_xid = pg_current_xact_id(), entered_xid = pg_current_xact_id() where rev_xid is null;

-- A walker leaving (or swept, or the crew gone) changes the walker list: crew_room_tick sends the list again.
-- No foreign key: the row may outlive a deleted crew for a moment, and a cascade must never fail on it.
create table if not exists public.crew_room_live (
  crew_id    uuid primary key,
  roster_xid xid8 not null
);
alter table public.crew_room_live enable row level security;
revoke all on public.crew_room_live from anon, authenticated;
create or replace function public._crew_room_presence_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into crew_room_live (crew_id, roster_xid)
  select distinct g.crew_id, pg_current_xact_id() from gone g
  on conflict (crew_id) do update set roster_xid = excluded.roster_xid;
  return null;
end $$;
drop trigger if exists crew_room_presence_gone on public.crew_room_presence;
create trigger crew_room_presence_gone after delete on public.crew_room_presence
  referencing old table as gone for each statement execute function public._crew_room_presence_gone();

-- Leaving the crew takes the walker out at once (the sweep used to find them on every beat).
create or replace function public._crew_room_member_left() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from crew_room_presence p using gone g where p.crew_id = g.crew_id and p.user_id = g.user_id;
  return null;
end $$;
drop trigger if exists crew_members_left_room on public.crew_members;
create trigger crew_members_left_room after delete on public.crew_members
  referencing old table as gone for each statement execute function public._crew_room_member_left();
delete from public.crew_room_presence p
 where not exists (select 1 from public.crew_members m where m.crew_id = p.crew_id and m.user_id = p.user_id);

-- Keep presence writes HOT (no index touched): room for the new version in the same page, and no index on last_seen,
-- which every beat changes. A room's walkers are found by the primary key (crew_id first); a room has at most a few
-- hundred, so the time filters are cheap without an index.
alter table public.crew_room_presence set (fillfactor = 50);
drop index if exists public.crew_room_presence_live;
-- Blocks are read in both directions for every room read.
create index if not exists blocks_blocked_idx on public.blocks (blocked);

-- Someone went stale: an index-free look at one room's rows (leaving the crew is the trigger above now).
create or replace function public._crew_room_stale(p_crew uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crew_room_presence p
                  where p.crew_id = p_crew and p.last_seen < clock_timestamp() - _crew_room_ttl());
$$;

-- The people this Hopper must not see in a room, and who must not see them: one look at blocks per read.
create or replace function public._crew_room_hidden(p_me uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select blocked from blocks where blocker = p_me
  union
  select blocker from blocks where blocked = p_me;
$$;

-- Same answer as before (crew_rooms.sql), with one block look-up instead of one per walker.
create or replace function public._crew_room_snapshot(p_crew uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'observed_at', clock_timestamp(),
    'crew', jsonb_build_object(
      'id', c.id, 'name', c.name, 'verified', c.verified, 'logo_url', c.logo_url, 'owner_id', c.created_by,
      'is_owner', exists (select 1 from crew_members where crew_id = c.id and user_id = auth.uid() and role = 'owner')),
    'room', jsonb_build_object('template', r.template, 'width', r.width, 'content', r.content, 'version', r.version,
                               'capacity', r.capacity, 'featured_event_id', r.featured_event_id, 'featured_ribbon', r.featured_ribbon),
    'peers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.user_id, 'name', coalesce(nullif(btrim(pr.display_name), ''), pr.handle, 'A crew member'), 'look', pr.avatar,
               'x', p.x, 'y', p.y, 'circle_id', p.circle_id, 'last_seen', p.last_seen) order by p.user_id)
        from crew_room_presence p
        join profiles pr on pr.id = p.user_id
       where p.crew_id = c.id and p.last_seen > clock_timestamp() - _crew_room_ttl()
         and p.user_id not in (select h from public._crew_room_hidden(auth.uid()) h)), '[]'),
    'self', (select jsonb_build_object('x', p.x, 'y', p.y, 'seq', p.seq, 'circle_id', p.circle_id, 'session_id', p.session_id)
               from crew_room_presence p
              where p.crew_id = c.id and p.user_id = auth.uid() and p.last_seen > clock_timestamp() - _crew_room_ttl()),
    'circles', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'x', x, 'y', y, 'area_id', section))
                           from crew_room_circles where crew_id = c.id), '[]'))
    from crews c join crew_rooms r on r.crew_id = c.id
   where c.id = p_crew;
$$;

-- ------------------------------------------------------------------- moves ---
-- The walk, checked tile by tile against the grid. Returns where it ends and that tile's area. Raises invalid_movement.
create or replace function public._crew_room_walk(p_crew uuid, p_x int, p_y int, p_steps jsonb, out x int, out y int, out area text)
language plpgsql stable security definer set search_path = public as $$
declare
  l    crew_room_layouts;
  tile jsonb;
  nx   int;
  ny   int;
begin
  select lay.* into l from crew_rooms r join crew_room_layouts lay on lay.template = r.template and lay.width = r.width
   where r.crew_id = p_crew;
  if not found then raise exception 'invalid_movement'; end if;
  x := p_x;
  y := p_y;
  for tile in select * from jsonb_array_elements(p_steps) loop
    if jsonb_typeof(tile) <> 'object'
       or coalesce(tile->>'x', '') !~ '^[0-9]{1,2}$' or coalesce(tile->>'y', '') !~ '^[0-9]{1,2}$' then
      raise exception 'invalid_movement';
    end if;
    nx := (tile->>'x')::int;
    ny := (tile->>'y')::int;
    if abs(nx - x) + abs(ny - y) <> 1 or nx >= l.gw or ny >= l.gh or substr(l.walk, ny * l.gw + nx + 1, 1) <> '1' then
      raise exception 'invalid_movement';
    end if;
    x := nx;
    y := ny;
  end loop;
  area := l.area_at[y * l.gw + x + 1];
end $$;

-- True when this walker's area session does not match where they stand (a session that ended under them, a width change).
create or replace function public._crew_room_needs_sweep(p crew_room_presence) returns boolean
language sql stable security definer set search_path = public as $$
  select (p.area is null) <> (p.circle_id is null)
      or (p.area is not null and p.circle_id is distinct from
            (select c.id from crew_room_circles c where c.crew_id = p.crew_id and c.section = p.area));
$$;

-- Moves and beats for the app from this release on.
--   p_steps  up to 16 adjacent tiles; p_seq one past the last batch the server took. No steps: a heartbeat.
-- Answer: {seq, x, y, circle_id}. Refusals as crew_room_step: room_session_expired (enter again), room_session_replaced
-- (another tab or phone), invalid_movement / invalid_sequence / moving_too_fast (read the room, stand where it says).
create or replace function public.crew_room_move(p_crew uuid, p_session uuid, p_seq int, p_steps jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  p      crew_room_presence;
  n      int;
  w      record;
  credit numeric;
  sweep  boolean;
  done   int;
  circle uuid;
  t      timestamptz := clock_timestamp();
begin
  if me is null then raise exception 'need_account'; end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 16 then raise exception 'invalid_movement'; end if;
  n := jsonb_array_length(p_steps);
  -- A position is worth less than the disk's time: a crash may lose the last moment of walking, nothing else.
  perform set_config('synchronous_commit', 'off', true);
  select * into p from crew_room_presence where crew_id = p_crew and user_id = me;
  if not found or p.last_seen < t - _crew_room_ttl() then raise exception 'room_session_expired'; end if;
  if p.session_id <> p_session then raise exception 'room_session_replaced'; end if;
  if not exists (select 1 from crew_members where crew_id = p_crew and user_id = me) then raise exception 'not_in_crew'; end if;

  if n = 0 then
    -- A beat: one write at most every 3 s, nothing else.
    if p.last_seen < t - interval '3 seconds' then
      update crew_room_presence set last_seen = t where crew_id = p_crew and user_id = me and session_id = p_session;
    end if;
    if _crew_room_needs_sweep(p) then
      perform _crew_room_lock(p_crew);
      perform _crew_room_reconcile(p_crew);
      select * into p from crew_room_presence where crew_id = p_crew and user_id = me;
    end if;
    return jsonb_build_object('seq', p.seq, 'x', p.x, 'y', p.y, 'circle_id', p.circle_id);
  end if;

  -- A batch the server already has (a retry) changes nothing.
  if p_seq <= p.seq then return jsonb_build_object('seq', p.seq, 'x', p.x, 'y', p.y, 'circle_id', p.circle_id); end if;
  if p_seq <> p.seq + 1 then raise exception 'invalid_sequence'; end if;
  credit := least(16, p.move_credit + greatest(0, extract(epoch from t - p.credit_at)) * 12);
  if n > credit then raise exception 'moving_too_fast'; end if;
  select * into w from _crew_room_walk(p_crew, p.x, p.y, p_steps);

  -- Crossing an area's edge changes who hears what: that one takes the room lock (before any row lock) and the sweep.
  sweep := w.area is distinct from p.area or _crew_room_needs_sweep(p);
  if sweep then perform _crew_room_lock(p_crew); end if;
  -- Only if nothing moved this walker since the read above (another call, or the owner sending everyone to the door).
  update crew_room_presence
     set x = w.x, y = w.y, seq = p_seq, last_seen = t, last_moved_at = t, move_credit = credit - n, credit_at = t
   where crew_id = p_crew and user_id = me and session_id = p_session and seq = p.seq and x = p.x and y = p.y;
  get diagnostics done = row_count;
  if done = 0 then raise exception 'invalid_sequence'; end if;
  circle := p.circle_id;
  if sweep then
    perform _crew_room_reconcile(p_crew);
    select circle_id into circle from crew_room_presence where crew_id = p_crew and user_id = me;
  end if;
  return jsonb_build_object('seq', p_seq, 'x', w.x, 'y', w.y, 'circle_id', circle);
end $$;

-- The step of earlier app versions: same checks, same full answer, cheaper inside (see the header).
create or replace function public.crew_room_step(p_crew uuid, p_session uuid, p_seq int, p_steps jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  p      crew_room_presence;
  n      int;
  w      record;
  credit numeric;
  sweep  boolean;
  done   int;
  t      timestamptz := clock_timestamp();
begin
  perform _crew_room_require(p_crew);
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 8 then raise exception 'invalid_movement'; end if;
  n := jsonb_array_length(p_steps);
  perform set_config('synchronous_commit', 'off', true);
  select * into p from crew_room_presence where crew_id = p_crew and user_id = me;
  if not found or p.last_seen < t - _crew_room_ttl() then raise exception 'room_session_expired'; end if;
  if p.session_id <> p_session then raise exception 'room_session_replaced'; end if;
  if n = 0 then
    if p.last_seen < t - interval '3 seconds' then
      update crew_room_presence set last_seen = t where crew_id = p_crew and user_id = me and session_id = p_session;
    end if;
    if _crew_room_needs_sweep(p) or _crew_room_stale(p_crew) then
      if pg_try_advisory_xact_lock(hashtextextended('crew-room:' || p_crew::text, 0)) then perform _crew_room_reconcile(p_crew); end if;
    end if;
    return _crew_room_snapshot(p_crew);
  end if;
  if p_seq <= p.seq then return _crew_room_snapshot(p_crew); end if;
  if p_seq <> p.seq + 1 then raise exception 'invalid_sequence'; end if;
  credit := least(8, p.move_credit + greatest(0, extract(epoch from t - p.credit_at)) * 12);
  if n > credit then raise exception 'moving_too_fast'; end if;
  select * into w from _crew_room_walk(p_crew, p.x, p.y, p_steps);
  sweep := w.area is distinct from p.area or _crew_room_needs_sweep(p);
  if sweep then perform _crew_room_lock(p_crew); end if;
  update crew_room_presence
     set x = w.x, y = w.y, seq = p_seq, last_seen = t, last_moved_at = t, move_credit = credit - n, credit_at = t
   where crew_id = p_crew and user_id = me and session_id = p_session and seq = p.seq and x = p.x and y = p.y;
  get diagnostics done = row_count;
  if done = 0 then raise exception 'invalid_sequence'; end if;
  if sweep then perform _crew_room_reconcile(p_crew); end if;
  return _crew_room_snapshot(p_crew);
end $$;

-- ----------------------------------------------------------------- reading ---
-- The room for the app from this release on: what changed since the phone's last read.
--   p_since    the "at" of the last answer (null: everything, as on entering)
--   p_version  the room version the phone has (the owner's content is sent only when it changed)
-- Answer:
--   at        pass it back next time
--   full      everything was sent (p_since was null)
--   version   the room version; room: {template, width, content, version, capacity, featured_event_id, featured_ribbon}
--             when it differs from p_version (or full); crew: {id, name, verified, logo_url, owner_id, is_owner} when full
--   walkers   how many walk in the room now (blocked people left out)
--   ids       every walker's id, when someone left since the last read (or full): drop anyone not in it
--   moved     [id, x, y, circle_id] for each walker who moved, changed area or walked in since the last read, with
--             [.., name, look] added for those who walked in since then (everyone when full)
--   away      ids of walkers with no beat for 25 s (a locked phone), shown faded
--   self      this Hopper's walker {x, y, seq, circle_id, session_id}, or null while watching
--   circles   the area sessions, [{id, x, y, area_id}]
-- A stale walker is swept here by the first reader who gets the room lock without waiting.
create or replace function public.crew_room_tick(p_crew uuid, p_since bigint default null, p_version int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  t      timestamptz := clock_timestamp();
  ttl    interval := _crew_room_ttl();
  every  boolean := p_since is null;
  since  xid8 := coalesce(p_since, 0)::text::xid8;
  mark   bigint;
  r      crew_rooms;
  left_  boolean;
  answer jsonb;
begin
  perform _crew_room_require(p_crew);
  if _crew_room_stale(p_crew) and pg_try_advisory_xact_lock(hashtextextended('crew-room:' || p_crew::text, 0)) then
    perform set_config('synchronous_commit', 'off', true);
    perform _crew_room_reconcile(p_crew);
  end if;
  -- Everything written by a transaction older than this has committed; anything newer is sent again next time.
  mark := pg_snapshot_xmin(pg_current_snapshot())::text::bigint;
  select * into r from crew_rooms where crew_id = p_crew;
  left_ := every or exists (select 1 from crew_room_live v where v.crew_id = p_crew and v.roster_xid >= since);
  with live as (
    select p.user_id, p.x, p.y, p.circle_id, p.last_seen, p.rev_xid, p.entered_xid
      from crew_room_presence p
     where p.crew_id = p_crew and p.last_seen > t - ttl
       and p.user_id not in (select h from _crew_room_hidden(me) h))
  select jsonb_build_object(
    'at', mark,
    'full', every,
    'version', r.version,
    'room', case when every or r.version is distinct from p_version then
              jsonb_build_object('template', r.template, 'width', r.width, 'content', r.content, 'version', r.version,
                                 'capacity', r.capacity, 'featured_event_id', r.featured_event_id, 'featured_ribbon', r.featured_ribbon) end,
    'crew', case when every then
              (select jsonb_build_object('id', c.id, 'name', c.name, 'verified', c.verified, 'logo_url', c.logo_url, 'owner_id', c.created_by,
                        'is_owner', exists (select 1 from crew_members where crew_id = c.id and user_id = me and role = 'owner'))
                 from crews c where c.id = p_crew) end,
    'walkers', (select count(*) from live),
    'ids', case when left_ then (select coalesce(jsonb_agg(l.user_id), '[]') from live l) end,
    'moved', coalesce((
       select jsonb_agg(jsonb_build_array(l.user_id, l.x, l.y, l.circle_id)
                        || case when every or l.entered_xid >= since then
                             (select jsonb_build_array(coalesce(nullif(btrim(pr.display_name), ''), pr.handle, 'A crew member'), pr.avatar)
                                from profiles pr where pr.id = l.user_id)
                           else '[]'::jsonb end)
         from live l where every or l.rev_xid >= since), '[]'),
    'away', coalesce((select jsonb_agg(l.user_id) from live l where l.last_seen < t - interval '25 seconds'), '[]'),
    'self', (select jsonb_build_object('x', p.x, 'y', p.y, 'seq', p.seq, 'circle_id', p.circle_id, 'session_id', p.session_id)
               from crew_room_presence p where p.crew_id = p_crew and p.user_id = me and p.last_seen > t - ttl),
    'circles', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'x', c.x, 'y', c.y, 'area_id', c.section))
                           from crew_room_circles c where c.crew_id = p_crew), '[]'))
    into answer;
  return answer;
end $$;

-- ------------------------------------------------------------------ grants ---
revoke all on function public._crew_room_layout_grids(), public._crew_room_presence_rev(), public._crew_room_presence_gone(),
  public._crew_room_member_left(), public._crew_room_hidden(uuid), public._crew_room_walk(uuid, int, int, jsonb),
  public._crew_room_needs_sweep(crew_room_presence),
  public._crew_room_walkable(text, int, int, int), public._crew_room_area(text, int, int, int),
  public._crew_room_stale(uuid), public._crew_room_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.crew_room_move(uuid, uuid, int, jsonb), public.crew_room_tick(uuid, bigint, int) from public, anon;
grant execute on function public.crew_room_move(uuid, uuid, int, jsonb), public.crew_room_tick(uuid, bigint, int) to authenticated;

notify pgrst, 'reload schema';
commit;
