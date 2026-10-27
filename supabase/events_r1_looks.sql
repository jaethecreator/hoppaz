-- Looks: how a host's event page or room page is dressed. DRAFT FOR OLA, NOT RUN ON PRODUCTION.
-- Release 1, file 10 in the run order (see EVENTS_R1_ORDER.md): run it after files 1 to 9.
--
-- One small record per event or room: pack (background behaviour), mood (day or night), the tint (hue and chroma, read from the
-- cover or logo, or a swatch the host picked), whether the tint follows the picture (auto), and the walkable 2D room choice.
-- Kept in its own table so no Release 1 row changes shape. The front end treats a missing look as normal (it reads the cover).
-- A look belongs to its event or its room: delete the event or the crew and its look goes with it (on delete cascade).
--
-- Needs (all of these must be loaded first):
--   events_r1_events.sql   _ev_manage(uuid), _ev_staff(), _ev_can_open(uuid)
--   chat_accounts.sql      has_account()
--   crew_stage_voice.sql   crew_members.role allows 'admin' (the check was owner and member only). _ev_room_manage below lets an
--                          owner or an admin set a room look; without that file the 'admin' part simply never matches.
--   schema.sql             events, crews (the foreign keys) and auth.users
-- Safe to run again.
--
-- FOR OLA: this replaces an earlier local-only draft of ev_looks that had a single owner_id column and no foreign keys. That draft was
-- never run on production. If you ever ran it on a local database, run `drop table public.ev_looks;` once before this file (a stale
-- table is not rebuilt here on purpose: create table if not exists leaves a table of the new shape alone, so a second run is harmless).
--
-- Functions (both answer for the signed-in viewer; no one can read or write the table directly):
--   ev_get_look(p_kind text, p_id uuid) returns jsonb   -- null when there is none, or the viewer may not open the event
--   ev_set_look(p_kind text, p_id uuid, p_look jsonb) returns text
--       'ok' | 'need_account' | 'bad_kind' | 'not_allowed' | 'bad_look'
--   An event: its host or staff. A room: its owner or an admin, or staff. An id that is not an event (or not a crew) is 'not_allowed'.

create table if not exists public.ev_looks (
  id         uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('event', 'room')),
  event_id   uuid references public.events(id) on delete cascade,
  crew_id    uuid references public.crews(id) on delete cascade,
  pack       text not null default 'minimal' check (pack in ('minimal', 'glow', 'confetti', 'detty', 'owambe')),
  mood       text not null default 'night' check (mood in ('day', 'night')),
  hue        real not null default 40 check (hue >= 0 and hue < 360),
  chroma     real not null default 0.03 check (chroma >= 0 and chroma <= 0.37::real),
  auto       boolean not null default true,
  two_d      jsonb check (two_d is null or (jsonb_typeof(two_d) = 'object' and octet_length(two_d::text) < 512)),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  -- exactly the owner that matches the kind
  constraint ev_looks_one_owner check (
    (owner_kind = 'event' and event_id is not null and crew_id is null)
    or (owner_kind = 'room' and crew_id is not null and event_id is null))
);
create unique index if not exists ev_looks_event_uq on public.ev_looks (event_id);
create unique index if not exists ev_looks_crew_uq on public.ev_looks (crew_id);

alter table public.ev_looks enable row level security;
-- No policies, and no table privileges either: read and write only through the two functions below.
revoke all on table public.ev_looks from public, anon, authenticated;

create or replace function public._ev_room_manage(p_room uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
    public._ev_staff()
    or exists (select 1 from public.crew_members m where m.crew_id = p_room and m.user_id = auth.uid() and m.role in ('owner', 'admin')));
$$;
revoke all on function public._ev_room_manage(uuid) from public, anon, authenticated;

