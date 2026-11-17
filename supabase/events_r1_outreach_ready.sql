-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Outreach readiness (CHANGE-005), parts B, C and D, plus bulk approve. One new file; it edits no existing file.
--
--   B  Source and organiser fields on events: ticket_platform, source_url, flyer_credit, organiser_name, organiser_ig, organiser_x
--      (source_site, source_id and ticket_url already exist). Public text and handles only: NO phone numbers and NO emails.
--      The scout import and the approve path fill them (the four functions replaced below). ev_listings() carries them to the page.
--   C  Claim an event, behind the switch 'event_claims' (OFF until you run ev_set_claims('on')):
--        * a one-time claim link with no email and no review: staff make it (ev_o_claim_link_create), the organiser opens
--          /claim/<token> and signs in (ev_claim_link_preview, ev_claim_link_accept). Only sha256(token) is stored.
--          Single use, 14 days, revocable (ev_o_claim_link_revoke), at most 5 open per room, wrong tries rate limited.
--        * an ask for people without a link (ev_claim_ask, signed in). Staff approve or decline (ev_o_claim_asks, ev_o_claim_ask_decide);
--          an approve hands the room over now.
--        * the staff list of claimable listings (ev_o_claimable).
--      The hand over is one helper, _ev_cl_handover, with the same steps as ev_transfer_accept (events_r1_transfer.sql).
--   D  Tickets on another site: ev_ticket_tap counts a tap on the outside ticket button once per person or device per Lagos day;
--      ev_ticket_tap_count gives a host "[N] people went to buy"; ev_o_tap_counts gives staff the same by event and organiser.
--   +  Bulk approve: ev_o_approve_many approves up to 100 pulled rows, each on its own; rows that cannot be approved come back with the reason.
--
-- RUN ORDER: after events_r1_listings.sql, events_r1_outreach.sql and events_r1_transfer.sql (it needs their tables and helpers). Safe to run twice.
-- ONE TRANSACTION: begin ... commit; nothing is left half done.
-- REPLACES (create or replace, in this file only; the old files are untouched and must stay in the run order before this one):
--   _ev_o_clean_fields, _ev_o_patch, _ev_o_event_update, _ev_o_event_create   (events_r1_outreach.sql: the new fields, and no organiser email or phone)
--   ev_listings                                                                (events_r1_listings.sql: the new fields)
--   Run this file AFTER the three files above whenever you run them again: running an older file again puts its copy of these back.
-- NEW: ev_set_claims, _ev_claims_on, _ev_o_plain, _ev_o_contactish, _ev_o_xhandle, _ev_cl_handover, ev_claim_link_preview, ev_claim_link_accept,
--      ev_claim_ask, ev_ticket_tap, ev_ticket_tap_count, and the service role functions ev_o_claim_link_create, ev_o_claim_link_revoke,
--      ev_o_claim_links, ev_o_claimable, ev_o_claim_asks, ev_o_claim_ask_decide, ev_o_tap_counts, ev_o_approve_many.
-- TABLES (closed: no policy, no grant to anon or authenticated): ev_claim_links, ev_claim_asks, ev_claim_attempts, ev_ticket_taps.
-- Reasons added: not_on, bad_ids, too_many, already_handled, already_asked, plus the ones the other files already use.
-- Test: supabase/tests/events_r1_outreach_ready_test.sql
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.ev_organisers') is null or to_regclass('public.ev_transfers') is null or to_regclass('public.ev_claim_requests') is null then
    raise exception 'events_r1_outreach_ready: run events_r1_listings.sql first';
  end if;
  if to_regprocedure('public._ev_o_clean_fields(jsonb)') is null or to_regprocedure('public.ev_o_ensure_room(uuid)') is null then
    raise exception 'events_r1_outreach_ready: run events_r1_outreach.sql first';
  end if;
  if to_regprocedure('public._ev_xf_owner(uuid)') is null or to_regprocedure('public._ev_xf_moving(uuid, uuid)') is null then
    raise exception 'events_r1_outreach_ready: run events_r1_transfer.sql first';
  end if;
end $$;

-- ================================================================== B: the new columns ===
-- Plain public text only. A check refuses anything that looks like an email or a phone number (9 or more digits, spaces and dashes allowed).
alter table public.events add column if not exists ticket_platform text check (ticket_platform is null or char_length(ticket_platform) <= 40);
alter table public.events add column if not exists source_url text check (source_url is null or (source_url ~* '^https?://' and char_length(source_url) <= 600));
alter table public.events add column if not exists flyer_credit text;
alter table public.events add column if not exists organiser_name text;
alter table public.events add column if not exists organiser_ig text;
alter table public.events add column if not exists organiser_x text;

alter table public.events drop constraint if exists events_flyer_credit_plain;
alter table public.events add constraint events_flyer_credit_plain check (
  flyer_credit is null or (char_length(flyer_credit) <= 80 and flyer_credit !~ '[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}' and flyer_credit !~ '(\d[ ().-]*){9,}'));
alter table public.events drop constraint if exists events_organiser_name_plain;
alter table public.events add constraint events_organiser_name_plain check (
  organiser_name is null or (char_length(organiser_name) <= 120 and organiser_name !~ '[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}' and organiser_name !~ '(\d[ ().-]*){9,}'));
alter table public.events drop constraint if exists events_organiser_ig_handle;
alter table public.events add constraint events_organiser_ig_handle check (organiser_ig is null or organiser_ig ~ '^[a-z0-9._]{1,30}$');
alter table public.events drop constraint if exists events_organiser_x_handle;
alter table public.events add constraint events_organiser_x_handle check (organiser_x is null or organiser_x ~ '^[a-z0-9_]{1,15}$');

-- ------------------------------------------------------------------ small helpers ---
-- Does this text look like an email address or a phone number? Such text is never kept.
create or replace function public._ev_o_contactish(p_text text) returns boolean
language sql immutable security definer set search_path = public, pg_temp as $$
  select coalesce(p_text ~ '[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}' or p_text ~ '(\d[ ().-]*){9,}', false);
$$;

-- Short plain text: control characters become spaces, runs of spaces fold, cut at p_len. Null when empty or when it looks like an email or phone.
create or replace function public._ev_o_plain(p_text text, p_len integer) returns text
language sql immutable security definer set search_path = public, pg_temp as $$
  select case when public._ev_o_contactish(p_text) then null
              else nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')), p_len), '') end;
$$;

-- An X handle from "@name", "name" or an x.com or twitter.com link. 1 to 15 letters, digits and underscores. Null when it is not one.
create or replace function public._ev_o_xhandle(p_text text) returns text
language plpgsql immutable security definer set search_path = public, pg_temp as $$
declare h text := lower(btrim(coalesce(p_text, '')));
begin
  h := regexp_replace(h, '^https?://([a-z0-9-]+\.)*(x\.com|twitter\.com)/', '');
  h := regexp_replace(h, '[/?#].*$', '');
  h := regexp_replace(h, '^@', '');
  if h ~ '^[a-z0-9_]{1,15}$' then return h; end if;
  return null;
