-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1, file 1 of 6: events with a host, a room, a description, an online link, a capacity and three kinds of
-- visibility. Written by a builder session from the fake data layer in src/lib/events-r1/fake/ (the executable spec of the
-- rules). It has been read and re-read but see the test file for what was and was not run.
--
-- RUN ORDER: schema.sql, chat_accounts.sql, crew_rooms.sql (it needs crews, crew_members, profiles, areas, events,
--            checkins, swipes, has_account()), then THIS FILE, then events_r1_registrations.sql, events_r1_tickets.sql,
--            events_r1_pops.sql, events_r1_reports.sql, events_r1_rooms.sql. See EVENTS_R1_ORDER.md. Safe to run again.
--            starter_quests.sql, if you have it, can go before or after: see "starter quests" below.
--            It replaces no existing function and edits no existing file. It adds columns, one table, one trigger and new
--            functions whose names start ev_ (or _ev_ for helpers).
--
-- WHAT IT IS. Today an event is a pin on the map with a venue, set by the Hoppaz team. Release 1 lets any Hopper with an account
-- publish an event in one step (a name is enough), as an in-person, online or hybrid event, with an optional room, capacity,
-- approval and waitlist, and one of three visibility levels. The screens talk to the functions below only.
--
--   columns on events   host_id (who made it), room_id (the host's room, for the Event | Room buttons and the event chat),
--                       description, kind (in_person | online | hybrid), timezone (default Africa/Lagos), link_type (zoom | meet |
--                       whatsapp | other), capacity, requires_approval, waitlist_on, visibility (public | community | invite),
--                       slug (the short link). The cover is the existing flyer_url. geog and venue_name may now be empty: an
--                       event with no place has no pin and stays off the map but is in the lists.
--   ev_event_links      the online link, one row per event, on its OWN closed table (see LEAK CHECK below).
--   ev_create_event(draft)            a name is enough. Publishes at once. { ok, event } or { ok: false, reason }.
--   ev_update_event(event, patch)     host or staff. Same checks as create.
--   ev_cancel_event(event)            host or staff. The event stays readable as cancelled.
--   ev_clone_event(event)             host or staff. Same event a week on, no guests, same registration settings.
--   ev_get_event(id or slug)          one event, or null. online_link only for the host and people who are going.
--   ev_list_events()                  the list: public to all, community to members of the host's room, invite never (the host
--                                     sees their own). From 4 hours ago to 45 days ahead. Events with no place have null lat and lng.
--   ev_my_events()                    the host's own events, any status, upcoming then past.
--   reason codes (the real layer can turn them into the fake layer's messages): no_session, need_account, try_again_later (the
--   silent rate limit, 5 events an hour per person), need_name, name_too_short, name_too_long, bad_start, bad_end,
--   end_before_start, bad_timezone, bad_kind, bad_place, lagos_only, bad_link, bad_link_type, bad_capacity, whatsapp_max_32,
--   bad_visibility, need_room, bad_cover, bad_draft, not_found, not_allowed, currently_unavailable (a paid type while the setting is off), payouts_not_ready (the setting is on but the host's Bachs account cannot take money yet), tickets_needed,
--   too_many_tickets, bad_ticket, need_ticket_name, ticket_name_too_long, duplicate_ticket, bad_price, bad_ticket_capacity, ticket_in_use.
--
-- TICKET TYPES (added later; Jae wants them now, with paid gated). Every event has 1 to 5 ticket types: a name, a whole-naira price (0 =
-- free) and a capacity (empty = no limit of its own). They live in the closed table ev_ticket_types. ev_create_event gives every new event one
-- free "General" with no limit unless the draft has a tickets list: { tickets: [{ name, price_naira, capacity }] }. The names are not empty,
-- 60 characters at most and unique ignoring case; ev_update_event with a tickets list keeps types whose name is kept (same id), adds new ones, and
-- refuses to drop a type people hold ({ ok: false, reason: ticket_in_use, ticket }); ev_clone_event copies the types. An old event with no
-- rows is NOT backfilled: it reads as one derived General at the event's own price (a fixed id from the event id), and the real row is made
-- the first time someone registers. Places: a type's spots_left is the tighter of its own capacity and the event's.
-- PAID NEEDS TWO THINGS (events_r1_pay.sql adds the second). PAID IS SWITCHED OFF. Any type with a price above 0 is refused by create, update and clone with exactly the reason text
-- currently_unavailable, until the setting 'paid_tickets' is 'on'. It is in the closed one-row table ev_settings (key, value), starts as 'off'
-- (re-running this file never flips it) and is set only through ev_set_setting(key, value), which only the service role (and the SQL editor) can
-- run: select public.ev_set_setting('paid_tickets', 'on'). Even with it on, nobody can REGISTER for a paid type in Release 1 (ev_register answers
-- currently_unavailable): there is no payment code. Clone refuses a paid type too while the setting is off (the fake layer copies it).
-- add_to_room: the draft may say false to keep the event out of the host's room (default true when the host has a room).
--
-- Event shape (what every function returns for an event): the fields of R1Event in src/lib/events-r1/types.ts, with these notes.
-- ticket_types is an array of { id, event_id, name, price_naira, capacity, sold, spots_left } (always at least one) and price_naira is the lowest
-- type price. venue_name is '' and lat, lng are null when there is no pin; distance_m is null (the phone works it out); status is
-- live | cancelled | ended | hidden | pending | rejected ('ended' is worked out from the time, nothing flips it); the host is
-- { id, name, roomId, roomName, verified }.
--
-- ---------------------------------------------------------------------------------------------------------------------
-- FOUR THINGS OLA MUST KNOW
-- ---------------------------------------------------------------------------------------------------------------------
-- 1. THE TRIGGER CHOICE (force_pending_on_insert). Your trigger forces every non-admin insert to status 'pending' and
--    source 'hopper'. It is a BEFORE INSERT trigger only. ev_create_event therefore inserts the row (the trigger makes it
--    'pending', as it should) and, in the same function and the same transaction, updates that one row to 'live'. An UPDATE
--    is not touched by your trigger, and nothing can read the half state because the function is one transaction. Nothing of
--    yours is edited, no setting is switched off, no role is faked. The only way to a live event is this function (a direct
--    insert from the app still ends as pending, and there is still no update policy on events).
--
-- 2. LEAK CHECK ON THE EXISTING READ POLICY (schema.sql, events_read_live: status = 'live' or created_by = auth.uid()).
--    The policy lets ANYONE with the anon key read every column of every live event straight from the table. Two consequences.
--    a) online_link. If it were a column on events, every online link (a Zoom room, a WhatsApp call) would be readable by the
--       whole internet, which would make "shown only after you register" a lie. So it is NOT a column. It lives in the closed
--       table ev_event_links (no policy, no grant for anon or authenticated). The other new columns (description, host_id,
--       capacity, kind, slug, room_id, ...) are things a public event page shows anyway.
--    b) invite only and community events. The same policy, and events_near, events_deck, claim_checkin and the public API
--       route /api/public/events (which calls events_near) all read "status = 'live'" and know nothing about visibility, so a
--       live invite-only event would be listed on the map and in the old Events screens. FIX, with no edit to any of them:
--       an event that is live but not public is stored with status 'unlisted' (a new allowed value). Every old reader asks for
--       'live' only, so it never sees an unlisted event; the old policy does not show it to anyone except its creator; the
--       starter quest trigger does not fire for it. A new trigger (ev_events_sync_status) keeps the two in step: whenever a row
--       is live or unlisted, its status is live when visibility is public and unlisted otherwise. So changing visibility, or
--       staff setting status back to 'live', cannot expose an event. All the ev_ functions treat 'live' and 'unlisted' as live
--       and give the viewer 'live' in the result.
--    What is still open on the old side, for Ola to decide: events_deck and the swipe deck, claim_checkin, the map and the old
--    list read events with no place (geog null) once such events exist; events_near drops them (st_dwithin on null is null),
--    events_deck would return them with null lat and lng. A one-line "and e.geog is not null" in events_deck fixes it.
--
-- 3. THE STATUS CHECK. schema.sql defines it inline, so Postgres named it events_status_check. This file does not rely on
--    the name: it drops any check constraint on events whose test is "status = any (...)" and adds events_status_r1_check:
--    pending, live, rejected (the old three) and cancelled, ended, hidden, unlisted (new).
--
-- 4. STARTER QUESTS (starter_quests.sql). If it is installed, its trigger gives a live event a check-in quest titled
--    'Check in at ' || venue_name, and a null venue_name makes that title null, which would make EVERY online event fail to
--    publish. So an event with no place stores a placeholder in venue_name ('Online', or 'To be announced' for an in-person event
--    with no place yet) and the functions here return '' for it. The side effect: such an event gets a starter kit with a check-in
--    quest nobody can finish (no pin). Suggested change on your side, not made here: in starter_quests_on_event() add
--    "and new.geog is not null" to the condition.
--
-- Other notes. Every function reads the caller from auth.uid(), never from a parameter. Staff here means profiles.is_admin
-- (the same test as your trigger). A list builds each event with a handful of small indexed reads; fine for the 45 day window,
-- watch it if the window grows past a few hundred events. Functions that other files fill in (the going count, the waitlist
-- fill, the registration status, the HQ test, copying registration settings) exist here as small stubs, written only when
-- missing, exactly like _crew_room_hunt_busy in crew_rooms.sql; the later files replace them, and running this file again
-- never puts a stub back over a real one.
-- ============================================================================
begin;

