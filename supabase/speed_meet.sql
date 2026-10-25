-- ============================================================================
-- Hoppaz: Speed Meet (short voice chats between people with shared interests), interest matching, and "Tonight".
-- Run order: schema.sql, chat_accounts.sql, crew_friends.sql (it makes _cf_make_crew and _cf_dm), then this file.
-- Additive and safe to run again. Nothing here edits an older function.
-- Paste and run the whole file at once.
--
-- What it adds:
--   profile_interests   a person's interest tags (a subset of the event vibes plus a few social ones), at most 8.
--   meet_queue          who is waiting for a match right now (a heartbeat under 25 s old counts as waiting).
--   meet_sessions       one row per voice chat: the two people, the LiveKit room name, when it ends, each one's choice.
--   meet_set_interests / meet_my_interests
--   meet_join           enter the queue, or be matched at once with the best waiting person.
--   meet_poll           heartbeat while waiting; returns the match when someone else picked you up.
--   meet_leave          leave the queue.
--   meet_session        the state of one session for one of its two people (who, shared interests, time left).
--   meet_choose         "keep in touch" yes / no. Both yes: they become crew both ways and a chat opens.
--   meet_block, meet_report   during or after a chat.
--   meet_suggest_events upcoming live events whose vibe is one of the shared interests.
--   meet_tonight        the Tonight screen: people waiting now, people like you, events tonight, live Speed Meet.
-- The voice itself is LiveKit, token from src/app/api/meet/token/route.ts (service role, checks the session).
-- Matching rules: two people who have not blocked each other, have not met in the last 24 hours, both account holders,
-- both waiting with a fresh heartbeat. The most shared interests wins; no shared interest still matches after 20 s of
-- waiting (the queue is small at first), never before.
-- ============================================================================

set local lock_timeout = '3s';

create table if not exists public.profile_interests (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  tags       text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (cardinality(tags) <= 8)
);
alter table public.profile_interests enable row level security;
revoke all on public.profile_interests from anon, authenticated;

create table if not exists public.meet_queue (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  tags      text[] not null default '{}',
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
alter table public.meet_queue enable row level security;
revoke all on public.meet_queue from anon, authenticated;

create table if not exists public.meet_sessions (
  id         uuid primary key default gen_random_uuid(),
  a          uuid not null references public.profiles(id) on delete cascade,
  b          uuid not null references public.profiles(id) on delete cascade,
  room_name  text not null unique,
  shared     text[] not null default '{}',
  started_at timestamptz not null default now(),
  ends_at    timestamptz not null default now() + interval '4 minutes',
  a_choice   boolean,
  b_choice   boolean,
  ended      boolean not null default false,
  dm_id      uuid,
  check (a <> b)
);
create index if not exists meet_sessions_a_idx on public.meet_sessions (a, started_at desc);
create index if not exists meet_sessions_b_idx on public.meet_sessions (b, started_at desc);
alter table public.meet_sessions enable row level security;
revoke all on public.meet_sessions from anon, authenticated;

-- The tags people may choose. One list here, one in src/lib/meet.ts.
create or replace function public._meet_tag_ok(p_tag text) returns boolean
language sql immutable as $$
  select p_tag = any (array['afro','amapiano','rave','techno','live band','comedy','beach','rooftop','food','culture','tech',
                            'games','fitness','art','travel','solo','new in town']);
$$;

-- ------------------------------------------------------------- interests ---
create or replace function public.meet_set_interests(p_tags text[]) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); clean text[];
begin
  if me is null then return 'no_session'; end if;
  if not public.has_account() then return 'need_account'; end if;
  select coalesce(array_agg(distinct t), '{}') into clean from unnest(coalesce(p_tags, '{}')) t where public._meet_tag_ok(t);
  if cardinality(clean) > 8 then return 'too_many'; end if;
  insert into profile_interests (user_id, tags, updated_at) values (me, clean, now())
  on conflict (user_id) do update set tags = excluded.tags, updated_at = now();
  return 'ok';
end $$;

create or replace function public.meet_my_interests() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select tags from profile_interests where user_id = auth.uid()), '{}');
$$;

-- --------------------------------------------------------------- matching ---
-- The session that is running for this person right now, if any.
create or replace function public._meet_live(p_user uuid) returns meet_sessions
language sql stable security definer set search_path = public as $$
  select s from meet_sessions s
   where (s.a = p_user or s.b = p_user) and not s.ended and s.ends_at > now()
   order by s.started_at desc limit 1;
