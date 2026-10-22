-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1, file 3 of 6: tickets, the signed QR and the door scan. Free events only: one General ticket per person who
-- is going. Written from src/lib/events-r1/fake/door.ts, crypto.ts and registrations.ts and from section 6 of
-- notes/luma/08-ticketing-framework.md.
--
-- RUN ORDER: schema.sql, chat_accounts.sql, crew_rooms.sql, events_r1_events.sql, events_r1_registrations.sql, then THIS FILE.
--            Needs pgcrypto (schema.sql already creates it). Safe to run again. It replaces the two stubs the registrations file
--            wrote (ev_issue_ticket, ev_void_ticket).
--
-- ONE-TIME STEP FOR OLA, BEFORE ANY TICKET IS SHOWN: the signing secret. It is never in the repo. In the SQL editor, once:
--     select public.ev_set_ticket_secret('<at least 32 random characters, for example the output of openssl rand -hex 32>');
-- It answers ok. Run it again with a second argument true only to rotate the secret on purpose: that makes every QR already
-- issued fail the signature check. Until it is set, ev_my_ticket raises ticket_secret_missing and ev_scan answers no_secret.
-- The secret sits in a closed table (ev_ticket_secret: no policy, no grant for anon or authenticated). The function that sets it
-- can be run by the service role and by you in the SQL editor, never by a signed-in user.
--
-- WHAT IT IS.
--   ev_tickets    one row per registration that is going: the ticket id, the owner, the holder name, a short code a person at the
--                 door can type when a QR will not scan (8 characters, no 0 O 1 I), a version and a status (valid | used | void).
--   ev_scans      the door log: every scan, good or not, by whom, when, standard or express, and whether it came from a phone that was
--                 offline. The phone's own clock is kept as device_at.
--   ev_door_staff people the host lets scan, besides the host and staff.
--   ev_ticket_secret   the signing secret, one row.
--
-- THE TOKEN. token = base64url(json {"t": ticket id, "e": event id, "v": version}) || '.' || base64url(HMAC-SHA256 of that first
-- part, keyed by the secret). Same shape as the fake layer's token, so the QR and the scanner need no change. Anyone can read a
-- token; nobody can make a valid one without the secret. A person whose ticket is voided (they cancelled) and who registers again
-- keeps the same ticket row with version + 1: the old QR stops working at once.
--
--   ev_issue_ticket(registration)    internal. Called by ev_register, ev_decide, ev_promote and the waitlist fill when a person
--                                    becomes going. Makes the ticket, or brings a voided one back with version + 1. Service role only.
--   ev_void_ticket(registration)     internal. Called when a going person cancels or is declined. Service role only.
--   ev_my_ticket(event)              mine: { id, event_id, holder_name, ticket_name, code, token, version, status } or null. status is
--                                    used once checked in. Makes the ticket if a going person has none yet.
--   ev_scan(event, token or code, mode, offline, at)   host, staff or door staff. mode: standard (look, change nothing) | express
--                                    (check in at once) | confirm (check in after a standard look). The answer is the ScanResult
--                                    type: { ok: true, kind: confirm | checked_in, name, ticket, checked_in, total } | { ok: false,
--                                    kind: already_used, name, at } | { ok: false, kind: not_valid, reason: bad_signature |
--                                    wrong_event | void | unknown | not_going }. Other answers: { ok: false, reason: no_session |
--                                    not_found | not_allowed | bad_mode | no_secret }. offline and at are for a phone that sends its
--                                    scans later: they are stored with the scan. First scan to arrive wins; both are in ev_scans.
--   ev_checkin_manual(event, registration)   the name search fallback. Same answers.
--   ev_door_search(event, q)         going people by name or email, up to 50. Registration shape.
--   ev_door_counts(event)            { ok, going, checked_in, pending, waitlist } (going includes checked in, like the fake layer).
--   ev_valid_tickets(event)          { ok, event_id, generated_at, tickets: [{ id, v }] }: ids and versions of the tickets that are
--                                    valid now, for the scanner to keep on the phone for the offline scan. The signature cannot be
--                                    checked offline (the secret never leaves the database), so the phone trusts the list: a token
--                                    counts only if its id and version are in it.
--   ev_set_door_staff(event, user, on)   host or staff: let a person scan (up to 20 people per event). Text: ok | code. Not in the
--                                    fake layer yet: the door screen only needs it when the host wants helpers.
--   ev_set_ticket_secret(secret, replace)   see above.
--
-- Door staff see the names and emails of people who are going (the name search), like the host does.
-- A cancelled or hidden event: every scan is not_valid / void. Scanning is for the host and the door staff only; nobody else can read
-- tickets or scans.
-- ============================================================================
begin;

