-- Crew-owned rooms, authoritative tile movement and recipient-scoped text conversations.
-- Additive migration. Apply after schema.sql and chat_accounts.sql. No existing chat/drop functions are replaced.
begin;
create table if not exists public.crew_room_layouts (
  width integer primary key check (width in (30,36)), data jsonb not null
);
create table if not exists public.crew_rooms (
  crew_id uuid primary key references public.crews(id) on delete cascade,
  width integer not null default 30 references public.crew_room_layouts(width),
  content jsonb not null default '{}', version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists public.crew_room_circles (
  id uuid primary key default gen_random_uuid(), crew_id uuid not null references public.crews(id) on delete cascade,
  x integer not null, y integer not null, section text not null, created_at timestamptz not null default now()
);
create table if not exists public.crew_room_presence (
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null, x integer not null, y integer not null,
  seq integer not null default 0, circle_id uuid references public.crew_room_circles(id) on delete set null,
  last_seen timestamptz not null default now(), last_moved_at timestamptz not null default now(),
  move_credit numeric not null default 3, credit_at timestamptz not null default now(),
  primary key (crew_id,user_id)
);
create table if not exists public.crew_room_messages (
  id uuid primary key default gen_random_uuid(), crew_id uuid not null references public.crews(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade, request_id uuid not null,
  scope text not null check (scope in ('general','nearby')), circle_id uuid,
  body text not null check (char_length(body) between 1 and 400), author_name text not null, author_look jsonb,
  created_at timestamptz not null default now(), unique (crew_id,author_id,request_id)
);
create table if not exists public.crew_room_message_audience (
  message_id uuid not null references public.crew_room_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (message_id,user_id)
);
create index if not exists crew_room_messages_recent on public.crew_room_messages(crew_id,created_at desc);
create index if not exists crew_room_presence_live on public.crew_room_presence(crew_id,last_seen);
create index if not exists crew_room_audience_user on public.crew_room_message_audience(user_id,message_id);

-- Layout values are generated from src/lib/campaign/layout.ts by export-layouts.mjs.
-- LAYOUT_SEED
insert into public.crew_room_layouts(width,data) values
(30,'{"grid":{"width":30,"height":20,"tile":32},"spawn":{"x":15,"y":17},"zones":[{"id":"studio","number":"01","name":"Listening Studio","subtitle":"Hear what comes next","x":1,"y":1,"w":8,"h":7,"material":"acoustic","stop":{"x":4,"y":5},"plaque":{"x":4,"y":7}},{"id":"stage","number":"02","name":"The 360 Stage","subtitle":"A home for the next sound","x":10,"y":1,"w":10,"h":6,"material":"stage","stop":{"x":15,"y":6},"plaque":{"x":15,"y":5}},{"id":"awards","number":"03","name":"Awards Gallery","subtitle":"The stories behind the milestones","x":21,"y":1,"w":8,"h":7,"material":"marble","stop":{"x":24,"y":5},"plaque":{"x":24,"y":7}},{"id":"courtyard","number":"04","name":"The Courtyard","subtitle":"Take a breath. Stay a while.","x":10,"y":8,"w":10,"h":6,"material":"grass","stop":{"x":15,"y":12},"plaque":{"x":15,"y":13}},{"id":"records","number":"05","name":"Record Lounge","subtitle":"Find your next favourite","x":1,"y":10,"w":8,"h":9,"material":"wood","stop":{"x":4,"y":13},"plaque":{"x":4,"y":10}},{"id":"campaign","number":"06","name":"Artist Corner","subtitle":"A closer look at the music","x":21,"y":10,"w":8,"h":9,"material":"terrazzo","stop":{"x":24,"y":14},"plaque":{"x":24,"y":10}}],"privateAreas":[{"id":"booth-1","name":"Listening Booth 1","x":2,"y":4,"w":3,"h":3,"stop":{"x":3,"y":5}},{"id":"booth-2","name":"Listening Booth 2","x":5,"y":4,"w":3,"h":3,"stop":{"x":6,"y":4}},{"id":"courtyard-corner","name":"Courtyard Corner","x":10,"y":9,"w":4,"h":4,"stop":{"x":13,"y":11}},{"id":"lounge-table","name":"Lounge Table","x":3,"y":13,"w":4,"h":5,"stop":{"x":4,"y":16}}],"blocks":[{"x":1,"y":1,"w":8,"h":1},{"x":1,"y":1,"w":1,"h":7},{"x":8,"y":1,"w":1,"h":7},{"x":1,"y":7,"w":3,"h":1},{"x":6,"y":7,"w":3,"h":1},{"x":10,"y":1,"w":10,"h":1},{"x":10,"y":1,"w":1,"h":5},{"x":19,"y":1,"w":1,"h":5},{"x":21,"y":1,"w":8,"h":1},{"x":21,"y":1,"w":1,"h":7},{"x":28,"y":1,"w":1,"h":7},{"x":21,"y":7,"w":3,"h":1},{"x":26,"y":7,"w":3,"h":1},{"x":1,"y":10,"w":3,"h":1},{"x":6,"y":10,"w":3,"h":1},{"x":1,"y":10,"w":1,"h":9},{"x":8,"y":10,"w":1,"h":9},{"x":1,"y":18,"w":8,"h":1},{"x":21,"y":10,"w":3,"h":1},{"x":26,"y":10,"w":3,"h":1},{"x":21,"y":10,"w":1,"h":9},{"x":28,"y":10,"w":1,"h":9},{"x":21,"y":18,"w":8,"h":1},{"id":"mixing-desk","kind":"console","x":2,"y":2,"w":5,"h":1,"solid":true},{"id":"studio-speaker-l","kind":"speaker","x":2,"y":3,"w":1,"h":1,"solid":true},{"id":"studio-speaker-r","kind":"speaker","x":6,"y":3,"w":1,"h":1,"solid":true},{"id":"listening-chair-l","kind":"headphones","x":2,"y":5,"w":1,"h":1,"solid":true},{"id":"listening-chair-r","kind":"headphones","x":6,"y":5,"w":1,"h":1,"solid":true},{"id":"studio-plant","kind":"plant","x":7,"y":6,"w":1,"h":1,"solid":true},{"id":"stage-console","kind":"console","x":13,"y":3,"w":4,"h":1,"solid":true,"variant":1},{"id":"stage-speaker-l","kind":"speaker","x":11,"y":3,"w":1,"h":2,"solid":true},{"id":"stage-speaker-r","kind":"speaker","x":18,"y":3,"w":1,"h":2,"solid":true},{"id":"gallery-display-1","kind":"plinth","x":22,"y":3,"w":2,"h":1,"solid":true,"variant":0},{"id":"gallery-display-2","kind":"plinth","x":25,"y":3,"w":2,"h":1,"solid":true,"variant":1},{"id":"gallery-display-3","kind":"plinth","x":26,"y":5,"w":1,"h":1,"solid":true,"variant":2},{"id":"gallery-plant","kind":"plant","x":22,"y":6,"w":1,"h":1,"solid":true},{"id":"courtyard-tree-l","kind":"tree","x":10,"y":8,"w":1,"h":1,"solid":true},{"id":"courtyard-tree-r","kind":"tree","x":19,"y":8,"w":1,"h":1,"solid":true},{"id":"courtyard-fountain","kind":"fountain","x":14,"y":9,"w":2,"h":2,"solid":true},{"id":"courtyard-bench-l","kind":"bench","x":11,"y":10,"w":2,"h":1,"solid":true},{"id":"courtyard-bench-r","kind":"bench","x":17,"y":10,"w":2,"h":1,"solid":true},{"id":"courtyard-plant-l","kind":"plant","x":11,"y":12,"w":1,"h":1,"solid":true},{"id":"courtyard-plant-r","kind":"plant","x":18,"y":12,"w":1,"h":1,"solid":true},{"id":"record-wall","kind":"records","x":2,"y":11,"w":2,"h":1,"solid":true},{"id":"record-wall-r","kind":"records","x":6,"y":11,"w":1,"h":1,"solid":true},{"id":"record-sofa-l","kind":"sofa","x":2,"y":14,"w":2,"h":1,"solid":true,"variant":1},{"id":"record-sofa-r","kind":"sofa","x":6,"y":15,"w":1,"h":2,"solid":true},{"id":"record-table","kind":"table","x":4,"y":15,"w":1,"h":1,"solid":true},{"id":"record-sofa-bottom","kind":"sofa","x":3,"y":17,"w":2,"h":1,"solid":true,"variant":1},{"id":"record-lamp","kind":"lamp","x":2,"y":16,"w":1,"h":1,"solid":true},{"id":"record-plant","kind":"plant","x":7,"y":17,"w":1,"h":1,"solid":true},{"id":"artist-poster-1","kind":"poster","x":22,"y":11,"w":2,"h":2,"solid":true,"variant":0},{"id":"artist-poster-2","kind":"poster","x":25,"y":11,"w":2,"h":2,"solid":true,"variant":1},{"id":"artist-poster-3","kind":"poster","x":26,"y":14,"w":1,"h":2,"solid":true,"variant":2},{"id":"artist-counter","kind":"counter","x":22,"y":17,"w":3,"h":1,"solid":true},{"id":"artist-plant","kind":"plant","x":26,"y":17,"w":1,"h":1,"solid":true},{"id":"entry-plant-l","kind":"plant","x":11,"y":16,"w":1,"h":1,"solid":true},{"id":"entry-plant-r","kind":"plant","x":18,"y":16,"w":1,"h":1,"solid":true}]}'::jsonb),
(36,'{"grid":{"width":36,"height":20,"tile":32},"spawn":{"x":18,"y":17},"zones":[{"id":"studio","number":"01","name":"Listening Studio","subtitle":"Hear what comes next","x":1,"y":1,"w":8,"h":7,"material":"acoustic","stop":{"x":4,"y":5},"plaque":{"x":4,"y":7}},{"id":"stage","number":"02","name":"The 360 Stage","subtitle":"A home for the next sound","x":13,"y":1,"w":10,"h":6,"material":"stage","stop":{"x":18,"y":6},"plaque":{"x":18,"y":5}},{"id":"awards","number":"03","name":"Awards Gallery","subtitle":"The stories behind the milestones","x":27,"y":1,"w":8,"h":7,"material":"marble","stop":{"x":30,"y":5},"plaque":{"x":30,"y":7}},{"id":"courtyard","number":"04","name":"The Courtyard","subtitle":"Take a breath. Stay a while.","x":13,"y":8,"w":10,"h":6,"material":"grass","stop":{"x":18,"y":12},"plaque":{"x":18,"y":13}},{"id":"records","number":"05","name":"Record Lounge","subtitle":"Find your next favourite","x":1,"y":10,"w":8,"h":9,"material":"wood","stop":{"x":4,"y":13},"plaque":{"x":4,"y":10}},{"id":"campaign","number":"06","name":"Artist Corner","subtitle":"A closer look at the music","x":27,"y":10,"w":8,"h":9,"material":"terrazzo","stop":{"x":30,"y":14},"plaque":{"x":30,"y":10}}],"privateAreas":[{"id":"booth-1","name":"Listening Booth 1","x":2,"y":4,"w":3,"h":3,"stop":{"x":3,"y":5}},{"id":"booth-2","name":"Listening Booth 2","x":5,"y":4,"w":3,"h":3,"stop":{"x":6,"y":4}},{"id":"courtyard-corner","name":"Courtyard Corner","x":13,"y":9,"w":4,"h":4,"stop":{"x":16,"y":11}},{"id":"lounge-table","name":"Lounge Table","x":3,"y":13,"w":4,"h":5,"stop":{"x":4,"y":16}}],"blocks":[{"x":1,"y":1,"w":8,"h":1},{"x":1,"y":1,"w":1,"h":7},{"x":8,"y":1,"w":1,"h":7},{"x":1,"y":7,"w":3,"h":1},{"x":6,"y":7,"w":3,"h":1},{"x":13,"y":1,"w":10,"h":1},{"x":13,"y":1,"w":1,"h":5},{"x":22,"y":1,"w":1,"h":5},{"x":27,"y":1,"w":8,"h":1},{"x":27,"y":1,"w":1,"h":7},{"x":34,"y":1,"w":1,"h":7},{"x":27,"y":7,"w":3,"h":1},{"x":32,"y":7,"w":3,"h":1},{"x":1,"y":10,"w":3,"h":1},{"x":6,"y":10,"w":3,"h":1},{"x":1,"y":10,"w":1,"h":9},{"x":8,"y":10,"w":1,"h":9},{"x":1,"y":18,"w":8,"h":1},{"x":27,"y":10,"w":3,"h":1},{"x":32,"y":10,"w":3,"h":1},{"x":27,"y":10,"w":1,"h":9},{"x":34,"y":10,"w":1,"h":9},{"x":27,"y":18,"w":8,"h":1},{"id":"mixing-desk","kind":"console","x":2,"y":2,"w":5,"h":1,"solid":true},{"id":"studio-speaker-l","kind":"speaker","x":2,"y":3,"w":1,"h":1,"solid":true},{"id":"studio-speaker-r","kind":"speaker","x":6,"y":3,"w":1,"h":1,"solid":true},{"id":"listening-chair-l","kind":"headphones","x":2,"y":5,"w":1,"h":1,"solid":true},{"id":"listening-chair-r","kind":"headphones","x":6,"y":5,"w":1,"h":1,"solid":true},{"id":"studio-plant","kind":"plant","x":7,"y":6,"w":1,"h":1,"solid":true},{"id":"stage-console","kind":"console","x":16,"y":3,"w":4,"h":1,"solid":true,"variant":1},{"id":"stage-speaker-l","kind":"speaker","x":14,"y":3,"w":1,"h":2,"solid":true},{"id":"stage-speaker-r","kind":"speaker","x":21,"y":3,"w":1,"h":2,"solid":true},{"id":"gallery-display-1","kind":"plinth","x":28,"y":3,"w":2,"h":1,"solid":true,"variant":0},{"id":"gallery-display-2","kind":"plinth","x":31,"y":3,"w":2,"h":1,"solid":true,"variant":1},{"id":"gallery-display-3","kind":"plinth","x":32,"y":5,"w":1,"h":1,"solid":true,"variant":2},{"id":"gallery-plant","kind":"plant","x":28,"y":6,"w":1,"h":1,"solid":true},{"id":"courtyard-tree-l","kind":"tree","x":13,"y":8,"w":1,"h":1,"solid":true},{"id":"courtyard-tree-r","kind":"tree","x":22,"y":8,"w":1,"h":1,"solid":true},{"id":"courtyard-fountain","kind":"fountain","x":17,"y":9,"w":2,"h":2,"solid":true},{"id":"courtyard-bench-l","kind":"bench","x":14,"y":10,"w":2,"h":1,"solid":true},{"id":"courtyard-bench-r","kind":"bench","x":20,"y":10,"w":2,"h":1,"solid":true},{"id":"courtyard-plant-l","kind":"plant","x":14,"y":12,"w":1,"h":1,"solid":true},{"id":"courtyard-plant-r","kind":"plant","x":21,"y":12,"w":1,"h":1,"solid":true},{"id":"record-wall","kind":"records","x":2,"y":11,"w":2,"h":1,"solid":true},{"id":"record-wall-r","kind":"records","x":6,"y":11,"w":1,"h":1,"solid":true},{"id":"record-sofa-l","kind":"sofa","x":2,"y":14,"w":2,"h":1,"solid":true,"variant":1},{"id":"record-sofa-r","kind":"sofa","x":6,"y":15,"w":1,"h":2,"solid":true},{"id":"record-table","kind":"table","x":4,"y":15,"w":1,"h":1,"solid":true},{"id":"record-sofa-bottom","kind":"sofa","x":3,"y":17,"w":2,"h":1,"solid":true,"variant":1},{"id":"record-lamp","kind":"lamp","x":2,"y":16,"w":1,"h":1,"solid":true},{"id":"record-plant","kind":"plant","x":7,"y":17,"w":1,"h":1,"solid":true},{"id":"artist-poster-1","kind":"poster","x":28,"y":11,"w":2,"h":2,"solid":true,"variant":0},{"id":"artist-poster-2","kind":"poster","x":31,"y":11,"w":2,"h":2,"solid":true,"variant":1},{"id":"artist-poster-3","kind":"poster","x":32,"y":14,"w":1,"h":2,"solid":true,"variant":2},{"id":"artist-counter","kind":"counter","x":28,"y":17,"w":3,"h":1,"solid":true},{"id":"artist-plant","kind":"plant","x":32,"y":17,"w":1,"h":1,"solid":true},{"id":"entry-plant-l","kind":"plant","x":14,"y":16,"w":1,"h":1,"solid":true},{"id":"entry-plant-r","kind":"plant","x":21,"y":16,"w":1,"h":1,"solid":true}]}'::jsonb)
on conflict(width) do update set data=excluded.data;

create or replace function public._crew_room_require(p_crew uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_account() then raise exception 'need_account'; end if;
  if not exists(select 1 from crew_members where crew_id=p_crew and user_id=auth.uid()) then raise exception 'not_in_crew'; end if;
end $$;
create or replace function public._crew_room_walkable(p_width int,p_x int,p_y int) returns boolean
language sql stable security definer set search_path=public as $$
  select p_x>0 and p_y>0 and p_x<(l.data->'grid'->>'width')::int-1 and p_y<(l.data->'grid'->>'height')::int-1
    and not exists(select 1 from jsonb_array_elements(l.data->'blocks') b
      where p_x >= (b->>'x')::int and p_x < (b->>'x')::int+(b->>'w')::int
        and p_y >= (b->>'y')::int and p_y < (b->>'y')::int+(b->>'h')::int)
  from crew_room_layouts l where l.width=p_width;
$$;
create or replace function public._crew_room_section(p_width int,p_x int,p_y int) returns text
language sql stable security definer set search_path=public as $$
  select coalesce((select z->>'id' from jsonb_array_elements(l.data->'zones') z
    where p_x >= (z->>'x')::int and p_x < (z->>'x')::int+(z->>'w')::int
      and p_y >= (z->>'y')::int and p_y < (z->>'y')::int+(z->>'h')::int limit 1),'walkway')
  from crew_room_layouts l where l.width=p_width;
$$;

-- Fixed authored areas own their conversation session. Walking inside an area
-- keeps the same session; only crossing its boundary changes the audience.
create or replace function public._crew_room_area(p_width int,p_x int,p_y int) returns text
language sql stable security definer set search_path=public as $$
 select (select a->>'id' from jsonb_array_elements(l.data->'privateAreas') a
   where p_x>=(a->>'x')::int and p_x<(a->>'x')::int+(a->>'w')::int
     and p_y>=(a->>'y')::int and p_y<(a->>'y')::int+(a->>'h')::int limit 1)
 from crew_room_layouts l where l.width=p_width and _crew_room_walkable(p_width,p_x,p_y);
$$;
create or replace function public._crew_room_reconcile(p_crew uuid) returns void
language plpgsql security definer set search_path=public as $$
declare w int; t timestamptz:=clock_timestamp(); area jsonb;
begin
 select width into w from crew_rooms where crew_id=p_crew;
 delete from crew_room_presence p where p.crew_id=p_crew and
   (p.last_seen<t-interval '15 seconds' or not exists(select 1 from crew_members m where m.crew_id=p_crew and m.user_id=p.user_id));
 for area in select a from crew_room_layouts l cross join jsonb_array_elements(l.data->'privateAreas') a where l.width=w loop
   if exists(select 1 from crew_room_presence p where p.crew_id=p_crew and _crew_room_area(w,p.x,p.y)=area->>'id')
      and not exists(select 1 from crew_room_circles c where c.crew_id=p_crew and c.section=area->>'id') then
     insert into crew_room_circles(crew_id,x,y,section) values(p_crew,(area->'stop'->>'x')::int,(area->'stop'->>'y')::int,area->>'id');
   end if;
 end loop;
 update crew_room_presence p set circle_id=(select c.id from crew_room_circles c
   where c.crew_id=p_crew and c.section=_crew_room_area(w,p.x,p.y) order by c.created_at,c.id limit 1)
 where p.crew_id=p_crew;
 delete from crew_room_circles c where c.crew_id=p_crew and not exists(select 1 from crew_room_presence p where p.circle_id=c.id);
end $$;

create or replace function public._crew_room_snapshot(p_crew uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'observed_at',clock_timestamp(),
  'crew',jsonb_build_object('id',c.id,'name',c.name,'is_owner',exists(select 1 from crew_members where crew_id=c.id and user_id=auth.uid() and role='owner')),
  'room',jsonb_build_object('width',r.width,'content',r.content,'version',r.version),
  'peers',coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(pr.display_name,'A crew member'),'look',pr.avatar,
    'x',p.x,'y',p.y,'circle_id',p.circle_id,'last_seen',p.last_seen) order by p.user_id) from crew_room_presence p
    join profiles pr on pr.id=p.user_id where p.crew_id=c.id and not public.is_blocked(auth.uid(),p.user_id) and p.last_seen>clock_timestamp()-interval '15 seconds'), '[]'),
  'self',(select jsonb_build_object('x',p.x,'y',p.y,'seq',p.seq,'circle_id',p.circle_id,'session_id',p.session_id) from crew_room_presence p where p.crew_id=c.id and p.user_id=auth.uid()),
  'circles',coalesce((select jsonb_agg(jsonb_build_object('id',id,'x',x,'y',y,'area_id',section)) from crew_room_circles where crew_id=c.id),'[]')
 ) from crews c join crew_rooms r on r.crew_id=c.id where c.id=p_crew;