$$;

create or replace function public._meet_shape(p_s meet_sessions, p_me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p_s.id,
    'room', p_s.room_name,
    'seconds_left', greatest(0, extract(epoch from p_s.ends_at - now())::int),
    'shared', p_s.shared,
    'peer_name', (select coalesce(nullif(btrim(display_name), ''), handle, 'A Hopper') from profiles
                   where id = case when p_s.a = p_me then p_s.b else p_s.a end),
    'my_choice', case when p_s.a = p_me then p_s.a_choice else p_s.b_choice end);
$$;

-- Try to pair p_me with the best other person waiting. Returns the new session or null.
create or replace function public._meet_pair(p_me uuid) returns meet_sessions
language plpgsql security definer set search_path = public as $$
declare mine meet_queue; other meet_queue; s meet_sessions; shared text[]; waited numeric;
begin
  select * into mine from meet_queue where user_id = p_me;
  if not found then return null; end if;
  waited := extract(epoch from now() - mine.joined_at);
  select q.* into other from meet_queue q
   where q.user_id <> p_me
     and q.last_seen > now() - interval '25 seconds'
     and not public.is_blocked(p_me, q.user_id)
     and not exists (select 1 from meet_sessions m
                      where ((m.a = p_me and m.b = q.user_id) or (m.a = q.user_id and m.b = p_me))
                        and m.started_at > now() - interval '24 hours')
     and public._meet_live(q.user_id) is null
     and (cardinality(array(select unnest(q.tags) intersect select unnest(mine.tags))) > 0
          or waited >= 20 or extract(epoch from now() - q.joined_at) >= 20)
   order by cardinality(array(select unnest(q.tags) intersect select unnest(mine.tags))) desc, q.joined_at
   limit 1
   for update skip locked;
  if not found then return null; end if;
  shared := array(select unnest(other.tags) intersect select unnest(mine.tags));
  insert into meet_sessions (a, b, room_name, shared)
  values (p_me, other.user_id, 'meet-' || gen_random_uuid()::text, shared) returning * into s;
  delete from meet_queue where user_id in (p_me, other.user_id);
  return s;
end $$;

-- Returns { status: waiting | matched | need_account | no_session, session? }.
create or replace function public.meet_join() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); tags text[]; s meet_sessions;
begin
  if me is null then return jsonb_build_object('status', 'no_session'); end if;
  if not public.has_account() then return jsonb_build_object('status', 'need_account'); end if;
  s := public._meet_live(me);
  if s.id is not null then return jsonb_build_object('status', 'matched', 'session', public._meet_shape(s, me)); end if;
  tags := public.meet_my_interests();
  insert into meet_queue (user_id, tags, joined_at, last_seen) values (me, tags, now(), now())
  on conflict (user_id) do update set tags = excluded.tags, joined_at = now(), last_seen = now();
  s := public._meet_pair(me);
  if s.id is not null then return jsonb_build_object('status', 'matched', 'session', public._meet_shape(s, me)); end if;
  return jsonb_build_object('status', 'waiting');
end $$;

create or replace function public.meet_poll() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); s meet_sessions;
begin
  if me is null then return jsonb_build_object('status', 'no_session'); end if;
  s := public._meet_live(me);
  if s.id is not null then return jsonb_build_object('status', 'matched', 'session', public._meet_shape(s, me)); end if;
  update meet_queue set last_seen = now() where user_id = me;
  if not found then return jsonb_build_object('status', 'idle'); end if;
  s := public._meet_pair(me);
  if s.id is not null then return jsonb_build_object('status', 'matched', 'session', public._meet_shape(s, me)); end if;
  return jsonb_build_object('status', 'waiting');
end $$;

create or replace function public.meet_leave() returns void
language sql security definer set search_path = public as $$
  delete from meet_queue where user_id = auth.uid();
$$;

-- One session, for one of its two people. null for anyone else.
create or replace function public.meet_session(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); s meet_sessions;
begin
  select * into s from meet_sessions where id = p_id and (a = me or b = me);
  if not found then return null; end if;
  return public._meet_shape(s, me) || jsonb_build_object('ended', s.ended or s.ends_at <= now(), 'dm_id', s.dm_id,
    'peer_choice', case when s.a = me then s.b_choice else s.a_choice end);
end $$;

