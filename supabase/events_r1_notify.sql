-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1: notifications, step 1 (the queue, the send log, the daily caps and the reminder hook).
-- Plans: docs/reminders-email-plan.md (section 3, and "Update, 31 Oct") and docs/reminders-whatsapp-plan.md ("Update, 31 Oct").
--
-- RUN ORDER: the Release 1 files first (events_r1_events.sql, events_r1_registrations.sql, events_r1_tickets.sql, events_r1_pops.sql,
-- events_r1_pay.sql), then THIS
-- FILE. Safe to run again: tables and seeds are written only when missing, so a re-run never changes a cap Ola edited and never flips a flag.
-- It edits no older file and no older function. It adds one trigger on ev_pops (see HOW IT ATTACHES) and nothing else on an old table.
--
-- NOTHING IS SENT FROM HERE. This file only decides who should get which message and when, counts the day's allowance, and logs what the
-- Next.js route /api/notify/run reports back. No provider, template or WhatsApp code lives in the database.
--
-- WHAT IT ADDS
--   notify_queue      one row per person per message per channel: user, kind, event, channel (email | whatsapp), cap_kind (code | guest),
--                     payload, priority 1 to 5, due_at, expires_at, status (queued | claimed | sent | failed | skipped | dropped), tries,
--                     and a unique dedupe_key so nothing is queued twice. expires_at is set on anything that is useless late (a reminder);
--                     a row without it is open ended and may be moved to the next day.
--   notify_sends      one row per attempt (and per policy note): the queue row, channel, provider, status (sent | failed | skipped | bounced |
--                     complained | delivered | read), the provider's message id, cost in USD, the error or the reason, and the time.
--   notify_prefs      per person: email reminders on or off, email Pops on or off, WhatsApp on, the WhatsApp number, when and how they agreed.
--                     No row means email on and WhatsApp off. A person can read their own row (for the settings screen). Writes come later.
--   notify_suppressed addresses that bounced hard or complained, or asked to stop. Never sent to again.
--   notify_caps       each provider's daily cap per kind (code | guest). Change one with: update notify_caps set daily_cap = 400 where ...
--   notify_cap_use    how much of each cap has been spent per Lagos day (needed for the atomic take; not in the plan's list).
--   notify_config     the run route's address and shared secret, read by the timer (the same idea as push_config in push.sql).
--   Flags in ev_settings: notify_email and notify_whatsapp, both 'off'. Switch with select public.notify_set_flag('notify_email', 'on').
--
-- THE FUNCTIONS (service role only; nobody signed in can call any of them)
--   notify_enqueue(...)            queue one message. Returns the new id, or null when it was a duplicate or the channel's flag is off.
--   notify_enqueue_pop(pop, now)   queue the reminders of an automatic Pop that has gone out. Returns how many rows were queued.
--   notify_enqueue_due(now)        the safety net: queue the reminders of Pops sent in the last 15 minutes that have no rows (if the hook failed).
--   notify_claim_due(limit, providers, now)
--                                  hand out up to 500 due rows as a json array, each exactly once (for update skip locked), after the rules
--                                  below. Each row carries the email address or the WhatsApp number to use.
--   notify_take_cap / notify_give_cap(provider, kind, n, now)
--                                  spend or hand back n of a provider's allowance today. take answers false when it would go over the cap.
--   notify_complete(queue, final, attempts, retry_at, free_retry)
--                                  write the attempts to notify_sends and settle the queue row (sent | failed | skipped), or put it back (queued).
--   notify_has_due(now), notify_tick(now)
--                                  the every-minute timer: queue what the hook missed, and POST to the run route only when something is due.
--   notify_cap_status(now)         usage of every cap today, for the 80 percent warning.
--   notify_set_flag, set_notify_config
--
-- HOW IT ATTACHES TO THE POPS (ev_dispatch_due_pops is NOT changed)
--   ev_dispatch_due_pops() makes the automatic Pops and then runs  update ev_pops set status = 'sent' ...  for each one that is due. This
--   file adds an AFTER UPDATE OF status trigger on ev_pops (notify_pop_sent) that fires when a day_before or hour_before Pop becomes
--   'sent' and calls notify_enqueue_pop. So the queue gets its rows in the same transaction, at the exact moment the Pop goes: 24 hours and
--   1 hour before the start, no later and no earlier. One host switch (ev_set_auto_pop) controls both the Pop and the reminders. The trigger
--   catches its own errors, so a notification problem can never stop a Pop from going out. If Ola's own Pops tables replace
--   events_r1_pops.sql, drop the trigger and call notify_enqueue_pop(pop) where his code marks an automatic Pop sent.
--
-- WHO GETS A REMINDER (notify_enqueue_pop)
--   Everyone ev_pop_recipient_ids gives, and then only people whose registration is 'going' (so not cancelled, not waiting) and who have no
--   USED ticket for the event. The second part matters: a purchase of several seats is checked in ticket by ticket (ev_scan and
--   ev_checkin_manual in events_r1_tickets.sql), and the registration only becomes 'checked_in' when its last ticket is used, so a buyer
--   who is already at the door with one seat of three is still 'going'. A used ticket is what says "here".
--   Email: the person has an address, it is not in notify_suppressed, and email reminders are not switched off in notify_prefs.
--   The 12 hour rule: no day_before to anyone who registered less than 12 hours before it goes (email or WhatsApp).
--   WhatsApp, a separate row: only a person with a paid order for that event (ev_orders.status = 'paid') who has WhatsApp on with a number
--   in notify_prefs. A free ticket never gets one. WhatsApp rows are priority 2 for both reminders (they cost money and nothing else
--   covers a paid guest). Email: day_before is priority 2 (Luma G10), hour_before is priority 4 (G11, dropped first on a busy day).
--   When a row is claimed the same questions are asked again, because a queued row can wait: a person who cancelled or checked in since,
--   a bounce since, a switch turned off since, and for WhatsApp whether the order is still paid (a refunded guest must not cost money):
--   the row is skipped and a note goes in notify_sends.
--
-- PRIORITY DROPPING (notify_claim_due, email rows only)
--   The day's allowance is the sum of the caps of the providers the route can use, for the row's cap_kind. A row of priority p may only be
--   handed out while the day's use, counting what this very call has already handed out, stays at or under this share of the allowance:
--   priority 1: 100 percent (it always goes, whatever else has happened), 2: 95, 3: 85, 4: 70, 5: 50 (_notify_priority_limit).
--   A row over its share is dropped (status 'dropped') when it has an expires_at, because it is useless late; otherwise it is moved to
--   08:00 Lagos the next day. Either way a 'skipped' row with the reason is written to notify_sends (provider 'policy').
--   Priority 1 that finds every provider full is not dropped: the run route puts it back for 15 minutes without counting a try.
--
-- STEP 2 (events_r1_notify_emails.sql, run after this file) adds the triggers that queue the guest and host emails. It needs three small
--   hooks here, all marked below: notify_claim_due also (1) re-asks "still going?" for the ticket mails (registered, approved, spot_opened),
--   (2) honours email_pops for host_pop and email_reminders for thanks, and (3) adds the tickets with fresh signed tokens to a ticket mail's
--   payload as it is handed out (_notify_claim_extra; the token is never stored in the queue); and notify_tick also calls
--   notify_enqueue_thanks when that file is loaded.
--
-- THE TIMER. notify_tick() is NOT scheduled by this file. Ola, once, after notify_config is set and a flag is on:
--   select public.set_notify_config('run_url', 'https://YOUR-APP/api/notify/run');
--   select public.set_notify_config('run_secret', '<the same value as the NOTIFY_RUN_SECRET env var>');
--   -- select cron.schedule('hoppaz-notify', '* * * * *', 'select public.notify_tick()');
-- ============================================================================
begin;

-- ------------------------------------------------------------------ the queue ---
create table if not exists public.notify_queue (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind ~ '^[a-z0-9_]{1,40}$'),
  event_id   uuid references public.events(id) on delete cascade,
  channel    text not null default 'email' check (channel in ('email', 'whatsapp')),
  cap_kind   text not null default 'guest' check (cap_kind in ('code', 'guest')),
  payload    jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 8192),
  priority   smallint not null default 3 check (priority between 1 and 5),
  due_at     timestamptz not null default now(),
  expires_at timestamptz,
  status     text not null default 'queued' check (status in ('queued', 'claimed', 'sent', 'failed', 'skipped', 'dropped')),
  tries      integer not null default 0 check (tries >= 0),
  claimed_at timestamptz,
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists notify_queue_due_idx on public.notify_queue (due_at, priority) where status in ('queued', 'claimed');
create index if not exists notify_queue_pop_idx on public.notify_queue ((payload ->> 'pop_id'));
alter table public.notify_queue enable row level security;
revoke all on public.notify_queue from anon, authenticated;
grant all on public.notify_queue to service_role;

