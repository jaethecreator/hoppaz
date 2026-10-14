-- LOCAL ONLY: all fixture users, crews and messages roll back.
begin;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$ begin
 if v is not true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label;
end $$;
create function pg_temp.actor(u uuid) returns void language plpgsql as $$ begin
 execute 'reset role'; perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 execute 'set local role authenticated';
end $$;
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.newuser(guest boolean default false) returns uuid language plpgsql as $$ declare u uuid:=gen_random_uuid(); begin
 insert into auth.users(id,instance_id,aud,role,email,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',case when guest then null else 'roomtest-'||u||'@roomtest.invalid' end,guest,'{}','{"name":"Room tester"}',now(),now());
 return u;
end $$;
create function pg_temp.fail_as(u uuid,q text,want text) returns void language plpgsql as $$ declare reason text; begin
 perform pg_temp.actor(u);
 begin execute q; exception when others then reason:=sqlerrm; end;
 perform pg_temp.admin();
 perform pg_temp.ok(reason like '%'||want||'%', 'rejects '||want);
end $$;
create function pg_temp.visible(u uuid,m uuid) returns boolean language plpgsql as $$ declare seen boolean; begin
 perform pg_temp.actor(u); select exists(select 1 from public.crew_room_messages where id=m) into seen; perform pg_temp.admin(); return seen;
end $$;

do $$
declare a uuid:=pg_temp.newuser(); b uuid:=pg_temp.newuser(); c uuid:=pg_temp.newuser(); d uuid:=pg_temp.newuser(); g uuid:=pg_temp.newuser(true);
 crew uuid:=gen_random_uuid(); other_crew uuid:=gen_random_uuid(); sa uuid:=gen_random_uuid(); sb uuid:=gen_random_uuid(); sc uuid:=gen_random_uuid();
 res jsonb; circle uuid; general uuid; near uuid; later uuid; req uuid:=gen_random_uuid(); body jsonb; before_x int;
begin
 insert into public.crews(id,name,created_by) values(crew,'Room test crew',a),(other_crew,'Different room',d);
 insert into public.crew_members(crew_id,user_id,role) values(crew,a,'owner'),(crew,b,'member'),(crew,c,'member'),(crew,g,'member'),(other_crew,d,'owner');
 perform pg_temp.actor(a); res:=public.crew_room_enter(crew,sa); perform pg_temp.admin();
 perform pg_temp.ok(res->'crew'->>'name'='Room test crew','crew owns a stable room');
 perform pg_temp.actor(b); perform public.crew_room_enter(crew,sb); perform pg_temp.admin();
 perform pg_temp.actor(c); perform public.crew_room_enter(crew,sc); perform pg_temp.admin();
 perform pg_temp.fail_as(d,format('select public.crew_room_enter(%L,%L)',crew,gen_random_uuid()),'not_in_crew');
 perform pg_temp.fail_as(g,format('select public.crew_room_enter(%L,%L)',crew,gen_random_uuid()),'need_account');
 perform pg_temp.fail_as(d,format('select public.crew_room_state(%L)',crew),'not_in_crew');
 perform pg_temp.fail_as(b,format('insert into public.crew_room_presence(crew_id,user_id,session_id,x,y) values(%L,%L,%L,5,5)',crew,b,gen_random_uuid()),'permission denied');
 perform pg_temp.fail_as(b,format('select public._crew_room_snapshot(%L)',crew),'permission denied');

 update public.crew_room_presence set x=case when user_id=a then 3 when user_id=b then 4 else 6 end,
   y=case when user_id=b then 6 else 4 end,last_moved_at=clock_timestamp()-interval '1 second',last_seen=clock_timestamp() where crew_id=crew;
 perform pg_temp.actor(a); res:=public.crew_room_step(crew,sa,0,'[]'); perform pg_temp.admin();
 circle:=(res->'self'->>'circle_id')::uuid;
 perform pg_temp.ok(circle is not null,'entering the same fixed area creates its conversation');
 perform pg_temp.ok((select circle_id=circle from public.crew_room_presence where crew_id=crew and user_id=b),'members inside the same area share its audience');
 perform pg_temp.ok((select circle_id is not null and circle_id<>circle from public.crew_room_presence where crew_id=crew and user_id=c),'an adjacent booth has a separate conversation');
 perform pg_temp.actor(a); general:=public.crew_room_send(crew,'general','General test',gen_random_uuid()); near:=public.crew_room_send(crew,'nearby','Nearby test',req,circle); perform pg_temp.admin();
 perform pg_temp.ok(pg_temp.visible(a,near) and pg_temp.visible(b,near),'nearby recipients can read their message');
 perform pg_temp.ok(not pg_temp.visible(c,near) and not pg_temp.visible(d,near),'far-away and other-crew users cannot read nearby messages');
 perform pg_temp.ok(pg_temp.visible(c,general),'general conversation reaches the whole crew');
 perform pg_temp.ok(not pg_temp.visible(d,general),'general history does not cross crews');
 perform pg_temp.actor(a); later:=public.crew_room_send(crew,'nearby','Nearby test',req,circle); perform pg_temp.admin();
 perform pg_temp.ok(later=near,'retrying a send does not duplicate it');
 perform pg_temp.fail_as(c,format('select public.crew_room_send(%L,%L,%L,%L,%L)',crew,'nearby','Outside attempt',gen_random_uuid(),circle),'conversation_changed');
 perform pg_temp.fail_as(a,format('select public.crew_room_send(%L,%L,%L,%L,%L)',crew,'nearby','Stale circle',gen_random_uuid(),gen_random_uuid()),'conversation_changed');

 -- Entering later must not reveal earlier nearby history.
 update public.crew_room_presence set x=4,y=4,last_moved_at=clock_timestamp()-interval '1 second' where crew_id=crew and user_id=c;
 perform pg_temp.actor(c); perform public.crew_room_step(crew,sc,0,'[]'); perform pg_temp.admin();
 perform pg_temp.ok((select circle_id=circle from public.crew_room_presence where crew_id=crew and user_id=c),'new nearby arrivals join the existing group');
 perform pg_temp.ok(not pg_temp.visible(c,near),'new arrival cannot read conversations sent before joining');
 perform pg_temp.actor(b); later:=public.crew_room_send(crew,'nearby','After arrival',gen_random_uuid(),circle); perform pg_temp.admin();
 perform pg_temp.ok(pg_temp.visible(c,later),'new arrival receives new nearby messages');
 update public.crew_room_presence set x=6,y=4,last_moved_at=clock_timestamp()-interval '1 second' where crew_id=crew and user_id=c;
 perform pg_temp.actor(c); perform public.crew_room_step(crew,sc,0,'[]'); perform pg_temp.admin();
 perform pg_temp.actor(b); later:=public.crew_room_send(crew,'nearby','After leaving',gen_random_uuid(),circle); perform pg_temp.admin();
 perform pg_temp.ok(not pg_temp.visible(c,later),'walking away stops new nearby messages');

 -- Blocks hide people and messages without moving the shared area boundary.
 insert into public.blocks(blocker,blocked,label) values(a,b,'Test member');
 perform public._crew_room_reconcile(crew);
 perform pg_temp.actor(a); later:=public.crew_room_send(crew,'nearby','Blocked audience test',gen_random_uuid(),circle); perform pg_temp.admin();
 perform pg_temp.ok(not exists(select 1 from public.crew_room_message_audience where message_id=later and user_id=b),'blocked members are excluded from new message audiences');
 perform pg_temp.ok(not pg_temp.visible(b,near),'blocked authors no longer expose message history');
 perform pg_temp.actor(a); res:=public.crew_room_state(crew); perform pg_temp.admin();
 perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(res->'peers') p where p->>'id'=b::text),'blocked peers are hidden in room snapshots');
 perform pg_temp.actor(a); select count(*) into before_x from public.crew_room_presence where crew_id=crew and user_id=b; perform pg_temp.admin();
 perform pg_temp.ok(before_x=0,'presence reads also respect blocks');
 delete from public.blocks where blocker=a and blocked=b;

 -- Adjacent private areas remain separate even when avatars stand one tile apart.
 update public.crew_room_presence set circle_id=null,x=case when user_id=a then 4 else 5 end,y=4,last_moved_at=clock_timestamp()-interval '1 second' where crew_id=crew and user_id in(a,b);
 perform public._crew_room_reconcile(crew);
 perform pg_temp.ok((select count(distinct circle_id)=2 from public.crew_room_presence where crew_id=crew and user_id in(a,b)),'adjacent booths do not share a conversation');

 -- Occupants can roam inside a large area regardless of distance.
 update public.crew_room_presence set x=case when user_id=a then 3 else 6 end,y=case when user_id=a then 13 else 17 end,last_seen=clock_timestamp() where crew_id=crew and user_id in(a,b);
 perform public._crew_room_reconcile(crew);
 select circle_id into circle from public.crew_room_presence where crew_id=crew and user_id=a;
 perform pg_temp.ok((select circle_id=circle from public.crew_room_presence where crew_id=crew and user_id=b),'people far apart in one area still share its conversation');
 update public.crew_room_presence set x=5,y=16 where crew_id=crew and user_id=a;
 perform public._crew_room_reconcile(crew);
 perform pg_temp.ok((select circle_id=circle from public.crew_room_presence where crew_id=crew and user_id=a),'walking inside an area preserves its conversation');
 update public.crew_room_presence set x=15,y=12 where crew_id=crew and user_id=a;
 perform public._crew_room_reconcile(crew);
 perform pg_temp.ok((select circle_id=circle from public.crew_room_presence where crew_id=crew and user_id=b),'one person remaining keeps an area conversation open');
 update public.crew_room_presence set x=16,y=12 where crew_id=crew and user_id=b;
 perform public._crew_room_reconcile(crew);
 perform pg_temp.ok((select count(*)=0 from public.crew_room_presence where crew_id=crew and user_id in(a,b) and circle_id is not null),'public-space neighbours do not form moving groups');
 perform pg_temp.ok(not exists(select 1 from public.crew_room_circles where id=circle),'an empty area ends its conversation session');

 update public.crew_room_presence set x=15,y=12,seq=0,move_credit=3,credit_at=clock_timestamp(),last_seen=clock_timestamp() where crew_id=crew and user_id=a;
 perform pg_temp.fail_as(a,format('select public.crew_room_step(%L,%L,1,%L)',crew,sa,'[{"x":24,"y":14}]'),'invalid_movement');
 perform pg_temp.fail_as(a,format('select public.crew_room_step(%L,%L,2,%L)',crew,sa,'[{"x":15,"y":11}]'),'invalid_sequence');
 perform pg_temp.fail_as(a,format('select public.crew_room_step(%L,%L,1,%L)',crew,sa,'[{"x":15,"y":11},{"x":15,"y":10}]'),'invalid_movement');
 perform pg_temp.ok((select x=15 and y=12 from public.crew_room_presence where crew_id=crew and user_id=a),'failed movement leaves the server position unchanged');
 perform pg_temp.actor(a); res:=public.crew_room_step(crew,sa,1,'[{"x":16,"y":12},{"x":17,"y":12},{"x":17,"y":13}]'); perform pg_temp.admin();
 perform pg_temp.ok(res->'self'->>'x'='17' and res->'self'->>'y'='13','ordered walkable steps are accepted');
 perform pg_temp.actor(a); res:=public.crew_room_step(crew,sa,1,'[{"x":18,"y":13}]'); perform pg_temp.admin();
 perform pg_temp.ok(res->'self'->>'x'='17','duplicate movement batch is idempotent');
 perform pg_temp.fail_as(a,format('select public.crew_room_step(%L,%L,2,%L)',crew,sa,'[{"x":18,"y":13},{"x":19,"y":13},{"x":19,"y":14}]'),'moving_too_fast');
 perform pg_temp.fail_as(a,format('select public.crew_room_step(%L,%L,2,%L)',crew,gen_random_uuid(),'[]'),'room_session_expired');

 select content into body from public.crew_rooms where crew_id=crew;
 perform pg_temp.fail_as(b,format('select public.crew_room_settings(%L,36,%L)',crew,body),'owner_only');
 perform pg_temp.fail_as(a,format('select public.crew_room_settings(%L,30,%L)',crew,body||'{"musicUrl":"javascript:alert(1)"}'::jsonb),'invalid_link');
 perform pg_temp.actor(a); res:=public.crew_room_settings(crew,36,body); perform pg_temp.admin();
 perform pg_temp.ok(res->'room'->>'width'='36','owner settings are shared by the crew');
 perform pg_temp.ok((select count(*)=3 from public.crew_room_presence where crew_id=crew and x=18 and y=17 and seq=0),'width change safely repositions every member');
 update public.crew_room_presence set last_seen=clock_timestamp()-interval '1 minute' where crew_id=crew and user_id=c;
 perform pg_temp.actor(a); res:=public.crew_room_step(crew,sa,0,'[]'); perform pg_temp.admin();
 perform pg_temp.ok(jsonb_array_length(res->'peers')=2,'disconnected avatars expire');
 perform pg_temp.actor(b); perform public.crew_room_leave(crew,sb); perform pg_temp.admin();
 perform pg_temp.ok((select count(*)=1 from public.crew_room_presence where crew_id=crew),'leaving removes only that room session');
 delete from public.crew_members where crew_id=crew and user_id=b;
 perform pg_temp.ok(not pg_temp.visible(b,general),'revoked crew membership loses general message access');
 perform pg_temp.ok(not pg_temp.visible(b,near),'revoked crew membership loses nearby history access');
 raise notice 'ALL CREW ROOM TESTS PASSED';
end $$;
rollback;