end $$;
revoke all on function public._ev_o_contactish(text), public._ev_o_plain(text, integer), public._ev_o_xhandle(text) from public, anon, authenticated;


-- ------------------------------------------------------------ replaced: the scout's fields ---
-- Copy of events_r1_outreach.sql with the new fields and no organiser email or phone.
create or replace function public._ev_o_clean_fields(e jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_name   text;
  v_start  timestamptz;
  v_end    timestamptz;
  v_lat    double precision;
  v_lng    double precision;
  v_pin    text;
  v_tix    jsonb := '[]'::jsonb;
  v_lineup jsonb := '[]'::jsonb;
  t        jsonb;
  v_price  numeric;
  v_cap    integer;
  v_conf   text;
  v_seen   text;
  v_src    text;
  i        integer := 0;
begin
  if e is null or jsonb_typeof(e) <> 'object' then raise exception 'Not an event object'; end if;
  v_name := public._ev_o_txt(e ->> 'name', 120);
  if v_name is null then raise exception 'No event name'; end if;

  if public._ev_o_txt(e ->> 'starts_at', 60) is not null then
    v_start := public._ev_try_ts(btrim(e ->> 'starts_at'));
    if v_start is null then raise exception 'Start time is not a date'; end if;
  end if;
  if public._ev_o_txt(e ->> 'ends_at', 60) is not null then
    v_end := public._ev_try_ts(btrim(e ->> 'ends_at'));
    if v_end is null then raise exception 'End time is not a date'; end if;
    if v_start is not null and v_end <= v_start then v_end := null; end if;
  end if;

  if jsonb_typeof(e -> 'lat') = 'number' and jsonb_typeof(e -> 'lng') = 'number'
     and (e ->> 'lat')::double precision between -90 and 90 and (e ->> 'lng')::double precision between -180 and 180 then
    v_lat := (e ->> 'lat')::double precision;
    v_lng := (e ->> 'lng')::double precision;
  end if;
  v_pin := case when v_lat is not null and (e ->> 'pin_by') in ('venues', 'source', 'osm') then e ->> 'pin_by' end;

  if jsonb_typeof(e -> 'tickets') = 'array' then
    for t in select value from jsonb_array_elements(e -> 'tickets') loop
      exit when i >= 10;
      if jsonb_typeof(t) <> 'object' then continue; end if;
      i := i + 1;
      v_price := null;
      if jsonb_typeof(t -> 'price_naira') = 'number' and (t ->> 'price_naira')::numeric >= 0 and (t ->> 'price_naira')::numeric <= 100000000 then
        v_price := round((t ->> 'price_naira')::numeric);
      end if;
      v_tix := v_tix || jsonb_build_array(jsonb_build_object(
        'name', coalesce(public._ev_o_txt(t ->> 'name', 60), 'Ticket'),
        'price_naira', v_price::integer,
        'sold_out', coalesce(t ->> 'sold_out', 'false') = 'true'));
    end loop;
  end if;

  i := 0;
  if jsonb_typeof(e -> 'lineup') = 'array' then
    for t in select value from jsonb_array_elements(e -> 'lineup') loop
      exit when i >= 30;
      if jsonb_typeof(t) <> 'object' or public._ev_o_txt(t ->> 'name', 80) is null then continue; end if;
      i := i + 1;
      v_lineup := v_lineup || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'time', public._ev_o_txt(t ->> 'time', 20), 'name', public._ev_o_txt(t ->> 'name', 80))));
    end loop;
  end if;

  if jsonb_typeof(e -> 'capacity') = 'number' and (e ->> 'capacity')::numeric >= 1 and (e ->> 'capacity')::numeric <= 100000 then
    v_cap := round((e ->> 'capacity')::numeric)::integer;
  end if;

  -- The page the event was found on: a full link or nothing.
  v_src := public._ev_o_url(e ->> 'source_url');
  v_conf := case when e ->> 'confidence' = 'confirmed' and v_start is not null then 'confirmed' else 'lead' end;
  v_seen := coalesce(public._ev_o_txt(e ->> 'last_seen', 60), public._ev_o_iso(now()));

  return jsonb_build_object(
    'source_site', public._ev_o_txt(e ->> 'source_site', 40),
    'source_id', public._ev_o_txt(e ->> 'source_id', 200),
    'name', v_name,
    'starts_at', public._ev_o_iso(v_start),
    'ends_at', public._ev_o_iso(v_end),
    'venue', public._ev_o_txt(e ->> 'venue', 120),
    'area', public._ev_o_txt(e ->> 'area', 60),
    'lat', v_lat, 'lng', v_lng, 'pin_by', v_pin,
    'description', left(btrim(coalesce(e ->> 'description', '')), 2000),
    'tickets', v_tix,
    'sold_out', coalesce(e ->> 'sold_out', 'false') = 'true',
    'ticket_url', public._ev_o_url(e ->> 'ticket_url'),
    'flyer_url', public._ev_o_url(e ->> 'flyer_url'),
    'category', public._ev_o_txt(e ->> 'category', 60),
    'organiser_name', public._ev_o_txt(e ->> 'organiser_name', 120),
    'organiser_handle', public._ev_o_handle(e ->> 'organiser_handle'),
    'event_handle', public._ev_o_handle(e ->> 'event_handle'),
    -- Hoppaz keeps no phone number or email of an organiser. The keys stay so the shape does not change; they are always null.
    'organiser_email', null,
    'organiser_phone', null,
    'organiser_x', public._ev_o_xhandle(e ->> 'organiser_x'),
    'ticket_platform', public._ev_o_plain(e ->> 'ticket_platform', 40),
    'source_url', v_src,
    'flyer_credit', public._ev_o_plain(e ->> 'flyer_credit', 80),
    'lineup', v_lineup, 'capacity', v_cap,
    'last_seen', v_seen, 'confidence', v_conf);
end $$;

