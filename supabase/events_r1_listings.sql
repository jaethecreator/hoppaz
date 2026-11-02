-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Pulled events become LISTINGS: the real price, a link to the organiser's ticket page, and no way to register or pay on Hoppaz.
-- File 1 of 3 for the outreach flow (docs/OUTREACH-FLOW.md). This file is the foundation and the server-side guard:
--   * the columns on events (ticket_mode, ticket_url, instagram_url, listed prices, source ids, organiser_id)
--   * the closed tables: ev_organisers, ev_organiser_log, ev_pulled, ev_transfers, ev_claim_requests, ev_listings_account
--   * the guard: a trigger on ev_registrations and on ev_orders refuses any event with ticket_mode 'external' ('external_tickets')
--   * a trigger that makes every new row without a host (the old loaders) external
--   * ev_listings(): the public read the screens use to show the listing price and links
--   * the Hoppaz Listings account (ev_listings_set_account, Ola runs it once)
--   * read-only reports for Ola: ev_listings_registrations_report()
-- RUN ORDER: after events_r1_events.sql (needs _ev_staff, ev_settings) and, if you have them, events_r1_registrations.sql and
--   events_r1_pay.sql (the triggers are made only on tables that exist; run this file again after adding them). Then
--   events_r1_outreach.sql, then events_r1_transfer.sql. Safe to run again.
-- It replaces no existing function and edits no existing file.
-- ============================================================================
begin;

-- ---------------------------------------------------------------- organisers ---
create table if not exists public.ev_organisers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(btrim(name)) between 1 and 120),
  name_key          text not null,                           -- lower case letters and digits of the name, for matching
  ig_handle         text check (ig_handle is null or ig_handle ~ '^[a-z0-9._]{1,30}$'),   -- no @, lower case
  handles           jsonb not null default '{}'::jsonb check (jsonb_typeof(handles) = 'object' and octet_length(handles::text) < 1500),
  email             text check (email is null or char_length(email) <= 254),
  phone             text check (phone is null or char_length(phone) <= 40),
  room_id           uuid references public.crews(id) on delete set null,
  stage             text not null default 'pulled' check (stage in ('pulled', 'listed', 'offered', 'claimed', 'declined')),
  do_not_contact    boolean not null default false,
  last_contacted_at timestamptz,
  last_contacted_by text check (last_contacted_by is null or char_length(last_contacted_by) <= 60),
  notes             text not null default '' check (char_length(notes) <= 4000),
  claimed_at        timestamptz,
  claimed_by        uuid references public.profiles(id) on delete set null,
  declined_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists ev_organisers_handle_uq on public.ev_organisers (ig_handle) where ig_handle is not null;
create index if not exists ev_organisers_key_idx on public.ev_organisers (name_key);
create index if not exists ev_organisers_stage_idx on public.ev_organisers (stage, last_contacted_at);
create unique index if not exists ev_organisers_room_uq on public.ev_organisers (room_id) where room_id is not null;

create table if not exists public.ev_organiser_log (
  id           uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references public.ev_organisers(id) on delete cascade,
  at           timestamptz not null default now(),
  by_name      text check (by_name is null or char_length(by_name) <= 60),
  kind         text not null check (kind in ('contact', 'reply', 'offer', 'note', 'stage', 'transfer', 'claim_request', 'scrape', 'delete')),
  channel      text check (channel is null or channel in ('instagram', 'whatsapp', 'email', 'phone', 'other')),
  body         text not null default '' check (char_length(body) <= 2000)
);
create index if not exists ev_organiser_log_idx on public.ev_organiser_log (organiser_id, at desc);
create index if not exists ev_organiser_log_at_idx on public.ev_organiser_log (at desc);