$$;
create or replace function public.crew_room_enter(p_crew uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare room_row crew_rooms; spawn jsonb; sx int; sy int;
begin
 perform _crew_room_require(p_crew);
 if p_session is null then raise exception 'invalid_session'; end if;
 perform pg_advisory_xact_lock(hashtextextended('crew-room:'||p_crew::text,0));
 insert into crew_rooms(crew_id,content) select p_crew,jsonb_build_object('brand',left(name,40),'strapline','Your crew. Your music. Your space.',
   'musicTitle','','musicUrl','','audioUrl','','artistTitle','','artistNote','','awards','[]'::jsonb) from crews where id=p_crew on conflict do nothing;
 select * into room_row from crew_rooms where crew_id=p_crew;
 select data->'spawn' into spawn from crew_room_layouts where width=room_row.width;
 -- Arrive around the entrance without stacking every new avatar on one tile.
 select tx,ty into sx,sy from generate_series((spawn->>'x')::int-2,(spawn->>'x')::int+2) tx
 cross join generate_series((spawn->>'y')::int-2,(spawn->>'y')::int+2) ty
 where _crew_room_walkable(room_row.width,tx,ty)
 and not exists(select 1 from crew_room_presence p where p.crew_id=p_crew and p.user_id<>auth.uid()
   and p.last_seen>clock_timestamp()-interval '15 seconds' and p.x=tx and p.y=ty)
 order by (tx-(spawn->>'x')::int)^2+(ty-(spawn->>'y')::int)^2,ty,tx limit 1;
 insert into crew_room_presence(crew_id,user_id,session_id,x,y) values(p_crew,auth.uid(),p_session,coalesce(sx,(spawn->>'x')::int),coalesce(sy,(spawn->>'y')::int))
 on conflict(crew_id,user_id) do update set session_id=p_session,last_seen=clock_timestamp(),circle_id=null,seq=0,move_credit=3,credit_at=clock_timestamp(),
   x=case when crew_room_presence.last_seen>clock_timestamp()-interval '15 seconds' then crew_room_presence.x else excluded.x end,
   y=case when crew_room_presence.last_seen>clock_timestamp()-interval '15 seconds' then crew_room_presence.y else excluded.y end;
 perform _crew_room_reconcile(p_crew);
 return _crew_room_snapshot(p_crew);
end $$;

create or replace function public.crew_room_step(p_crew uuid,p_session uuid,p_seq int,p_steps jsonb default '[]') returns jsonb
language plpgsql security definer set search_path=public as $$
declare p crew_room_presence; tile jsonb; px int; py int; w int; n int; credit numeric; t timestamptz:=clock_timestamp();
begin
 perform _crew_room_require(p_crew);
 perform pg_advisory_xact_lock(hashtextextended('crew-room:'||p_crew::text,0));
 select * into p from crew_room_presence where crew_id=p_crew and user_id=auth.uid() for update;
 if not found or p.session_id<>p_session or p.last_seen<t-interval '15 seconds' then raise exception 'room_session_expired'; end if;
 if jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps)>8 then raise exception 'invalid_movement'; end if;
 n:=jsonb_array_length(p_steps);
 if n>0 and p_seq<=p.seq then return _crew_room_snapshot(p_crew); end if;
 if n>0 and p_seq<>p.seq+1 then raise exception 'invalid_sequence'; end if;
 credit:=least(8,p.move_credit+greatest(0,extract(epoch from t-p.credit_at))*12);
 if n>credit then raise exception 'moving_too_fast'; end if;
 select width into w from crew_rooms where crew_id=p_crew;
 px:=p.x; py:=p.y;
 for tile in select * from jsonb_array_elements(p_steps) loop
   if jsonb_typeof(tile)<>'object' or coalesce(tile->>'x','')!~'^[0-9]{1,2}$' or coalesce(tile->>'y','')!~'^[0-9]{1,2}$' then raise exception 'invalid_movement'; end if;
   if abs((tile->>'x')::int-px)+abs((tile->>'y')::int-py)<>1 or not _crew_room_walkable(w,(tile->>'x')::int,(tile->>'y')::int) then raise exception 'invalid_movement'; end if;
   px:=(tile->>'x')::int; py:=(tile->>'y')::int;
 end loop;
 update crew_room_presence set x=px,y=py,seq=case when n>0 then p_seq else seq end,last_seen=t,
   last_moved_at=case when n>0 then t else last_moved_at end,move_credit=credit-n,credit_at=t where crew_id=p_crew and user_id=auth.uid();
 perform _crew_room_reconcile(p_crew);
 return _crew_room_snapshot(p_crew);