create table if not exists public.ev_ticket_secret (
  id     boolean primary key default true check (id),
  secret text not null check (char_length(secret) >= 32),
  set_at timestamptz not null default now()
);
alter table public.ev_ticket_secret enable row level security;
revoke all on public.ev_ticket_secret from anon, authenticated;
grant all on public.ev_ticket_secret to service_role;

create table if not exists public.ev_tickets (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  registration_id uuid not null unique references public.ev_registrations(id) on delete cascade,
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  holder_name     text not null default '',
  ticket_name     text not null default 'General',
  code            text not null check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  version         integer not null default 1 check (version >= 1),
  status          text not null default 'valid' check (status in ('valid', 'used', 'void')),
  created_at      timestamptz not null default now(),
  used_at         timestamptz,
  used_by         uuid references public.profiles(id) on delete set null
);
create unique index if not exists ev_tickets_code_idx on public.ev_tickets (event_id, code);
create index if not exists ev_tickets_event_idx on public.ev_tickets (event_id, status);
alter table public.ev_tickets enable row level security;
revoke all on public.ev_tickets from anon, authenticated;
grant all on public.ev_tickets to service_role;

create table if not exists public.ev_scans (
  id         bigint generated always as identity primary key,
  event_id   uuid not null references public.events(id) on delete cascade,
  ticket_id  uuid references public.ev_tickets(id) on delete set null,
  scanned_by uuid references public.profiles(id) on delete set null,
  at         timestamptz not null default clock_timestamp(),
  device_at  timestamptz,
  mode       text not null check (mode in ('standard', 'express', 'confirm', 'manual')),
  offline    boolean not null default false,
  result     text not null check (result in ('confirm', 'checked_in', 'already_used', 'not_valid')),
  reason     text
);
create index if not exists ev_scans_event_idx on public.ev_scans (event_id, at desc);
alter table public.ev_scans enable row level security;
revoke all on public.ev_scans from anon, authenticated;
grant all on public.ev_scans to service_role;