-- ------------------------------------------------------------- events columns ---
alter table public.events add column if not exists ticket_mode text not null default 'hoppaz' check (ticket_mode in ('hoppaz', 'external'));
alter table public.events add column if not exists ticket_url text check (ticket_url is null or (ticket_url ~* '^https?://' and char_length(ticket_url) <= 600));
alter table public.events add column if not exists instagram_url text check (instagram_url is null or (instagram_url ~* '^https?://' and char_length(instagram_url) <= 600));
-- The lowest and highest ticket price listed at the source, whole naira. null = not known (the screens say "Check listing"). 0 = free.
alter table public.events add column if not exists listed_price integer check (listed_price is null or listed_price >= 0);
alter table public.events add column if not exists listed_price_max integer check (listed_price_max is null or listed_price_max >= 0);
alter table public.events add column if not exists listing_sold_out boolean not null default false;
alter table public.events add column if not exists source_site text check (source_site is null or char_length(source_site) <= 40);
alter table public.events add column if not exists source_id text check (source_id is null or char_length(source_id) <= 200);
alter table public.events add column if not exists organiser_id uuid references public.ev_organisers(id) on delete set null;
create index if not exists events_organiser_idx on public.events (organiser_id, starts_at) where organiser_id is not null;
create index if not exists events_external_idx on public.events (starts_at) where ticket_mode = 'external';

-- ----------------------------------------------------------- the review queue ---
-- What the scout found. One row per (source_site, source_id): a rerun updates it. Never public. fields holds the ScoutEvent
-- (src/lib/events-r1/types.ts): name, starts_at, ends_at, venue, area, lat, lng, description, ticket_types, sold_out, ticket_url, flyer_url,
-- category, organiser_*, event_handle, lineup, last_seen, confidence.
create table if not exists public.ev_pulled (
  id            uuid primary key default gen_random_uuid(),
  source_site   text not null check (char_length(source_site) between 1 and 40),
  source_id     text not null check (char_length(source_id) between 1 and 200),
  status        text not null default 'new' check (status in ('new', 'approved', 'rejected', 'merged', 'blocked')),
  fields        jsonb not null check (jsonb_typeof(fields) = 'object'),
  edited        text[] not null default '{}',               -- fields staff changed by hand: a rerun never overwrites these
  flags         text[] not null default '{}',               -- duplicate, changed, no_price, no_time, no_pin, blocked, moved
  confidence    text not null default 'lead' check (confidence in ('confirmed', 'lead')),
  organiser_id  uuid references public.ev_organisers(id) on delete set null,
  event_id      uuid references public.events(id) on delete set null,
  duplicate_of  uuid references public.ev_pulled(id) on delete set null,
  also_at       jsonb not null default '[]'::jsonb,         -- other sources of the same event, kept when merged
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  last_run      text check (last_run is null or char_length(last_run) <= 80),
  missing_since timestamptz,                                -- set when a run that covered this source did not see the event
  decided_by    text check (decided_by is null or char_length(decided_by) <= 60),
  decided_at    timestamptz,
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 300),
  unique (source_site, source_id)
);
create index if not exists ev_pulled_status_idx on public.ev_pulled (status, first_seen_at desc);
create index if not exists ev_pulled_org_idx on public.ev_pulled (organiser_id);
create index if not exists ev_pulled_event_idx on public.ev_pulled (event_id) where event_id is not null;

-- ------------------------------------------------------------------ transfers ---
create table if not exists public.ev_transfers (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('claim', 'handover')),
  room_id      uuid not null references public.crews(id) on delete cascade,
  organiser_id uuid references public.ev_organisers(id) on delete set null,
  from_user    uuid references public.profiles(id) on delete set null,   -- handover: the owner who started it
  to_email     text not null check (to_email = lower(btrim(to_email)) and to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(to_email) <= 254),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),   -- sha256 of the token; the token itself is never stored
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_by   text check (created_by is null or char_length(created_by) <= 60),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  accepted_by  uuid references public.profiles(id) on delete set null,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  attempts     integer not null default 0
);
create index if not exists ev_transfers_room_idx on public.ev_transfers (room_id, status);
create index if not exists ev_transfers_org_idx on public.ev_transfers (organiser_id, created_at desc);
create index if not exists ev_transfers_email_idx on public.ev_transfers (to_email) where status = 'pending';

