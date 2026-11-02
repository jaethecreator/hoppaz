-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1: notifications, step 3 (who can change the email settings, the suppression list, and what the providers tell us).
-- Plans: docs/reminders-email-plan.md ("Update, 31 Oct", and section 3, "Providers' webhooks"). Steps 1 and 2 are events_r1_notify.sql and
-- events_r1_notify_emails.sql.
--
-- RUN ORDER: the Release 1 files, events_r1_notify.sql, events_r1_notify_emails.sql, then THIS FILE. Safe to run again. It adds functions
-- only: no table, no column, no trigger, and it edits no older function. notify_prefs, notify_suppressed and notify_sends are the step 1
-- tables; until now nothing could write to the first two.
--
-- NOTHING IS SENT FROM HERE.
--
-- WHAT IT ADDS
--   For the Next.js server (service role only; nobody signed in can call them):
--     notify_get_prefs(user)                    the two email settings of one person (no row means both on), or null if there is no such person.
--     notify_set_pref(user, setting, on)        'reminders' (email_reminders: G10, G11, G15) or 'pops' (email_pops: G12). Used by the
--                                               signed unsubscribe link, which has no sign-in. false when there is no such person.
--     notify_suppress(address, reason)          adds an address to notify_suppressed. true when it was new.
--     notify_unsuppress(address)                takes one off again (a hard bounce that was a mistake). true when it was there.
--     notify_apply_event(...)                   one provider event (delivered, bounced, complained) applied to the send log and the list.
--     notify_apply_events(provider, events)     the same for a json array, with the counts. This is what the webhook route calls.
--   For a signed-in person (an account, not a guest session):
--     notify_get_my_prefs()                     their own email settings.
--     notify_set_my_prefs(reminders, pops)      change either or both (null leaves one alone). WhatsApp is not touched here.
--
-- PROVIDER EVENTS (what the webhooks send, from the providers' own docs; src/lib/notify/hooks.ts reads them into the arguments below)
--   Brevo   event, email, message-id (the Send API returns it in <angle brackets>, the webhook may not), X-Mailin-custom (our queue id,
--           set by brevo.ts), reason. Brevo does NOT echo our X-Hoppaz-Queue header, only X-Mailin-custom and tags.
--   Mailjet event, email, MessageID (the same number the Send API returned), CustomID (our queue id), hard_bounce, blocked, error, comment.
--   Both always say which address the event is about, so the address is taken from the event. It is NOT looked up from the queue row's
--   person: people change their email address, and suppressing whoever has the address today could silence an innocent new address.
--   The queue id (X-Mailin-custom / CustomID) is used to find the send when the message id does not match (a webhook that beats the
--   send log by a second, or a message id written another way).
--
-- THE RULES
--   hard bounce   -> notify_suppressed (reason 'hard_bounce'), and a 'bounced' line in notify_sends.
--   complaint     -> notify_suppressed (reason 'complaint'), and a 'complained' line in notify_sends.
--   soft bounce   -> a 'bounced' line in notify_sends ("soft bounce: ..."), and NOTHING in notify_suppressed. A full mailbox is not a dead address.
--   delivered     -> a 'delivered' line in notify_sends.
--   The log is append only: the 'sent' line stays as it was, and an event adds its own line next to it (same queue row, provider and message id).
--   A REPLAY IS HARMLESS: providers resend. A line is written only if no line with the same provider, message id, status and reason is
--   there; the suppression insert does nothing when the address is already listed. Replaying a whole batch changes nothing and answers
--   'duplicate' for each event.
--   A delivered, or a soft bounce, whose send cannot be found is dropped ('unmatched'), not logged as an orphan. A hard bounce or a complaint
--   whose send cannot be found STILL suppresses the address: the provider's word about an address is enough.
--   Reasons are written without any email address in them (a bounce text often quotes the address).
-- ============================================================================
begin;

-- ------------------------------------------------------------------ small helpers ---
-- A provider message id the way we compare it: no spaces, no <angle brackets>. null for nothing.
create or replace function public._notify_mid(p_id text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select nullif(btrim(btrim(coalesce(p_id, '')), '<>'), '');
$$;

-- An address the way notify_suppressed keeps it (lower case, trimmed), or null if it cannot be one.
create or replace function public._notify_addr(p_addr text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when lower(btrim(coalesce(p_addr, ''))) ~ '^[^@[:space:]]+@[^@[:space:]]+$' and char_length(lower(btrim(p_addr))) between 3 and 320
              then lower(btrim(p_addr)) end;
$$;

-- ------------------------------------------------------------------ preferences, for the server ---
create or replace function public.notify_get_prefs(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p record;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return null; end if;
  select np.email_reminders, np.email_pops into p from public.notify_prefs np where np.user_id = p_user;
  return jsonb_build_object('email_reminders', coalesce(p.email_reminders, true), 'email_pops', coalesce(p.email_pops, true));
end $$;

create or replace function public.notify_set_pref(p_user uuid, p_setting text, p_on boolean) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_setting is null or p_setting not in ('reminders', 'pops') or p_on is null then
    raise exception 'unknown email setting' using errcode = '22023';
  end if;
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return false; end if;
  if p_setting = 'reminders' then
    insert into public.notify_prefs (user_id, email_reminders) values (p_user, p_on)
    on conflict (user_id) do update set email_reminders = excluded.email_reminders, updated_at = now();
  else
    insert into public.notify_prefs (user_id, email_pops) values (p_user, p_on)
    on conflict (user_id) do update set email_pops = excluded.email_pops, updated_at = now();
  end if;
  return true;
end $$;

-- ------------------------------------------------------------------ preferences, for a signed-in person ---
create or replace function public.notify_get_my_prefs() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); p record;
begin
  if me is null or not public.has_account() then raise exception 'Sign in first' using errcode = '42501'; end if;
  select np.email_reminders, np.email_pops, np.whatsapp_on into p from public.notify_prefs np where np.user_id = me;
  return jsonb_build_object('email_reminders', coalesce(p.email_reminders, true), 'email_pops', coalesce(p.email_pops, true), 'whatsapp_on', coalesce(p.whatsapp_on, false));
end $$;

-- null leaves a setting as it is. The WhatsApp columns are never touched here (they come with the WhatsApp step).
create or replace function public.notify_set_my_prefs(p_reminders boolean default null, p_pops boolean default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null or not public.has_account() then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_reminders is not null then perform public.notify_set_pref(me, 'reminders', p_reminders); end if;
  if p_pops is not null then perform public.notify_set_pref(me, 'pops', p_pops); end if;
  return public.notify_get_my_prefs();
end $$;

-- ------------------------------------------------------------------ suppression ---
create or replace function public.notify_suppress(p_address text, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare a text := public._notify_addr(p_address); n integer;
begin
  if a is null then raise exception 'not an email address' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 60 then raise exception 'a reason of 1 to 60 characters is needed' using errcode = '22023'; end if;
  insert into public.notify_suppressed (address, reason) values (a, btrim(p_reason)) on conflict (address) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.notify_unsuppress(p_address text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare a text := public._notify_addr(p_address); n integer;
begin
  if a is null then return false; end if;
  delete from public.notify_suppressed where address = a;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ------------------------------------------------------------------ provider events ---
-- p_event: delivered | bounced | complained (anything else answers 'ignored').
-- p_hard: for 'bounced' only. true: the address is dead, suppress it. false: a soft bounce, log it and leave the list alone.
-- Answers: applied (a new log line or a new suppression), duplicate (seen before, nothing new), unmatched (we do not know that send and
-- there was nothing to suppress), ignored (not an event we keep).
create or replace function public.notify_apply_event(
  p_provider text, p_event text, p_message_id text default null, p_queue text default null,
  p_address text default null, p_hard boolean default false, p_reason text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_mid    text := public._notify_mid(p_message_id);
  v_addr   text := public._notify_addr(p_address);
  v_queue  uuid;
  v_why    text;
  v_hit    integer;
  v_new    boolean := false;
  v_seen   boolean := false;
begin
  if p_provider is null or p_provider !~ '^[a-z0-9_]{1,40}$' or p_event is null or p_event not in ('delivered', 'bounced', 'complained') then return 'ignored'; end if;

  -- The send: by the provider's message id, else by our own queue id that the provider handed back.
  if v_mid is not null then
    select s.queue_id into v_queue from public.notify_sends s
     where s.provider = p_provider and s.provider_message_id in (v_mid, '<' || v_mid || '>') and s.queue_id is not null
     order by (s.status = 'sent') desc, s.created_at limit 1;
  end if;
  if v_queue is null and p_queue ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select q.id into v_queue from public.notify_queue q where q.id = p_queue::uuid;
  end if;

  -- The list first: this is the part that protects our standing with the providers.
  if (p_event = 'complained' or (p_event = 'bounced' and coalesce(p_hard, false))) and v_addr is not null then
    insert into public.notify_suppressed (address, reason) values (v_addr, case when p_event = 'complained' then 'complaint' else 'hard_bounce' end)
    on conflict (address) do nothing;
    get diagnostics v_hit = row_count;
    v_new := v_hit = 1;
  end if;

  if v_queue is null then
    return case when v_new then 'applied' else 'unmatched' end;
  end if;

  v_why := case
    when p_event = 'bounced' and not coalesce(p_hard, false) then 'soft bounce' || coalesce(': ' || p_reason, '')
    when p_event = 'bounced' then 'hard bounce' || coalesce(': ' || p_reason, '')
    when p_event = 'complained' then 'complaint' || coalesce(': ' || p_reason, '')
    else null end;
  -- No email address is kept in the reason.
  v_why := left(regexp_replace(v_why, '[^[:space:]<>"'',;]+@[^[:space:]<>"'',;]+', '***', 'g'), 300);

  select exists (
    select 1 from public.notify_sends s
     where s.provider = p_provider and s.status = case p_event when 'bounced' then 'bounced' when 'complained' then 'complained' else 'delivered' end
       and coalesce(s.error, '') = coalesce(v_why, '')
       and ((v_mid is not null and s.provider_message_id in (v_mid, '<' || v_mid || '>')) or (v_mid is null and s.queue_id = v_queue))) into v_seen;
  if not v_seen then
    insert into public.notify_sends (queue_id, channel, provider, status, provider_message_id, error)
    values (v_queue, 'email', p_provider, case p_event when 'bounced' then 'bounced' when 'complained' then 'complained' else 'delivered' end, left(v_mid, 200), v_why);
    return 'applied';
  end if;
  return case when v_new then 'applied' else 'duplicate' end;
end $$;

-- p_events: a json array of { event, message_id, queue_id, address, hard, reason }, as src/lib/notify/hooks.ts makes them.
create or replace function public.notify_apply_events(p_provider text, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e jsonb; r text; c jsonb := jsonb_build_object('applied', 0, 'duplicate', 0, 'unmatched', 0, 'ignored', 0);
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return c; end if;
  for e in select x from jsonb_array_elements(p_events) x loop
    if jsonb_typeof(e) <> 'object' then r := 'ignored';
    else
      r := public.notify_apply_event(p_provider, e ->> 'event', e ->> 'message_id', e ->> 'queue_id', e ->> 'address',
                                     coalesce((e ->> 'hard') = 'true', false), left(e ->> 'reason', 200));
    end if;
    c := jsonb_set(c, array[r], to_jsonb(coalesce((c ->> r)::int, 0) + 1));
  end loop;
  return c;
end $$;

-- ------------------------------------------------------------------ access ---
revoke all on function
  public._notify_mid(text), public._notify_addr(text),
  public.notify_get_prefs(uuid), public.notify_set_pref(uuid, text, boolean),
  public.notify_get_my_prefs(), public.notify_set_my_prefs(boolean, boolean),
  public.notify_suppress(text, text), public.notify_unsuppress(text),
  public.notify_apply_event(text, text, text, text, text, boolean, text), public.notify_apply_events(text, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.notify_get_prefs(uuid), public.notify_set_pref(uuid, text, boolean),
  public.notify_suppress(text, text), public.notify_unsuppress(text),
  public.notify_apply_event(text, text, text, text, text, boolean, text), public.notify_apply_events(text, jsonb)
  to service_role;
grant execute on function public.notify_get_my_prefs(), public.notify_set_my_prefs(boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