create table if not exists public.ev_door_staff (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.ev_door_staff enable row level security;
revoke all on public.ev_door_staff from anon, authenticated;
grant all on public.ev_door_staff to service_role;

-- ------------------------------------------------------------ the secret ---
create or replace function public.ev_set_ticket_secret(p_secret text, p_replace boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_secret is null or char_length(p_secret) < 32 then return 'too_short'; end if;
  if exists (select 1 from public.ev_ticket_secret) and not coalesce(p_replace, false) then return 'already_set'; end if;
  insert into public.ev_ticket_secret (id, secret) values (true, p_secret)
  on conflict (id) do update set secret = excluded.secret, set_at = now();
  return 'ok';
end $$;
revoke all on function public.ev_set_ticket_secret(text, boolean) from public, anon, authenticated;
grant execute on function public.ev_set_ticket_secret(text, boolean) to service_role;

-- ---------------------------------------------------------------- helpers ---
-- pgcrypto lives in the extensions schema on Supabase, so these functions have it on their search_path.
create or replace function public._ev_b64url(p bytea) returns text
language sql immutable set search_path = public, extensions, pg_temp as $$
  select translate(replace(encode(p, 'base64'), E'\n', ''), '+/=', '-_');
$$;
create or replace function public._ev_b64url_dec(p text) returns bytea
language sql immutable set search_path = public, extensions, pg_temp as $$
  select decode(translate(p, '-_', '+/') || repeat('=', (4 - char_length(p) % 4) % 4), 'base64');
$$;
-- The signature of a piece of text, or null when no secret is set yet.
create or replace function public._ev_sign(p_text text) returns text
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select public._ev_b64url(hmac(convert_to(p_text, 'UTF8'), convert_to(s.secret, 'UTF8'), 'sha256'))
    from public.ev_ticket_secret s;
$$;
create or replace function public._ev_token(p_ticket uuid, p_event uuid, p_version integer) returns text
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_body text := public._ev_b64url(convert_to(format('{"t":"%s","e":"%s","v":%s}', p_ticket, p_event, p_version), 'UTF8'));
  v_sig  text := public._ev_sign(v_body);
begin
  if v_sig is null then raise exception 'ticket_secret_missing'; end if;
  return v_body || '.' || v_sig;
end $$;
-- Eight characters from 32 that cannot be mistaken for each other. 256 is a multiple of 32, so every one is equally likely.
create or replace function public._ev_code() returns text
language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes    bytea := gen_random_bytes(8);
  v_out      text := '';
  i          integer;
begin
  for i in 0..7 loop
    v_out := v_out || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
  end loop;
  return v_out;
end $$;
revoke all on function public._ev_b64url(bytea), public._ev_b64url_dec(text), public._ev_sign(text),
  public._ev_token(uuid, uuid, integer), public._ev_code() from public, anon, authenticated;

-- Host, staff, or someone the host let in at the door.
create or replace function public._ev_can_door(p_event uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
    public._ev_manage(p_event)
    or exists (select 1 from public.ev_door_staff d where d.event_id = p_event and d.user_id = auth.uid()));
$$;
revoke all on function public._ev_can_door(uuid) from public, anon, authenticated;

create or replace function public._ev_door_counts(p_event uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'going', count(*) filter (where r.status in ('going', 'checked_in')),
    'checked_in', count(*) filter (where r.status = 'checked_in'),
    'pending', count(*) filter (where r.status = 'requested'),
    'waitlist', count(*) filter (where r.status = 'waitlisted'))
  from public.ev_registrations r where r.event_id = p_event;
$$;
revoke all on function public._ev_door_counts(uuid) from public, anon, authenticated;

-- Log a scan that was not good, and answer with it.
create or replace function public._ev_not_valid(p_event uuid, p_by uuid, p_mode text, p_offline boolean, p_at timestamptz,
                                                p_reason text, p_ticket uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.ev_scans (event_id, ticket_id, scanned_by, device_at, mode, offline, result, reason)
  values (p_event, p_ticket, p_by, p_at, p_mode, coalesce(p_offline, false), 'not_valid', p_reason);
  return jsonb_build_object('ok', false, 'kind', 'not_valid', 'reason', p_reason);
end $$;
revoke all on function public._ev_not_valid(uuid, uuid, text, boolean, timestamptz, text, uuid) from public, anon, authenticated;

-- ------------------------------------------------- issuing and voiding (internal) ---
create or replace function public.ev_issue_ticket(p_registration uuid) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  r    public.ev_registrations;
  t    public.ev_tickets;
  v_id uuid;
  i    integer;
begin
  select * into r from public.ev_registrations where id = p_registration;
  if r.id is null or r.status not in ('going', 'checked_in') then return null; end if;
  select * into t from public.ev_tickets where registration_id = r.id for update;
  if t.id is not null then
    -- A returning person gets a new version, so the old QR stops working.
    if t.status = 'void' then
      update public.ev_tickets set version = version + 1, status = 'valid', holder_name = r.name, used_at = null, used_by = null where id = t.id;
    end if;
    return t.id;
  end if;
  for i in 1..10 loop
    begin
      insert into public.ev_tickets (event_id, registration_id, owner_id, holder_name, code)
      values (r.event_id, r.id, r.user_id, r.name, public._ev_code())
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- Either another call made this person's ticket a moment ago, or the code is taken: look, then try another code.
      select id into v_id from public.ev_tickets where registration_id = r.id;
      if v_id is not null then exit; end if;
    end;
  end loop;
  if v_id is null then raise exception 'ticket_code_failed'; end if;
  return v_id;
end $$;
revoke all on function public.ev_issue_ticket(uuid) from public, anon, authenticated;
grant execute on function public.ev_issue_ticket(uuid) to service_role;

create or replace function public.ev_void_ticket(p_registration uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.ev_tickets set status = 'void' where registration_id = p_registration and status = 'valid';
end $$;
revoke all on function public.ev_void_ticket(uuid) from public, anon, authenticated;
grant execute on function public.ev_void_ticket(uuid) to service_role;

-- --------------------------------------------------------------- my ticket ---
create or replace function public.ev_my_ticket(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  me uuid := auth.uid();
  r  public.ev_registrations;
  t  public.ev_tickets;
begin
  if me is null then return null; end if;
  select * into r from public.ev_registrations where event_id = p_event and user_id = me and status in ('going', 'checked_in');
  if r.id is null then return null; end if;
  perform public.ev_issue_ticket(r.id);
  select * into t from public.ev_tickets where registration_id = r.id;
  if t.id is null then return null; end if;
  return jsonb_build_object(
    'id', t.id, 'event_id', t.event_id, 'holder_name', t.holder_name, 'ticket_name', t.ticket_name, 'code', t.code,
    'token', public._ev_token(t.id, t.event_id, t.version), 'version', t.version,
    'status', case when r.status = 'checked_in' then 'used' else t.status end);
end $$;

-- ------------------------------------------------------------------- scan ---
create or replace function public.ev_scan(p_event uuid, p_input text, p_mode text default 'standard',
                                          p_offline boolean default false, p_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  me        uuid := auth.uid();
  e         public.events;
  t         public.ev_tickets;
  r         public.ev_registrations;
  v_input   text := btrim(coalesce(p_input, ''));
  v_mode    text := coalesce(p_mode, 'standard');
  v_parts   text[];
  v_payload jsonb;
  v_code    text;
  v_ver     numeric;
  c         jsonb;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if v_mode not in ('standard', 'express', 'confirm') then return jsonb_build_object('ok', false, 'reason', 'bad_mode'); end if;
  select * into e from public.events where id = p_event;
  if e.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public._ev_can_door(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  if v_input = '' or char_length(v_input) > 600 then
    return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'unknown');
  end if;

  if position('.' in v_input) > 0 then
    -- A QR token: check the signature, then the event, then the ticket.
    v_parts := string_to_array(v_input, '.');
    if array_length(v_parts, 1) <> 2 or v_parts[1] = '' or v_parts[2] = '' then
      return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'bad_signature');
    end if;
    if not exists (select 1 from public.ev_ticket_secret) then return jsonb_build_object('ok', false, 'reason', 'no_secret'); end if;
    if public._ev_sign(v_parts[1]) is distinct from v_parts[2] then
      return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'bad_signature');
    end if;
    begin
      v_payload := convert_from(public._ev_b64url_dec(v_parts[1]), 'UTF8')::jsonb;
    exception when others then
      return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'bad_signature');
    end;
    if jsonb_typeof(v_payload -> 't') is distinct from 'string' or jsonb_typeof(v_payload -> 'e') is distinct from 'string'
       or jsonb_typeof(v_payload -> 'v') is distinct from 'number'
       or (v_payload ->> 't') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'bad_signature');
    end if;
    if (v_payload ->> 'e') <> p_event::text then
      return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'wrong_event');
    end if;
    select * into t from public.ev_tickets where id = (v_payload ->> 't')::uuid and event_id = p_event;
    if t.id is null then return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'unknown'); end if;
    v_ver := (v_payload ->> 'v')::numeric;
  else
    -- A typed code, when a QR will not scan.
    v_code := upper(regexp_replace(v_input, '[^A-Za-z0-9]', '', 'g'));
    if char_length(v_code) < 6 then return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'unknown'); end if;
    select * into t from public.ev_tickets where event_id = p_event and code = v_code;
    if t.id is null then return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'unknown'); end if;
  end if;

  -- Lock the registration, then the ticket (the same order as a cancel), and judge the ticket as it is now.
  select * into r from public.ev_registrations where id = t.registration_id for update;
  if r.id is null then return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'unknown', t.id); end if;
  select * into t from public.ev_tickets where id = t.id for update;
  if (v_ver is not null and t.version <> v_ver) or t.status = 'void' then
    return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'void', t.id);
  end if;
  if r.status = 'checked_in' or t.status = 'used' then
    insert into public.ev_scans (event_id, ticket_id, scanned_by, device_at, mode, offline, result)
    values (p_event, t.id, me, p_at, v_mode, coalesce(p_offline, false), 'already_used');
    return jsonb_build_object('ok', false, 'kind', 'already_used', 'name', r.name, 'at', coalesce(t.used_at, r.checked_in_at, clock_timestamp()));
  end if;
  if r.status <> 'going' then return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'not_going', t.id); end if;
  if e.status not in ('live', 'unlisted') then return public._ev_not_valid(p_event, me, v_mode, p_offline, p_at, 'void', t.id); end if;

  if v_mode = 'standard' then
    c := public._ev_door_counts(p_event);
    insert into public.ev_scans (event_id, ticket_id, scanned_by, device_at, mode, offline, result)
    values (p_event, t.id, me, p_at, v_mode, coalesce(p_offline, false), 'confirm');
    return jsonb_build_object('ok', true, 'kind', 'confirm', 'name', r.name, 'ticket', t.ticket_name,
                              'checked_in', (c ->> 'checked_in')::int, 'total', (c ->> 'going')::int);
  end if;

  update public.ev_tickets set status = 'used', used_at = clock_timestamp(), used_by = me where id = t.id;
  update public.ev_registrations set status = 'checked_in', checked_in_at = clock_timestamp(), updated_at = clock_timestamp() where id = r.id;
  insert into public.ev_scans (event_id, ticket_id, scanned_by, device_at, mode, offline, result)
  values (p_event, t.id, me, p_at, v_mode, coalesce(p_offline, false), 'checked_in');
  c := public._ev_door_counts(p_event);
  return jsonb_build_object('ok', true, 'kind', 'checked_in', 'name', r.name, 'ticket', t.ticket_name,
                            'checked_in', (c ->> 'checked_in')::int, 'total', (c ->> 'going')::int);
