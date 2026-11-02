-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- File 2 of 3 for the outreach flow (docs/OUTREACH-FLOW.md): the staff desk. Everything here is service role only (the admin route
-- /api/admin/outreach calls it after the HOPPAZ_ADMIN_TOKEN check). Nobody else can run any of it.
--   * the scout's batch: ev_o_import (dry run or apply), ev_o_queue
--   * the review queue: ev_o_approve, ev_o_edit, ev_o_reject, ev_o_merge
--   * the organiser's one dormant room: ev_o_ensure_room
--   * organisers: ev_o_organisers, ev_o_organiser, ev_o_save_organiser, ev_o_log, ev_o_set_stage, ev_o_delete
--   * claim requests and the week: ev_o_claim_requests, ev_o_handle_claim_request, ev_o_week
-- RUN ORDER: after events_r1_listings.sql (tables and columns) and events_r1_room_profile.sql (ev_room_profiles, _ev_slug_from_name),
--   before events_r1_transfer.sql. Safe to run again. It replaces no existing function and edits no existing file.
--
-- ANSWERS. Reads answer the shapes in src/lib/events-r1/types.ts: ev_o_queue a PulledEvent[], ev_o_organisers an Organiser[],
--   ev_o_organiser an OrganiserDetail, ev_o_week a WeekSummary, ev_o_import an ImportReport, ev_o_claim_requests a ClaimRequest[].
--   ev_o_edit answers the PulledEvent, ev_o_save_organiser and ev_o_set_stage answer the Organiser. Every refusal is
--   { ok: false, reason } (ev_o_delete's has_registrations also carries events: [{ title, count }]). Plain writes answer { ok: true }.
--   ev_o_approve answers { ok, event_id, organiser_id }, ev_o_delete { ok, events }.
--   Reasons: not_found, no_listings_account, blocked, no_time, bad_name, no_organiser, bad_patch, bad_batch, too_many, merged,
--   already_listed, same_row, bad_target, confirm_name, is_claimed, has_registrations, handle_taken, bad_handle, bad_email, bad_kind,
--   bad_channel, bad_stage, organiser_declined, bad_input.
--
-- THE LOG. ev_organiser_log lines are how the week is counted (ev_o_week). kind 'contact', 'reply', 'offer' count as they are named.
--   A stage change is kind 'stage' with a body that starts "Stage: listed", "Stage: declined" or "Stage: claimed" (setting the stage to
--   offered is kind 'offer', body "Stage: offered"). events_r1_transfer.sql writes "Stage: claimed" when a link is accepted.
--   New pulled rows and rejections are counted from ev_pulled itself (first_seen_at, decided_at), not from the log.
--
-- THINGS TO KNOW
--   1. Dry run. ev_o_import with p_apply false runs the whole import and rolls it back inside the function (a sub-transaction), so the
--      report is exactly what an apply would say. Nothing is left behind.
--   2. Blocked. An organiser at stage 'declined' or with do_not_contact is blocked. Their pulled rows are status 'blocked' (flag
--      'blocked'); ev_o_approve refuses them. Reopening them (ev_o_set_stage 'listed', or do_not_contact off) frees their blocked rows.
--   3. Hosts. An unclaimed listing is hosted by the Hoppaz Listings account. If the organiser has claimed their room, a new approved event
--      is hosted by the room's owner instead (the same host the transfer gives the upcoming events).
--   4. ev_o_delete also refuses when an order is 'refunded' (a money record, and ev_orders.event_id has no cascade); orders that are
--      expired or failed are removed with the event.
--   5. The pin. A listing with no usable lat and lng has no pin (geog null), also when it has an area. Nothing is guessed.
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.ev_organisers') is null or to_regclass('public.ev_pulled') is null or to_regprocedure('public._ev_listings_uid()') is null then
    raise exception 'events_r1_outreach: run events_r1_listings.sql first';
  end if;
  if to_regclass('public.ev_room_profiles') is null or to_regprocedure('public._ev_slug_from_name(text)') is null then
    raise exception 'events_r1_outreach: run events_r1_room_profile.sql first';
  end if;
end $$;

-- ================================================================== small helpers ===
-- Letters and digits of a name, lower case, accents folded. The key organisers and events are matched on.
create or replace function public._ev_name_key(p_text text) returns text
language sql immutable security definer set search_path = public, pg_temp as $$
  select lower(regexp_replace(normalize(coalesce(p_text, ''), NFKD), '[^a-zA-Z0-9]', '', 'g'));
$$;

-- An Instagram handle from "@name", "name" or a profile link. null when it is not one.
create or replace function public._ev_o_handle(p_text text) returns text
language plpgsql immutable security definer set search_path = public, pg_temp as $$
declare h text := lower(btrim(coalesce(p_text, '')));
begin
  h := regexp_replace(h, '^https?://([a-z0-9-]+\.)*(instagram\.com|instagr\.am)/', '');
  h := regexp_replace(h, '[/?#].*$', '');
  h := regexp_replace(h, '^@', '');
  if h ~ '^[a-z0-9._]{1,30}$' then return h; end if;
  return null;
end $$;

create or replace function public._ev_o_email(p_text text) returns text
language sql immutable security definer set search_path = public, pg_temp as $$
  select case when lower(btrim(coalesce(p_text, ''))) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
               and char_length(btrim(p_text)) <= 254 then lower(btrim(p_text)) end;
$$;

create or replace function public._ev_o_url(p_text text) returns text
language sql immutable security definer set search_path = public, pg_temp as $$
  select case when btrim(coalesce(p_text, '')) ~* '^https?://[^[:space:]]+$' and char_length(btrim(p_text)) <= 600 then btrim(p_text) end;
$$;

create or replace function public._ev_o_txt(p_text text, p_len integer) returns text
language sql immutable security definer set search_path = public, pg_temp as $$
  select nullif(left(btrim(coalesce(p_text, '')), p_len), '');
$$;

-- An ISO time in Lagos (UTC+1, no daylight saving), so the same moment always reads the same.
create or replace function public._ev_o_iso(p_ts timestamptz) returns text
language sql immutable security definer set search_path = public, pg_temp as $$
  select case when p_ts is null then null else to_char(p_ts at time zone 'Africa/Lagos', 'YYYY-MM-DD"T"HH24:MI:SS') || '+01:00' end;
$$;

create or replace function public._ev_o_in_lagos(p_lat double precision, p_lng double precision) returns boolean
language sql immutable security definer set search_path = public, pg_temp as $$
  select p_lat is not null and p_lng is not null and p_lat between 6.30 and 6.80 and p_lng between 3.05 and 3.95;
$$;

-- Lowest and highest known ticket price (whole naira), null when none is known. 0 is free.
create or replace function public._ev_o_price_min(p_tickets jsonb) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select min((t ->> 'price_naira')::integer)
    from jsonb_array_elements(case when jsonb_typeof(p_tickets) = 'array' then p_tickets else '[]'::jsonb end) t
   where jsonb_typeof(t -> 'price_naira') = 'number';
$$;
create or replace function public._ev_o_price_max(p_tickets jsonb) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select max((t ->> 'price_naira')::integer)
    from jsonb_array_elements(case when jsonb_typeof(p_tickets) = 'array' then p_tickets else '[]'::jsonb end) t
   where jsonb_typeof(t -> 'price_naira') = 'number';
$$;

-- Sold out at the source: the page says so, or it lists tickets and every one is sold out.
create or replace function public._ev_o_sold_out(f jsonb) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(f ->> 'sold_out', 'false') = 'true'
      or (jsonb_typeof(f -> 'tickets') = 'array' and jsonb_array_length(f -> 'tickets') > 0
          and not exists (select 1 from jsonb_array_elements(f -> 'tickets') t where coalesce(t ->> 'sold_out', 'false') <> 'true'));
$$;

-- One of the app's vibes from the scout's free-text category. Unknown becomes 'culture' (the default of ev_create_event).
create or replace function public._ev_o_vibe(p_category text) returns text
language sql immutable security definer set search_path = public, pg_temp as $$
  select case
    when c ~ 'amapiano' then 'amapiano'
    when c ~ 'afro' then 'afro'
    when c ~ 'techno' then 'techno'
    when c ~ 'rave' then 'rave'
    when c ~ '(live band|live music|band)' then 'live band'
    when c ~ '(comedy|stand.?up)' then 'comedy'
    when c ~ 'beach' then 'beach'
    when c ~ 'rooftop' then 'rooftop'
    when c ~ '(food|dinner|brunch|tasting)' then 'food'
    when c ~ '(tech|startup|founder)' then 'tech'
    else 'culture' end
  from (select lower(coalesce(p_category, '')) as c) x;
$$;

-- Is this organiser blocked (said no, or asked not to be contacted)?
create or replace function public._ev_o_blocked(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_org is not null and exists (select 1 from public.ev_organisers o where o.id = p_org and (o.stage = 'declined' or o.do_not_contact));
$$;

-- Not over yet: not cancelled and the end (or start + 3 hours) is still ahead.
create or replace function public._ev_o_upcoming(p_start timestamptz, p_end timestamptz) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_end, p_start + interval '3 hours') > now();
$$;

create or replace function public._ev_o_log(p_org uuid, p_by text, p_kind text, p_channel text, p_body text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_org is null then return; end if;
  insert into public.ev_organiser_log (organiser_id, by_name, kind, channel, body)
  values (p_org, nullif(left(btrim(coalesce(p_by, '')), 60), ''), p_kind, p_channel, left(coalesce(p_body, ''), 2000));
end $$;

-- ================================================================== the scout's fields ===
-- Cleans one ScoutEvent into the shape stored in ev_pulled.fields. Every key is always there. Raises a plain message
-- when the event cannot be used (no name, a start time that is not a date).
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
    'organiser_email', public._ev_o_email(e ->> 'organiser_email'),
    'organiser_phone', public._ev_o_txt(e ->> 'organiser_phone', 40),
    'lineup', v_lineup, 'capacity', v_cap,
    'last_seen', v_seen, 'confidence', v_conf);
end $$;

-- The flags worked out from the fields alone.
create or replace function public._ev_o_flags(f jsonb) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select array_remove(array[
    case when public._ev_o_price_min(f -> 'tickets') is null then 'no_price' end,
    case when f ->> 'starts_at' is null then 'no_time' end,
    case when jsonb_typeof(f -> 'lat') <> 'number' or jsonb_typeof(f -> 'lng') <> 'number' then 'no_pin' end], null);
$$;

-- Lay a staff patch over the fields. Only the PulledPatch keys count. Answers { fields, edited }. Raises 'bad_patch' on a bad value.
create or replace function public._ev_o_patch(p_fields jsonb, p_edited text[], p_patch jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  k text;
  v_f jsonb := p_fields;
  v_ed text[] := coalesce(p_edited, '{}');
  v_keys text[] := array['name', 'starts_at', 'ends_at', 'venue', 'area', 'lat', 'lng', 'description', 'tickets', 'sold_out',
                         'ticket_url', 'flyer_url', 'category', 'organiser_name', 'organiser_handle'];
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

-- ================================================================== organisers ===
-- Match by Instagram handle, then by name key, then by email. Makes one at stage 'pulled' when none matches and there is something to go on.
create or replace function public._ev_o_resolve(f jsonb, out o_id uuid, out o_new boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h     text := public._ev_o_handle(f ->> 'organiser_handle');
  k     text := public._ev_name_key(f ->> 'organiser_name');
  m     text := public._ev_o_email(f ->> 'organiser_email');
  v_name text;
begin
  o_new := false;
  if h is not null then select o.id into o_id from public.ev_organisers o where o.ig_handle = h; end if;
  if o_id is null and k <> '' then
    select o.id into o_id from public.ev_organisers o
     where o.name_key = k and (o.ig_handle is null or h is null or o.ig_handle = h)
     order by o.created_at, o.id limit 1;
  end if;
  if o_id is null and m is not null then
    select o.id into o_id from public.ev_organisers o where lower(o.email) = m order by o.created_at, o.id limit 1;
  end if;
  if o_id is not null then return; end if;

  v_name := coalesce(public._ev_o_txt(f ->> 'organiser_name', 120), h, public._ev_o_txt(split_part(coalesce(m, ''), '@', 1), 120));
  if v_name is null then return; end if;
  insert into public.ev_organisers (name, name_key, ig_handle, handles, email, phone)
  values (v_name, public._ev_name_key(v_name), h,
          case when h is null then '{}'::jsonb else jsonb_build_object('instagram', h) end,
          m, public._ev_o_txt(f ->> 'organiser_phone', 40))
  returning id into o_id;
  o_new := true;
  perform public._ev_o_log(o_id, null, 'scrape', null, 'Found on ' || coalesce(f ->> 'source_site', 'a ticket site'));
end $$;

-- A matched organiser gets the blanks filled from the scout (never an overwrite).
create or replace function public._ev_o_fill(p_org uuid, f jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h text := public._ev_o_handle(f ->> 'organiser_handle');
  m text := public._ev_o_email(f ->> 'organiser_email');
  p text := public._ev_o_txt(f ->> 'organiser_phone', 40);
begin
  update public.ev_organisers o
     set ig_handle = case when o.ig_handle is null and h is not null and not exists (select 1 from public.ev_organisers x where x.ig_handle = h) then h else o.ig_handle end,
         email = coalesce(o.email, m),
         phone = coalesce(o.phone, p),
         updated_at = now()
   where o.id = p_org
     and ((o.ig_handle is null and h is not null and not exists (select 1 from public.ev_organisers x where x.ig_handle = h))
          or (o.email is null and m is not null) or (o.phone is null and p is not null));
end $$;

-- Block or free the organiser's waiting rows to match the organiser's state.
create or replace function public._ev_o_sync_block(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public._ev_o_blocked(p_org) then
    update public.ev_pulled p set status = 'blocked', flags = array_append(array_remove(p.flags, 'blocked'), 'blocked')
     where p.organiser_id = p_org and p.status = 'new';
  else
    update public.ev_pulled p set status = 'new', flags = array_remove(p.flags, 'blocked')
     where p.organiser_id = p_org and p.status = 'blocked';
  end if;
end $$;

-- The organiser's one room: made on first use, reused for every later event. Owned by the Hoppaz Listings account, join mode 'invite'
-- (dormant, not in Discover). Raises no_listings_account when the account is not set up.
create or replace function public.ev_o_ensure_room(p_org uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o      public.ev_organisers;
  v_lu   uuid := public._ev_listings_uid();
  v_name text;
  v_slug text;
  v_try  integer := 1;
  v_id   uuid;
begin
  select * into o from public.ev_organisers where id = p_org for update;
  if not found then raise exception 'not_found'; end if;
  if o.room_id is not null and exists (select 1 from public.crews c where c.id = o.room_id) then return o.room_id; end if;
  if v_lu is null then raise exception 'no_listings_account'; end if;

  v_name := left(btrim(o.name), 50);
  if char_length(v_name) < 2 then v_name := v_name || ' room'; end if;
  v_slug := public._ev_slug_from_name(v_name);
  while exists (select 1 from public.ev_room_profiles x where x.slug = v_slug) loop
    v_try := v_try + 1;
    v_slug := left(public._ev_slug_from_name(v_name), 36) || '-' || v_try;
  end loop;

  insert into public.crews (name, created_by, visibility) values (v_name, v_lu, 'private') returning id into v_id;
  insert into public.crew_members (crew_id, user_id, role) values (v_id, v_lu, 'owner');
  insert into public.ev_room_profiles (crew_id, slug, about, links, join_mode) values (v_id, v_slug, '', '{}'::jsonb, 'invite');
  update public.ev_organisers set room_id = v_id, updated_at = now() where id = p_org;
  return v_id;
end $$;

-- ================================================================== json shapes ===
create or replace function public._ev_o_org_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', o.id, 'name', o.name, 'ig_handle', o.ig_handle, 'handles', o.handles, 'email', o.email, 'phone', o.phone,
    'room_id', o.room_id,
    'room_slug', (select p.slug from public.ev_room_profiles p where p.crew_id = o.room_id),
    'room_name', (select c.name from public.crews c where c.id = o.room_id),
    'stage', o.stage, 'do_not_contact', o.do_not_contact,
    'last_contacted_at', o.last_contacted_at, 'last_contacted_by', o.last_contacted_by, 'notes', o.notes,
    'claimed_at', o.claimed_at, 'declined_at', o.declined_at, 'created_at', o.created_at,
    'events_total', (select count(*) from public.events e where e.organiser_id = o.id and e.status in ('live', 'unlisted'))::int,
    'events_upcoming', (select count(*) from public.events e
                         where e.organiser_id = o.id and e.status in ('live', 'unlisted')
                           and public._ev_o_upcoming(e.starts_at, e.ends_at))::int,
    'pulled_waiting', (select count(*) from public.ev_pulled p where p.organiser_id = o.id and p.status = 'new')::int,
    'transfer_pending', exists (select 1 from public.ev_transfers t where t.organiser_id = o.id and t.status = 'pending' and t.expires_at > now()),
    'claim_requests', (select count(*) from public.ev_claim_requests r where r.organiser_id = o.id and r.status = 'new')::int)
  from public.ev_organisers o where o.id = p_id;
$$;

create or replace function public._ev_o_pulled_json(p public.ev_pulled) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'source_site', p.source_site, 'source_id', p.source_id, 'status', p.status,
    'flags', to_jsonb(p.flags), 'edited', to_jsonb(p.edited), 'confidence', p.confidence, 'fields', p.fields,
    'organiser_id', p.organiser_id,
    'organiser_name', (select o.name from public.ev_organisers o where o.id = p.organiser_id),
    'organiser_stage', (select o.stage from public.ev_organisers o where o.id = p.organiser_id),
    'event_id', p.event_id, 'duplicate_of', p.duplicate_of, 'also_at', p.also_at,
    'first_seen_at', p.first_seen_at, 'last_seen_at', p.last_seen_at, 'missing_since', p.missing_since);
$$;

-- ================================================================== the listing event ===
-- Lay the fields on an existing listing event. p_all false (a rerun): only price, times, sold out, ticket link and flyer, and never a key
-- in p_skip (what staff edited). p_all true (staff approved or edited it): every field. Answers what changed.
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

  if p_all then
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
           vibe = e.vibe, instagram_url = e.instagram_url
     where id = p_event;
  end if;
  return ch;
end $$;

-- Make the live listing for a pulled row's fields. Answers the new event id. The caller checked the Listings account, the time and the name.
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
                             source_site, source_id, organiser_id)
  values (f ->> 'name',
          coalesce(case when char_length(v_venue) between 2 and 120 then v_venue end, 'To be announced'),
          v_area, v_geog, v_start, v_end, public._ev_o_vibe(f ->> 'category'), 'partner', coalesce(v_url, v_igurl),
          public._ev_o_url(f ->> 'flyer_url'), 'live',
          v_host, v_host, v_room, left(btrim(coalesce(f ->> 'description', '')), 2000), 'in_person', 'public', v_slug,
          'external', v_url, v_igurl, public._ev_o_price_min(f -> 'tickets'), public._ev_o_price_max(f -> 'tickets'), public._ev_o_sold_out(f),
          f ->> 'source_site', f ->> 'source_id', p_org)
  returning id into v_id;
  -- The insert trigger would make a non-staff session's row pending and 'hopper'; the service role is trusted, but never rely on it.
  update public.events set status = 'live', source = 'partner' where id = v_id and (status <> 'live' or source <> 'partner');
  return v_id;
end $$;

-- ================================================================== the scout's batch ===
-- One event of the batch. Answers { action, note, pulled_id, organiser_id, organiser_new }. Raises on a line that cannot be used.
create or replace function public._ev_o_import_one(e jsonb, p_batch jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f        jsonb;
  site     text;
  sid      text;
  old      public.ev_pulled;
  v_found  boolean;
  v_org    uuid;
  v_new    boolean := false;
  v_block  boolean;
  v_status text;
  v_flags  text[];
  v_dup    uuid;
  v_dupev  boolean := false;
  v_key    text;
  v_day    date;
  v_action text;
  v_note   text := '';
  v_id     uuid;
  v_ev     public.events;
  v_claimed boolean;
  v_ch     text[];
  v_lu     uuid := public._ev_listings_uid();
  v_changed boolean;
  v_start  timestamptz;
  v_end    timestamptz;
begin
  if jsonb_typeof(e) <> 'object' then raise exception 'Not an event object'; end if;
  site := public._ev_o_txt(e ->> 'source_site', 40);
  sid := public._ev_o_txt(e ->> 'source_id', 200);
  if site is null or sid is null then raise exception 'No source site or source id'; end if;
  f := public._ev_o_clean_fields(e || jsonb_build_object('source_site', site, 'source_id', sid,
         'last_seen', coalesce(e ->> 'last_seen', p_batch ->> 'scouted_at')));

  select * into old from public.ev_pulled where source_site = site and source_id = sid for update;
  v_found := found;

  if v_found and old.status in ('rejected', 'merged') then
    update public.ev_pulled set last_seen_at = now(), last_run = left(p_batch ->> 'run_id', 80), missing_since = null,
           flags = array_remove(flags, 'gone') where id = old.id;
    return jsonb_build_object('action', 'unchanged', 'note', 'Already ' || old.status, 'pulled_id', old.id, 'organiser_id', old.organiser_id, 'organiser_new', false);
  end if;

  if v_found then f := old.fields || (f - old.edited); end if;

  -- The organiser: the row's own, else matched or made.
  v_org := case when v_found and exists (select 1 from public.ev_organisers x where x.id = old.organiser_id) then old.organiser_id end;
  if v_org is null then
    select r.o_id, r.o_new into v_org, v_new from public._ev_o_resolve(f) r;
  else
    perform public._ev_o_fill(v_org, f);
  end if;
  v_block := public._ev_o_blocked(v_org);

  v_start := public._ev_try_ts(f ->> 'starts_at');
  v_end := public._ev_try_ts(f ->> 'ends_at');

  if v_found and old.status = 'approved' then
    v_status := 'approved';
    v_flags := old.flags;
    select * into v_ev from public.events where id = old.event_id;
    if found then
      v_claimed := v_ev.host_id is not null and v_ev.host_id is distinct from v_lu;
      if v_claimed then
        -- Never touched. Only say it changed.
        if (old.fields - 'last_seen') is distinct from (f - 'last_seen')
           and ((old.fields -> 'starts_at') is distinct from (f -> 'starts_at') or (old.fields -> 'ends_at') is distinct from (f -> 'ends_at')
                or (old.fields -> 'tickets') is distinct from (f -> 'tickets') or (old.fields -> 'sold_out') is distinct from (f -> 'sold_out')
                or (old.fields -> 'ticket_url') is distinct from (f -> 'ticket_url') or (old.fields -> 'flyer_url') is distinct from (f -> 'flyer_url')) then
          v_flags := array_append(array_remove(v_flags, 'changed'), 'changed');
          v_note := 'Claimed: left alone';
        end if;
        f := old.fields;
      else
        v_ch := '{}';
        if v_ev.status in ('live', 'unlisted') and public._ev_o_upcoming(v_ev.starts_at, v_ev.ends_at) then
          v_ch := public._ev_o_event_update(old.event_id, f, false, old.edited);
        end if;
        if 'starts_at' = any (v_ch) then
          v_flags := array_append(array_remove(v_flags, 'moved'), 'moved');
          v_note := 'Start moved';
        elsif cardinality(v_ch) > 0 then
          v_note := 'Listing updated: ' || array_to_string(v_ch, ', ');
        end if;
      end if;
    end if;
    v_flags := array_remove(v_flags, 'gone');
  else
    v_status := case when v_block then 'blocked' else 'new' end;
    v_flags := array(select x from unnest(coalesce(old.flags, '{}')) x where x not in ('duplicate', 'no_price', 'no_time', 'no_pin', 'blocked', 'gone'));
    v_flags := v_flags || public._ev_o_flags(f);
    if v_block then v_flags := array_append(v_flags, 'blocked'); end if;
    -- The same Lagos night and the same name key as another row (or an old event) is probably the same event.
    v_key := public._ev_name_key(f ->> 'name');
    if v_start is not null and v_key <> '' then
      v_day := (v_start at time zone 'Africa/Lagos')::date;
      select p.id into v_dup from public.ev_pulled p
       where p.status not in ('rejected', 'merged') and not (p.source_site = site and p.source_id = sid)
         and public._ev_name_key(p.fields ->> 'name') = v_key
         and (public._ev_try_ts(p.fields ->> 'starts_at') at time zone 'Africa/Lagos')::date = v_day
       order by p.first_seen_at, p.id limit 1;
      if v_dup is null then
        v_dupev := exists (select 1 from public.events x
                            where x.ticket_mode = 'external' and x.status in ('live', 'unlisted')
                              and public._ev_name_key(x.title) = v_key
                              and (x.starts_at at time zone 'Africa/Lagos')::date = v_day
                              and not exists (select 1 from public.ev_pulled pp where pp.event_id = x.id));
      end if;
      if v_dup is not null or v_dupev then v_flags := array_append(v_flags, 'duplicate'); end if;
    end if;
  end if;

  if not v_found then
    insert into public.ev_pulled (source_site, source_id, status, fields, flags, confidence, organiser_id, duplicate_of, last_run)
    values (site, sid, v_status, f, v_flags, f ->> 'confidence', v_org, v_dup, left(p_batch ->> 'run_id', 80))
    returning id into v_id;
    v_action := case when v_status = 'blocked' then 'blocked' else 'new' end;
    v_note := case when v_status = 'blocked' then 'Organiser said no' when v_dup is not null or v_dupev then 'Looks like a duplicate' else '' end;
  else
    v_id := old.id;
    v_changed := (old.fields - 'last_seen') is distinct from (f - 'last_seen')
                 or old.status is distinct from v_status
                 or (select array_agg(x order by x) from unnest(old.flags) x) is distinct from (select array_agg(x order by x) from unnest(v_flags) x)
                 or old.organiser_id is distinct from v_org
                 or old.missing_since is not null
                 or (cardinality(coalesce(v_ch, '{}')) > 0);
    update public.ev_pulled
       set fields = f, status = v_status, flags = v_flags, confidence = f ->> 'confidence', organiser_id = v_org,
           duplicate_of = case when v_status = 'approved' then duplicate_of else v_dup end,
           last_seen_at = now(), last_run = left(p_batch ->> 'run_id', 80), missing_since = null
     where id = old.id;
    v_action := case when v_status = 'blocked' then 'blocked' when v_changed then 'updated' else 'unchanged' end;
    if v_status = 'blocked' then v_note := 'Organiser said no'; end if;
    if v_action = 'updated' and v_note = '' then v_note := 'Details changed'; end if;
  end if;

  return jsonb_build_object('action', v_action, 'note', v_note, 'pulled_id', v_id, 'organiser_id', v_org, 'organiser_new', v_new);
end $$;

-- The whole batch, writing as it goes. ev_o_import rolls it back for a dry run.
create or replace function public._ev_o_import_core(p_batch jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e        jsonb;
  r        jsonb;
  v_lines  jsonb := '[]'::jsonb;
  v_seen   uuid[] := '{}';
  v_total  integer := 0;
  v_new    integer := 0;
  v_upd    integer := 0;
  v_same   integer := 0;
  v_blk    integer := 0;
  v_skip   integer := 0;
  v_gone   integer := 0;
  v_matched uuid[] := '{}';
  v_made   uuid[] := '{}';
  v_sources text[] := '{}';
  v_name   text;
  v_site   text;
  v_sid    text;
  v_pid    uuid;
begin
  if jsonb_typeof(p_batch -> 'sources_covered') = 'array' then
    v_sources := array(select value from jsonb_array_elements_text(p_batch -> 'sources_covered') value);
  end if;
  for e in select value from jsonb_array_elements(p_batch -> 'events') loop
    v_total := v_total + 1;
    v_name := case when jsonb_typeof(e) = 'object' then coalesce(public._ev_o_txt(e ->> 'name', 120), '') else '' end;
    v_site := case when jsonb_typeof(e) = 'object' then coalesce(public._ev_o_txt(e ->> 'source_site', 40), '') else '' end;
    v_sid := case when jsonb_typeof(e) = 'object' then coalesce(public._ev_o_txt(e ->> 'source_id', 200), '') else '' end;
    begin
      r := public._ev_o_import_one(e, p_batch);
      v_pid := (r ->> 'pulled_id')::uuid;
      v_seen := v_seen || v_pid;
      case r ->> 'action'
        when 'new' then v_new := v_new + 1;
        when 'updated' then v_upd := v_upd + 1;
        when 'unchanged' then v_same := v_same + 1;
        when 'blocked' then v_blk := v_blk + 1;
      end case;
      if (r ->> 'organiser_id') is not null then
        if (r ->> 'organiser_new')::boolean then
          if not ((r ->> 'organiser_id')::uuid = any (v_made)) then v_made := v_made || (r ->> 'organiser_id')::uuid; end if;
        elsif not ((r ->> 'organiser_id')::uuid = any (v_matched)) and not ((r ->> 'organiser_id')::uuid = any (v_made)) then
          v_matched := v_matched || (r ->> 'organiser_id')::uuid;
        end if;
      end if;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('source_site', v_site, 'source_id', v_sid, 'name', v_name,
                                                                 'action', r ->> 'action', 'note', r ->> 'note'));
    exception when others then
      v_skip := v_skip + 1;
      -- A skipped line that has a row already is still "seen": it must not be flagged gone.
      select p.id into v_pid from public.ev_pulled p where p.source_site = v_site and p.source_id = v_sid;
      if v_pid is not null then v_seen := v_seen || v_pid; end if;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('source_site', v_site, 'source_id', v_sid, 'name', v_name,
                                                                 'action', 'skipped', 'note', left(sqlerrm, 160)));
    end;
  end loop;

  -- Rows of the sources this run covered, still to come, that the run did not see.
  if cardinality(v_sources) > 0 then
    with gone as (
      update public.ev_pulled p
         set missing_since = now(), flags = array_append(array_remove(p.flags, 'gone'), 'gone')
       where p.source_site = any (v_sources) and p.status in ('new', 'approved', 'blocked') and p.missing_since is null
         and p.id <> all (v_seen)
         and public._ev_try_ts(p.fields ->> 'starts_at') is not null
         and public._ev_o_upcoming(public._ev_try_ts(p.fields ->> 'starts_at'), public._ev_try_ts(p.fields ->> 'ends_at'))
      returning p.id)
    select count(*)::int into v_gone from gone;
  end if;

  return jsonb_build_object('total', v_total, 'new', v_new, 'updated', v_upd, 'unchanged', v_same, 'blocked', v_blk, 'skipped', v_skip,
                            'flagged_gone', v_gone, 'organisers_matched', cardinality(v_matched), 'organisers_new', cardinality(v_made),
                            'lines', v_lines);
end $$;

-- The scout's batch (a ScoutBatch). p_apply false: the same report, nothing written.
create or replace function public.ev_o_import(p_batch jsonb, p_apply boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v        jsonb;
  v_detail text;
begin
  if p_batch is null or jsonb_typeof(p_batch) <> 'object' or jsonb_typeof(p_batch -> 'events') <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'bad_batch');
  end if;
  if jsonb_array_length(p_batch -> 'events') > 500 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ev-o-import', 0));
  if coalesce(p_apply, false) then
    v := public._ev_o_import_core(p_batch);
    return jsonb_build_object('dry_run', false) || v;
  end if;
  begin
    v := public._ev_o_import_core(p_batch);
    raise exception 'dry run' using errcode = 'P0900', detail = v::text;
  exception when sqlstate 'P0900' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('dry_run', true) || v_detail::jsonb;
  end;
end $$;

-- ================================================================== the review queue ===
create or replace function public.ev_o_queue() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(public._ev_o_pulled_json(q) order by q.first_seen_at desc, q.id), '[]'::jsonb)
    from (select * from public.ev_pulled p
           where p.status in ('new', 'blocked') or (p.status = 'approved' and p.flags && array['changed', 'moved', 'gone'])
           order by p.first_seen_at desc, p.id limit 500) q;
$$;

-- Approve: the organiser, their dormant room, and the live listing (or update the one this row already made).
create or replace function public.ev_o_approve(p_pulled uuid, p_by text, p_patch jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p        public.ev_pulled;
  v_lu     uuid := public._ev_listings_uid();
  v_pr     jsonb;
  f        jsonb;
  v_ed     text[];
  v_org    uuid;
  v_orgnew boolean := false;
  v_event  uuid;
  ev       public.events;
  o        public.ev_organisers;
  v_name   text;
begin
  select * into p from public.ev_pulled where id = p_pulled for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p.status = 'merged' then return jsonb_build_object('ok', false, 'reason', 'merged'); end if;
  if p.status = 'blocked' then return jsonb_build_object('ok', false, 'reason', 'blocked'); end if;
  if v_lu is null then return jsonb_build_object('ok', false, 'reason', 'no_listings_account'); end if;

  begin
    v_pr := public._ev_o_patch(p.fields, p.edited, p_patch);
  exception when raise_exception then
    return jsonb_build_object('ok', false, 'reason', 'bad_patch');
  end;
  f := v_pr -> 'fields';
  v_ed := array(select jsonb_array_elements_text(v_pr -> 'edited'));

  if public._ev_try_ts(f ->> 'starts_at') is null then return jsonb_build_object('ok', false, 'reason', 'no_time'); end if;
  v_name := f ->> 'name';
  if char_length(btrim(coalesce(v_name, ''))) < 2 then return jsonb_build_object('ok', false, 'reason', 'bad_name'); end if;

  v_org := p.organiser_id;
  if v_org is null or p_patch ? 'organiser_name' or p_patch ? 'organiser_handle' then
    select r.o_id, r.o_new into v_org, v_orgnew from public._ev_o_resolve(f) r;
  end if;
  if v_org is null then return jsonb_build_object('ok', false, 'reason', 'no_organiser'); end if;
  if public._ev_o_blocked(v_org) then return jsonb_build_object('ok', false, 'reason', 'blocked'); end if;

  update public.ev_pulled
     set fields = f, edited = v_ed, organiser_id = v_org,
         flags = array(select x from unnest(flags) x where x not in ('no_price', 'no_time', 'no_pin', 'changed', 'moved', 'gone')) || public._ev_o_flags(f)
   where id = p.id;

  select * into ev from public.events where id = p.event_id;
  if found and p.status = 'approved' then
    v_event := ev.id;
    -- A claimed listing is theirs now: staff cannot rewrite it from here.
    if ev.host_id is null or ev.host_id = v_lu then
      perform public._ev_o_event_update(v_event, f, true, '{}');
    end if;
  else
    v_event := public._ev_o_event_create(v_org, f);
  end if;

  update public.ev_pulled set status = 'approved', event_id = v_event, decided_by = nullif(left(btrim(coalesce(p_by, '')), 60), ''),
         decided_at = now(), reject_reason = null, missing_since = null where id = p.id;

  select * into o from public.ev_organisers where id = v_org;
  if o.stage = 'pulled' then
    update public.ev_organisers set stage = 'listed', updated_at = now() where id = v_org;
    perform public._ev_o_log(v_org, p_by, 'stage', null, 'Stage: listed');
  end if;
  perform public._ev_o_log(v_org, p_by, 'note', null, 'Approved: ' || left(v_name, 120));
  return jsonb_build_object('ok', true, 'event_id', v_event, 'organiser_id', v_org);
end $$;

-- Staff fix a pulled row's fields. What they change is remembered in edited, so a rerun keeps it. A listing already made from the row
-- is updated too (unless the organiser claimed it). Answers the PulledEvent.
create or replace function public.ev_o_edit(p_pulled uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p      public.ev_pulled;
  v_pr   jsonb;
  f      jsonb;
  v_ed   text[];
  v_org  uuid;
  v_status text;
  ev     public.events;
  v_lu   uuid := public._ev_listings_uid();
begin
  select * into p from public.ev_pulled where id = p_pulled for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p.status in ('merged', 'rejected') then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_patch'); end if;
  begin
    v_pr := public._ev_o_patch(p.fields, p.edited, p_patch);
  exception when raise_exception then
    return jsonb_build_object('ok', false, 'reason', 'bad_patch');
  end;
  f := v_pr -> 'fields';
  v_ed := array(select jsonb_array_elements_text(v_pr -> 'edited'));
  v_org := p.organiser_id;
  v_status := p.status;
  if p.status in ('new', 'blocked') and (p_patch ? 'organiser_name' or p_patch ? 'organiser_handle') then
    select r.o_id into v_org from public._ev_o_resolve(f) r;
    v_status := case when public._ev_o_blocked(v_org) then 'blocked' else 'new' end;
  end if;
  update public.ev_pulled
     set fields = f, edited = v_ed, organiser_id = v_org, status = v_status, confidence = f ->> 'confidence',
         flags = array(select x from unnest(flags) x where x not in ('no_price', 'no_time', 'no_pin', 'changed', 'moved', 'blocked'))
                 || public._ev_o_flags(f) || case when v_status = 'blocked' then array['blocked'] else '{}'::text[] end
   where id = p.id
   returning * into p;
  if p.status = 'approved' and p.event_id is not null then
    select * into ev from public.events where id = p.event_id;
    if found and (ev.host_id is null or ev.host_id = v_lu) then
      perform public._ev_o_event_update(p.event_id, f, true, '{}');
    end if;
  end if;
  return public._ev_o_pulled_json(p);
end $$;

create or replace function public.ev_o_reject(p_pulled uuid, p_by text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.ev_pulled;
begin
  select * into p from public.ev_pulled where id = p_pulled for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p.status = 'rejected' then return jsonb_build_object('ok', true); end if;
  if p.status = 'merged' then return jsonb_build_object('ok', false, 'reason', 'merged'); end if;
  -- A row that made a live listing is taken down with ev_o_delete, not rejected.
  if p.status = 'approved' and p.event_id is not null then return jsonb_build_object('ok', false, 'reason', 'already_listed'); end if;
  update public.ev_pulled
     set status = 'rejected', decided_by = nullif(left(btrim(coalesce(p_by, '')), 60), ''), decided_at = now(),
         reject_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '')
   where id = p.id;
  return jsonb_build_object('ok', true);
end $$;

-- Fold a duplicate into another pulled row. The loser becomes 'merged'; its source goes to the winner's also_at.
create or replace function public.ev_o_merge(p_pulled uuid, p_into uuid, p_by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.ev_pulled;
  w public.ev_pulled;
  v_also jsonb;
begin
  if p_pulled = p_into then return jsonb_build_object('ok', false, 'reason', 'same_row'); end if;
  -- Lock in id order so two merges cannot wait on each other.
  perform 1 from public.ev_pulled where id in (p_pulled, p_into) order by id for update;
  select * into l from public.ev_pulled where id = p_pulled;
  select * into w from public.ev_pulled where id = p_into;
  if l.id is null or w.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if l.status in ('merged', 'rejected') or (l.status = 'approved' and l.event_id is not null) then
    return jsonb_build_object('ok', false, 'reason', 'already_listed');
  end if;
  if w.status in ('merged', 'rejected') then return jsonb_build_object('ok', false, 'reason', 'bad_target'); end if;
  v_also := w.also_at || jsonb_build_array(jsonb_build_object('source_site', l.source_site, 'source_id', l.source_id, 'ticket_url', l.fields -> 'ticket_url'))
                      || l.also_at;
  update public.ev_pulled set also_at = v_also, flags = array_remove(flags, 'duplicate') where id = w.id;
  update public.ev_pulled
     set status = 'merged', duplicate_of = w.id, decided_by = nullif(left(btrim(coalesce(p_by, '')), 60), ''), decided_at = now(),
         also_at = '[]'::jsonb, flags = array_remove(flags, 'duplicate')
   where id = l.id;
  return jsonb_build_object('ok', true);
end $$;

-- ================================================================== organisers ===
create or replace function public.ev_o_organisers() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(public._ev_o_org_json(o.id) order by lower(o.name), o.id), '[]'::jsonb) from public.ev_organisers o;
$$;

create or replace function public.ev_o_organiser(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.ev_organisers where id = p_id) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object(
    'organiser', public._ev_o_org_json(p_id),
    'log', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'organiser_id', l.organiser_id, 'at', l.at, 'by', l.by_name,
                                                          'kind', l.kind, 'channel', l.channel, 'body', l.body) order by l.at desc, l.id), '[]'::jsonb)
              from (select * from public.ev_organiser_log x where x.organiser_id = p_id order by x.at desc, x.id limit 100) l),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at,
                                                             'status', public._ev_status_text(e.status, e.starts_at, e.ends_at),
                                                             'ticket_url', e.ticket_url,
                                                             'upcoming', e.status in ('live', 'unlisted') and public._ev_o_upcoming(e.starts_at, e.ends_at))
                                         order by e.starts_at desc, e.id), '[]'::jsonb)
                 from public.events e where e.organiser_id = p_id),
    'transfers', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', t.id, 'kind', t.kind, 'room_id', t.room_id,
                          'room_name', coalesce((select c.name from public.crews c where c.id = t.room_id), ''),
                          'organiser_id', t.organiser_id, 'to_email', t.to_email,
                          'status', case when t.status = 'pending' and t.expires_at <= now() then 'expired' else t.status end,
                          'created_at', t.created_at, 'created_by', t.created_by, 'expires_at', t.expires_at, 'accepted_at', t.accepted_at)
                          order by t.created_at desc, t.id), '[]'::jsonb)
                  from public.ev_transfers t where t.organiser_id = p_id));