end $$;
create or replace function public.crew_room_state(p_crew uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform _crew_room_require(p_crew);
 return _crew_room_snapshot(p_crew);
end $$;
create or replace function public.crew_room_leave(p_crew uuid,p_session uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform _crew_room_require(p_crew);
 perform pg_advisory_xact_lock(hashtextextended('crew-room:'||p_crew::text,0));
 delete from crew_room_presence where crew_id=p_crew and user_id=auth.uid() and session_id=p_session;
 perform _crew_room_reconcile(p_crew);
end $$;

create or replace function public.crew_room_send(p_crew uuid,p_scope text,p_body text,p_request uuid,p_circle uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare message_id uuid; who profiles; circle uuid; text_body text:=btrim(p_body); t timestamptz:=clock_timestamp();
begin
 perform _crew_room_require(p_crew);
 perform pg_advisory_xact_lock(hashtextextended('crew-room:'||p_crew::text,0));
 select id into message_id from crew_room_messages where crew_id=p_crew and author_id=auth.uid() and request_id=p_request;
 if found then return message_id; end if;
 if p_request is null or p_scope not in ('general','nearby') or text_body is null or char_length(text_body) not between 1 and 400 then raise exception 'invalid_message'; end if;
 if (select count(*) from crew_room_messages where author_id=auth.uid() and created_at>t-interval '10 seconds')>=6 then raise exception 'slow_down'; end if;
 perform _crew_room_reconcile(p_crew);
 if p_scope='nearby' then
   select circle_id into circle from crew_room_presence where crew_id=p_crew and user_id=auth.uid() and last_seen>t-interval '15 seconds';
   if circle is null or circle is distinct from p_circle then raise exception 'conversation_changed'; end if;
 end if;
 select * into who from profiles where id=auth.uid();
 insert into crew_room_messages(crew_id,author_id,request_id,scope,circle_id,body,author_name,author_look)
   values(p_crew,auth.uid(),p_request,p_scope,circle,text_body,coalesce(who.display_name,'A crew member'),who.avatar) returning id into message_id;
 if p_scope='nearby' then
   insert into crew_room_message_audience(message_id,user_id) select message_id,user_id from crew_room_presence where crew_id=p_crew and circle_id=circle and not public.is_blocked(auth.uid(),user_id);
 end if;
 return message_id;
end $$;

create or replace function public.crew_room_settings(p_crew uuid,p_width int,p_content jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare k text; text_value text; v jsonb; clean jsonb:='{}'; old_width int; spawn jsonb; crew_name text;
begin
 perform _crew_room_require(p_crew);
 if not exists(select 1 from crew_members where crew_id=p_crew and user_id=auth.uid() and role='owner') then raise exception 'owner_only'; end if;
 if p_width not in(30,36) or jsonb_typeof(p_content)<>'object' or pg_column_size(p_content)>20000 then raise exception 'invalid_settings'; end if;
 for k in select unnest(array['brand','strapline','musicTitle','musicUrl','audioUrl','artistTitle','artistNote']) loop
   text_value:=coalesce(p_content->>k,'');
   if jsonb_typeof(p_content->k) not in ('string','null') or char_length(text_value)>(case when k='artistNote' then 1200 when k in ('musicUrl','audioUrl') then 2000 when k='brand' then 40 else 160 end) then raise exception 'invalid_settings'; end if;
   if k in('musicUrl','audioUrl') and text_value<>'' and text_value!~'^https?://[^[:space:]]+$' then raise exception 'invalid_link'; end if;
   clean:=clean||jsonb_build_object(k,text_value);
 end loop;
 if char_length(btrim(clean->>'brand'))=0 then raise exception 'invalid_settings'; end if;
 v:=coalesce(p_content->'awards','[]');
 if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>12 then raise exception 'invalid_settings'; end if;
 for v in select * from jsonb_array_elements(v) loop
   if jsonb_typeof(v)<>'object' or coalesce(v->>'title','')='' or coalesce(v->>'year','')='' or char_length(v->>'title')>160 or char_length(v->>'detail')>1200
     or (coalesce(v->>'sourceUrl','')<>'' and v->>'sourceUrl'!~'^https?://[^[:space:]]+$') then raise exception 'invalid_settings'; end if;
 end loop;
 clean:=clean||jsonb_build_object('awards',coalesce(p_content->'awards','[]'));
 perform pg_advisory_xact_lock(hashtextextended('crew-room:'||p_crew::text,0));
 select width into old_width from crew_rooms where crew_id=p_crew;
 insert into crew_rooms(crew_id,width,content) values(p_crew,p_width,clean) on conflict(crew_id) do update set width=p_width,content=clean,version=crew_rooms.version+1,updated_at=clock_timestamp();
 if old_width is distinct from p_width then
   select data->'spawn' into spawn from crew_room_layouts where width=p_width;
   delete from crew_room_circles where crew_id=p_crew;
   update crew_room_presence set x=(spawn->>'x')::int,y=(spawn->>'y')::int,seq=0,last_moved_at=clock_timestamp(),move_credit=3,credit_at=clock_timestamp() where crew_id=p_crew;
 end if;
 return _crew_room_snapshot(p_crew);
end $$;

create or replace function public._crew_room_message_visible(p_message uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from crew_room_messages m join crew_members cm on cm.crew_id=m.crew_id and cm.user_id=auth.uid()
   where m.id=p_message and not public.is_blocked(auth.uid(),m.author_id) and (m.scope='general' or exists(select 1 from crew_room_message_audience a where a.message_id=m.id and a.user_id=auth.uid())));
$$;
create or replace function public._crew_room_peer_visible(p_crew uuid,p_user uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.is_crew_member(p_crew) and not public.is_blocked(auth.uid(),p_user);
$$;
alter table public.crew_room_layouts enable row level security;
alter table public.crew_rooms enable row level security;
alter table public.crew_room_presence enable row level security;
alter table public.crew_room_circles enable row level security;
alter table public.crew_room_messages enable row level security;
alter table public.crew_room_message_audience enable row level security;
-- Policy replacement makes reruns safe without dropping any table or data.
drop policy if exists crew_rooms_member_read on public.crew_rooms;
create policy crew_rooms_member_read on public.crew_rooms for select to authenticated using(public.is_crew_member(crew_id));
drop policy if exists crew_room_presence_member_read on public.crew_room_presence;
create policy crew_room_presence_member_read on public.crew_room_presence for select to authenticated using(public._crew_room_peer_visible(crew_id,user_id));
drop policy if exists crew_room_messages_audience_read on public.crew_room_messages;
create policy crew_room_messages_audience_read on public.crew_room_messages for select to authenticated using(public._crew_room_message_visible(id));
revoke all on public.crew_room_layouts,public.crew_rooms,public.crew_room_presence,public.crew_room_circles,public.crew_room_messages,public.crew_room_message_audience from anon,authenticated;
grant select on public.crew_rooms,public.crew_room_presence,public.crew_room_messages to authenticated;
revoke all on function public._crew_room_require(uuid),public._crew_room_walkable(int,int,int),public._crew_room_section(int,int,int),public._crew_room_area(int,int,int),public._crew_room_reconcile(uuid),public._crew_room_snapshot(uuid) from public,anon,authenticated;
revoke all on function public._crew_room_message_visible(uuid),public._crew_room_peer_visible(uuid,uuid) from public,anon;
grant execute on function public._crew_room_message_visible(uuid),public._crew_room_peer_visible(uuid,uuid) to authenticated;
revoke all on function public.crew_room_enter(uuid,uuid),public.crew_room_step(uuid,uuid,int,jsonb),public.crew_room_state(uuid),public.crew_room_leave(uuid,uuid),public.crew_room_send(uuid,text,text,uuid,uuid),public.crew_room_settings(uuid,int,jsonb) from public,anon;
grant execute on function public.crew_room_enter(uuid,uuid),public.crew_room_step(uuid,uuid,int,jsonb),public.crew_room_state(uuid),public.crew_room_leave(uuid,uuid),public.crew_room_send(uuid,text,text,uuid,uuid),public.crew_room_settings(uuid,int,jsonb) to authenticated;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='crew_room_messages') then alter publication supabase_realtime add table public.crew_room_messages; end if;
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='crew_room_presence') then alter publication supabase_realtime add table public.crew_room_presence; end if;
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='crew_rooms') then alter publication supabase_realtime add table public.crew_rooms; end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
