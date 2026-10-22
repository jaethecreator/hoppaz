-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1, file 4 of 6: Pops (a message from the host to the people on an event).
--
-- !!! OLA IS ALREADY WRITING POPS ON HIS SIDE. THIS FILE OVERLAPS HIS WORK AND EXISTS ONLY AS THE SHAPE THE FRONT END EXPECTS.
-- !!! RECONCILE IT WITH HIS VERSION BEFORE RUNNING IT. If his tables and functions already do this, keep his, and make them
-- !!! return the shapes described below (or tell the front end team what differs). Do not run both.
--
-- RUN ORDER: schema.sql, chat_accounts.sql, crew_rooms.sql, crew_announcements.sql, events_r1_events.sql,
--            events_r1_registrations.sql, then THIS FILE (it does not need the tickets file). Safe to run again.
--            It does not edit crew_announcements.sql or any function in it. It only inserts rows into crew_announcements, the
--            way crew_announce does, and keeps the event tag in a table of its own.
--
-- WHAT IT IS. Three kinds of Pop, one table:
--   a Pop the host sends now (to everyone going, those waiting for approval, the waitlist, or all three),
--   a Pop the host schedules for later,
--   the automatic Pops: day before (24 hours before the start), 1 hour before, and doors open (at the start).
-- A Pop shows on the event page for the people it was meant for. With "also post in room" (on by default) it is copied into the
-- host's room Announcements, tagged with the event name. The copy goes ONE WAY: a plain room announcement never shows on an event
-- (ev_event_pops only reads ev_pops).
--
--   ev_pops                 one row per Pop: author, body (1 to 500 characters), audience, also_room, send_at, sent_at, status
--                           (scheduled | sent | cancelled), auto (day_before | hour_before | doors_open, or null), recipients (how
--                           many people it was meant for when it went). unique (event_id, auto): an automatic Pop is made once.
--   ev_announcement_event   links an announcement (a row of crew_announcements) to the event, and the Pop, it came from. This is the
--                           tag. crew_announcements itself is not altered.
--
--   ev_send_pop(event, body, audience, also_room, send_at)   host or staff. audience going | pending | waitlist | everyone.
--                           send_at null or in the past: sent now. Otherwise scheduled (up to 90 days ahead). { ok, pop } or
--                           { ok: false, reason: no_session | not_found | not_allowed | event_closed | empty | too_long |
--                           bad_audience | too_far | slow_down } (10 Pops an hour per event is the limit; the automatic ones do not count).
--   ev_event_pops(event)    the Pops on the event page: the ones that have been sent, newest first, for people they were meant for
--                           (going and checked in for going, requested for pending, waitlisted for waitlist, any of the three for
--                           everyone). The host and staff see all sent Pops.
--   ev_host_pops(event)     host or staff: sent and scheduled Pops, and the automatic ones still to come (shown with a made-up id
--                           until they are made), newest first. For the Pops tab.
--   ev_room_announcements(room)   the room's announcements, newest first, with the event tag where there is one: { id, room_id, body,
--                           created_at, author_name, event_id, event_title }. Members of the room and staff only.
--   ev_dispatch_due_pops()  service role (and the database's own cron). Makes the automatic Pops that are due, sends the scheduled
--                           ones whose time has come, copies to rooms. Returns how many it sent. Meant to run every minute:
--                              select cron.schedule('hoppaz-ev-pops', '* * * * *', 'select public.ev_dispatch_due_pops()');
--                           NOT scheduled by this file: Ola runs that line himself, once, when he is ready.
--   ev_pop_recipient_ids(pop)   service role: the people a Pop is for, for whatever delivers it (push, email). This file does
--                           NOT deliver anything: the web push and email delivery are Ola's.
--
-- Automatic Pops are made only inside a short window after their time (30 minutes) and never before the event existed, so an event
-- made an hour before it starts does not send a stale "tomorrow" Pop. A cancelled or hidden event sends nothing: its scheduled
-- Pops are marked cancelled.
--
-- TWO THINGS TO KNOW ABOUT crew_announcements.
-- 1. The copy into the room is a row in crew_announcements like any other. crew_announce (the owner's own post) allows 2 a day per
--    room and counts every row of the last day, so the copies of event Pops use up the owner's two. If that is not wanted, the
--    count in crew_announce needs to skip rows that have a link in ev_announcement_event. Not changed here.
-- 2. A copy longer than 280 characters (the table's limit) is cut short and ends with three dots. The full Pop stays in
--    ev_pops and on the event page; the room shows the short one with the event tag.
-- The panel function crew_announcements(room) also lists these copies, without the tag. The new room screen should read
-- ev_room_announcements instead.
-- ============================================================================
begin;

create table if not exists public.ev_pops (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null check (char_length(btrim(body)) between 1 and 500),
  audience   text not null check (audience in ('going', 'pending', 'waitlist', 'everyone')),
  also_room  boolean not null default false,
  send_at    timestamptz,
  sent_at    timestamptz,
  status     text not null check (status in ('scheduled', 'sent', 'cancelled')),
  auto       text check (auto is null or auto in ('day_before', 'hour_before', 'doors_open')),
  recipients integer not null default 0 check (recipients >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (event_id, auto)
);
create index if not exists ev_pops_event_idx on public.ev_pops (event_id, status, sent_at desc);
create index if not exists ev_pops_due_idx on public.ev_pops (send_at) where status = 'scheduled';
alter table public.ev_pops enable row level security;
revoke all on public.ev_pops from anon, authenticated;
grant all on public.ev_pops to service_role;

create table if not exists public.ev_announcement_event (
  announcement_id uuid primary key references public.crew_announcements(id) on delete cascade,
  event_id        uuid not null references public.events(id) on delete cascade,
  pop_id          uuid references public.ev_pops(id) on delete set null
);
create index if not exists ev_announcement_event_event_idx on public.ev_announcement_event (event_id);
create unique index if not exists ev_announcement_event_pop_idx on public.ev_announcement_event (pop_id) where pop_id is not null;
alter table public.ev_announcement_event enable row level security;
revoke all on public.ev_announcement_event from anon, authenticated;
grant all on public.ev_announcement_event to service_role;

-- ---------------------------------------------------------------- helpers ---
-- How many people a Pop to this audience is for right now.
create or replace function public._ev_audience_count(p_event uuid, p_audience text) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.ev_registrations r
   where r.event_id = p_event
     and case p_audience
           when 'going' then r.status in ('going', 'checked_in')
           when 'pending' then r.status = 'requested'
           when 'waitlist' then r.status = 'waitlisted'
           else r.status in ('going', 'checked_in', 'requested', 'waitlisted') end;
$$;
revoke all on function public._ev_audience_count(uuid, text) from public, anon, authenticated;

-- A Pop as a screen gets it (the Pop type).
create or replace function public._ev_pop_json(p public.ev_pops) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'event_id', p.event_id, 'event_title', (select e.title from public.events e where e.id = p.event_id),
    'author_name', coalesce((select coalesce(nullif(btrim(pr.display_name), ''), pr.handle) from public.profiles pr where pr.id = p.author_id), 'Host'),
    'body', p.body, 'audience', p.audience, 'also_room', p.also_room, 'send_at', p.send_at, 'sent_at', p.sent_at,
    'status', p.status, 'auto', p.auto, 'recipients', p.recipients);
$$;
revoke all on function public._ev_pop_json(public.ev_pops) from public, anon, authenticated;

-- The text of an automatic Pop, in the event's own time zone.
create or replace function public._ev_auto_text(p_kind text, p_title text, p_starts timestamptz, p_tz text, p_online boolean) returns text
language sql stable set search_path = public, pg_temp as $$
  select case p_kind
    when 'day_before' then 'Tomorrow at ' || to_char(p_starts at time zone p_tz, 'FMHH12:MI AM') || ': ' || p_title || '. '
                           || case when p_online then 'The call link is on the event page.' else 'See you there.' end
    when 'hour_before' then p_title || ' starts in 1 hour.'
    else case when p_online then 'The call for ' || p_title || ' is open. Join from the event page.' else 'Doors are open for ' || p_title || '.' end
  end;
$$;
revoke all on function public._ev_auto_text(text, text, timestamptz, text, boolean) from public, anon, authenticated;

-- Copy a sent Pop into its room's Announcements, once, tagged with the event. Nothing when the Pop is not "also in room" or the
-- event has no room.
create or replace function public._ev_copy_pop_to_room(p_pop uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p      public.ev_pops;
  v_room uuid;
  v_body text;
  v_id   uuid;
begin
  select * into p from public.ev_pops where id = p_pop;
  if p.id is null or not p.also_room then return; end if;
  if exists (select 1 from public.ev_announcement_event l where l.pop_id = p.id) then return; end if;
  select e.room_id into v_room from public.events e where e.id = p.event_id;
  if v_room is null or not exists (select 1 from public.crews c where c.id = v_room) then return; end if;
  v_body := btrim(p.body);
  if char_length(v_body) > 280 then v_body := btrim(left(v_body, 277)) || '...'; end if;
  insert into public.crew_announcements (crew_id, author_id, body, created_at)
  values (v_room, p.author_id, v_body, clock_timestamp())
  returning id into v_id;
  insert into public.ev_announcement_event (announcement_id, event_id, pop_id) values (v_id, p.event_id, p.id);
end $$;
revoke all on function public._ev_copy_pop_to_room(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------- send ---
create or replace function public.ev_send_pop(p_event uuid, p_body text, p_audience text default 'going',
                                              p_also_room boolean default true, p_send_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me     uuid := auth.uid();
  e      public.events;
  v_body text := btrim(coalesce(p_body, ''));
  v_now  boolean := p_send_at is null or p_send_at <= now();
  p      public.ev_pops;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  select * into e from public.events where id = p_event;
  if e.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public._ev_manage(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  if e.status not in ('live', 'unlisted') then return jsonb_build_object('ok', false, 'reason', 'event_closed'); end if;
  if v_body = '' then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  if char_length(v_body) > 500 then return jsonb_build_object('ok', false, 'reason', 'too_long'); end if;
  if p_audience is null or p_audience not in ('going', 'pending', 'waitlist', 'everyone') then
    return jsonb_build_object('ok', false, 'reason', 'bad_audience');
  end if;
  if p_send_at is not null and p_send_at > now() + interval '90 days' then return jsonb_build_object('ok', false, 'reason', 'too_far'); end if;
  -- A host cannot flood their guests: 10 Pops an hour per event.
  perform pg_advisory_xact_lock(hashtextextended('ev-pop:' || p_event::text, 0));
  if (select count(*) from public.ev_pops x where x.event_id = p_event and x.auto is null and x.created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'slow_down');
  end if;

  insert into public.ev_pops (event_id, author_id, body, audience, also_room, send_at, sent_at, status, recipients)
  values (p_event, me, v_body, p_audience, coalesce(p_also_room, false) and e.room_id is not null,
          case when v_now then null else p_send_at end,
          case when v_now then clock_timestamp() end,
          case when v_now then 'sent' else 'scheduled' end,
          case when v_now then public._ev_audience_count(p_event, p_audience) else 0 end)
  returning * into p;
  if v_now then perform public._ev_copy_pop_to_room(p.id); end if;
  return jsonb_build_object('ok', true, 'pop', public._ev_pop_json(p));
end $$;

-- ------------------------------------------------------------------- reads ---
create or replace function public.ev_event_pops(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me       uuid := auth.uid();
  v_all    boolean;
  v_status text;
begin
  if me is null or not public._ev_can_open(p_event) then return '[]'::jsonb; end if;
  v_all := public._ev_manage(p_event);
  v_status := public._ev_reg_status(p_event, me);
  if not v_all and v_status is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(public._ev_pop_json(p) order by p.sent_at desc, p.id)
      from public.ev_pops p
     where p.event_id = p_event and p.status = 'sent'
       and (v_all
            or (p.audience = 'going' and v_status in ('going', 'checked_in'))
            or (p.audience = 'pending' and v_status = 'requested')
            or (p.audience = 'waitlist' and v_status = 'waitlisted')
            or (p.audience = 'everyone' and v_status in ('going', 'checked_in', 'requested', 'waitlisted')))
       and p.id in (select y.id from public.ev_pops y where y.event_id = p_event and y.status = 'sent' order by y.sent_at desc limit 100)
  ), '[]'::jsonb);
end $$;

create or replace function public.ev_host_pops(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e public.events;
begin
  if auth.uid() is null or not public._ev_manage(p_event) then return '[]'::jsonb; end if;
  select * into e from public.events where id = p_event;
  if e.id is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x.js order by x.k desc, x.js ->> 'id')
      from (
        select coalesce(p.sent_at, p.send_at) as k, public._ev_pop_json(p) as js
          from public.ev_pops p
         where p.event_id = p_event and p.status <> 'cancelled'
        union all
        -- The automatic Pops still to come: not made until their time.
        select a.fire_at as k,
               jsonb_build_object(
                 'id', md5('autopop:' || p_event::text || ':' || a.kind)::uuid, 'event_id', p_event, 'event_title', e.title,
                 'author_name', coalesce((select coalesce(nullif(btrim(pr.display_name), ''), pr.handle) from public.profiles pr
                                           where pr.id = coalesce(e.host_id, e.created_by)), 'Host'),
                 'body', public._ev_auto_text(a.kind, e.title, e.starts_at, e.timezone, e.kind = 'online'),
                 'audience', 'going', 'also_room', false, 'send_at', a.fire_at, 'sent_at', null, 'status', 'scheduled',
                 'auto', a.kind, 'recipients', 0)
          from (select k.kind,
                       case k.kind when 'day_before' then e.starts_at - interval '24 hours'
                                   when 'hour_before' then e.starts_at - interval '1 hour' else e.starts_at end as fire_at
                  from unnest(array['day_before', 'hour_before', 'doors_open']) as k(kind)) a
         where e.status in ('live', 'unlisted') and a.fire_at > now() and a.fire_at >= e.created_at
           and not exists (select 1 from public.ev_pops q where q.event_id = p_event and q.auto = a.kind)
      ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.ev_room_announcements(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me      uuid := auth.uid();
  v_staff boolean;
begin
  if me is null then return '[]'::jsonb; end if;
  v_staff := public._ev_staff();
  if not v_staff and not exists (select 1 from public.crew_members m where m.crew_id = p_room and m.user_id = me) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'room_id', a.crew_id, 'body', a.body, 'created_at', a.created_at,
             'author_name', coalesce(nullif(btrim(pr.display_name), ''), pr.handle, 'The owner'),
             'event_id', l.event_id, 'event_title', ev.title) order by a.created_at desc, a.id)
      from (select x.* from public.crew_announcements x
             where x.crew_id = p_room and x.deleted_at is null order by x.created_at desc limit 50) a
      left join public.profiles pr on pr.id = a.author_id
      left join public.ev_announcement_event l on l.announcement_id = a.id
      left join public.events ev on ev.id = l.event_id
     where v_staff or ev.id is null or ev.status in ('live', 'unlisted', 'cancelled', 'ended')
  ), '[]'::jsonb);
end $$;

-- ------------------------------------------------------- the minute tick ---
create or replace function public.ev_dispatch_due_pops() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e      record;
  p      record;
  k      text;
  v_at   timestamptz;
  v_sent integer := 0;
  v_ev   public.events;
begin
  -- 1. The automatic Pops whose time has come (and only just: inside 30 minutes, and not before the event existed).
  for e in
    select ev.id, ev.title, ev.starts_at, ev.kind, ev.timezone, ev.created_at, coalesce(ev.host_id, ev.created_by) as author
      from public.events ev
     where ev.status in ('live', 'unlisted') and coalesce(ev.host_id, ev.created_by) is not null
       and ev.starts_at between now() - interval '2 hours' and now() + interval '25 hours'
  loop
    begin
      foreach k in array array['day_before', 'hour_before', 'doors_open'] loop
        v_at := case k when 'day_before' then e.starts_at - interval '24 hours'
                       when 'hour_before' then e.starts_at - interval '1 hour' else e.starts_at end;
        continue when v_at > now() or v_at < now() - interval '30 minutes' or v_at < e.created_at;
        insert into public.ev_pops (event_id, author_id, body, audience, also_room, send_at, status, auto)
        values (e.id, e.author, public._ev_auto_text(k, e.title, e.starts_at, e.timezone, e.kind = 'online'), 'going', false, v_at, 'scheduled', k)
        on conflict (event_id, auto) do nothing;
      end loop;
    exception when others then
      raise warning 'ev_dispatch_due_pops: automatic pops for event % failed: %', e.id, sqlerrm;
    end;
  end loop;

  -- 2. Send every scheduled Pop that is due. A Pop of an event that is cancelled, hidden or gone is cancelled instead.
  for p in
    select x.id from public.ev_pops x where x.status = 'scheduled' and x.send_at <= now() order by x.send_at, x.id limit 500 for update skip locked
  loop
    begin
      select ev.* into v_ev from public.events ev where ev.id = (select y.event_id from public.ev_pops y where y.id = p.id);
      if v_ev.id is null or v_ev.status not in ('live', 'unlisted') then
        update public.ev_pops set status = 'cancelled' where id = p.id;
      else
        update public.ev_pops set status = 'sent', sent_at = clock_timestamp(), recipients = public._ev_audience_count(event_id, audience) where id = p.id;
        perform public._ev_copy_pop_to_room(p.id);
        v_sent := v_sent + 1;
      end if;
    exception when others then
      raise warning 'ev_dispatch_due_pops: pop % failed: %', p.id, sqlerrm;
    end;
  end loop;
  return v_sent;
end $$;

create or replace function public.ev_pop_recipient_ids(p_pop uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select r.user_id
    from public.ev_pops p
    join public.ev_registrations r on r.event_id = p.event_id
   where p.id = p_pop
     and case p.audience
           when 'going' then r.status in ('going', 'checked_in')
           when 'pending' then r.status = 'requested'
           when 'waitlist' then r.status = 'waitlisted'
           else r.status in ('going', 'checked_in', 'requested', 'waitlisted') end;
$$;

-- ----------------------------------------------------------------- access ---
revoke all on function public.ev_send_pop(uuid, text, text, boolean, timestamptz), public.ev_event_pops(uuid), public.ev_host_pops(uuid),
  public.ev_room_announcements(uuid), public.ev_dispatch_due_pops(), public.ev_pop_recipient_ids(uuid) from public, anon;
grant execute on function public.ev_send_pop(uuid, text, text, boolean, timestamptz), public.ev_event_pops(uuid), public.ev_host_pops(uuid),
  public.ev_room_announcements(uuid) to authenticated;
revoke all on function public.ev_dispatch_due_pops(), public.ev_pop_recipient_ids(uuid) from authenticated;
grant execute on function public.ev_dispatch_due_pops(), public.ev_pop_recipient_ids(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