end $$;

-- Change an organiser's details. Only the keys present change. Answers the Organiser.
create or replace function public.ev_o_save_organiser(p_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o      public.ev_organisers;
  v_name text;
  v_h    text;
  v_hs   jsonb;
  v_key  text;
  v_mail text;
  v_dnc  boolean;
begin
  select * into o from public.ev_organisers where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;

  if p_patch ? 'name' then
    v_name := left(btrim(coalesce(p_patch ->> 'name', '')), 120);
    if v_name = '' then return jsonb_build_object('ok', false, 'reason', 'bad_name'); end if;
    o.name := v_name; o.name_key := public._ev_name_key(v_name);
  end if;
  if p_patch ? 'ig_handle' then
    if jsonb_typeof(p_patch -> 'ig_handle') = 'null' or btrim(coalesce(p_patch ->> 'ig_handle', '')) = '' then
      o.ig_handle := null;
    else
      v_h := public._ev_o_handle(p_patch ->> 'ig_handle');
      if v_h is null then return jsonb_build_object('ok', false, 'reason', 'bad_handle'); end if;
      if exists (select 1 from public.ev_organisers x where x.ig_handle = v_h and x.id <> p_id) then
        return jsonb_build_object('ok', false, 'reason', 'handle_taken');
      end if;
      o.ig_handle := v_h;
    end if;
  end if;
  if p_patch ? 'handles' then
    v_hs := p_patch -> 'handles';
    if jsonb_typeof(v_hs) <> 'object' or octet_length(v_hs::text) >= 1500 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
    for v_key in select jsonb_object_keys(v_hs) loop
      if v_key not in ('instagram', 'x', 'tiktok', 'website', 'whatsapp') or jsonb_typeof(v_hs -> v_key) <> 'string' then
        return jsonb_build_object('ok', false, 'reason', 'bad_input');
      end if;
    end loop;
    o.handles := v_hs;
  end if;
  if p_patch ? 'email' then
    if jsonb_typeof(p_patch -> 'email') = 'null' or btrim(coalesce(p_patch ->> 'email', '')) = '' then
      o.email := null;
    else
      v_mail := public._ev_o_email(p_patch ->> 'email');
      if v_mail is null then return jsonb_build_object('ok', false, 'reason', 'bad_email'); end if;
      o.email := v_mail;
    end if;
  end if;
  if p_patch ? 'phone' then
    if char_length(btrim(coalesce(p_patch ->> 'phone', ''))) > 40 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
    o.phone := nullif(btrim(coalesce(p_patch ->> 'phone', '')), '');
  end if;
  if p_patch ? 'notes' then
    if char_length(coalesce(p_patch ->> 'notes', '')) > 4000 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
    o.notes := coalesce(p_patch ->> 'notes', '');
  end if;
  if p_patch ? 'do_not_contact' then
    if jsonb_typeof(p_patch -> 'do_not_contact') <> 'boolean' then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
    v_dnc := (p_patch ->> 'do_not_contact')::boolean;
    o.do_not_contact := v_dnc;
  end if;

  begin
    update public.ev_organisers
       set name = o.name, name_key = o.name_key, ig_handle = o.ig_handle, handles = o.handles, email = o.email, phone = o.phone,
           notes = o.notes, do_not_contact = o.do_not_contact, updated_at = now()
     where id = p_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'handle_taken');
  end;
  if v_dnc is not null then perform public._ev_o_sync_block(p_id); end if;
  return public._ev_o_org_json(p_id);