end $$;

-- Check someone in from the name search, with no QR.
create or replace function public.ev_checkin_manual(p_event uuid, p_registration uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  me uuid := auth.uid();
  e  public.events;
  r  public.ev_registrations;
  t  public.ev_tickets;
  c  jsonb;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  select * into e from public.events where id = p_event;
  if e.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public._ev_can_door(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  select * into r from public.ev_registrations where id = p_registration and event_id = p_event for update;
  if r.id is null then return public._ev_not_valid(p_event, me, 'manual', false, null, 'unknown'); end if;
  if r.status = 'checked_in' then
    insert into public.ev_scans (event_id, scanned_by, mode, result) values (p_event, me, 'manual', 'already_used');
    return jsonb_build_object('ok', false, 'kind', 'already_used', 'name', r.name, 'at', coalesce(r.checked_in_at, clock_timestamp()));
  end if;
  if r.status <> 'going' then return public._ev_not_valid(p_event, me, 'manual', false, null, 'not_going'); end if;
  if e.status not in ('live', 'unlisted') then return public._ev_not_valid(p_event, me, 'manual', false, null, 'void'); end if;
  perform public.ev_issue_ticket(r.id);
  select * into t from public.ev_tickets where registration_id = r.id for update;
  update public.ev_tickets set status = 'used', used_at = clock_timestamp(), used_by = me where id = t.id;
  update public.ev_registrations set status = 'checked_in', checked_in_at = clock_timestamp(), updated_at = clock_timestamp() where id = r.id;
  insert into public.ev_scans (event_id, ticket_id, scanned_by, mode, result) values (p_event, t.id, me, 'manual', 'checked_in');
  c := public._ev_door_counts(p_event);
  return jsonb_build_object('ok', true, 'kind', 'checked_in', 'name', r.name, 'ticket', t.ticket_name,
                            'checked_in', (c ->> 'checked_in')::int, 'total', (c ->> 'going')::int);
end $$;

-- ---------------------------------------------------- search, counts, offline list ---
create or replace function public.ev_door_search(p_event uuid, p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_q text := lower(btrim(coalesce(p_q, '')));
begin
  if not public._ev_can_door(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  if char_length(v_q) > 100 then v_q := left(v_q, 100); end if;
  return coalesce((
    select jsonb_agg(public._ev_reg_json(r) order by lower(r.name), r.id)
      from public.ev_registrations r
     where r.id in (
       select x.id from public.ev_registrations x
        where x.event_id = p_event and x.status in ('going', 'checked_in')
          and (v_q = '' or strpos(lower(x.name), v_q) > 0
               or strpos(lower(coalesce((select u.email from auth.users u where u.id = x.user_id), '')), v_q) > 0)
        order by lower(x.name), x.id limit 50)
  ), '[]'::jsonb);
end $$;

create or replace function public.ev_door_counts(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._ev_can_door(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  return jsonb_build_object('ok', true) || public._ev_door_counts(p_event);
end $$;

create or replace function public.ev_valid_tickets(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._ev_can_door(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  return jsonb_build_object(
    'ok', true, 'event_id', p_event, 'generated_at', clock_timestamp(),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'v', t.version) order by t.id)
                           from public.ev_tickets t
                           join public.ev_registrations r on r.id = t.registration_id and r.status = 'going'
                          where t.event_id = p_event and t.status = 'valid'), '[]'::jsonb));
end $$;

create or replace function public.ev_set_door_staff(p_event uuid, p_user uuid, p_on boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return 'no_session'; end if;
  perform 1 from public.events where id = p_event for update;
  if not found then return 'not_found'; end if;
  if not public._ev_manage(p_event) then return 'not_allowed'; end if;
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return 'no_such_user'; end if;
  if coalesce(p_on, true) then
    if (select count(*) from public.ev_door_staff where event_id = p_event) >= 20
       and not exists (select 1 from public.ev_door_staff where event_id = p_event and user_id = p_user) then
      return 'too_many';
    end if;
    insert into public.ev_door_staff (event_id, user_id, added_by) values (p_event, p_user, auth.uid())
    on conflict (event_id, user_id) do nothing;
  else
    delete from public.ev_door_staff where event_id = p_event and user_id = p_user;
  end if;
  return 'ok';
end $$;

-- ----------------------------------------------------------------- access ---
revoke all on function public.ev_my_ticket(uuid), public.ev_scan(uuid, text, text, boolean, timestamptz), public.ev_checkin_manual(uuid, uuid),
  public.ev_door_search(uuid, text), public.ev_door_counts(uuid), public.ev_valid_tickets(uuid), public.ev_set_door_staff(uuid, uuid, boolean)
  from public, anon;
grant execute on function public.ev_my_ticket(uuid), public.ev_scan(uuid, text, text, boolean, timestamptz), public.ev_checkin_manual(uuid, uuid),
  public.ev_door_search(uuid, text), public.ev_door_counts(uuid), public.ev_valid_tickets(uuid), public.ev_set_door_staff(uuid, uuid, boolean)
  to authenticated;

notify pgrst, 'reload schema';
commit;
