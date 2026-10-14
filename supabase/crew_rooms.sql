-- ============================================================================
-- Hoppaz: crew rooms (the 360 Playlist room, and the template for every crew,
-- brand, hotspot and event room after it)
-- Run order: schema.sql, chat_accounts.sql, then this file. Additive and safe to
-- run again: it replaces no chat, drop or hotspot function, so hotspots.sql does
-- not need to run after it. Behaviour: docs/CREW-ROOMS.md.
--
-- What it adds:
--   crews.verified    a brand crew Hoppaz has checked (the badge on its card and
--                     in its room). Off by default. Only staff set it, with the
--                     service role or SQL: Hoppers can update a crew's name and
--                     visibility, nothing else.
--   tables            crew_room_layouts (the walkable grid of each width, made from
--                     src/lib/campaign/layout.ts by scripts/crew-room/export-layouts.mjs),
--                     crew_rooms (one per crew: width, the owner's content, capacity),
--                     crew_room_presence (who walks where), crew_room_circles (the
--                     live session of each conversation area), crew_room_messages and
--                     crew_room_message_audience (who received an area message).
--                     RLS is on; a crew member can read the room, the walkers and the
--                     messages meant for them, and writes only through the calls below.
--                     crew_join_attempts (the invite rate limit, no access).
--   Hopper calls      crew_room_enter, crew_room_step (moves and heartbeats),
--                     crew_room_state, crew_room_leave, crew_room_send,
--                     crew_room_settings (the crew owner); the crew hub's
--                     crew_card (public), crew_join_code and crew_invite_reset (owner).
--
-- Rules:
--   presence   a walker stays in the room for 45 s after their last heartbeat
--              (_crew_room_ttl), so a phone screen lock or a quick trip to another
--              app keeps the avatar. The app beats every 10 s and leaves on its own
--              when the page is closed. One session per Hopper per room: a second
--              tab takes over, and the first is told (room_session_replaced) rather
--              than failing quietly.
--   capacity   crew_rooms.capacity walkers (60 by default, staff only). Past it a
--              member enters to watch: they see the room live and use General chat,
--              with no avatar and no area chat, until a spot opens.
--   areas      fixed authored areas own their conversation session. Walking inside
--              an area keeps the same session; crossing its boundary changes the
--              audience. Only people inside when a message is sent receive it. The
--              names circle_id and scope 'nearby' are kept from the first version;
--              they mean "area session" and "area message".
--   movement   adjacent walkable tiles only, at most 8 steps a batch and about 12 a
--              second, in sequence. The server owns every position and area.
--   chat       400 characters, 6 messages in 10 s, a retried send is not repeated
--              (request_id). Blocked people are hidden and left out of audiences.
--   invites    a crew's invite_code is its link (/crew/join/<code>). Joining by code
--              needs an account and allows 10 tries in 10 minutes; the owner can
--              make a new code, which ends the old link.
--
-- Costs, for a crowd: a heartbeat with nothing to sweep is one row update and no
-- room lock. The room lock (an advisory lock per crew) is taken by moves, sends to
-- an area, entering, leaving and settings, always before any row lock. A sweep runs
-- only when someone has gone stale or left the crew, or an area's occupancy changed,
-- and it writes only the rows whose area session changed.
-- ============================================================================
begin;

create table if not exists public.crew_room_layouts (
  width integer primary key check (width in (30, 36)),
  data  jsonb not null
);
create table if not exists public.crew_rooms (
  crew_id    uuid primary key references public.crews(id) on delete cascade,
  width      integer not null default 30 references public.crew_room_layouts(width),
  content    jsonb not null default '{}',
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists public.crew_room_circles (
  id         uuid primary key default gen_random_uuid(),
  crew_id    uuid not null references public.crews(id) on delete cascade,
  x          integer not null,
  y          integer not null,
  section    text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.crew_room_presence (
  crew_id       uuid not null references public.crews(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  session_id    uuid not null,
  x             integer not null,
  y             integer not null,
  seq           integer not null default 0,
  circle_id     uuid references public.crew_room_circles(id) on delete set null,
  last_seen     timestamptz not null default now(),
  last_moved_at timestamptz not null default now(),
  move_credit   numeric not null default 3,
  credit_at     timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create table if not exists public.crew_room_messages (
  id          uuid primary key default gen_random_uuid(),
  crew_id     uuid not null references public.crews(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  request_id  uuid not null,
  scope       text not null check (scope in ('general', 'nearby')),
  circle_id   uuid,
  body        text not null check (char_length(body) between 1 and 400),
  author_name text not null,
  author_look jsonb,
  created_at  timestamptz not null default now(),
  unique (crew_id, author_id, request_id)
);
create table if not exists public.crew_room_message_audience (
  message_id uuid not null references public.crew_room_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  primary key (message_id, user_id)
);

-- Added after the first version. A rerun leaves existing values alone.
alter table public.crews add column if not exists verified boolean not null default false;
alter table public.crew_rooms add column if not exists capacity integer not null default 60 check (capacity between 1 and 500);
-- The area a walker stands in, kept by a trigger from x and y (_crew_room_presence_area).
alter table public.crew_room_presence add column if not exists area text;

-- One live session per area: the sweep starts one with "on conflict do nothing".
create unique index if not exists crew_room_circles_one_per_area on public.crew_room_circles(crew_id, section);
create index if not exists crew_room_presence_live on public.crew_room_presence(crew_id, last_seen);
create index if not exists crew_room_audience_user on public.crew_room_message_audience(user_id, message_id);
-- History is read one conversation at a time: General, or one area session.
create index if not exists crew_room_messages_general on public.crew_room_messages(crew_id, created_at desc, id desc) where scope = 'general';
create index if not exists crew_room_messages_area on public.crew_room_messages(circle_id, created_at desc, id desc) where scope = 'nearby';
create index if not exists crew_room_messages_author on public.crew_room_messages(author_id, created_at desc);
drop index if exists public.crew_room_messages_recent;

-- Hoppers can rename a crew and open or close it; verified is staff only. RLS picks
-- the row (crews_update_owner), grants pick the columns.
revoke update on public.crews from anon, authenticated;
grant update (name, visibility) on public.crews to authenticated;

-- Layout values are generated from src/lib/campaign/layout.ts by export-layouts.mjs.
-- LAYOUT_SEED
insert into public.crew_room_layouts(width,data) values
(30,'{"grid":{"width":30,"height":20,"tile":32},"spawn":{"x":15,"y":17},"zones":[{"id":"studio","number":"01","name":"Listening Studio","subtitle":"Hear what comes next","x":1,"y":1,"w":8,"h":7,"material":"acoustic","stop":{"x":4,"y":5},"plaque":{"x":4,"y":7}},{"id":"stage","number":"02","name":"The 360 Stage","subtitle":"A home for the next sound","x":10,"y":1,"w":10,"h":6,"material":"stage","stop":{"x":15,"y":6},"plaque":{"x":15,"y":5}},{"id":"awards","number":"03","name":"Awards Gallery","subtitle":"The stories behind the milestones","x":21,"y":1,"w":8,"h":7,"material":"marble","stop":{"x":24,"y":5},"plaque":{"x":24,"y":7}},{"id":"courtyard","number":"04","name":"The Courtyard","subtitle":"Take a breath. Stay a while.","x":10,"y":8,"w":10,"h":6,"material":"grass","stop":{"x":15,"y":12},"plaque":{"x":15,"y":13}},{"id":"records","number":"05","name":"Record Lounge","subtitle":"Find your next favourite","x":1,"y":10,"w":8,"h":9,"material":"wood","stop":{"x":4,"y":13},"plaque":{"x":4,"y":10}},{"id":"campaign","number":"06","name":"Artist Corner","subtitle":"A closer look at the music","x":21,"y":10,"w":8,"h":9,"material":"terrazzo","stop":{"x":24,"y":14},"plaque":{"x":24,"y":10}}],"privateAreas":[{"id":"booth-1","name":"Listening Booth 1","x":2,"y":4,"w":3,"h":3,"stop":{"x":3,"y":5}},{"id":"booth-2","name":"Listening Booth 2","x":5,"y":4,"w":3,"h":3,"stop":{"x":6,"y":4}},{"id":"courtyard-corner","name":"Courtyard Corner","x":10,"y":9,"w":4,"h":4,"stop":{"x":13,"y":11}},{"id":"lounge-table","name":"Lounge Table","x":3,"y":13,"w":4,"h":5,"stop":{"x":4,"y":16}}],"blocks":[{"x":1,"y":1,"w":8,"h":1},{"x":1,"y":1,"w":1,"h":7},{"x":8,"y":1,"w":1,"h":7},{"x":1,"y":7,"w":3,"h":1},{"x":6,"y":7,"w":3,"h":1},{"x":10,"y":1,"w":10,"h":1},{"x":10,"y":1,"w":1,"h":5},{"x":19,"y":1,"w":1,"h":5},{"x":21,"y":1,"w":8,"h":1},{"x":21,"y":1,"w":1,"h":7},{"x":28,"y":1,"w":1,"h":7},{"x":21,"y":7,"w":3,"h":1},{"x":26,"y":7,"w":3,"h":1},{"x":1,"y":10,"w":3,"h":1},{"x":6,"y":10,"w":3,"h":1},{"x":1,"y":10,"w":1,"h":9},{"x":8,"y":10,"w":1,"h":9},{"x":1,"y":18,"w":8,"h":1},{"x":21,"y":10,"w":3,"h":1},{"x":26,"y":10,"w":3,"h":1},{"x":21,"y":10,"w":1,"h":9},{"x":28,"y":10,"w":1,"h":9},{"x":21,"y":18,"w":8,"h":1},{"id":"mixing-desk","kind":"console","x":2,"y":2,"w":5,"h":1,"solid":true},{"id":"studio-speaker-l","kind":"speaker","x":2,"y":3,"w":1,"h":1,"solid":true},{"id":"studio-speaker-r","kind":"speaker","x":6,"y":3,"w":1,"h":1,"solid":true},{"id":"listening-chair-l","kind":"headphones","x":2,"y":5,"w":1,"h":1,"solid":true},{"id":"listening-chair-r","kind":"headphones","x":6,"y":5,"w":1,"h":1,"solid":true},{"id":"studio-plant","kind":"plant","x":7,"y":6,"w":1,"h":1,"solid":true},{"id":"stage-console","kind":"console","x":13,"y":3,"w":4,"h":1,"solid":true,"variant":1},{"id":"stage-speaker-l","kind":"speaker","x":11,"y":3,"w":1,"h":2,"solid":true},{"id":"stage-speaker-r","kind":"speaker","x":18,"y":3,"w":1,"h":2,"solid":true},{"id":"gallery-display-1","kind":"plinth","x":22,"y":3,"w":2,"h":1,"solid":true,"variant":0},{"id":"gallery-display-2","kind":"plinth","x":25,"y":3,"w":2,"h":1,"solid":true,"variant":1},{"id":"gallery-display-3","kind":"plinth","x":26,"y":5,"w":1,"h":1,"solid":true,"variant":2},{"id":"gallery-plant","kind":"plant","x":22,"y":6,"w":1,"h":1,"solid":true},{"id":"courtyard-tree-l","kind":"tree","x":10,"y":8,"w":1,"h":1,"solid":true},{"id":"courtyard-tree-r","kind":"tree","x":19,"y":8,"w":1,"h":1,"solid":true},{"id":"courtyard-fountain","kind":"fountain","x":14,"y":9,"w":2,"h":2,"solid":true},{"id":"courtyard-bench-l","kind":"bench","x":11,"y":10,"w":2,"h":1,"solid":true},{"id":"courtyard-bench-r","kind":"bench","x":17,"y":10,"w":2,"h":1,"solid":true},{"id":"courtyard-plant-l","kind":"plant","x":11,"y":12,"w":1,"h":1,"solid":true},{"id":"courtyard-plant-r","kind":"plant","x":18,"y":12,"w":1,"h":1,"solid":true},{"id":"record-wall","kind":"records","x":2,"y":11,"w":2,"h":1,"solid":true},{"id":"record-wall-r","kind":"records","x":6,"y":11,"w":1,"h":1,"solid":true},{"id":"record-sofa-l","kind":"sofa","x":2,"y":14,"w":2,"h":1,"solid":true,"variant":1},{"id":"record-sofa-r","kind":"sofa","x":6,"y":15,"w":1,"h":2,"solid":true},{"id":"record-table","kind":"table","x":4,"y":15,"w":1,"h":1,"solid":true},{"id":"record-sofa-bottom","kind":"sofa","x":3,"y":17,"w":2,"h":1,"solid":true,"variant":1},{"id":"record-lamp","kind":"lamp","x":2,"y":16,"w":1,"h":1,"solid":true},{"id":"record-plant","kind":"plant","x":7,"y":17,"w":1,"h":1,"solid":true},{"id":"artist-poster-1","kind":"poster","x":22,"y":11,"w":2,"h":2,"solid":true,"variant":0},{"id":"artist-poster-2","kind":"poster","x":25,"y":11,"w":2,"h":2,"solid":true,"variant":1},{"id":"artist-poster-3","kind":"poster","x":26,"y":14,"w":1,"h":2,"solid":true,"variant":2},{"id":"artist-counter","kind":"counter","x":22,"y":17,"w":3,"h":1,"solid":true},{"id":"artist-plant","kind":"plant","x":26,"y":17,"w":1,"h":1,"solid":true},{"id":"entry-plant-l","kind":"plant","x":11,"y":16,"w":1,"h":1,"solid":true},{"id":"entry-plant-r","kind":"plant","x":18,"y":16,"w":1,"h":1,"solid":true},{"id":"entry-map-table","kind":"maptable","x":13,"y":16,"w":2,"h":1,"solid":true}]}'::jsonb),
(36,'{"grid":{"width":36,"height":20,"tile":32},"spawn":{"x":18,"y":17},"zones":[{"id":"studio","number":"01","name":"Listening Studio","subtitle":"Hear what comes next","x":1,"y":1,"w":8,"h":7,"material":"acoustic","stop":{"x":4,"y":5},"plaque":{"x":4,"y":7}},{"id":"stage","number":"02","name":"The 360 Stage","subtitle":"A home for the next sound","x":13,"y":1,"w":10,"h":6,"material":"stage","stop":{"x":18,"y":6},"plaque":{"x":18,"y":5}},{"id":"awards","number":"03","name":"Awards Gallery","subtitle":"The stories behind the milestones","x":27,"y":1,"w":8,"h":7,"material":"marble","stop":{"x":30,"y":5},"plaque":{"x":30,"y":7}},{"id":"courtyard","number":"04","name":"The Courtyard","subtitle":"Take a breath. Stay a while.","x":13,"y":8,"w":10,"h":6,"material":"grass","stop":{"x":18,"y":12},"plaque":{"x":18,"y":13}},{"id":"records","number":"05","name":"Record Lounge","subtitle":"Find your next favourite","x":1,"y":10,"w":8,"h":9,"material":"wood","stop":{"x":4,"y":13},"plaque":{"x":4,"y":10}},{"id":"campaign","number":"06","name":"Artist Corner","subtitle":"A closer look at the music","x":27,"y":10,"w":8,"h":9,"material":"terrazzo","stop":{"x":30,"y":14},"plaque":{"x":30,"y":10}}],"privateAreas":[{"id":"booth-1","name":"Listening Booth 1","x":2,"y":4,"w":3,"h":3,"stop":{"x":3,"y":5}},{"id":"booth-2","name":"Listening Booth 2","x":5,"y":4,"w":3,"h":3,"stop":{"x":6,"y":4}},{"id":"courtyard-corner","name":"Courtyard Corner","x":13,"y":9,"w":4,"h":4,"stop":{"x":16,"y":11}},{"id":"lounge-table","name":"Lounge Table","x":3,"y":13,"w":4,"h":5,"stop":{"x":4,"y":16}}],"blocks":[{"x":1,"y":1,"w":8,"h":1},{"x":1,"y":1,"w":1,"h":7},{"x":8,"y":1,"w":1,"h":7},{"x":1,"y":7,"w":3,"h":1},{"x":6,"y":7,"w":3,"h":1},{"x":13,"y":1,"w":10,"h":1},{"x":13,"y":1,"w":1,"h":5},{"x":22,"y":1,"w":1,"h":5},{"x":27,"y":1,"w":8,"h":1},{"x":27,"y":1,"w":1,"h":7},{"x":34,"y":1,"w":1,"h":7},{"x":27,"y":7,"w":3,"h":1},{"x":32,"y":7,"w":3,"h":1},{"x":1,"y":10,"w":3,"h":1},{"x":6,"y":10,"w":3,"h":1},{"x":1,"y":10,"w":1,"h":9},{"x":8,"y":10,"w":1,"h":9},{"x":1,"y":18,"w":8,"h":1},{"x":27,"y":10,"w":3,"h":1},{"x":32,"y":10,"w":3,"h":1},{"x":27,"y":10,"w":1,"h":9},{"x":34,"y":10,"w":1,"h":9},{"x":27,"y":18,"w":8,"h":1},{"id":"mixing-desk","kind":"console","x":2,"y":2,"w":5,"h":1,"solid":true},{"id":"studio-speaker-l","kind":"speaker","x":2,"y":3,"w":1,"h":1,"solid":true},{"id":"studio-speaker-r","kind":"speaker","x":6,"y":3,"w":1,"h":1,"solid":true},{"id":"listening-chair-l","kind":"headphones","x":2,"y":5,"w":1,"h":1,"solid":true},{"id":"listening-chair-r","kind":"headphones","x":6,"y":5,"w":1,"h":1,"solid":true},{"id":"studio-plant","kind":"plant","x":7,"y":6,"w":1,"h":1,"solid":true},{"id":"stage-console","kind":"console","x":16,"y":3,"w":4,"h":1,"solid":true,"variant":1},{"id":"stage-speaker-l","kind":"speaker","x":14,"y":3,"w":1,"h":2,"solid":true},{"id":"stage-speaker-r","kind":"speaker","x":21,"y":3,"w":1,"h":2,"solid":true},{"id":"gallery-display-1","kind":"plinth","x":28,"y":3,"w":2,"h":1,"solid":true,"variant":0},{"id":"gallery-display-2","kind":"plinth","x":31,"y":3,"w":2,"h":1,"solid":true,"variant":1},{"id":"gallery-display-3","kind":"plinth","x":32,"y":5,"w":1,"h":1,"solid":true,"variant":2},{"id":"gallery-plant","kind":"plant","x":28,"y":6,"w":1,"h":1,"solid":true},{"id":"courtyard-tree-l","kind":"tree","x":13,"y":8,"w":1,"h":1,"solid":true},{"id":"courtyard-tree-r","kind":"tree","x":22,"y":8,"w":1,"h":1,"solid":true},{"id":"courtyard-fountain","kind":"fountain","x":17,"y":9,"w":2,"h":2,"solid":true},{"id":"courtyard-bench-l","kind":"bench","x":14,"y":10,"w":2,"h":1,"solid":true},{"id":"courtyard-bench-r","kind":"bench","x":20,"y":10,"w":2,"h":1,"solid":true},{"id":"courtyard-plant-l","kind":"plant","x":14,"y":12,"w":1,"h":1,"solid":true},{"id":"courtyard-plant-r","kind":"plant","x":21,"y":12,"w":1,"h":1,"solid":true},{"id":"record-wall","kind":"records","x":2,"y":11,"w":2,"h":1,"solid":true},{"id":"record-wall-r","kind":"records","x":6,"y":11,"w":1,"h":1,"solid":true},{"id":"record-sofa-l","kind":"sofa","x":2,"y":14,"w":2,"h":1,"solid":true,"variant":1},{"id":"record-sofa-r","kind":"sofa","x":6,"y":15,"w":1,"h":2,"solid":true},{"id":"record-table","kind":"table","x":4,"y":15,"w":1,"h":1,"solid":true},{"id":"record-sofa-bottom","kind":"sofa","x":3,"y":17,"w":2,"h":1,"solid":true,"variant":1},{"id":"record-lamp","kind":"lamp","x":2,"y":16,"w":1,"h":1,"solid":true},{"id":"record-plant","kind":"plant","x":7,"y":17,"w":1,"h":1,"solid":true},{"id":"artist-poster-1","kind":"poster","x":28,"y":11,"w":2,"h":2,"solid":true,"variant":0},{"id":"artist-poster-2","kind":"poster","x":31,"y":11,"w":2,"h":2,"solid":true,"variant":1},{"id":"artist-poster-3","kind":"poster","x":32,"y":14,"w":1,"h":2,"solid":true,"variant":2},{"id":"artist-counter","kind":"counter","x":28,"y":17,"w":3,"h":1,"solid":true},{"id":"artist-plant","kind":"plant","x":32,"y":17,"w":1,"h":1,"solid":true},{"id":"entry-plant-l","kind":"plant","x":14,"y":16,"w":1,"h":1,"solid":true},{"id":"entry-plant-r","kind":"plant","x":21,"y":16,"w":1,"h":1,"solid":true},{"id":"entry-map-table","kind":"maptable","x":16,"y":16,"w":2,"h":1,"solid":true}]}'::jsonb)
on conflict(width) do update set data=excluded.data;

-- ------------------------------------------------------------------ helpers ---
-- How long a walker stays after their last heartbeat. The app beats every 10 s.
create or replace function public._crew_room_ttl() returns interval
language sql immutable set search_path = public as $$
  select interval '45 seconds';
$$;

-- One lock per crew room, taken before any row lock.
create or replace function public._crew_room_lock(p_crew uuid) returns void
language sql security definer set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('crew-room:' || p_crew::text, 0));
$$;

create or replace function public._crew_room_require(p_crew uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_account() then raise exception 'need_account'; end if;
  if not exists (select 1 from crew_members where crew_id = p_crew and user_id = auth.uid()) then
    raise exception 'not_in_crew';
  end if;
end $$;

create or replace function public._crew_room_walkable(p_width int, p_x int, p_y int) returns boolean
language sql stable security definer set search_path = public as $$
  select p_x > 0 and p_y > 0
     and p_x < (l.data->'grid'->>'width')::int - 1 and p_y < (l.data->'grid'->>'height')::int - 1
     and not exists (
           select 1 from jsonb_array_elements(l.data->'blocks') b
            where p_x >= (b->>'x')::int and p_x < (b->>'x')::int + (b->>'w')::int
              and p_y >= (b->>'y')::int and p_y < (b->>'y')::int + (b->>'h')::int)
    from crew_room_layouts l where l.width = p_width;
$$;

-- The conversation area at a tile, or null on the stage, the paths and the entrance.
create or replace function public._crew_room_area(p_width int, p_x int, p_y int) returns text
language sql stable security definer set search_path = public as $$
  select (select a->>'id' from jsonb_array_elements(l.data->'privateAreas') a
           where p_x >= (a->>'x')::int and p_x < (a->>'x')::int + (a->>'w')::int
             and p_y >= (a->>'y')::int and p_y < (a->>'y')::int + (a->>'h')::int
           limit 1)
    from crew_room_layouts l
   where l.width = p_width and _crew_room_walkable(p_width, p_x, p_y);
$$;
-- The first version had a section lookup nothing called.
drop function if exists public._crew_room_section(int, int, int);

-- Keeps presence.area in step with x and y (a move, an entry, a width change), so a
-- sweep never works areas out again.
create or replace function public._crew_room_presence_area() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.area := _crew_room_area((select width from crew_rooms where crew_id = new.crew_id), new.x, new.y);
  return new;
end $$;
drop trigger if exists crew_room_presence_area on public.crew_room_presence;
create trigger crew_room_presence_area before insert or update of x, y on public.crew_room_presence
  for each row execute function public._crew_room_presence_area();
-- Rows written before the trigger existed.
update public.crew_room_presence p set area = _crew_room_area(r.width, p.x, p.y)
  from public.crew_rooms r
 where r.crew_id = p.crew_id and p.area is distinct from _crew_room_area(r.width, p.x, p.y);

-- The sweep. The caller holds the room lock. Removes walkers who went stale or left
-- the crew, starts a session for an area someone is in, moves only the walkers whose
-- area session changed, and ends the session of an area nobody is in.
create or replace function public._crew_room_reconcile(p_crew uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  w int;
  t timestamptz := clock_timestamp();
begin
  select width into w from crew_rooms where crew_id = p_crew;
  delete from crew_room_presence p
   where p.crew_id = p_crew
     and (p.last_seen < t - _crew_room_ttl()
          or not exists (select 1 from crew_members m where m.crew_id = p_crew and m.user_id = p.user_id));
  insert into crew_room_circles (crew_id, x, y, section)
  select p_crew, (a->'stop'->>'x')::int, (a->'stop'->>'y')::int, a->>'id'
    from crew_room_layouts l
   cross join jsonb_array_elements(l.data->'privateAreas') a
   where l.width = w
     and a->>'id' in (select p.area from crew_room_presence p where p.crew_id = p_crew and p.area is not null)
  on conflict (crew_id, section) do nothing;
  update crew_room_presence p
     set circle_id = c.id
    from (select pp.user_id, cc.id
            from crew_room_presence pp
            left join crew_room_circles cc on cc.crew_id = p_crew and cc.section = pp.area
           where pp.crew_id = p_crew) c
   where p.crew_id = p_crew and p.user_id = c.user_id and p.circle_id is distinct from c.id;
  delete from crew_room_circles c
   where c.crew_id = p_crew and not exists (select 1 from crew_room_presence p where p.circle_id = c.id);
end $$;

-- True when a sweep has something to do: a walker went stale or left the crew. A
-- read, so a quiet room's heartbeats write nothing but their own row.
create or replace function public._crew_room_stale(p_crew uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from crew_room_presence p
     where p.crew_id = p_crew
       and (p.last_seen < clock_timestamp() - _crew_room_ttl()
            or not exists (select 1 from crew_members m where m.crew_id = p_crew and m.user_id = p.user_id)));
$$;

-- What every call hands back: the crew, the room, the live walkers (blocked people
-- left out), this Hopper's own walker (null while watching) and the area sessions.
create or replace function public._crew_room_snapshot(p_crew uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'observed_at', clock_timestamp(),
    'crew', jsonb_build_object(
      'id', c.id, 'name', c.name, 'verified', c.verified,
      'is_owner', exists (select 1 from crew_members where crew_id = c.id and user_id = auth.uid() and role = 'owner')),
    'room', jsonb_build_object('width', r.width, 'content', r.content, 'version', r.version, 'capacity', r.capacity),
    'peers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.user_id, 'name', coalesce(pr.display_name, 'A crew member'), 'look', pr.avatar,
               'x', p.x, 'y', p.y, 'circle_id', p.circle_id, 'last_seen', p.last_seen) order by p.user_id)
        from crew_room_presence p
        join profiles pr on pr.id = p.user_id
       where p.crew_id = c.id and not public.is_blocked(auth.uid(), p.user_id)
         and p.last_seen > clock_timestamp() - _crew_room_ttl()), '[]'),
    'self', (select jsonb_build_object('x', p.x, 'y', p.y, 'seq', p.seq, 'circle_id', p.circle_id, 'session_id', p.session_id)
               from crew_room_presence p
              where p.crew_id = c.id and p.user_id = auth.uid() and p.last_seen > clock_timestamp() - _crew_room_ttl()),
    'circles', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'x', x, 'y', y, 'area_id', section))
                           from crew_room_circles where crew_id = c.id), '[]'))
    from crews c join crew_rooms r on r.crew_id = c.id
   where c.id = p_crew;