-- ------------------------------------------------------------------ columns ---
alter table public.events add column if not exists host_id uuid references public.profiles(id) on delete set null;
alter table public.events add column if not exists room_id uuid references public.crews(id) on delete set null;
alter table public.events add column if not exists description text not null default '' check (char_length(description) <= 2000);
alter table public.events add column if not exists kind text not null default 'in_person' check (kind in ('in_person', 'online', 'hybrid'));
alter table public.events add column if not exists timezone text not null default 'Africa/Lagos' check (char_length(timezone) between 3 and 60);
alter table public.events add column if not exists link_type text check (link_type is null or link_type in ('zoom', 'meet', 'whatsapp', 'other'));
alter table public.events add column if not exists capacity integer check (capacity is null or capacity between 1 and 100000);
alter table public.events add column if not exists requires_approval boolean not null default false;
alter table public.events add column if not exists waitlist_on boolean not null default false;
alter table public.events add column if not exists visibility text not null default 'public' check (visibility in ('public', 'community', 'invite'));
alter table public.events add column if not exists slug text;

create unique index if not exists events_slug_key on public.events (slug);
create index if not exists events_host_idx on public.events (host_id, starts_at desc) where host_id is not null;
create index if not exists events_room_idx on public.events (room_id, starts_at desc) where room_id is not null;

-- A place is optional now: online events and "place to be announced" events have no pin.
alter table public.events alter column geog drop not null;
alter table public.events alter column venue_name drop not null;

