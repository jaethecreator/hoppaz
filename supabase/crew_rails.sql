-- ============================================================================
-- Hoppaz: the room's two bottom rails, OTHER CREWS and TRENDING THIS WEEK
-- Run order: schema.sql, chat_accounts.sql, crew_rooms.sql, then this file. Additive and safe to
-- run again; it changes no existing table and no existing function. It adds room_rails and, further down, the
-- crew_room_vibes table with the vibe, wave and profile-key calls.
--
-- room_rails(p_crew) hands the room one small answer, read once per visit:
--   crews     up to 8 open crews other than p_crew, verified first, then the bigger crews. Public
--             fields only (id, name, verified, logo, members). A private crew is never listed.
--   trending  up to 8 live events from three hours ago to seven days ahead, ranked by the people
--             going (swipes decision 'in') plus check-ins. The counts come from the event_heat
--             view: swipes and checkins are own-rows-only under RLS, so a raw count from the app
--             would only ever return the caller's own rows.
-- The logo is read through to_jsonb(), so this file also loads before crews.logo_url exists.
-- ============================================================================
begin;

create or replace function public.room_rails(p_crew uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'crews', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.rank)
        from (
          select row_number() over (order by c.verified desc, m.members desc, c.created_at, c.id) as rank,
                 c.id, c.name, c.verified, nullif(to_jsonb(c) ->> 'logo_url', '') as logo_url, m.members
            from crews c
            cross join lateral (select count(*)::int as members from crew_members x where x.crew_id = c.id) m
           where c.visibility = 'open' and (p_crew is null or c.id <> p_crew)
           order by rank
           limit 8) t), '[]'::jsonb),
    'trending', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.rank)
        from (
          select row_number() over (order by (h.swipes_in + h.checkins) desc, h.heat desc, e.starts_at, e.id) as rank,
                 e.id, e.title, e.venue_name, e.area, e.starts_at, e.flyer_url,
                 (h.swipes_in + h.checkins)::int as going
            from events e
            join event_heat h on h.event_id = e.id
           where e.status = 'live'
             and e.starts_at >= now() - interval '3 hours'
             and e.starts_at < now() + interval '7 days'
           order by rank
           limit 8) t), '[]'::jsonb));
$$;

revoke all on function public.room_rails(uuid) from public, anon;
grant execute on function public.room_rails(uuid) to authenticated;

