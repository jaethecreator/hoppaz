-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Open organiser rooms (CHANGE-006). One new file; it edits no existing file.
--
-- WHY: approving an organiser's event makes the organiser's room (ev_o_ensure_room, events_r1_outreach.sql). That room was made
-- 'invite' (dormant), so the link in an outreach DM showed a lock: "You need an invite to see this room". This file opens those rooms
-- to view while nobody has claimed them, so anyone (signed out too) sees the banner, logo, name, about and the events.
--
-- WHICH ROOMS: only a room Hoppaz made for a listed organiser and still holds. All of these must be true (_ev_room_listing_org):
--   * the room is flagged listed_by_staff (new column on ev_room_profiles, set by ev_o_ensure_room and by the backfill below),
--   * an organiser row points at it (ev_organisers.room_id) and that organiser has not claimed it,
--   * the room's owner is still the Hoppaz Listings account,
--   * none of the room's events is a community or invite event.
--   A room a host made is never flagged, so it is never opened. Queer community spaces are not rooms at all (queer_community.sql has its
--   own tables), so nothing here can reach them.
--
-- WHAT IT DOES
--   1. The switch 'open_organiser_rooms' in ev_settings, ON when this file runs. ev_set_open_organiser_rooms('on' | 'off') flips it and
--      opens (on) or closes back to invite only (off) every unclaimed organiser room that staff have not set by hand. It answers how
--      many rooms it changed.
--   2. Backfill: running this file opens the unclaimed organiser rooms that exist today (the same step as ev_set_open_organiser_rooms('on')).
--      Read how many it will touch first with: select public.ev_open_organiser_rooms_count();
--   3. New organiser rooms are made open while the switch is on (ev_o_ensure_room is replaced, see REPLACES).
--   4. Staff switch per room: ev_o_room_set_mode(organiser, 'open' | 'invite') from the staff desk ("Room: Open / Invite only"). Only for
--      an unclaimed organiser room; once the organiser claims it, the owner changes it in Room admin, Settings, as for any room.
--   5. A claim keeps the room's mode: _ev_cl_handover (events_r1_outreach_ready.sql) used to open a dormant room on claim. While the switch
--      is on it now leaves the mode as it is, so a room staff set to invite only stays invite only after the claim.
--   6. Chat stays read only until the room is claimed: a trigger refuses a new General line in an unclaimed organiser room while the switch
--      is on. Visitors can still join (the room is open).
--   7. ev_room_listing(room): what the room page needs to show the claim strip. Public (anon too): the organiser's display name, the event
--      the claim ask points at, and whether the viewer already asked. Never an email or a phone number.
--   8. ev_claim_ask_room(room, note): "Claim it" from the room. It is the CHANGE-005 ask (ev_claim_ask) on the organiser's latest event,
--      so it lands in the same staff list (ev_o_claim_asks) and is approved the same way. No second claim system.
--
-- RUN ORDER: after events_r1_room_profile.sql, events_r1_listings.sql, events_r1_outreach.sql, events_r1_transfer.sql and
-- events_r1_outreach_ready.sql. Safe to run twice. ONE TRANSACTION: begin ... commit.
-- REPLACES (create or replace, in this file only; the old files are untouched):
--   ev_o_ensure_room   (events_r1_outreach.sql: open while the switch is on, flagged listed_by_staff)
--   _ev_cl_handover    (events_r1_outreach_ready.sql: keeps the mode while the switch is on)
--   Run this file AFTER those two files whenever you run them again: running an older file again puts its copy back.
-- NEW: columns ev_room_profiles.listed_by_staff and ev_room_profiles.listed_mode_set; _ev_open_org_rooms_on, _ev_room_listing_org,
--      _ev_open_org_rooms_flag, _ev_open_org_rooms_apply, ev_set_open_organiser_rooms, ev_open_organiser_rooms_count, ev_o_room_set_mode, ev_room_listing,
--      ev_claim_ask_room, the trigger function _ev_listing_room_quiet and its trigger on crew_room_messages (only if that table is there).
-- UNDO: select public.ev_set_open_organiser_rooms('off');  (closes the unclaimed organiser rooms again; claimed rooms are not touched)
-- Test: supabase/tests/events_r1_open_rooms_test.sql
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.ev_room_profiles') is null or to_regclass('public.ev_organisers') is null then
    raise exception 'events_r1_open_rooms: run events_r1_room_profile.sql and events_r1_listings.sql first';
  end if;
  if to_regprocedure('public.ev_o_ensure_room(uuid)') is null then
    raise exception 'events_r1_open_rooms: run events_r1_outreach.sql first';
  end if;
  if to_regprocedure('public._ev_cl_handover(uuid, uuid, uuid, text)') is null or to_regprocedure('public.ev_claim_ask(uuid, text)') is null then
    raise exception 'events_r1_open_rooms: run events_r1_outreach_ready.sql first';
  end if;
