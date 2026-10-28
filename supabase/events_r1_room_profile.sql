-- Room profile, who can join, the Host role, and "went but haven't joined". DRAFT FOR OLA, NOT RUN ANYWHERE (not even locally).
-- Release 1, file 11 in the run order (see EVENTS_R1_ORDER.md). Written from the fake layer (src/lib/events-r1/fake/rooms.ts), which is the
-- spec of every rule here. Nothing in an older SQL file is edited and no existing function is replaced. Safe to run again.
--
-- WHAT IT ADDS
--   1. Room profile: about (up to 600 characters), links (instagram, x, website, whatsapp), the slug used at hoppaz.fun/r/<slug>
--      (unique, shape-checked, editable by the owner or an admin), the logo (crews.logo_url, a link into the public crew-images bucket,
--      folder room-logos/<user id>/, with its own three storage policies because the cover policies only match event-covers/).
--   2. Join mode: open, ask or invite, kept in ev_room_profiles.join_mode and mirrored to the OLD crews.visibility so old code keeps working:
--      open -> 'open', ask and invite -> 'private'. A room with no profile row reads from visibility: open -> open, private -> invite
--      (that is what a private crew always was: hidden, joined with the invite code).
--      Ask mode has a requests table (ev_room_requests) and four functions: ev_join_room, ev_room_requests, ev_decide_room_request,
--      ev_room_invite_code. Approving makes the person a member and leaves them a quiet notice in ev_room_notices (read with
--      ev_my_room_notices; the app shows it, there is no push). Pops belong to an event and announcements go to the whole room, so neither
--      can address one person; that is why the notice has its own small table.
--   3. Host role: crew_members.role may now be 'host' (see the CHECK below, the one change that touches an older table).
--   4. ev_room_guests_not_joined(room): people who registered (going or checked in) for the room's events and are not members, with the
--      full count. Used by "Bring your N guests in" on the Create a room done sheet.
--   5. ev_post_events_as_room(room, events[]): put the caller's own events into a room they are owner, admin or host of.
--
-- FOR OLA, THREE THINGS TO KNOW
--   (a) THE ROLE CHECK. schema.sql allows owner and member; crew_stage_voice.sql widens it to owner, admin and member. This file drops
--       every CHECK on crew_members that mentions role and adds one allowing owner, admin, host and member. If crew_stage_voice.sql is
--       ever run again it narrows the check back and fails on any 'host' row: run this file again after it.
--   (b) HOSTS AND THE DOOR. A host can post events as the room (ev_post_events_as_room) but cannot yet run the door of a room event they
--       did not make: _ev_manage(event) in events_r1_events.sql only lets the event's host and staff in. The one-line change, NOT made here
--       because it edits an existing function, is to add to _ev_manage:
--           or (select e.room_id is not null and public._ev_room_can_host(e.room_id, auth.uid()) from public.events e where e.id = p_event)
--       (_ev_room_can_host is defined below: owner, admin or host.) ev_create_event also still posts into the room the caller OWNS
--       (add_to_room); for a room they only host, make the event first and then call ev_post_events_as_room.
--   (c) THE OLD join_crew. join_crew(invite code) still lets anyone holding a room's invite code join whatever its mode: that is the
--       invite link and is meant. ev_join_room does the same: a right code gets in at once, also into an ask room. In an ask room the code
--       is therefore as good as a key: the owner should not share it. Ask rooms are joined through ev_join_room.
--
-- Needs (load first):
--   schema.sql, chat_accounts.sql (has_account())          crews, crew_members, profiles, auth.users
--   crew_rooms.sql                                         crews.logo_url, crews.verified, the public crew-images bucket
--   crew_stage_voice.sql                                   crew_members.role 'admin' (this file widens it again)
--   events_r1_events.sql                                   _ev_open(), _ev_staff(), ev_settings, events.room_id
--   events_r1_registrations.sql                            ev_registrations
--   events_r1_rooms.sql                                    _ev_room_json(uuid, uuid), _ev_is_hq(uuid)
--   events_r1_looks.sql is NOT needed here; the room look is set with ev_set_look (that file) as before.
-- Test: supabase/tests/events_r1_room_profile_test.sql
--
-- Answers. Write functions answer a short text: 'ok' or a reason code, or jsonb { ok, reason } where they return data.
-- Reasons: not_open (the events_r1 switch is off), need_account, not_found, not_allowed, bad_name, bad_about, bad_slug, slug_taken,
-- bad_logo, bad_links, bad_mode, bad_role, not_member, owner_fixed, invite_only, declined, already_answered.

