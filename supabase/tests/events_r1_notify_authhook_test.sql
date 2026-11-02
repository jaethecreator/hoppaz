-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Sign-in email hook (src/app/api/auth/send-email). LOCAL ONLY: everything rolls back.
-- This adds no SQL. The hook writes to tables and calls functions that steps 1 to 3 already made, and this file proves they take what the hook sends.
-- Needs schema.sql, chat_accounts.sql, events_r1_events.sql, events_r1_registrations.sql, events_r1_tickets.sql, events_r1_pops.sql, events_r1_pay.sql
-- and events_r1_notify.sql loaded (and the later notify files if you have them). Ends with ALL AUTH HOOK TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_notify_authhook_test.sql
--
-- What it covers: a send-log line with no queue row, written with the service key the way the hook writes it (the kind is in the error column as
-- auth:<email_action_type>, because the table has no kind column); the table's checks still hold for what the hook might send; nobody but the
-- service role can write or read it; the code allowances the hook spends (mailtrap 150, mailjet 100 for codes, separate from Mailjet's guest 100),
-- taken one by one up to the cap, handed back, and never going over; the bounce webhook still working for an address after a code was sent to it.
begin;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$
begin
  if v is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.fails(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS: % (%)', label, left(sqlerrm, 60);
    return;
  end;
  raise exception 'FAILED: % (it was accepted)', label;
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;
create function pg_temp.as_member() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;

do $$
declare i int; taken boolean; r text;
begin
  -- The seeded allowances.
  perform pg_temp.ok((select daily_cap from public.notify_caps where provider = 'mailtrap' and kind = 'code') = 150, 'mailtrap has 150 code mails a day');
  perform pg_temp.ok((select daily_cap from public.notify_caps where provider = 'mailjet' and kind = 'code') = 100, 'mailjet has 100 for codes');
  perform pg_temp.ok((select daily_cap from public.notify_caps where provider = 'mailjet' and kind = 'guest') = 100, 'and 100 for guest mail, kept apart');

  -- The line the hook writes, as the service role.
  perform pg_temp.as_service();
  insert into public.notify_sends (queue_id, channel, provider, status, provider_message_id, cost_usd, error)
  values (null, 'email', 'mailtrap', 'sent', 'abc-123', 0, 'auth:magiclink');
  insert into public.notify_sends (queue_id, channel, provider, status, provider_message_id, cost_usd, error)
  values (null, 'email', 'mailtrap', 'failed', null, 0, 'auth:signup: mailtrap 500: Internal'),
         (null, 'email', 'mailjet', 'sent', '1152921504606846999', 0, 'auth:email_change'),
         (null, 'email', 'router', 'skipped', null, 0, 'auth:magiclink: every provider is at its daily cap, waiting');
  perform pg_temp.admin();
  perform pg_temp.ok((select count(*) from public.notify_sends where queue_id is null and error like 'auth:%') = 4, 'four hook lines, none with a queue row');
  perform pg_temp.ok((select count(*) from public.notify_sends where queue_id is null and error like 'auth:%' and status = 'sent') = 2, 'two of them sent');

  -- The table's checks still hold for anything the hook could build.
  perform pg_temp.as_service();
  perform pg_temp.fails($f$insert into public.notify_sends (channel, provider, status, error) values ('email', 'mailtrap', 'queued', 'auth:magiclink')$f$, 'a status the table does not know is refused');
  perform pg_temp.fails($f$insert into public.notify_sends (channel, provider, status, error) values ('sms', 'mailtrap', 'sent', null)$f$, 'a channel the table does not know is refused');
  perform pg_temp.fails($f$insert into public.notify_sends (channel, provider, status, error) values ('email', repeat('x', 41), 'sent', null)$f$, 'a provider name over 40 characters is refused');
  perform pg_temp.fails($f$insert into public.notify_sends (channel, provider, status, error) values ('email', 'mailtrap', 'failed', repeat('x', 501))$f$, 'an error over 500 characters is refused (the hook cuts it at 500)');
  insert into public.notify_sends (channel, provider, status, error) values ('email', 'mailtrap', 'failed', repeat('x', 500));
  perform pg_temp.ok(true, 'exactly 500 characters is accepted');
  perform pg_temp.admin();

  -- Nobody else can write or read it.
  perform pg_temp.as_anon();
  perform pg_temp.fails($f$insert into public.notify_sends (channel, provider, status) values ('email', 'mailtrap', 'sent')$f$, 'anon cannot write the send log');
  perform pg_temp.fails($f$select count(*) from public.notify_sends$f$, 'anon cannot read the send log');
  perform pg_temp.as_member();
  perform pg_temp.fails($f$insert into public.notify_sends (channel, provider, status) values ('email', 'mailtrap', 'sent')$f$, 'a signed-in person cannot write the send log');
  perform pg_temp.fails($f$select count(*) from public.notify_sends$f$, 'a signed-in person cannot read the send log (a code line says who signed in)');
  perform pg_temp.fails($f$select public.notify_take_cap('mailtrap', 'code')$f$, 'a signed-in person cannot spend the code allowance');
  perform pg_temp.admin();

  -- The allowance the hook spends: exactly 150 for Mailtrap, then no.
  perform pg_temp.as_service();
  for i in 1..150 loop
    taken := public.notify_take_cap('mailtrap', 'code');
    if not taken then raise exception 'FAILED: unit % of 150 was refused', i; end if;
  end loop;
  perform pg_temp.ok(true, 'all 150 units of mailtrap code mail can be taken');
  perform pg_temp.ok(public.notify_take_cap('mailtrap', 'code') = false, 'the 151st is refused, so the hook moves to Mailjet');
  perform public.notify_give_cap('mailtrap', 'code');
  perform pg_temp.ok(public.notify_take_cap('mailtrap', 'code') = true, 'one handed back (a failed attempt) can be taken again');
  perform pg_temp.ok(public.notify_take_cap('mailtrap', 'code') = false, 'and then it is full again');
  perform pg_temp.admin();
  perform pg_temp.ok((select used from public.notify_cap_use where provider = 'mailtrap' and kind = 'code' and day = public._notify_day(now())) = 150, 'the day count is exactly 150, never over');

  -- Mailjet's code allowance is its own.
  perform pg_temp.as_service();
  perform pg_temp.ok(public.notify_take_cap('mailjet', 'code') = true, 'mailjet code mail is untouched by mailtrap being full');
  perform pg_temp.ok(public.notify_take_cap('mailjet', 'guest') = true, 'mailjet guest mail is untouched by code mail');
  perform pg_temp.ok(public.notify_take_cap('mailtrap', 'guest') = false, 'mailtrap has no guest allowance at all (no row means no allowance)');
  perform pg_temp.ok(public.notify_take_cap('mailtrap', 'code', 0) = false, 'taking zero units is refused');
  perform public.notify_give_cap('mailjet', 'code', 5);
  perform pg_temp.admin();
  perform pg_temp.ok((select used from public.notify_cap_use where provider = 'mailjet' and kind = 'code' and day = public._notify_day(now())) = 0, 'handing back more than was used stops at zero');

  -- A day later the count starts again (Lagos days).
  perform pg_temp.as_service();
  perform pg_temp.ok(public.notify_take_cap('mailtrap', 'code', 1, now() + interval '1 day') = true, 'tomorrow mailtrap has room again');
  perform pg_temp.admin();

  -- A bounce webhook for an address a code was sent to still works: the code line has no queue row, so it is simply not matched, and the list is still written.
  r := public.notify_apply_event('mailjet', 'bounced', '1152921504606846999', null, 'Ada@Example.com', true, 'user unknown');
  perform pg_temp.ok(r = 'applied', 'a hard bounce of a mailed code is applied: the address is listed for guest mail');
  perform pg_temp.ok((select reason from public.notify_suppressed where address = 'ada@example.com') = 'hard_bounce', 'on the suppression list');
  -- And the hook never reads that list: that rule is in scripts/notify-authhook-check.mts ("suppression and the notify_email flag are not read").
  perform pg_temp.ok(not exists (select 1 from public.notify_sends where error like '%@%'), 'no email address in any hook line');

  raise notice 'ALL AUTH HOOK TESTS PASSED';
end $$;
rollback;
