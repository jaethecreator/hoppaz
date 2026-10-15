-- Crew = friends (supabase/crew_friends.sql): the mutual wave, MESSAGE, POKE and unread. LOCAL ONLY: every fixture rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql, crew_rails.sql and crew_friends.sql loaded. Ends with ALL CREW FRIENDS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < supabase/tests/crew_friends_test.sql
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
create function pg_temp.newuser(guest boolean default false, shown text default null) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          case when guest then null else 'friendtest-' || u || '@roomtest.invalid' end, guest, '{}',
          json_build_object('name', coalesce(shown, 'Friend tester'))::jsonb, now(), now());
  if shown is not null then update public.profiles set display_name = shown where id = u; end if;
  return u;
end $$;
-- Run a wave as a user and say what came back.
create function pg_temp.hi(u uuid, crew uuid, target uuid) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.actor(u);
  r := public.crew_friend_wave(crew, target);
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.poke(u uuid, target uuid) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.actor(u);
  r := public.crew_friend_poke(target);
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.msg(u uuid, target uuid) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.actor(u);
  r := public.crew_friend_open_dm(target);
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.inbox(u uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(u);
  r := public.crew_friend_inbox();
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.mutual(a uuid, b uuid) returns boolean language sql as $$
  select exists (select 1 from public.crew where user_id = a and friend_id = b)
     and exists (select 1 from public.crew where user_id = b and friend_id = a);
$$;
create function pg_temp.dms_between(x uuid, y uuid) returns int language sql as $$
  select count(*)::int from public.dms where least(dms.a, dms.b) = least(x, y) and greatest(dms.a, dms.b) = greatest(x, y);
$$;
create function pg_temp.drop_dm(x uuid, y uuid) returns void language sql as $$
  delete from public.dms where least(dms.a, dms.b) = least(x, y) and greatest(dms.a, dms.b) = greatest(x, y);
$$;
create function pg_temp.dm_first(dm_id uuid, x uuid) returns boolean language sql as $$
  select dms.a = x from public.dms where dms.id = dm_id;
$$;
create function pg_temp.sees(u uuid, ping uuid) returns boolean language plpgsql as $$
declare s boolean;
begin
  perform pg_temp.actor(u);
  select exists (select 1 from public.crew_pings where crew_pings.id = sees.ping) into s;
  perform pg_temp.admin();
  return s;
end $$;

do $$
declare
  a uuid := pg_temp.newuser(false, 'Ada Test'); b uuid := pg_temp.newuser(false, 'Ben Test');
  c uuid := pg_temp.newuser(false, 'Chi Test'); e uuid := pg_temp.newuser(); d uuid := pg_temp.newuser();
  g uuid := pg_temp.newuser(true);
  crew uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); sc uuid := gen_random_uuid();
  r text; dm1 uuid; dm2 uuid; n int; j jsonb; w uuid; p uuid; i int;