end $$;

-- A line in the organiser's log. contact also sets last contacted. Never moves the stage.
create or replace function public.ev_o_log(p_id uuid, p_by text, p_kind text, p_channel text, p_body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.ev_organisers where id = p_id) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_kind is null or p_kind not in ('contact', 'reply', 'offer', 'note') then return jsonb_build_object('ok', false, 'reason', 'bad_kind'); end if;
  if p_channel is not null and p_channel not in ('instagram', 'whatsapp', 'email', 'phone', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'bad_channel');
  end if;
  if char_length(coalesce(p_body, '')) > 2000 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  perform public._ev_o_log(p_id, p_by, p_kind, p_channel, btrim(coalesce(p_body, '')));
  if p_kind = 'contact' then
    update public.ev_organisers
       set last_contacted_at = now(), last_contacted_by = nullif(left(btrim(coalesce(p_by, '')), 60), ''), updated_at = now()
     where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Move the stage by hand: offered, declined or listed (listed = reopen). claimed is only set by accepting a transfer. Answers the Organiser.
create or replace function public.ev_o_set_stage(p_id uuid, p_stage text, p_by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.ev_organisers;
begin
  if p_stage is null or p_stage not in ('offered', 'declined', 'listed') then return jsonb_build_object('ok', false, 'reason', 'bad_stage'); end if;
  select * into o from public.ev_organisers where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.stage = 'claimed' then return jsonb_build_object('ok', false, 'reason', 'is_claimed'); end if;

  if p_stage = 'declined' then
    update public.ev_organisers
       set stage = 'declined', do_not_contact = true, declined_at = coalesce(declined_at, now()), updated_at = now()
     where id = p_id;
    perform public._ev_o_sync_block(p_id);
    perform public._ev_o_log(p_id, p_by, 'stage', null, 'Stage: declined');
  elsif p_stage = 'listed' then
    update public.ev_organisers
       set stage = 'listed', do_not_contact = false, declined_at = null, updated_at = now()
     where id = p_id;
    perform public._ev_o_sync_block(p_id);
    perform public._ev_o_log(p_id, p_by, 'stage', null, 'Stage: listed');
  else
    if o.stage = 'declined' or o.do_not_contact then return jsonb_build_object('ok', false, 'reason', 'organiser_declined'); end if;
    update public.ev_organisers set stage = 'offered', updated_at = now() where id = p_id;
    perform public._ev_o_log(p_id, p_by, 'offer', null, 'Stage: offered');
  end if;
  return public._ev_o_org_json(p_id);
end $$;

-- They said no: take the events and the room away. The organiser stays (declined, do not contact) so the next scrape does not list them.
create or replace function public.ev_o_delete(p_id uuid, p_confirm text, p_by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o       public.ev_organisers;
  ev      record;
  n       integer;
  v_block jsonb := '[]'::jsonb;
  v_ids   uuid[];
  v_count integer;
begin
  select * into o from public.ev_organisers where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(btrim(o.name)) then return jsonb_build_object('ok', false, 'reason', 'confirm_name'); end if;
  if o.stage = 'claimed' then return jsonb_build_object('ok', false, 'reason', 'is_claimed'); end if;

  for ev in select e.id, e.title from public.events e where e.organiser_id = p_id order by e.starts_at, e.id loop
    n := 0;
    if to_regclass('public.ev_registrations') is not null then
      select count(*) into n from public.ev_registrations r where r.event_id = ev.id and r.status not in ('cancelled', 'declined');
    end if;
    if to_regclass('public.ev_orders') is not null then
      n := n + (select count(*) from public.ev_orders x where x.event_id = ev.id and x.status in ('open', 'paid', 'refund_pending', 'refunded'));
    end if;
    if n > 0 then v_block := v_block || jsonb_build_array(jsonb_build_object('title', ev.title, 'count', n)); end if;
  end loop;
  if jsonb_array_length(v_block) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'has_registrations', 'events', v_block);
  end if;

  v_ids := array(select e.id from public.events e where e.organiser_id = p_id);
  v_count := cardinality(v_ids);
  if cardinality(v_ids) > 0 then
    if to_regclass('public.ev_orders') is not null then
      delete from public.ev_orders x where x.event_id = any (v_ids) and x.status in ('expired', 'failed');
    end if;
    delete from public.events where id = any (v_ids);
  end if;
  if o.room_id is not null then delete from public.crews where id = o.room_id; end if;

  perform public._ev_o_log(p_id, p_by, 'delete', null, 'Deleted ' || v_count || ' event' || case when v_count = 1 then '' else 's' end || ' and the room');
  update public.ev_organisers
     set stage = 'declined', do_not_contact = true, declined_at = coalesce(declined_at, now()), room_id = null, updated_at = now()
   where id = p_id;
  -- Waiting rows are blocked. Rows that made a listing are closed (the listing is gone).
  update public.ev_pulled p
     set status = 'rejected', event_id = null, decided_by = nullif(left(btrim(coalesce(p_by, '')), 60), ''), decided_at = now(),
         reject_reason = 'Deleted with the organiser', flags = array_remove(array_remove(array_remove(p.flags, 'changed'), 'moved'), 'gone')
   where p.organiser_id = p_id and p.status = 'approved';
  perform public._ev_o_sync_block(p_id);
  return jsonb_build_object('ok', true, 'events', v_count);
end $$;

-- ================================================================== claim requests, the week ===
create or replace function public.ev_o_claim_requests() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'event_id', q.event_id, 'event_title', q.event_title, 'organiser_id', q.organiser_id,
           'organiser_name', q.organiser_name, 'name', q.name, 'email', q.email, 'phone', q.phone, 'note', q.note,
           'status', q.status, 'created_at', q.created_at) order by (q.status = 'new') desc, q.created_at desc, q.id), '[]'::jsonb)
    from (select r.*, e.title as event_title, o.name as organiser_name
            from public.ev_claim_requests r
            join public.events e on e.id = r.event_id
            left join public.ev_organisers o on o.id = r.organiser_id
           where r.status = 'new' or r.handled_at > now() - interval '30 days'
           order by (r.status = 'new') desc, r.created_at desc limit 200) q;
