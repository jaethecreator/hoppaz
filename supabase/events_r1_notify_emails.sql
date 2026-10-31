-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1: notifications, step 2 (the triggers that queue the guest and host emails).
-- Plans: docs/reminders-email-plan.md (section 2, the list of emails, and "Update, 31 Oct"). Step 1 is events_r1_notify.sql.
--
-- RUN ORDER: the Release 1 files (events, registrations, tickets, pops, pay), then events_r1_notify.sql, then THIS FILE. Safe to run
-- again. It edits no older function and no older table: it adds triggers on ev_registrations, ev_orders, events, ev_event_links and
-- ev_pops (new triggers, the old code is not touched), and it replaces the one stub step 1 left for it (_notify_claim_extra).
--
-- NOTHING IS SENT FROM HERE. A trigger writes a row to notify_queue (through notify_enqueue, or one insert for a whole audience) and
-- nothing more. The Next.js route /api/notify/run renders the email from the row's kind and payload (src/lib/notify/templates) and sends it.
-- Nothing is queued while the notify_email flag is off, so this file changes nothing until Ola switches that on.
--
-- THE RULE FOR EVERY TRIGGER: A NOTIFICATION FAILURE MUST NEVER ROLL BACK THE GUEST'S ACTION. Each trigger function catches its own errors,
-- raises a warning, and returns. (Same as _notify_pop_trigger in step 1.) The tests break the queue on purpose and check register,
-- approve, pay, cancel and edit still work.
--
-- WHAT QUEUES WHAT (kind: email G-number, priority, when). The kinds and priorities are KIND_RULES in src/lib/notify/types.ts.
--   registered      G1   1  a registration becomes 'going' (free ticket types only; a paid ticket is announced by its receipt)
--   request_sent    G3   2  registered for an approval event ('requested')
--   approved        G4   1  the host approved: requested -> going
--   declined        G5   3  the host declined: requested, waitlisted or going -> declined
--   waitlisted      G6   3  joined the waitlist, or the host said yes to a full event
--   spot_opened     G7   1  waitlisted -> going (a cancel opened a place, or the host promoted them)
--   you_cancelled   G13  3  the guest cancelled their own going, requested or waitlisted registration
--   receipt         G2   1  an order is paid and its tickets issued (not when a refund is owed instead)
--   refund_sent     G14  2  an order becomes 'refunded' (card refund paid, or the host marked a bank transfer paid back)
--   event_changed   G8   1  start time, timezone, venue or in-person/online changed, or the online link changed. Also a WhatsApp row.
--   event_cancelled G9   1  the event becomes 'cancelled'. Also a WhatsApp row.
--   host_live       H1   3  the event becomes live or unlisted, to its host, once per event
--   host_pop        G12  3  a host Pop goes out (never an automatic Pop: those are the reminders step 1 queues), to people whose email_pops is on
--   thanks          G15  5  the morning after, to people who checked in or have a used ticket. notify_enqueue_thanks(), called by notify_tick.
-- Recipients of event_changed and event_cancelled: going, requested and waitlisted registrations. WhatsApp copies of those two go only to a
-- guest with a paid order for the event and WhatsApp on with a number (the claim asks again at send time, as in step 1).
--
-- DEDUPE KEYS (the part that is easy to get wrong). notify_enqueue's default key (kind:event:user:channel) would send "event changed" once
-- per guest for ever, and "you're going" once per guest even after they cancelled and came back. So every kind has its own key:
--   registered, request_sent, approved, declined, waitlisted, spot_opened, you_cancelled:  kind:registration:created_at in microseconds.
--       A registration row is re-used when someone cancels and registers again, and it is given a new created_at then, so a returning guest is
--       a new "cycle" and gets the mail again; a trigger firing twice in one cycle does not send twice.
--   receipt, refund_sent:  kind:order. One per order.
--   event_changed, event_cancelled:  kind:event:user:channel:clock microseconds. Every real change sends again. Changes made before the first
--       mail has been sent are folded into the mail that is still waiting (one mail, showing the first old value and the latest new one);
--       if they cancel out (a time moved and moved back) the waiting mail is dropped and a note is logged.
--   host_pop:  kind:pop:user:channel.   thanks:  kind:event:user:channel.   host_live:  kind:event:host.
--
-- PAYLOADS carry what the template needs and no secrets: event facts (title, start, end, timezone, venue, kind, slug, host name), the guest's
-- name, and a few kind specific fields. No email address, no online link, no ticket token. The ticket mails (registered, approved,
-- spot_opened, receipt) get their tickets, with fresh signed tokens, ADDED WHEN THE ROW IS CLAIMED (_notify_claim_extra, called by
-- notify_claim_due): the token is never stored in the queue, is always the ticket's current version, and a guest who cancelled meanwhile
-- gets nothing (the claim skips those ticket mails if the registration is no longer going). If the ticket secret is not set yet the mail is
-- sent with the door code and no QR.
--
-- ONE DECISION FOR JAE/OLA: thanks (G15) is switched off by notify_prefs.email_reminders (there is no better column; the unsubscribe step may
-- add one). A Pop ignores email_reminders and obeys email_pops.
--
-- THE TIMER. notify_tick (step 1) calls notify_enqueue_thanks() every minute when this file is loaded. Nothing else to schedule.
-- ============================================================================
begin;