do $$
begin
  if to_regclass('public.ev_registrations') is null or to_regprocedure('public._ev_room_json(uuid, uuid)') is null
     or to_regprocedure('public._ev_open()') is null then
    raise exception 'events_r1_room_profile: run events_r1_events.sql, events_r1_registrations.sql and events_r1_rooms.sql first';
  end if;
  if not exists (select 1 from storage.buckets where id = 'crew-images' and public) then
    raise exception 'events_r1_room_profile: run crew_rooms.sql first (the public crew-images bucket is missing)';
  end if;
end $$;

-- ------------------------------------------------------------------ the role ---
-- (a) above. Same method as crew_stage_voice.sql: drop whatever role check there is, add the wider one.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.crew_members'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%role%'
  loop
    execute format('alter table public.crew_members drop constraint %I', c);
  end loop;
  alter table public.crew_members add constraint crew_members_role_check check (role in ('owner', 'admin', 'host', 'member'));
end $$;

-- ------------------------------------------------------------------ helpers ---
-- A room address: lowercase letters and digits with single dashes, 3 to 40 long, not a reserved word, and never shaped like a uuid
-- (a room with no profile is reached at its id, so a custom address that looked like another room's id would take it over).
create or replace function public._ev_slug_ok(p text) returns boolean
language sql immutable as $$
  select p is not null and char_length(p) between 3 and 40 and p ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     and p !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and p <> all (array['hq', 'new', 'create', 'admin', 'api', 'host', 'event', 'events', 'rooms', 'room', 'r', 'map', 'me', 'dev', 'login']);
$$;
revoke all on function public._ev_slug_ok(text) from public, anon, authenticated;

-- "South Social" -> "south-social" (the same as slugFromName in src/lib/events-r1/roomRules.ts, without the accent folding).
create or replace function public._ev_slug_from_name(p_name text) returns text
language plpgsql immutable as $$
declare b text := left(trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g')), 40);
begin
  b := trim(both '-' from b);
  if b = '' then b := 'room'; end if;
  if char_length(b) < 3 then b := b || '-room'; end if;
  if not public._ev_slug_ok(b) then b := left(b, 35) || '-room'; end if;
  return b;
end $$;
revoke all on function public._ev_slug_from_name(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ profile table ---
-- One row per room that has a profile. A room without a row is normal (every room made before this file): it reads as no about, no links,
-- its id as the slug, and a join mode taken from crews.visibility.
create table if not exists public.ev_room_profiles (
  crew_id    uuid primary key references public.crews(id) on delete cascade,
  slug       text not null,
  about      text not null default '' check (char_length(about) <= 600),
  links      jsonb not null default '{}'::jsonb check (jsonb_typeof(links) = 'object' and octet_length(links::text) < 1500),
  join_mode  text not null default 'open' check (join_mode in ('open', 'ask', 'invite')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  -- a room reached at its own id (no custom address yet), or a good address
  constraint ev_room_profiles_slug_ok check (slug = crew_id::text or public._ev_slug_ok(slug))
);
create unique index if not exists ev_room_profiles_slug_uq on public.ev_room_profiles (slug);
alter table public.ev_room_profiles enable row level security;
revoke all on table public.ev_room_profiles from public, anon, authenticated;

create table if not exists public.ev_room_requests (
  id         uuid primary key default gen_random_uuid(),
  crew_id    uuid not null references public.crews(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  unique (crew_id, user_id)
);
create index if not exists ev_room_requests_pending_idx on public.ev_room_requests (crew_id, created_at) where status = 'pending';
alter table public.ev_room_requests enable row level security;
revoke all on table public.ev_room_requests from public, anon, authenticated;

create table if not exists public.ev_room_notices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  crew_id    uuid not null references public.crews(id) on delete cascade,
  kind       text not null check (kind in ('request_approved')),
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists ev_room_notices_user_idx on public.ev_room_notices (user_id, created_at desc) where seen_at is null;
alter table public.ev_room_notices enable row level security;
revoke all on table public.ev_room_notices from public, anon, authenticated;

-- ------------------------------------------------------------------ who is what ---
-- A user's role in a room ('owner', 'admin', 'host', 'member') or null when not in it.
create or replace function public._ev_room_role(p_room uuid, p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role from public.crew_members m where m.crew_id = p_room and m.user_id = p_user;
$$;
revoke all on function public._ev_room_role(uuid, uuid) from public, anon, authenticated;

-- Owner, admin or staff: the profile, the requests, the roles.
create or replace function public._ev_room_admin(p_room uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (public._ev_staff() or public._ev_room_role(p_room, auth.uid()) in ('owner', 'admin'));
$$;
revoke all on function public._ev_room_admin(uuid) from public, anon, authenticated;

-- Owner, admin or host: creates events as the room, sees who went but has not joined. (See (b) above for the door.)
create or replace function public._ev_room_can_host(p_room uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_user is not null and public._ev_room_role(p_room, p_user) in ('owner', 'admin', 'host');
$$;
revoke all on function public._ev_room_can_host(uuid, uuid) from public, anon, authenticated;

-- The room's join mode: the profile's, else from the old visibility (open -> open, private -> invite).
create or replace function public._ev_join_mode(p_room uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.join_mode from public.ev_room_profiles p where p.crew_id = c.id),
                  case when c.visibility = 'open' then 'open' else 'invite' end)
    from public.crews c where c.id = p_room;
$$;
revoke all on function public._ev_join_mode(uuid) from public, anon, authenticated;

create or replace function public._ev_person_name(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(pr.display_name), ''), pr.handle, 'Hopper') from public.profiles pr where pr.id = p_user;
$$;
revoke all on function public._ev_person_name(uuid) from public, anon, authenticated;

-- A logo link: https (or the local stack's own http storage while local_http_covers is on) into crew-images/room-logos/<uuid>/<file>.
create or replace function public._ev_logo_ok(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p is not null and char_length(p) <= 500 and (
    p ~ '^https://[^[:space:]/]+/storage/v1/object/public/crew-images/room-logos/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}\.(jpg|jpeg|png|webp)$'
    or (coalesce((select s.value = 'on' from public.ev_settings s where s.key = 'local_http_covers'), false)
        and p ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?/storage/v1/object/public/crew-images/room-logos/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}\.(jpg|jpeg|png|webp)$'));
$$;
revoke all on function public._ev_logo_ok(text) from public, anon, authenticated;

-- Links: an object with only instagram, x, website and whatsapp, each an https address up to 300 characters. Empty values are dropped.
create or replace function public._ev_links_clean(p jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v text; res jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  for k, v in select key, value #>> '{}' from jsonb_each(p) loop
    if k not in ('instagram', 'x', 'website', 'whatsapp') then return null; end if;
    if jsonb_typeof(p -> k) <> 'string' then return null; end if;
    v := btrim(v);
    if v = '' then continue; end if;
    if char_length(v) > 300 or v !~ '^https://[^[:space:]]+$' then return null; end if;
    res := res || jsonb_build_object(k, v);
  end loop;
  return res;
end $$;
revoke all on function public._ev_links_clean(jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ logo storage ---
-- Logos sit in the existing public crew-images bucket, one folder per user: room-logos/<user id>/<file>.jpg (2 MB, jpeg, png or webp:
-- the bucket's own limits). The cover policies (events_r1_covers.sql) only match event-covers/, so a folder of its own needs its own three.
create or replace function public._ev_logo_path_owner(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.has_account()
     and array_length(storage.foldername(p_name), 1) = 2
     and (storage.foldername(p_name))[1] = 'room-logos'
     and (storage.foldername(p_name))[2] = auth.uid()::text
     and storage.filename(p_name) ~ '^[A-Za-z0-9._-]{1,120}\.(jpg|jpeg|png|webp)$';
$$;
revoke all on function public._ev_logo_path_owner(text) from public, anon;
grant execute on function public._ev_logo_path_owner(text) to authenticated;

drop policy if exists events_r1_logo_upload on storage.objects;
create policy events_r1_logo_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'crew-images' and public._ev_logo_path_owner(name));
drop policy if exists events_r1_logo_read on storage.objects;
create policy events_r1_logo_read on storage.objects for select to authenticated
  using (bucket_id = 'crew-images' and public._ev_logo_path_owner(name));
drop policy if exists events_r1_logo_remove on storage.objects;
create policy events_r1_logo_remove on storage.objects for delete to authenticated
  using (bucket_id = 'crew-images' and public._ev_logo_path_owner(name));

-- ------------------------------------------------------------------ reading a room ---
-- Address to id: the profile's slug, or a room's own id. null when there is none. Says nothing about who may open it (the readers do).
create or replace function public.ev_room_by_slug(p_slug text) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare k text := lower(btrim(coalesce(p_slug, ''))); r uuid;
begin
  if k = '' then return null; end if;
  select p.crew_id into r from public.ev_room_profiles p where p.slug = k;
  if r is not null then return r; end if;
  if k ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select c.id into r from public.crews c where c.id = k::uuid;
  end if;
  return r;
end $$;
revoke all on function public.ev_room_by_slug(text) from public;
grant execute on function public.ev_room_by_slug(text) to anon, authenticated;

-- The room as the app reads it (RoomSummary plus the profile): _ev_room_json with the profile fields laid over it.
create or replace function public._ev_room_profile_json(p_room uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  j       jsonb := public._ev_room_json(p_room, p_user);
  p       public.ev_room_profiles;
  v_role  text;
  v_req   text := 'none';
  v_pend  int := 0;
begin
  if j is null then return null; end if;
  select * into p from public.ev_room_profiles where crew_id = p_room;
  v_role := public._ev_room_role(p_room, p_user);
  if v_role is null and p_user is not null then
    select case r.status when 'pending' then 'pending' when 'declined' then 'declined' else 'none' end into v_req
      from public.ev_room_requests r where r.crew_id = p_room and r.user_id = p_user;
    v_req := coalesce(v_req, 'none');
  end if;
  if v_role in ('owner', 'admin') or (p_user is not null and exists (select 1 from public.profiles pr where pr.id = p_user and pr.is_admin)) then
    select count(*)::int into v_pend from public.ev_room_requests r where r.crew_id = p_room and r.status = 'pending';
  end if;
  return j || jsonb_build_object(
    'slug', coalesce(p.slug, p_room::text), 'about', coalesce(p.about, ''), 'links', coalesce(p.links, '{}'::jsonb),
    'join_mode', public._ev_join_mode(p_room), 'my_role', v_role, 'request', v_req, 'pending_requests', v_pend);
end $$;
revoke all on function public._ev_room_profile_json(uuid, uuid) from public, anon, authenticated;

-- One room by id. Opens for staff, members, and any visitor of an open or ask room; an invite room only with its code (p_invite).
-- null otherwise. (ev_room, the older reader, keeps answering for open rooms and members only.)
create or replace function public.ev_room_profile(p_room uuid, p_invite text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  c  public.crews;
  m  text;
begin
  select * into c from public.crews where id = p_room;
  if c.id is null then return null; end if;
  m := public._ev_join_mode(p_room);
  if m = 'invite' and not (public._ev_staff() or public._ev_room_role(p_room, me) is not null
                           or (p_invite is not null and upper(btrim(p_invite)) = c.invite_code)) then
    return null;
  end if;
  return public._ev_room_profile_json(p_room, me);
end $$;
revoke all on function public.ev_room_profile(uuid, text) from public;
grant execute on function public.ev_room_profile(uuid, text) to anon, authenticated;

-- Discover: open and ask rooms the viewer is not in, the biggest first (invite rooms are never listed). ev_rooms_for_me's own discover
-- list only shows crews.visibility = 'open', so ask rooms (private) would never appear there: the app uses this one instead.
create or replace function public.ev_discover_rooms() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); v_hq uuid := public.ev_ensure_hq_id();
begin
  return coalesce((
    select jsonb_agg(x.js order by (x.js ->> 'members')::int desc, x.js ->> 'id')
      from (select public._ev_room_profile_json(c.id, me) as js
              from public.crews c
             where public._ev_join_mode(c.id) in ('open', 'ask') and (v_hq is null or c.id <> v_hq)
               and not exists (select 1 from public.crew_members m where m.crew_id = c.id and m.user_id = me)
             order by (select count(*) from public.crew_members m2 where m2.crew_id = c.id) desc, c.id
             limit 20) x
     where x.js is not null), '[]'::jsonb);
end $$;
revoke all on function public.ev_discover_rooms() from public;
grant execute on function public.ev_discover_rooms() to anon, authenticated;

-- Lagos HQ's id without making it (ev_ensure_hq makes it and writes). null when there is none.
create or replace function public.ev_ensure_hq_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select h.crew_id from public.ev_hq h limit 1;
$$;
revoke all on function public.ev_ensure_hq_id() from public, anon, authenticated;

-- ------------------------------------------------------------------ making and changing ---
-- Shared by ev_create_room and ev_update_room: a bad value answers its reason, a good patch is applied by the caller.
-- p_events: the caller's own events to put in the room (they must be the event's host and an owner, admin or host of the room).
create or replace function public._ev_post_events(p_room uuid, p_events uuid[], p_user uuid) returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_events is null or cardinality(p_events) = 0 or not public._ev_room_can_host(p_room, p_user) then return 0; end if;
  update public.events e set room_id = p_room
   where e.id = any (p_events) and coalesce(e.host_id, e.created_by) = p_user and e.room_id is distinct from p_room;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public._ev_post_events(uuid, uuid[], uuid) from public, anon, authenticated;

create or replace function public.ev_create_room(
  p_name text, p_about text default '', p_slug text default null, p_logo_url text default null,
  p_links jsonb default '{}'::jsonb, p_join_mode text default 'open', p_events uuid[] default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me     uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_about text := btrim(coalesce(p_about, ''));
  v_slug text;
  v_links jsonb;
  v_id   uuid;
  v_try  int := 1;
begin
  if not public._ev_open() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if me is null or not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 50 then return jsonb_build_object('ok', false, 'reason', 'bad_name'); end if;
  if char_length(v_about) > 600 then return jsonb_build_object('ok', false, 'reason', 'bad_about'); end if;
  if p_join_mode is null or p_join_mode not in ('open', 'ask', 'invite') then return jsonb_build_object('ok', false, 'reason', 'bad_mode'); end if;
  v_links := public._ev_links_clean(coalesce(p_links, '{}'::jsonb));
  if v_links is null then return jsonb_build_object('ok', false, 'reason', 'bad_links'); end if;
  if p_logo_url is not null and btrim(p_logo_url) <> '' and not public._ev_logo_ok(btrim(p_logo_url)) then
    return jsonb_build_object('ok', false, 'reason', 'bad_logo');
  end if;
  if p_slug is not null and btrim(p_slug) <> '' then
    v_slug := lower(btrim(p_slug));
    if not public._ev_slug_ok(v_slug) then return jsonb_build_object('ok', false, 'reason', 'bad_slug'); end if;
    if exists (select 1 from public.ev_room_profiles x where x.slug = v_slug) then return jsonb_build_object('ok', false, 'reason', 'slug_taken'); end if;
  else
    v_slug := public._ev_slug_from_name(v_name);
    while exists (select 1 from public.ev_room_profiles x where x.slug = v_slug) loop
      v_try := v_try + 1;
      v_slug := left(public._ev_slug_from_name(v_name), 36) || '-' || v_try;
    end loop;
  end if;

  -- The old function makes the crew and its owner row, and keeps its own rules (a name of 2 to 50 characters).
  v_id := public.create_crew(v_name, case when p_join_mode = 'open' then 'open' else 'private' end);
  insert into public.ev_room_profiles (crew_id, slug, about, links, join_mode, updated_by)
  values (v_id, v_slug, v_about, v_links, p_join_mode, me);
  if p_logo_url is not null and btrim(p_logo_url) <> '' then
    update public.crews set logo_url = btrim(p_logo_url) where id = v_id;
  end if;
  perform public._ev_post_events(v_id, p_events, me);
  return jsonb_build_object('ok', true, 'id', v_id, 'slug', v_slug);
exception
  when unique_violation then return jsonb_build_object('ok', false, 'reason', 'slug_taken');   -- someone took it a moment ago
end $$;
revoke all on function public.ev_create_room(text, text, text, text, jsonb, text, uuid[]) from public, anon;
grant execute on function public.ev_create_room(text, text, text, text, jsonb, text, uuid[]) to authenticated;

-- Change a room. p_patch may hold name, about, slug, logo_url (null or '' clears it), links, join_mode: only the keys present change.
-- Owner, admin or staff. Answers jsonb { ok: true, slug } or { ok: false, reason }.
create or replace function public.ev_update_room(p_room uuid, p_patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me      uuid := auth.uid();
  c       public.crews;
  p       public.ev_room_profiles;
  v_name  text;
  v_about text;
  v_slug  text;
  v_links jsonb;
  v_mode  text;
  v_logo  text;
begin
  if not public._ev_open() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if me is null or not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  select * into c from public.crews where id = p_room;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public._ev_room_admin(p_room) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_name'); end if;
  select * into p from public.ev_room_profiles where crew_id = p_room;
  v_slug := coalesce(p.slug, p_room::text);
  v_about := coalesce(p.about, '');
  v_links := coalesce(p.links, '{}'::jsonb);
  v_mode := public._ev_join_mode(p_room);

  if p_patch ? 'name' then
    v_name := btrim(coalesce(p_patch ->> 'name', ''));
    if char_length(v_name) < 2 or char_length(v_name) > 50 then return jsonb_build_object('ok', false, 'reason', 'bad_name'); end if;
  end if;
  if p_patch ? 'about' then
    v_about := btrim(coalesce(p_patch ->> 'about', ''));
    if char_length(v_about) > 600 then return jsonb_build_object('ok', false, 'reason', 'bad_about'); end if;
  end if;
  if p_patch ? 'slug' and lower(btrim(coalesce(p_patch ->> 'slug', ''))) <> v_slug then
    v_slug := lower(btrim(coalesce(p_patch ->> 'slug', '')));
    if not public._ev_slug_ok(v_slug) then return jsonb_build_object('ok', false, 'reason', 'bad_slug'); end if;
    if exists (select 1 from public.ev_room_profiles x where x.slug = v_slug and x.crew_id <> p_room) then
      return jsonb_build_object('ok', false, 'reason', 'slug_taken');
    end if;
  end if;
  if p_patch ? 'links' then
    v_links := public._ev_links_clean(p_patch -> 'links');
    if v_links is null then return jsonb_build_object('ok', false, 'reason', 'bad_links'); end if;
  end if;
  if p_patch ? 'join_mode' then
    v_mode := p_patch ->> 'join_mode';
    if v_mode is null or v_mode not in ('open', 'ask', 'invite') then return jsonb_build_object('ok', false, 'reason', 'bad_mode'); end if;
  end if;
  if p_patch ? 'logo_url' then
    v_logo := nullif(btrim(coalesce(p_patch ->> 'logo_url', '')), '');
    if v_logo is not null and not public._ev_logo_ok(v_logo) then return jsonb_build_object('ok', false, 'reason', 'bad_logo'); end if;
  end if;

  insert into public.ev_room_profiles (crew_id, slug, about, links, join_mode, updated_by, updated_at)
  values (p_room, v_slug, v_about, v_links, v_mode, me, now())
  on conflict (crew_id) do update
     set slug = excluded.slug, about = excluded.about, links = excluded.links, join_mode = excluded.join_mode,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  if v_name is not null then update public.crews set name = v_name where id = p_room; end if;
  if p_patch ? 'logo_url' then update public.crews set logo_url = v_logo where id = p_room; end if;
  -- The old column keeps working for old code: open -> open, ask and invite -> private.
  update public.crews set visibility = case when v_mode = 'open' then 'open' else 'private' end where id = p_room;
  return jsonb_build_object('ok', true, 'slug', v_slug);
exception
  when unique_violation then return jsonb_build_object('ok', false, 'reason', 'slug_taken');
end $$;
revoke all on function public.ev_update_room(uuid, jsonb) from public, anon;
grant execute on function public.ev_update_room(uuid, jsonb) to authenticated;

-- Is hoppaz.fun/r/<slug> free? p_except is the room being edited (its own address is free). A bad shape is false.
create or replace function public.ev_slug_available(p_slug text, p_except uuid default null) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public._ev_slug_ok(lower(btrim(coalesce(p_slug, ''))))
     and not exists (select 1 from public.ev_room_profiles x
                      where x.slug = lower(btrim(p_slug)) and (p_except is null or x.crew_id <> p_except));
$$;
revoke all on function public.ev_slug_available(text, uuid) from public;
grant execute on function public.ev_slug_available(text, uuid) to anon, authenticated;

-- ------------------------------------------------------------------ joining ---
-- Join a room by its mode. Answers 'joined', 'requested' (ask), 'already', or a reason: not_open, need_account, not_found,
-- invite_only, declined. A right invite code (p_invite) gets into any mode at once and settles a waiting request.
create or replace function public.ev_join_room(p_room uuid, p_invite text default null) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me   uuid := auth.uid();
  c    public.crews;
  m    text;
  q    public.ev_room_requests;
  invited boolean;
begin
  if not public._ev_open() then return 'not_open'; end if;
  if me is null or not public.has_account() then return 'need_account'; end if;
  select * into c from public.crews where id = p_room;
  if c.id is null then return 'not_found'; end if;
  if public._ev_room_role(p_room, me) is not null then return 'already'; end if;
  m := public._ev_join_mode(p_room);
  invited := p_invite is not null and upper(btrim(p_invite)) = c.invite_code;
  if m = 'invite' and not invited then return 'invite_only'; end if;
  if m = 'ask' and not invited then
    select * into q from public.ev_room_requests where crew_id = p_room and user_id = me;
    if found then
      if q.status = 'pending' then return 'requested'; end if;
      if q.status = 'declined' then return 'declined'; end if;
    else
      insert into public.ev_room_requests (crew_id, user_id) values (p_room, me) on conflict do nothing;
      return 'requested';
    end if;
  end if;
  insert into public.crew_members (crew_id, user_id, role) values (p_room, me, 'member') on conflict do nothing;
  update public.ev_room_requests set status = 'approved', decided_at = now() where crew_id = p_room and user_id = me and status = 'pending';
  return 'joined';
end $$;
revoke all on function public.ev_join_room(uuid, text) from public, anon;
grant execute on function public.ev_join_room(uuid, text) to authenticated;

-- Waiting requests, oldest first. null for anyone who is not the owner, an admin or staff.
create or replace function public.ev_room_requests(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._ev_room_admin(p_room) then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'room_id', r.crew_id, 'user_id', r.user_id,
                                        'name', public._ev_person_name(r.user_id), 'created_at', r.created_at) order by r.created_at, r.id)
      from public.ev_room_requests r where r.crew_id = p_room and r.status = 'pending'), '[]'::jsonb);
end $$;
revoke all on function public.ev_room_requests(uuid) from public, anon;
grant execute on function public.ev_room_requests(uuid) to authenticated;

-- Approve or decline. Approve: the person becomes a member and gets a notice. Decline: nothing is sent. 'ok' or not_open, need_account,
-- not_found, not_allowed, already_answered.
create or replace function public.ev_decide_room_request(p_request uuid, p_approve boolean) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); q public.ev_room_requests;
begin
  if not public._ev_open() then return 'not_open'; end if;
  if me is null or not public.has_account() then return 'need_account'; end if;
  if p_approve is null then return 'not_found'; end if;
  select * into q from public.ev_room_requests where id = p_request for update;
  if q.id is null then return 'not_found'; end if;
  if not public._ev_room_admin(q.crew_id) then return 'not_allowed'; end if;
  if q.status <> 'pending' then return 'already_answered'; end if;
  update public.ev_room_requests set status = case when p_approve then 'approved' else 'declined' end, decided_at = now(), decided_by = me where id = q.id;
  if p_approve then
    insert into public.crew_members (crew_id, user_id, role) values (q.crew_id, q.user_id, 'member') on conflict do nothing;
    insert into public.ev_room_notices (user_id, crew_id, kind) values (q.user_id, q.crew_id, 'request_approved');
  end if;
  return 'ok';
end $$;
revoke all on function public.ev_decide_room_request(uuid, boolean) from public, anon;
grant execute on function public.ev_decide_room_request(uuid, boolean) to authenticated;

-- The invite code for the room's link (hoppaz.fun/r/<slug>?invite=<code>). null for anyone who is not the owner, an admin or staff.
create or replace function public.ev_room_invite_code(p_room uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select c.invite_code from public.crews c where c.id = p_room and public._ev_room_admin(p_room);
$$;
revoke all on function public.ev_room_invite_code(uuid) from public, anon;
grant execute on function public.ev_room_invite_code(uuid) to authenticated;

-- My unseen notices, newest first, and marking some seen.
create or replace function public.ev_my_room_notices() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'room_id', n.crew_id, 'room_name', c.name,
                                               'room_slug', coalesce(p.slug, c.id::text), 'kind', n.kind, 'created_at', n.created_at)
                            order by n.created_at desc, n.id), '[]'::jsonb)
    from public.ev_room_notices n
    join public.crews c on c.id = n.crew_id
    left join public.ev_room_profiles p on p.crew_id = n.crew_id
   where n.user_id = auth.uid() and n.seen_at is null;
$$;
revoke all on function public.ev_my_room_notices() from public, anon;
grant execute on function public.ev_my_room_notices() to authenticated;

create or replace function public.ev_mark_room_notices_seen(p_ids uuid[]) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return 'need_account'; end if;
  update public.ev_room_notices set seen_at = now() where user_id = auth.uid() and id = any (coalesce(p_ids, '{}')) and seen_at is null;
  return 'ok';
end $$;
revoke all on function public.ev_mark_room_notices_seen(uuid[]) from public, anon;
grant execute on function public.ev_mark_room_notices_seen(uuid[]) to authenticated;

-- ------------------------------------------------------------------ members and roles ---
-- People in the room, owner first, then admins, hosts, members. null unless the viewer is in the room (or staff).
create or replace function public.ev_room_members(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public._ev_staff() or public._ev_room_role(p_room, auth.uid()) is not null) then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', public._ev_person_name(m.user_id), 'role', m.role, 'joined_at', m.joined_at)
                     order by case m.role when 'owner' then 0 when 'admin' then 1 when 'host' then 2 else 3 end, m.joined_at, m.user_id)
      from (select * from public.crew_members where crew_id = p_room order by joined_at limit 500) m), '[]'::jsonb);
end $$;
revoke all on function public.ev_room_members(uuid) from public, anon;
grant execute on function public.ev_room_members(uuid) to authenticated;

-- Set a member's role to admin, host or member. The owner (or staff) sets any of the three; an admin sets host or member, and cannot
-- touch another admin. Nobody changes the owner. 'ok' or not_open, need_account, bad_role, not_allowed, not_member, owner_fixed.
create or replace function public.ev_set_room_role(p_room uuid, p_user uuid, p_role text) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); mine text; theirs text;
begin
  if not public._ev_open() then return 'not_open'; end if;
  if me is null or not public.has_account() then return 'need_account'; end if;
  if p_role is null or p_role not in ('admin', 'host', 'member') then return 'bad_role'; end if;
  if not public._ev_room_admin(p_room) then return 'not_allowed'; end if;
  mine := public._ev_room_role(p_room, me);
  theirs := public._ev_room_role(p_room, p_user);
  if theirs is null then return 'not_member'; end if;
  if theirs = 'owner' then return 'owner_fixed'; end if;
  if mine = 'admin' and not public._ev_staff() and (p_role = 'admin' or theirs = 'admin') then return 'not_allowed'; end if;
  update public.crew_members set role = p_role where crew_id = p_room and user_id = p_user;
  return 'ok';
end $$;
revoke all on function public.ev_set_room_role(uuid, uuid, text) from public, anon;
grant execute on function public.ev_set_room_role(uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------------ went but have not joined ---
-- { count, guests: [{ user_id, name }] } : people going or checked in at any of the room's events (not cancelled) who are not members.
-- count is the full number, guests the first 50 by name. null unless the viewer is an owner, admin or host of the room, or staff.
create or replace function public.ev_room_guests_not_joined(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_count int; v_guests jsonb;
begin
  if not (public._ev_staff() or public._ev_room_can_host(p_room, auth.uid())) then return null; end if;
  with g as (
    select r.user_id, min(r.name) as name
      from public.ev_registrations r
      join public.events e on e.id = r.event_id
     where e.room_id = p_room and e.status in ('live', 'unlisted', 'ended') and r.status in ('going', 'checked_in')
       and not exists (select 1 from public.crew_members m where m.crew_id = p_room and m.user_id = r.user_id)
     group by r.user_id)
  select (select count(*) from g)::int,
         coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', coalesce(nullif(btrim(x.name), ''), public._ev_person_name(x.user_id))) order by x.name, x.user_id)
                     from (select * from g order by name, user_id limit 50) x), '[]'::jsonb)
    into v_count, v_guests;
  return jsonb_build_object('count', v_count, 'guests', v_guests);
end $$;
revoke all on function public.ev_room_guests_not_joined(uuid) from public, anon;
grant execute on function public.ev_room_guests_not_joined(uuid) to authenticated;

-- Put events into a room. The caller must be the event's host and an owner, admin or host of the room. Answers { ok, moved }.
create or replace function public.ev_post_events_as_room(p_room uuid, p_events uuid[]) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if not public._ev_open() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if me is null or not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  if not exists (select 1 from public.crews c where c.id = p_room) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public._ev_room_can_host(p_room, me) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  return jsonb_build_object('ok', true, 'moved', public._ev_post_events(p_room, p_events, me));
end $$;
revoke all on function public.ev_post_events_as_room(uuid, uuid[]) from public, anon;
grant execute on function public.ev_post_events_as_room(uuid, uuid[]) to authenticated;
