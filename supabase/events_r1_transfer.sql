-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- File 3 of 3 for the outreach flow (docs/OUTREACH-FLOW.md): the room transfer, the claim request and the switch to Hoppaz tickets.
--   * ev_o_transfer_create / ev_o_transfer_revoke     staff (service role): make and cancel a claim link for an organiser's room
--   * ev_transfer_preview(hash)                        anyone with the link: what the room is, never the full email
--   * ev_transfer_accept(hash)                         the organiser, signed in with the link's email: the room and its upcoming events become theirs
--   * ev_transfer_create_owner / ev_transfers_for_room / ev_transfer_revoke_owner   an owner hands a room to someone else
--   * ev_claim_request(...)                            "Is this your event?" on a listing, from anyone
--   * ev_listing_use_hoppaz(event)                     a claimed listing switches from the organiser's ticket page to Hoppaz tickets
-- RUN ORDER: events_r1_listings.sql (tables), events_r1_outreach.sql (ev_o_ensure_room), then this file. It also needs the room files:
--   events_r1_events.sql, events_r1_rooms.sql (_ev_is_hq), events_r1_room_profile.sql (ev_room_profiles, _ev_room_role). Safe to run again.
--   It replaces no existing function and edits no existing file. Helpers start with _ev_xf_.
-- THE TOKEN. The link token is never stored and never seen here. Every function takes sha256(token) as 64 hex characters.
-- THE ACCEPT, in one transaction:
--   1. take a lock on the room, then on the transfer row (two people accepting at once go one after the other)
--   2. the link must be pending, not expired, not cancelled; the caller must have an account
--   3. the caller's confirmed sign-in email, lower case, must equal the link's email. A wrong email does NOT use the link up: it counts
--      an attempt, and the 10th attempt cancels the link. (That counter is the one thing a failed accept keeps.)
--   4. no paid order may sit on an upcoming event that would move (paid_sales). Nothing has been changed by then.
--   5. then the caller becomes the room's owner, the previous owner goes (the Hoppaz Listings account leaves the room; a person stays as a
--      plain member), crews.created_by follows, the upcoming events of the previous owner in that room get the caller as host, a dormant
--      (invite) Listings room opens, the organiser becomes claimed, the other open links of the room are cancelled, and the log gets lines.
-- Reasons: not_open, need_account, invalid_link, link_expired, link_used, link_revoked, wrong_email, paid_sales, bad_email, bad_name,
--   bad_phone, bad_note, not_found, not_allowed, already_pending, organiser_declined, is_claimed, try_again_later,
--   set_tickets_first, not_claimed.
-- Test: supabase/tests/events_r1_transfer_test.sql
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.ev_transfers') is null or to_regclass('public.ev_organisers') is null or to_regclass('public.ev_claim_requests') is null
     or to_regprocedure('public._ev_listings_uid()') is null then
    raise exception 'events_r1_transfer: run events_r1_listings.sql first';
  end if;
  if to_regclass('public.ev_room_profiles') is null or to_regprocedure('public._ev_room_role(uuid, uuid)') is null
     or to_regprocedure('public._ev_room_can_run(uuid, uuid)') is null then
    raise exception 'events_r1_transfer: run events_r1_room_profile.sql first';
  end if;
  if to_regprocedure('public._ev_open()') is null or to_regprocedure('public._ev_is_hq(uuid)') is null or to_regclass('public.ev_ticket_types') is null then
    raise exception 'events_r1_transfer: run events_r1_events.sql and events_r1_rooms.sql first';
  end if;
end $$;

-- ------------------------------------------------------------------ helpers ---
-- The staff label, 60 characters at most.
create or replace function public._ev_xf_by(p text) returns text
language sql immutable as $$ select left(coalesce(nullif(btrim(p), ''), 'staff'), 60); $$;
revoke all on function public._ev_xf_by(text) from public, anon, authenticated;

create or replace function public._ev_xf_email_ok(p text) returns boolean
language sql immutable as $$
  select p is not null and char_length(p) <= 254 and p ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
$$;
revoke all on function public._ev_xf_email_ok(text) from public, anon, authenticated;

-- "jae@gmail.com" -> "j***@gmail.com"
create or replace function public._ev_xf_hint(p text) returns text
language sql immutable as $$
  select left(split_part(p, '@', 1), 1) || '***@' || split_part(p, '@', 2);