-- ------------------------------------------------------------------ helpers ---
-- A person's name for "Hey Ada": the profile's display name, else the handle, else ''.
create or replace function public._notify_name(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.handle), '')) from public.profiles p where p.id = p_user), '');
$$;

-- When an event is over: its end, else three hours after it starts (the same default as ev_register).
create or replace function public._notify_event_end(p_event public.events) returns timestamptz
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_event.ends_at, p_event.starts_at + interval '3 hours');
$$;

-- The facts every template shows. Nothing secret: the online link is not here.
create or replace function public._notify_event_facts(p_event uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
           'event_id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'timezone', e.timezone,
           'venue_name', e.venue_name, 'kind', e.kind, 'online', e.kind = 'online', 'slug', e.slug,
           'host_name', public._notify_name(coalesce(e.host_id, e.created_by)))
    from public.events e where e.id = p_event;
$$;

-- Can this person be emailed at all: an address, and not on the suppression list. (The claim asks again at send time.)
create or replace function public._notify_email_ok(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from auth.users u
                  where u.id = p_user and nullif(btrim(u.email), '') is not null
                    and not exists (select 1 from public.notify_suppressed s where s.address = lower(btrim(u.email))));
$$;

-- WhatsApp is for a guest with a paid order for the event, WhatsApp on, and a number.
create or replace function public._notify_wa_ok(p_user uuid, p_event uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.notify_prefs np where np.user_id = p_user and np.whatsapp_on and np.whatsapp_number is not null)
     and exists (select 1 from public.ev_orders o where o.buyer_id = p_user and o.event_id = p_event and o.status = 'paid');
$$;

-- Is this registration for a paid ticket type? (A paid ticket gets a receipt, not "you're going".)
create or replace function public._notify_reg_paid(p_event uuid, p_type uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select t.price_naira > 0 from public._ev_types(p_event) t where t.id = coalesce(p_type, public._ev_first_type(p_event))), false);
$$;

-- Microseconds of a timestamp, for dedupe keys.
create or replace function public._notify_us(p_at timestamptz) returns text
language sql immutable set search_path = public, pg_temp as $$
  select (extract(epoch from p_at) * 1000000)::bigint::text;
$$;

-- A ticket's signed token, or null when the signing secret is not set yet (the mail then goes with the door code and no QR).
create or replace function public._notify_token(p_ticket uuid, p_event uuid, p_version integer) returns text
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  return public._ev_token(p_ticket, p_event, p_version);
exception when others then
  return null;
end $$;