-- ============================================================================
-- Tap a Hopper (design sections 8.2 and 8.3): vibes, waves and the profile key, inside a crew room.
-- Additive and safe to run again. Crew members only, and both people must be walking in the room right now.
--
--   crew_room_vibes        one row per vibe: a sticker id (a fixed catalogue, never text), sender, target, crew.
--                          Delivered by Realtime to crew members (RLS), pruned two hours on. A 'wave' row is the
--                          private "ADA WAVED AT YOU" tap on the shoulder and only its two people can read it.
--   crew_room_vibe(...)    sends one. Sender limits: 1 every 3 s, 3 a minute to the same person, 12 a minute and
--                          100 an hour in all. Receiver limits: 5 a minute and 30 an hour; extras are stored as
--                          dropped (nobody sees them) and the sender still hears "sent". A block either way
--                          delivers nothing and still answers "sent", so a block is never revealed.
--   crew_room_wave(...)    send_wave for people in the same crew room (they carry user ids here, not room keys).
--                          Same answers as send_wave: sent | matched:<dm id> | already | blocked | slow_down | self |
--                          gone | not_met | no_session | need_account.
--   crew_room_peer_key(..) the opaque room key of a crew mate, so PROFILE can block, report and add to crew through
--                          the existing key-based calls without the browser learning a user id.
-- ============================================================================
create table if not exists public.crew_room_vibes (
  id         uuid primary key default gen_random_uuid(),
  crew_id    uuid not null references public.crews(id) on delete cascade,
  from_user  uuid not null references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  sticker    text not null check (sticker in ('outside', 'big', 'omo', 'fresh', 'wahala', 'wave')),
  dropped    boolean not null default false,
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create index if not exists crew_room_vibes_from_idx on public.crew_room_vibes (from_user, created_at desc);
create index if not exists crew_room_vibes_to_idx on public.crew_room_vibes (to_user, created_at desc);
create index if not exists crew_room_vibes_crew_idx on public.crew_room_vibes (crew_id, created_at desc);
alter table public.crew_room_vibes enable row level security;
drop policy if exists crew_room_vibes_member_read on public.crew_room_vibes;
create policy crew_room_vibes_member_read on public.crew_room_vibes for select to authenticated
  using (not dropped
         and public._crew_room_peer_visible(crew_id, from_user)   -- a crew member, and not across a block
         and (sticker <> 'wave' or to_user = auth.uid() or from_user = auth.uid()));
revoke all on public.crew_room_vibes from anon, authenticated;
grant select on public.crew_room_vibes to authenticated;

do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crew_room_vibes') then
    alter publication supabase_realtime add table public.crew_room_vibes;
  end if;
end $do$;

create or replace function public.crew_room_vibe(p_crew uuid, p_to uuid, p_sticker text) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  fresh timestamptz := clock_timestamp() - public._crew_room_ttl();
  last_at timestamptz; n_min int; n_same int; n_hour int; r_min int; r_hour int;
begin
  perform public._crew_room_require(p_crew);            -- need_account | not_in_crew
  if p_sticker is null or p_sticker not in ('outside', 'big', 'omo', 'fresh', 'wahala') then return 'bad_sticker'; end if;
  if p_to is null or p_to = me then return 'self'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crew-vibe:' || me::text, 0));
  if not exists (select 1 from crew_room_presence where crew_id = p_crew and user_id = me and last_seen > fresh) then
    return 'not_in_room';                                -- watching a full room: no avatar, no vibes
  end if;
  if not exists (select 1 from crew_room_presence where crew_id = p_crew and user_id = p_to and last_seen > fresh)
     or not exists (select 1 from crew_members where crew_id = p_crew and user_id = p_to) then
    return 'gone';
  end if;
  select max(created_at),
         count(*) filter (where created_at > now() - interval '1 minute'),
         count(*) filter (where created_at > now() - interval '1 minute' and to_user = p_to),
         count(*)
    into last_at, n_min, n_same, n_hour
    from crew_room_vibes where from_user = me and sticker <> 'wave' and created_at > now() - interval '1 hour';
  if last_at > clock_timestamp() - interval '3 seconds' then return 'slow_down'; end if;
  if n_same >= 3 then return 'same_person'; end if;
  if n_min >= 12 or n_hour >= 100 then return 'slow_down'; end if;
  if public.is_blocked(me, p_to) then return 'sent'; end if;   -- a block is never revealed
  select count(*) filter (where created_at > now() - interval '1 minute'), count(*)
    into r_min, r_hour
    from crew_room_vibes where to_user = p_to and not dropped and sticker <> 'wave' and created_at > now() - interval '1 hour';
  insert into crew_room_vibes (crew_id, from_user, to_user, sticker, dropped)
  values (p_crew, me, p_to, p_sticker, r_min >= 5 or r_hour >= 30);
  if random() < 0.05 then delete from crew_room_vibes where created_at < now() - interval '2 hours'; end if;
  return 'sent';
end $$;

create or replace function public.crew_room_wave(p_crew uuid, p_peer uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  fresh timestamptz := clock_timestamp() - public._crew_room_ttl();
  back waves; n int;
begin
  if me is null then return 'no_session'; end if;
  if not public.has_account() then return 'need_account'; end if;
  if p_peer is null or p_peer = me then return 'self'; end if;
  if not exists (select 1 from crew_members where crew_id = p_crew and user_id = me)
     or not exists (select 1 from crew_members where crew_id = p_crew and user_id = p_peer) then
    return 'not_met';
  end if;
  if not exists (select 1 from crew_room_presence where crew_id = p_crew and user_id = p_peer and last_seen > fresh) then
    return 'gone';
  end if;
  if exists (select 1 from blocks where blocker = me and blocked = p_peer) then return 'blocked'; end if;
  if exists (select 1 from blocks where blocker = p_peer and blocked = me) then return 'sent'; end if;
  select * into back from waves where from_user = p_peer and to_user = me;
  if found then
    if back.status = 'pending' then
      update waves set status = 'accepted', responded_at = now() where id = back.id returning * into back;
      -- The one who waved first hears it come back: a tap on their shoulder from me, live (their room answers with a
      -- second SAY HI, which now says matched too).
      insert into crew_room_vibes (crew_id, from_user, to_user, sticker) values (p_crew, me, p_peer, 'wave');
    end if;
    if back.status = 'accepted' then return 'matched:' || public.open_dm(back)::text; end if;
    return 'already';
  end if;
  -- My own wave, already answered: the same DM, so either of us gets "connected" from the same tap.
  select * into back from waves where from_user = me and to_user = p_peer;
  if found then
    if back.status = 'accepted' then return 'matched:' || public.open_dm(back)::text; end if;
    return 'already';
  end if;
  select count(*) into n from waves where from_user = me and created_at > now() - interval '1 day';
  if n >= 30 then return 'slow_down'; end if;
  insert into waves (from_user, to_user, event_id, from_alias, to_alias)
  values (me, p_peer, null,
          (select coalesce(handle, 'A Hopper') from profiles where id = me),
          (select coalesce(handle, 'A Hopper') from profiles where id = p_peer));
  insert into crew_room_vibes (crew_id, from_user, to_user, sticker) values (p_crew, me, p_peer, 'wave');
  return 'sent';
end $$;

create or replace function public.crew_room_peer_key(p_crew uuid, p_peer uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  perform public._crew_room_require(p_crew);
  if p_peer is null or p_peer = me or public.is_blocked(me, p_peer) then return null; end if;
  if not exists (select 1 from crew_members where crew_id = p_crew and user_id = p_peer) then return null; end if;
  return (public.identity_for(p_peer, 'crew:' || p_crew::text, false)).id;
end $$;

revoke all on function public.crew_room_vibe(uuid, uuid, text), public.crew_room_wave(uuid, uuid), public.crew_room_peer_key(uuid, uuid)
  from public, anon;
grant execute on function public.crew_room_vibe(uuid, uuid, text), public.crew_room_wave(uuid, uuid), public.crew_room_peer_key(uuid, uuid)
  to authenticated;

commit;