$$;

create or replace function public.ev_o_handle_claim_request(p_id uuid, p_by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.ev_claim_requests;
begin
  select * into r from public.ev_claim_requests where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.status = 'handled' then return jsonb_build_object('ok', true); end if;
  update public.ev_claim_requests set status = 'handled', handled_at = now() where id = p_id;
  perform public._ev_o_log(r.organiser_id, p_by, 'note', null, 'Handled the request from ' || left(r.name, 80));
  return jsonb_build_object('ok', true);
end $$;

-- The last 7 days against the 7 before, from the organiser log (new pulled rows and rejections from ev_pulled).
create or replace function public.ev_o_week() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_to   timestamptz := now();
  v_from timestamptz := now() - interval '7 days';
  v_prev timestamptz := now() - interval '14 days';
  c      record;
  p      record;
  v_stages jsonb;
  v_wait jsonb;
begin
  select count(*) filter (where kind = 'contact') as contacted,
         count(*) filter (where kind = 'reply') as replies,
         count(*) filter (where kind = 'offer') as offers,
         count(*) filter (where kind = 'stage' and body like 'Stage: claimed%') as claimed,
         count(*) filter (where kind = 'stage' and body like 'Stage: declined%') as declined,
         count(*) filter (where kind = 'stage' and body like 'Stage: listed%') as listed,
         count(*) filter (where kind = 'claim_request') as claim_requests
    into c from public.ev_organiser_log where at >= v_from and at <= v_to;
  select count(*) filter (where kind = 'contact') as contacted,
         count(*) filter (where kind = 'reply') as replies,
         count(*) filter (where kind = 'offer') as offers,
         count(*) filter (where kind = 'stage' and body like 'Stage: claimed%') as claimed,
         count(*) filter (where kind = 'stage' and body like 'Stage: declined%') as declined,
         count(*) filter (where kind = 'stage' and body like 'Stage: listed%') as listed
    into p from public.ev_organiser_log where at >= v_prev and at < v_from;

  select jsonb_build_object(
           'pulled', count(*) filter (where stage = 'pulled'), 'listed', count(*) filter (where stage = 'listed'),
           'offered', count(*) filter (where stage = 'offered'), 'claimed', count(*) filter (where stage = 'claimed'),
           'declined', count(*) filter (where stage = 'declined'))
    into v_stages from public.ev_organisers;

  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'days', w.days) order by w.since, w.id), '[]'::jsonb)
    into v_wait
    from (select o.id, o.name, coalesce(o.last_contacted_at, o.created_at) as since,
                 floor(extract(epoch from (now() - coalesce(o.last_contacted_at, o.created_at))) / 86400)::int as days
            from public.ev_organisers o
           where o.stage in ('listed', 'offered') and not o.do_not_contact
             and coalesce(o.last_contacted_at, o.created_at) <= now() - interval '7 days'
           order by coalesce(o.last_contacted_at, o.created_at), o.id limit 50) w;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'contacted', c.contacted, 'replies', c.replies, 'offers', c.offers, 'claimed', c.claimed, 'declined', c.declined, 'listed', c.listed,
    'pulled_new', (select count(*) from public.ev_pulled x where x.first_seen_at >= v_from and x.first_seen_at <= v_to),
    'rejected', (select count(*) from public.ev_pulled x where x.status = 'rejected' and x.decided_at >= v_from and x.decided_at <= v_to),
    'claim_requests', c.claim_requests,
    'stages', v_stages, 'waiting', v_wait,
    'previous', jsonb_build_object('contacted', p.contacted, 'replies', p.replies, 'offers', p.offers, 'claimed', p.claimed,
                                   'declined', p.declined, 'listed', p.listed));
end $$;

-- ================================================================== access ===
-- Service role only, for everything this file made.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         '_ev_name_key', '_ev_o_handle', '_ev_o_email', '_ev_o_url', '_ev_o_txt', '_ev_o_iso', '_ev_o_in_lagos', '_ev_o_price_min',
         '_ev_o_price_max', '_ev_o_sold_out', '_ev_o_vibe', '_ev_o_blocked', '_ev_o_upcoming', '_ev_o_log', '_ev_o_clean_fields',
         '_ev_o_flags', '_ev_o_patch', '_ev_o_resolve', '_ev_o_fill', '_ev_o_sync_block', 'ev_o_ensure_room', '_ev_o_org_json',
         '_ev_o_pulled_json', '_ev_o_event_update', '_ev_o_event_create', '_ev_o_import_one', '_ev_o_import_core', 'ev_o_import',
         'ev_o_queue', 'ev_o_approve', 'ev_o_edit', 'ev_o_reject', 'ev_o_merge', 'ev_o_organisers', 'ev_o_organiser',
         'ev_o_save_organiser', 'ev_o_log', 'ev_o_set_stage', 'ev_o_delete', 'ev_o_claim_requests', 'ev_o_handle_claim_request',
         'ev_o_week'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