-- Step 1's notify_claim_due adds this to the payload of a row as it is handed out. For the four ticket mails: the person's tickets.
create or replace function public._notify_claim_extra(p_kind text, p_event uuid, p_user uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_kind in ('registered', 'approved', 'spot_opened', 'receipt') and p_event is not null then
           jsonb_build_object('tickets', coalesce((
             select jsonb_agg(jsonb_build_object('seat', t.seat, 'code', t.code, 'token', public._notify_token(t.id, t.event_id, t.version)) order by t.seat)
               from public.ev_tickets t
              where t.event_id = p_event and t.owner_id = p_user and t.status in ('valid', 'used')), '[]'::jsonb))
         else '{}'::jsonb end;
$$;

-- ------------------------------------------------------------------ queueing helpers ---
-- One person, one email, through notify_enqueue (which checks the notify_email flag). Null: not queued.
create or replace function public._notify_send(p_user uuid, p_kind text, p_event uuid, p_payload jsonb, p_priority integer, p_key text,
                                               p_expires timestamptz default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._notify_email_ok(p_user) then return null; end if;
  return public.notify_enqueue(p_user, p_kind, p_event, p_payload, p_priority, null, p_key, 'email', 'guest', p_expires);
end $$;

-- A whole audience in one statement (a Pop to a few thousand guests must not be a few thousand function calls inside the host's request).
-- Same checks as notify_enqueue: the channel's flag, and the key unique. Per person: an address that is not suppressed (email), or a paid
-- order and WhatsApp on (whatsapp), and the preference that kind answers to. Returns how many rows were queued.
create or replace function public._notify_fan(p_kind text, p_event uuid, p_users uuid[], p_base jsonb, p_priority integer, p_key text,
                                              p_channel text default 'email', p_due timestamptz default null, p_expires timestamptz default null,
                                              p_paid_flag boolean default false) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if p_users is null or cardinality(p_users) = 0 then return 0; end if;
  if not public._notify_flag(case p_channel when 'email' then 'notify_email' else 'notify_whatsapp' end) then return 0; end if;
  insert into public.notify_queue (user_id, kind, event_id, channel, cap_kind, payload, priority, due_at, expires_at, dedupe_key)
  select u.id, p_kind, p_event, p_channel, 'guest',
         p_base || jsonb_build_object('name', public._notify_name(u.id))
                || case when p_paid_flag
                        then jsonb_build_object('paid', exists (select 1 from public.ev_orders o where o.buyer_id = u.id and o.event_id = p_event and o.status in ('paid', 'refund_pending')))
                        else '{}'::jsonb end,
         p_priority, coalesce(p_due, now()), p_expires, p_key || ':' || u.id::text || ':' || p_channel
    from unnest(p_users) as u(id)
   where case p_channel
           when 'whatsapp' then public._notify_wa_ok(u.id, p_event)
           else public._notify_email_ok(u.id)
                and not (p_kind = 'host_pop' and exists (select 1 from public.notify_prefs np where np.user_id = u.id and not np.email_pops))
                and not (p_kind = 'thanks' and exists (select 1 from public.notify_prefs np where np.user_id = u.id and not np.email_reminders))
         end
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ------------------------------------------------------------------ registrations: G1, G3, G4, G5, G6, G7, G13 ---
create or replace function public._notify_reg_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e       public.events;
  v_old   text := case when tg_op = 'UPDATE' then old.status end;
  v_kind  text;
  v_prio  integer;
  v_extra jsonb := '{}'::jsonb;
begin
  begin
    if not public._notify_flag('notify_email') then return null; end if;
    select * into e from public.events where id = new.event_id;
    if e.id is null or e.status not in ('live', 'unlisted') then return null; end if;

    if new.status = 'going' then
      if v_old is null or v_old = 'cancelled' then
        -- A paid ticket is announced by the receipt (the order trigger below), and so is one a failed refund brings back.
        if not public._notify_reg_paid(new.event_id, new.ticket_type_id) then v_kind := 'registered'; v_prio := 1; end if;
      elsif v_old = 'requested' then
        v_kind := 'approved'; v_prio := 1;
      elsif v_old = 'waitlisted' then
        v_kind := 'spot_opened'; v_prio := 1;
      end if;
    elsif new.status = 'requested' then
      -- (waitlisted -> requested is the waitlist moving up under an approval event: the host still has to decide, so no mail yet.)
      if v_old is null or v_old = 'cancelled' then v_kind := 'request_sent'; v_prio := 2; end if;
    elsif new.status = 'waitlisted' then
      if v_old is null or v_old in ('cancelled', 'requested') then
        v_kind := 'waitlisted'; v_prio := 3;
        v_extra := jsonb_build_object('waitlist_pos', (select count(*)::int from public.ev_registrations w
                                                         where w.event_id = new.event_id and w.status = 'waitlisted' and (w.created_at, w.id) <= (new.created_at, new.id)));
      end if;
    elsif new.status = 'declined' then
      if v_old in ('requested', 'waitlisted', 'going') then v_kind := 'declined'; v_prio := 3; end if;
    elsif new.status = 'cancelled' then
      -- Only the guest's own cancel. A refund voids the seats and cancels the registration too, but the guest cannot cancel a paid order
      -- (ev_cancel_registration answers paid_use_refund), so a paid or refunding order means this was not their doing.
      if v_old in ('going', 'requested', 'waitlisted') and auth.uid() is not distinct from new.user_id
         and not exists (select 1 from public.ev_orders o where o.event_id = new.event_id and o.buyer_id = new.user_id and o.status in ('paid', 'refund_pending')) then
        v_kind := 'you_cancelled'; v_prio := 3;
      end if;
    end if;
    if v_kind is null then return null; end if;

    perform public._notify_send(
      new.user_id, v_kind, new.event_id,
      public._notify_event_facts(new.event_id) || jsonb_build_object('name', public._notify_name(new.user_id), 'ticket_name', coalesce(
        (select t.name from public._ev_types(new.event_id) t where t.id = coalesce(new.ticket_type_id, public._ev_first_type(new.event_id))), 'General')) || v_extra,
      v_prio, v_kind || ':' || new.id::text || ':' || public._notify_us(new.created_at));
  exception when others then
    raise warning 'notify: registration % mail was not queued: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_reg_insert on public.ev_registrations;
create trigger notify_reg_insert after insert on public.ev_registrations
  for each row when (new.status in ('going', 'requested', 'waitlisted'))
  execute function public._notify_reg_trigger();
drop trigger if exists notify_reg_update on public.ev_registrations;
create trigger notify_reg_update after update of status on public.ev_registrations
  for each row when (old.status is distinct from new.status)
  execute function public._notify_reg_trigger();

-- ------------------------------------------------------------------ orders: G2 and G14 ---
create or replace function public._notify_order_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_amount bigint;
  v_method text;
begin
  begin
    if not public._notify_flag('notify_email') then return null; end if;
    if new.status = 'paid' and old.status in ('open', 'expired', 'failed') then
      -- Seats issued and no refund owed. (A late payment on a full or cancelled event is refunded instead and gets no receipt.)
      if new.issued_seats > 0 and not new.needs_refund then
        perform public._notify_send(
          new.buyer_id, 'receipt', new.event_id,
          public._notify_event_facts(new.event_id) || jsonb_build_object(
            'name', public._notify_name(new.buyer_id), 'quantity', new.quantity, 'ticket_name', new.ticket_name, 'gross_kobo', new.gross_kobo,
            'fee_kobo', case when new.buyer_pays_fee then new.processing_fee_kobo end,
            'order_ref', 'ORD-' || upper(left(replace(new.id::text, '-', ''), 8))),
          1, 'receipt:' || new.id::text);
      end if;
    elsif new.status = 'refunded' and old.status is distinct from 'refunded' then
      select f.amount_kobo, f.method into v_amount, v_method from public.ev_refunds f
       where f.order_id = new.id and f.status in ('paid', 'manual_done') order by f.updated_at desc limit 1;
      perform public._notify_send(
        new.buyer_id, 'refund_sent', new.event_id,
        public._notify_event_facts(new.event_id) || jsonb_build_object(
          'name', public._notify_name(new.buyer_id), 'amount_kobo', coalesce(v_amount, new.gross_kobo), 'method', coalesce(v_method, 'card')),
        2, 'refund_sent:' || new.id::text);
    end if;
  exception when others then
    raise warning 'notify: order % mail was not queued: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_order_status on public.ev_orders;
create trigger notify_order_status after update of status on public.ev_orders
  for each row when (old.status is distinct from new.status)
  execute function public._notify_order_trigger();

-- ------------------------------------------------------------------ events: H1, G8, G9 ---
-- Which of time and place changed, worked out from a payload that holds the current values and the prev_ ones.
create or replace function public._notify_change_flags(p jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'time_changed', (p ->> 'starts_at')::timestamptz is distinct from (p ->> 'prev_starts_at')::timestamptz
                    or coalesce(p ->> 'timezone', '') is distinct from coalesce(p ->> 'prev_timezone', ''),
    'place_changed', coalesce(p ->> 'venue_name', '') is distinct from coalesce(p ->> 'prev_venue_name', '')
                     or coalesce(p ->> 'kind', '') is distinct from coalesce(p ->> 'prev_kind', ''));
$$;

-- Queue "the plan changed" for everyone with a place, folding it into a mail that has not been sent yet. p_prev holds prev_starts_at,
-- prev_timezone, prev_venue_name and prev_kind (what the event was before this edit).
create or replace function public._notify_event_changed(p_event uuid, p_prev jsonb, p_link boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e         public.events;
  v_facts   jsonb;
  v_base    jsonb;
  v_key     text := 'event_changed:' || p_event::text || ':' || public._notify_us(clock_timestamp());
  v_te      uuid[];
  v_tw      uuid[];
  v_guests  uuid[];
begin
  select * into e from public.events where id = p_event;
  if e.id is null or e.status not in ('live', 'unlisted') or public._notify_event_end(e) < now() then return; end if;
  if not public._notify_flag('notify_email') and not public._notify_flag('notify_whatsapp') then return; end if;
  v_facts := public._notify_event_facts(p_event);

  -- 1. Mails still waiting for this event take the new values (and the link flag). Their prev_ values stay as the first edit made them.
  with up as (
    update public.notify_queue q
       set payload = q.payload || v_facts || jsonb_build_object('link_changed', coalesce((q.payload ->> 'link_changed')::boolean, false) or p_link),
           updated_at = clock_timestamp()
     where q.kind = 'event_changed' and q.event_id = p_event and q.status = 'queued'
    returning q.user_id, q.channel)
  select array_agg(user_id) filter (where channel = 'email'), array_agg(user_id) filter (where channel = 'whatsapp') into v_te, v_tw from up;
  update public.notify_queue q set payload = q.payload || public._notify_change_flags(q.payload)
   where q.kind = 'event_changed' and q.event_id = p_event and q.status = 'queued';
  -- ... and a waiting mail whose change was undone is dropped, with a note.
  with gone as (
    update public.notify_queue q set status = 'dropped', updated_at = clock_timestamp()
     where q.kind = 'event_changed' and q.event_id = p_event and q.status = 'queued'
       and not coalesce((q.payload ->> 'time_changed')::boolean, false) and not coalesce((q.payload ->> 'place_changed')::boolean, false)
       and not coalesce((q.payload ->> 'link_changed')::boolean, false)
    returning q.id, q.channel)
  insert into public.notify_sends (queue_id, channel, provider, status, error)
  select id, channel, 'policy', 'skipped', 'dropped: the change was undone before the mail was sent' from gone;

  -- 2. Everyone else with a place gets a new mail.
  v_base := v_facts || p_prev || jsonb_build_object('link_changed', p_link);
  v_base := v_base || public._notify_change_flags(v_base);
  if not (coalesce((v_base ->> 'time_changed')::boolean, false) or coalesce((v_base ->> 'place_changed')::boolean, false) or p_link) then return; end if;
  v_guests := array(select r.user_id from public.ev_registrations r where r.event_id = p_event and r.status in ('going', 'requested', 'waitlisted'));
  perform public._notify_fan('event_changed', p_event, array(select g from unnest(v_guests) g where g <> all (coalesce(v_te, '{}'))), v_base, 1, v_key, 'email');
  perform public._notify_fan('event_changed', p_event, array(select g from unnest(v_guests) g where g <> all (coalesce(v_tw, '{}'))), v_base, 1, v_key, 'whatsapp');
end $$;

create or replace function public._notify_event_change_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public._notify_event_changed(
      new.id,
      jsonb_build_object('prev_starts_at', old.starts_at, 'prev_timezone', old.timezone, 'prev_venue_name', old.venue_name, 'prev_kind', old.kind),
      false);
  exception when others then
    raise warning 'notify: the change of event % was not queued: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_event_change on public.events;
create trigger notify_event_change after update of starts_at, timezone, venue_name, kind on public.events
  for each row when (old.starts_at is distinct from new.starts_at or old.timezone is distinct from new.timezone
                     or old.venue_name is distinct from new.venue_name or old.kind is distinct from new.kind)
  execute function public._notify_event_change_trigger();

-- The online link is the "place" of an online event. It lives on its own table (ev_event_links), so it has its own trigger.
create or replace function public._notify_link_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.events;
begin
  begin
    select * into e from public.events where id = new.event_id;
    if e.id is not null then
      perform public._notify_event_changed(
        e.id, jsonb_build_object('prev_starts_at', e.starts_at, 'prev_timezone', e.timezone, 'prev_venue_name', e.venue_name, 'prev_kind', e.kind), true);
    end if;
  exception when others then
    raise warning 'notify: the link change of event % was not queued: %', new.event_id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_link_insert on public.ev_event_links;
create trigger notify_link_insert after insert on public.ev_event_links
  for each row execute function public._notify_link_trigger();
drop trigger if exists notify_link_update on public.ev_event_links;
create trigger notify_link_update after update of link on public.ev_event_links
  for each row when (old.link is distinct from new.link)
  execute function public._notify_link_trigger();

-- Cancelled (G9) and published (H1).
create or replace function public._notify_event_status_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old    text := case when tg_op = 'UPDATE' then old.status end;
  v_facts  jsonb;
  v_guests uuid[];
  v_key    text;
begin
  begin
    if new.status = 'cancelled' and v_old is distinct from 'cancelled' then
      if public._notify_event_end(new) < now() then return null; end if;
      v_facts := public._notify_event_facts(new.id);
      v_key := 'event_cancelled:' || new.id::text || ':' || public._notify_us(clock_timestamp());
      v_guests := array(select r.user_id from public.ev_registrations r where r.event_id = new.id and r.status in ('going', 'requested', 'waitlisted'));
      perform public._notify_fan('event_cancelled', new.id, v_guests, v_facts, 1, v_key, 'email', null, null, true);
      perform public._notify_fan('event_cancelled', new.id, v_guests, v_facts, 1, v_key, 'whatsapp', null, null, true);
    elsif new.status in ('live', 'unlisted') and (v_old is null or v_old not in ('live', 'unlisted')) and new.host_id is not null then
      -- Only a Release 1 event has a host to tell. The old listings (no host_id) are made by the Hoppaz team.
      perform public._notify_send(new.host_id, 'host_live', new.id, public._notify_event_facts(new.id) || jsonb_build_object('name', public._notify_name(new.host_id)),
                                  3, 'host_live:' || new.id::text);
    end if;
  exception when others then
    raise warning 'notify: the status change of event % was not queued: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_event_insert on public.events;
create trigger notify_event_insert after insert on public.events
  for each row when (new.status in ('live', 'unlisted'))
  execute function public._notify_event_status_trigger();
drop trigger if exists notify_event_status on public.events;
create trigger notify_event_status after update of status on public.events
  for each row when (old.status is distinct from new.status)
  execute function public._notify_event_status_trigger();

-- ------------------------------------------------------------------ host Pops: G12 ---
-- A Pop a host sent (now, or scheduled and now due). Automatic Pops (auto is set) are the reminders step 1 already queues.
create or replace function public._notify_host_pop_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e       public.events;
  v_users uuid[];
begin
  begin
    if new.status <> 'sent' or new.auto is not null then return null; end if;
    if not public._notify_flag('notify_email') then return null; end if;
    select * into e from public.events where id = new.event_id;
    if e.id is null or e.status not in ('live', 'unlisted') then return null; end if;
    -- The author is not mailed their own Pop.
    v_users := array(select rid from public.ev_pop_recipient_ids(new.id) as rid where rid is distinct from new.author_id);
    perform public._notify_fan('host_pop', e.id, v_users,
                               public._notify_event_facts(e.id) || jsonb_build_object('pop_id', new.id, 'body', left(new.body, 500)),
                               3, 'host_pop:' || new.id::text, 'email', null, public._notify_event_end(e));
  exception when others then
    raise warning 'notify: the Pop % was not queued as email: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists notify_host_pop_insert on public.ev_pops;
create trigger notify_host_pop_insert after insert on public.ev_pops
  for each row when (new.status = 'sent' and new.auto is null)
  execute function public._notify_host_pop_trigger();
drop trigger if exists notify_host_pop_update on public.ev_pops;
create trigger notify_host_pop_update after update of status on public.ev_pops
  for each row when (old.status is distinct from 'sent' and new.status = 'sent' and new.auto is null)
  execute function public._notify_host_pop_trigger();

-- ------------------------------------------------------------------ thanks for coming: G15 ---
-- Called every minute by notify_tick. For each live event whose "morning after" has come (10:00 in the event's timezone on the day after it
-- ended; an event that ends before 6 in the morning counts as the night before) and that has no thank you rows yet: one mail to everyone
-- who checked in or holds a used ticket. Only the last 30 hours are looked at, so a timer that was off does not send a stale thanks days later.
-- Priority 5 with no expiry: on a busy day the claim moves it to the next morning instead of dropping it.
create or replace function public.notify_enqueue_thanks(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x       record;
  v_users uuid[];
  v_base  jsonb;
  v_n     integer := 0;
begin
  if not public._notify_flag('notify_email') then return 0; end if;
  for x in
    select ev.id, ev.room_id, due.at as thanks_at
      from public.events ev
     cross join lateral (
       select ((((public._notify_event_end(ev) at time zone ev.timezone) - interval '6 hours')::date + 1)::timestamp + interval '10 hours') at time zone ev.timezone as at) due
     where ev.status in ('live', 'unlisted') and ev.starts_at between p_now - interval '10 days' and p_now
       and due.at <= p_now and due.at > p_now - interval '30 hours'
       and not exists (select 1 from public.notify_queue n where n.kind = 'thanks' and n.event_id = ev.id)
  loop
    begin
      v_users := array(
        select r.user_id from public.ev_registrations r
         where r.event_id = x.id
           and (r.status = 'checked_in'
                or (r.status = 'going' and exists (select 1 from public.ev_tickets t where t.event_id = r.event_id and t.owner_id = r.user_id and t.status = 'used'))));
      v_base := public._notify_event_facts(x.id);
      if x.room_id is not null then
        v_base := v_base || coalesce((select jsonb_build_object('room_slug', c.id::text, 'room_name', c.name) from public.crews c where c.id = x.room_id), '{}'::jsonb);
      end if;
      v_n := v_n + public._notify_fan('thanks', x.id, v_users, v_base, 5, 'thanks:' || x.id::text, 'email', x.thanks_at, null);
    exception when others then
      raise warning 'notify_enqueue_thanks: event % failed: %', x.id, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

-- ------------------------------------------------------------------ access ---
-- All of it is for the server and the database's own triggers. Nobody signed in can call any of it.
revoke all on function
  public._notify_name(uuid), public._notify_event_end(public.events), public._notify_event_facts(uuid), public._notify_email_ok(uuid),
  public._notify_wa_ok(uuid, uuid), public._notify_reg_paid(uuid, uuid), public._notify_us(timestamptz), public._notify_token(uuid, uuid, integer),
  public._notify_claim_extra(text, uuid, uuid),
  public._notify_send(uuid, text, uuid, jsonb, integer, text, timestamptz),
  public._notify_fan(text, uuid, uuid[], jsonb, integer, text, text, timestamptz, timestamptz, boolean),
  public._notify_reg_trigger(), public._notify_order_trigger(), public._notify_change_flags(jsonb), public._notify_event_changed(uuid, jsonb, boolean),
  public._notify_event_change_trigger(), public._notify_link_trigger(), public._notify_event_status_trigger(), public._notify_host_pop_trigger(),
  public.notify_enqueue_thanks(timestamptz)
  from public, anon, authenticated;
grant execute on function public.notify_enqueue_thanks(timestamptz) to service_role;

commit;