$$;
revoke all on function public._ev_xf_hint(text) from public, anon, authenticated;

-- The hash as 64 lower case hex characters, or null.
create or replace function public._ev_xf_hash(p text) returns text
language sql immutable as $$
  select case when lower(btrim(coalesce(p, ''))) ~ '^[0-9a-f]{64}$' then lower(btrim(p)) end;
$$;
revoke all on function public._ev_xf_hash(text) from public, anon, authenticated;

-- The caller's sign-in email, lower case, only when the address is confirmed. Null otherwise.
create or replace function public._ev_xf_my_email() returns text
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select lower(btrim(u.email)) from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null and coalesce(u.email, '') <> '';
$$;
revoke all on function public._ev_xf_my_email() from public, anon, authenticated;

-- One line on the organiser's log. No organiser, no line.
create or replace function public._ev_xf_log(p_org uuid, p_by text, p_body text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_org is null then return; end if;
  insert into public.ev_organiser_log (organiser_id, by_name, kind, body) values (p_org, left(p_by, 60), 'transfer', left(p_body, 2000));
end $$;
revoke all on function public._ev_xf_log(uuid, text, text) from public, anon, authenticated;

-- The owner of a room: the creator if still an owner, else the oldest owner.
create or replace function public._ev_xf_owner(p_room uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.user_id from public.crew_members m join public.crews c on c.id = m.crew_id
   where m.crew_id = p_room and m.role = 'owner'
   order by (m.user_id = c.created_by) desc, m.joined_at, m.user_id limit 1;
$$;
revoke all on function public._ev_xf_owner(uuid) from public, anon, authenticated;

-- The events that move with a room: the previous owner's, in that room, not cancelled, not over.
create or replace function public._ev_xf_moving(p_room uuid, p_prev uuid) returns table (id uuid, title text, starts_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.title, e.starts_at from public.events e
   where p_prev is not null and e.room_id = p_room and e.host_id = p_prev and e.status <> 'cancelled'
     and coalesce(e.ends_at, e.starts_at + interval '3 hours') > now();
$$;
revoke all on function public._ev_xf_moving(uuid, uuid) from public, anon, authenticated;

-- A transfer as the app reads it (Transfer in src/lib/events-r1/types.ts). Never the token hash. A pending link past its time reads expired.
create or replace function public._ev_xf_json(t public.ev_transfers) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'room_id', t.room_id, 'room_name', coalesce((select c.name from public.crews c where c.id = t.room_id), ''),
    'organiser_id', t.organiser_id, 'to_email', t.to_email,
    'status', case when t.status = 'pending' and t.expires_at <= now() then 'expired' else t.status end,
    'created_at', t.created_at, 'created_by', t.created_by, 'expires_at', t.expires_at, 'accepted_at', t.accepted_at);
$$;
revoke all on function public._ev_xf_json(public.ev_transfers) from public, anon, authenticated;

-- ------------------------------------------------------- staff: make a link ---
-- The caller (the admin route) made the token and passes its sha256. Needs the organiser's room: made with ev_o_ensure_room if missing.
create or replace function public.ev_o_transfer_create(p_org uuid, p_email text, p_hash text, p_days integer default 14, p_by text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  o       public.ev_organisers;
  t       public.ev_transfers;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hash  text := public._ev_xf_hash(p_hash);
  v_days  integer := greatest(1, least(60, coalesce(p_days, 14)));
  v_by    text := public._ev_xf_by(p_by);
  v_room  uuid;
begin
  if not public._ev_xf_email_ok(v_email) then return jsonb_build_object('ok', false, 'reason', 'bad_email'); end if;
  if v_hash is null then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;
  select * into o from public.ev_organisers where id = p_org for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.stage = 'declined' or o.do_not_contact then return jsonb_build_object('ok', false, 'reason', 'organiser_declined'); end if;
  if o.stage = 'claimed' then return jsonb_build_object('ok', false, 'reason', 'is_claimed'); end if;
  v_room := o.room_id;
  if v_room is null or not exists (select 1 from public.crews c where c.id = v_room) then
    v_room := public.ev_o_ensure_room(p_org);
  end if;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if exists (select 1 from public.ev_transfers x where x.room_id = v_room and x.to_email = v_email and x.status = 'pending' and x.expires_at > now()) then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;
  insert into public.ev_transfers (kind, room_id, organiser_id, to_email, token_hash, created_by, expires_at)
  values ('claim', v_room, p_org, v_email, v_hash, v_by, now() + make_interval(days => v_days))
  returning * into t;
  if o.stage in ('pulled', 'listed') then
    update public.ev_organisers set stage = 'offered', updated_at = now() where id = p_org;
  end if;
  perform public._ev_xf_log(p_org, v_by, 'Claim link made for ' || v_email || ', open for ' || v_days || ' days.');
  return jsonb_build_object('ok', true, 'transfer', public._ev_xf_json(t));
exception
  when unique_violation then return jsonb_build_object('ok', false, 'reason', 'invalid_link');
end $$;
revoke all on function public.ev_o_transfer_create(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.ev_o_transfer_create(uuid, text, text, integer, text) to service_role;

create or replace function public.ev_o_transfer_revoke(p_id uuid, p_by text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare t public.ev_transfers; v_by text := public._ev_xf_by(p_by);
begin
  select * into t from public.ev_transfers where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if t.status = 'accepted' then return jsonb_build_object('ok', false, 'reason', 'link_used'); end if;
  if t.status = 'pending' then
    update public.ev_transfers set status = 'revoked', revoked_at = now() where id = t.id returning * into t;
    perform public._ev_xf_log(t.organiser_id, v_by, 'Claim link for ' || t.to_email || ' cancelled.');
  end if;
  return jsonb_build_object('ok', true, 'transfer', public._ev_xf_json(t));
end $$;
revoke all on function public.ev_o_transfer_revoke(uuid, text) from public, anon, authenticated;
grant execute on function public.ev_o_transfer_revoke(uuid, text) to service_role;

-- --------------------------------------------------------- the link preview ---
-- For the claim page, signed in or not. Gives the room and what moves, and the email only as j***@gmail.com.
create or replace function public.ev_transfer_preview(p_hash text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_hash text := public._ev_xf_hash(p_hash);
  t      public.ev_transfers;
  c      public.crews;
  p      public.ev_room_profiles;
  v_prev uuid;
begin
  if v_hash is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into t from public.ev_transfers where token_hash = v_hash;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if t.status = 'revoked' then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if t.status = 'accepted' then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if t.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  select * into c from public.crews where id = t.room_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into p from public.ev_room_profiles where crew_id = t.room_id;
  v_prev := case when t.kind = 'handover' then t.from_user else public._ev_xf_owner(t.room_id) end;
  return jsonb_build_object(
    'ok', true, 'kind', t.kind,
    'room', jsonb_build_object('name', c.name, 'slug', coalesce(p.slug, c.id::text), 'logo_url', c.logo_url, 'about', coalesce(p.about, '')),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'starts_at', m.starts_at) order by m.starts_at, m.id)
                          from (select * from public._ev_xf_moving(t.room_id, v_prev) order by starts_at, id limit 50) m), '[]'::jsonb),
    'email_hint', public._ev_xf_hint(t.to_email),
    'organiser_name', (select o.name from public.ev_organisers o where o.id = t.organiser_id),
    'expires_at', t.expires_at);
end $$;
revoke all on function public.ev_transfer_preview(text) from public;
grant execute on function public.ev_transfer_preview(text) to anon, authenticated, service_role;

-- -------------------------------------------------------------- the accept ---
create or replace function public.ev_transfer_accept(p_hash text) returns jsonb
language plpgsql volatile security definer set search_path = public, auth, pg_temp as $$
declare
  me       uuid := auth.uid();
  v_hash   text := public._ev_xf_hash(p_hash);
  t        public.ev_transfers;
  c        public.crews;
  v_room   uuid;
  v_prev   uuid;
  v_list   uuid := public._ev_listings_uid();
  v_mail   text;
  v_tries  integer;
  v_paid   integer := 0;
  v_moved  integer := 0;
  v_revoked integer := 0;
  v_other  boolean;
  v_org    uuid;
  v_name   text;
  v_slug   text;
begin
  if not public._ev_open() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if me is null then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  if v_hash is null then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;

  -- Lock order: the room first, then the transfer. Two accepts for one room wait for each other.
  select x.room_id into v_room from public.ev_transfers x where x.token_hash = v_hash;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;
  select * into c from public.crews where id = v_room for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;
  select * into t from public.ev_transfers where token_hash = v_hash for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;

  if t.status = 'accepted' then return jsonb_build_object('ok', false, 'reason', 'link_used'); end if;
  if t.status = 'revoked' then return jsonb_build_object('ok', false, 'reason', 'link_revoked'); end if;
  if t.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'link_expired'); end if;
  if not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  if public._ev_is_hq(v_room) then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;

  -- The email. A wrong one is counted and the link stays usable for the right person, until the 10th try cancels it.
  v_mail := public._ev_xf_my_email();
  if v_mail is null or v_mail <> t.to_email then
    update public.ev_transfers
       set attempts = attempts + 1,
           status = case when attempts + 1 >= 10 then 'revoked' else status end,
           revoked_at = case when attempts + 1 >= 10 then now() else revoked_at end
     where id = t.id returning attempts into v_tries;
    if v_tries >= 10 then
      perform public._ev_xf_log(t.organiser_id, 'system', 'Claim link for ' || t.to_email || ' cancelled after 10 wrong emails.');
      return jsonb_build_object('ok', false, 'reason', 'link_revoked');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'wrong_email');
  end if;

  -- The previous owner. A handover is only good while the person who started it still owns the room.
  if t.kind = 'handover' then
    if t.from_user is null or not exists (select 1 from public.crew_members m where m.crew_id = v_room and m.user_id = t.from_user and m.role = 'owner') then
      update public.ev_transfers set status = 'revoked', revoked_at = now() where id = t.id;
      return jsonb_build_object('ok', false, 'reason', 'link_revoked');
    end if;
    v_prev := t.from_user;
  else
    v_prev := public._ev_xf_owner(v_room);
  end if;

  -- Paid sales on an event that would move: refuse, change nothing.
  if v_prev is distinct from me and to_regclass('public.ev_orders') is not null then
    execute 'select count(*) from public.ev_orders o join public._ev_xf_moving($1, $2) m on m.id = o.event_id where o.status in (''paid'', ''refund_pending'')'
       into v_paid using v_room, v_prev;
    if v_paid > 0 then return jsonb_build_object('ok', false, 'reason', 'paid_sales'); end if;
  end if;

  v_other := exists (select 1 from public.crew_members m where m.user_id = me and m.role = 'owner' and m.crew_id <> v_room and not public._ev_is_hq(m.crew_id));
  v_org := coalesce(t.organiser_id, (select o.id from public.ev_organisers o where o.room_id = v_room));
  v_name := public._ev_person_name(me);

  -- The caller owns the room.
  insert into public.crew_members (crew_id, user_id, role) values (v_room, me, 'owner')
  on conflict (crew_id, user_id) do update set role = 'owner';
  -- The previous owner leaves (Hoppaz Listings) or stays as a plain member (a person).
  if v_prev is not null and v_prev <> me then
    if v_prev = v_list then
      delete from public.crew_members where crew_id = v_room and user_id = v_prev;
    else
      update public.crew_members set role = 'member' where crew_id = v_room and user_id = v_prev;
    end if;
    -- Their upcoming events in this room follow the room.
    update public.events e set host_id = me
     where e.id in (select m.id from public._ev_xf_moving(v_room, v_prev) m);
    get diagnostics v_moved = row_count;
  end if;
  update public.crews set created_by = me where id = v_room;
  -- A dormant room that Hoppaz Listings held opens up.
  if v_prev is not null and v_prev = v_list and public._ev_join_mode(v_room) = 'invite' then
    insert into public.ev_room_profiles (crew_id, slug, join_mode, updated_by) values (v_room, v_room::text, 'open', me)
    on conflict (crew_id) do update set join_mode = 'open', updated_by = me, updated_at = now();
    update public.crews set visibility = 'open' where id = v_room;
  end if;
  v_slug := coalesce((select p.slug from public.ev_room_profiles p where p.crew_id = v_room), v_room::text);

  -- The organiser is claimed (and a "no" from before is over: they came back).
  if v_org is not null then
    update public.ev_organisers
       set stage = 'claimed',
           claimed_at = case when t.kind = 'claim' then now() else coalesce(claimed_at, now()) end,
           claimed_by = me,
           email = coalesce(nullif(btrim(email), ''), t.to_email),
           do_not_contact = false, declined_at = null, updated_at = now()
     where id = v_org;
  end if;

  update public.ev_transfers set status = 'accepted', accepted_by = me, accepted_at = now() where id = t.id;
  update public.ev_transfers set status = 'revoked', revoked_at = now()
   where room_id = v_room and status = 'pending' and id <> t.id;
  get diagnostics v_revoked = row_count;

  perform public._ev_xf_log(v_org, 'system', case when t.kind = 'claim' then 'Claimed' else 'Handed over' end || ' to ' || v_name || ' (' || t.to_email || '). '
                                              || v_moved || ' upcoming events moved.');
  if v_revoked > 0 then
    perform public._ev_xf_log(v_org, 'system', v_revoked || ' other open links for this room cancelled.');
  end if;

  return jsonb_build_object('ok', true, 'room_id', v_room, 'slug', v_slug, 'moved_events', v_moved, 'already_owned_other', v_other);
