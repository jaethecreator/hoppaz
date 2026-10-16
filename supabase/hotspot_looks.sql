-- ============================================================================
-- Hoppaz: real looks in hotspot rooms. The NAME stays the alias; the BODY is the
-- Hopper's own. Run after hotspots.sql (any time later). Safe to run again, in
-- one transaction. It adds one function with a new name and replaces nothing of
-- hotspots.sql, chat_accounts.sql or crew_friends.sql, so re-running any of those
-- cannot undo it, and it works with or without crew_friends.sql.
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
--     or a global block with, either way round), and
--   * authors of messages in this room in the last 24 hours (the chat's own
--     window), so a face does not turn into a stranger when its owner's head fades.
-- A Hopper with no look saved is left out; the app draws the alias face for them.
-- Nothing else is returned: no handle, no display name, no user id. Names stay
-- aliases everywhere (heads, chat, cards).
--
-- THE PRIVACY TRADE, plainly. The look is the Hopper's own body, and profiles are
-- readable by everyone, avatar included. A look has many fields, so almost every
-- customised look is one of a kind. One query on profiles (avatar equal to a look
-- this returns) gives that Hopper's id, handle and display name, and with them
-- everything the alias said in this room in the last 24 hours. Entering a hotspot
-- room needs no position, so anyone with an account can do it from anywhere. This is
-- not a face someone has to look hard at: it is an exact match for nearly everyone.
-- Jae chose real looks on 15 Oct 2026 on a softer description of the risk.
--
-- HELD FOR LAUNCH: do not run this file on production until Jae has said yes to the
-- paragraph above. Until then the app shows alias faces (it falls back, see below).
-- To close the risk and keep real looks, return a look only for Hoppers who switched
-- it on (a new profile switch, off by default), or only between crew.
--
-- The app falls back to the alias face when this function is missing, so deploying
-- the app before this file is run is safe.
-- ============================================================================
begin;

do $guard$
begin
  if to_regclass('public.hotspot_visits') is null or to_regprocedure('public.hotspot_blocked(uuid,uuid)') is null then
    raise exception 'hotspot_looks.sql needs hotspots.sql loaded first';
  end if;
end $guard$;

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

  -- At most 200 looks. The people in the room now come first, in the order hotspot_room lists its heads (a hash of the
  -- key), so every head on screen is inside the cut and only old chat authors are dropped when there are more than 200.
  select coalesce(jsonb_object_agg(x.key::text, x.avatar), '{}'::jsonb)
    into looks
    from (
      select k.key, p.avatar
        from (
          select u.key, u.user_id, bool_or(u.here) as here
            from (
              select v.key, v.user_id, true as here
                from hotspot_visits v
               where v.hotspot_id = h.id and v.fades_at > now()
              union all
              select ri.id, ri.user_id, false
                from messages m
                join room_identities ri on ri.id = m.author_key
               where m.channel = 'hotspot:' || h.id::text and m.created_at > now() - interval '24 hours' and not ri.anon
            ) u
           group by u.key, u.user_id
        ) k
        join profiles p on p.id = k.user_id
       where k.user_id <> me and p.avatar is not null and not hotspot_blocked(me, k.user_id)
         -- a global block either way: an alias face, so a look never points a blocked Hopper at the one who blocked them
         and not exists (select 1 from blocks b where (b.blocker = me and b.blocked = k.user_id) or (b.blocker = k.user_id and b.blocked = me))
       order by k.here desc, md5(k.key::text)
       limit 200
    ) x;
  return jsonb_build_object('ok', true, 'looks', looks);
end $$;
revoke all on function public.hotspot_room_looks(text) from public, anon;
grant execute on function public.hotspot_room_looks(text) to authenticated;

commit;
