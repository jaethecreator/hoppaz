-- DRAFT FOR OLA, NOT RUN ANYWHERE. Release 1 saved checkout details (supabase/events_r1_saved_details.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, events_r1_events.sql and events_r1_saved_details.sql loaded. Ends with ALL EVENTS R1 SAVED DETAILS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_saved_details_test.sql
begin;
select public.ev_set_setting('events_r1', 'on');
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
create function pg_temp.newuser(shown text, guest boolean default false) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          case when guest then null else 'saved-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
create function pg_temp.j(u uuid, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(u);
  execute q into r;
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.t(u uuid, q text) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.actor(u);
  execute q into r;
  perform pg_temp.admin();
  return r;
end $$;
create function pg_temp.denied(role_name text, q text) returns boolean language plpgsql as $$
declare reason text;
begin
  perform pg_temp.admin();
  begin
    execute 'set local role ' || role_name;
    execute q;
  exception when others then reason := sqlerrm;
  end;
  perform pg_temp.admin();
  return coalesce(reason like 'permission denied%', false);
end $$;

do $$
declare
  a uuid := pg_temp.newuser('Saved Tolu'); b uuid := pg_temp.newuser('Saved Other'); g uuid := pg_temp.newuser('Saved Guest', true);
  r jsonb;
begin
  -- ===================================================== nothing yet ========
  perform pg_temp.ok(pg_temp.j(a, 'select public.ev_saved_details()') is null, 'nothing saved: null');

  -- ===================================================== save and read ========
  perform pg_temp.ok(pg_temp.t(a, $q$select public.ev_save_details('  Tolu ', 'Adeyemi', 'tolu@example.com', '0803 555 2211')$q$) = 'ok', 'save: ok');
  r := pg_temp.j(a, 'select public.ev_saved_details()');
  perform pg_temp.ok(r ->> 'first_name' = 'Tolu' and r ->> 'last_name' = 'Adeyemi' and r ->> 'email' = 'tolu@example.com' and r ->> 'phone' = '0803 555 2211',
                     'read back, trimmed');
  perform pg_temp.ok(not (r ? 'answers'), 'there is nothing but name, email and phone');
  perform pg_temp.ok(pg_temp.t(a, $q$select public.ev_save_details('Tolu', '', 'tolu@new.example', '')$q$) = 'ok'
                     and pg_temp.j(a, 'select public.ev_saved_details()') ->> 'email' = 'tolu@new.example'
                     and (select count(*) from public.ev_saved_details where user_id = a) = 1, 'saving again replaces the one row');

  -- ===================================================== only your own ========
  perform pg_temp.ok(pg_temp.j(b, 'select public.ev_saved_details()') is null, 'another person reads only their own (none)');
  perform pg_temp.ok(pg_temp.t(b, 'select public.ev_delete_saved_details()') = 'ok' and exists (select 1 from public.ev_saved_details where user_id = a),
                     'another person deleting deletes only their own');

  -- ===================================================== refused ========
  perform pg_temp.ok(pg_temp.t(a, $q$select public.ev_save_details('', 'X', 'x@example.com', '')$q$) = 'bad_details', 'no first name: bad_details');
  perform pg_temp.ok(pg_temp.t(a, $q$select public.ev_save_details('X', 'X', 'not-an-email', '')$q$) = 'bad_details', 'no email: bad_details');
  perform pg_temp.ok(pg_temp.t(a, format('select public.ev_save_details(%L, %L, %L, %L)', 'X', 'X', 'x@example.com', repeat('9', 31))) = 'bad_details', 'a phone too long: bad_details');
  perform pg_temp.ok(pg_temp.t(g, $q$select public.ev_save_details('G', '', 'g@example.com', '')$q$) = 'need_account', 'a guest account: need_account');

  -- ===================================================== delete ========
  perform pg_temp.ok(pg_temp.t(a, 'select public.ev_delete_saved_details()') = 'ok' and pg_temp.j(a, 'select public.ev_saved_details()') is null, 'delete: gone');
  perform pg_temp.ok(pg_temp.t(a, 'select public.ev_delete_saved_details()') = 'ok', 'deleting when nothing is saved: ok');

  -- ===================================================== switch off and access ========
  update public.ev_settings set value = 'off' where key = 'events_r1';
  perform pg_temp.ok(pg_temp.t(a, $q$select public.ev_save_details('Tolu', '', 'tolu@example.com', '')$q$) = 'not_open', 'with the switch off: not_open');
  perform pg_temp.ok(pg_temp.j(a, 'select public.ev_saved_details()') is null, 'with the switch off: null');
  update public.ev_settings set value = 'on' where key = 'events_r1';
  perform pg_temp.ok(pg_temp.denied('authenticated', 'select * from public.ev_saved_details'), 'authenticated cannot read the table');
  perform pg_temp.ok(pg_temp.denied('anon', 'select * from public.ev_saved_details'), 'anon cannot read the table');
  perform pg_temp.ok(has_function_privilege('anon', 'public.ev_saved_details()', 'execute') = false, 'anon cannot execute ev_saved_details');
  perform pg_temp.ok(has_function_privilege('anon', 'public.ev_save_details(text, text, text, text)', 'execute') = false, 'anon cannot execute ev_save_details');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.ev_delete_saved_details()', 'execute'), 'authenticated can execute ev_delete_saved_details');

  -- ===================================================== account deleted ========
  perform pg_temp.t(a, $q$select public.ev_save_details('Tolu', '', 'tolu@example.com', '')$q$);
  delete from auth.users where id = a;
  perform pg_temp.ok(not exists (select 1 from public.ev_saved_details where user_id = a), 'deleting the account deletes the details');
  raise notice 'ALL EVENTS R1 SAVED DETAILS TESTS PASSED';
end $$;
rollback;