-- "Is this your event?" from the event page. One open request per (event, email).
create table if not exists public.ev_claim_requests (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  organiser_id uuid references public.ev_organisers(id) on delete set null,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  email        text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  phone        text check (phone is null or char_length(phone) <= 40),
  note         text not null default '' check (char_length(note) <= 500),
  user_id      uuid references public.profiles(id) on delete set null,
  status       text not null default 'new' check (status in ('new', 'handled')),
  created_at   timestamptz not null default now(),
  handled_at   timestamptz
);
create unique index if not exists ev_claim_requests_open_uq on public.ev_claim_requests (event_id, email) where status = 'new';
create index if not exists ev_claim_requests_idx on public.ev_claim_requests (status, created_at desc);

-- One row: which profile is Hoppaz Listings.
create table if not exists public.ev_listings_account (
  only_row boolean primary key default true check (only_row),
  user_id  uuid not null references public.profiles(id) on delete restrict,
  set_at   timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['ev_organisers', 'ev_organiser_log', 'ev_pulled', 'ev_transfers', 'ev_claim_requests', 'ev_listings_account'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- --------------------------------------------------- the Hoppaz Listings account ---
create or replace function public._ev_listings_uid() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.user_id from public.ev_listings_account a where a.only_row;
$$;
revoke all on function public._ev_listings_uid() from public, anon, authenticated;
grant execute on function public._ev_listings_uid() to service_role;

-- Ola, once: the auth user exists (made in the Supabase dashboard, nobody signs in as it). Answers ok | no_such_user | no_profile | bad_email.
create or replace function public.ev_listings_set_account(p_email text) returns text
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_id uuid;
begin
  if p_email is null or btrim(p_email) = '' then return 'bad_email'; end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then return 'no_such_user'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_id) then return 'no_profile'; end if;
  update public.profiles set display_name = 'Hoppaz Listings' where id = v_id;
  insert into public.ev_listings_account (only_row, user_id) values (true, v_id)
  on conflict (only_row) do update set user_id = excluded.user_id, set_at = now();
  return 'ok';
end $$;
revoke all on function public.ev_listings_set_account(text) from public, anon, authenticated;
grant execute on function public.ev_listings_set_account(text) to service_role;

-- --------------------------------------------------------------- the guard ---
-- No registration and no order for an external event, whatever function tries it. The message is the reason code.
create or replace function public._ev_block_external() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.events e where e.id = new.event_id and e.ticket_mode = 'external') then
    raise exception 'external_tickets' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public._ev_block_external() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.ev_registrations') is not null then
    execute 'drop trigger if exists ev_block_external on public.ev_registrations';
    execute 'create trigger ev_block_external before insert on public.ev_registrations for each row execute function public._ev_block_external()';
  end if;
  if to_regclass('public.ev_orders') is not null then
    execute 'drop trigger if exists ev_block_external on public.ev_orders';
    execute 'create trigger ev_block_external before insert on public.ev_orders for each row execute function public._ev_block_external()';
  end if;
end $$;

-- A row inserted with no host (the old loaders, a SQL paste) is a listing, unless it is a Hoppaz event itself. Rows with a host are Hoppaz events.
create or replace function public._ev_events_default_mode() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.host_id is null and new.source <> 'hoppaz' and new.ticket_mode = 'hoppaz' then
    new.ticket_mode := 'external';
  end if;
  if new.ticket_mode = 'external' then
    -- The old single link: a ticket page, or an Instagram post. Split it once.
    if new.ig_url is not null and new.ticket_url is null and new.instagram_url is null then
      if new.ig_url ~* '^https?://([a-z0-9-]+\.)*(instagram\.com|instagr\.am)(/|$)' then new.instagram_url := new.ig_url;
      elsif new.ig_url ~* '^https?://' then new.ticket_url := new.ig_url;
      end if;
    end if;
    if new.listed_price is null and new.title not like 'LEAD · %' and new.price_naira > 0 then new.listed_price := new.price_naira; end if;
  end if;
  return new;
