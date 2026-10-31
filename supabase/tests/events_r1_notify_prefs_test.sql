-- DRAFT FOR OLA, NOT RUN ON PRODUCTION. Notifications step 3 (supabase/events_r1_notify_prefs.sql). LOCAL ONLY: everything rolls back.
-- Needs schema.sql, chat_accounts.sql, events_r1_events.sql, events_r1_registrations.sql, events_r1_tickets.sql, events_r1_pops.sql, events_r1_pay.sql,
-- events_r1_notify.sql, events_r1_notify_emails.sql and events_r1_notify_prefs.sql loaded (the notify set loaded twice is a good habit: it must be safe
-- to run again). Ends with ALL NOTIFY PREFS TESTS PASSED.
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d <a throwaway hoppaz_ev_ database> -q -v ON_ERROR_STOP=1 < supabase/tests/events_r1_notify_prefs_test.sql
--
-- What it covers: who can call what; the two email settings written by the server (the unsubscribe link) and by a signed-in person (the
-- settings page), and the claim from step 1 really obeying them; suppression writes; provider events (delivered, soft and hard bounce, complaint)
-- applied by message id, by queue id, and with no known send, replayed over and over; no address kept in a reason.
begin;
select public.ev_set_setting('events_r1', 'on');
-- Step 2's triggers would queue their own mails for the registrations made below; this file queues exactly what it needs.
do $off$
declare t record;
begin
  for t in
    select c.relname, g.tgname from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not g.tgisinternal
       and g.tgname in ('notify_reg_insert', 'notify_reg_update', 'notify_order_status', 'notify_event_change', 'notify_event_insert', 'notify_event_status',
                        'notify_link_insert', 'notify_link_update', 'notify_host_pop_insert', 'notify_host_pop_update')
  loop
    execute format('alter table public.%I disable trigger %I', t.relname, t.tgname);
  end loop;
end $off$;
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
create function pg_temp.anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;
create function pg_temp.admin() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.newuser(shown text, guest boolean default false) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          case when guest then null else 'prf-' || u || '@evtest.invalid' end, guest, '{}', json_build_object('name', shown)::jsonb, now(), now());
  update public.profiles set display_name = shown where id = u;
  return u;
end $$;
create function pg_temp.mail(u uuid) returns text language sql as $$ select lower(btrim(email)) from auth.users where id = u; $$;
create function pg_temp.ev(host uuid, ttl text, starts timestamptz) returns uuid language sql as $$
  insert into public.events (title, venue_name, starts_at, status, host_id, kind, created_at)
  values (ttl, 'Somewhere', starts, 'live', host, 'in_person', now() - interval '5 days') returning id;
$$;
create function pg_temp.reg(ev uuid, u uuid) returns void language sql as $$
  insert into public.ev_registrations (event_id, user_id, status, name, created_at) values (ev, u, 'going', 'x', now() - interval '3 days');
$$;
-- A queue row and its 'sent' line, the way notify_complete leaves them.
create function pg_temp.sent(u uuid, prov text, mid text) returns uuid language plpgsql as $$
declare q uuid := gen_random_uuid();
begin
  insert into public.notify_queue (id, user_id, kind, channel, dedupe_key, status) values (q, u, 'registered', 'email', 'prf-' || q, 'sent');
  insert into public.notify_sends (queue_id, channel, provider, status, provider_message_id) values (q, 'email', prov, 'sent', mid);
  return q;
end $$;
create function pg_temp.lines(q uuid, st text) returns integer language sql as $$ select count(*)::int from public.notify_sends where queue_id = q and status = st; $$;
create function pg_temp.listed(a text) returns text language sql as $$ select reason from public.notify_suppressed where address = a; $$;

do $$
declare
  a uuid := pg_temp.newuser('Prf A'); b uuid := pg_temp.newuser('Prf B'); g uuid := pg_temp.newuser('Prf guest', true); h uuid := pg_temp.newuser('Prf host');
  e uuid; r jsonb; n int; q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; q6 uuid; f record; sends_before int; ra text; rb text;