-- A staff patch may now also carry organiser_x, ticket_platform, source_url and flyer_credit.
create or replace function public._ev_o_patch(p_fields jsonb, p_edited text[], p_patch jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  k text;
  v_f jsonb := p_fields;
  v_ed text[] := coalesce(p_edited, '{}');
  v_keys text[] := array['name', 'starts_at', 'ends_at', 'venue', 'area', 'lat', 'lng', 'description', 'tickets', 'sold_out',
                         'ticket_url', 'flyer_url', 'category', 'organiser_name', 'organiser_handle',
                         'organiser_x', 'ticket_platform', 'source_url', 'flyer_credit'];
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('fields', v_f, 'edited', to_jsonb(v_ed));
  end if;
  foreach k in array v_keys loop
    if p_patch ? k then
      v_f := jsonb_set(v_f, array[k], coalesce(p_patch -> k, 'null'::jsonb), true);
      if not (k = any (v_ed)) then v_ed := v_ed || k; end if;
    end if;
  end loop;
  -- Setting a pin by hand: it came from staff, so the pin source is cleared (staff checked it).
  if p_patch ? 'lat' or p_patch ? 'lng' then v_f := jsonb_set(v_f, '{pin_by}', 'null'::jsonb, true); end if;
  begin
    v_f := public._ev_o_clean_fields(v_f);
  exception when raise_exception then
    raise exception 'bad_patch';
  end;
  v_f := v_f || jsonb_build_object('source_site', p_fields -> 'source_site', 'source_id', p_fields -> 'source_id',
                                   'last_seen', p_fields -> 'last_seen', 'confidence', p_fields -> 'confidence');
  if v_f ->> 'starts_at' is null then v_f := jsonb_set(v_f, '{confidence}', '"lead"'::jsonb); end if;
  return jsonb_build_object('fields', v_f, 'edited', to_jsonb(v_ed));
end $$;

-- ------------------------------------------------------------ replaced: the listing event ---
-- A rerun fills ticket_platform, source_url and flyer_credit when the source says something; approving or editing also sets the organiser's public handles.
create or replace function public._ev_o_event_update(p_event uuid, f jsonb, p_all boolean, p_skip text[]) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e       public.events;
  ch      text[] := '{}';
  v_skip  text[] := coalesce(p_skip, '{}');
  v_start timestamptz := public._ev_try_ts(f ->> 'starts_at');
  v_end   timestamptz := public._ev_try_ts(f ->> 'ends_at');
  v_min   integer := public._ev_o_price_min(f -> 'tickets');
  v_max   integer := public._ev_o_price_max(f -> 'tickets');
  v_sold  boolean := public._ev_o_sold_out(f);
  v_url   text := public._ev_o_url(f ->> 'ticket_url');
  v_fly   text := public._ev_o_url(f ->> 'flyer_url');
  v_ig    text := coalesce(public._ev_o_handle(f ->> 'event_handle'), public._ev_o_handle(f ->> 'organiser_handle'));
  v_name  text := public._ev_o_txt(f ->> 'name', 120);
  v_venue text := public._ev_o_txt(f ->> 'venue', 120);
  v_area  text := public._ev_o_txt(f ->> 'area', 60);
  v_lat   double precision;
  v_lng   double precision;
  v_vibe  text;
  v_plat  text := public._ev_o_plain(f ->> 'ticket_platform', 40);
  v_src   text := public._ev_o_url(f ->> 'source_url');
  v_cred  text := public._ev_o_plain(f ->> 'flyer_credit', 80);
  v_oname text := coalesce(public._ev_o_plain(f ->> 'organiser_name', 120), (select o.name from public.ev_organisers o join public.events x on x.organiser_id = o.id where x.id = p_event));
  v_oig   text := coalesce(public._ev_o_handle(f ->> 'organiser_handle'), (select o.ig_handle from public.ev_organisers o join public.events x on x.organiser_id = o.id where x.id = p_event));
  v_ox    text := public._ev_o_xhandle(f ->> 'organiser_x');
begin
  select * into e from public.events where id = p_event for update;
  if not found then return ch; end if;

  if v_start is not null and not ('starts_at' = any (v_skip)) and e.starts_at is distinct from v_start then
    e.starts_at := v_start; ch := array_append(ch, 'starts_at');
  end if;
  if v_end is not null and not ('ends_at' = any (v_skip)) and v_end > e.starts_at and e.ends_at is distinct from v_end then
    e.ends_at := v_end; ch := array_append(ch, 'ends_at');
  end if;
  if e.ends_at is not null and e.ends_at <= e.starts_at then e.ends_at := null; end if;

  if v_min is not null and not ('tickets' = any (v_skip))
     and (e.listed_price is distinct from v_min or e.listed_price_max is distinct from v_max) then
    e.listed_price := v_min; e.listed_price_max := v_max; ch := array_append(ch, 'price');
  end if;
  if not ('sold_out' = any (v_skip)) and not ('tickets' = any (v_skip)) and e.listing_sold_out is distinct from v_sold then
    e.listing_sold_out := v_sold; ch := array_append(ch, 'sold_out');
  end if;
  if v_url is not null and not ('ticket_url' = any (v_skip)) and e.ticket_url is distinct from v_url then
    e.ticket_url := v_url; e.ig_url := v_url; ch := array_append(ch, 'ticket_url');
  end if;
  if v_fly is not null and not ('flyer_url' = any (v_skip)) and e.flyer_url is distinct from v_fly then
    e.flyer_url := v_fly; ch := array_append(ch, 'flyer_url');
  end if;
  -- A rerun fills these when the source says something; it never blanks them (staff can, by editing the row).
  if v_plat is not null and not ('ticket_platform' = any (v_skip)) and e.ticket_platform is distinct from v_plat then
    e.ticket_platform := v_plat; ch := array_append(ch, 'ticket_platform');
  end if;
  if v_src is not null and not ('source_url' = any (v_skip)) and e.source_url is distinct from v_src then
    e.source_url := v_src; ch := array_append(ch, 'source_url');
  end if;
  if v_cred is not null and not ('flyer_credit' = any (v_skip)) and e.flyer_credit is distinct from v_cred then
    e.flyer_credit := v_cred; ch := array_append(ch, 'flyer_credit');
  end if;

  if p_all then
    -- Staff approved or edited the row: the organiser's public handles follow it (blank clears them).
    if e.organiser_name is distinct from v_oname then e.organiser_name := v_oname; ch := array_append(ch, 'organiser_name'); end if;
    if e.organiser_ig is distinct from v_oig then e.organiser_ig := v_oig; ch := array_append(ch, 'organiser_ig'); end if;
    if e.organiser_x is distinct from v_ox then e.organiser_x := v_ox; ch := array_append(ch, 'organiser_x'); end if;
    if not ('ticket_platform' = any (v_skip)) and e.ticket_platform is distinct from v_plat and v_plat is null and (f ? 'ticket_platform') then
      e.ticket_platform := null; ch := array_append(ch, 'ticket_platform');
    end if;
    if e.flyer_credit is distinct from v_cred and v_cred is null and (f ? 'flyer_credit') then
      e.flyer_credit := null; ch := array_append(ch, 'flyer_credit');
    end if;
    if v_name is not null and char_length(v_name) >= 2 and e.title is distinct from v_name then e.title := v_name; ch := array_append(ch, 'name'); end if;
    if e.venue_name is distinct from coalesce(case when char_length(v_venue) between 2 and 120 then v_venue end, 'To be announced') then
      e.venue_name := coalesce(case when char_length(v_venue) between 2 and 120 then v_venue end, 'To be announced'); ch := array_append(ch, 'venue');
    end if;
    if jsonb_typeof(f -> 'lat') = 'number' and jsonb_typeof(f -> 'lng') = 'number' then
      v_lat := (f ->> 'lat')::double precision; v_lng := (f ->> 'lng')::double precision;
      if public._ev_o_in_lagos(v_lat, v_lng) and (e.geog is null or st_y(e.geog::geometry) is distinct from v_lat or st_x(e.geog::geometry) is distinct from v_lng) then
        e.geog := st_point(v_lng, v_lat)::geography; ch := array_append(ch, 'pin');
      end if;
    end if;
    if v_area is not null and exists (select 1 from public.areas a where a.name = v_area) and e.area is distinct from v_area then
      e.area := v_area; ch := array_append(ch, 'area');
    end if;
    if e.description is distinct from left(btrim(coalesce(f ->> 'description', '')), 2000) then
      e.description := left(btrim(coalesce(f ->> 'description', '')), 2000); ch := array_append(ch, 'description');
    end if;
    v_vibe := public._ev_o_vibe(f ->> 'category');
    if (f ->> 'category') is not null and e.vibe is distinct from v_vibe then e.vibe := v_vibe; ch := array_append(ch, 'vibe'); end if;
    if v_ig is not null and e.instagram_url is distinct from 'https://www.instagram.com/' || v_ig || '/' then
      e.instagram_url := 'https://www.instagram.com/' || v_ig || '/'; ch := array_append(ch, 'instagram_url');
      if e.ticket_url is null then e.ig_url := e.instagram_url; end if;
    end if;
  end if;

  if cardinality(ch) > 0 then
    update public.events
       set starts_at = e.starts_at, ends_at = e.ends_at, listed_price = e.listed_price, listed_price_max = e.listed_price_max,
           listing_sold_out = e.listing_sold_out, ticket_url = e.ticket_url, ig_url = e.ig_url, flyer_url = e.flyer_url,
           title = e.title, venue_name = e.venue_name, geog = e.geog, area = e.area, description = e.description,
           vibe = e.vibe, instagram_url = e.instagram_url,
           ticket_platform = e.ticket_platform, source_url = e.source_url, flyer_credit = e.flyer_credit,
           organiser_name = e.organiser_name, organiser_ig = e.organiser_ig, organiser_x = e.organiser_x
     where id = p_event;
  end if;
  return ch;
end $$;

-- Creates the live listing with the new columns.
create or replace function public._ev_o_event_create(p_org uuid, p_fields jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f       jsonb := p_fields;
  o       public.ev_organisers;
  v_room  uuid;
  v_host  uuid;
  v_lu    uuid := public._ev_listings_uid();
  v_start timestamptz := public._ev_try_ts(f ->> 'starts_at');
  v_end   timestamptz := public._ev_try_ts(f ->> 'ends_at');
  v_venue text := public._ev_o_txt(f ->> 'venue', 120);
  v_area  text := public._ev_o_txt(f ->> 'area', 60);
  v_lat   double precision;
  v_lng   double precision;
  v_geog  geography;
  v_ig    text := coalesce(public._ev_o_handle(f ->> 'event_handle'), public._ev_o_handle(f ->> 'organiser_handle'));
  v_igurl text;
  v_url   text := public._ev_o_url(f ->> 'ticket_url');
  v_slug  text;
  v_id    uuid;
begin
  select * into o from public.ev_organisers where id = p_org;
  v_room := public.ev_o_ensure_room(p_org);
  -- An organiser who has claimed: the room's owner hosts. Otherwise the Listings account does.
  v_host := v_lu;
  if o.stage = 'claimed' then
    v_host := coalesce((select m.user_id from public.crew_members m where m.crew_id = v_room and m.role = 'owner' order by m.joined_at limit 1), o.claimed_by, v_lu);
  end if;

  if jsonb_typeof(f -> 'lat') = 'number' and jsonb_typeof(f -> 'lng') = 'number' then
    v_lat := (f ->> 'lat')::double precision; v_lng := (f ->> 'lng')::double precision;
    if public._ev_o_in_lagos(v_lat, v_lng) then
      v_geog := st_point(v_lng, v_lat)::geography;
      if v_area is null or not exists (select 1 from public.areas a where a.name = v_area) then
        select a.name into v_area from public.areas a order by st_distance(a.centroid, v_geog) limit 1;
      end if;
    end if;
  end if;
  if v_area is not null and not exists (select 1 from public.areas a where a.name = v_area) then v_area := null; end if;
  v_igurl := case when v_ig is null then null else 'https://www.instagram.com/' || v_ig || '/' end;

  v_slug := public._ev_slug(f ->> 'name');
  while exists (select 1 from public.events x where x.slug = v_slug) loop
    v_slug := public._ev_slug(f ->> 'name');
  end loop;

  insert into public.events (title, venue_name, area, geog, starts_at, ends_at, vibe, source, ig_url, flyer_url, status,
                             created_by, host_id, room_id, description, kind, visibility, slug,
                             ticket_mode, ticket_url, instagram_url, listed_price, listed_price_max, listing_sold_out,
                             source_site, source_id, organiser_id,
                             ticket_platform, source_url, flyer_credit, organiser_name, organiser_ig, organiser_x)
  values (f ->> 'name',
          coalesce(case when char_length(v_venue) between 2 and 120 then v_venue end, 'To be announced'),
          v_area, v_geog, v_start, v_end, public._ev_o_vibe(f ->> 'category'), 'partner', coalesce(v_url, v_igurl),
          public._ev_o_url(f ->> 'flyer_url'), 'live',
          v_host, v_host, v_room, left(btrim(coalesce(f ->> 'description', '')), 2000), 'in_person', 'public', v_slug,
          'external', v_url, v_igurl, public._ev_o_price_min(f -> 'tickets'), public._ev_o_price_max(f -> 'tickets'), public._ev_o_sold_out(f),
          f ->> 'source_site', f ->> 'source_id', p_org,
          public._ev_o_plain(f ->> 'ticket_platform', 40), public._ev_o_url(f ->> 'source_url'), public._ev_o_plain(f ->> 'flyer_credit', 80),
          coalesce(public._ev_o_plain(f ->> 'organiser_name', 120), o.name), coalesce(public._ev_o_handle(f ->> 'organiser_handle'), o.ig_handle),
          public._ev_o_xhandle(f ->> 'organiser_x'))
  returning id into v_id;
  -- The insert trigger would make a non-staff session's row pending and 'hopper'; the service role is trusted, but never rely on it.
  update public.events set status = 'live', source = 'partner' where id = v_id and (status <> 'live' or source <> 'partner');
  return v_id;
end $$;

-- ------------------------------------------------------------ replaced: the public read ---
-- One call for the screens: { "<event id>": { ticket_url, instagram_url, price_from, price_to, sold_out, source_site, claimed, organiser_name,
-- ticket_platform, flyer_credit, organiser_ig, organiser_x } }. source_url is for staff and is not given here.
create or replace function public.ev_listings() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
           'ticket_url', e.ticket_url, 'instagram_url', e.instagram_url,
           'price_from', e.listed_price, 'price_to', e.listed_price_max, 'sold_out', e.listing_sold_out,
           'source_site', e.source_site,
           'claimed', e.host_id is not null and e.host_id is distinct from public._ev_listings_uid(),
           'organiser_name', coalesce(o.name, e.organiser_name),
           'ticket_platform', e.ticket_platform, 'flyer_credit', e.flyer_credit,
           'organiser_ig', coalesce(e.organiser_ig, o.ig_handle), 'organiser_x', e.organiser_x)), '{}'::jsonb)
    from public.events e
    left join public.ev_organisers o on o.id = e.organiser_id
   where e.ticket_mode = 'external' and e.status in ('live', 'unlisted', 'cancelled', 'ended') and e.visibility = 'public';
