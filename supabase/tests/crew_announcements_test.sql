-- Owner announcements (supabase/crew_announcements.sql). LOCAL ONLY: every fixture rolls back.
-- Needs schema.sql, chat_accounts.sql, crew_rooms.sql and crew_announcements.sql loaded. Ends with ALL CREW ANNOUNCEMENT TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < supabase/tests/crew_announcements_test.sql
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
create function pg_temp.newuser(shown text, guest boolean default false) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          case when guest then null else 'ann-' || u || '@roomtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
create function pg_temp.read(u uuid, c uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.actor(u); j := public.crew_announcements(c); perform pg_temp.admin(); return j;
end $$;
create function pg_temp.post(u uuid, c uuid, b text) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.actor(u); r := public.crew_announce(c, b); perform pg_temp.admin(); return r;
end $$;
create function pg_temp.seen(u uuid, c uuid) returns void language plpgsql as $$
begin
  perform pg_temp.actor(u); perform public.crew_announcement_seen(c); perform pg_temp.admin();
end $$;

do $$
declare
  o uuid := pg_temp.newuser('Ann Owner'); m uuid := pg_temp.newuser('Ann Member'); x uuid := pg_temp.newuser('Ann Outsider');
  g uuid := pg_temp.newuser('Ann Guest', true);
  crew uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  r text; j jsonb; id1 uuid; id2 uuid; n int;
begin
  insert into public.crews (id, name, created_by) values (crew, 'Ann test room', o), (other, 'Ann other room', x);
  insert into public.crew_members (crew_id, user_id, role) values (crew, o, 'owner'), (crew, m, 'member'), (other, x, 'owner');
  update public.crew_members set joined_at = now() - interval '2 days' where crew_id = crew;

  -- Nothing yet.
  j := pg_temp.read(m, crew);
  perform pg_temp.ok(jsonb_array_length(j -> 'items') = 0 and (j ->> 'unseen')::int = 0 and not (j ->> 'is_staff')::boolean and not (j ->> 'can_send')::boolean,
                     'an empty room: no items, nothing unseen, a member cannot send');
  j := pg_temp.read(o, crew);
  perform pg_temp.ok((j ->> 'is_staff')::boolean and (j ->> 'can_send')::boolean, 'the owner is staff and can send');

  -- Who may post.
  perform pg_temp.ok(pg_temp.post(m, crew, 'hello') = 'not_staff', 'a member cannot post');
  perform pg_temp.ok(pg_temp.post(x, crew, 'hello') = 'not_staff', 'an outsider cannot post');
  perform pg_temp.ok(pg_temp.post(o, other, 'hello') = 'not_staff', 'the owner of another room cannot post here');
  perform pg_temp.ok(pg_temp.post(g, crew, 'hello') = 'need_account', 'a guest without an account is refused');
  perform pg_temp.ok(pg_temp.post(o, crew, '   ') = 'empty', 'an empty announcement is refused');
  perform pg_temp.ok(pg_temp.post(o, crew, repeat('x', 281)) = 'too_long', '281 characters is too long');
  perform pg_temp.ok(pg_temp.post(o, crew, repeat('x', 280)) like 'sent:%', '280 characters is fine');
  select id into id1 from public.crew_announcements where crew_id = crew;

  -- Who sees it, and as news.
  j := pg_temp.read(m, crew);
  perform pg_temp.ok(jsonb_array_length(j -> 'items') = 1 and (j ->> 'unseen')::int = 1, 'a member sees it, and it is unseen');
  perform pg_temp.ok((j -> 'items' -> 0 ->> 'by') = 'Ann Owner' and not (j -> 'items' -> 0 ->> 'mine')::boolean, 'with the owner''s name');
  j := pg_temp.read(o, crew);
  perform pg_temp.ok((j ->> 'unseen')::int = 0, 'the owner''s own post is not news to the owner');
  j := pg_temp.read(x, crew);
  perform pg_temp.ok(jsonb_array_length(j -> 'items') = 0 and (j ->> 'unseen')::int = 0, 'an outsider reads nothing');
  perform pg_temp.actor(x);
  select count(*) into n from public.crew_announcements;
  perform pg_temp.admin();
  perform pg_temp.ok(n = 0, 'and row level security shows an outsider no rows');
  perform pg_temp.actor(m);
  select count(*) into n from public.crew_announcements;
  perform pg_temp.admin();
  perform pg_temp.ok(n = 1, 'a member reads the row');
  begin
    perform pg_temp.actor(m);
    insert into public.crew_announcements (crew_id, author_id, body) values (crew, m, 'sneaky');
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a member inserting a row directly must be refused');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a row cannot be written directly: only the functions write');
  end;

  -- Seen stops the pulse; new ones start it again.
  perform pg_temp.seen(m, crew);
  perform pg_temp.ok((pg_temp.read(m, crew) ->> 'unseen')::int = 0, 'opening the panel marks them seen');
  perform pg_temp.ok(pg_temp.post(o, crew, 'second') like 'sent:%', 'a second announcement goes');
  j := pg_temp.read(m, crew);
  perform pg_temp.ok((j ->> 'unseen')::int = 1 and (j -> 'items' -> 0 ->> 'body') = 'second' and (j -> 'items' -> 0 ->> 'fresh')::boolean,
                     'only the new one is unseen, and the list is latest first');
  perform pg_temp.ok(not (pg_temp.read(o, crew) ->> 'can_send')::boolean, 'two a day is the limit: the owner can no longer send');
  perform pg_temp.ok(pg_temp.post(o, crew, 'third') = 'slow_down', 'a third in a day is slow_down');
  select id into id2 from public.crew_announcements where body = 'second';

  -- Edit and delete.
  perform pg_temp.actor(o); r := public.crew_announcement_edit(id2, 'second, corrected'); perform pg_temp.admin();
  perform pg_temp.ok(r = 'ok' and (pg_temp.read(m, crew) -> 'items' -> 0 ->> 'body') = 'second, corrected' and (pg_temp.read(m, crew) -> 'items' -> 0 ->> 'edited')::boolean,
                     'the owner edits, and it shows as edited');
  perform pg_temp.actor(m); r := public.crew_announcement_edit(id2, 'mine now'); perform pg_temp.admin();
  perform pg_temp.ok(r = 'not_staff', 'a member cannot edit');
  perform pg_temp.actor(o); r := public.crew_announcement_edit(id2, repeat('y', 281)); perform pg_temp.admin();
  perform pg_temp.ok(r = 'too_long', 'an edit past 280 is refused');
  perform pg_temp.actor(m); r := public.crew_announcement_delete(id2); perform pg_temp.admin();
  perform pg_temp.ok(r = 'not_staff', 'a member cannot delete');
  perform pg_temp.actor(o); r := public.crew_announcement_delete(id2); perform pg_temp.admin();
  perform pg_temp.ok(r = 'ok' and jsonb_array_length(pg_temp.read(m, crew) -> 'items') = 1, 'the owner deletes, and it is gone from the list');
  perform pg_temp.ok((pg_temp.read(m, crew) ->> 'unseen')::int = 0, 'and no longer unseen');
  perform pg_temp.ok(pg_temp.post(o, crew, 'again') = 'slow_down', 'a delete does not give the slot back');
  perform pg_temp.actor(o); r := public.crew_announcement_delete(id2); perform pg_temp.admin();
  perform pg_temp.ok(r = 'gone', 'deleting it twice is gone');

  -- The next day.
  update public.crew_announcements set created_at = created_at - interval '2 days';
  perform pg_temp.ok((pg_temp.read(o, crew) ->> 'can_send')::boolean and pg_temp.post(o, crew, 'a new day') like 'sent:%', 'a day later the owner can send again');

  -- A new member is not pulsed by old news.
  update public.crew_announcements set created_at = created_at - interval '5 days' where body = repeat('x', 280);
  insert into public.crew_members (crew_id, user_id, role, joined_at) values (crew, x, 'member', clock_timestamp() + interval '1 minute');
  j := pg_temp.read(x, crew);
  perform pg_temp.ok((j ->> 'unseen')::int = 0 and jsonb_array_length(j -> 'items') >= 1, 'someone who just joined can read the room''s news but is not pulsed by what came before');
  raise notice 'ALL CREW ANNOUNCEMENT TESTS PASSED';
end $$;
rollback;