end $$;
revoke all on function public._ev_events_default_mode() from public, anon, authenticated;
drop trigger if exists ev_events_default_mode on public.events;
create trigger ev_events_default_mode before insert on public.events for each row execute function public._ev_events_default_mode();

-- ----------------------------------------------------------- backfill (once) ---
-- Every old listing (no host, not a Hoppaz event) becomes external. A row that is already external is left alone.
update public.events e
   set ticket_mode = 'external',
       ticket_url = case when e.ig_url ~* '^https?://' and e.ig_url !~* '^https?://([a-z0-9-]+\.)*(instagram\.com|instagr\.am)(/|$)' then e.ig_url else e.ticket_url end,
       instagram_url = case when e.ig_url ~* '^https?://([a-z0-9-]+\.)*(instagram\.com|instagr\.am)(/|$)' then e.ig_url else e.instagram_url end,
       listed_price = case when e.title like 'LEAD · %' then null else e.price_naira end
 where e.host_id is null and e.source <> 'hoppaz' and e.ticket_mode = 'hoppaz';

-- ------------------------------------------------- the public read: ev_listings ---
-- One call for the screens: { "<event id>": { ticket_url, instagram_url, price_from, price_to, sold_out, source_site, claimed, organiser_name } }
-- for every external event a visitor may see. The event functions (ev_list_events, ev_get_event) stay as they were.
create or replace function public.ev_listings() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
           'ticket_url', e.ticket_url, 'instagram_url', e.instagram_url,
           'price_from', e.listed_price, 'price_to', e.listed_price_max, 'sold_out', e.listing_sold_out,
           'source_site', e.source_site,
           'claimed', e.host_id is not null and e.host_id is distinct from public._ev_listings_uid(),
           'organiser_name', o.name)), '{}'::jsonb)
    from public.events e
    left join public.ev_organisers o on o.id = e.organiser_id
   where e.ticket_mode = 'external' and e.status in ('live', 'unlisted', 'cancelled', 'ended') and e.visibility = 'public';
$$;
revoke all on function public.ev_listings() from public;
grant execute on function public.ev_listings() to anon, authenticated, service_role;

-- ---------------------------------------------- for Ola: who already registered ---
-- READ ONLY. Old listings could be registered for before this file: those people hold a free "General" ticket for a show Hoppaz does not
-- run. One row per listing that has any. select * from public.ev_listings_registrations_report();
create or replace function public.ev_listings_registrations_report() returns table (
  event_id uuid, title text, starts_at timestamptz, going integer, requested_or_waitlisted integer, cancelled integer, paid_orders integer, ticket_url text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if to_regclass('public.ev_registrations') is null then return; end if;
  return query execute $q$
    select e.id, e.title, e.starts_at,
           count(*) filter (where r.status in ('going', 'checked_in'))::int,
           count(*) filter (where r.status in ('requested', 'waitlisted'))::int,
           count(*) filter (where r.status in ('cancelled', 'declined'))::int,
           case when to_regclass('public.ev_orders') is null then 0
                else (select count(*)::int from public.ev_orders o where o.event_id = e.id and o.status in ('paid', 'refund_pending', 'refunded')) end,
           coalesce(e.ticket_url, e.instagram_url)
      from public.events e join public.ev_registrations r on r.event_id = e.id
     where e.ticket_mode = 'external'
     group by e.id order by e.starts_at $q$;
end $$;
revoke all on function public.ev_listings_registrations_report() from public, anon, authenticated;
grant execute on function public.ev_listings_registrations_report() to service_role;

notify pgrst, 'reload schema';
commit;