-- ------------------------------------------------------------------ the send log ---
create table if not exists public.notify_sends (
  id                  uuid primary key default gen_random_uuid(),
  queue_id            uuid references public.notify_queue(id) on delete set null,
  channel             text not null check (channel in ('email', 'whatsapp')),
  provider            text not null check (char_length(provider) between 1 and 40),
  status              text not null check (status in ('sent', 'failed', 'skipped', 'bounced', 'complained', 'delivered', 'read')),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  cost_usd            numeric(12, 6) not null default 0 check (cost_usd >= 0),
  error               text check (error is null or char_length(error) <= 500),
  created_at          timestamptz not null default clock_timestamp()
);
create index if not exists notify_sends_queue_idx on public.notify_sends (queue_id);
create index if not exists notify_sends_message_idx on public.notify_sends (provider, provider_message_id) where provider_message_id is not null;
create index if not exists notify_sends_day_idx on public.notify_sends (created_at);
alter table public.notify_sends enable row level security;
revoke all on public.notify_sends from anon, authenticated;
grant all on public.notify_sends to service_role;

-- ------------------------------------------------------------------ preferences ---
-- No row means: email reminders on, email Pops on, WhatsApp off. WhatsApp can only be on with a number and a record of the agreement.
create table if not exists public.notify_prefs (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  email_reminders boolean not null default true,
  email_pops      boolean not null default true,
  whatsapp_on     boolean not null default false,
  whatsapp_number text check (whatsapp_number is null or whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  agreed_at       timestamptz,
  agreed_how      text check (agreed_how is null or char_length(agreed_how) between 1 and 40),
  updated_at      timestamptz not null default now(),
  check (not whatsapp_on or (whatsapp_number is not null and agreed_at is not null and agreed_how is not null))
);
alter table public.notify_prefs enable row level security;
drop policy if exists notify_prefs_read_own on public.notify_prefs;
create policy notify_prefs_read_own on public.notify_prefs for select using (user_id = auth.uid());
-- no insert, update or delete policy: the settings and unsubscribe functions (a later step) are the only way in
revoke all on public.notify_prefs from anon, authenticated;
grant select on public.notify_prefs to authenticated;
grant all on public.notify_prefs to service_role;

-- ------------------------------------------------------------------ suppression ---
-- The address is kept lower case and trimmed. A provider webhook or the unsubscribe page (later steps) writes here.
create table if not exists public.notify_suppressed (
  address    text primary key check (address = lower(btrim(address)) and char_length(address) between 3 and 320),
  reason     text not null check (char_length(reason) between 1 and 60),
  created_at timestamptz not null default now()
);
alter table public.notify_suppressed enable row level security;
revoke all on public.notify_suppressed from anon, authenticated;
grant all on public.notify_suppressed to service_role;

-- ------------------------------------------------------------------ daily caps ---
create table if not exists public.notify_caps (
  provider   text not null check (provider ~ '^[a-z0-9_]{1,40}$'),
  kind       text not null check (kind in ('code', 'guest')),
  daily_cap  integer not null check (daily_cap >= 0),
  updated_at timestamptz not null default now(),
  primary key (provider, kind)
);
alter table public.notify_caps enable row level security;
revoke all on public.notify_caps from anon, authenticated;
grant all on public.notify_caps to service_role;
-- Free-tier allowances (31 Oct): guest mail Brevo 300 then Mailjet 100, codes Mailtrap 150 then Mailjet 100. The log provider (fake mode)
-- is effectively unlimited. A re-run leaves whatever Ola set.
insert into public.notify_caps (provider, kind, daily_cap) values
  ('brevo', 'guest', 300), ('mailjet', 'guest', 100), ('mailtrap', 'code', 150), ('mailjet', 'code', 100),
  ('log', 'guest', 1000000000), ('log', 'code', 1000000000)
on conflict (provider, kind) do nothing;

create table if not exists public.notify_cap_use (
  provider text not null,
  kind     text not null check (kind in ('code', 'guest')),
  day      date not null,
  used     integer not null default 0 check (used >= 0),
  primary key (provider, kind, day)
);
alter table public.notify_cap_use enable row level security;
revoke all on public.notify_cap_use from anon, authenticated;
grant all on public.notify_cap_use to service_role;

-- ------------------------------------------------------------------ run route address ---
create table if not exists public.notify_config (
  key        text primary key check (key ~ '^[a-z_]{1,40}$'),
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.notify_config enable row level security;
revoke all on public.notify_config from anon, authenticated;
grant all on public.notify_config to service_role;

create or replace function public.set_notify_config(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_value is null then
    delete from public.notify_config where key = p_key;
  else
    insert into public.notify_config (key, value) values (p_key, p_value)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
end $$;

create or replace function public._notify_cfg(p_key text, p_default text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.value from public.notify_config c where c.key = p_key), p_default);
$$;

-- ------------------------------------------------------------------ the flags ---
-- Both start off. A re-run never flips them.
insert into public.ev_settings (key, value) values ('notify_email', 'off'), ('notify_whatsapp', 'off') on conflict (key) do nothing;

create or replace function public._notify_flag(p_key text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.value = 'on' from public.ev_settings s where s.key = p_key), false);
$$;

-- ev_set_setting only knows its own keys (events_r1_events.sql), so these two flags have their own setter.
create or replace function public.notify_set_flag(p_key text, p_value text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or p_key not in ('notify_email', 'notify_whatsapp') then return 'bad_key'; end if;
  if p_value is null or p_value not in ('on', 'off') then return 'bad_value'; end if;
  insert into public.ev_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return 'ok';
end $$;

-- ------------------------------------------------------------------ small helpers ---
-- The day a cap is counted in: the Lagos calendar day.
create or replace function public._notify_day(p_now timestamptz) returns date
language sql stable set search_path = public, pg_temp as $$
  select (p_now at time zone 'Africa/Lagos')::date;
$$;

-- The share of a day's allowance a priority may use (see PRIORITY DROPPING in the header). Edit here to tune it.
create or replace function public._notify_priority_limit(p_priority integer) returns numeric
language sql immutable set search_path = public, pg_temp as $$
  select case p_priority when 1 then 1.00 when 2 then 0.95 when 3 then 0.85 when 4 then 0.70 else 0.50 end;
$$;

-- [allowance, used today] over the caps of the given providers (null: every provider) for one cap_kind.
create or replace function public._notify_allowance(p_kind text, p_providers text[], p_now timestamptz) returns bigint[]
language sql stable security definer set search_path = public, pg_temp as $$
  select array[coalesce(sum(c.daily_cap), 0)::bigint, coalesce(sum(u.used), 0)::bigint]
    from public.notify_caps c
    left join public.notify_cap_use u on u.provider = c.provider and u.kind = c.kind and u.day = public._notify_day(p_now)
   where c.kind = p_kind and (p_providers is null or c.provider = any (p_providers));
$$;

-- A line in the send log that is not a provider attempt: a rule that skipped, moved or dropped a row.
create or replace function public._notify_note(p_queue uuid, p_channel text, p_status text, p_note text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.notify_sends (queue_id, channel, provider, status, error) values (p_queue, p_channel, 'policy', p_status, left(p_note, 500));
$$;

-- Settle a claimed row without sending it (skipped, dropped or failed) and say why.
create or replace function public._notify_close(p_queue uuid, p_channel text, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.notify_queue set status = p_status, claimed_at = null, updated_at = clock_timestamp() where id = p_queue;
  perform public._notify_note(p_queue, p_channel, case when p_status = 'failed' then 'failed' else 'skipped' end, p_note);
end $$;

-- ------------------------------------------------------------------ the daily cap ---
-- Spend p_n of a provider's allowance for today (Lagos). One statement does the check and the add, so two runs at once cannot both take the
-- last unit. false: it would go over the cap, or the provider has no cap row (no row means no allowance).
create or replace function public.notify_take_cap(p_provider text, p_kind text, p_n integer default 1, p_now timestamptz default now()) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_day date := public._notify_day(p_now);
  v_hit integer;
begin
  if p_n is null or p_n < 1 then return false; end if;
  if not exists (select 1 from public.notify_caps c where c.provider = p_provider and c.kind = p_kind) then return false; end if;
  insert into public.notify_cap_use (provider, kind, day, used) values (p_provider, p_kind, v_day, 0) on conflict do nothing;
  update public.notify_cap_use u set used = u.used + p_n
    from public.notify_caps c
   where u.provider = p_provider and u.kind = p_kind and u.day = v_day
     and c.provider = u.provider and c.kind = u.kind
     and u.used + p_n <= c.daily_cap;
  get diagnostics v_hit = row_count;
  return v_hit = 1;
end $$;

-- Hand back what a failed attempt did not use.
create or replace function public.notify_give_cap(p_provider text, p_kind text, p_n integer default 1, p_now timestamptz default now()) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.notify_cap_use set used = greatest(0, used - greatest(coalesce(p_n, 1), 0))
   where provider = p_provider and kind = p_kind and day = public._notify_day(p_now);
$$;

-- Usage of every cap today, for the warning at 80 percent.
create or replace function public.notify_cap_status(p_now timestamptz default now()) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', c.provider, 'kind', c.kind, 'daily_cap', c.daily_cap, 'used', coalesce(u.used, 0),
           'percent', round(100.0 * coalesce(u.used, 0) / nullif(c.daily_cap, 0), 1)) order by c.provider, c.kind), '[]'::jsonb)
    from public.notify_caps c
    left join public.notify_cap_use u on u.provider = c.provider and u.kind = c.kind and u.day = public._notify_day(p_now);
$$;

-- ------------------------------------------------------------------ queue one message ---
-- Null when the message was already queued (same dedupe key) or the channel's flag is off. The default key is
-- kind:event:user:channel, so "the same message to the same person for the same event" goes once.
create or replace function public.notify_enqueue(
  p_user uuid, p_kind text, p_event uuid default null, p_payload jsonb default '{}'::jsonb, p_priority integer default 3,
  p_due_at timestamptz default null, p_dedupe text default null, p_channel text default 'email', p_cap_kind text default 'guest',
  p_expires_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id  uuid;
  v_key text;
begin
  if p_channel is null or p_channel not in ('email', 'whatsapp') then return null; end if;
  if not public._notify_flag(case p_channel when 'email' then 'notify_email' else 'notify_whatsapp' end) then return null; end if;
  v_key := coalesce(nullif(btrim(p_dedupe), ''), p_kind || ':' || coalesce(p_event::text, '-') || ':' || p_user::text || ':' || p_channel);
  insert into public.notify_queue (user_id, kind, event_id, channel, cap_kind, payload, priority, due_at, expires_at, dedupe_key)
  values (p_user, p_kind, p_event, p_channel, coalesce(p_cap_kind, 'guest'), coalesce(p_payload, '{}'::jsonb), p_priority,
          coalesce(p_due_at, now()), p_expires_at, v_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------------ reminders from the automatic Pops ---
create or replace function public.notify_enqueue_pop(p_pop uuid, p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p       public.ev_pops;
  e       public.events;
  v_email boolean := public._notify_flag('notify_email');
  v_wa    boolean := public._notify_flag('notify_whatsapp');
  v_kind  text;
  v_prio  integer;
  v_exp   timestamptz;
  v_n     integer;
begin
  if not v_email and not v_wa then return 0; end if;
  select * into p from public.ev_pops where id = p_pop;
  if p.id is null or p.status <> 'sent' or p.auto is null or p.auto not in ('day_before', 'hour_before') then return 0; end if;
  select * into e from public.events where id = p.event_id;
  if e.id is null or e.status not in ('live', 'unlisted') then return 0; end if;
  -- The day-before email is useless once the hour-before one is due; the hour-before one is useless once the event has started.
  if p.auto = 'day_before' then
    v_kind := 'reminder_day'; v_prio := 2; v_exp := e.starts_at - interval '1 hour';
  else
    v_kind := 'reminder_hour'; v_prio := 4; v_exp := e.starts_at;
  end if;

  insert into public.notify_queue (user_id, kind, event_id, channel, cap_kind, payload, priority, due_at, expires_at, dedupe_key)
  select g.user_id, v_kind, e.id, ch.channel, 'guest',
         jsonb_build_object('event_id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'timezone', e.timezone,
                            'venue_name', e.venue_name, 'online', e.kind = 'online', 'pop_id', p.id, 'auto', p.auto, 'body', p.body),
         case ch.channel when 'email' then v_prio else 2 end, p_now, v_exp,
         v_kind || ':' || e.id::text || ':' || g.user_id::text || ':' || ch.channel
    from (
      select rid.user_id, r.created_at as reg_at, u.email, np.email_reminders, np.whatsapp_on, np.whatsapp_number
        from public.ev_pop_recipient_ids(p.id) as rid(user_id)
        join public.ev_registrations r on r.event_id = e.id and r.user_id = rid.user_id and r.status = 'going'
        join auth.users u on u.id = rid.user_id
        left join public.notify_prefs np on np.user_id = rid.user_id
    ) g
   cross join (values ('email'), ('whatsapp')) as ch(channel)
   where (p.auto <> 'day_before' or g.reg_at <= p_now - interval '12 hours')
     and not exists (select 1 from public.ev_tickets t where t.event_id = e.id and t.owner_id = g.user_id and t.status = 'used')
     and (
       (ch.channel = 'email' and v_email and coalesce(g.email_reminders, true) and nullif(btrim(g.email), '') is not null
          and not exists (select 1 from public.notify_suppressed s where s.address = lower(btrim(g.email))))
       or
       (ch.channel = 'whatsapp' and v_wa and coalesce(g.whatsapp_on, false) and g.whatsapp_number is not null
          and exists (select 1 from public.ev_orders o where o.buyer_id = g.user_id and o.event_id = e.id and o.status = 'paid'))
     )
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- The hook: a day_before or hour_before Pop has just become 'sent'.
create or replace function public._notify_pop_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.notify_enqueue_pop(new.id);
  exception when others then
    -- A notification problem must never stop a Pop going out (the dispatcher would roll the Pop back too).
    raise warning 'notify: reminders for pop % were not queued: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_pop_sent on public.ev_pops;
create trigger notify_pop_sent after update of status on public.ev_pops
  for each row when (old.status is distinct from 'sent' and new.status = 'sent' and new.auto in ('day_before', 'hour_before'))
  execute function public._notify_pop_trigger();

-- The safety net, run by the timer: a recent automatic Pop with no queue rows at all (the hook failed, or the Pop was written as sent).
create or replace function public.notify_enqueue_due(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x   record;
  v_n integer := 0;
begin
  if not public._notify_flag('notify_email') and not public._notify_flag('notify_whatsapp') then return 0; end if;
  for x in
    select q.id from public.ev_pops q
     where q.status = 'sent' and q.auto in ('day_before', 'hour_before') and q.sent_at > p_now - interval '15 minutes'
       and not exists (select 1 from public.notify_queue n where n.payload ->> 'pop_id' = q.id::text)
  loop
    begin
      v_n := v_n + public.notify_enqueue_pop(x.id, p_now);
    exception when others then
      raise warning 'notify_enqueue_due: pop % failed: %', x.id, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

-- What a row needs at the moment it is sent that must not sit in the queue: for the ticket mails, the tickets with their signed tokens
-- (events_r1_notify_emails.sql writes the real one). The stub, written only when missing, adds nothing, so this file works alone.
do $stub$
begin
  if to_regprocedure('public._notify_claim_extra(text, uuid, uuid)') is null then
    create function public._notify_claim_extra(p_kind text, p_event uuid, p_user uuid) returns jsonb
    language sql stable security definer set search_path = public, pg_temp as 'select ''{}''::jsonb';
    revoke all on function public._notify_claim_extra(text, uuid, uuid) from public, anon, authenticated;
  end if;
end $stub$;

-- ------------------------------------------------------------------ claim ---
-- Hands out due rows, each to one caller only. A row left 'claimed' for more than 10 minutes (a run that died) is handed out again.
-- Returns a json array of { id, user_id, kind, event_id, channel, cap_kind, payload, priority, tries, dedupe_key, email, whatsapp_number }.
-- p_providers: the providers the caller can really use, so the allowance counts only those (null: all). The caller must settle every row
-- it gets with notify_complete.
create or replace function public.notify_claim_due(p_limit integer default 500, p_providers text[] default null, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lim   integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_email boolean := public._notify_flag('notify_email');
  v_wa    boolean := public._notify_flag('notify_whatsapp');
  v_cap   bigint[];
  v_used  bigint[];
  v_given integer[] := array[0, 0];
  v_a     bigint[];
  v_b     bigint[];
  v_ix    integer;
  v_next  timestamptz := ((public._notify_day(p_now) + 1)::timestamp + interval '8 hours') at time zone 'Africa/Lagos';
  v_out   jsonb[] := '{}';
  r       record;
  v_addr  text;
  v_num   text;
  v_why   text;
begin
  if not v_email and not v_wa then return '[]'::jsonb; end if;
  v_a := public._notify_allowance('guest', p_providers, p_now);
  v_b := public._notify_allowance('code', p_providers, p_now);
  v_cap := array[v_a[1], v_b[1]];
  v_used := array[v_a[2], v_b[2]];

  for r in
    select q.* from public.notify_queue q
     where (q.status = 'queued' or (q.status = 'claimed' and q.claimed_at < p_now - interval '10 minutes'))
       and q.due_at <= p_now
       and ((q.channel = 'email' and v_email) or (q.channel = 'whatsapp' and v_wa))
     order by q.priority, q.due_at, q.id
     limit v_lim
     for update skip locked
  loop
    v_addr := null; v_num := null;
    v_ix := case r.cap_kind when 'guest' then 1 else 2 end;

    if r.tries >= 5 then
      perform public._notify_close(r.id, r.channel, 'failed', 'gave up after 5 tries');
      continue;
    end if;
    if r.expires_at is not null and r.expires_at <= p_now then
      perform public._notify_close(r.id, r.channel, 'dropped', 'dropped: too late to be useful');
      continue;
    end if;
    -- Asked again, because the row may have waited: is the person still going?
    if r.kind in ('reminder_day', 'reminder_hour', 'registered', 'approved', 'spot_opened') and not exists (
         select 1 from public.ev_registrations g join public.events ev on ev.id = g.event_id
          where g.event_id = r.event_id and g.user_id = r.user_id and g.status = 'going' and ev.status in ('live', 'unlisted')) then
      perform public._notify_close(r.id, r.channel, 'skipped', 'skipped: no longer going');
      continue;
    end if;
    -- ... or already at the door: a used ticket (a multi-seat buyer stays 'going' until the last seat is scanned).
    if r.kind in ('reminder_day', 'reminder_hour') and exists (
         select 1 from public.ev_tickets t where t.event_id = r.event_id and t.owner_id = r.user_id and t.status = 'used') then
      perform public._notify_close(r.id, r.channel, 'skipped', 'skipped: already checked in');
      continue;
    end if;
    if r.channel = 'email' then
      select lower(btrim(u.email)) into v_addr from auth.users u where u.id = r.user_id;
      if v_addr is null or v_addr = '' then
        perform public._notify_close(r.id, r.channel, 'skipped', 'skipped: no email address');
        continue;
      end if;
      if exists (select 1 from public.notify_suppressed s where s.address = v_addr) then
        perform public._notify_close(r.id, r.channel, 'skipped', 'skipped: address suppressed');
        continue;
      end if;
      if r.kind in ('reminder_day', 'reminder_hour', 'thanks') and exists (select 1 from public.notify_prefs np where np.user_id = r.user_id and not np.email_reminders) then
        perform public._notify_close(r.id, r.channel, 'skipped', 'skipped: email reminders are off');
        continue;
      end if;
      if r.kind = 'host_pop' and exists (select 1 from public.notify_prefs np where np.user_id = r.user_id and not np.email_pops) then
        perform public._notify_close(r.id, r.channel, 'skipped', 'skipped: email Pops are off');
        continue;
      end if;
    else
      select np.whatsapp_number into v_num from public.notify_prefs np where np.user_id = r.user_id and np.whatsapp_on;
      if v_num is null then
        perform public._notify_close(r.id, r.channel, 'skipped', 'skipped: WhatsApp is off');
        continue;
      end if;
      -- WhatsApp costs money and goes only to a guest with a paid order for the event (a refund since ends it).
      if r.event_id is not null and not exists (
           select 1 from public.ev_orders o where o.buyer_id = r.user_id and o.event_id = r.event_id and o.status = 'paid') then
        perform public._notify_close(r.id, r.channel, 'skipped', 'skipped: no paid order');
        continue;
      end if;
    end if;

    -- Priority dropping. Priority 1 is never held back.
    if r.channel = 'email' and r.priority > 1
       and not (v_cap[v_ix] > 0 and v_used[v_ix] + v_given[v_ix] + 1 <= floor(v_cap[v_ix] * public._notify_priority_limit(r.priority))) then
      v_why := format('allowance low (%s of %s used today), priority %s', v_used[v_ix] + v_given[v_ix], v_cap[v_ix], r.priority);
      if r.expires_at is null then
        update public.notify_queue set status = 'queued', claimed_at = null, due_at = v_next, updated_at = clock_timestamp() where id = r.id;
        perform public._notify_note(r.id, r.channel, 'skipped', 'moved to the next day: ' || v_why);
      else
        perform public._notify_close(r.id, r.channel, 'dropped', 'dropped: ' || v_why);
      end if;
      continue;
    end if;

    update public.notify_queue set status = 'claimed', claimed_at = p_now, tries = tries + 1, updated_at = clock_timestamp() where id = r.id;
    if r.channel = 'email' then v_given[v_ix] := v_given[v_ix] + 1; end if;
    v_out := array_append(v_out, jsonb_build_object(
      'id', r.id, 'user_id', r.user_id, 'kind', r.kind, 'event_id', r.event_id, 'channel', r.channel, 'cap_kind', r.cap_kind,
      'payload', r.payload || public._notify_claim_extra(r.kind, r.event_id, r.user_id), 'priority', r.priority, 'tries', r.tries + 1, 'dedupe_key', r.dedupe_key,
      'email', v_addr, 'whatsapp_number', v_num));
  end loop;
  return to_jsonb(v_out);
end $$;

-- ------------------------------------------------------------------ settle ---
-- p_attempts: a json array of { channel, provider, status (sent | failed | skipped), message_id, cost_usd, error }, written to notify_sends.
-- p_final: sent | failed | skipped settle the row; queued puts it back for p_retry_at (default 10 minutes), and p_free_retry hands the try back
-- (used when every provider was simply full, so waiting does not use up the row's 5 tries). Only a row that is 'claimed' can be settled,
-- so a second call changes nothing and returns false.
create or replace function public.notify_complete(p_queue uuid, p_final text, p_attempts jsonb default '[]'::jsonb,
                                                  p_retry_at timestamptz default null, p_free_retry boolean default false) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hit integer;
begin
  if p_final is null or p_final not in ('sent', 'failed', 'skipped', 'queued') then return false; end if;
  if p_attempts is null or jsonb_typeof(p_attempts) <> 'array' then return false; end if;
  update public.notify_queue
     set status = p_final,
         due_at = case when p_final = 'queued' then coalesce(p_retry_at, now() + interval '10 minutes') else due_at end,
         tries = case when p_final = 'queued' and p_free_retry then greatest(tries - 1, 0) else tries end,
         claimed_at = null, updated_at = clock_timestamp()
   where id = p_queue and status = 'claimed';
  get diagnostics v_hit = row_count;
  if v_hit <> 1 then return false; end if;
  insert into public.notify_sends (queue_id, channel, provider, status, provider_message_id, cost_usd, error)
  select p_queue, a ->> 'channel', a ->> 'provider', a ->> 'status', left(a ->> 'message_id', 200),
         coalesce((a ->> 'cost_usd')::numeric, 0), left(a ->> 'error', 500)
    from jsonb_array_elements(p_attempts) a;
  return true;
end $$;

-- ------------------------------------------------------------------ the timer ---
create or replace function public.notify_has_due(p_now timestamptz default now()) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.notify_queue q
     where (q.status = 'queued' or (q.status = 'claimed' and q.claimed_at < p_now - interval '10 minutes'))
       and q.due_at <= p_now
       and ((q.channel = 'email' and public._notify_flag('notify_email')) or (q.channel = 'whatsapp' and public._notify_flag('notify_whatsapp'))));
$$;

-- pg_net is Supabase's way for the database to make an HTTP call (the same block as push.sql).
do $net$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net is not available here. TODO: enable it in Supabase (Database, Extensions) and run events_r1_notify.sql again.';
end $net$;

-- Every minute: queue what the hook missed, and tell the run route only when something is due. True when the call was queued with pg_net
-- (it goes out after the surrounding transaction commits). Does nothing with both flags off.
create or replace function public.notify_tick(p_now timestamptz default now()) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_url    text := public._notify_cfg('run_url', '');
  v_secret text := public._notify_cfg('run_secret', '');
begin
  if not public._notify_flag('notify_email') and not public._notify_flag('notify_whatsapp') then return false; end if;
  begin
    perform public.notify_enqueue_due(p_now);
  exception when others then
    raise warning 'notify_tick: enqueue failed: %', sqlerrm;
  end;
  -- The thank you mails of events that ended (events_r1_notify_emails.sql). Nothing happens when that file is not loaded.
  if to_regprocedure('public.notify_enqueue_thanks(timestamptz)') is not null then
    begin
      execute 'select public.notify_enqueue_thanks($1)' using p_now;
    exception when others then
      raise warning 'notify_tick: thank you mails failed: %', sqlerrm;
    end;
  end if;
  if not public.notify_has_due(p_now) then return false; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise notice 'notify_tick: pg_net is not installed. TODO: enable pg_net (events_r1_notify.sql).';
    return false;
  end if;
  if v_url = '' or v_secret = '' then
    raise notice 'notify_tick: run_url / run_secret are not set (select public.set_notify_config(...), header of events_r1_notify.sql).';
    return false;
  end if;
  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('source', 'cron'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 8000);
    return true;
  exception when others then
    raise warning 'notify_tick failed: %', sqlerrm;
    return false;
  end;
end $$;

-- ------------------------------------------------------------------ access ---
-- Everything here is for the server: nobody signed in can call any of it. (notify_prefs is the one table a person can read, their own row.)
revoke all on function
  public.set_notify_config(text, text), public._notify_cfg(text, text), public._notify_flag(text), public.notify_set_flag(text, text),
  public._notify_day(timestamptz), public._notify_priority_limit(integer), public._notify_allowance(text, text[], timestamptz),
  public._notify_note(uuid, text, text, text), public._notify_close(uuid, text, text, text),
  public.notify_take_cap(text, text, integer, timestamptz), public.notify_give_cap(text, text, integer, timestamptz), public.notify_cap_status(timestamptz),
  public.notify_enqueue(uuid, text, uuid, jsonb, integer, timestamptz, text, text, text, timestamptz),
  public.notify_enqueue_pop(uuid, timestamptz), public._notify_pop_trigger(), public.notify_enqueue_due(timestamptz),
  public.notify_claim_due(integer, text[], timestamptz), public.notify_complete(uuid, text, jsonb, timestamptz, boolean),
  public.notify_has_due(timestamptz), public.notify_tick(timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.set_notify_config(text, text), public.notify_set_flag(text, text),
  public.notify_take_cap(text, text, integer, timestamptz), public.notify_give_cap(text, text, integer, timestamptz), public.notify_cap_status(timestamptz),
  public.notify_enqueue(uuid, text, uuid, jsonb, integer, timestamptz, text, text, text, timestamptz),
  public.notify_enqueue_pop(uuid, timestamptz), public.notify_enqueue_due(timestamptz),
  public.notify_claim_due(integer, text[], timestamptz), public.notify_complete(uuid, text, jsonb, timestamptz, boolean),
  public.notify_has_due(timestamptz), public.notify_tick(timestamptz)
  to service_role;

-- NOT SCHEDULED. Ola schedules the timer himself, once, when notify_config is set and a flag is on (needs pg_cron):
-- select cron.schedule('hoppaz-notify', '* * * * *', 'select public.notify_tick()');

notify pgrst, 'reload schema';
commit;
