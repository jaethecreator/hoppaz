-- Vibes, waves and the profile key inside a crew room (supabase/crew_rails.sql). LOCAL ONLY: every fixture rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql and crew_rails.sql loaded. Ends with ALL CREW VIBE TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/crew_vibes_test.sql
begin;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$
begin
  if v is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.actor(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.newuser(guest boolean default false) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          case when guest then null else 'vibetest-' || u || '@roomtest.invalid' end, guest, '{}', '{"name":"Vibe tester"}', now(), now());
  return u;
end $$;
-- Run a vibe as a user, then move every vibe row back in time so the 3 second gap does not trip the next call.
create function pg_temp.vibe(u uuid, crew uuid, target uuid, sticker text) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.actor(u);
  r := public.crew_room_vibe(crew, target, sticker);
  perform pg_temp.admin();
  update public.crew_room_vibes set created_at = created_at - interval '10 seconds' where created_at > now() - interval '5 seconds';
  return r;
end $$;
create function pg_temp.seen(u uuid, id uuid) returns boolean language plpgsql as $$
declare s boolean;
begin
  perform pg_temp.actor(u);
  select exists (select 1 from public.crew_room_vibes where crew_room_vibes.id = seen.id) into s;
  perform pg_temp.admin();
  return s;
end $$;

do $$
declare
  a uuid := pg_temp.newuser(); b uuid := pg_temp.newuser(); c uuid := pg_temp.newuser(); e uuid := pg_temp.newuser();
  g uuid := pg_temp.newuser(true); d uuid := pg_temp.newuser();
  crew uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); sc uuid := gen_random_uuid(); sd uuid := gen_random_uuid();
  r text; v uuid; w uuid; key1 uuid; key2 uuid; i int; n int; failed text;