-- The status check: the old three plus cancelled, ended, hidden, unlisted (see note 3 and note 2b above).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.events'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like 'CHECK ((status = ANY%'
       and conname <> 'events_status_r1_check'
  loop
    execute format('alter table public.events drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.events'::regclass and conname = 'events_status_r1_check') then
    alter table public.events add constraint events_status_r1_check
      check (status in ('pending', 'live', 'rejected', 'cancelled', 'ended', 'hidden', 'unlisted'));
  end if;
end $$;

-- ------------------------------------------------ the online link, closed table ---
create table if not exists public.ev_event_links (
  event_id   uuid primary key references public.events(id) on delete cascade,
  link       text not null check (char_length(link) between 8 and 500),
  updated_at timestamptz not null default now()
);
alter table public.ev_event_links enable row level security;
revoke all on public.ev_event_links from anon, authenticated;
grant all on public.ev_event_links to service_role;

-- ------------------------------------------------------ settings and ticket types ---
create table if not exists public.ev_settings (
  key        text primary key check (key ~ '^[a-z_]{1,40}$'),
  value      text not null check (char_length(value) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.ev_settings enable row level security;
revoke all on public.ev_settings from anon, authenticated;
grant all on public.ev_settings to service_role;
-- Paid tickets start off. A re-run leaves whatever Ola set.
insert into public.ev_settings (key, value) values ('paid_tickets', 'off') on conflict (key) do nothing;

create table if not exists public.ev_ticket_types (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  price_naira integer not null default 0 check (price_naira >= 0),
  capacity   integer check (capacity is null or capacity > 0),
  sort       integer not null default 0,
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists ev_ticket_types_name_idx on public.ev_ticket_types (event_id, lower(name));
create index if not exists ev_ticket_types_event_idx on public.ev_ticket_types (event_id, sort);
alter table public.ev_ticket_types enable row level security;
revoke all on public.ev_ticket_types from anon, authenticated;
grant all on public.ev_ticket_types to service_role;

-- The only way to change a setting. Service role (and the SQL editor) only.
create or replace function public.ev_set_setting(p_key text, p_value text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_key is distinct from 'paid_tickets' then return 'bad_key'; end if;
  if p_value is null or p_value not in ('on', 'off') then return 'bad_value'; end if;
  insert into public.ev_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return 'ok';
end $$;
revoke all on function public.ev_set_setting(text, text) from public, anon, authenticated;
grant execute on function public.ev_set_setting(text, text) to service_role;

-- ------------------------------------------- live and public go together (note 2b) ---
create or replace function public.ev_events_sync_status() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status in ('live', 'unlisted') then
    new.status := case when new.visibility = 'public' then 'live' else 'unlisted' end;
  end if;
  return new;
end $$;
revoke all on function public.ev_events_sync_status() from public, anon, authenticated;
drop trigger if exists ev_events_sync_status on public.events;
create trigger ev_events_sync_status before insert or update of status, visibility on public.events
  for each row execute function public.ev_events_sync_status();

-- ---------------------------------------------------- stubs for the later files ---
-- Written only when missing. The real versions are in events_r1_registrations.sql, events_r1_rooms.sql.
do $stubs$
begin
  if to_regprocedure('public._ev_going(uuid)') is null then
    create function public._ev_going(p_event uuid) returns integer
    language sql stable security definer set search_path = public, pg_temp as 'select 0';
    revoke all on function public._ev_going(uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public._ev_reg_status(uuid, uuid)') is null then
    create function public._ev_reg_status(p_event uuid, p_user uuid) returns text
    language sql stable security definer set search_path = public, pg_temp as 'select null::text';
    revoke all on function public._ev_reg_status(uuid, uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public._ev_type_sold(uuid, uuid)') is null then
    create function public._ev_type_sold(p_event uuid, p_type uuid) returns integer
    language sql stable security definer set search_path = public, pg_temp as 'select 0';
    revoke all on function public._ev_type_sold(uuid, uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public._ev_held(uuid, uuid)') is null then
    create function public._ev_held(p_event uuid, p_type uuid) returns integer
    language sql stable security definer set search_path = public, pg_temp as 'select 0';
    revoke all on function public._ev_held(uuid, uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public._ev_host_can_sell(uuid)') is null then
    create function public._ev_host_can_sell(p_user uuid) returns boolean
    language sql stable security definer set search_path = public, pg_temp as 'select false';
    revoke all on function public._ev_host_can_sell(uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public._ev_is_hq(uuid)') is null then
    create function public._ev_is_hq(p_crew uuid) returns boolean
    language sql stable security definer set search_path = public, pg_temp as 'select false';
    revoke all on function public._ev_is_hq(uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public._ev_fill_waitlist(uuid)') is null then
    create function public._ev_fill_waitlist(p_event uuid) returns void
    language plpgsql security definer set search_path = public, pg_temp as 'begin return; end';
    revoke all on function public._ev_fill_waitlist(uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public._ev_copy_settings(uuid, uuid)') is null then
    create function public._ev_copy_settings(p_from uuid, p_to uuid) returns void
    language plpgsql security definer set search_path = public, pg_temp as 'begin return; end';
    revoke all on function public._ev_copy_settings(uuid, uuid) from public, anon, authenticated;
  end if;
end $stubs$;

-- ------------------------------------------------------------------- helpers ---
-- Staff: the same test as force_pending_on_insert.
create or replace function public._ev_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public._ev_staff() from public, anon, authenticated;

-- Host or staff. The host of an old event (no host_id) is whoever created it.
create or replace function public._ev_manage(p_event uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
    public._ev_staff()
    or exists (select 1 from public.events e where e.id = p_event and coalesce(e.host_id, e.created_by) = auth.uid()));
$$;
revoke all on function public._ev_manage(uuid) from public, anon, authenticated;

create or replace function public._ev_in_room(p_room uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_room is not null and p_user is not null
     and exists (select 1 from public.crew_members m where m.crew_id = p_room and m.user_id = p_user);
$$;
revoke all on function public._ev_in_room(uuid, uuid) from public, anon, authenticated;

-- May this viewer open the event page? The host and staff always. Others: the event must be out (not pending, rejected or
-- hidden); a community event only for members of its room; an invite event by its link.
create or replace function public._ev_can_open(p_event uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  e  public.events;
begin
  select * into e from public.events where id = p_event;
  if not found then return false; end if;
  if me is not null and (me = coalesce(e.host_id, e.created_by) or public._ev_staff()) then return true; end if;
  if e.status not in ('live', 'unlisted', 'cancelled', 'ended') then return false; end if;
  if e.visibility = 'community' then return public._ev_in_room(e.room_id, me); end if;
  return true;
end $$;
revoke all on function public._ev_can_open(uuid) from public, anon, authenticated;

-- The room of a host: the oldest room they own, never Hoppaz HQ.
create or replace function public._ev_host_room(p_user uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id
    from public.crews c
    join public.crew_members m on m.crew_id = c.id and m.user_id = p_user and m.role = 'owner'
   where p_user is not null and not public._ev_is_hq(c.id)
   order by c.created_at, c.id
   limit 1;
$$;
revoke all on function public._ev_host_room(uuid) from public, anon, authenticated;

create or replace function public._ev_try_ts(p_text text) returns timestamptz
language plpgsql stable set search_path = public, pg_temp as $$
begin
  return p_text::timestamptz;
exception when others then
  return null;
end $$;
revoke all on function public._ev_try_ts(text) from public, anon, authenticated;

-- A short link: the name in lower case letters and digits, then six random characters.
create or replace function public._ev_slug(p_title text) returns text
language sql volatile set search_path = public, pg_temp as $$
  select coalesce(nullif(left(regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', '-', 'g'), 40), ''), 'event')
         || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
$$;
revoke all on function public._ev_slug(text) from public, anon, authenticated;

-- live, cancelled, ended, hidden, pending or rejected, as a screen should see it.
create or replace function public._ev_status_text(p_status text, p_starts timestamptz, p_ends timestamptz) returns text
language sql stable set search_path = public, pg_temp as $$
  select case when p_status in ('live', 'unlisted')
              then case when now() > coalesce(p_ends, p_starts + interval '3 hours') then 'ended' else 'live' end
              else p_status end;
$$;
revoke all on function public._ev_status_text(text, timestamptz, timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------- ticket type helpers ---
create or replace function public._ev_paid_on() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.value = 'on' from public.ev_settings s where s.key = 'paid_tickets'), false);
$$;
revoke all on function public._ev_paid_on() from public, anon, authenticated;

-- The event's types. An old event with no rows gets one derived General at its own price (same id every time).
create or replace function public._ev_types(p_event uuid)
returns table (id uuid, name text, price_naira integer, capacity integer, sort integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.name, t.price_naira, t.capacity, t.sort from public.ev_ticket_types t where t.event_id = p_event
  union all
  select md5('ticket-type:' || e.id::text)::uuid, 'General'::text, e.price_naira, null::integer, 0
    from public.events e
   where e.id = p_event and not exists (select 1 from public.ev_ticket_types x where x.event_id = e.id);
$$;
revoke all on function public._ev_types(uuid) from public, anon, authenticated;

create or replace function public._ev_first_type(p_event uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select x.id from public._ev_types(p_event) x order by x.sort, x.id limit 1;
$$;
revoke all on function public._ev_first_type(uuid) from public, anon, authenticated;

-- Make the real General row of an old event (the caller holds the event lock). Nothing when the event has rows.
create or replace function public._ev_ensure_types(p_event uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.ev_ticket_types (id, event_id, name, price_naira, capacity, sort)
  select md5('ticket-type:' || e.id::text)::uuid, e.id, 'General', e.price_naira, null, 0
    from public.events e
   where e.id = p_event and not exists (select 1 from public.ev_ticket_types x where x.event_id = e.id);
end $$;
revoke all on function public._ev_ensure_types(uuid) from public, anon, authenticated;

-- Places left on a type: its own capacity and the event's, whichever is tighter. null = no limit at all.
create or replace function public._ev_type_left(p_event uuid, p_type uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  -- Seats held by open (unexpired) paid orders count against the type and the event, together with the people who are going.
  select case
           when t.capacity is null and e.capacity is null then null
           when t.capacity is null then greatest(0, e.capacity - public._ev_going(e.id) - public._ev_held(e.id, null))
           when e.capacity is null then greatest(0, t.capacity - public._ev_type_sold(e.id, t.id) - public._ev_held(e.id, t.id))
           else least(greatest(0, t.capacity - public._ev_type_sold(e.id, t.id) - public._ev_held(e.id, t.id)),
                      greatest(0, e.capacity - public._ev_going(e.id) - public._ev_held(e.id, null)))
         end
    from public.events e
    join public._ev_types(e.id) t on t.id = p_type
   where e.id = p_event;
$$;
revoke all on function public._ev_type_left(uuid, uuid) from public, anon, authenticated;

create or replace function public._ev_types_json(p_event uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'event_id', p_event, 'name', t.name, 'price_naira', t.price_naira, 'capacity', t.capacity,
           'sold', public._ev_type_sold(p_event, t.id), 'spots_left', public._ev_type_left(p_event, t.id)) order by t.sort, t.id), '[]'::jsonb)
    from public._ev_types(p_event) t;
$$;
revoke all on function public._ev_types_json(uuid) from public, anon, authenticated;

-- The types as a draft again (name, price, capacity), for a clone.
create or replace function public._ev_types_draft(p_event uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'price_naira', t.price_naira, 'capacity', t.capacity) order by t.sort, t.id), '[]'::jsonb)
    from public._ev_types(p_event) t;
$$;
revoke all on function public._ev_types_draft(uuid) from public, anon, authenticated;

-- The name of a type people hold that a new list would drop, or null. Reads registrations only if that table exists yet.
create or replace function public._ev_types_blocker(p_event uuid, p_tickets jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  if to_regclass('public.ev_registrations') is null then return null; end if;
  select t.name into v_name
    from public._ev_types(p_event) t
   where not exists (select 1 from jsonb_array_elements(p_tickets) x where lower(x ->> 'name') = lower(t.name))
     and exists (select 1 from public.ev_registrations r
                  where r.event_id = p_event and r.status not in ('cancelled', 'declined')
                    and coalesce(r.ticket_type_id, public._ev_first_type(p_event)) = t.id)
   order by t.sort, t.id limit 1;
  if v_name is null and to_regclass('public.ev_orders') is not null then
    -- Also a type with an open or paid order (events_r1_pay.sql).
    select t.name into v_name
      from public._ev_types(p_event) t
     where not exists (select 1 from jsonb_array_elements(p_tickets) x where lower(x ->> 'name') = lower(t.name))
       and exists (select 1 from public.ev_orders o where o.ticket_type_id = t.id and o.status in ('open', 'paid', 'refund_pending'))
     order by t.sort, t.id limit 1;
  end if;
  return v_name;
end $$;
revoke all on function public._ev_types_blocker(uuid, jsonb) from public, anon, authenticated;

-- Write the types of a checked list. New event with no list: one free General. Edit with no list: nothing. Edit with a list: types whose
-- name is kept keep their id, new names are added, the rest go (the caller checked nobody holds them). The caller holds the event lock.
create or replace function public._ev_apply_types(p_event uuid, p_tickets jsonb, p_new boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x jsonb;
  i integer := 0;
begin
  if p_tickets is null or jsonb_typeof(p_tickets) <> 'array' then
    if p_new then
      insert into public.ev_ticket_types (event_id, name, price_naira, capacity, sort) values (p_event, 'General', 0, null, 0);
    end if;
    return;
  end if;
  if not p_new then perform public._ev_ensure_types(p_event); end if;
  for x in select value from jsonb_array_elements(p_tickets) loop
    i := i + 1;
    update public.ev_ticket_types
       set name = x ->> 'name', price_naira = (x ->> 'price_naira')::integer, capacity = (x ->> 'capacity')::integer, sort = i
     where event_id = p_event and lower(name) = lower(x ->> 'name');
    if not found then
      insert into public.ev_ticket_types (event_id, name, price_naira, capacity, sort)
      values (p_event, x ->> 'name', (x ->> 'price_naira')::integer, (x ->> 'capacity')::integer, i);
    end if;
  end loop;
  -- Cancelled and declined people (and void tickets) may still point at a type that goes: they fall back to the event's first type.
  if to_regclass('public.ev_registrations') is not null then
    update public.ev_registrations set ticket_type_id = null
     where event_id = p_event and ticket_type_id in (
       select t.id from public.ev_ticket_types t
        where t.event_id = p_event and lower(t.name) not in (select lower(v ->> 'name') from jsonb_array_elements(p_tickets) v));
  end if;
  if to_regclass('public.ev_tickets') is not null then
    update public.ev_tickets set ticket_type_id = null
     where event_id = p_event and ticket_type_id in (
       select t.id from public.ev_ticket_types t
        where t.event_id = p_event and lower(t.name) not in (select lower(v ->> 'name') from jsonb_array_elements(p_tickets) v));
  end if;
  delete from public.ev_ticket_types
   where event_id = p_event
     and lower(name) not in (select lower(v ->> 'name') from jsonb_array_elements(p_tickets) v);
end $$;
revoke all on function public._ev_apply_types(uuid, jsonb, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------ the event shape ---
create or replace function public._ev_event_json(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me         uuid := auth.uid();
  e          public.events;
  v_host     uuid;
  v_going    integer;
  v_link     text;
  v_hostname text;
  v_room     uuid;
  v_roomname text;
  v_verified boolean := false;
  v_checkins integer;
  v_swipes   integer;
  v_here     integer;
  v_noplace  boolean;
begin
  select * into e from public.events where id = p_id;
  if not found then return null; end if;
  v_host := coalesce(e.host_id, e.created_by);
  v_going := public._ev_going(e.id);
  -- The online link: the host and people who are going, nobody else.
  if me is not null and (me = v_host or public._ev_reg_status(e.id, me) in ('going', 'checked_in')) then
    select l.link into v_link from public.ev_event_links l where l.event_id = e.id;
  end if;
  select coalesce(nullif(btrim(p.display_name), ''), p.handle, 'Host') into v_hostname from public.profiles p where p.id = v_host;
  v_room := coalesce(e.room_id, public._ev_host_room(v_host));
  if v_room is not null then
    select c.name, c.verified into v_roomname, v_verified from public.crews c where c.id = v_room;
  end if;
  -- Heat as event_heat works it out, read per event instead of scanning the view.
  select count(*)::int into v_checkins from public.checkins c where c.event_id = e.id;
  select count(*)::int into v_swipes from public.swipes s where s.event_id = e.id and s.decision = 'in';
  select count(*)::int into v_here from public.checkins c where c.event_id = e.id and c.created_at > now() - interval '3 hours';
  v_noplace := e.geog is null or e.kind = 'online';

  return jsonb_build_object(
    'id', e.id, 'title', e.title,
    'venue_name', case when v_noplace and e.venue_name in ('Online', 'To be announced') then '' else coalesce(e.venue_name, '') end,
    'area', e.area,
    'lat', case when e.geog is null then null else st_y(e.geog::geometry) end,
    'lng', case when e.geog is null then null else st_x(e.geog::geometry) end,
    'starts_at', e.starts_at, 'ends_at', e.ends_at, 'timezone', e.timezone, 'kind', e.kind,
    'description', e.description, 'visibility', e.visibility,
    'status', public._ev_status_text(e.status, e.starts_at, e.ends_at),
    'capacity', e.capacity, 'requires_approval', e.requires_approval, 'waitlist_on', e.waitlist_on,
    'link_type', e.link_type, 'online_link', v_link, 'room_id', e.room_id
  ) || jsonb_build_object(
    'going', v_going,
    'spots_left', case when e.capacity is null then null else greatest(0, e.capacity - v_going - public._ev_held(e.id, null)) end,
    'price_naira', coalesce((select min(t.price_naira) from public._ev_types(e.id) t), e.price_naira),
    'ticket_types', public._ev_types_json(e.id), 'vibe', e.vibe, 'source', e.source, 'ig_url', e.ig_url, 'flyer_url', e.flyer_url,
    'created_at', e.created_at, 'slug', coalesce(e.slug, e.id::text),
    'host', jsonb_build_object('id', v_host, 'name', coalesce(v_hostname, 'Hoppaz'), 'roomId', v_room, 'roomName', v_roomname,
                               'verified', coalesce(v_verified, false)),
    'distance_m', null::double precision,
    'heat', least(100, e.base_heat + v_checkins * 7 + v_swipes * 3),
    'checkins', v_checkins, 'swipes_in', v_swipes, 'here_now', v_here
  );
end $$;
revoke all on function public._ev_event_json(uuid) from public, anon, authenticated;

-- ------------------------------------------------------- one check for a draft ---
-- Checks a draft (or a draft with a patch laid over it) and fills every default. Returns { ok: true, f: {fields} } or
-- { ok: false, reason }. It writes nothing. Used by create, update and clone, so the rules are in one place.
drop function if exists public._ev_normalize(jsonb, uuid);
create or replace function public._ev_normalize(p_draft jsonb, p_room uuid, p_host uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d          jsonb := coalesce(p_draft, '{}'::jsonb);
  v_title    text;
  v_start    timestamptz;
  v_end      timestamptz;
  v_kind     text;
  v_tz       text;
  v_venue    text;
  v_area     text;
  v_lat      double precision;
  v_lng      double precision;
  v_link     text;
  v_ltype    text;
  v_cap      integer;
  v_vis      text;
  v_cover    text;
  v_vibe     text;
  v_appr     boolean;
  v_wait     boolean;
  v_tickets  jsonb := null;
  tk         jsonb;
  v_names    text[] := '{}';
  v_tn       text;
  v_price    numeric;
  v_tcap     numeric;
begin
  if jsonb_typeof(d) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_draft'); end if;

  v_title := btrim(coalesce(d ->> 'title', ''));
  if v_title = '' then return jsonb_build_object('ok', false, 'reason', 'need_name'); end if;
  if char_length(v_title) < 2 then return jsonb_build_object('ok', false, 'reason', 'name_too_short'); end if;
  if char_length(v_title) > 120 then return jsonb_build_object('ok', false, 'reason', 'name_too_long'); end if;

  -- Start: the next evening at 7 pm Lagos time unless given.
  if jsonb_typeof(d -> 'starts_at') = 'string' then
    v_start := public._ev_try_ts(d ->> 'starts_at');
    if v_start is null then return jsonb_build_object('ok', false, 'reason', 'bad_start'); end if;
  else
    v_start := ((date_trunc('day', now() at time zone 'Africa/Lagos') + interval '1 day 19 hours') at time zone 'Africa/Lagos');
  end if;
  if jsonb_typeof(d -> 'ends_at') = 'string' then
    v_end := public._ev_try_ts(d ->> 'ends_at');
    if v_end is null then return jsonb_build_object('ok', false, 'reason', 'bad_end'); end if;
    if v_end <= v_start then return jsonb_build_object('ok', false, 'reason', 'end_before_start'); end if;
  end if;

  v_tz := coalesce(nullif(btrim(d ->> 'timezone'), ''), 'Africa/Lagos');
  if v_tz <> 'Africa/Lagos' and not exists (select 1 from pg_timezone_names z where z.name = v_tz) then
    return jsonb_build_object('ok', false, 'reason', 'bad_timezone');
  end if;

  v_kind := coalesce(nullif(btrim(d ->> 'kind'), ''), 'in_person');
  if v_kind not in ('in_person', 'online', 'hybrid') then return jsonb_build_object('ok', false, 'reason', 'bad_kind'); end if;

  -- Where. Online has no place. Otherwise: a name, and a pin if there are coordinates (inside Lagos) or a known area.
  if v_kind <> 'online' then
    v_venue := nullif(btrim(coalesce(d ->> 'place_name', '')), '');
    if v_venue is not null and char_length(v_venue) not between 2 and 120 then
      return jsonb_build_object('ok', false, 'reason', 'bad_place');
    end if;
    v_area := nullif(btrim(coalesce(d ->> 'area', '')), '');
    if v_area is not null and not exists (select 1 from public.areas a where a.name = v_area) then v_area := null; end if;
    if jsonb_typeof(d -> 'lat') = 'number' and jsonb_typeof(d -> 'lng') = 'number' then
      v_lat := (d ->> 'lat')::double precision;
      v_lng := (d ->> 'lng')::double precision;
      if v_lat not between 6.30 and 6.80 or v_lng not between 3.05 and 3.95 then
        return jsonb_build_object('ok', false, 'reason', 'lagos_only');
      end if;
      if v_area is null then
        select a.name into v_area from public.areas a
         order by st_distance(a.centroid, st_point(v_lng, v_lat)::geography) limit 1;
      end if;
    elsif v_area is not null then
      select st_y(a.centroid::geometry), st_x(a.centroid::geometry) into v_lat, v_lng from public.areas a where a.name = v_area;
    end if;
    if v_venue is null then v_venue := 'To be announced'; end if;
  else
    v_venue := 'Online';
  end if;

  -- The online link: online and hybrid only. One link, and the kind of call it is.
  if v_kind <> 'in_person' then
    v_link := nullif(btrim(coalesce(d ->> 'online_link', '')), '');
    if v_link is not null and (char_length(v_link) > 500 or v_link !~* '^https?://[^[:space:]]+$') then
      return jsonb_build_object('ok', false, 'reason', 'bad_link');
    end if;
    v_ltype := nullif(btrim(coalesce(d ->> 'link_type', '')), '');
    if v_ltype is null and v_link is not null then v_ltype := 'other'; end if;
    if v_ltype is not null and v_ltype not in ('zoom', 'meet', 'whatsapp', 'other') then
      return jsonb_build_object('ok', false, 'reason', 'bad_link_type');
    end if;
  end if;

  -- Capacity: empty means no limit. A WhatsApp call holds 32 people.
  if jsonb_typeof(d -> 'capacity') = 'number' then
    if (d ->> 'capacity')::numeric <> trunc((d ->> 'capacity')::numeric)
       or (d ->> 'capacity')::numeric < 1 or (d ->> 'capacity')::numeric > 100000 then
      return jsonb_build_object('ok', false, 'reason', 'bad_capacity');
    end if;
    v_cap := (d ->> 'capacity')::numeric::integer;
  elsif d ? 'capacity' and jsonb_typeof(d -> 'capacity') <> 'null' then
    return jsonb_build_object('ok', false, 'reason', 'bad_capacity');
  end if;
  if v_ltype = 'whatsapp' then
    if v_cap is null then v_cap := 32; end if;
    if v_cap > 32 then return jsonb_build_object('ok', false, 'reason', 'whatsapp_max_32'); end if;
  end if;

  v_vis := coalesce(nullif(btrim(d ->> 'visibility'), ''), 'public');
  if v_vis not in ('public', 'community', 'invite') then return jsonb_build_object('ok', false, 'reason', 'bad_visibility'); end if;
  if v_vis = 'community' and p_room is null then return jsonb_build_object('ok', false, 'reason', 'need_room'); end if;

  v_cover := nullif(btrim(coalesce(d ->> 'cover_url', '')), '');
  if v_cover is not null and (char_length(v_cover) > 500 or v_cover !~ '^(https://|/)[^[:space:]]+$') then
    return jsonb_build_object('ok', false, 'reason', 'bad_cover');
  end if;

  v_vibe := lower(btrim(coalesce(d ->> 'vibe', '')));
  if v_vibe !~ '^[a-z ]{2,20}$' then v_vibe := 'culture'; end if;

  -- Ticket types: 1 to 5, names not empty and unique ignoring case, price a whole number from 0, capacity empty or 1 and up.
  -- A paid type is refused while paid tickets are off.
  if jsonb_typeof(d -> 'tickets') = 'array' then
    if jsonb_array_length(d -> 'tickets') < 1 then return jsonb_build_object('ok', false, 'reason', 'tickets_needed'); end if;
    if jsonb_array_length(d -> 'tickets') > 5 then return jsonb_build_object('ok', false, 'reason', 'too_many_tickets'); end if;
    v_tickets := '[]'::jsonb;
    for tk in select value from jsonb_array_elements(d -> 'tickets') loop
      if jsonb_typeof(tk) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_ticket'); end if;
      v_tn := btrim(coalesce(tk ->> 'name', ''));
      if v_tn = '' then return jsonb_build_object('ok', false, 'reason', 'need_ticket_name'); end if;
      if char_length(v_tn) > 60 then return jsonb_build_object('ok', false, 'reason', 'ticket_name_too_long'); end if;
      if lower(v_tn) = any (v_names) then return jsonb_build_object('ok', false, 'reason', 'duplicate_ticket'); end if;
      v_names := v_names || lower(v_tn);
      v_price := 0;
      if jsonb_typeof(tk -> 'price_naira') = 'number' then
        v_price := (tk ->> 'price_naira')::numeric;
        if v_price <> trunc(v_price) or v_price < 0 or v_price > 100000000 then return jsonb_build_object('ok', false, 'reason', 'bad_price'); end if;
      elsif tk ? 'price_naira' and jsonb_typeof(tk -> 'price_naira') <> 'null' then
        return jsonb_build_object('ok', false, 'reason', 'bad_price');
      end if;
      if v_price > 0 then
        -- A paid type needs the switch on AND a host whose Bachs account can take money (ev_host_payouts.can_sell).
        if not public._ev_paid_on() then return jsonb_build_object('ok', false, 'reason', 'currently_unavailable'); end if;
        if not public._ev_host_can_sell(coalesce(p_host, auth.uid())) then return jsonb_build_object('ok', false, 'reason', 'payouts_not_ready'); end if;
      end if;
      v_tcap := null;
      if jsonb_typeof(tk -> 'capacity') = 'number' then
        v_tcap := (tk ->> 'capacity')::numeric;
        if v_tcap <> trunc(v_tcap) or v_tcap < 1 or v_tcap > 100000 then return jsonb_build_object('ok', false, 'reason', 'bad_ticket_capacity'); end if;
      elsif tk ? 'capacity' and jsonb_typeof(tk -> 'capacity') <> 'null' then
        return jsonb_build_object('ok', false, 'reason', 'bad_ticket_capacity');
      end if;
      v_tickets := v_tickets || jsonb_build_array(jsonb_build_object('name', v_tn, 'price_naira', v_price::integer, 'capacity', v_tcap::integer));
    end loop;
  elsif d ? 'tickets' and jsonb_typeof(d -> 'tickets') <> 'null' then
    return jsonb_build_object('ok', false, 'reason', 'bad_ticket');
  end if;

  v_appr := case when jsonb_typeof(d -> 'requires_approval') = 'boolean' then (d ->> 'requires_approval')::boolean else false end;
  v_wait := case when jsonb_typeof(d -> 'waitlist_on') = 'boolean' then (d ->> 'waitlist_on')::boolean else false end;

  return jsonb_build_object('ok', true, 'f', jsonb_build_object(
    'title', v_title, 'venue_name', v_venue, 'area', v_area, 'lat', v_lat, 'lng', v_lng,
    'starts_at', v_start, 'ends_at', v_end, 'timezone', v_tz, 'kind', v_kind,
    'link_type', v_ltype, 'online_link', v_link,
    'description', left(btrim(coalesce(d ->> 'description', '')), 2000),
    'capacity', v_cap, 'requires_approval', v_appr, 'waitlist_on', v_wait, 'visibility', v_vis,
    'flyer_url', v_cover, 'vibe', v_vibe, 'tickets', v_tickets,
    'price_naira', (select min((x ->> 'price_naira')::integer) from jsonb_array_elements(coalesce(v_tickets, '[]'::jsonb)) x)));
end $$;
revoke all on function public._ev_normalize(jsonb, uuid, uuid) from public, anon, authenticated;

-- An event as a draft again, so an edit or a clone is "everything as it was, plus a change".
create or replace function public._ev_draft_of(p_event uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'timezone', e.timezone, 'kind', e.kind,
    'place_name', case when e.venue_name in ('Online', 'To be announced') and (e.geog is null or e.kind = 'online') then null else e.venue_name end,
    'area', e.area,
    'lat', case when e.geog is null then null else st_y(e.geog::geometry) end,
    'lng', case when e.geog is null then null else st_x(e.geog::geometry) end,
    'link_type', e.link_type, 'online_link', (select l.link from public.ev_event_links l where l.event_id = e.id),
    'description', e.description, 'capacity', e.capacity, 'requires_approval', e.requires_approval,
    'waitlist_on', e.waitlist_on, 'visibility', e.visibility, 'cover_url', e.flyer_url, 'vibe', e.vibe)
  from public.events e where e.id = p_event;
$$;
revoke all on function public._ev_draft_of(uuid) from public, anon, authenticated;

-- Make an event for the caller: session, account, the silent rate limit, the checks, the insert, live. Returns
-- { ok: true, id } or { ok: false, reason }. Create and clone both go through here.
create or replace function public._ev_create_core(p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me     uuid := auth.uid();
  v_room uuid;
  v_n    integer;
  n      jsonb;
  f      jsonb;
  v_slug text;
  v_id   uuid;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  -- The silent limit: 5 new events an hour per person. One at a time per person so two calls cannot both slip under it.
  perform pg_advisory_xact_lock(hashtextextended('ev-create:' || me::text, 0));
  select count(*) into v_n from public.events where host_id = me and created_at > now() - interval '1 hour';
  if v_n >= 5 then return jsonb_build_object('ok', false, 'reason', 'try_again_later'); end if;

  v_room := public._ev_host_room(me);
  -- add_to_room false keeps the event out of the host's room.
  if jsonb_typeof(p_draft -> 'add_to_room') = 'boolean' and not (p_draft ->> 'add_to_room')::boolean then v_room := null; end if;
  n := public._ev_normalize(p_draft, v_room, me);
  if not (n ->> 'ok')::boolean then return n; end if;
  f := n -> 'f';

  v_slug := public._ev_slug(f ->> 'title');
  while exists (select 1 from public.events where slug = v_slug) loop
    v_slug := public._ev_slug(f ->> 'title');
  end loop;

  -- Inserted as 'pending' (your trigger makes it so), then flipped to live in this same transaction (note 1 in the header).
  insert into public.events (title, venue_name, area, geog, starts_at, ends_at, vibe, flyer_url, status,
                             host_id, room_id, description, kind, timezone, link_type, capacity,
                             requires_approval, waitlist_on, visibility, slug, price_naira)
  values (f ->> 'title', f ->> 'venue_name', f ->> 'area',
          case when (f ->> 'lat') is null then null
               else st_point((f ->> 'lng')::double precision, (f ->> 'lat')::double precision)::geography end,
          (f ->> 'starts_at')::timestamptz, (f ->> 'ends_at')::timestamptz, f ->> 'vibe', f ->> 'flyer_url', 'pending',
          me, v_room, f ->> 'description', f ->> 'kind', f ->> 'timezone', f ->> 'link_type', (f ->> 'capacity')::integer,
          (f ->> 'requires_approval')::boolean, (f ->> 'waitlist_on')::boolean, f ->> 'visibility', v_slug,
          coalesce((f ->> 'price_naira')::integer, 0))
  returning id into v_id;
  perform public._ev_apply_types(v_id, f -> 'tickets', true);

  if (f ->> 'online_link') is not null then
    insert into public.ev_event_links (event_id, link) values (v_id, f ->> 'online_link');
  end if;
  -- ev_events_sync_status makes this 'unlisted' for a community or invite event.
  update public.events set status = 'live' where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public._ev_create_core(jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------- the calls ---
create or replace function public.ev_create_event(p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  r := public._ev_create_core(p_draft);
  if not (r ->> 'ok')::boolean then return r; end if;
  return jsonb_build_object('ok', true, 'event', public._ev_event_json((r ->> 'id')::uuid));
end $$;

create or replace function public.ev_update_event(p_event uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me       uuid := auth.uid();
  e        public.events;
  v_allowed text[] := array['title', 'starts_at', 'ends_at', 'timezone', 'kind', 'place_name', 'area', 'lat', 'lng',
                            'link_type', 'online_link', 'description', 'capacity', 'requires_approval', 'waitlist_on',
                            'visibility', 'cover_url', 'vibe', 'tickets'];
  v_patch  jsonb;
  v_block  text;
  v_merged jsonb;
  n        jsonb;
  f        jsonb;
  v_reopen boolean;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_draft'); end if;
  select * into e from public.events where id = p_event for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public._ev_manage(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;

  select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb) into v_patch
    from jsonb_each(p_patch) k where k.key = any (v_allowed);
  v_merged := public._ev_draft_of(p_event) || v_patch;
  -- A new place name or area with no coordinates: the old pin no longer fits.
  if (v_patch ? 'place_name' or v_patch ? 'area') and not (v_patch ? 'lat') and not (v_patch ? 'lng') then
    v_merged := v_merged || jsonb_build_object('lat', null::double precision, 'lng', null::double precision);
  end if;

  n := public._ev_normalize(v_merged, e.room_id, coalesce(e.host_id, e.created_by));
  if not (n ->> 'ok')::boolean then return n; end if;
  f := n -> 'f';

  -- A ticket type people hold cannot be dropped. Checked before anything is written.
  if jsonb_typeof(f -> 'tickets') = 'array' then
    v_block := public._ev_types_blocker(p_event, f -> 'tickets');
    if v_block is not null then return jsonb_build_object('ok', false, 'reason', 'ticket_in_use', 'ticket', v_block); end if;
  end if;

  v_reopen := jsonb_typeof(f -> 'tickets') = 'array' or (e.capacity is not null and ((f ->> 'capacity') is null or (f ->> 'capacity')::integer > e.capacity))
              or ((f ->> 'requires_approval')::boolean is distinct from e.requires_approval);

  update public.events set
    title = f ->> 'title', venue_name = f ->> 'venue_name', area = f ->> 'area',
    geog = case when (f ->> 'lat') is null then null
                else st_point((f ->> 'lng')::double precision, (f ->> 'lat')::double precision)::geography end,
    starts_at = (f ->> 'starts_at')::timestamptz, ends_at = (f ->> 'ends_at')::timestamptz,
    timezone = f ->> 'timezone', kind = f ->> 'kind', link_type = f ->> 'link_type',
    description = f ->> 'description', capacity = (f ->> 'capacity')::integer,
    requires_approval = (f ->> 'requires_approval')::boolean, waitlist_on = (f ->> 'waitlist_on')::boolean,
    visibility = f ->> 'visibility', flyer_url = f ->> 'flyer_url', vibe = f ->> 'vibe',
    price_naira = coalesce((f ->> 'price_naira')::integer, price_naira)
  where id = p_event;
  perform public._ev_apply_types(p_event, f -> 'tickets', false);

  if (f ->> 'online_link') is null then
    delete from public.ev_event_links where event_id = p_event;
  else
    insert into public.ev_event_links (event_id, link) values (p_event, f ->> 'online_link')
    on conflict (event_id) do update set link = excluded.link, updated_at = now();
  end if;

  -- More room, or approval changed: people waiting may move up.
  if v_reopen then perform public._ev_fill_waitlist(p_event); end if;
  return jsonb_build_object('ok', true, 'event', public._ev_event_json(p_event));
end $$;

create or replace function public.ev_cancel_event(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.events;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  select * into e from public.events where id = p_event for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public._ev_manage(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  -- Staff hid it: the host cannot undo that by cancelling.
  if e.status in ('hidden', 'rejected') and not public._ev_staff() then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if e.status <> 'cancelled' then
    update public.events set status = 'cancelled' where id = p_event;
  end if;
  return jsonb_build_object('ok', true, 'event', public._ev_event_json(p_event));
end $$;

-- The same event a week on, with no guests. The caller becomes the host of the copy.
create or replace function public.ev_clone_event(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d jsonb;
  r jsonb;
  s timestamptz;
  x timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if not exists (select 1 from public.events where id = p_event) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public._ev_manage(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  d := public._ev_draft_of(p_event);
  s := (d ->> 'starts_at')::timestamptz + interval '7 days';
  x := (d ->> 'ends_at')::timestamptz + interval '7 days';
  d := d || jsonb_build_object('starts_at', s, 'ends_at', x, 'tickets', public._ev_types_draft(p_event));
  r := public._ev_create_core(d);
  if not (r ->> 'ok')::boolean then return r; end if;
  perform public._ev_copy_settings(p_event, (r ->> 'id')::uuid);
  return jsonb_build_object('ok', true, 'event', public._ev_event_json((r ->> 'id')::uuid));
end $$;

-- One event by id or by slug. Null when it does not exist or this viewer may not open it.
create or replace function public.ev_get_event(p_id_or_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_key text := lower(btrim(coalesce(p_id_or_slug, '')));
  v_id  uuid;
begin
  if v_key = '' or char_length(v_key) > 120 then return null; end if;
  if v_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := v_key::uuid;
  else
    select e.id into v_id from public.events e where e.slug = v_key;
  end if;
  if v_id is null or not public._ev_can_open(v_id) then return null; end if;
  return public._ev_event_json(v_id);
end $$;

-- The list. Public to everyone, community to members of the host's room, invite never (the host sees their own).
create or replace function public.ev_list_events() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  return coalesce((
    select jsonb_agg(public._ev_event_json(t.id) order by t.starts_at, t.id)
      from (
        select e.id, e.starts_at
          from public.events e
         where e.status in ('live', 'unlisted')
           and e.starts_at between now() - interval '4 hours' and now() + interval '45 days'
           and (e.visibility = 'public'
                or (me is not null and coalesce(e.host_id, e.created_by) = me)
                or (e.visibility = 'community' and public._ev_in_room(e.room_id, me)))
         order by e.starts_at, e.id
         limit 500) t
  ), '[]'::jsonb);
end $$;

-- The host's own events, any status. Upcoming first (soonest first), then past (latest first).
create or replace function public.ev_my_events() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(public._ev_event_json(t.id)
                     order by (t.finish < now()), case when t.finish >= now() then t.starts_at end,
                              case when t.finish < now() then t.starts_at end desc, t.id)
      from (
        select e.id, e.starts_at, coalesce(e.ends_at, e.starts_at + interval '3 hours') as finish
          from public.events e
         where coalesce(e.host_id, e.created_by) = me and e.status <> 'rejected'
         order by e.starts_at desc
         limit 300) t
  ), '[]'::jsonb);
end $$;

-- ----------------------------------------------------------------- access ---
revoke all on function public.ev_create_event(jsonb), public.ev_update_event(uuid, jsonb), public.ev_cancel_event(uuid),
  public.ev_clone_event(uuid), public.ev_get_event(text), public.ev_list_events(), public.ev_my_events() from public, anon;
grant execute on function public.ev_create_event(jsonb), public.ev_update_event(uuid, jsonb), public.ev_cancel_event(uuid),
  public.ev_clone_event(uuid), public.ev_my_events() to authenticated;
-- The event page and the list work for a visitor with no account too (they see public events only).
grant execute on function public.ev_get_event(text), public.ev_list_events() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
