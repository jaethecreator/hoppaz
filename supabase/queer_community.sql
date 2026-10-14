-- Hoppaz queer community: isolated member-only listings, quests, and drop-in rooms.
-- Apply this after schema.sql. Invite codes are stored as hashes and membership is
-- never writable from a browser client.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.queer_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'moderator', 'admin')),
  status text not null default 'active' check (status in ('active', 'removed')),
  joined_at timestamptz not null default now()
);

create table if not exists public.queer_invites (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  max_uses integer not null default 1 check (max_uses between 1 and 20),
  uses integer not null default 0 check (uses >= 0 and uses <= max_uses),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create table if not exists public.queer_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  venue_name text not null check (char_length(venue_name) between 2 and 120),
  area text not null default '',
  description text not null default '',
  lat double precision not null check (lat between 6.30 and 6.80),
  lng double precision not null check (lng between 3.05 and 3.95),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists queer_events_starts_idx on public.queer_events(starts_at);

create table if not exists public.queer_quests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.queer_events(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 100),
  description text not null default '',
  xp_reward integer not null default 0 check (xp_reward between 0 and 10000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists queer_quests_active_idx on public.queer_quests(active, starts_at, ends_at);

create table if not exists public.queer_rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 100),
  topic text not null default '' check (char_length(topic) <= 240),
  room_name text not null unique default ('queer-' || gen_random_uuid()::text),
  status text not null default 'live' check (status in ('live', 'ended')),
  host_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists queer_rooms_live_idx on public.queer_rooms(started_at desc) where status = 'live';
create unique index if not exists queer_rooms_one_live_per_host_idx on public.queer_rooms(host_id) where status = 'live';

create or replace function private.is_queer_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.queer_memberships m
    where m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;
revoke all on function private.is_queer_member() from public, anon;
grant execute on function private.is_queer_member() to authenticated;

alter table public.queer_memberships enable row level security;
alter table public.queer_invites enable row level security;
alter table public.queer_events enable row level security;
alter table public.queer_quests enable row level security;
alter table public.queer_rooms enable row level security;

revoke all on public.queer_memberships, public.queer_invites, public.queer_events,
  public.queer_quests, public.queer_rooms from anon, authenticated;
grant select on public.queer_memberships to authenticated;
grant select on public.queer_events, public.queer_quests, public.queer_rooms to authenticated;
grant insert (title, topic, host_id) on public.queer_rooms to authenticated;

drop policy if exists queer_membership_self_read on public.queer_memberships;
create policy queer_membership_self_read on public.queer_memberships
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists queer_events_member_read on public.queer_events;
create policy queer_events_member_read on public.queer_events
  for select to authenticated using ((select private.is_queer_member()));

drop policy if exists queer_quests_member_read on public.queer_quests;
create policy queer_quests_member_read on public.queer_quests
  for select to authenticated using ((select private.is_queer_member()));

drop policy if exists queer_rooms_member_read on public.queer_rooms;
create policy queer_rooms_member_read on public.queer_rooms
  for select to authenticated using ((select private.is_queer_member()));

drop policy if exists queer_rooms_member_create on public.queer_rooms;
create policy queer_rooms_member_create on public.queer_rooms
  for insert to authenticated
  with check ((select private.is_queer_member()) and host_id = (select auth.uid()));
