-- ============================================================================
-- Hoppaz: heat counted per event, not for the whole database. Run after schema.sql (any time later). Safe to run
-- again, in one transaction. Same names, same columns, same answers: nothing in the app changes.
--
-- Why (16 Oct 2026, the 360Playlist night): event_heat counted every swipe and every check-in in the database
-- (a GROUP BY over the whole of swipes and checkins) before joining to the events asked for, and events_near runs
-- on every map and Events page load. With the campaign crowd that ran into the statement timeout and took the
-- database down with it.
--
-- Now each count is a lookup for one event, on the indexes that already exist (checkins_event_idx on
-- checkins (event_id, created_at desc), swipes_event_idx on swipes (event_id) where decision = 'in'), and only for
-- the events that pass the radius and time filters.
-- ============================================================================
begin;

-- The view keeps its columns, in order (create or replace view cannot change them), so crew_rails.sql,
-- events_deck and the single-event read in the app keep working. A filter on event_id now reaches the counts.
create or replace view public.event_heat as
select
  e.id as event_id,
  c.n as checkins,
  s.n as swipes_in,
  least(100, e.base_heat + c.n * 7 + s.n * 3)::int as heat,
  r.n as here_now
from public.events e
cross join lateral (select count(*)::int as n from public.checkins x where x.event_id = e.id) c
cross join lateral (select count(*)::int as n from public.swipes x where x.event_id = e.id and x.decision = 'in') s
cross join lateral (
  select count(*)::int as n from public.checkins x where x.event_id = e.id and x.created_at > now() - interval '3 hours'
) r;

-- The map's call: filter the events first, then count for those alone.
create or replace function public.events_near(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m double precision default 15000,
  p_from     timestamptz default now() - interval '4 hours',
  p_to       timestamptz default now() + interval '36 hours'
)
returns table (
  id uuid, title text, venue_name text, area text,
  lat double precision, lng double precision,
  starts_at timestamptz, price_naira int, vibe text, source text,
  ig_url text, flyer_url text,
  distance_m double precision, heat int, checkins int, swipes_in int, here_now int
)
language sql stable security definer set search_path = public
as $$
  with near as (
    select e.*
      from public.events e
     where e.status = 'live'
       and e.starts_at between p_from and p_to
       and st_dwithin(e.geog, st_point(p_lng, p_lat)::geography, p_radius_m)
  )
  select e.id, e.title, e.venue_name, e.area,
         st_y(e.geog::geometry), st_x(e.geog::geometry),
         e.starts_at, e.price_naira, e.vibe, e.source, e.ig_url, e.flyer_url,
         st_distance(e.geog, st_point(p_lng, p_lat)::geography),
         least(100, e.base_heat + c.n * 7 + s.n * 3)::int,
         c.n, s.n, r.n
    from near e
    cross join lateral (select count(*)::int as n from public.checkins x where x.event_id = e.id) c
    cross join lateral (select count(*)::int as n from public.swipes x where x.event_id = e.id and x.decision = 'in') s
    cross join lateral (
      select count(*)::int as n from public.checkins x where x.event_id = e.id and x.created_at > now() - interval '3 hours'
    ) r
   order by 14 desc, e.starts_at asc;
$$;

commit;