end $$;

-- ================================================================== the switch and the flags ===
insert into public.ev_settings (key, value) values ('open_organiser_rooms', 'on') on conflict (key) do nothing;

create or replace function public._ev_open_org_rooms_on() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.value = 'on' from public.ev_settings s where s.key = 'open_organiser_rooms'), false);
$$;
revoke all on function public._ev_open_org_rooms_on() from public, anon, authenticated;

-- Hoppaz made this room for a listed organiser (set when it is made, kept after a claim as a record).
alter table public.ev_room_profiles add column if not exists listed_by_staff boolean not null default false;
-- Staff set this room's mode by hand on the desk: the switch on and off leaves it alone.
alter table public.ev_room_profiles add column if not exists listed_mode_set boolean not null default false;

-- The organiser of an unclaimed room Hoppaz made, or null for any other room (see the header for the rules).
create or replace function public._ev_room_listing_org(p_room uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id
    from public.ev_organisers o
    join public.ev_room_profiles p on p.crew_id = o.room_id and p.listed_by_staff
   where o.room_id = p_room
     and o.claimed_at is null and o.stage <> 'claimed'
     and public._ev_listings_uid() is not null
     and public._ev_xf_owner(p_room) = public._ev_listings_uid()
     and not exists (select 1 from public.events e where e.room_id = p_room and e.visibility in ('community', 'invite'))
   order by o.created_at, o.id
   limit 1;
$$;
revoke all on function public._ev_room_listing_org(uuid) from public, anon, authenticated;

-- Flag the rooms Hoppaz made that it still holds: an organiser's room, made by the Listings account (crews.created_by) and still owned by it.
-- Rooms made before this file have no flag; this finds them. Answers how many it flagged.
create or replace function public._ev_open_org_rooms_flag() returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n integer; v_lu uuid := public._ev_listings_uid();
begin
  if v_lu is null then return 0; end if;
  update public.ev_room_profiles p set listed_by_staff = true
    from public.ev_organisers o, public.crews c
   where o.room_id = p.crew_id and c.id = p.crew_id and not p.listed_by_staff
     and c.created_by = v_lu and public._ev_xf_owner(p.crew_id) = v_lu;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public._ev_open_org_rooms_flag() from public, anon, authenticated;

-- Set every unclaimed organiser room not set by hand to p_mode ('open' or 'invite'). Answers how many changed.
create or replace function public._ev_open_org_rooms_apply(p_mode text) returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  with target as (
    select p.crew_id from public.ev_room_profiles p
     where p.listed_by_staff and not p.listed_mode_set and p.join_mode <> p_mode
       and public._ev_room_listing_org(p.crew_id) is not null
  )
  update public.ev_room_profiles p set join_mode = p_mode, updated_at = now()
    from target t where p.crew_id = t.crew_id;
  get diagnostics n = row_count;
  update public.crews c set visibility = case when p_mode = 'open' then 'open' else 'private' end
   where c.id in (select p.crew_id from public.ev_room_profiles p
                   where p.listed_by_staff and not p.listed_mode_set and p.join_mode = p_mode
                     and public._ev_room_listing_org(p.crew_id) is not null);
  return n;
end $$;
revoke all on function public._ev_open_org_rooms_apply(text) from public, anon, authenticated;

-- Ola or the staff route. 'on' opens every unclaimed organiser room (not set by hand), 'off' closes them back to invite only.
-- Answers { ok, value, changed }.
create or replace function public.ev_set_open_organiser_rooms(p_value text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_value is null or p_value not in ('on', 'off') then return jsonb_build_object('ok', false, 'reason', 'bad_value'); end if;
  insert into public.ev_settings (key, value) values ('open_organiser_rooms', p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if p_value = 'on' then perform public._ev_open_org_rooms_flag(); end if;
  n := public._ev_open_org_rooms_apply(case when p_value = 'on' then 'open' else 'invite' end);
  return jsonb_build_object('ok', true, 'value', p_value, 'changed', n);
end $$;
revoke all on function public.ev_set_open_organiser_rooms(text) from public, anon, authenticated;
grant execute on function public.ev_set_open_organiser_rooms(text) to service_role;

-- How many rooms the backfill touches: the organiser rooms Hoppaz holds that are still invite only, and all unclaimed organiser rooms.
-- Read only. Run it before this file (it needs this file's helpers, so on a copy) or after, to see what is left.
create or replace function public.ev_open_organiser_rooms_count() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'unclaimed_rooms', count(*)::int,
    'invite_only', count(*) filter (where public._ev_join_mode(o.room_id) = 'invite')::int,
    'open', count(*) filter (where public._ev_join_mode(o.room_id) = 'open')::int,
    'set_by_hand', count(*) filter (where p.listed_mode_set)::int)
    from public.ev_organisers o join public.ev_room_profiles p on p.crew_id = o.room_id
   where public._ev_room_listing_org(o.room_id) = o.id;
$$;
revoke all on function public.ev_open_organiser_rooms_count() from public, anon, authenticated;
grant execute on function public.ev_open_organiser_rooms_count() to service_role;

-- ================================================================== the backfill ===
do $$
declare f integer; n integer;
begin
  f := public._ev_open_org_rooms_flag();
  raise notice 'events_r1_open_rooms: flagged % rooms Hoppaz made for organisers', f;
  if public._ev_open_org_rooms_on() then
    n := public._ev_open_org_rooms_apply('open');
    raise notice 'events_r1_open_rooms: opened % unclaimed organiser rooms', n;
  end if;
end $$;

-- ================================================================== new rooms ===
-- The organiser's one room: made on first use, reused for every later event. Owned by the Hoppaz Listings account. Open while the switch
-- open_organiser_rooms is on (an open room can show in Discover, which lists the biggest rooms first), else 'invite' (dormant) as before. Flagged
-- listed_by_staff. Raises no_listings_account when the account is not set up. (Replaces the copy in events_r1_outreach.sql.)
create or replace function public.ev_o_ensure_room(p_org uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o      public.ev_organisers;
  v_lu   uuid := public._ev_listings_uid();
  v_name text;
  v_slug text;
  v_try  integer := 1;
  v_id   uuid;
  v_mode text := case when public._ev_open_org_rooms_on() then 'open' else 'invite' end;
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

  insert into public.crews (name, created_by, visibility) values (v_name, v_lu, case when v_mode = 'open' then 'open' else 'private' end) returning id into v_id;
  insert into public.crew_members (crew_id, user_id, role) values (v_id, v_lu, 'owner');
  insert into public.ev_room_profiles (crew_id, slug, about, links, join_mode, listed_by_staff) values (v_id, v_slug, '', '{}'::jsonb, v_mode, true);
  update public.ev_organisers set room_id = v_id, updated_at = now() where id = p_org;
  return v_id;
end $$;

-- ================================================================== staff switch ===
-- "Room: Open / Invite only" on the staff desk. Service role (the desk route). Only an unclaimed organiser room; after a claim the owner
-- sets it in Room admin. Answers { ok, join_mode } or { ok: false, reason: bad_value | not_found | is_claimed }.
create or replace function public.ev_o_room_set_mode(p_org uuid, p_mode text, p_by text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  o      public.ev_organisers;
  v_room uuid;
begin
  if p_mode is null or p_mode not in ('open', 'invite') then return jsonb_build_object('ok', false, 'reason', 'bad_value'); end if;
  select * into o from public.ev_organisers where id = p_org for update;
  if not found or o.room_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_room := o.room_id;
  if public._ev_room_listing_org(v_room) is distinct from o.id then return jsonb_build_object('ok', false, 'reason', 'is_claimed'); end if;
  update public.ev_room_profiles set join_mode = p_mode, listed_mode_set = true, updated_at = now() where crew_id = v_room;
  update public.crews set visibility = case when p_mode = 'open' then 'open' else 'private' end where id = v_room;
  insert into public.ev_organiser_log (organiser_id, by_name, kind, body)
  values (o.id, left(coalesce(nullif(btrim(p_by), ''), 'staff'), 60), 'note', 'Room set to ' || case when p_mode = 'open' then 'Open' else 'Invite only' end || '.');
  return jsonb_build_object('ok', true, 'join_mode', p_mode);
end $$;
revoke all on function public.ev_o_room_set_mode(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ev_o_room_set_mode(uuid, text, text) to service_role;

-- What the desk shows next to the switch: the room's mode and whether staff may still change it (only while unclaimed). null with no room.
create or replace function public.ev_o_room_mode(p_org uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('join_mode', public._ev_join_mode(o.room_id),
                            'switchable', public._ev_room_listing_org(o.room_id) is not distinct from o.id,
                            'set_by_hand', coalesce((select p.listed_mode_set from public.ev_room_profiles p where p.crew_id = o.room_id), false))
    from public.ev_organisers o
   where o.id = p_org and o.room_id is not null and exists (select 1 from public.crews c where c.id = o.room_id);
$$;
revoke all on function public.ev_o_room_mode(uuid) from public, anon, authenticated;
grant execute on function public.ev_o_room_mode(uuid) to service_role;

-- ================================================================== the room page ===
-- What the claim strip needs, or null when the room is not an unclaimed organiser room (or the switch is off).
-- { name, claim_event_id, my_claim: 'none' | 'pending', claims_on }. The name is the organiser's public name. No email, no phone.
create or replace function public.ev_room_listing(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me     uuid := auth.uid();
  v_org  uuid;
  o      public.ev_organisers;
  v_ev   uuid;
begin
  if not public._ev_open_org_rooms_on() then return null; end if;
  v_org := public._ev_room_listing_org(p_room);
  if v_org is null then return null; end if;
  select * into o from public.ev_organisers where id = v_org;
  select e.id into v_ev from public.events e
   where e.room_id = p_room and e.organiser_id = v_org and e.visibility = 'public' and e.status in ('live', 'unlisted')
   order by e.starts_at desc, e.id limit 1;
  return jsonb_build_object(
    'name', coalesce(nullif(btrim(o.name), ''), (select c.name from public.crews c where c.id = p_room)),
    'claim_event_id', v_ev,
    'claims_on', public._ev_claims_on(),
    'my_claim', case when me is not null and exists (
                  select 1 from public.ev_claim_asks a
                   where a.user_id = me and a.status = 'new'
                     and (a.organiser_id = v_org or exists (select 1 from public.events e where e.id = a.event_id and e.room_id = p_room)))
                then 'pending' else 'none' end);
end $$;
revoke all on function public.ev_room_listing(uuid) from public;
grant execute on function public.ev_room_listing(uuid) to anon, authenticated;

-- "Claim it" from the room: the CHANGE-005 ask, on the organiser's latest public event in the room. Same answers as ev_claim_ask,
-- plus not_found when the room is not an unclaimed organiser room or has no event to point at.
create or replace function public.ev_claim_ask_room(p_room uuid, p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v jsonb := public.ev_room_listing(p_room);
begin
  if v is null or v ->> 'claim_event_id' is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return public.ev_claim_ask((v ->> 'claim_event_id')::uuid, p_note);
end $$;
revoke all on function public.ev_claim_ask_room(uuid, text) from public, anon;
grant execute on function public.ev_claim_ask_room(uuid, text) to authenticated;

-- ================================================================== chat stays read only ===
-- A new General line in an unclaimed organiser room is refused while the switch is on. The Hoppaz Listings account and staff may still post.
create or replace function public._ev_listing_room_quiet() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(new.scope, 'general') = 'general' and public._ev_open_org_rooms_on()
     and public._ev_room_listing_org(new.crew_id) is not null
     and auth.uid() is distinct from public._ev_listings_uid() and not public._ev_staff() then
    raise exception 'room_not_claimed' using hint = 'The chat opens when the organiser claims this room.';
  end if;
  return new;
end $$;
revoke all on function public._ev_listing_room_quiet() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.crew_room_messages') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crew_room_messages' and column_name = 'crew_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crew_room_messages' and column_name = 'scope') then
    execute 'drop trigger if exists ev_listing_room_quiet on public.crew_room_messages';
    execute 'create trigger ev_listing_room_quiet before insert on public.crew_room_messages for each row execute function public._ev_listing_room_quiet()';
  else
    raise notice 'events_r1_open_rooms: crew_room_messages (crew_id, scope) not found, so the read only chat is left to the app';
  end if;
end $$;

-- ================================================================== the claim keeps the mode ===
-- The room and its upcoming events go to p_to. (Replaces the copy in events_r1_outreach_ready.sql; the only change is the join mode:
-- while open_organiser_rooms is on, the room keeps the mode it has. With the switch off it opens a dormant room as before.)
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
  if v_prev is not null and v_prev = v_list and public._ev_join_mode(p_room) = 'invite' and not public._ev_open_org_rooms_on() then
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

commit;
