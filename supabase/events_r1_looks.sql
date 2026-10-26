-- Looks: how a host's event page or room page is dressed. DRAFT FOR OLA, NOT RUN ON PRODUCTION.
--
-- One small record per event or room: pack (background behaviour), mood (day or night), the tint (hue and chroma, read from the
-- cover or logo, or a swatch the host picked), whether the tint follows the picture (auto), and the walkable 2D room choice.
-- Kept in its own table so no Release 1 row changes shape. The front end treats a missing look as normal (it reads the cover).
--
-- Needs: events_r1_events.sql (_ev_manage, _ev_staff, _ev_can_open) and crews / crew_members. Safe to run again.
--
-- Functions (both answer for the signed-in viewer):
--   ev_get_look(p_kind text, p_id uuid) returns jsonb   -- null when there is none, or the viewer may not open the event
--   ev_set_look(p_kind text, p_id uuid, p_look jsonb) returns text
--       'ok' | 'need_account' | 'bad_kind' | 'not_allowed' | 'bad_look'
--   An event: its host or staff. A room: its owner or an admin, or staff.

create table if not exists public.ev_looks (
  owner_kind text not null check (owner_kind in ('event', 'room')),
  owner_id   uuid not null,
  pack       text not null default 'minimal' check (pack in ('minimal', 'glow', 'confetti', 'detty', 'owambe')),
  mood       text not null default 'night' check (mood in ('day', 'night')),
  hue        real not null default 40 check (hue >= 0 and hue < 360),
  chroma     real not null default 0.03 check (chroma >= 0 and chroma <= 0.37),
  auto       boolean not null default true,
  two_d      jsonb check (two_d is null or (jsonb_typeof(two_d) = 'object' and pg_column_size(two_d) < 512)),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (owner_kind, owner_id)
);
alter table public.ev_looks enable row level security;
-- No policies: read and write only through the two functions below.

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
  if p_kind = 'event' and not public._ev_can_open(p_id) then return null; end if;
  select * into l from public.ev_looks where owner_kind = p_kind and owner_id = p_id;
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
  v_two_d  jsonb;
begin
  if me is null or not public.has_account() then return 'need_account'; end if;
  if p_kind not in ('event', 'room') then return 'bad_kind'; end if;
  if p_kind = 'event' and not public._ev_manage(p_id) then return 'not_allowed'; end if;
  if p_kind = 'room' and not public._ev_room_manage(p_id) then return 'not_allowed'; end if;
  if p_look is null or jsonb_typeof(p_look) <> 'object' then return 'bad_look'; end if;
  v_pack := coalesce(p_look ->> 'pack', 'minimal');
  v_mood := coalesce(p_look ->> 'mood', 'night');
  begin
    v_hue := coalesce((p_look ->> 'hue')::real, 40);
    v_chroma := coalesce((p_look ->> 'chroma')::real, 0.03);
  exception when others then
    return 'bad_look';
  end;
  v_two_d := case when jsonb_typeof(p_look -> 'two_d') = 'object' then p_look -> 'two_d' else null end;
  if v_pack not in ('minimal', 'glow', 'confetti', 'detty', 'owambe') or v_mood not in ('day', 'night')
     or v_hue < 0 or v_hue >= 360 or v_chroma < 0 or v_chroma > 0.37 then
    return 'bad_look';
  end if;
  insert into public.ev_looks (owner_kind, owner_id, pack, mood, hue, chroma, auto, two_d, updated_by, updated_at)
  values (p_kind, p_id, v_pack, v_mood, v_hue, v_chroma, coalesce((p_look ->> 'auto')::boolean, true), v_two_d, me, now())
  on conflict (owner_kind, owner_id) do update
     set pack = excluded.pack, mood = excluded.mood, hue = excluded.hue, chroma = excluded.chroma, auto = excluded.auto,
         two_d = excluded.two_d, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return 'ok';
end $$;
revoke all on function public.ev_set_look(text, uuid, jsonb) from public, anon;
grant execute on function public.ev_set_look(text, uuid, jsonb) to authenticated;