$$;
revoke all on function public.ev_listings() from public;
grant execute on function public.ev_listings() to anon, authenticated, service_role;

-- ================================================================== C: claim an event ===
-- The switch. Starts OFF; a re-run never flips it. Only you set it: select public.ev_set_claims('on');
insert into public.ev_settings (key, value) values ('event_claims', 'off') on conflict (key) do nothing;

create or replace function public._ev_claims_on() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.value = 'on' from public.ev_settings s where s.key = 'event_claims'), false);
$$;
revoke all on function public._ev_claims_on() from public, anon, authenticated;

-- A separate setter, so the shared ev_set_setting (a function other files and branches also touch) is left alone. Service role only.
create or replace function public.ev_set_claims(p_value text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_value is null or p_value not in ('on', 'off') then return 'bad_value'; end if;
  insert into public.ev_settings (key, value) values ('event_claims', p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return 'ok';
end $$;
revoke all on function public.ev_set_claims(text) from public, anon, authenticated;
grant execute on function public.ev_set_claims(text) to service_role;

-- One-time claim links. No email: whoever opens it and signs in gets the room. Only the hash of the token is stored.
create table if not exists public.ev_claim_links (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.crews(id) on delete cascade,
  organiser_id uuid references public.ev_organisers(id) on delete set null,
  event_id     uuid references public.events(id) on delete set null,     -- the listing it was made from, if any
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status       text not null default 'pending' check (status in ('pending', 'used', 'revoked')),
  created_by   text check (created_by is null or char_length(created_by) <= 60),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_by      uuid references public.profiles(id) on delete set null,
  used_at      timestamptz,
  revoked_at   timestamptz
);
create index if not exists ev_claim_links_room_idx on public.ev_claim_links (room_id, status);
create index if not exists ev_claim_links_org_idx on public.ev_claim_links (organiser_id, created_at desc);

-- "Is this your event? Claim it" from a signed in person without a link. Their name is the one on their account; no email, no phone.
create table if not exists public.ev_claim_asks (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  organiser_id uuid references public.ev_organisers(id) on delete set null,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  note         text not null default '' check (char_length(note) <= 500),
  status       text not null default 'new' check (status in ('new', 'approved', 'declined')),
  decided_by   text check (decided_by is null or char_length(decided_by) <= 60),
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists ev_claim_asks_open_uq on public.ev_claim_asks (event_id, user_id) where status = 'new';
create index if not exists ev_claim_asks_idx on public.ev_claim_asks (status, created_at desc);
create index if not exists ev_claim_asks_user_idx on public.ev_claim_asks (user_id, created_at desc);

-- Wrong or used claim links, per person, for the rate limit (10 an hour).
create table if not exists public.ev_claim_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists ev_claim_attempts_idx on public.ev_claim_attempts (user_id, at desc);

-- Outside ticket taps: one row per event, Lagos day and person or device. Nothing else is kept (no name, no address).
create table if not exists public.ev_ticket_taps (
  event_id uuid not null references public.events(id) on delete cascade,
  day      date not null,
  who      text not null check (char_length(who) between 3 and 80),
  primary key (event_id, day, who)
);
create index if not exists ev_ticket_taps_who_idx on public.ev_ticket_taps (who, day);

do $$
declare t text;
begin
  foreach t in array array['ev_claim_links', 'ev_claim_asks', 'ev_claim_attempts', 'ev_ticket_taps'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- the hand over ---
-- The room and its upcoming events go to p_to. The same steps as ev_transfer_accept, with nobody's email checked:
--   owner set; the previous owner goes (Hoppaz Listings leaves, a person stays a plain member); upcoming events of the previous owner get p_to as host;
--   crews.created_by follows; a dormant (invite) room Hoppaz Listings held opens; the organiser is claimed; every other open email link and claim
--   link of the room is cancelled; every other open ask about an event of the room is declined; the log gets lines.
-- The caller has locked the room and checked the right to do this. Answers { moved, slug, other, revoked }, or { ok: false, reason: 'paid_sales' }.
create or replace function public._ev_cl_handover(p_room uuid, p_to uuid, p_org uuid, p_how text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_prev   uuid := public._ev_xf_owner(p_room);
  v_list   uuid := public._ev_listings_uid();
  v_paid   integer := 0;
  v_moved  integer := 0;
  v_revoked integer := 0;
  v_other  boolean;
  v_slug   text;
  v_name   text := public._ev_person_name(p_to);
begin
  if v_prev is distinct from p_to and to_regclass('public.ev_orders') is not null then
    execute 'select count(*) from public.ev_orders o join public._ev_xf_moving($1, $2) m on m.id = o.event_id where o.status in (''paid'', ''refund_pending'')'
       into v_paid using p_room, v_prev;
    if v_paid > 0 then return jsonb_build_object('ok', false, 'reason', 'paid_sales'); end if;
  end if;
  v_other := exists (select 1 from public.crew_members m where m.user_id = p_to and m.role = 'owner' and m.crew_id <> p_room and not public._ev_is_hq(m.crew_id));

  insert into public.crew_members (crew_id, user_id, role) values (p_room, p_to, 'owner')
  on conflict (crew_id, user_id) do update set role = 'owner';
  if v_prev is not null and v_prev <> p_to then
    if v_prev = v_list then
      delete from public.crew_members where crew_id = p_room and user_id = v_prev;
    else
      update public.crew_members set role = 'member' where crew_id = p_room and user_id = v_prev;
    end if;
    update public.events e set host_id = p_to where e.id in (select m.id from public._ev_xf_moving(p_room, v_prev) m);
    get diagnostics v_moved = row_count;
  end if;
  update public.crews set created_by = p_to where id = p_room;
  if v_prev is not null and v_prev = v_list and public._ev_join_mode(p_room) = 'invite' then
    insert into public.ev_room_profiles (crew_id, slug, join_mode, updated_by) values (p_room, p_room::text, 'open', p_to)
    on conflict (crew_id) do update set join_mode = 'open', updated_by = p_to, updated_at = now();
    update public.crews set visibility = 'open' where id = p_room;
  end if;
  v_slug := coalesce((select p.slug from public.ev_room_profiles p where p.crew_id = p_room), p_room::text);

  if p_org is not null then
    update public.ev_organisers
       set stage = 'claimed', claimed_at = now(), claimed_by = p_to, do_not_contact = false, declined_at = null, updated_at = now()
     where id = p_org;
  end if;

  update public.ev_transfers set status = 'revoked', revoked_at = now() where room_id = p_room and status = 'pending';
  get diagnostics v_revoked = row_count;
  update public.ev_claim_links set status = 'revoked', revoked_at = now() where room_id = p_room and status = 'pending';
  update public.ev_claim_asks a set status = 'declined', decided_by = 'system', decided_at = now()
   where a.status = 'new' and a.user_id <> p_to and exists (select 1 from public.events e where e.id = a.event_id and e.room_id = p_room);

  perform public._ev_xf_log(p_org, 'system', 'Claimed by ' || v_name || ' (' || p_how || '). ' || v_moved || ' upcoming events moved.');
  return jsonb_build_object('ok', true, 'moved', v_moved, 'slug', v_slug, 'other', v_other, 'revoked', v_revoked);
end $$;
revoke all on function public._ev_cl_handover(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------- staff: make and cancel a link ---
-- Service role. p_org or p_event (one of them): a listing row gives its organiser. The caller made the token and passes its sha256.
create or replace function public.ev_o_claim_link_create(p_org uuid, p_event uuid, p_hash text, p_by text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  e       public.events;
  o       public.ev_organisers;
  v_org   uuid := p_org;
  v_hash  text := public._ev_xf_hash(p_hash);
  v_by    text := public._ev_xf_by(p_by);
  v_room  uuid;
  l       public.ev_claim_links;
  v_title text;
begin
  if not public._ev_claims_on() then return jsonb_build_object('ok', false, 'reason', 'not_on'); end if;
  if v_hash is null then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;
  if p_event is not null then
    select * into e from public.events where id = p_event;
    if not found or e.ticket_mode <> 'external' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    v_org := e.organiser_id;
    v_title := e.title;
    if e.host_id is not null and e.host_id is distinct from public._ev_listings_uid() then return jsonb_build_object('ok', false, 'reason', 'is_claimed'); end if;
  end if;
  select * into o from public.ev_organisers where id = v_org for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.stage = 'declined' or o.do_not_contact then return jsonb_build_object('ok', false, 'reason', 'organiser_declined'); end if;
  if o.stage = 'claimed' then return jsonb_build_object('ok', false, 'reason', 'is_claimed'); end if;
  v_room := o.room_id;
  if v_room is null or not exists (select 1 from public.crews c where c.id = v_room) then v_room := public.ev_o_ensure_room(v_org); end if;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (select count(*) from public.ev_claim_links x where x.room_id = v_room and x.status = 'pending' and x.expires_at > now()) >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'try_again_later');
  end if;
  insert into public.ev_claim_links (room_id, organiser_id, event_id, token_hash, created_by, expires_at)
  values (v_room, v_org, p_event, v_hash, v_by, now() + interval '14 days')
  returning * into l;
  if o.stage in ('pulled', 'listed') then
    update public.ev_organisers set stage = 'offered', updated_at = now() where id = v_org;
    perform public._ev_o_log(v_org, v_by, 'offer', null, 'Stage: offered');
  end if;
  perform public._ev_xf_log(v_org, v_by, 'Claim link made' || coalesce(' for ' || v_title, '') || ', open for 14 days.');
  return jsonb_build_object('ok', true, 'link', public._ev_cl_json(l));
exception
  when unique_violation then return jsonb_build_object('ok', false, 'reason', 'invalid_link');
end $$;
revoke all on function public.ev_o_claim_link_create(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.ev_o_claim_link_create(uuid, uuid, text, text) to service_role;

-- A claim link as the desk reads it (ClaimLink in src/lib/events-r1/types.ts). Never the hash. A pending link past its time reads expired.
create or replace function public._ev_cl_json(l public.ev_claim_links) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', l.id, 'room_id', l.room_id, 'room_name', coalesce((select c.name from public.crews c where c.id = l.room_id), ''),
    'organiser_id', l.organiser_id, 'event_id', l.event_id,
    'status', case when l.status = 'pending' and l.expires_at <= now() then 'expired' else l.status end,
    'created_at', l.created_at, 'created_by', l.created_by, 'expires_at', l.expires_at, 'used_at', l.used_at);
$$;
revoke all on function public._ev_cl_json(public.ev_claim_links) from public, anon, authenticated;

create or replace function public.ev_o_claim_link_revoke(p_id uuid, p_by text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare l public.ev_claim_links; v_by text := public._ev_xf_by(p_by);
begin
  if not public._ev_claims_on() then return jsonb_build_object('ok', false, 'reason', 'not_on'); end if;
  select * into l from public.ev_claim_links where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if l.status = 'used' then return jsonb_build_object('ok', false, 'reason', 'link_used'); end if;
  if l.status = 'revoked' then return jsonb_build_object('ok', false, 'reason', 'link_revoked'); end if;
  if l.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'link_expired'); end if;
  update public.ev_claim_links set status = 'revoked', revoked_at = now() where id = l.id returning * into l;
  perform public._ev_xf_log(l.organiser_id, v_by, 'Claim link cancelled.');
  return jsonb_build_object('ok', true, 'link', public._ev_cl_json(l));
end $$;
revoke all on function public.ev_o_claim_link_revoke(uuid, text) from public, anon, authenticated;
grant execute on function public.ev_o_claim_link_revoke(uuid, text) to service_role;

-- The claim links of one organiser, newest first.
create or replace function public.ev_o_claim_links(p_org uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(public._ev_cl_json(l) order by l.created_at desc, l.id), '[]'::jsonb) from public.ev_claim_links l where l.organiser_id = p_org;
$$;
revoke all on function public.ev_o_claim_links(uuid) from public, anon, authenticated;
grant execute on function public.ev_o_claim_links(uuid) to service_role;

-- ------------------------------------------------------------ the link preview ---
-- For the claim page, signed in or not. A hash that is not a claim link answers not_found (the app then tries it as an email link).
create or replace function public.ev_claim_link_preview(p_hash text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_hash text := public._ev_xf_hash(p_hash);
  l      public.ev_claim_links;
  c      public.crews;
  p      public.ev_room_profiles;
begin
  if not public._ev_claims_on() or v_hash is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into l from public.ev_claim_links where token_hash = v_hash;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if l.status = 'revoked' then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if l.status = 'used' then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if l.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  select * into c from public.crews where id = l.room_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into p from public.ev_room_profiles where crew_id = l.room_id;
  return jsonb_build_object(
    'ok', true, 'kind', 'link',
    'room', jsonb_build_object('name', c.name, 'slug', coalesce(p.slug, c.id::text), 'logo_url', c.logo_url, 'about', coalesce(p.about, '')),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'starts_at', m.starts_at) order by m.starts_at, m.id)
                          from (select * from public._ev_xf_moving(l.room_id, public._ev_xf_owner(l.room_id)) order by starts_at, id limit 50) m), '[]'::jsonb),
    'email_hint', null,
    'organiser_name', (select o.name from public.ev_organisers o where o.id = l.organiser_id),
    'expires_at', l.expires_at);
end $$;
revoke all on function public.ev_claim_link_preview(text) from public;
grant execute on function public.ev_claim_link_preview(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------------- the accept ---
-- The signed in person becomes the owner. No email check, no review. Works once. A wrong or used link counts as a try:
-- 10 tries an hour per person, then try_again_later. A hash that is not a claim link answers invalid_link (and counts).
create or replace function public.ev_claim_link_accept(p_hash text) returns jsonb
language plpgsql volatile security definer set search_path = public, auth, pg_temp as $$
declare
  me     uuid := auth.uid();
  v_hash text := public._ev_xf_hash(p_hash);
  l      public.ev_claim_links;
  v_room uuid;
  v_h    jsonb;
  v_reason text;
begin
  if not public._ev_open() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if not public._ev_claims_on() then return jsonb_build_object('ok', false, 'reason', 'not_on'); end if;
  if me is null or not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  if (select count(*) from public.ev_claim_attempts a where a.user_id = me and a.at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'try_again_later');
  end if;
  delete from public.ev_claim_attempts where at < now() - interval '1 day';

  select x.room_id into v_room from public.ev_claim_links x where x.token_hash = v_hash;
  if v_room is null then
    insert into public.ev_claim_attempts (user_id) values (me);
    return jsonb_build_object('ok', false, 'reason', 'invalid_link');
  end if;
  -- Lock order like the email accept: the room first, then the link.
  perform 1 from public.crews where id = v_room for update;
  select * into l from public.ev_claim_links where token_hash = v_hash for update;
  v_reason := case when l.status = 'used' then 'link_used' when l.status = 'revoked' then 'link_revoked' when l.expires_at <= now() then 'link_expired' end;
  if v_reason is not null then
    insert into public.ev_claim_attempts (user_id) values (me);
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  if public._ev_is_hq(v_room) then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;

  v_h := public._ev_cl_handover(v_room, me, l.organiser_id, 'claim link');
  if (v_h ->> 'ok') is distinct from 'true' then return v_h; end if;
  update public.ev_claim_links set status = 'used', used_by = me, used_at = now() where id = l.id;
  return jsonb_build_object('ok', true, 'room_id', v_room, 'slug', v_h ->> 'slug', 'moved_events', (v_h ->> 'moved')::int,
                            'already_owned_other', (v_h ->> 'other')::boolean);
end $$;
revoke all on function public.ev_claim_link_accept(text) from public, anon;
grant execute on function public.ev_claim_link_accept(text) to authenticated;

-- ------------------------------------------------------------------- the ask ---
-- From the event page, signed in. { ok: true } for a new ask and for a repeat. 3 a day each and 300 a day overall: try_again_later.
create or replace function public.ev_claim_ask(p_event uuid, p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me      uuid := auth.uid();
  e       public.events;
  v_note  text := btrim(coalesce(p_note, ''));
begin
  if not public._ev_open() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if not public._ev_claims_on() then return jsonb_build_object('ok', false, 'reason', 'not_on'); end if;
  if me is null or not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  if char_length(v_note) > 500 then return jsonb_build_object('ok', false, 'reason', 'bad_note'); end if;
  select * into e from public.events where id = p_event;
  if not found or e.ticket_mode <> 'external' or e.visibility <> 'public' or e.status not in ('live', 'unlisted') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if e.host_id is not null and e.host_id is distinct from public._ev_listings_uid() then return jsonb_build_object('ok', false, 'reason', 'is_claimed'); end if;

  perform pg_advisory_xact_lock(hashtext('ev_claim_ask:' || me::text));
  if exists (select 1 from public.ev_claim_asks a where a.event_id = p_event and a.user_id = me and a.status = 'new') then
    return jsonb_build_object('ok', true);
  end if;
  if (select count(*) from public.ev_claim_asks a where a.user_id = me and a.created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.ev_claim_asks a where a.created_at > now() - interval '1 day') >= 300 then
    return jsonb_build_object('ok', false, 'reason', 'try_again_later');
  end if;
  insert into public.ev_claim_asks (event_id, organiser_id, user_id, note) values (p_event, e.organiser_id, me, v_note)
  on conflict (event_id, user_id) where status = 'new' do nothing;
  if e.organiser_id is not null then
    insert into public.ev_organiser_log (organiser_id, by_name, kind, body)
    values (e.organiser_id, left(public._ev_person_name(me), 60), 'claim_request', left('Asked to claim "' || e.title || '".', 2000));
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ev_claim_ask(uuid, text) from public, anon;
grant execute on function public.ev_claim_ask(uuid, text) to authenticated;

-- --------------------------------------------------------- staff: asks and the list ---
-- Asks, newest first: ClaimAsk in src/lib/events-r1/types.ts. The name is the one on their account.
create or replace function public.ev_o_claim_asks() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'event_id', a.event_id, 'event_title', e.title, 'organiser_id', a.organiser_id,
    'organiser_name', (select o.name from public.ev_organisers o where o.id = a.organiser_id),
    'name', public._ev_person_name(a.user_id), 'note', a.note, 'status', a.status, 'created_at', a.created_at, 'decided_by', a.decided_by)
    order by a.created_at desc, a.id), '[]'::jsonb)
    from public.ev_claim_asks a join public.events e on e.id = a.event_id
   where public._ev_claims_on();
$$;
revoke all on function public.ev_o_claim_asks() from public, anon, authenticated;
grant execute on function public.ev_o_claim_asks() to service_role;

-- Approve: the room and its upcoming events go to the asker now. Decline: nothing changes. Answers { ok, moved_events }.
create or replace function public.ev_o_claim_ask_decide(p_id uuid, p_approve boolean, p_by text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  a      public.ev_claim_asks;
  e      public.events;
  o      public.ev_organisers;
  v_by   text := public._ev_xf_by(p_by);
  v_room uuid;
  v_h    jsonb;
begin
  if not public._ev_claims_on() then return jsonb_build_object('ok', false, 'reason', 'not_on'); end if;
  select * into a from public.ev_claim_asks where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if a.status <> 'new' then return jsonb_build_object('ok', false, 'reason', 'already_handled'); end if;
  select * into e from public.events where id = a.event_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if not coalesce(p_approve, false) then
    update public.ev_claim_asks set status = 'declined', decided_by = v_by, decided_at = now() where id = a.id;
    perform public._ev_xf_log(a.organiser_id, v_by, 'Declined the ask from ' || public._ev_person_name(a.user_id) || ' about ' || e.title || '.');
    return jsonb_build_object('ok', true, 'moved_events', 0);
  end if;

  select * into o from public.ev_organisers where id = coalesce(a.organiser_id, e.organiser_id) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.stage = 'claimed' or (e.host_id is not null and e.host_id is distinct from public._ev_listings_uid()) then return jsonb_build_object('ok', false, 'reason', 'is_claimed'); end if;
  if o.stage = 'declined' or o.do_not_contact then return jsonb_build_object('ok', false, 'reason', 'organiser_declined'); end if;
  if not exists (select 1 from public.profiles p where p.id = a.user_id) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_room := o.room_id;
  if v_room is null or not exists (select 1 from public.crews c where c.id = v_room) then v_room := public.ev_o_ensure_room(o.id); end if;
  perform 1 from public.crews where id = v_room for update;
  v_h := public._ev_cl_handover(v_room, a.user_id, o.id, 'ask approved by ' || v_by);
  if (v_h ->> 'ok') is distinct from 'true' then return v_h; end if;
  update public.ev_claim_asks set status = 'approved', decided_by = v_by, decided_at = now() where id = a.id;
  return jsonb_build_object('ok', true, 'moved_events', (v_h ->> 'moved')::int);
end $$;
revoke all on function public.ev_o_claim_ask_decide(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.ev_o_claim_ask_decide(uuid, boolean, text) to service_role;

-- Listings Hoppaz hosts that nobody has claimed and that are still to come, soonest first: Claimable in src/lib/events-r1/types.ts.
create or replace function public.ev_o_claimable() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when not public._ev_claims_on() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'event_id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'organiser_id', e.organiser_id,
      'organiser_name', (select o.name from public.ev_organisers o where o.id = e.organiser_id),
      'room_name', (select c.name from public.crews c where c.id = e.room_id),
      'went_to_buy', (select count(distinct t.who) from public.ev_ticket_taps t where t.event_id = e.id)::int,
      'link_open', exists (select 1 from public.ev_claim_links l where l.room_id = e.room_id and l.status = 'pending' and l.expires_at > now()),
      'asks', (select count(*) from public.ev_claim_asks a where a.event_id = e.id and a.status = 'new')::int)
      order by e.starts_at, e.id)
    from public.events e
   where e.ticket_mode = 'external' and e.status in ('live', 'unlisted') and e.visibility = 'public'
     and e.host_id is not distinct from public._ev_listings_uid()
     and coalesce(e.ends_at, e.starts_at + interval '3 hours') > now()), '[]'::jsonb) end;
