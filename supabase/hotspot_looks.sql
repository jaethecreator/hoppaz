-- ============================================================================
-- Hoppaz: real looks in hotspot rooms. The NAME stays the alias; the BODY is the
-- Hopper's own. Run after hotspots.sql (any time later). Safe to run again.
--
-- Jae, 15 Oct 2026: in a hotspot room people show their real Hopper look with
-- their alias name. hotspots.sql sends a null look on purpose (heads in
-- hotspot_room, author_look in stamp_hotspot_message), because profiles are
-- readable by everyone and a look could be matched to a profile. That file is not
-- changed. This one adds a second call the room reads next to hotspot_room:
--
--   hotspot_room_looks(p_slug text) -> jsonb
--     {ok: true, looks: {"<alias key>": <look>, ...}}  or  {ok: false, reason}
--     reason: no_session | not_found | not_in_hotspot  (same as hotspot_room)
--
-- The map is keyed by the same key hotspot_room gives each head and the chat
-- gives each message author (room_identities.id), so the app puts a real look on
-- a head and on a message with one lookup. It holds:
--   * the heads in the room now (not you, not a Hopper you share a hotspot block
--     with), and
--   * authors of messages in this room in the last 24 hours (the chat's own
--     window), so a face does not turn into a stranger when its owner's head fades.
-- A Hopper with no look saved is left out; the app draws the alias face for them.
-- Nothing else is returned: no handle, no display name, no user id. Names stay
-- aliases everywhere (heads, chat, cards).
--
-- The privacy trade, for the record: the look is the Hopper's own body, and
-- profiles are readable by everyone. Someone who looks hard can match a distinctive
-- look to a profile. That is Jae's call (15 Oct 2026); an opt-out switch on the
-- profile is the follow-up if it is wanted.
--
-- The app falls back to the alias face when this function is missing, so deploying
-- the app before this file is run is safe.
-- ============================================================================

create or replace function public.hotspot_room_looks(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  h     hotspots;
  looks jsonb;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  select * into h from hotspots where slug = lower(btrim(coalesce(p_slug, ''))) and status in ('active', 'planned', 'paused');
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not in_room(me, 'hotspot:' || h.id::text) then return jsonb_build_object('ok', false, 'reason', 'not_in_hotspot'); end if;

  select coalesce(jsonb_object_agg(x.key::text, x.avatar), '{}'::jsonb)
    into looks
    from (
      select k.key, p.avatar
        from (
          select v.key, v.user_id
            from hotspot_visits v
           where v.hotspot_id = h.id and v.fades_at > now()
          union
          select ri.id, ri.user_id
            from messages m
            join room_identities ri on ri.id = m.author_key
           where m.channel = 'hotspot:' || h.id::text and m.created_at > now() - interval '24 hours' and not ri.anon
        ) k
        join profiles p on p.id = k.user_id
       where k.user_id <> me and p.avatar is not null and not hotspot_blocked(me, k.user_id)
       order by k.key
       limit 200
    ) x;
  return jsonb_build_object('ok', true, 'looks', looks);
end $$;
revoke all on function public.hotspot_room_looks(text) from public, anon;
grant execute on function public.hotspot_room_looks(text) to authenticated;
