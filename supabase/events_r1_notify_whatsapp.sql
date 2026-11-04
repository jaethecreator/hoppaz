-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1: notifications, step 5 (WhatsApp: the keyword bot's database half, the monthly budget, and the sends' status events).
-- Plans: docs/reminders-whatsapp-plan.md ("Update, 31 Oct" overrides the rest). Steps 1 to 3 are events_r1_notify.sql,
-- events_r1_notify_emails.sql and events_r1_notify_prefs.sql.
--
-- RUN ORDER: the Release 1 files, then the three notify files, then THIS FILE. Safe to run again. It edits no older function and no older
-- table except by adding columns (notify_prefs.wa_stopped_at, notify_sends.pricing), and it adds no trigger.
--
-- NOTHING IS SENT FROM HERE. The Next.js routes /api/notify/run (templates) and /api/whatsapp/hook (replies to a guest's message) send;
-- this file decides, counts and logs.
--
-- PHONE NUMBERS are kept in notify_prefs.whatsapp_number only (E.164, "+2348012345678"), a table nobody but the service role (and the
-- person, their own row) can read. The bot's own tables keep a SHA-256 of the number, never the number. No function here puts a number in
-- an error message or a log line; the one a person can call returns it masked.
--
-- WHAT IT ADDS
--   notify_prefs.wa_stopped_at   when a STOP switched the number off (cleared when it is switched on again).
--   notify_sends.pricing         the line that carried Meta's pricing for a message: its category, or 'category:free'. One per message.
--   notify_wa_inbound            every message a guest sent, by Meta's message id (the idempotency log), with the hash of the number, the
--                                keyword read from it, and which reply (if any) was reserved. Rows older than 90 days are deleted.
--   notify_config                whatsapp_monthly_budget_usd (50) and whatsapp_reply_daily_max (6), written only when missing.
--
-- THE FUNCTIONS (service role only unless said)
--   notify_wa_normalise(text)         a number in any Nigerian form -> E.164 (below), or null. Pure.
--   notify_wa_find(number)            the people whose WhatsApp number this is: a uuid array (two people can share a number).
--   notify_wa_stop(number)            STOP: WhatsApp off for EVERY person with this number. Returns how many were on.
--   notify_wa_start(number)           START: back on, but only for a person who agreed before (agreed_at set). A stranger changes nothing.
--   notify_wa_inbound(msg, number, keyword, now)
--                                     the whole decision for one message from a guest, in one transaction: log it by id (a replay answers
--                                     'duplicate' and does nothing), do what the keyword says, and say which reply to send (or none) after
--                                     the reply limits. The route composes the text and sends it.
--   notify_wa_record_reply(wamid)     log a reply that went out, so Meta's pricing for it can be matched.
--   notify_wa_apply_statuses(events)  Meta's status webhooks into notify_sends (delivered, read, failed), with the cost.
--   notify_wa_budget(now)             the month's budget: spent, sent but not priced yet, in flight, the share used, and how many messages are left.
--   notify_wa_recheck(queue)          just before a template goes out: the number if the guest is still on and paid, else null.
--   For a signed-in person (not a guest session), the future checkout switch and settings:
--   notify_set_my_whatsapp(number, on, how)   stores the number in E.164 with when and how they agreed (how: 'checkout' or 'settings').
--   notify_get_my_whatsapp()          on or off and the number masked.
--
-- NUMBERS. notify_wa_normalise reads 0801 234 5678, 080-1234-5678, 2348012345678, 234 801 234 5678, +234 801 234 5678, +234 (0) 801..., 00234...
--   and a bare 8012345678 as +2348012345678; a Nigerian number must have 10 digits after 234 starting 7, 8 or 9. Anything else must start
--   with + and be E.164 (8 to 15 digits). A foreign number written with a leading 0 is read as Nigerian: it needs its + .
--
-- THE BOT (what notify_wa_inbound does; the keyword is already matched exactly, ignoring case and spaces, by the route)
--   stop    every person with the number is switched off. Reply 'stop' (confirm).
--   start   every person with the number who agreed before is switched back on. Reply 'start'. If nobody agreed before, nothing changes and the
--           reply is 'start_no' (turn it on at checkout). START is never new consent for a stranger.
--   ticket  exactly one person has this number: reply 'ticket' with their next upcoming ticket's event, or 'ticket_none'. Nobody, or two or
--           more people (a shared number): reply 'help'. Nothing about anyone is revealed to a number that does not match.
--   other   reply 'help'.
--   REPLY LIMITS (each reply can cost money past Meta's free tier): at most one 'help', 'start_no' or 'ticket_none' (the help class) per number per hour, at most
--   one 'stop' per hour, and at most whatsapp_reply_daily_max replies to a number in 24 hours. Over a limit, the keyword is still acted on and no reply is
--   sent. When the monthly budget is used up only the STOP confirmation is still sent. The route never answers a status update, a group
--   message, a message from our own number, or anything that is not text, so two bots cannot talk to each other for ever.
--
-- THE MONTHLY BUDGET (docs/reminders-whatsapp-plan.md, section 2)
--   A USD total for the Lagos calendar month, compared with notify_config whatsapp_monthly_budget_usd. Change it with one line:
--     select public.set_notify_config('whatsapp_monthly_budget_usd', '100');
--   Spent = the cost_usd of the month's WhatsApp lines in notify_sends. Until Meta's status webhook prices a message it counts at the estimate
--   _notify_wa_price('utility'), as do messages handed to a run and not yet settled. When spent plus those would pass the budget, the claim (events_r1_notify.sql)
--   skips WhatsApp rows with 'skipped: WhatsApp monthly budget reached'; email is not affected. The run route logs a warning at 80 percent.
--   THE 50 IS A PLACEHOLDER for Jae to choose. The price (Nigeria, checked on Meta's pricing page on 30 Oct 2026) is in one function, below.
--   Meta's pricing object gives a category and whether the message was billable, not an amount, so the amount comes from that function.
--
-- STATUS EVENTS (src/lib/notify/wabot.ts reads Meta's webhook into the arguments of notify_wa_apply_statuses)
--   Matched to our send by Meta's message id (the 'sent' line the run route or the bot wrote). One line per (message, status), so a replay changes
--   nothing. The pricing object appears in one webhook per message (sent, or delivered/read); the first one seen prices the message: billable
--   gives the price of its category, not billable gives 0 and the line says '<category>:free'. A status for a message we did not send is dropped.
-- ============================================================================
begin;

-- ------------------------------------------------------------------ columns, tables, settings ---
alter table public.notify_prefs add column if not exists wa_stopped_at timestamptz;
create index if not exists notify_prefs_wa_number_idx on public.notify_prefs (whatsapp_number) where whatsapp_number is not null;

alter table public.notify_sends add column if not exists pricing text;
do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'notify_sends_pricing_len') then
    alter table public.notify_sends add constraint notify_sends_pricing_len check (pricing is null or char_length(pricing) <= 60);
  end if;
end $chk$;
create unique index if not exists notify_sends_wa_priced_idx on public.notify_sends (provider_message_id) where pricing is not null and provider = 'whatsapp';
create index if not exists notify_sends_wa_idx on public.notify_sends (created_at) where provider = 'whatsapp';

create table if not exists public.notify_wa_inbound (
  msg_id      text primary key check (char_length(msg_id) between 1 and 200),
  number_hash text not null check (char_length(number_hash) = 64),
  keyword     text not null check (keyword in ('stop', 'start', 'ticket', 'help', 'other')),
  reply_kind  text check (reply_kind is null or reply_kind in ('stop', 'start', 'start_no', 'ticket', 'ticket_none', 'help')),
  created_at  timestamptz not null default clock_timestamp()
);
create index if not exists notify_wa_inbound_number_idx on public.notify_wa_inbound (number_hash, created_at);
create index if not exists notify_wa_inbound_age_idx on public.notify_wa_inbound (created_at);
alter table public.notify_wa_inbound enable row level security;
revoke all on public.notify_wa_inbound from anon, authenticated;
grant all on public.notify_wa_inbound to service_role;

-- A re-run never changes a value Ola or Jae set.
insert into public.notify_config (key, value) values ('whatsapp_monthly_budget_usd', '50'), ('whatsapp_reply_daily_max', '6')
on conflict (key) do nothing;

-- ------------------------------------------------------------------ small helpers ---
-- THE PRICE. USD per delivered WhatsApp message to Nigeria (+234), from Meta's pricing page, checked 30 Oct 2026
-- (docs/reminders-research.md). Meta's webhook says which category a message was billed in, not an amount, so this is the one place the
-- amount lives. Service messages (the bot's replies) are free up to 1,000 a month per number and the same price as utility after that
-- (from 1 Oct 2026). A category not listed is priced as marketing, the dearest, so the budget errs on the safe side.
create or replace function public._notify_wa_price(p_category text) returns numeric
language sql immutable set search_path = public, pg_temp as $$
  select case lower(coalesce(p_category, 'utility'))
           when 'utility' then 0.0067 when 'authentication' then 0.0067 when 'service' then 0.0067 else 0.0516 end::numeric;
$$;

create or replace function public._notify_wa_hash(p_number text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(coalesce(p_number, ''), 'UTF8')), 'hex');
$$;

-- +2348012345678 -> +234*******78 : enough for a person to recognise their own number, not enough to read it out of a log.
create or replace function public._notify_wa_mask(p_number text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when p_number ~ '^\+[1-9][0-9]{7,14}$' then left(p_number, 4) || repeat('*', char_length(p_number) - 6) || right(p_number, 2) else null end;
$$;

create or replace function public.notify_wa_normalise(p_raw text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  s text := btrim(coalesce(p_raw, ''));
  d text;
begin
  if s = '' or char_length(s) > 32 or s !~ '^[+0-9 ()./-]+$' then return null; end if;
  d := regexp_replace(s, '[^0-9]', '', 'g');
  if left(s, 1) = '+' then
    null; -- international: the digits as given
  elsif left(d, 2) = '00' then
    d := substr(d, 3);
  elsif left(d, 1) = '0' then
    d := '234' || substr(d, 2);
  elsif left(d, 3) = '234' then
    null;
  elsif d ~ '^[789][0-9]{9}$' then
    d := '234' || d;
  else
    return null; -- a foreign number must be written with its +
  end if;
  if d ~ '^2340' then d := '234' || substr(d, 5); end if; -- +234 (0) 801 ...
  if d !~ '^[1-9][0-9]{7,14}$' then return null; end if;
  if left(d, 3) = '234' and d !~ '^234[789][0-9]{9}$' then return null; end if;
  return '+' || d;
end $$;

create or replace function public._notify_wa_users(p_number text) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(np.user_id order by np.user_id), '{}'::uuid[]) from public.notify_prefs np where np.whatsapp_number = p_number;
$$;

create or replace function public.notify_wa_find(p_number text) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select public._notify_wa_users(public.notify_wa_normalise(p_number));
$$;

-- ------------------------------------------------------------------ STOP and START ---
create or replace function public.notify_wa_stop(p_number text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n text := public.notify_wa_normalise(p_number); v integer;
begin
  if n is null then return 0; end if;
  update public.notify_prefs set whatsapp_on = false, wa_stopped_at = now(), updated_at = now() where whatsapp_number = n and whatsapp_on;
  get diagnostics v = row_count;
  return v;
end $$;

-- Only a person who agreed before comes back. agreed_at and agreed_how are the record of that agreement (checkout or settings) and are kept.
create or replace function public.notify_wa_start(p_number text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n text := public.notify_wa_normalise(p_number); v integer;
begin
  if n is null then return 0; end if;
  update public.notify_prefs set whatsapp_on = true, wa_stopped_at = null, updated_at = now()
   where whatsapp_number = n and not whatsapp_on and agreed_at is not null and agreed_how is not null;
  get diagnostics v = row_count;
  return v;
end $$;

-- ------------------------------------------------------------------ TICKET ---
-- A person's next upcoming ticket (valid, event live and not over): the event, nothing about anyone.
create or replace function public._notify_wa_next_ticket(p_user uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('event_id', e.id, 'title', e.title, 'slug', e.slug, 'starts_at', e.starts_at, 'timezone', e.timezone, 'venue_name', e.venue_name)
    from public.ev_tickets t join public.events e on e.id = t.event_id
   where t.owner_id = p_user and t.status = 'valid' and e.status in ('live', 'unlisted') and public._notify_event_end(e) > p_now
   order by e.starts_at, t.seat
   limit 1;
$$;

-- ------------------------------------------------------------------ one message from a guest ---
-- p_keyword: stop | start | ticket | help | other (the route matches the text exactly, ignoring case and spaces).
-- Answers { status: 'ignored' | 'duplicate' | 'ok', reply: null | stop | start | start_no | ticket | ticket_none | help, ticket: {...} (reply 'ticket' only) }.
create or replace function public.notify_wa_inbound(p_msg text, p_number text, p_keyword text, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n       text := public.notify_wa_normalise(p_number);
  h       text;
  v_hit   integer;
  v_users uuid[];
  v_kind  text;
  v_tix   jsonb := null;
  v_max   integer := coalesce(nullif(public._notify_cfg('whatsapp_reply_daily_max', '6'), '')::integer, 6);
  v_class text[];
begin
  if p_msg is null or btrim(p_msg) = '' or char_length(p_msg) > 200 or n is null or p_keyword is null or p_keyword not in ('stop', 'start', 'ticket', 'help', 'other') then
    return jsonb_build_object('status', 'ignored', 'reply', null);
  end if;
  h := public._notify_wa_hash(n);
  -- Two messages from one number at the same moment take turns, so the reply limits below cannot both be passed.
  perform pg_advisory_xact_lock(hashtext(h));

  insert into public.notify_wa_inbound (msg_id, number_hash, keyword, created_at) values (p_msg, h, p_keyword, p_now) on conflict (msg_id) do nothing;
  get diagnostics v_hit = row_count;
  if v_hit = 0 then return jsonb_build_object('status', 'duplicate', 'reply', null); end if;
  delete from public.notify_wa_inbound where created_at < p_now - interval '90 days';

  v_users := public._notify_wa_users(n);
  if p_keyword = 'stop' then
    perform public.notify_wa_stop(n);
    v_kind := 'stop';
  elsif p_keyword = 'start' then
    if public.notify_wa_start(n) > 0 or exists (select 1 from public.notify_prefs np where np.whatsapp_number = n and np.whatsapp_on) then v_kind := 'start';
    else v_kind := 'start_no';
    end if;
  elsif p_keyword = 'ticket' then
    if cardinality(v_users) = 1 then
      v_tix := public._notify_wa_next_ticket(v_users[1], p_now);
      v_kind := case when v_tix is null then 'ticket_none' else 'ticket' end;
    else
      v_kind := 'help'; -- nobody, or a shared number: the help text, and nothing about anyone
    end if;
  else
    v_kind := 'help';
  end if;

  -- The reply limits. The keyword has been acted on whatever happens below.
  v_class := case when v_kind in ('help', 'start_no', 'ticket_none') then array['help', 'start_no', 'ticket_none'] else array[v_kind] end;
  if v_kind in ('help', 'start_no', 'ticket_none', 'stop')
     and exists (select 1 from public.notify_wa_inbound i where i.number_hash = h and i.reply_kind = any (v_class) and i.created_at > p_now - interval '1 hour') then
    return jsonb_build_object('status', 'ok', 'reply', null, 'why', 'hourly limit');
  end if;
  if (select count(*) from public.notify_wa_inbound i where i.number_hash = h and i.reply_kind is not null and i.created_at > p_now - interval '24 hours') >= v_max then
    return jsonb_build_object('status', 'ok', 'reply', null, 'why', 'daily limit');
  end if;
  if v_kind <> 'stop' and public._notify_wa_room(p_now) <= 0 then
    return jsonb_build_object('status', 'ok', 'reply', null, 'why', 'budget reached');
  end if;
  update public.notify_wa_inbound set reply_kind = v_kind where msg_id = p_msg;
  return jsonb_build_object('status', 'ok', 'reply', v_kind) || case when v_tix is not null then jsonb_build_object('ticket', v_tix) else '{}'::jsonb end;
end $$;

-- A reply (or any message not from the queue) has gone out: log it so Meta's pricing status can find it. Once per message id.
create or replace function public.notify_wa_record_reply(p_message_id text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_message_id is null or btrim(p_message_id) = '' or char_length(p_message_id) > 200 then return false; end if;
  if exists (select 1 from public.notify_sends s where s.provider = 'whatsapp' and s.provider_message_id = p_message_id and s.status = 'sent') then return false; end if;
  insert into public.notify_sends (queue_id, channel, provider, status, provider_message_id) values (null, 'whatsapp', 'whatsapp', 'sent', p_message_id);
  return true;
end $$;

-- ------------------------------------------------------------------ the monthly budget ---
create or replace function public._notify_wa_month_start(p_now timestamptz) returns timestamptz
language sql stable set search_path = public, pg_temp as $$
  select date_trunc('month', p_now at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
$$;

create or replace function public.notify_wa_budget(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_cfg      text := public._notify_cfg('whatsapp_monthly_budget_usd', '50');
  v_budget   numeric := case when v_cfg ~ '^[0-9]+(\.[0-9]+)?$' then v_cfg::numeric else 50 end;
  v_from     timestamptz := public._notify_wa_month_start(p_now);
  v_est      numeric := public._notify_wa_price('utility');
  v_spent    numeric;
  v_unpriced integer;
  v_flight   integer;
  v_pending  numeric;
  v_room     numeric;
begin
  select coalesce(sum(s.cost_usd), 0) into v_spent from public.notify_sends s where s.provider = 'whatsapp' and s.created_at >= v_from;
  -- Sent this month, not priced yet, and not failed on the way: counted at the estimate.
  select count(distinct s.provider_message_id) into v_unpriced
    from public.notify_sends s
   where s.provider = 'whatsapp' and s.status = 'sent' and s.pricing is null and s.created_at >= v_from and s.provider_message_id is not null
     and not exists (select 1 from public.notify_sends x where x.provider = 'whatsapp' and x.provider_message_id = s.provider_message_id
                        and (x.pricing is not null or x.status = 'failed'));
  select count(*) into v_flight from public.notify_queue q
   where q.channel = 'whatsapp' and q.status = 'claimed' and q.claimed_at > p_now - interval '10 minutes';
  v_pending := (v_unpriced + v_flight) * v_est;
  v_room := case when v_budget <= 0 then 0 else greatest(floor((v_budget - v_spent - v_pending) / v_est), 0) end;
  return jsonb_build_object(
    'budget_usd', v_budget, 'spent_usd', v_spent, 'unpriced', v_unpriced, 'in_flight', v_flight, 'estimate_usd', v_est,
    'projected_usd', v_spent + v_pending,
    'percent', case when v_budget > 0 then round(100 * (v_spent + v_pending) / v_budget, 1) else 100 end,
    'room', least(v_room, 2147483647)::integer);
end $$;

-- Replaces the stub in events_r1_notify.sql: how many more messages the budget pays for.
create or replace function public._notify_wa_room(p_now timestamptz) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select (public.notify_wa_budget(p_now) ->> 'room')::integer;
$$;

-- Just before a template goes out (the claim asked already; a STOP or a refund can land in between): the number to use, or null.
create or replace function public.notify_wa_recheck(p_queue uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare q public.notify_queue; c record;
begin
  select * into q from public.notify_queue where id = p_queue and channel = 'whatsapp' and status = 'claimed';
  if q.id is null then return null; end if;
  select * into c from public._notify_wa_check(q.user_id, q.event_id, q.kind);
  return c.v_number;
end $$;

-- ------------------------------------------------------------------ Meta's status events ---
-- p_events: a json array of { message_id, status (sent | delivered | read | failed), priced (bool: the pricing object was there), billable (bool),
-- category, error (text, "code: title") }, as src/lib/notify/wabot.ts makes them. Answers the counts.
create or replace function public.notify_wa_apply_statuses(p_events jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e       jsonb;
  c       jsonb := jsonb_build_object('applied', 0, 'duplicate', 0, 'unmatched', 0, 'ignored', 0);
  r       text;
  v_mid   text;
  v_st    text;
  v_queue uuid;
  v_found boolean;
  v_err   text;
  v_cost  numeric;
  v_label text;
  v_hit   integer;
  v_did   boolean;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return c; end if;
  for e in select x from jsonb_array_elements(p_events) x loop
    r := 'ignored';
    if jsonb_typeof(e) = 'object' then
      v_mid := nullif(btrim(e ->> 'message_id'), '');
      v_st := e ->> 'status';
      if v_mid is not null and char_length(v_mid) <= 200 and v_st in ('sent', 'delivered', 'read', 'failed') then
        v_queue := null; v_found := null;
        select s.queue_id, true into v_queue, v_found from public.notify_sends s
         where s.provider = 'whatsapp' and s.provider_message_id = v_mid and s.status = 'sent' order by s.created_at limit 1;
        if v_found is not true then
          r := 'unmatched';
        else
          v_did := false;
          -- Pricing first: the first webhook of a message that carries it prices the message (one line, enforced by notify_sends_wa_priced_idx).
          if v_st <> 'failed' and coalesce((e ->> 'priced')::boolean, false) then
            v_cost := case when coalesce((e ->> 'billable')::boolean, false) then public._notify_wa_price(e ->> 'category') else 0 end;
            v_label := left(coalesce(nullif(regexp_replace(lower(coalesce(e ->> 'category', '')), '[^a-z_]', '', 'g'), ''), 'unknown') || case when v_cost = 0 then ':free' else '' end, 60);
            insert into public.notify_sends (queue_id, channel, provider, status, provider_message_id, cost_usd, pricing)
            values (v_queue, 'whatsapp', 'whatsapp', v_st, v_mid, v_cost, v_label)
            on conflict (provider_message_id) where pricing is not null and provider = 'whatsapp' do nothing;
            get diagnostics v_hit = row_count;
            v_did := v_hit = 1;
          end if;
          -- The status itself (our own 'sent' line already says it was sent).
          if v_st in ('delivered', 'read') and not exists (
               select 1 from public.notify_sends x where x.provider = 'whatsapp' and x.provider_message_id = v_mid and x.status = v_st) then
            insert into public.notify_sends (queue_id, channel, provider, status, provider_message_id) values (v_queue, 'whatsapp', 'whatsapp', v_st, v_mid);
            v_did := true;
          elsif v_st = 'failed' then
            v_err := left(regexp_replace(coalesce(e ->> 'error', 'failed'), '\+?[0-9]{8,}', '***', 'g'), 300);
            if not exists (select 1 from public.notify_sends x where x.provider = 'whatsapp' and x.provider_message_id = v_mid and x.status = 'failed' and coalesce(x.error, '') = v_err) then
              insert into public.notify_sends (queue_id, channel, provider, status, provider_message_id, error) values (v_queue, 'whatsapp', 'whatsapp', 'failed', v_mid, v_err);
              v_did := true;
            end if;
          end if;
          r := case when v_did then 'applied' else 'duplicate' end;
        end if;
      end if;
    end if;
    c := jsonb_set(c, array[r], to_jsonb(coalesce((c ->> r)::int, 0) + 1));
  end loop;
  return c;
end $$;

-- ------------------------------------------------------------------ the checkout switch and settings (signed in) ---
create or replace function public.notify_set_my_whatsapp(p_number text, p_on boolean, p_how text default 'checkout') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); n text;
begin
  if me is null or not public.has_account() then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_on is null then raise exception 'on or off is needed' using errcode = '22023'; end if;
  if p_on then
    if p_how is null or p_how not in ('checkout', 'settings') then raise exception 'unknown way of agreeing' using errcode = '22023'; end if;
    n := public.notify_wa_normalise(p_number);
    if n is null then raise exception 'that is not a phone number we can use' using errcode = '22023'; end if;
    insert into public.notify_prefs (user_id, whatsapp_on, whatsapp_number, agreed_at, agreed_how, wa_stopped_at)
    values (me, true, n, now(), p_how, null)
    on conflict (user_id) do update
      set whatsapp_on = true, whatsapp_number = excluded.whatsapp_number, agreed_at = now(), agreed_how = excluded.agreed_how, wa_stopped_at = null, updated_at = now();
  else
    update public.notify_prefs set whatsapp_on = false, updated_at = now() where user_id = me;
  end if;
  return public.notify_get_my_whatsapp();
end $$;

create or replace function public.notify_get_my_whatsapp() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); p record;
begin
  if me is null or not public.has_account() then raise exception 'Sign in first' using errcode = '42501'; end if;
  select np.whatsapp_on, np.whatsapp_number into p from public.notify_prefs np where np.user_id = me;
  return jsonb_build_object('whatsapp_on', coalesce(p.whatsapp_on, false), 'number', public._notify_wa_mask(p.whatsapp_number));
end $$;

-- ------------------------------------------------------------------ access ---
revoke all on function
  public._notify_wa_price(text), public._notify_wa_hash(text), public._notify_wa_mask(text), public.notify_wa_normalise(text),
  public._notify_wa_users(text), public.notify_wa_find(text), public.notify_wa_stop(text), public.notify_wa_start(text),
  public._notify_wa_next_ticket(uuid, timestamptz), public.notify_wa_inbound(text, text, text, timestamptz), public.notify_wa_record_reply(text),
  public._notify_wa_month_start(timestamptz), public.notify_wa_budget(timestamptz), public._notify_wa_room(timestamptz),
  public.notify_wa_recheck(uuid), public.notify_wa_apply_statuses(jsonb),
  public.notify_set_my_whatsapp(text, boolean, text), public.notify_get_my_whatsapp()
  from public, anon, authenticated;
grant execute on function
  public.notify_wa_normalise(text), public.notify_wa_find(text), public.notify_wa_stop(text), public.notify_wa_start(text),
  public.notify_wa_inbound(text, text, text, timestamptz), public.notify_wa_record_reply(text), public.notify_wa_budget(timestamptz),
  public.notify_wa_recheck(uuid), public.notify_wa_apply_statuses(jsonb)
  to service_role;
grant execute on function public.notify_set_my_whatsapp(text, boolean, text), public.notify_get_my_whatsapp() to authenticated;

notify pgrst, 'reload schema';
commit;