begin
  insert into public.crews (id, name, created_by) values (crew, 'Vibe test crew', a), (other, 'Elsewhere', d);
  insert into public.crew_members (crew_id, user_id, role)
  values (crew, a, 'owner'), (crew, b, 'member'), (crew, c, 'member'), (crew, e, 'member'), (crew, g, 'member'), (other, d, 'owner');
  perform pg_temp.actor(a); perform public.crew_room_enter(crew, sa); perform pg_temp.admin();
  perform pg_temp.actor(b); perform public.crew_room_enter(crew, sb); perform pg_temp.admin();
  perform pg_temp.actor(c); perform public.crew_room_enter(crew, sc); perform pg_temp.admin();

  -- A vibe, and who reads it.
  perform pg_temp.ok(pg_temp.vibe(a, crew, b, 'fresh') = 'sent', 'a member in the room vibes another member in the room');
  select id into v from public.crew_room_vibes where from_user = a and to_user = b;
  perform pg_temp.ok(v is not null, 'the vibe is a row: a sticker id and two people');
  perform pg_temp.ok(pg_temp.seen(b, v) and pg_temp.seen(c, v) and pg_temp.seen(a, v), 'the target, a third crew mate and the sender all read it');
  perform pg_temp.ok(not pg_temp.seen(d, v), 'someone in another crew cannot read it');

  -- The refusals.
  perform pg_temp.ok(pg_temp.vibe(a, crew, b, 'hello world') = 'bad_sticker', 'a vibe is a catalogue id, never text');
  perform pg_temp.ok(pg_temp.vibe(a, crew, b, 'wave') = 'bad_sticker', 'wave is not a sticker anyone can send by hand');
  perform pg_temp.ok(pg_temp.vibe(a, crew, a, 'fresh') = 'self', 'not to yourself');
  perform pg_temp.ok(pg_temp.vibe(a, crew, e, 'fresh') = 'gone', 'not to a crew mate who is not in the room');
  perform pg_temp.ok(pg_temp.vibe(e, crew, a, 'fresh') = 'not_in_room', 'not from someone who is not walking in the room');
  begin
    perform pg_temp.actor(d); perform public.crew_room_vibe(crew, a, 'fresh'); perform pg_temp.admin();
    failed := null;
  exception when others then failed := sqlerrm; perform pg_temp.admin();
  end;
  perform pg_temp.ok(failed like '%not_in_crew%', 'someone outside the crew is refused (not_in_crew)');
  begin
    perform pg_temp.actor(g); perform public.crew_room_vibe(crew, a, 'fresh'); perform pg_temp.admin();
    failed := null;
  exception when others then failed := sqlerrm; perform pg_temp.admin();
  end;
  perform pg_temp.ok(failed like '%need_account%', 'a guest without an account is refused (need_account)');
  -- Sender limits: 1 every 3 seconds, 3 a minute to one person.
  perform pg_temp.actor(a); r := public.crew_room_vibe(crew, c, 'omo'); perform pg_temp.admin();
  perform pg_temp.ok(r = 'sent', 'the first vibe to a second person goes');
  perform pg_temp.actor(a); r := public.crew_room_vibe(crew, c, 'omo'); perform pg_temp.admin();
  perform pg_temp.ok(r = 'slow_down', 'a second vibe inside 3 seconds is slow_down');
  update public.crew_room_vibes set created_at = created_at - interval '10 seconds';
  perform pg_temp.ok(pg_temp.vibe(a, crew, b, 'big') = 'sent', 'the second to b (a earlier vibe to b, and one to c, are 10 s old)');
  perform pg_temp.ok(pg_temp.vibe(a, crew, b, 'big') = 'sent', 'the third to b inside a minute');
  perform pg_temp.ok(pg_temp.vibe(a, crew, b, 'big') = 'same_person', 'the fourth to b inside a minute is same_person (GIVE THEM A MINUTE)');
  perform pg_temp.ok(pg_temp.vibe(a, crew, c, 'big') = 'sent', 'another person is still fine');

  -- A block either way: still "sent", nothing delivered.
  insert into public.blocks (blocker, blocked, label) values (c, b, 'B');
  select count(*) into n from public.crew_room_vibes where to_user = c;
  perform pg_temp.ok(pg_temp.vibe(b, crew, c, 'fresh') = 'sent', 'a vibe to someone who blocked you still answers sent');
  perform pg_temp.ok((select count(*) from public.crew_room_vibes where from_user = b and to_user = c) = 0, 'and delivers nothing');
  delete from public.blocks where blocker = c;

  -- Receiver limit: the sixth in a minute is stored as dropped and nobody can read it.
  delete from public.crew_room_vibes;
  for i in 1..5 loop
    insert into public.crew_room_vibes (crew_id, from_user, to_user, sticker, created_at) values (crew, c, b, 'fresh', now() - interval '20 seconds');
  end loop;
  perform pg_temp.ok(pg_temp.vibe(a, crew, b, 'fresh') = 'sent', 'a sixth vibe in a minute still answers sent');
  select id into w from public.crew_room_vibes where from_user = a and to_user = b;
  perform pg_temp.ok((select dropped from public.crew_room_vibes where id = w) and not pg_temp.seen(b, w), 'but it is dropped and the target never sees it');

  -- Waves by user id, inside the room.
  delete from public.crew_room_vibes;
  perform pg_temp.actor(a); r := public.crew_room_wave(crew, b); perform pg_temp.admin();
  perform pg_temp.ok(r = 'sent', 'a wave at a crew mate in the room is sent');
  select id into w from public.crew_room_vibes where from_user = a and to_user = b and sticker = 'wave';
  perform pg_temp.ok(w is not null and pg_temp.seen(b, w) and pg_temp.seen(a, w) and not pg_temp.seen(c, w), 'the wave tap on the shoulder is read by its two people only');
  perform pg_temp.actor(a); r := public.crew_room_wave(crew, b); perform pg_temp.admin();
  perform pg_temp.ok(r = 'already', 'a second wave is already');
  perform pg_temp.actor(b); r := public.crew_room_wave(crew, a); perform pg_temp.admin();
  perform pg_temp.ok(r like 'matched:%', 'waving back opens the DM (matched:<dm id>)');
  perform pg_temp.actor(a); r := public.crew_room_wave(crew, e); perform pg_temp.admin();
  perform pg_temp.ok(r = 'gone', 'a wave at someone who is not in the room is gone');
  perform pg_temp.actor(a); r := public.crew_room_wave(crew, d); perform pg_temp.admin();
  perform pg_temp.ok(r = 'not_met', 'a wave at someone outside the crew is not_met');
  perform pg_temp.actor(a); r := public.crew_room_wave(crew, a); perform pg_temp.admin();
  perform pg_temp.ok(r = 'self', 'not at yourself');
  insert into public.blocks (blocker, blocked, label) values (a, c, 'C');
  perform pg_temp.actor(a); r := public.crew_room_wave(crew, c); perform pg_temp.admin();
  perform pg_temp.ok(r = 'blocked', 'a wave at someone you blocked says blocked');
  delete from public.blocks where blocker = a;
  insert into public.blocks (blocker, blocked, label) values (c, a, 'A');
  perform pg_temp.actor(a); r := public.crew_room_wave(crew, c); perform pg_temp.admin();
  perform pg_temp.ok(r = 'sent' and not exists (select 1 from public.waves where from_user = a and to_user = c), 'a wave at someone who blocked you says sent and writes nothing');
  delete from public.blocks where blocker = c;

  -- The profile key: stable, opaque, and refused across a block or outside the crew.
  perform pg_temp.actor(a); key1 := public.crew_room_peer_key(crew, b); key2 := public.crew_room_peer_key(crew, b); perform pg_temp.admin();
  perform pg_temp.ok(key1 is not null and key1 = key2, 'a crew mate has one stable room key');
  perform pg_temp.ok((select user_id from public.room_identities where id = key1) = b, 'the key belongs to that person');
  perform pg_temp.actor(a); key2 := public.crew_room_peer_key(crew, d); perform pg_temp.admin();
  perform pg_temp.ok(key2 is null, 'no key for someone outside the crew');
  insert into public.blocks (blocker, blocked, label) values (b, a, 'A');
  perform pg_temp.actor(a); key2 := public.crew_room_peer_key(crew, b); perform pg_temp.admin();
  perform pg_temp.ok(key2 is null, 'no key across a block');
  raise notice 'ALL CREW VIBE TESTS PASSED';
end $$;
rollback;