-- Keep in touch? Both yes makes them crew both ways and opens their chat. Returns waiting | connected:<dm> | passed |
-- not_found | blocked | need_account | no_session.
create or replace function public.meet_choose(p_id uuid, p_connect boolean) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); s meet_sessions; peer uuid; theirs boolean; dm uuid;
begin
  if me is null then return 'no_session'; end if;
  if not public.has_account() then return 'need_account'; end if;
  select * into s from meet_sessions where id = p_id and (a = me or b = me) for update;
  if not found then return 'not_found'; end if;
  peer := case when s.a = me then s.b else s.a end;
  if public.is_blocked(me, peer) then return 'blocked'; end if;
  if s.a = me then update meet_sessions set a_choice = p_connect where id = s.id returning * into s;
  else update meet_sessions set b_choice = p_connect where id = s.id returning * into s; end if;
  if not p_connect then return 'passed'; end if;
  theirs := case when s.a = me then s.b_choice else s.a_choice end;
  if theirs is null then return 'waiting'; end if;
  if not theirs then return 'passed'; end if;
  perform public._cf_make_crew(me, peer);
  dm := public._cf_dm(me, peer);
  perform public._cf_reveal(dm);
  update meet_sessions set dm_id = dm where id = s.id;
  insert into crew_pings (from_user, to_user, kind) values (me, peer, 'crew'), (peer, me, 'crew');
  return 'connected:' || dm::text;
end $$;

-- A block ends the chat at once and keeps these two apart.
create or replace function public.meet_block(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); s meet_sessions; peer uuid;
begin
  select * into s from meet_sessions where id = p_id and (a = me or b = me);
  if not found then return false; end if;
  peer := case when s.a = me then s.b else s.a end;
  insert into blocks (blocker, blocked, label) values (me, peer, 'Speed Meet') on conflict do nothing;
  update meet_sessions set ended = true where id = s.id;
  return true;
end $$;

create or replace function public.meet_report(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); s meet_sessions;
begin
  select * into s from meet_sessions where id = p_id and (a = me or b = me);
  if not found or p_reason is null or btrim(p_reason) = '' then return false; end if;
  insert into reports (reporter, target, kind, ref_id, reason)
  values (me, case when s.a = me then s.b else s.a end, 'person', s.id, 'Speed Meet: ' || left(btrim(p_reason), 280));
  update meet_sessions set ended = true where id = s.id;
  return true;
end $$;

-- ------------------------------------------------------ events together ---
create or replace function public.meet_suggest_events(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); s meet_sessions;
begin
  select * into s from meet_sessions where id = p_id and (a = me or b = me);
  if not found then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'venue', e.venue_name, 'starts_at', e.starts_at, 'vibe', e.vibe))
      from (select * from events
             where status = 'live' and starts_at > now() and starts_at < now() + interval '10 days'
               and (cardinality(s.shared) = 0 or vibe = any (s.shared))
             order by starts_at limit 3) e
  ), '[]'::jsonb);
end $$;

-- --------------------------------------------------------------- tonight ---
-- { waiting, like_you, events: [..], live_meets }. Numbers only: nobody is named here.
create or replace function public.meet_tonight() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); mine text[];
begin
  if me is null then return null; end if;
  mine := public.meet_my_interests();
  return jsonb_build_object(
    'waiting', (select count(*) from meet_queue where last_seen > now() - interval '25 seconds' and user_id <> me),
    'live_meets', (select count(*) from meet_sessions where not ended and ends_at > now()),
    'like_you', (select count(*) from profile_interests p
                  where p.user_id <> me and p.tags && mine and not public.is_blocked(me, p.user_id)),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'venue', e.venue_name, 'starts_at', e.starts_at, 'vibe', e.vibe))
        from (select * from events
               where status = 'live' and starts_at > now() and starts_at < now() + interval '30 hours'
               order by (vibe = any (mine)) desc, base_heat desc, starts_at limit 4) e
    ), '[]'::jsonb));
end $$;

-- ----------------------------------------------------------------- grants ---
do $$
declare f text;
begin
  foreach f in array array[
    'meet_set_interests(text[])', 'meet_my_interests()', 'meet_join()', 'meet_poll()', 'meet_leave()', 'meet_session(uuid)',
    'meet_choose(uuid, boolean)', 'meet_block(uuid)', 'meet_report(uuid, text)', 'meet_suggest_events(uuid)', 'meet_tonight()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Helpers are internal.
  revoke all on function public._meet_tag_ok(text), public._meet_live(uuid), public._meet_shape(meet_sessions, uuid), public._meet_pair(uuid)
    from public, anon, authenticated;
end $$;