create or replace function public.ev_get_look(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  l public.ev_looks;
begin
  if p_kind = 'event' then
    if not public._ev_can_open(p_id) then return null; end if;
    select * into l from public.ev_looks where owner_kind = 'event' and event_id = p_id;
  elsif p_kind = 'room' then
    select * into l from public.ev_looks where owner_kind = 'room' and crew_id = p_id;
  else
    return null;
  end if;
  if not found then return null; end if;
  return jsonb_build_object('pack', l.pack, 'mood', l.mood, 'hue', l.hue, 'chroma', l.chroma, 'auto', l.auto, 'two_d', l.two_d);
end $$;
revoke all on function public.ev_get_look(text, uuid) from public;
grant execute on function public.ev_get_look(text, uuid) to anon, authenticated;

create or replace function public.ev_set_look(p_kind text, p_id uuid, p_look jsonb) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me       uuid := auth.uid();
  v_pack   text;
  v_mood   text;
  v_hue    real;
  v_chroma real;
  v_auto   boolean;
  v_two_d  jsonb;
begin
  if me is null or not public.has_account() then return 'need_account'; end if;
  if p_kind not in ('event', 'room') then return 'bad_kind'; end if;
  -- Staff pass the manage checks for any id, so the owner has to exist as well.
  if p_kind = 'event' and not (public._ev_manage(p_id) and exists (select 1 from public.events e where e.id = p_id)) then return 'not_allowed'; end if;
  if p_kind = 'room' and not (public._ev_room_manage(p_id) and exists (select 1 from public.crews c where c.id = p_id)) then return 'not_allowed'; end if;
  if p_look is null or jsonb_typeof(p_look) <> 'object' then return 'bad_look'; end if;
  v_pack := coalesce(p_look ->> 'pack', 'minimal');
  v_mood := coalesce(p_look ->> 'mood', 'night');
  begin
    v_hue := coalesce((p_look ->> 'hue')::real, 40);
    v_chroma := coalesce((p_look ->> 'chroma')::real, 0.03);
    v_auto := coalesce((p_look ->> 'auto')::boolean, true);
  exception when others then
    return 'bad_look';
  end;
  v_two_d := case when jsonb_typeof(p_look -> 'two_d') = 'object' then p_look -> 'two_d' else null end;
  -- NaN and infinity compare above every number in Postgres, so the upper bounds catch them. The real casts matter: a plain 0.37 is
  -- a numeric, and a real 0.37 is slightly above it, which would turn away the top of the range.
  if v_pack not in ('minimal', 'glow', 'confetti', 'detty', 'owambe') or v_mood not in ('day', 'night')
     or v_hue < 0 or v_hue >= 360 or v_chroma < 0 or v_chroma > 0.37::real
     or (v_two_d is not null and octet_length(v_two_d::text) >= 512) then
    return 'bad_look';
  end if;
  begin
    if p_kind = 'event' then
      insert into public.ev_looks (owner_kind, event_id, pack, mood, hue, chroma, auto, two_d, updated_by, updated_at)
      values ('event', p_id, v_pack, v_mood, v_hue, v_chroma, v_auto, v_two_d, me, now())
      on conflict (event_id) do update
         set pack = excluded.pack, mood = excluded.mood, hue = excluded.hue, chroma = excluded.chroma, auto = excluded.auto,
             two_d = excluded.two_d, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    else
      insert into public.ev_looks (owner_kind, crew_id, pack, mood, hue, chroma, auto, two_d, updated_by, updated_at)
      values ('room', p_id, v_pack, v_mood, v_hue, v_chroma, v_auto, v_two_d, me, now())
      on conflict (crew_id) do update
         set pack = excluded.pack, mood = excluded.mood, hue = excluded.hue, chroma = excluded.chroma, auto = excluded.auto,
             two_d = excluded.two_d, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    end if;
  exception when foreign_key_violation then
    return 'not_allowed';   -- the event or room was deleted a moment ago
  end;
  return 'ok';
end $$;
revoke all on function public.ev_set_look(text, uuid, jsonb) from public, anon;
grant execute on function public.ev_set_look(text, uuid, jsonb) to authenticated;