end $$;
revoke all on function public.ev_transfer_accept(text) from public, anon;
grant execute on function public.ev_transfer_accept(text) to authenticated;

-- -------------------------------------------------- an owner hands a room over ---
create or replace function public.ev_transfer_create_owner(p_room uuid, p_email text, p_hash text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me      uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hash  text := public._ev_xf_hash(p_hash);
  c       public.crews;
  t       public.ev_transfers;
  v_org   uuid;
  v_name  text;
begin
  if not public._ev_open() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if me is null or not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  if not public._ev_xf_email_ok(v_email) then return jsonb_build_object('ok', false, 'reason', 'bad_email'); end if;
  if v_hash is null then return jsonb_build_object('ok', false, 'reason', 'invalid_link'); end if;
  select * into c from public.crews where id = p_room for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if public._ev_room_role(p_room, me) is distinct from 'owner' or public._ev_is_hq(p_room) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if v_email = public._ev_xf_my_email() then return jsonb_build_object('ok', false, 'reason', 'bad_email'); end if;
  if exists (select 1 from public.ev_transfers x where x.room_id = p_room and x.to_email = v_email and x.status = 'pending' and x.expires_at > now()) then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;
  if (select count(*) from public.ev_transfers x where x.room_id = p_room and x.status = 'pending' and x.expires_at > now()) >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'try_again_later');
  end if;
  v_org := (select o.id from public.ev_organisers o where o.room_id = p_room);
  v_name := public._ev_person_name(me);
  insert into public.ev_transfers (kind, room_id, organiser_id, from_user, to_email, token_hash, created_by, expires_at)
  values ('handover', p_room, v_org, me, v_email, v_hash, left(v_name, 60), now() + interval '14 days')
  returning * into t;
  perform public._ev_xf_log(v_org, left(v_name, 60), 'Handover link made for ' || v_email || '.');
  return jsonb_build_object('ok', true, 'transfer', public._ev_xf_json(t));
