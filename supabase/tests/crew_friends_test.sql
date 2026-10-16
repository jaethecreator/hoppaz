-- Crew = friends (supabase/crew_friends.sql): the mutual wave, MESSAGE, POKE and unread, the backfill of room waves answered
-- the old way (launch night), and REMOVE FROM CREW. LOCAL ONLY: every fixture rolls back.
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
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Launch night: room waves answered the old way (crew_room_wave) wrote an accepted wave and a chat, and no crew rows. The
-- backfill (public._cf_backfill_room_waves, run at the end of crew_friends.sql) makes crew of them; REMOVE FROM CREW undoes crew.
-- The file itself is not run again here (it has its own begin and commit); the backfill function is what it calls.
create function pg_temp.old_wave(u uuid, room uuid, target uuid) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.actor(u);
  r := public.crew_room_wave(room, target);
  perform pg_temp.admin();
  return r;
end $$;
-- Launch night's two taps: SAY HI, then the other one's SAY HI back. Returns the chat id.
create function pg_temp.old_match(a uuid, b uuid, room uuid) returns uuid language plpgsql as $$
declare r text;
begin
  if pg_temp.old_wave(a, room, b) <> 'sent' then raise exception 'FAILED: old wave not sent'; end if;
  r := pg_temp.old_wave(b, room, a);
  if r not like 'matched:%' then raise exception 'FAILED: old wave back answered %', r; end if;
  return substr(r, 9)::uuid;
end $$;
create function pg_temp.rm(u uuid, target uuid) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.actor(u);
  r := public.crew_friend_remove(target);
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.crew_rows(x uuid, y uuid) returns int language sql as $$
  select count(*)::int from public.crew where (user_id = x and friend_id = y) or (user_id = y and friend_id = x);
$$;
-- Is `other` among the crew faces u reads in the Chat tab?
create function pg_temp.listed(u uuid, other uuid) returns boolean language plpgsql as $$
declare j jsonb;
begin
  j := pg_temp.inbox(u);
  return exists (select 1 from jsonb_array_elements(j -> 'crew') f where (f ->> 'id')::uuid = other);
end $$;

do $$
declare
  ada uuid := pg_temp.newuser(false, 'Bf Ada'); ben uuid := pg_temp.newuser(false, 'Bf Ben');     -- launch night pair
  chi uuid := pg_temp.newuser(false, 'Bf Chi'); dayo uuid := pg_temp.newuser(false, 'Bf Dayo');   -- accepted event wave
  efe uuid := pg_temp.newuser(false, 'Bf Efe'); femi uuid := pg_temp.newuser(false, 'Bf Femi');   -- efe blocked femi
  gio uuid := pg_temp.newuser(false, 'Bf Gio'); hana uuid := pg_temp.newuser(false, 'Bf Hana');   -- hana blocked gio
  ife uuid := pg_temp.newuser(false, 'Bf Ife'); jide uuid := pg_temp.newuser(false, 'Bf Jide');   -- remove
  kemi uuid := pg_temp.newuser(false, 'Bf Kemi'); lola uuid := pg_temp.newuser(false, 'Bf Lola'); -- kemi: a third friend; lola: no one
  room uuid := gen_random_uuid(); ev uuid;
  r text; n int; n_rows int; j jsonb; dm_ab uuid; dm_ij uuid; who uuid;