begin
  insert into public.crews (id, name, created_by) values (crew, 'Friends test crew', a), (other, 'Elsewhere', d);
  insert into public.crew_members (crew_id, user_id, role)
  values (crew, a, 'owner'), (crew, b, 'member'), (crew, c, 'member'), (crew, e, 'member'), (crew, g, 'member'), (other, d, 'owner');
  perform pg_temp.actor(a); perform public.crew_room_enter(crew, sa); perform pg_temp.admin();
  perform pg_temp.actor(b); perform public.crew_room_enter(crew, sb); perform pg_temp.admin();
  perform pg_temp.actor(c); perform public.crew_room_enter(crew, sc); perform pg_temp.admin();

  -- Strangers cannot DM, poke or be asked to.
  perform pg_temp.ok(pg_temp.msg(a, b) = 'not_crew', 'MESSAGE before crew is not_crew: only crew can DM');
  perform pg_temp.ok(pg_temp.poke(a, b) = 'not_crew', 'POKE before crew is not_crew');

  -- SAY HI is a request.
  perform pg_temp.ok(pg_temp.hi(a, crew, b) = 'sent', 'SAY HI to someone who is not crew is a request (sent)');
  perform pg_temp.ok(not pg_temp.mutual(a, b), 'a request alone makes no crew');
  perform pg_temp.ok(pg_temp.dms_between(a, b) = 0, 'a request opens no chat');
  perform pg_temp.ok(pg_temp.hi(a, crew, b) = 'already', 'a second SAY HI is already');
  perform pg_temp.ok(pg_temp.msg(a, b) = 'not_crew', 'still no MESSAGE while it is only a request');
  -- they only see it as a wave waiting, with the name the room showed
  j := pg_temp.inbox(b);
  perform pg_temp.ok(jsonb_array_length(j -> 'waves') = 1, 'the request waits for them in the inbox');
  perform pg_temp.ok(j -> 'waves' -> 0 ->> 'name' = 'Ada Test' and (j -> 'waves' -> 0 ->> 'room')::boolean, 'the wave carries the room name and says it is a room wave');
  perform pg_temp.ok(j -> 'waves' -> 0 ->> 'where' = 'Friends test crew', 'and the crew it came from');
  perform pg_temp.ok(jsonb_array_length(pg_temp.inbox(a) -> 'waves') = 0, 'the sender has no wave waiting');

  -- WAVE BACK: crew, both ways, and a chat.
  r := pg_temp.hi(b, crew, a);
  perform pg_temp.ok(r like 'crew:%', 'waving back answers crew:<dm id>');
  dm1 := substr(r, 6)::uuid;
  perform pg_temp.ok(pg_temp.mutual(a, b), 'crew rows both ways');
  perform pg_temp.ok((select status from public.waves where from_user = a and to_user = b) = 'accepted', 'the request is accepted');
  perform pg_temp.ok((select count(*) from public.dms where id = dm1) = 1, 'the chat exists');
  perform pg_temp.ok(pg_temp.dm_first(dm1, a), 'the first waver is side a of the chat');
  select id into p from public.crew_pings where from_user = b and to_user = a and kind = 'crew';
  perform pg_temp.ok(p is not null, 'the first waver gets a crew ping');
  perform pg_temp.ok(pg_temp.sees(a, p) and pg_temp.sees(b, p) and not pg_temp.sees(c, p), 'only the two can read it');
  perform pg_temp.ok(exists (select 1 from public.crew_room_vibes where from_user = a and to_user = b and sticker = 'wave'), 'the request itself was a tap on the shoulder in the room');
  perform pg_temp.ok(pg_temp.hi(a, crew, b) = 'crew:' || dm1::text, 'the first waver tapping SAY HI again gets the same chat');
  perform pg_temp.ok(pg_temp.hi(b, crew, a) = 'crew:' || dm1::text, 'and so does the other');
  j := pg_temp.inbox(a);
  perform pg_temp.ok(jsonb_array_length(j -> 'waves') = 0 and jsonb_array_length(j -> 'crew') = 1, 'the inbox shows one crew face and no wave');
  perform pg_temp.ok(j -> 'crew' -> 0 ->> 'name' = 'Ben Test' and (j -> 'crew' -> 0 ->> 'dm')::uuid = dm1, 'the crew face has the room name and the chat id');
  perform pg_temp.ok(j -> 'dms' -> 0 ->> 'other_name' = 'Ben Test' and (j -> 'dms' -> 0 ->> 'crew')::boolean, 'a room chat shows the room name, not the handle');
  perform pg_temp.ok((j -> 'dms' -> 0 ->> 'revealed')::boolean, 'and counts as known');

  -- MESSAGE and POKE for crew.
  perform pg_temp.ok(pg_temp.msg(a, b) = 'dm:' || dm1::text, 'MESSAGE for crew is the chat');
  perform pg_temp.ok(pg_temp.poke(a, b) = 'sent', 'POKE for crew is sent');
  select id into p from public.crew_pings where from_user = a and to_user = b and kind = 'poke';
  perform pg_temp.ok(p is not null and pg_temp.sees(b, p) and pg_temp.sees(a, p) and not pg_temp.sees(c, p), 'a poke is read by its two people only');
  perform pg_temp.ok(pg_temp.poke(a, b) = 'slow_down', 'a second poke inside a minute is slow_down');
  update public.crew_pings set created_at = created_at - interval '2 minutes';
  perform pg_temp.ok(pg_temp.poke(a, b) = 'sent', 'a poke a minute later goes');
  update public.crew_pings set created_at = now() - interval '2 hours' where kind = 'poke';
  for i in 1..28 loop
    insert into public.crew_pings (from_user, to_user, kind, created_at) values (a, c, 'poke', now() - interval '3 hours');
  end loop;
  perform pg_temp.ok(pg_temp.poke(a, b) = 'daily', 'the 31st poke in a day is daily');
  perform pg_temp.ok(pg_temp.poke(a, a) = 'self', 'not yourself');
  perform pg_temp.ok(pg_temp.poke(a, c) = 'not_crew', 'not someone who is not crew (c only waved at by nobody)');
  delete from public.crew_pings;

  -- Block either way: still "sent", nothing delivered.
  insert into public.blocks (blocker, blocked, label) values (b, a, 'A');
  perform pg_temp.ok(pg_temp.poke(a, b) = 'sent', 'a poke at someone who blocked you answers sent');
  perform pg_temp.ok(not exists (select 1 from public.crew_pings where from_user = a and to_user = b), 'and delivers nothing');
  perform pg_temp.ok(pg_temp.msg(a, b) = 'not_crew', 'MESSAGE across their block says not_crew, not that they blocked you');
  delete from public.blocks where blocker = b;
  insert into public.blocks (blocker, blocked, label) values (a, b, 'B');
  perform pg_temp.ok(pg_temp.msg(a, b) = 'blocked' and pg_temp.poke(a, b) = 'blocked', 'my own block says blocked');
  delete from public.blocks where blocker = a;

  -- A one-way old crew row unlocks nothing.
  insert into public.crew (user_id, friend_id) values (a, c);
  perform pg_temp.ok(pg_temp.msg(a, c) = 'not_crew', 'a one-way ADD TO CREW row does not unlock MESSAGE');
  perform pg_temp.ok(pg_temp.poke(a, c) = 'not_crew', 'nor POKE');
  perform pg_temp.ok(jsonb_array_length(pg_temp.inbox(a) -> 'crew') = 1, 'nor does it show among the crew faces');
  -- Waves in a room with a one-way row in place: c waves back and it is mutual.
  perform pg_temp.ok(pg_temp.hi(c, crew, a) = 'sent', 'c waves at a (a has c one-way)');
  perform pg_temp.ok(not pg_temp.mutual(a, c), 'still not crew until the wave is answered');
  r := pg_temp.hi(a, crew, c);
  perform pg_temp.ok(r like 'crew:%' and pg_temp.mutual(a, c), 'a waves back: crew both ways even with the old row');
  dm2 := substr(r, 6)::uuid;
  perform pg_temp.ok(dm2 <> dm1, 'a different chat for a different pair');
  delete from public.crew where user_id in (a, b, c) or friend_id in (a, b, c);
  delete from public.waves where from_user in (a, b, c) or to_user in (a, b, c);
  delete from public.dms where id in (dm1, dm2);

  -- The refusals of the room wave.
  perform pg_temp.ok(pg_temp.hi(a, crew, e) = 'sent', 'a first wave at someone who is away from the room is sent: it waits in their inbox');
  perform pg_temp.ok(not exists (select 1 from public.crew_room_vibes where from_user = a and to_user = e), 'with no live tap, they are not there to feel it');
  perform pg_temp.ok(jsonb_array_length(pg_temp.inbox(e) -> 'waves') = 1, 'and the wave is in their inbox');
  delete from public.waves where from_user = a and to_user = e;
  perform pg_temp.ok(pg_temp.hi(a, crew, d) = 'not_met', 'a wave at someone outside the crew is not_met');
  perform pg_temp.ok(pg_temp.hi(a, crew, a) = 'self', 'not at yourself');
  perform pg_temp.actor(g); r := public.crew_friend_wave(crew, a); perform pg_temp.admin();
  perform pg_temp.ok(r = 'need_account', 'a guest without an account is refused (need_account)');
  insert into public.blocks (blocker, blocked, label) values (a, c, 'C');
  perform pg_temp.ok(pg_temp.hi(a, crew, c) = 'blocked', 'a wave at someone you blocked says blocked');
  delete from public.blocks where blocker = a;
  insert into public.blocks (blocker, blocked, label) values (c, a, 'A');
  perform pg_temp.ok(pg_temp.hi(a, crew, c) = 'sent' and not exists (select 1 from public.waves where from_user = a and to_user = c),
                     'a wave at someone who blocked you says sent and writes nothing');
  delete from public.blocks where blocker = c;
  -- The 30 a day limit counts the same waves table.
  for i in 1..30 loop
    insert into public.waves (from_user, to_user, event_id, from_alias, to_alias, created_at)
    values (c, pg_temp.newuser(), null, 'x', 'y', now() - interval '1 hour');
  end loop;
  perform pg_temp.ok(pg_temp.hi(c, crew, b) = 'slow_down', 'the 31st first wave in a day is slow_down');
  delete from public.waves where from_user = c;

  -- WAVE BACK from the Chat tab, with the sender gone from the room. Room wave: crew.
  delete from public.crew_room_vibes where crew_id = crew;
  perform pg_temp.ok(pg_temp.hi(c, crew, b) = 'sent', 'c waves at b');
  delete from public.crew_room_presence where crew_id = crew and user_id = c;
  select id into w from public.waves where from_user = c and to_user = b;
  perform pg_temp.actor(b); r := public.crew_friend_respond(w, true); perform pg_temp.admin();
  perform pg_temp.ok(r like 'crew:%' and pg_temp.mutual(b, c), 'WAVE BACK from the Chat tab makes crew without the sender in the room');
  perform pg_temp.actor(b); r := public.crew_friend_respond(w, true); perform pg_temp.admin();
  perform pg_temp.ok(r = 'gone', 'answering the same wave twice is gone');
  delete from public.crew where user_id in (b, c);
  perform pg_temp.drop_dm(b, c);
  delete from public.waves where from_user in (b, c);
  -- PASS is quiet and permanent.
  perform pg_temp.ok(pg_temp.hi(c, crew, b) = 'sent', 'c waves at b again');
  select id into w from public.waves where from_user = c and to_user = b;
  perform pg_temp.actor(b); r := public.crew_friend_respond(w, false); perform pg_temp.admin();
  perform pg_temp.ok(r = 'passed' and not pg_temp.mutual(b, c), 'PASS makes nothing');
  perform pg_temp.ok(pg_temp.hi(b, crew, c) = 'already', 'and there is no second try either way');
  delete from public.waves where from_user in (b, c);

  -- An event wave keeps the old rule: a chat, no crew rows.
  declare ev uuid; ew uuid; begin
    select id into ev from public.events limit 1;
    if ev is not null then
      insert into public.waves (from_user, to_user, event_id, from_alias, to_alias)
      values (a, b, ev, 'a', 'b') returning id into ew;
      perform pg_temp.actor(b); r := public.crew_friend_respond(ew, true); perform pg_temp.admin();
      perform pg_temp.ok(r like 'dm:%' and not pg_temp.mutual(a, b), 'an event room wave opens a chat and writes no crew rows (as before)');
      delete from public.dms where id = substr(r, 4)::uuid;
      delete from public.waves where id = ew;
    else
      raise notice 'SKIP: no event row to hang an event wave on';
    end if;
  end;

  -- Unread.
  perform pg_temp.ok(pg_temp.hi(a, crew, b) = 'sent', 'a waves at b again for the chat');
  r := pg_temp.hi(b, crew, a);
  dm1 := substr(r, 6)::uuid;
  perform pg_temp.ok((pg_temp.inbox(b) ->> 'unread')::int = 0, 'a new chat has nothing unread');
  -- (one transaction here, so now() is the same instant for the chat and its messages: the clock tells them apart)
  insert into public.dm_messages (dm_id, from_a, body, created_at) values (dm1, true, 'hello', clock_timestamp());
  insert into public.dm_messages (dm_id, from_a, body, created_at) values (dm1, true, 'you there?', clock_timestamp());
  perform pg_temp.ok((pg_temp.inbox(b) ->> 'unread')::int = 2, 'two messages from a are two unread for b');
  perform pg_temp.ok((pg_temp.inbox(a) ->> 'unread')::int = 0, 'and none for a, who sent them');
  j := pg_temp.inbox(b);
  perform pg_temp.ok((j -> 'dms' -> 0 ->> 'unread')::int = 2 and (j -> 'crew' -> 0 ->> 'unread')::int = 2, 'the chat row and the crew face both carry it');
  perform pg_temp.ok(j -> 'dms' -> 0 ->> 'last_body' = 'you there?', 'with the last line');
  perform pg_temp.actor(b); perform public.crew_friend_read(dm1); perform pg_temp.admin();
  perform pg_temp.ok((pg_temp.inbox(b) ->> 'unread')::int = 0, 'reading the chat clears it');
  insert into public.dm_messages (dm_id, from_a, body, created_at) values (dm1, false, 'b says hi', clock_timestamp());
  perform pg_temp.ok((pg_temp.inbox(a) ->> 'unread')::int = 1 and (pg_temp.inbox(b) ->> 'unread')::int = 0, 'a message from b is unread for a only');
  perform pg_temp.actor(c); perform public.crew_friend_read(dm1); perform pg_temp.admin();
  perform pg_temp.ok(not exists (select 1 from public.dm_reads where user_id = c and dm_id = dm1), 'someone outside the chat cannot mark it read');
  perform pg_temp.actor(a); perform public.crew_friend_read(dm1);
  select count(*) into n from public.dm_reads where dm_id = dm1;
  perform pg_temp.admin();
  perform pg_temp.ok(n = 1 and (select count(*) from public.dm_reads where dm_id = dm1) = 2, 'a person sees only their own read row');

  -- The owner and admins panel.
  perform pg_temp.actor(b); j := public.crew_friend_staff(crew); perform pg_temp.admin();
  perform pg_temp.ok(jsonb_array_length(j) = 1 and j -> 0 ->> 'role' = 'owner' and j -> 0 ->> 'name' = 'Ada Test', 'a member reads the owner, with the name the room shows');
  perform pg_temp.ok(not (j -> 0 ->> 'me')::boolean and (j -> 0 ->> 'crew')::boolean, 'not me, and my crew (we are crew by now): MESSAGE');
  perform pg_temp.actor(c); j := public.crew_friend_staff(crew); perform pg_temp.admin();
  perform pg_temp.ok(not (j -> 0 ->> 'me')::boolean and not (j -> 0 ->> 'crew')::boolean, 'for someone who is not crew with the owner: SAY HI');
  perform pg_temp.actor(a); j := public.crew_friend_staff(crew); perform pg_temp.admin();
  perform pg_temp.ok((j -> 0 ->> 'me')::boolean, 'the owner sees themselves marked');
  perform pg_temp.actor(d); j := public.crew_friend_staff(crew); perform pg_temp.admin();
  perform pg_temp.ok(jsonb_array_length(j) = 0, 'someone outside the room reads nothing');
  insert into public.blocks (blocker, blocked, label) values (b, a, 'A');
  perform pg_temp.actor(b); j := public.crew_friend_staff(crew); perform pg_temp.admin();
  perform pg_temp.ok(jsonb_array_length(j) = 0, 'a blocked owner is left out');
  delete from public.blocks where blocker = b;

  -- SHOW ME ON THE MAP: off until I say so, mine alone, and being crew does not change it.
  perform pg_temp.ok(not (pg_temp.inbox(a) ->> 'on_map')::boolean, 'the map switch is off by default');
  perform pg_temp.actor(a); perform public.crew_friend_map(true);
  r := (select count(*)::text from public.crew_map_share);
  perform pg_temp.admin();
  perform pg_temp.ok((pg_temp.inbox(a) ->> 'on_map')::boolean, 'turning it on is remembered');
  perform pg_temp.ok(not (pg_temp.inbox(b) ->> 'on_map')::boolean, 'and is nobody else''s');
  perform pg_temp.ok(r = '1', 'a person reads only their own switch row');
  perform pg_temp.actor(g);
  r := coalesce(public.crew_friend_map(true)::text, 'null');
  perform pg_temp.admin();
  perform pg_temp.ok(r = 'null', 'a guest without an account has no switch');
  perform pg_temp.actor(a); perform public.crew_friend_map(false); perform pg_temp.admin();
  perform pg_temp.ok(not (pg_temp.inbox(a) ->> 'on_map')::boolean, 'and it turns off again');

  -- Old chats keep working: a chat made the old way between two non-crew people is still listed, as before.
  delete from public.crew where user_id in (a, b) or friend_id in (a, b);
  j := pg_temp.inbox(a);
  perform pg_temp.ok(jsonb_array_length(j -> 'dms') = 1 and not (j -> 'dms' -> 0 ->> 'crew')::boolean, 'an old chat with no crew rows is still listed, not marked crew');
  perform pg_temp.ok(jsonb_array_length(j -> 'crew') = 0, 'and there is no crew face for it');
  raise notice 'ALL CREW FRIENDS TESTS PASSED';
end $$;
rollback;