$$;

-- -------------------------------------------------------------- the calls ---
-- Walk in. A member who already has a live walker keeps it (and its place); one in
-- another tab is taken over and told so on its next call (took_over here). A full
-- room lets the member in to watch (watching), with no walker.
create or replace function public.crew_room_enter(p_crew uuid, p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  room  crew_rooms;
  mine  crew_room_presence;
  spawn jsonb;
  sx    int;
  sy    int;
  took  boolean := false;
  t     timestamptz := clock_timestamp();
begin
  perform _crew_room_require(p_crew);
  if p_session is null then raise exception 'invalid_session'; end if;
  perform _crew_room_lock(p_crew);
  insert into crew_rooms (crew_id, content)
  select p_crew, jsonb_build_object('brand', left(name, 40), 'strapline', 'Your crew. Your music. Your space.',
           'musicTitle', '', 'musicUrl', '', 'audioUrl', '', 'artistTitle', '', 'artistNote', '', 'awards', '[]'::jsonb)
    from crews where id = p_crew
  on conflict do nothing;
  select * into room from crew_rooms where crew_id = p_crew;
  -- Sweep first, so a stale walker frees their spot and their own old row is gone.
  perform _crew_room_reconcile(p_crew);
  select * into mine from crew_room_presence where crew_id = p_crew and user_id = auth.uid();
  if found then
    took := mine.session_id <> p_session;
    update crew_room_presence
       set session_id = p_session, last_seen = t, seq = 0, move_credit = 3, credit_at = t
     where crew_id = p_crew and user_id = auth.uid();
  else
    if (select count(*) from crew_room_presence where crew_id = p_crew) >= room.capacity then
      return _crew_room_snapshot(p_crew) || jsonb_build_object('watching', true);
    end if;
    select data->'spawn' into spawn from crew_room_layouts where width = room.width;
    -- Arrive around the entrance without stacking every new avatar on one tile.
    select tx, ty into sx, sy
      from generate_series((spawn->>'x')::int - 2, (spawn->>'x')::int + 2) tx
     cross join generate_series((spawn->>'y')::int - 2, (spawn->>'y')::int + 2) ty
     where _crew_room_walkable(room.width, tx, ty)
       and not exists (select 1 from crew_room_presence p where p.crew_id = p_crew and p.x = tx and p.y = ty)
     order by (tx - (spawn->>'x')::int) ^ 2 + (ty - (spawn->>'y')::int) ^ 2, ty, tx
     limit 1;
    insert into crew_room_presence (crew_id, user_id, session_id, x, y)
    values (p_crew, auth.uid(), p_session, coalesce(sx, (spawn->>'x')::int), coalesce(sy, (spawn->>'y')::int));
  end if;
  perform _crew_room_reconcile(p_crew);
  return _crew_room_snapshot(p_crew) || jsonb_build_object('took_over', took);
end $$;

-- Moves (p_steps: up to 8 adjacent tiles, p_seq one past the last batch) and
-- heartbeats (no steps). A heartbeat takes no room lock unless there is a sweep to do.
--   room_session_expired   no live walker: the app enters again
--   room_session_replaced  another tab or phone has this Hopper's walker now
create or replace function public.crew_room_step(p_crew uuid, p_session uuid, p_seq int, p_steps jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p      crew_room_presence;
  tile   jsonb;
  px     int;
  py     int;
  w      int;
  n      int;
  credit numeric;
  stale  boolean;
  t      timestamptz := clock_timestamp();
begin
  perform _crew_room_require(p_crew);
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 8 then raise exception 'invalid_movement'; end if;
  n := jsonb_array_length(p_steps);
  -- A sweep is due when someone went stale, or this walker's area session does not
  -- match where they stand (a width change, or a session that ended under them).
  select * into p from crew_room_presence where crew_id = p_crew and user_id = auth.uid();
  stale := _crew_room_stale(p_crew)
           or (found and ((p.area is not null and p.circle_id is null)
                          or p.circle_id is distinct from (select c.id from crew_room_circles c
                                                            where c.crew_id = p_crew and c.section = p.area)));
  if n > 0 or stale then perform _crew_room_lock(p_crew); end if;
  select * into p from crew_room_presence where crew_id = p_crew and user_id = auth.uid() for update;
  if not found or p.last_seen < t - _crew_room_ttl() then raise exception 'room_session_expired'; end if;
  if p.session_id <> p_session then raise exception 'room_session_replaced'; end if;
  if n = 0 then
    update crew_room_presence set last_seen = t where crew_id = p_crew and user_id = auth.uid();
  else
    -- A batch the server already has (a retry) changes nothing.
    if p_seq <= p.seq then return _crew_room_snapshot(p_crew); end if;
    if p_seq <> p.seq + 1 then raise exception 'invalid_sequence'; end if;
    credit := least(8, p.move_credit + greatest(0, extract(epoch from t - p.credit_at)) * 12);
    if n > credit then raise exception 'moving_too_fast'; end if;
    select width into w from crew_rooms where crew_id = p_crew;
    px := p.x;
    py := p.y;
    for tile in select * from jsonb_array_elements(p_steps) loop
      if jsonb_typeof(tile) <> 'object'
         or coalesce(tile->>'x', '') !~ '^[0-9]{1,2}$' or coalesce(tile->>'y', '') !~ '^[0-9]{1,2}$' then
        raise exception 'invalid_movement';
      end if;
      if abs((tile->>'x')::int - px) + abs((tile->>'y')::int - py) <> 1
         or not _crew_room_walkable(w, (tile->>'x')::int, (tile->>'y')::int) then
        raise exception 'invalid_movement';
      end if;
      px := (tile->>'x')::int;
      py := (tile->>'y')::int;
    end loop;
    update crew_room_presence
       set x = px, y = py, seq = p_seq, last_seen = t, last_moved_at = t, move_credit = credit - n, credit_at = t
     where crew_id = p_crew and user_id = auth.uid();
  end if;
  -- Only a sweep, or a walk across an area boundary, touches anyone else's row.
  if stale or (n > 0 and (select area from crew_room_presence where crew_id = p_crew and user_id = auth.uid()) is distinct from p.area) then
    perform _crew_room_reconcile(p_crew);
  end if;
  return _crew_room_snapshot(p_crew);
end $$;

create or replace function public.crew_room_state(p_crew uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _crew_room_require(p_crew);
  return _crew_room_snapshot(p_crew);
end $$;

-- Walk out. Only this session's walker: a newer tab that took over stays.
create or replace function public.crew_room_leave(p_crew uuid, p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _crew_room_require(p_crew);
  perform _crew_room_lock(p_crew);
  delete from crew_room_presence where crew_id = p_crew and user_id = auth.uid() and session_id = p_session;
  perform _crew_room_reconcile(p_crew);
end $$;

-- Send. General reaches the whole crew, watchers included. An area message reaches
-- the walkers inside the area at this moment (p_circle must still be the sender's
-- area session, or conversation_changed). A retried request returns the first id.
create or replace function public.crew_room_send(p_crew uuid, p_scope text, p_body text, p_request uuid, p_circle uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  message_id uuid;
  who        profiles;
  circle     uuid;
  text_body  text := btrim(p_body);
  t          timestamptz := clock_timestamp();
begin
  perform _crew_room_require(p_crew);
  select id into message_id from crew_room_messages where crew_id = p_crew and author_id = auth.uid() and request_id = p_request;
  if found then return message_id; end if;
  if p_request is null or p_scope not in ('general', 'nearby') or text_body is null
     or char_length(text_body) not between 1 and 400 then
    raise exception 'invalid_message';
  end if;
  if (select count(*) from crew_room_messages where author_id = auth.uid() and created_at > t - interval '10 seconds') >= 6 then
    raise exception 'slow_down';
  end if;
  if p_scope = 'nearby' then
    -- The audience is the area at this moment, so the room holds still while it is read.
    perform _crew_room_lock(p_crew);
    perform _crew_room_reconcile(p_crew);
    select circle_id into circle from crew_room_presence
     where crew_id = p_crew and user_id = auth.uid() and last_seen > t - _crew_room_ttl();
    if circle is null or circle is distinct from p_circle then raise exception 'conversation_changed'; end if;
  end if;
  select * into who from profiles where id = auth.uid();
  insert into crew_room_messages (crew_id, author_id, request_id, scope, circle_id, body, author_name, author_look)
  values (p_crew, auth.uid(), p_request, p_scope, circle, text_body, coalesce(who.display_name, 'A crew member'), who.avatar)
  on conflict (crew_id, author_id, request_id) do nothing
  returning id into message_id;
  if message_id is null then
    -- The same request landed a moment ago from another call.
    select id into message_id from crew_room_messages where crew_id = p_crew and author_id = auth.uid() and request_id = p_request;
    return message_id;
  end if;
  if p_scope = 'nearby' then
    insert into crew_room_message_audience (message_id, user_id)
    select message_id, user_id from crew_room_presence
     where crew_id = p_crew and circle_id = circle and last_seen > t - _crew_room_ttl()
       and not public.is_blocked(auth.uid(), user_id);
  end if;
  return message_id;
end $$;

-- The owner's shared settings: banner, welcome line, music and audio links, artist
-- story, awards, the words that find the crew's events (eventKeywords, comma
-- separated; the crew name when empty) and width. A width change moves every walker
-- back to the entrance.
create or replace function public.crew_room_settings(p_crew uuid, p_width int, p_content jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k          text;
  text_value text;
  v          jsonb;
  clean      jsonb := '{}';
  old_width  int;
  spawn      jsonb;
begin
  perform _crew_room_require(p_crew);
  if not exists (select 1 from crew_members where crew_id = p_crew and user_id = auth.uid() and role = 'owner') then
    raise exception 'owner_only';
  end if;
  if p_width not in (30, 36) or jsonb_typeof(p_content) <> 'object' or pg_column_size(p_content) > 20000 then
    raise exception 'invalid_settings';
  end if;
  for k in select unnest(array['brand', 'strapline', 'musicTitle', 'musicUrl', 'audioUrl', 'artistTitle', 'artistNote', 'eventKeywords']) loop
    text_value := coalesce(p_content->>k, '');
    if jsonb_typeof(p_content->k) not in ('string', 'null')
       or char_length(text_value) > (case when k = 'artistNote' then 1200 when k in ('musicUrl', 'audioUrl') then 2000
                                          when k = 'brand' then 40 else 160 end) then
      raise exception 'invalid_settings';
    end if;
    if k in ('musicUrl', 'audioUrl') and text_value <> '' and text_value !~ '^https?://[^[:space:]]+$' then
      raise exception 'invalid_link';
    end if;
    clean := clean || jsonb_build_object(k, text_value);
  end loop;
  if char_length(btrim(clean->>'brand')) = 0 then raise exception 'invalid_settings'; end if;
  v := coalesce(p_content->'awards', '[]');
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 12 then raise exception 'invalid_settings'; end if;
  for v in select * from jsonb_array_elements(v) loop
    if jsonb_typeof(v) <> 'object' or coalesce(v->>'title', '') = '' or coalesce(v->>'year', '') = ''
       or char_length(v->>'title') > 160 or char_length(v->>'detail') > 1200
       or (coalesce(v->>'sourceUrl', '') <> '' and v->>'sourceUrl' !~ '^https?://[^[:space:]]+$') then
      raise exception 'invalid_settings';
    end if;
  end loop;
  clean := clean || jsonb_build_object('awards', coalesce(p_content->'awards', '[]'));
  perform _crew_room_lock(p_crew);
  select width into old_width from crew_rooms where crew_id = p_crew;
  insert into crew_rooms (crew_id, width, content) values (p_crew, p_width, clean)
  on conflict (crew_id) do update
    set width = p_width, content = clean, version = crew_rooms.version + 1, updated_at = clock_timestamp();
  if old_width is distinct from p_width then
    select data->'spawn' into spawn from crew_room_layouts where width = p_width;
    delete from crew_room_circles where crew_id = p_crew;
    update crew_room_presence
       set x = (spawn->>'x')::int, y = (spawn->>'y')::int, seq = 0, last_moved_at = clock_timestamp(),
           move_credit = 3, credit_at = clock_timestamp()
     where crew_id = p_crew;
    perform _crew_room_reconcile(p_crew);
  end if;
  return _crew_room_snapshot(p_crew);
end $$;

-- ------------------------------------------------------- crew hub and invites ---
-- Joining by invite link (/crew/join/<code>): each crew's invite_code (schema.sql)
-- is the link. Attempts are counted per Hopper, right or wrong, so codes cannot be
-- guessed by trying them.
create table if not exists public.crew_join_attempts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists crew_join_attempts_user on public.crew_join_attempts(user_id, at desc);
alter table public.crew_join_attempts enable row level security;
revoke all on public.crew_join_attempts from anon, authenticated;

-- One crew as its hub and its invite page show it. Who sees it: a member (with the
-- recent General chat), anyone holding its invite code, and anyone at all for an
-- open crew. Anyone else gets null. "in_room" and "heads" are the walkers there now
-- (blocked people left out); "keywords" are the words its events are found by.
create or replace function public.crew_card(p_crew uuid default null, p_code text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c      crews;
  member boolean;
  t      timestamptz := clock_timestamp();
begin
  if p_crew is not null then
    select * into c from crews where id = p_crew;
  elsif coalesce(btrim(p_code), '') <> '' then
    select * into c from crews where invite_code = upper(btrim(p_code));
  end if;
  if c.id is null then return null; end if;
  member := auth.uid() is not null and exists (select 1 from crew_members where crew_id = c.id and user_id = auth.uid());
  if not member and c.visibility <> 'open' and (p_code is null or upper(btrim(p_code)) <> c.invite_code) then
    return null;
  end if;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'verified', c.verified, 'visibility', c.visibility,
    'members', (select count(*) from crew_members where crew_id = c.id),
    'is_member', member,
    'is_owner', member and exists (select 1 from crew_members where crew_id = c.id and user_id = auth.uid() and role = 'owner'),
    'invite_code', case when member then c.invite_code end,
    'brand', coalesce(nullif((select r.content->>'brand' from crew_rooms r where r.crew_id = c.id), ''), c.name),
    'keywords', coalesce(nullif(btrim((select r.content->>'eventKeywords' from crew_rooms r where r.crew_id = c.id)), ''), c.name),
    'in_room', (select count(*) from crew_room_presence p
                 where p.crew_id = c.id and p.last_seen > t - _crew_room_ttl()
                   and (auth.uid() is null or not public.is_blocked(auth.uid(), p.user_id))),
    'heads', coalesce((
      select jsonb_agg(h) from (
        select jsonb_build_object('id', p.user_id, 'name', coalesce(pr.display_name, 'A crew member'), 'look', pr.avatar) as h
          from crew_room_presence p join profiles pr on pr.id = p.user_id
         where p.crew_id = c.id and p.last_seen > t - _crew_room_ttl()
           and (auth.uid() is null or not public.is_blocked(auth.uid(), p.user_id))
         order by p.last_moved_at desc
         limit 8) heads), '[]'),
    'recent', case when member then coalesce((
      select jsonb_agg(m order by m->>'created_at') from (
        select jsonb_build_object('id', m.id, 'author_id', m.author_id, 'author_name', m.author_name, 'author_look', m.author_look,
                                  'body', m.body, 'created_at', m.created_at) as m
          from crew_room_messages m
         where m.crew_id = c.id and m.scope = 'general' and not public.is_blocked(auth.uid(), m.author_id)
         order by m.created_at desc
         limit 3) recent), '[]') else '[]'::jsonb end);
end $$;

-- Join with an invite code. Needs an account. At most 10 tries in 10 minutes. A
-- wrong code is an answer ({"ok": false, "reason": "invalid_code"}), not an error,
-- so the try it used is kept. A Hopper already in the crew is told so (joined
-- false); nobody is added twice.
create or replace function public.crew_join_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c     crews;
  added int;
begin
  if auth.uid() is null or not public.has_account() then raise exception 'need_account'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crew-join:' || auth.uid()::text, 0));
  delete from crew_join_attempts where user_id = auth.uid() and at < clock_timestamp() - interval '1 day';
  if (select count(*) from crew_join_attempts where user_id = auth.uid() and at > clock_timestamp() - interval '10 minutes') >= 10 then
    raise exception 'slow_down';
  end if;
  insert into crew_join_attempts (user_id) values (auth.uid());
  select * into c from crews where invite_code = upper(btrim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid_code'); end if;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  get diagnostics added = row_count;
  return jsonb_build_object('ok', true, 'crew_id', c.id, 'joined', added > 0);
end $$;

-- The owner makes a new invite code; the old link stops working at once.
create or replace function public.crew_invite_reset(p_crew uuid) returns text
language plpgsql security definer set search_path = public as $$
declare code text;
begin
  perform _crew_room_require(p_crew);
  if not exists (select 1 from crew_members where crew_id = p_crew and user_id = auth.uid() and role = 'owner') then
    raise exception 'owner_only';
  end if;
  -- Ten random hex digits, like schema.sql's default (gen_random_uuid needs no extension schema).
  update crews set invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
   where id = p_crew returning invite_code into code;
  return code;
end $$;

-- ---------------------------------------------------------------- reading ---
-- A member reads General, and the area messages they received. Not across a block,
-- and nothing once they leave the crew.
create or replace function public._crew_room_message_visible(p_message uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from crew_room_messages m
      join crew_members cm on cm.crew_id = m.crew_id and cm.user_id = auth.uid()
     where m.id = p_message and not public.is_blocked(auth.uid(), m.author_id)
       and (m.scope = 'general'
            or exists (select 1 from crew_room_message_audience a where a.message_id = m.id and a.user_id = auth.uid())));
$$;
create or replace function public._crew_room_peer_visible(p_crew uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_crew_member(p_crew) and not public.is_blocked(auth.uid(), p_user);
$$;

alter table public.crew_room_layouts enable row level security;
alter table public.crew_rooms enable row level security;
alter table public.crew_room_presence enable row level security;
alter table public.crew_room_circles enable row level security;
alter table public.crew_room_messages enable row level security;
alter table public.crew_room_message_audience enable row level security;
-- Policy replacement makes reruns safe without dropping any table or data.
drop policy if exists crew_rooms_member_read on public.crew_rooms;
create policy crew_rooms_member_read on public.crew_rooms for select to authenticated
  using (public.is_crew_member(crew_id));
drop policy if exists crew_room_presence_member_read on public.crew_room_presence;
create policy crew_room_presence_member_read on public.crew_room_presence for select to authenticated
  using (public._crew_room_peer_visible(crew_id, user_id));
drop policy if exists crew_room_messages_audience_read on public.crew_room_messages;
create policy crew_room_messages_audience_read on public.crew_room_messages for select to authenticated
  using (public._crew_room_message_visible(id));

revoke all on public.crew_room_layouts, public.crew_rooms, public.crew_room_presence, public.crew_room_circles,
  public.crew_room_messages, public.crew_room_message_audience from anon, authenticated;
grant select on public.crew_rooms, public.crew_room_presence, public.crew_room_messages to authenticated;
revoke all on function public._crew_room_ttl(), public._crew_room_lock(uuid), public._crew_room_require(uuid),
  public._crew_room_walkable(int, int, int), public._crew_room_area(int, int, int), public._crew_room_presence_area(),
  public._crew_room_reconcile(uuid), public._crew_room_stale(uuid), public._crew_room_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public._crew_room_message_visible(uuid), public._crew_room_peer_visible(uuid, uuid) from public, anon;
grant execute on function public._crew_room_message_visible(uuid), public._crew_room_peer_visible(uuid, uuid) to authenticated;
revoke all on function public.crew_room_enter(uuid, uuid), public.crew_room_step(uuid, uuid, int, jsonb),
  public.crew_room_state(uuid), public.crew_room_leave(uuid, uuid), public.crew_room_send(uuid, text, text, uuid, uuid),
  public.crew_room_settings(uuid, int, jsonb) from public, anon;
grant execute on function public.crew_room_enter(uuid, uuid), public.crew_room_step(uuid, uuid, int, jsonb),
  public.crew_room_state(uuid), public.crew_room_leave(uuid, uuid), public.crew_room_send(uuid, text, text, uuid, uuid),
  public.crew_room_settings(uuid, int, jsonb) to authenticated;
-- The card is public (an invite preview is drawn with the public key); joining and a new code need a session.
revoke all on function public.crew_card(uuid, text), public.crew_join_code(text), public.crew_invite_reset(uuid) from public;
grant execute on function public.crew_card(uuid, text) to anon, authenticated;
grant execute on function public.crew_join_code(text), public.crew_invite_reset(uuid) to authenticated;

-- Realtime carries new messages (RLS decides who gets each one) and settings changes.
-- Walkers are read by polling, so presence stays out: a heartbeat is not a Realtime event.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crew_room_messages') then
      alter publication supabase_realtime add table public.crew_room_messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crew_rooms') then
      alter publication supabase_realtime add table public.crew_rooms;
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crew_room_presence') then
      alter publication supabase_realtime drop table public.crew_room_presence;
    end if;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
