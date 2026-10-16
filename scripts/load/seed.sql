-- ============================================================================
-- Load test seed: 150 throwaway Hoppers, one open crew and its room, and a live
-- Game Time with 10 boxes. LOCAL OR THROWAWAY DATABASES ONLY. Never production.
--
-- Everything it makes is easy to spot and to remove (cleanup.sql):
--   users   load-001@load.invalid .. load-150@load.invalid, ids 10ad0000-0000-4000-8000-000000000NNN
--   crew    "Load Test Crew", id 10ad0000-0000-4000-8000-c00000000001
--   game    "Load test hunt", campaign key load-test (reset by running this file again)
-- It touches no other crew, game or user. Safe to run again: the hunt starts over.
-- Usage (the throwaway copy from scripts/load/README.md):
--   docker exec -i hoppaz-load-db psql -U postgres -d load -v ON_ERROR_STOP=1 < scripts/load/seed.sql
-- ============================================================================
begin;

-- The users. Confirmed email: has_account() and the Game Time "need_confirmed" check both pass.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'authenticated', 'authenticated', format('load-%s@load.invalid', lpad(n::text, 3, '0')), now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now()
  from generate_series(1, 150) n
on conflict (id) do nothing;

-- A real-sized look (the avatar jsonb is most of a peer's bytes in a room snapshot).
update public.profiles
   set display_name = 'Load ' || right(id::text, 3),
       avatar = jsonb_build_object('v', 1, 'top', 'oc-kaftan', 'body', 'curvy', 'ears', 'hoops', 'eyes', 'happy',
                'hair', 'braids', 'head', null, 'lips', 'tint', 'neck', 'chain', 'skin', 1 + (right(id::text, 1)::int % 5),
                'beard', 'none', 'frame', 'female', 'mouth', 'smile', 'shoes', 'fh-loafers', 'bottom', 'oc-trousers',
                'glasses', 'none', 'eyeColor', 1, 'hairColor', 1)
 where id::text like '10ad0000-0000-4000-8000-000000000%';

insert into public.crews (id, name, created_by, visibility)
values ('10ad0000-0000-4000-8000-c00000000001', 'Load Test Crew', '10ad0000-0000-4000-8000-000000000001', 'open')
on conflict (id) do nothing;

insert into public.crew_members (crew_id, user_id, role, joined_at)
select '10ad0000-0000-4000-8000-c00000000001', ('10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       case when n = 1 then 'owner' else 'member' end, now() - interval '1 day'
  from generate_series(1, 150) n
on conflict do nothing;

-- The room: the 360Playlist template and width, room for everyone.
insert into public.crew_rooms (crew_id, width, template, capacity, content)
values ('10ad0000-0000-4000-8000-c00000000001', 30, 'clubhouse', 200,
        jsonb_build_object('brand', 'Load Test', 'strapline', 'Your crew. Your music. Your space.', 'musicTitle', '', 'musicUrl', '',
                           'audioUrl', '', 'artistTitle', '', 'artistNote', '', 'awards', '[]'::jsonb))
on conflict (crew_id) do update set capacity = 200, width = 30, template = 'clubhouse';

-- A clean room and a fresh hunt each run.
delete from public.crew_room_presence where crew_id = '10ad0000-0000-4000-8000-c00000000001';
delete from public.crew_room_circles where crew_id = '10ad0000-0000-4000-8000-c00000000001';
delete from public.crew_room_messages where crew_id = '10ad0000-0000-4000-8000-c00000000001';
delete from public.game_time_wins where campaign_key = 'load-test';
delete from public.game_times where crew_id = '10ad0000-0000-4000-8000-c00000000001';
delete from public.game_time_rate where user_id::text like '10ad0000-0000-4000-8000-000000000%';

insert into public.game_times (id, crew_id, title, opens_at, closes_at, campaign_key, room_template, room_width,
                               relocate_minutes, push_sent_at, push_count)
values ('10ad0000-0000-4000-8000-a00000000001', '10ad0000-0000-4000-8000-c00000000001', 'Load test hunt',
        now() - interval '1 minute', now() + interval '3 hours', 'load-test', 'clubhouse', 30, 10, now(), 0);

-- The hiding places: every solid object of the template (what staff pick in /admin).
insert into public.game_time_spots (game_id, object_id, x, y, w, h)
select '10ad0000-0000-4000-8000-a00000000001', b->>'id', (b->>'x')::int, (b->>'y')::int, (b->>'w')::int, (b->>'h')::int
  from public.crew_room_layouts l, jsonb_array_elements(l.data->'blocks') b
 where l.template = 'clubhouse' and l.width = 30 and b ? 'id' and coalesce((b->>'solid')::boolean, false);

-- 10 boxes on 10 random objects.
insert into public.game_time_boxes (game_id, code, spot_id)
select '10ad0000-0000-4000-8000-a00000000001', 'LOAD-' || row_number() over (), object_id
  from (select object_id from public.game_time_spots where game_id = '10ad0000-0000-4000-8000-a00000000001' order by random() limit 10) s;

commit;
select (select count(*) from public.crew_members where crew_id = '10ad0000-0000-4000-8000-c00000000001') as members,
       (select count(*) from public.game_time_spots where game_id = '10ad0000-0000-4000-8000-a00000000001') as spots,
       (select count(*) from public.game_time_boxes where game_id = '10ad0000-0000-4000-8000-a00000000001') as boxes;