begin
  insert into public.crews (id, name, created_by) values (room, 'Backfill test crew', ada);
  insert into public.crew_members (crew_id, user_id, role)
  select room, u, case when u = ada then 'owner' else 'member' end
    from unnest(array[ada, ben, chi, dayo, efe, femi, gio, hana, ife, jide, kemi, lola]) u;
  for who in select unnest(array[ada, ben, chi, dayo, efe, femi, gio, hana, ife, jide, kemi, lola]) loop
    perform pg_temp.actor(who); perform public.crew_room_enter(room, gen_random_uuid()); perform pg_temp.admin();
  end loop;

  -- (1) A room wave answered BEFORE crew_friends.sql: accepted, a chat, no crew rows. That is the state launch night left.
  dm_ab := pg_temp.old_match(ada, ben, room);
  perform pg_temp.ok((select status from public.waves where from_user = ada and to_user = ben) = 'accepted'
                     and (select event_id from public.waves where from_user = ada and to_user = ben) is null, 'the old wave is accepted, with no event');
  perform pg_temp.ok(pg_temp.dms_between(ada, ben) = 1 and not pg_temp.mutual(ada, ben) and pg_temp.crew_rows(ada, ben) = 0,
                     'and left a chat and no crew rows (launch night)');
  perform pg_temp.ok(not pg_temp.listed(ada, ben) and not pg_temp.listed(ben, ada), 'so neither lists the other in the Chat tab crew');

  -- (2) An accepted event wave between two people who share a crew stays a chat.
  insert into public.events (title, venue_name, geog, starts_at) values ('Bf event', 'Bf venue', st_point(3.40, 6.50)::geography, now() + interval '1 day')
  returning id into ev;
  insert into public.waves (from_user, to_user, event_id, from_alias, to_alias, status, responded_at)
  values (chi, dayo, ev, 'chi', 'dayo', 'accepted', now());
  -- (3) A blocked pair does not become crew, whichever of them blocked.
  perform pg_temp.old_match(efe, femi, room);
  perform pg_temp.old_match(gio, hana, room);
  insert into public.blocks (blocker, blocked, label) values (efe, femi, 'F'), (hana, gio, 'G');

  n := public._cf_backfill_room_waves();
  perform pg_temp.ok(n >= 1, 'the backfill reports the pairs it made crew');
  perform pg_temp.ok(pg_temp.mutual(ada, ben), 'the room wave from before the file is crew both ways now');
  perform pg_temp.ok(pg_temp.listed(ada, ben) and pg_temp.listed(ben, ada), 'and each lists the other in crew_friend_inbox');
  j := pg_temp.inbox(ada);
  perform pg_temp.ok((j -> 'crew' -> 0 ->> 'dm')::uuid = dm_ab and j -> 'crew' -> 0 ->> 'name' = 'Bf Ben', 'with the chat they already had, under the room name');
  perform pg_temp.ok(pg_temp.dms_between(ada, ben) = 1, 'and no second chat');
  perform pg_temp.ok(not pg_temp.mutual(chi, dayo) and pg_temp.crew_rows(chi, dayo) = 0, 'an accepted event wave does not become crew');
  perform pg_temp.ok(pg_temp.crew_rows(efe, femi) = 0, 'a pair where the first blocked the second does not');
  perform pg_temp.ok(pg_temp.crew_rows(gio, hana) = 0, 'nor one where the second blocked the first');
  perform pg_temp.ok(not pg_temp.listed(efe, femi) and not pg_temp.listed(femi, efe), 'and neither lists the other');

  -- (4) Run again: nothing new, no duplicates.
  select count(*) into n_rows from public.crew;
  perform pg_temp.ok(public._cf_backfill_room_waves() = 0, 'a second run makes nobody new');
  perform pg_temp.ok(public._cf_backfill_room_waves() = 0 and (select count(*) from public.crew) = n_rows, 'a third run neither: the crew rows are the same');
  perform pg_temp.ok(pg_temp.crew_rows(ada, ben) = 2, 'a pair is one row each way, never more');
  -- A one-way old row is left alone, and a pair that is crew both ways already is skipped.
  insert into public.crew (user_id, friend_id) values (chi, lola);
  perform pg_temp.ok(public._cf_backfill_room_waves() = 0 and pg_temp.crew_rows(chi, lola) = 1, 'a one-way ADD TO CREW row is not touched');
  delete from public.crew where user_id = chi;
  perform pg_temp.ok(not has_function_privilege('anon', 'public._cf_backfill_room_waves()', 'execute')
                     and not has_function_privilege('authenticated', 'public._cf_backfill_room_waves()', 'execute'), 'the backfill is not callable from the app');

  -- (5) REMOVE FROM CREW. A new crew through the new way, then the removal.
  perform pg_temp.ok(pg_temp.hi(ife, room, jide) = 'sent', 'ife says hi to jide');
  r := pg_temp.hi(jide, room, ife);
  perform pg_temp.ok(r like 'crew:%' and pg_temp.mutual(ife, jide), 'and jide waving back makes crew');
  dm_ij := substr(r, 6)::uuid;
  perform pg_temp.ok(pg_temp.hi(ife, room, kemi) = 'sent' and pg_temp.hi(kemi, room, ife) like 'crew:%' and pg_temp.mutual(ife, kemi), 'ife has a second friend, kemi');
  perform pg_temp.ok((select not a_revealed and not b_revealed from public.dms where id = dm_ij), 'a room chat is not marked known: the crew rows are what show the name');
  perform pg_temp.ok(pg_temp.msg(ife, jide) = 'dm:' || dm_ij::text, 'MESSAGE works while they are crew');

  perform pg_temp.ok(pg_temp.rm(ife, jide) = 'removed', 'REMOVE FROM CREW answers removed');
  perform pg_temp.ok(pg_temp.crew_rows(ife, jide) = 0 and not pg_temp.mutual(ife, jide), 'the crew rows are gone, both ways');
  perform pg_temp.ok(not pg_temp.listed(ife, jide) and not pg_temp.listed(jide, ife), 'neither lists the other as crew');
  perform pg_temp.ok(pg_temp.mutual(ife, kemi), 'the rest of the crew is untouched');
  perform pg_temp.ok(pg_temp.msg(ife, jide) = 'not_crew' and pg_temp.msg(jide, ife) = 'not_crew', 'MESSAGE now answers not_crew, for both');
  perform pg_temp.ok(pg_temp.poke(ife, jide) = 'not_crew', 'and so does POKE');
  perform pg_temp.ok(pg_temp.dms_between(ife, jide) = 1, 'the chat stays');
  j := pg_temp.inbox(ife);
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(j -> 'dms') d where (d ->> 'id')::uuid = dm_ij and not (d ->> 'crew')::boolean),
                     'it is still in the chat list, as history, no longer marked crew');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(j -> 'dms') d where (d ->> 'id')::uuid = dm_ij and d ->> 'other_name' = 'Bf Jide' and (d ->> 'revealed')::boolean),
                     'and the name stays: real names are not taken back');
  perform pg_temp.ok((select a_revealed and b_revealed from public.dms where id = dm_ij), 'the chat is marked known on both sides');
  perform pg_temp.ok(not exists (select 1 from public.waves where status = 'accepted'
                                  and ((from_user = ife and to_user = jide) or (from_user = jide and to_user = ife))),
                     'the accepted wave went with the crew rows');
  -- A new wave is a request again, not an instant crew.
  perform pg_temp.ok(pg_temp.hi(ife, room, jide) = 'sent', 'SAY HI to someone removed is a fresh request (sent)');
  perform pg_temp.ok(not pg_temp.mutual(ife, jide) and pg_temp.dms_between(ife, jide) = 1, 'which makes no crew and opens no new chat by itself');
  j := pg_temp.inbox(jide);
  perform pg_temp.ok(jsonb_array_length(j -> 'waves') = 1 and (j -> 'waves' -> 0 ->> 'room')::boolean, 'it waits for them in the inbox as a room wave');
  r := pg_temp.hi(jide, room, ife);
  perform pg_temp.ok(r = 'crew:' || dm_ij::text and pg_temp.mutual(ife, jide), 'a wave back makes crew again, in the same chat');
  -- Either of the two can remove.
  perform pg_temp.ok(pg_temp.rm(jide, ife) = 'removed' and pg_temp.crew_rows(ife, jide) = 0, 'the other one can remove too');

  -- (6) Nothing to remove.
  perform pg_temp.ok(pg_temp.rm(ife, jide) = 'not_crew', 'removing someone who is no longer crew answers not_crew');
  perform pg_temp.ok(pg_temp.rm(ife, lola) = 'not_crew', 'removing someone who was never crew answers not_crew');
  insert into public.crew (user_id, friend_id) values (ife, lola);
  perform pg_temp.ok(pg_temp.rm(ife, lola) = 'not_crew' and pg_temp.crew_rows(ife, lola) = 1, 'a one-way row is not crew: not_crew, and the row is left alone');
  delete from public.crew where user_id = ife and friend_id = lola;
  perform pg_temp.ok(pg_temp.rm(ife, ife) = 'not_crew' and pg_temp.rm(ife, null) = 'not_crew', 'yourself and nobody answer not_crew');
  perform pg_temp.ok(pg_temp.mutual(ife, kemi), 'and none of it touched kemi');
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.ok(public.crew_friend_remove(kemi) = 'no_session', 'without a session: no_session');
  perform pg_temp.ok(pg_temp.mutual(ife, kemi), 'which removes nothing');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.crew_friend_remove(uuid)', 'execute')
                     and has_function_privilege('authenticated', 'public.crew_friend_remove(uuid)', 'execute'), 'the app calls it as authenticated only');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- SAY HI at a hotspot head (crew_friend_hotspot_wave): an alias asks, the wave back makes crew and reveals both names.