$$;
revoke all on function public.ev_o_claimable() from public, anon, authenticated;
grant execute on function public.ev_o_claimable() to service_role;

-- ================================================================== D: outside ticket taps ===
-- One tap on the outside ticket button. Anyone, signed in or not. A signed in person (or the app's guest session) is counted by account;
-- otherwise by the device id the browser made (8 to 64 letters, digits, - and _). Once per person or device per Lagos day. At most 100
-- different events a day per person or device, so one script cannot fill the table. Answers { ok: true } always for a listing; a refusal is
-- { ok: false, reason } and the app ignores it.
create or replace function public.ev_ticket_tap(p_event uuid, p_device text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me     uuid := auth.uid();
  v_who  text;
  v_day  date := (now() at time zone 'Africa/Lagos')::date;
  v_dev  text := btrim(coalesce(p_device, ''));
begin
  if me is not null then v_who := 'u:' || me::text;
  elsif v_dev ~ '^[A-Za-z0-9_-]{8,64}$' then v_who := 'd:' || v_dev;
  else return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if not exists (select 1 from public.events e where e.id = p_event and e.ticket_mode = 'external' and e.visibility = 'public' and e.status in ('live', 'unlisted')) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if (select count(*) from public.ev_ticket_taps t where t.who = v_who and t.day = v_day) >= 100 then
    return jsonb_build_object('ok', false, 'reason', 'try_again_later');
  end if;
  insert into public.ev_ticket_taps (event_id, day, who) values (p_event, v_day, v_who) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ev_ticket_tap(uuid, text) from public;
grant execute on function public.ev_ticket_tap(uuid, text) to anon, authenticated, service_role;

-- "[N] people went to buy": distinct people and devices who tapped, all days. Whoever manages the event (the host, a room owner or admin, staff).
create or replace function public.ev_ticket_tap_count(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  if not public._ev_manage(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  return jsonb_build_object('ok', true, 'count', (select count(distinct t.who) from public.ev_ticket_taps t where t.event_id = p_event)::int);
end $$;
revoke all on function public.ev_ticket_tap_count(uuid) from public, anon;
grant execute on function public.ev_ticket_tap_count(uuid) to authenticated;

-- Staff: the same by event and by organiser (distinct across that organiser's events). TapCounts in src/lib/events-r1/types.ts.
create or replace function public.ev_o_tap_counts() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'events', coalesce((select jsonb_object_agg(x.event_id, x.n) from (select t.event_id, count(distinct t.who)::int as n from public.ev_ticket_taps t group by t.event_id) x), '{}'::jsonb),
    'organisers', coalesce((select jsonb_object_agg(y.organiser_id, y.n) from (
        select e.organiser_id, count(distinct t.who)::int as n from public.ev_ticket_taps t join public.events e on e.id = t.event_id
         where e.organiser_id is not null group by e.organiser_id) y), '{}'::jsonb));
$$;
revoke all on function public.ev_o_tap_counts() from public, anon, authenticated;
grant execute on function public.ev_o_tap_counts() to service_role;

-- ================================================================== bulk approve ===
-- Up to 100 pulled rows. Each is approved on its own (ev_o_approve) inside its own sub-transaction: one that cannot be approved is skipped with
-- its reason (no_time, bad_name, blocked, merged, no_organiser, no_listings_account, ...) and the rest still go live. Rows that are already
-- live (already_listed) or were rejected (already_handled) are skipped too: a live row's changes are accepted one at a time, where they can be read.
-- Answers { ok, approved: [{ id, event_id }], skipped: [{ id, name, reason }] } in the order asked.
create or replace function public.ev_o_approve_many(p_ids uuid[], p_by text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_ids    uuid[];
  v_id     uuid;
  p        public.ev_pulled;
  r        jsonb;
  v_ok     jsonb := '[]'::jsonb;
  v_skip   jsonb := '[]'::jsonb;
  v_reason text;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return jsonb_build_object('ok', false, 'reason', 'bad_ids'); end if;
  -- distinct, in the order given
  select array_agg(x.id order by x.ord) into v_ids from (select id, min(ord) as ord from unnest(p_ids) with ordinality as u(id, ord) group by id) x;
  if cardinality(v_ids) > 100 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
  foreach v_id in array v_ids loop
    select * into p from public.ev_pulled where id = v_id;
    if not found then
      v_skip := v_skip || jsonb_build_array(jsonb_build_object('id', v_id, 'name', 'Unknown row', 'reason', 'not_found'));
      continue;
    end if;
    v_reason := case when p.status = 'approved' then 'already_listed' when p.status = 'rejected' then 'already_handled' end;
    if v_reason is not null then
      v_skip := v_skip || jsonb_build_array(jsonb_build_object('id', v_id, 'name', p.fields ->> 'name', 'reason', v_reason));
      continue;
    end if;
    begin
      r := public.ev_o_approve(v_id, p_by, null);
    exception when others then
      r := jsonb_build_object('ok', false, 'reason', 'bad_input');
    end;
    if (r ->> 'ok') = 'true' then
      v_ok := v_ok || jsonb_build_array(jsonb_build_object('id', v_id, 'event_id', r ->> 'event_id'));
    else
      v_skip := v_skip || jsonb_build_array(jsonb_build_object('id', v_id, 'name', p.fields ->> 'name', 'reason', coalesce(r ->> 'reason', 'bad_input')));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'approved', v_ok, 'skipped', v_skip);
end $$;
revoke all on function public.ev_o_approve_many(uuid[], text) from public, anon, authenticated;
grant execute on function public.ev_o_approve_many(uuid[], text) to service_role;

notify pgrst, 'reload schema';
commit;
