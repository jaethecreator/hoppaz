-- Release 1 event covers (supabase/events_r1_covers.sql). LOCAL ONLY: every fixture user and file rolls back.
-- Needs crew_rooms.sql (the crew-images bucket), chat_accounts.sql and events_r1_covers.sql loaded. Ends with ALL EVENTS R1 COVERS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_cov_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_covers_test.sql
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
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.newuser(guest boolean default false) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          case when guest then null else 'cov-' || u || '@covtest.invalid' end, guest, '{}', '{"name":"Cover tester"}', now(), now());
  return u;
end $$;
create function pg_temp.fail_as(u uuid, q text, want text) returns void language plpgsql as $$
declare reason text;
begin
  perform pg_temp.actor(u);
  begin execute q; exception when others then reason := sqlerrm; end;
  perform pg_temp.admin();
  perform pg_temp.ok(reason like '%' || want || '%', 'rejects ' || want || coalesce(' (got: ' || reason || ')', ' (no error)'));
end $$;
create function pg_temp.put(u uuid, p text) returns void language plpgsql as $$
begin
  perform pg_temp.actor(u);
  insert into storage.objects (bucket_id, name) values ('crew-images', p);
  perform pg_temp.admin();
end $$;

do $$
declare
  a uuid := pg_temp.newuser();
  b uuid := pg_temp.newuser();
  g uuid := pg_temp.newuser(true);
  n int;
begin
  perform pg_temp.ok(exists (select 1 from storage.buckets where id = 'crew-images' and public and file_size_limit = 2097152
                              and allowed_mime_types @> array['image/jpeg']), 'the crew-images bucket is public, 2 MB, images only (not changed here)');

  perform pg_temp.put(a, 'event-covers/' || a || '/one.jpg');
  perform pg_temp.put(a, 'event-covers/' || a || '/two.webp');
  perform pg_temp.ok((select count(*) = 2 from storage.objects where bucket_id = 'crew-images' and name like 'event-covers/' || a || '/%'), 'a host uploads under their own folder');

  perform pg_temp.fail_as(b, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', 'event-covers/' || a || '/steal.jpg'), 'row-level security');
  perform pg_temp.fail_as(g, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', 'event-covers/' || g || '/guest.jpg'), 'row-level security');
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', 'event-covers/' || a || '/deeper/x.jpg'), 'row-level security');
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', 'event-covers/' || a || '/x.gif'), 'row-level security');
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', 'event-covers/' || a || '/..%2Fx.jpg'), 'row-level security');
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', 'other-folder/' || a || '/x.jpg'), 'row-level security');
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', a || '/x.jpg'), 'row-level security');
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'event-photos', 'event-covers/' || a || '/x.jpg'), 'row-level security');

  -- Reading and deleting: only the owner's own folder.
  perform pg_temp.actor(b);
  select count(*) into n from storage.objects where bucket_id = 'crew-images' and name like 'event-covers/%';
  perform pg_temp.admin();
  perform pg_temp.ok(n = 0, 'another host cannot list a host''s cover files');
  perform set_config('storage.allow_delete_query', 'true', true);
  perform pg_temp.actor(b);
  delete from storage.objects where bucket_id = 'crew-images' and name = 'event-covers/' || a || '/one.jpg';
  perform pg_temp.admin();
  perform pg_temp.ok(exists (select 1 from storage.objects where name = 'event-covers/' || a || '/one.jpg'), 'another host cannot delete it');
  -- Storage refuses a plain DELETE unless this setting is on (the app deletes through the Storage API, which sets it); the policy still decides.
  perform set_config('storage.allow_delete_query', 'true', true);
  perform pg_temp.actor(a);
  delete from storage.objects where bucket_id = 'crew-images' and name = 'event-covers/' || a || '/one.jpg';
  perform pg_temp.admin();
  perform pg_temp.ok(not exists (select 1 from storage.objects where name = 'event-covers/' || a || '/one.jpg'), 'the host deletes their own cover file');

  -- The old crew picture rule is untouched: a crew folder still needs the crew owner.
  perform pg_temp.fail_as(a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'crew-images', gen_random_uuid() || '/mine.jpg'), 'row-level security');

  -- Safe to run again: the file is re-runnable, so the policies exist exactly once each.
  perform pg_temp.ok((select count(*) = 3 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'events_r1_cover_%'), 'three cover policies, once each');
  raise notice 'ALL EVENTS R1 COVERS TESTS PASSED';
end $$;
rollback;