-- Needs hotspots.sql loaded; without it this block says so and is skipped.
create function pg_temp.enterhs(u uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(u);
  perform public.confirm_adult();
  r := public.enter_hotspot('yaba');
  perform pg_temp.admin();
  if (r ->> 'ok')::boolean is not true then raise exception 'FAILED: could not enter the hotspot: %', r; end if;
  return r;
end $$;
create function pg_temp.hwave(u uuid, k text) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.actor(u);
  r := public.crew_friend_hotspot_wave(k);
  perform pg_temp.admin();
  return r;
end $$;

do $$
declare
  a uuid := pg_temp.newuser(false, 'Hs Ada'); b uuid := pg_temp.newuser(false, 'Hs Ben'); c uuid := pg_temp.newuser(false, 'Hs Chi');
  d uuid := pg_temp.newuser(false, 'Hs Dayo'); e uuid := pg_temp.newuser(false, 'Hs Efe'); f uuid := pg_temp.newuser(false, 'Hs Femi');
  g uuid := pg_temp.newuser(false, 'Hs Outsider');
  ka text; kb text; kc text; kd text; ke text; kf text; alias_a text;
  r text; dm1 uuid; j jsonb; w uuid; p uuid; n int; i int;
begin
  if to_regclass('public.hotspot_visits') is null or not exists (select 1 from public.hotspots where slug = 'yaba' and status = 'active') then
    raise notice 'SKIP: hotspots.sql is not loaded here (or yaba is not open), so the hotspot wave cases did not run';
    raise notice 'ALL CREW FRIENDS TESTS PASSED';
    return;
  end if;
  ka := pg_temp.enterhs(a) ->> 'key'; kb := pg_temp.enterhs(b) ->> 'key'; kc := pg_temp.enterhs(c) ->> 'key';
  kd := pg_temp.enterhs(d) ->> 'key'; ke := pg_temp.enterhs(e) ->> 'key'; kf := pg_temp.enterhs(f) ->> 'key';
  select alias into alias_a from public.room_identities where id = ka::uuid;

  -- The ask.
  perform pg_temp.ok(pg_temp.hwave(a, kb) = 'sent', 'SAY HI at a head in a hotspot room is a crew request (sent)');
  perform pg_temp.ok(not pg_temp.mutual(a, b), 'a request alone makes no crew');
  j := pg_temp.inbox(b);
  perform pg_temp.ok(jsonb_array_length(j -> 'waves') = 1, 'it waits in their Chat tab');
  perform pg_temp.ok(j -> 'waves' -> 0 ->> 'name' = alias_a, 'it carries the alias, not the name');
  perform pg_temp.ok(j -> 'waves' -> 0 ->> 'name' not in ('Hs Ada', (select handle from public.profiles where id = a)), 'and not the handle either');
  perform pg_temp.ok(j -> 'waves' -> 0 ->> 'where' like 'at %' and (j -> 'waves' -> 0 ->> 'alias')::boolean, 'with "at <place>" and the alias flag');
  perform pg_temp.ok(jsonb_typeof(j -> 'waves' -> 0 -> 'from') = 'null', 'and no user id in the "from" field');
  perform pg_temp.ok(position(a::text in j::text) = 0, 'and their user id is nowhere in the whole answer');
  perform pg_temp.actor(b);
  select count(*) into n from public.my_waves();
  perform pg_temp.admin();
  perform pg_temp.ok(n = 0, 'the old my_waves() never lists it, so an older app cannot show the handle');
  perform pg_temp.ok(pg_temp.hwave(a, kb) = 'already', 'a second ask is already');
  perform pg_temp.ok(pg_temp.hwave(a, ka) = 'self', 'not at your own head');
  perform pg_temp.ok(pg_temp.hwave(g, kb) = 'not_met', 'someone who is not in the room cannot');
  perform pg_temp.ok(pg_temp.hwave(a, gen_random_uuid()::text) = 'gone', 'a key that is nobody is gone');
  perform pg_temp.ok(pg_temp.hwave(a, 'not a key') = 'gone', 'and so is text that is not a key');

  -- Gone, blocks and the limit's neighbours.
  delete from public.hotspot_visits where user_id = c;
  perform pg_temp.ok(pg_temp.hwave(a, kc) = 'gone', 'a head that has left the room is gone');
  insert into public.hotspot_blocks (blocker, blocked, label) values (d, a, 'x');
  perform pg_temp.ok(pg_temp.hwave(a, kd) = 'sent' and not exists (select 1 from public.crew_hotspot_waves where from_user = a and to_user = d),
                     'a head that blocked you from hotspots says sent and writes nothing');
  insert into public.hotspot_blocks (blocker, blocked, label) values (a, e, 'x');
  perform pg_temp.ok(pg_temp.hwave(a, ke) = 'blocked', 'your own hotspot block says blocked');
  insert into public.blocks (blocker, blocked, label) values (f, a, 'A');
  perform pg_temp.ok(pg_temp.hwave(a, kf) = 'sent' and not exists (select 1 from public.crew_hotspot_waves where from_user = a and to_user = f),
                     'and so does a global block: sent, nothing written');
  delete from public.blocks where blocker = f;
  delete from public.hotspot_blocks;

  -- The wave back: crew both ways, a chat, and both names open.
  r := pg_temp.hwave(b, ka);
  perform pg_temp.ok(r like 'crew:%', 'waving back at their head makes crew');
  dm1 := substr(r, 6)::uuid;
  perform pg_temp.ok(pg_temp.mutual(a, b), 'crew rows both ways');
  perform pg_temp.ok((select status from public.crew_hotspot_waves where from_user = a and to_user = b) = 'accepted', 'the request is accepted');
  perform pg_temp.ok(exists (select 1 from public.dms where id = dm1 and a_revealed and b_revealed), 'the chat is revealed on both sides');
  select id into p from public.crew_pings where from_user = b and to_user = a and kind = 'crew';
  perform pg_temp.ok(p is not null, 'the one who asked is told live');
  j := pg_temp.inbox(a);
  perform pg_temp.ok(j -> 'crew' -> 0 ->> 'name' = 'Hs Ben', 'the asker now sees the real name in the crew list');
  perform pg_temp.ok(j -> 'dms' -> 0 ->> 'other_name' = 'Hs Ben', 'and in the chat');
  j := pg_temp.inbox(b);
  perform pg_temp.ok(j -> 'crew' -> 0 ->> 'name' = 'Hs Ada' and jsonb_array_length(j -> 'waves') = 0, 'and the other side sees the real name, with the wave gone');
  perform pg_temp.ok(pg_temp.hwave(a, kb) = 'already_crew:' || dm1::text, 'SAY HI at a head that is already crew says already_crew');

  -- REMOVE FROM CREW for a pair who became crew at a hotspot: the rows go, the names stay open, the next hi is a request.
  perform pg_temp.actor(a); r := public.crew_friend_remove(b); perform pg_temp.admin();
  perform pg_temp.ok(r = 'removed' and not pg_temp.mutual(a, b), 'REMOVE FROM CREW removes a hotspot friend, both ways');
  perform pg_temp.ok(exists (select 1 from public.dms where id = dm1 and a_revealed and b_revealed), 'and their chat keeps both names open');
  perform pg_temp.ok(pg_temp.hwave(a, kb) = 'sent', 'SAY HI at the same head is a fresh request, not already_crew');
  perform pg_temp.ok(pg_temp.hwave(b, ka) = 'crew:' || dm1::text and pg_temp.mutual(a, b), 'and a hi back makes crew again, in the same chat');

  -- WAVE BACK from the Chat tab, and PASS.
  perform pg_temp.ok(pg_temp.hwave(e, kb) = 'sent', 'another head asks b');
  select (pg_temp.inbox(b) -> 'waves' -> 0 ->> 'id')::uuid into w;
  perform pg_temp.actor(b); r := public.crew_friend_respond(w, true); perform pg_temp.admin();
  perform pg_temp.ok(r like 'crew:%' and pg_temp.mutual(b, e), 'WAVE BACK from the Chat tab makes crew and opens the chat');
  perform pg_temp.ok(exists (select 1 from public.dms where id = substr(r, 6)::uuid and a_revealed and b_revealed), 'and reveals both names');
  perform pg_temp.ok(pg_temp.hwave(f, kb) = 'sent', 'a third head asks b');
  select (pg_temp.inbox(b) -> 'waves' -> 0 ->> 'id')::uuid into w;
  perform pg_temp.actor(b); r := public.crew_friend_respond(w, false); perform pg_temp.admin();
  perform pg_temp.ok(r = 'passed' and not pg_temp.mutual(b, f), 'PASS makes nothing');
  perform pg_temp.ok(pg_temp.hwave(f, kb) = 'already', 'and there is no second try');
  perform pg_temp.ok(not exists (select 1 from public.waves where from_user = f or to_user = f), 'none of this wrote a row in the waves table');

  -- The two kinds of wave meet: a crew room wave one way, a hotspot wave the other.
  declare
    h uuid := pg_temp.newuser(false, 'Hs Hana'); i2 uuid := pg_temp.newuser(false, 'Hs Ike'); kh text; ki text;
    j2 uuid := pg_temp.newuser(false, 'Hs Jide'); k2 uuid := pg_temp.newuser(false, 'Hs Kemi'); kj text; kk text;
    room uuid := gen_random_uuid(); room2 uuid := gen_random_uuid();
  begin
    insert into public.crews (id, name, created_by) values (room, 'Hs room one', h), (room2, 'Hs room two', j2);
    insert into public.crew_members (crew_id, user_id, role) values (room, h, 'owner'), (room, i2, 'member'), (room2, j2, 'owner'), (room2, k2, 'member');
    perform pg_temp.ok(pg_temp.hi(h, room, i2) = 'sent', 'h waves at i in a crew room');
    kh := pg_temp.enterhs(h) ->> 'key'; ki := pg_temp.enterhs(i2) ->> 'key';
    r := pg_temp.hwave(i2, kh);
    perform pg_temp.ok(r like 'crew:%' and pg_temp.mutual(h, i2), 'i waves back at h''s head in a hotspot: that answers the crew room wave');
    perform pg_temp.ok((select status from public.waves where from_user = h and to_user = i2) = 'accepted', 'and the crew room wave is accepted');
    kj := pg_temp.enterhs(j2) ->> 'key'; kk := pg_temp.enterhs(k2) ->> 'key';
    perform pg_temp.ok(pg_temp.hwave(j2, kk) = 'sent', 'j asks k at a head');
    perform pg_temp.ok(pg_temp.hi(k2, room2, j2) like 'crew:%' and pg_temp.mutual(j2, k2), 'k saying hi to j in a crew room answers it');
  end;

  -- The limit counts both kinds.
  declare m uuid := pg_temp.newuser(false, 'Hs Mo'); n2 uuid := pg_temp.newuser(false, 'Hs Nia'); km text; kn text;
  begin
    km := pg_temp.enterhs(m) ->> 'key'; kn := pg_temp.enterhs(n2) ->> 'key';
    for i in 1..30 loop
      insert into public.crew_hotspot_waves (from_user, to_user, place, from_alias, created_at)
      values (m, pg_temp.newuser(), 'Yaba', 'x', now() - interval '1 hour');
    end loop;
    perform pg_temp.ok(pg_temp.hwave(m, kn) = 'slow_down', 'the 31st wave in a day is slow_down');
  end;

  raise notice 'ALL CREW FRIENDS TESTS PASSED';
end $$;
rollback;