exception
  when unique_violation then return jsonb_build_object('ok', false, 'reason', 'invalid_link');
end $$;
revoke all on function public.ev_transfer_create_owner(uuid, text, text) from public, anon;
grant execute on function public.ev_transfer_create_owner(uuid, text, text) to authenticated;

-- The links of one room, newest first: an array of Transfer, or { ok: false, reason }. Owner or staff.
create or replace function public.ev_transfers_for_room(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  if not (public._ev_staff() or coalesce(public._ev_room_role(p_room, me), '') = 'owner') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  return coalesce((select jsonb_agg(public._ev_xf_json(t) order by t.created_at desc, t.id)
                     from public.ev_transfers t where t.room_id = p_room), '[]'::jsonb);
end $$;
revoke all on function public.ev_transfers_for_room(uuid) from public, anon;
grant execute on function public.ev_transfers_for_room(uuid) to authenticated;

create or replace function public.ev_transfer_revoke_owner(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); t public.ev_transfers;
begin
  if not public._ev_open() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if me is null or not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  select * into t from public.ev_transfers where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not (public._ev_staff() or coalesce(public._ev_room_role(t.room_id, me), '') = 'owner') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if t.status = 'accepted' then return jsonb_build_object('ok', false, 'reason', 'link_used'); end if;
  if t.status = 'pending' then
    update public.ev_transfers set status = 'revoked', revoked_at = now() where id = t.id returning * into t;
    perform public._ev_xf_log(t.organiser_id, left(public._ev_person_name(me), 60), 'Link for ' || t.to_email || ' cancelled.');
  end if;
  return jsonb_build_object('ok', true, 'transfer', public._ev_xf_json(t));
end $$;
revoke all on function public.ev_transfer_revoke_owner(uuid) from public, anon;
grant execute on function public.ev_transfer_revoke_owner(uuid) to authenticated;

-- ---------------------------------------------------- "Is this your event?" ---
-- From the event page, signed in or not. Answers { ok: true } for a new request and for a repeat; it never says whether the email
-- matches anything. 3 per email per day and 300 per day overall, then try_again_later.
create or replace function public.ev_claim_request(p_event uuid, p_name text, p_email text, p_phone text default null, p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  e       public.events;
  v_name  text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_note  text := btrim(coalesce(p_note, ''));
  v_user  uuid;
begin
  if not public._ev_open() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then return jsonb_build_object('ok', false, 'reason', 'bad_name'); end if;
  if not public._ev_xf_email_ok(v_email) then return jsonb_build_object('ok', false, 'reason', 'bad_email'); end if;
  if v_phone is not null and char_length(v_phone) > 40 then return jsonb_build_object('ok', false, 'reason', 'bad_phone'); end if;
  if char_length(v_note) > 500 then return jsonb_build_object('ok', false, 'reason', 'bad_note'); end if;
  select * into e from public.events where id = p_event;
  if not found or e.ticket_mode <> 'external' or e.visibility <> 'public' or e.status not in ('live', 'unlisted', 'cancelled', 'ended') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext('ev_claim_request:' || v_email));
  if exists (select 1 from public.ev_claim_requests r where r.event_id = p_event and r.email = v_email and r.status = 'new') then
    return jsonb_build_object('ok', true);
  end if;
  if (select count(*) from public.ev_claim_requests r where r.email = v_email and r.created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.ev_claim_requests r where r.created_at > now() - interval '1 day') >= 300 then
    return jsonb_build_object('ok', false, 'reason', 'try_again_later');
  end if;
  v_user := (select p.id from public.profiles p where p.id = auth.uid());
  insert into public.ev_claim_requests (event_id, organiser_id, name, email, phone, note, user_id)
  values (p_event, e.organiser_id, v_name, v_email, v_phone, v_note, v_user)
  on conflict (event_id, email) where status = 'new' do nothing;
  if e.organiser_id is not null then
    insert into public.ev_organiser_log (organiser_id, by_name, kind, body)
    values (e.organiser_id, left(v_name, 60), 'claim_request', left('Asked to claim "' || e.title || '" (' || v_email || ').', 2000));
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ev_claim_request(uuid, text, text, text, text) from public;
grant execute on function public.ev_claim_request(uuid, text, text, text, text) to anon, authenticated, service_role;

-- --------------------------------------------- switch a claimed listing to Hoppaz ---
-- The host, a room owner or admin, or staff. The event must be a claimed listing with real ticket type rows. Changes ticket_mode only.
create or replace function public.ev_listing_use_hoppaz(p_event uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); e public.events;
begin
  if not public._ev_open() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if me is null or not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  select * into e from public.events where id = p_event for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not (public._ev_staff() or coalesce(coalesce(e.host_id, e.created_by) = me, false) or coalesce(public._ev_room_can_run(e.room_id, me), false)) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if e.ticket_mode = 'hoppaz' then return jsonb_build_object('ok', true, 'ticket_mode', 'hoppaz'); end if;
  if e.host_id is null or e.host_id is not distinct from public._ev_listings_uid() then
    return jsonb_build_object('ok', false, 'reason', 'not_claimed');
  end if;
  if not exists (select 1 from public.ev_ticket_types x where x.event_id = p_event) then
    return jsonb_build_object('ok', false, 'reason', 'set_tickets_first');
  end if;
  update public.events set ticket_mode = 'hoppaz' where id = p_event;
  return jsonb_build_object('ok', true, 'ticket_mode', 'hoppaz');
end $$;
revoke all on function public.ev_listing_use_hoppaz(uuid) from public, anon;
grant execute on function public.ev_listing_use_hoppaz(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