begin
  -- ------------------------------------------------------------ who can call what ---
  for f in select p.oid, p.oid::regprocedure as sig, p.proname as name
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and p.proname in ('_notify_mid', '_notify_addr', 'notify_get_prefs', 'notify_set_pref', 'notify_suppress', 'notify_unsuppress', 'notify_apply_event', 'notify_apply_events')
  loop
    perform pg_temp.ok(not has_function_privilege('anon', f.oid, 'execute') and not has_function_privilege('authenticated', f.oid, 'execute'), f.sig || ': anon and authenticated cannot call');
    perform pg_temp.ok(f.name ~ '^_' or has_function_privilege('service_role', f.oid, 'execute'), f.sig || ': the service role can call');
  end loop;
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.notify_get_my_prefs()', 'execute') and has_function_privilege('authenticated', 'public.notify_set_my_prefs(boolean, boolean)', 'execute')
                     and not has_function_privilege('anon', 'public.notify_get_my_prefs()', 'execute') and not has_function_privilege('anon', 'public.notify_set_my_prefs(boolean, boolean)', 'execute'),
                     'the person-facing settings functions are for signed-in roles only');
  begin
    perform pg_temp.actor(a);
    perform public.notify_set_pref(b, 'reminders', false);
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a signed-in person must not set someone else''s preference');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a signed-in person cannot call the server''s setter on anyone');
  end;
  begin
    perform pg_temp.actor(a);
    perform public.notify_suppress('x@y.test', 'complaint');
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a signed-in person must not write the suppression list');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a signed-in person cannot write the suppression list');
  end;
  begin
    perform pg_temp.actor(a);
    perform public.notify_apply_event('brevo', 'complained', 'm1', null, 'x@y.test');
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a signed-in person must not post provider events');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a signed-in person cannot post provider events');
  end;
  begin
    perform pg_temp.anon();
    perform public.notify_get_my_prefs();
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'anon must not read settings');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'anon cannot read or change settings');
  end;

  -- ------------------------------------------------------------ the server sets a preference (the unsubscribe link) ---
  perform pg_temp.ok(public.notify_get_prefs(a) = '{"email_reminders": true, "email_pops": true}'::jsonb, 'no row: both email settings are on');
  perform pg_temp.ok(public.notify_get_prefs(gen_random_uuid()) is null and public.notify_get_prefs(null) is null, 'a person who does not exist reads as null');
  perform pg_temp.ok(public.notify_set_pref(a, 'reminders', false) is true, 'reminders off: applied');
  -- (A stable function in the same statement as a write would not see it, so each check below is its own statement.)
  perform pg_temp.ok(public.notify_get_prefs(a) = '{"email_reminders": false, "email_pops": true}'::jsonb, 'reminders off leaves Pops on');
  perform public.notify_set_pref(a, 'pops', false);
  perform pg_temp.ok(public.notify_get_prefs(a) = '{"email_reminders": false, "email_pops": false}'::jsonb, 'Pops off leaves reminders off');
  perform public.notify_set_pref(a, 'reminders', false);
  perform pg_temp.ok((select count(*) from public.notify_prefs where user_id = a) = 1, 'turning off twice is harmless: still one row');
  perform public.notify_set_pref(a, 'reminders', true);
  perform pg_temp.ok(public.notify_get_prefs(a) = '{"email_reminders": true, "email_pops": false}'::jsonb, 'turn back on: reminders on, Pops still off');
  perform pg_temp.ok(public.notify_set_pref(gen_random_uuid(), 'reminders', false) is false and public.notify_set_pref(null, 'reminders', false) is false, 'no such person: false, nothing written');
  begin
    perform public.notify_set_pref(a, 'whatsapp', true);
    perform pg_temp.ok(false, 'an unknown setting must be refused');
  exception when invalid_parameter_value then
    perform pg_temp.ok(true, 'an unknown setting is refused (WhatsApp cannot be reached through here)');
  end;
  perform pg_temp.ok((select whatsapp_on from public.notify_prefs where user_id = a) is false and (select whatsapp_number from public.notify_prefs where user_id = a) is null, 'the WhatsApp columns are untouched');
  perform pg_temp.ok((select count(*) from public.notify_prefs where user_id = b) = 0, 'nobody else got a row');
  delete from public.notify_prefs;

  -- ------------------------------------------------------------ a signed-in person: their own settings only ---
  perform pg_temp.actor(a);
  r := public.notify_get_my_prefs();
  perform pg_temp.admin();
  perform pg_temp.ok(r = '{"email_reminders": true, "email_pops": true, "whatsapp_on": false}'::jsonb, 'a person with no row reads both on, WhatsApp off');
  perform pg_temp.actor(a);
  r := public.notify_set_my_prefs(false, null);
  perform pg_temp.admin();
  perform pg_temp.ok(r = '{"email_reminders": false, "email_pops": true, "whatsapp_on": false}'::jsonb, 'reminders off, Pops (null) untouched, and the answer is the new state');
  perform pg_temp.actor(a);
  r := public.notify_set_my_prefs(null, false);
  perform pg_temp.admin();
  perform pg_temp.ok(r = '{"email_reminders": false, "email_pops": false, "whatsapp_on": false}'::jsonb, 'Pops off, reminders (null) untouched');
  perform pg_temp.actor(a);
  r := public.notify_set_my_prefs(true, true);
  perform pg_temp.admin();
  perform pg_temp.ok(r = '{"email_reminders": true, "email_pops": true, "whatsapp_on": false}'::jsonb, 'both back on');
  perform pg_temp.actor(b);
  r := public.notify_get_my_prefs();
  perform pg_temp.admin();
  perform pg_temp.ok(r ->> 'email_reminders' = 'true' and (select count(*) from public.notify_prefs where user_id = b) = 0, 'a second person is not affected by the first');
  insert into public.notify_prefs (user_id, email_reminders, whatsapp_on, whatsapp_number, agreed_at, agreed_how) values (b, true, true, '+2348012345678', now(), 'checkout');
  perform pg_temp.actor(b);
  r := public.notify_set_my_prefs(false, null);
  perform pg_temp.admin();
  perform pg_temp.ok((r ->> 'whatsapp_on') = 'true' and (select whatsapp_number from public.notify_prefs where user_id = b) = '+2348012345678' and (select agreed_how from public.notify_prefs where user_id = b) = 'checkout',
                     'changing email settings leaves a WhatsApp agreement exactly as it was');
  begin
    perform pg_temp.actor(g);
    perform public.notify_set_my_prefs(false, null);
    perform pg_temp.admin();
    perform pg_temp.ok(false, 'a guest session must not have settings');
  exception when insufficient_privilege then
    perform pg_temp.admin();
    perform pg_temp.ok(true, 'a guest session (no account) is told to sign in');
  end;
  perform pg_temp.ok((select count(*) from public.notify_prefs where user_id = g) = 0, 'and a guest got no row');
  delete from public.notify_prefs;

  -- ------------------------------------------------------------ the claim from step 1 obeys what these functions write ---
  perform public.notify_set_flag('notify_email', 'on'); perform public.notify_set_flag('notify_whatsapp', 'off');
  e := pg_temp.ev(h, 'Prefs night', now() + interval '3 days');
  perform pg_temp.reg(e, a); perform pg_temp.reg(e, b);
  delete from public.notify_queue;
  perform public.notify_set_pref(a, 'reminders', false);
  perform public.notify_set_pref(b, 'pops', false);
  perform public.notify_enqueue(a, 'reminder_day', e, '{}', 2, null, 'cl-a-day');
  perform public.notify_enqueue(a, 'thanks', e, '{}', 3, null, 'cl-a-thanks');
  perform public.notify_enqueue(a, 'host_pop', e, '{}', 3, null, 'cl-a-pop');
  perform public.notify_enqueue(b, 'reminder_day', e, '{}', 2, null, 'cl-b-day');
  perform public.notify_enqueue(b, 'host_pop', e, '{}', 3, null, 'cl-b-pop');
  r := public.notify_claim_due();
  perform pg_temp.ok((select count(*) from jsonb_array_elements(r) x where x ->> 'dedupe_key' = 'cl-a-day') = 0
                     and (select count(*) from jsonb_array_elements(r) x where x ->> 'dedupe_key' = 'cl-a-thanks') = 0,
                     'reminders off (set through notify_set_pref): the day-before reminder and the thank-you are not handed out');
  perform pg_temp.ok((select count(*) from jsonb_array_elements(r) x where x ->> 'dedupe_key' = 'cl-a-pop') = 1, 'reminders off does not stop a host Pop (that is the Pops setting)');
  perform pg_temp.ok((select count(*) from jsonb_array_elements(r) x where x ->> 'dedupe_key' = 'cl-b-pop') = 0 and (select count(*) from jsonb_array_elements(r) x where x ->> 'dedupe_key' = 'cl-b-day') = 1,
                     'Pops off stops the host Pop and leaves the reminder');
  perform pg_temp.ok((select count(*) from public.notify_sends s join public.notify_queue q on q.id = s.queue_id where q.dedupe_key = 'cl-a-day' and s.error like '%reminders are off%') = 1, 'the skip is logged with its reason');
  -- Turning them back on lets a new message through.
  perform public.notify_set_pref(a, 'reminders', true);
  perform public.notify_enqueue(a, 'reminder_hour', e, '{}', 4, null, 'cl-a-hour');
  r := public.notify_claim_due();
  perform pg_temp.ok((select count(*) from jsonb_array_elements(r) x where x ->> 'dedupe_key' = 'cl-a-hour') = 1, 'back on: the next reminder is handed out');
  delete from public.notify_queue; delete from public.notify_prefs; delete from public.notify_sends;

  -- ------------------------------------------------------------ suppression writes ---
  perform pg_temp.ok(public.notify_suppress('  Some.One@Example.COM ', 'complaint') is true and pg_temp.listed('some.one@example.com') = 'complaint', 'suppress: the address is kept lower case and trimmed');
  perform pg_temp.ok(public.notify_suppress('some.one@example.com', 'hard_bounce') is false and pg_temp.listed('some.one@example.com') = 'complaint', 'suppress: again is harmless and keeps the first reason');
  begin
    perform public.notify_suppress('not an address', 'complaint');
    perform pg_temp.ok(false, 'a bad address must be refused');
  exception when invalid_parameter_value then
    perform pg_temp.ok(true, 'suppress: a bad address is refused');
  end;
  begin
    perform public.notify_suppress('a@b.test', '   ');
    perform pg_temp.ok(false, 'a blank reason must be refused');
  exception when invalid_parameter_value then
    perform pg_temp.ok(true, 'suppress: a reason is needed');
  end;
  perform pg_temp.ok(public.notify_unsuppress('SOME.ONE@example.com') is true, 'unsuppress: takes it off');
  perform pg_temp.ok(pg_temp.listed('some.one@example.com') is null and public.notify_unsuppress('some.one@example.com') is false and public.notify_unsuppress('junk') is false, 'unsuppress: then says it was not there');
  -- The claim already refuses a suppressed address (step 1): check it sees what is written here.
  perform public.notify_suppress(pg_temp.mail(a), 'hard_bounce');
  perform public.notify_enqueue(a, 'registered', e, '{}', 1, null, 'sup-a');
  r := public.notify_claim_due();
  perform pg_temp.ok((select count(*) from jsonb_array_elements(r) x where x ->> 'dedupe_key' = 'sup-a') = 0
                     and (select count(*) from public.notify_sends s join public.notify_queue q on q.id = s.queue_id where q.dedupe_key = 'sup-a' and s.error like '%suppressed%') = 1,
                     'a suppressed address gets nothing from the claim, and the skip is logged');
  delete from public.notify_queue; delete from public.notify_suppressed; delete from public.notify_sends;

  -- ------------------------------------------------------------ provider events: delivered ---
  q1 := pg_temp.sent(a, 'brevo', '<abc123.456@smtp.relay.test>');
  ra := public.notify_apply_event('brevo', 'delivered', 'abc123.456@smtp.relay.test');
  perform pg_temp.ok(ra = 'applied' and pg_temp.lines(q1, 'delivered') = 1 and pg_temp.lines(q1, 'sent') = 1, 'delivered: matched with or without the angle brackets, and the sent line stays');
  perform pg_temp.ok((select provider_message_id from public.notify_sends where queue_id = q1 and status = 'delivered') = 'abc123.456@smtp.relay.test' and (select queue_id from public.notify_sends where status = 'delivered') = q1, 'the delivered line points at the same queue row');
  for n in 1..3 loop ra := public.notify_apply_event('brevo', 'delivered', '<abc123.456@smtp.relay.test>'); end loop;
  perform pg_temp.ok(ra = 'duplicate' and pg_temp.lines(q1, 'delivered') = 1, 'delivered replayed three times (with brackets this time): still one line');
  perform pg_temp.ok(public.notify_apply_event('brevo', 'delivered', 'nobody-knows-this') = 'unmatched' and (select count(*) from public.notify_sends) = 2, 'delivered for a send we do not know: dropped, no orphan line');
  perform pg_temp.ok(public.notify_apply_event('mailjet', 'delivered', 'abc123.456@smtp.relay.test') = 'unmatched', 'another provider''s message id is not matched to this send');
  perform pg_temp.ok(public.notify_apply_event('brevo', 'opened', 'abc123.456@smtp.relay.test') = 'ignored' and public.notify_apply_event('Bad Name', 'delivered', 'x') = 'ignored' and public.notify_apply_event(null, 'delivered', 'x') = 'ignored',
                     'an event we do not keep, and a bad provider name, are ignored');

  -- ------------------------------------------------------------ soft bounce: logged, never suppressed ---
  q2 := pg_temp.sent(a, 'brevo', 'soft-1@relay.test');
  ra := public.notify_apply_event('brevo', 'bounced', 'soft-1@relay.test', null, 'Full.Box@Example.com', false, 'mailbox full');
  perform pg_temp.ok(ra = 'applied' and pg_temp.lines(q2, 'bounced') = 1 and (select error from public.notify_sends where queue_id = q2 and status = 'bounced') = 'soft bounce: mailbox full', 'soft bounce: a bounced line that says it is soft');
  perform pg_temp.ok(not exists (select 1 from public.notify_suppressed), 'soft bounce: nothing in notify_suppressed');
  ra := public.notify_apply_event('brevo', 'bounced', 'soft-1@relay.test', null, 'Full.Box@Example.com', false, 'mailbox full');
  perform pg_temp.ok(ra = 'duplicate' and pg_temp.lines(q2, 'bounced') = 1 and not exists (select 1 from public.notify_suppressed), 'soft bounce replayed: still one line, still not suppressed');
  for n in 1..5 loop perform public.notify_apply_event('brevo', 'bounced', 'soft-1@relay.test', null, 'full.box@example.com', false, 'mailbox full'); end loop;
  perform pg_temp.ok(not exists (select 1 from public.notify_suppressed), 'soft bounces, however many, never suppress');

  -- ------------------------------------------------------------ hard bounce: suppressed, once ---
  ra := public.notify_apply_event('brevo', 'bounced', 'soft-1@relay.test', null, ' Full.Box@Example.com ', true, 'user unknown');
  perform pg_temp.ok(ra = 'applied' and pg_temp.listed('full.box@example.com') = 'hard_bounce', 'hard bounce (after a soft one on the same message): the address is suppressed, lower case');
  perform pg_temp.ok(pg_temp.lines(q2, 'bounced') = 2 and (select count(*) from public.notify_sends where queue_id = q2 and error = 'hard bounce: user unknown') = 1, 'and both bounces are in the log, each once');
  for n in 1..3 loop ra := public.notify_apply_event('brevo', 'bounced', '<soft-1@relay.test>', null, 'full.box@example.com', true, 'user unknown'); end loop;
  perform pg_temp.ok(ra = 'duplicate' and (select count(*) from public.notify_suppressed) = 1 and pg_temp.lines(q2, 'bounced') = 2, 'hard bounce replayed: no new line, no second list entry');

  -- ------------------------------------------------------------ complaint, matched by queue id (Mailjet CustomID) when the message id is unknown ---
  q3 := pg_temp.sent(b, 'mailjet', '1152921512345678');
  ra := public.notify_apply_event('mailjet', 'complained', '999-not-ours', q3::text, 'Angry.Guest@Example.com', false, 'JMRPP');
  perform pg_temp.ok(ra = 'applied' and pg_temp.listed('angry.guest@example.com') = 'complaint' and pg_temp.lines(q3, 'complained') = 1, 'complaint: found through CustomID when the message id is not in the log, suppressed, and logged on that queue row');
  ra := public.notify_apply_event('mailjet', 'complained', '999-not-ours', upper(q3::text), 'angry.guest@example.com', false, 'JMRPP');
  perform pg_temp.ok(ra = 'duplicate' and pg_temp.lines(q3, 'complained') = 1 and (select count(*) from public.notify_suppressed) = 2, 'complaint replayed (queue id in capitals): nothing new');
  -- A complaint whose send is in the log by message id only (the Brevo case: no queue id in the event).
  q4 := pg_temp.sent(a, 'brevo', 'only-the-id@relay.test');
  ra := public.notify_apply_event('brevo', 'complained', 'only-the-id@relay.test', null, 'Spammy@Example.com', false, null);
  perform pg_temp.ok(ra = 'applied' and pg_temp.listed('spammy@example.com') = 'complaint' and pg_temp.lines(q4, 'complained') = 1, 'complaint: matched by message id alone, and the address comes from the event');
  -- A complaint with no send we know of still suppresses.
  sends_before := (select count(*) from public.notify_sends);
  ra := public.notify_apply_event('brevo', 'complained', 'never-sent-by-us@relay.test', null, 'stranger@example.com');
  perform pg_temp.ok(ra = 'applied' and pg_temp.listed('stranger@example.com') = 'complaint' and (select count(*) from public.notify_sends) = sends_before, 'complaint for a send we cannot find: the address is still suppressed, and no orphan line is written');
  ra := public.notify_apply_event('brevo', 'complained', 'never-sent-by-us@relay.test', null, 'stranger@example.com');
  perform pg_temp.ok(ra = 'unmatched' and (select count(*) from public.notify_suppressed where address = 'stranger@example.com') = 1, 'and again: harmless');
  -- A queue id that is not a queue row, or not a uuid at all, finds nothing and breaks nothing.
  perform pg_temp.ok(public.notify_apply_event('mailjet', 'delivered', null, gen_random_uuid()::text) = 'unmatched' and public.notify_apply_event('mailjet', 'delivered', null, 'not-a-uuid') = 'unmatched', 'a queue id that is unknown or not a uuid matches nothing');
  -- A hard bounce with no address in the event cannot suppress anyone (the queue row''s person is NOT used: their address may have changed).
  q5 := pg_temp.sent(b, 'brevo', 'no-address@relay.test');
  ra := public.notify_apply_event('brevo', 'bounced', 'no-address@relay.test', null, null, true, 'user unknown');
  perform pg_temp.ok(pg_temp.lines(q5, 'bounced') = 1 and not exists (select 1 from public.notify_suppressed where address in (pg_temp.mail(a), pg_temp.mail(b))), 'no address in the event: logged, and the person''s current address is not suppressed on a guess');

  -- ------------------------------------------------------------ no address kept in a reason ---
  q6 := pg_temp.sent(a, 'mailjet', '777');
  perform public.notify_apply_event('mailjet', 'bounced', '777', null, 'dead@example.com', true, '550 5.1.1 <dead@example.com>: user unknown; also try other@example.org, thanks');
  perform pg_temp.ok((select error from public.notify_sends where queue_id = q6 and status = 'bounced') !~ '@' and (select error from public.notify_sends where queue_id = q6 and status = 'bounced') like 'hard bounce: 550 5.1.1 <***>: user unknown; also try ***, thanks',
                     'a bounce text that quotes addresses is stored with them removed');

  -- ------------------------------------------------------------ a whole batch, replayed ---
  r := public.notify_apply_events('brevo', jsonb_build_array(
    jsonb_build_object('event', 'delivered', 'message_id', 'abc123.456@smtp.relay.test'),
    jsonb_build_object('event', 'bounced', 'message_id', 'batch-1@relay.test', 'address', 'batch1@example.com', 'hard', true, 'reason', 'user unknown'),
    jsonb_build_object('event', 'bounced', 'message_id', 'batch-2@relay.test', 'address', 'batch2@example.com', 'hard', false),
    jsonb_build_object('event', 'complained', 'message_id', 'batch-3@relay.test', 'queue_id', q4::text, 'address', 'batch3@example.com'),
    jsonb_build_object('event', 'opened', 'message_id', 'x'),
    'not an object', 42));
  perform pg_temp.ok(r = '{"applied": 2, "duplicate": 1, "unmatched": 1, "ignored": 3}'::jsonb, 'batch: delivered already seen (duplicate), a hard bounce for an unknown send suppresses and so does a complaint found by queue id (applied), a soft one for an unknown send is dropped (unmatched), junk is ignored');
  perform pg_temp.ok(pg_temp.listed('batch1@example.com') = 'hard_bounce' and pg_temp.listed('batch3@example.com') = 'complaint' and pg_temp.listed('batch2@example.com') is null, 'batch: the hard bounce and the complaint are on the list, the soft bounce is not');
  perform pg_temp.ok(public.notify_apply_events('brevo', null) = '{"applied": 0, "duplicate": 0, "unmatched": 0, "ignored": 0}'::jsonb and public.notify_apply_events('brevo', '{}'::jsonb) = '{"applied": 0, "duplicate": 0, "unmatched": 0, "ignored": 0}'::jsonb, 'batch: not an array answers all zeros');
  sends_before := (select count(*) from public.notify_sends);
  r := public.notify_apply_events('brevo', jsonb_build_array(
    jsonb_build_object('event', 'delivered', 'message_id', 'abc123.456@smtp.relay.test'),
    jsonb_build_object('event', 'bounced', 'message_id', 'batch-1@relay.test', 'address', 'batch1@example.com', 'hard', true, 'reason', 'user unknown')));
  perform pg_temp.ok((r ->> 'applied') = '0' and (select count(*) from public.notify_sends) = sends_before and (select count(*) from public.notify_suppressed where address = 'batch1@example.com') = 1, 'the batch sent again: nothing applied, nothing added');

  -- ------------------------------------------------------------ and the list protects the next send ---
  perform public.notify_suppress(pg_temp.mail(b), 'hard_bounce');
  delete from public.notify_queue where dedupe_key = 'z';
  perform public.notify_enqueue(b, 'reminder_day', e, '{}', 2, null, 'z');
  r := public.notify_claim_due();
  perform pg_temp.ok((select count(*) from jsonb_array_elements(r) x where x ->> 'dedupe_key' = 'z') = 0, 'after a hard bounce is applied, the next mail to that address is skipped by the claim');

  raise notice 'ALL NOTIFY PREFS TESTS PASSED';
end $$;
rollback;
