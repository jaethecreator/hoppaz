-- Lineup or programme of an event. DRAFT FOR OLA, NOT RUN ANYWHERE (not even locally). Release 1, file 13 in the run order (see EVENTS_R1_ORDER.md).
-- Written from the fake layer (src/lib/events-r1/fake/events.ts, events.getLineup / setLineup, and src/lib/events-r1/lineup.ts, cleanLineup),
-- which is the spec. Nothing in an older SQL file is edited and no existing function is replaced. Safe to run again.
--
-- WHAT IT ADDS
--   ev_event_lineups   one small closed row per event: kind ('lineup' music and performers, 'programme' talks and schedule) and rows, a jsonb
--                      array of { time?, name, note? }. time is free text ("9:00 PM", "Midnight"), optional. At most 30 rows.
--   ev_get_lineup(event)           { kind, rows } for anyone who may open the event page (the same check as ev_get_event: _ev_can_open).
--                                  An event with no row answers { kind: 'lineup', rows: [] }. An event the viewer cannot see answers null.
--   ev_set_lineup(event, lineup)   host or staff (_ev_manage). Replaces the row. Text: ok | not_open | no_session | not_found | not_allowed | bad_lineup.
--   _ev_copy_lineup(from, to)      for ev_clone_event to call later (the Duplicate event button copies the lineup). Not wired in: that would
--                                  mean editing ev_clone_event, an older file. Until it is, a duplicate starts with no lineup.
--
-- The rules are the same as cleanLineup() in the app: names trimmed, 1 to 80 characters; time up to 20, note up to 200; a row with no name is
-- not stored (the app drops it before it sends); more than 30 rows is refused (bad_lineup) rather than cut, so a bug shows.
--
-- Needs (load first):
--   events_r1_events.sql                                   _ev_open(), _ev_manage(uuid), _ev_can_open(uuid)
-- Test: supabase/tests/events_r1_lineup_test.sql

do $$
begin
  if to_regprocedure('public._ev_manage(uuid)') is null or to_regprocedure('public._ev_can_open(uuid)') is null or to_regprocedure('public._ev_open()') is null then
    raise exception 'events_r1_lineup: run events_r1_events.sql first';
  end if;
end $$;

create table if not exists public.ev_event_lineups (
  event_id   uuid primary key references public.events(id) on delete cascade,
  kind       text not null default 'lineup' check (kind in ('lineup', 'programme')),
  rows       jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) <= 30),
  updated_at timestamptz not null default now()
);
alter table public.ev_event_lineups enable row level security;
revoke all on public.ev_event_lineups from anon, authenticated;
grant all on public.ev_event_lineups to service_role;

create or replace function public.ev_get_lineup(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l public.ev_event_lineups;
begin
  if not public._ev_open() then return null; end if;
  if p_event is null or not public._ev_can_open(p_event) then return null; end if;
  select * into l from public.ev_event_lineups where event_id = p_event;
  if not found then return jsonb_build_object('kind', 'lineup', 'rows', '[]'::jsonb); end if;
  return jsonb_build_object('kind', l.kind, 'rows', l.rows);
end $$;
revoke all on function public.ev_get_lineup(uuid) from public;
grant execute on function public.ev_get_lineup(uuid) to anon, authenticated;

create or replace function public.ev_set_lineup(p_event uuid, p_lineup jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind text;
  v_rows jsonb;
  r      jsonb;
  v_out  jsonb := '[]'::jsonb;
  v_name text;
  v_time text;
  v_note text;
begin
  if not public._ev_open() then return 'not_open'; end if;
  if auth.uid() is null then return 'no_session'; end if;
  perform 1 from public.events where id = p_event for update;
  if not found then return 'not_found'; end if;
  if not public._ev_manage(p_event) then return 'not_allowed'; end if;
  if p_lineup is null or jsonb_typeof(p_lineup) <> 'object' then return 'bad_lineup'; end if;
  v_kind := coalesce(p_lineup ->> 'kind', 'lineup');
  if v_kind not in ('lineup', 'programme') then return 'bad_lineup'; end if;
  v_rows := coalesce(p_lineup -> 'rows', '[]'::jsonb);
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) > 30 then return 'bad_lineup'; end if;

  for r in select value from jsonb_array_elements(v_rows) loop
    if jsonb_typeof(r) <> 'object' then return 'bad_lineup'; end if;
    v_name := btrim(coalesce(r ->> 'name', ''));
    if v_name = '' then continue; end if;
    v_time := btrim(coalesce(r ->> 'time', ''));
    v_note := btrim(coalesce(r ->> 'note', ''));
    if char_length(v_name) > 80 or char_length(v_time) > 20 or char_length(v_note) > 200 then return 'bad_lineup'; end if;
    v_out := v_out || jsonb_build_array(
      jsonb_build_object('name', v_name)
      || case when v_time <> '' then jsonb_build_object('time', v_time) else '{}'::jsonb end
      || case when v_note <> '' then jsonb_build_object('note', v_note) else '{}'::jsonb end);
  end loop;

  insert into public.ev_event_lineups (event_id, kind, rows, updated_at) values (p_event, v_kind, v_out, now())
  on conflict (event_id) do update set kind = excluded.kind, rows = excluded.rows, updated_at = now();
  return 'ok';
end $$;
revoke all on function public.ev_set_lineup(uuid, jsonb) from public, anon;
grant execute on function public.ev_set_lineup(uuid, jsonb) to authenticated;

create or replace function public._ev_copy_lineup(p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.ev_event_lineups (event_id, kind, rows)
  select p_to, l.kind, l.rows from public.ev_event_lineups l where l.event_id = p_from
  on conflict (event_id) do nothing;
end $$;
revoke all on function public._ev_copy_lineup(uuid, uuid) from public, anon, authenticated;
