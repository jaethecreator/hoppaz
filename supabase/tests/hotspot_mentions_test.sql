-- Tags in hotspot chats (supabase/hotspot_mentions.sql). LOCAL ONLY: every fixture rolls back.
-- Needs schema.sql ... hotspots.sql, then hotspot_mentions.sql loaded (crew_friends.sql too, for the inbox cases).
-- Ends with ALL HOTSPOT MENTION TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < supabase/tests/hotspot_mentions_test.sql
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
create function pg_temp.newuser(shown text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mention-' || u || '@roomtest.invalid', false, '{}',
          json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
create function pg_temp.enterhs(u uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(u);
  perform public.confirm_adult();
  r := public.enter_hotspot('yaba');
  perform pg_temp.admin();
  if (r ->> 'ok')::boolean is not true then raise exception 'FAILED: could not enter: %', r; end if;
  return r;
end $$;
-- Post as a user: 'ok' or the error. Older rows are aged afterwards so the burst limit and the duplicate rule do not trip.
create function pg_temp.say(u uuid, ch text, body text) returns text language plpgsql as $$
declare r text := 'ok';
begin
  perform pg_temp.actor(u);
  begin
    insert into public.messages (channel, body) values (ch, body);
  exception when others then
    r := sqlerrm;
  end;
  perform pg_temp.admin();
  update public.messages set created_at = created_at - interval '10 minutes' where channel = ch and created_at > now() - interval '5 minutes';
  return r;
end $$;
create function pg_temp.mine(u uuid) returns int language plpgsql as $$
declare n int;
begin
  perform pg_temp.actor(u);
  select count(*) into n from public.hotspot_mentions;
  perform pg_temp.admin();
  return n;
end $$;
create function pg_temp.age_log() returns void language sql as $$
  update public.hotspot_mention_log set created_at = created_at - interval '2 minutes';
$$;
create function pg_temp.tag(alias text) returns text language sql as $$ select U&'\27E6' || alias || U&'\27E7'; $$;

do $$
declare
  a uuid := pg_temp.newuser('Mn Ada'); b uuid := pg_temp.newuser('Mn Ben'); c uuid := pg_temp.newuser('Mn Chi');
  d uuid := pg_temp.newuser('Mn Dayo'); e uuid := pg_temp.newuser('Mn Efe'); f uuid := pg_temp.newuser('Mn Femi');
  g uuid := pg_temp.newuser('Mn Gold');
  ja jsonb; jb jsonb; jc jsonb; jd jsonb; je jsonb; jf jsonb; jg jsonb;
  al_a text; al_b text; al_c text; al_d text; al_e text; al_f text; al_g text;
  ch text; r text; j jsonb; n int; row_id uuid;
begin
  if to_regclass('public.hotspot_visits') is null or to_regclass('public.hotspot_mentions') is null
     or not exists (select 1 from public.hotspots where slug = 'yaba' and status = 'active') then
    raise exception 'FAILED: hotspots.sql and hotspot_mentions.sql must be loaded, with yaba open';
  end if;
  select 'hotspot:' || id::text into ch from public.hotspots where slug = 'yaba';
  ja := pg_temp.enterhs(a); jb := pg_temp.enterhs(b); jc := pg_temp.enterhs(c); jd := pg_temp.enterhs(d);
  je := pg_temp.enterhs(e); jf := pg_temp.enterhs(f);
  al_a := ja ->> 'alias'; al_b := jb ->> 'alias'; al_c := jc ->> 'alias'; al_d := jd ->> 'alias'; al_e := je ->> 'alias'; al_f := jf ->> 'alias';

  -- Why a tag is not an "@": the room refuses one, and the bracket token goes through the same filter as words.
  perform pg_temp.ok(pg_temp.say(a, ch, 'hey @' || al_b || ' you here') like '%no_links%', 'a typed @name is refused by the room filter, as before');
  perform pg_temp.ok(pg_temp.say(a, ch, 'hey ' || pg_temp.tag(al_b) || ' you here') = 'ok', 'the bracket token goes through the same filter as words');

  -- The ping.
  perform pg_temp.ok(pg_temp.mine(b) = 1, 'the tagged person has one ping');
  perform pg_temp.actor(b);
  select to_jsonb(m), m.id into j, row_id from public.hotspot_mentions m limit 1;
  perform pg_temp.admin();
  perform pg_temp.ok(j ->> 'from_alias' = al_a, 'it carries the tagger''s alias');
  perform pg_temp.ok(j ->> 'slug' = 'yaba' and j ->> 'place' <> '' and j ->> 'channel' = ch, 'and the place, the slug and the channel');
  perform pg_temp.ok(j ->> 'excerpt' like 'hey @' || al_b || '%', 'the excerpt shows the tag as an @');
  perform pg_temp.ok(not (j ? 'from_user') and position(a::text in j::text) = 0 and position('Mn Ada' in j::text) = 0,
                     'and holds no user id, no real name');
  perform pg_temp.ok(not exists (select 1 from information_schema.columns where table_name = 'hotspot_mentions' and column_name like '%from_user%'),
                     'the table has no sender id column at all');
  perform pg_temp.ok(pg_temp.mine(a) = 0 and pg_temp.mine(c) = 0, 'nobody else reads it');

  -- Limits.
  perform pg_temp.ok(pg_temp.say(a, ch, 'again ' || pg_temp.tag(al_b)) = 'ok' and pg_temp.mine(b) = 1, 'the same person twice inside a minute is one ping');
  perform pg_temp.age_log();
  perform pg_temp.ok(pg_temp.say(a, ch, 'and once more ' || pg_temp.tag(al_b)) = 'ok' and pg_temp.mine(b) = 2, 'a minute on it pings again');

  -- Several tags, at most three; the tag is case-insensitive; yourself, strangers and the gone are skipped.
  perform pg_temp.age_log();
  perform pg_temp.ok(pg_temp.say(a, ch, pg_temp.tag(upper(al_c)) || ' ' || pg_temp.tag(al_d) || ' ' || pg_temp.tag(al_e) || ' ' || pg_temp.tag(al_f)) = 'ok',
                     'a message with four tags posts');
  perform pg_temp.ok(pg_temp.mine(c) = 1 and pg_temp.mine(d) = 1 and pg_temp.mine(e) = 1, 'the first three tags ping, whatever the case');
  perform pg_temp.ok(pg_temp.mine(f) = 0, 'the fourth does not');
  perform pg_temp.age_log();
  n := pg_temp.mine(a);
  perform pg_temp.ok(pg_temp.say(a, ch, 'me ' || pg_temp.tag(al_a)) = 'ok' and pg_temp.mine(a) = n, 'tagging yourself pings nobody');
  perform pg_temp.age_log();
  perform pg_temp.ok(pg_temp.say(a, ch, 'who ' || pg_temp.tag('Nobody Zebra 00')) = 'ok', 'a tag that is nobody posts as words');
  delete from public.hotspot_visits where user_id = f;
  perform pg_temp.age_log();
  n := pg_temp.mine(f);
  perform pg_temp.ok(pg_temp.say(a, ch, 'left ' || pg_temp.tag(al_f)) = 'ok' and pg_temp.mine(f) = n, 'someone who has left the room is not pinged');

  -- Blocks and the daily limit.
  perform pg_temp.age_log();
  insert into public.hotspot_blocks (blocker, blocked, label) values (c, a, 'x');
  n := pg_temp.mine(c);
  perform pg_temp.ok(pg_temp.say(a, ch, 'hotspot blocked ' || pg_temp.tag(al_c)) = 'ok' and pg_temp.mine(c) = n, 'a hotspot block means no ping');
  delete from public.hotspot_blocks;
  insert into public.blocks (blocker, blocked, label) values (a, d, 'D');
  perform pg_temp.age_log();
  n := pg_temp.mine(d);
  perform pg_temp.ok(pg_temp.say(a, ch, 'global blocked ' || pg_temp.tag(al_d)) = 'ok' and pg_temp.mine(d) = n, 'and so does a global block, either way');
  delete from public.blocks;
  perform pg_temp.age_log();
  -- 20 tags a day: fill the day, then one more
  insert into public.hotspot_mention_log (from_user, to_user, created_at)
  select a, b, now() - interval '3 hours' from generate_series(1, 20);
  n := pg_temp.mine(e);
  perform pg_temp.ok(pg_temp.say(a, ch, 'over the limit ' || pg_temp.tag(al_e)) = 'ok' and pg_temp.mine(e) = n, 'the 21st tag in a day is just words');

  -- Reading: the inbox, and seen.
  delete from public.hotspot_mention_log;
  perform pg_temp.actor(b);
  j := public.crew_friend_inbox();
  perform pg_temp.admin();
  perform pg_temp.ok(jsonb_array_length(j -> 'mentions') = 2, 'the inbox lists the unseen tags');
  perform pg_temp.ok(j -> 'mentions' -> 0 ->> 'alias' = al_a and j -> 'mentions' -> 0 ->> 'slug' = 'yaba', 'with the alias and the slug to open the room');
  perform pg_temp.ok(position(a::text in j::text) = 0, 'and no user id');
  perform pg_temp.actor(c);
  n := public.crew_friend_mention_seen((select array_agg(id) from public.hotspot_mentions where to_user = b));
  perform pg_temp.admin();
  perform pg_temp.ok(n = 0, 'someone else cannot mark my pings seen');
  perform pg_temp.actor(b);
  n := public.crew_friend_mention_seen((select array_agg(id) from public.hotspot_mentions));
  j := public.crew_friend_inbox();
  perform pg_temp.admin();
  perform pg_temp.ok(n = 2 and jsonb_array_length(j -> 'mentions') = 0, 'seen clears them from the inbox');

  raise notice 'ALL HOTSPOT MENTION TESTS PASSED';
end $$;
rollback;
