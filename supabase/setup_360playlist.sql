-- One-off: make the 360Playlist brand crew on a database, after crew_rooms.sql, crew_rails.sql, crew_reactions.sql
-- and game_time.sql are loaded (in that order). Safe to run again: it finds the crew it made and only fixes it up.
--
-- Before running:
--   1. 360's account must exist. They sign up in the app once with this email.
--   2. Replace OWNER_EMAIL_HERE below with that email (in the first statement, and again in the commented one at the end).
--
-- It makes the crew open and verified, makes the account its owner, sets the round logo, creates the room, puts the Dave
-- night on the fountain with the ribbon FREE, makes room for the whole night (capacity 90), and prints the crew page and
-- invite links.
--
-- It will NOT take over somebody else's crew. It only touches a crew called 360Playlist that this owner made. If some other
-- account already has a crew with that name (anyone signed in can make one), it stops and prints that crew's id, so you
-- can look at it and rename or delete it (as staff) before running this again.
--
-- Header pictures: the owner upload screen is off for launch. Put the pictures (JPEG, about 1080 px wide, under 300 KB each)
-- in public/brands/, ship the app, and set them here with the last statement below (up to 5, in the order they play).

do $$
declare
  v_owner uuid;
  v_crew  uuid;
  v_dave  uuid;
  v_code  text;
  v_other record;
begin
  select id into v_owner from auth.users where lower(email) = lower('OWNER_EMAIL_HERE');
  if v_owner is null then
    raise exception '360Playlist owner account not found. Sign up in the app with that email first.';
  end if;

  -- The brand crew: the one this owner made.
  select id into v_crew from public.crews
    where created_by = v_owner and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = '360playlist'
    order by verified desc, created_at limit 1;

  if v_crew is null then
    -- Nothing of the owner's yet. Another account holding the name is a stop sign, not something to adopt.
    select id, name, created_by, verified into v_other from public.crews
      where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = '360playlist' order by verified desc, created_at limit 1;
    if v_other.id is not null then
      raise exception 'A crew called % already exists and is not this owner''s (crew id %, made by account %). Check it, then rename or remove it as staff and run this again.',
        v_other.name, v_other.id, v_other.created_by;
    end if;
    insert into public.crews (name, created_by, visibility, verified)
      values ('360Playlist', v_owner, 'open', true)
      returning id into v_crew;
  else
    update public.crews set name = '360Playlist', visibility = 'open', verified = true where id = v_crew;
  end if;

  insert into public.crew_members (crew_id, user_id, role)
    values (v_crew, v_owner, 'owner')
    on conflict (crew_id, user_id) do update set role = 'owner';

  update public.crews set logo_url = '/brands/360playlist.jpg' where id = v_crew;

  insert into public.crew_rooms (crew_id, width, content, capacity)
    values (v_crew, 30, jsonb_build_object(
      'brand', '360Playlist', 'strapline', '', 'musicTitle', '', 'musicUrl', '', 'audioUrl', '',
      'artistTitle', '', 'artistNote', '', 'eventKeywords', '360Playlist, Dave', 'awards', '[]'::jsonb), 90)
    on conflict (crew_id) do update
      set content = jsonb_set(crew_rooms.content, '{brand}', to_jsonb('360Playlist'::text)),
          capacity = greatest(crew_rooms.capacity, 90);

  -- The Dave night: the next upcoming event whose title mentions Dave and the Harp.
  select id into v_dave from public.events
    where title ilike '%dave%' and title ilike '%harp%' and starts_at > now() - interval '1 day'
    order by starts_at limit 1;
  if v_dave is not null then
    update public.crew_rooms set featured_event_id = v_dave, featured_ribbon = 'FREE' where crew_id = v_crew;
  else
    raise notice 'No upcoming Dave event found: the fountain stays plain until one is posted and set in MANAGE CREW.';
  end if;

  select invite_code into v_code from public.crews where id = v_crew;
  raise notice '360Playlist crew page: /crew/%', v_crew;
  raise notice '360Playlist room:      /crew/%/room', v_crew;
  raise notice '360Playlist invite:    /crew/join/%', v_code;
end $$;

-- Header pictures, once the files are in public/brands/ and the app is shipped. Up to 5, in the order they play.
-- (Uncomment and run.)
-- update public.crews set header_images = array['/brands/360-hub-1.jpg', '/brands/360-hub-2.jpg', '/brands/360-hub-3.jpg']
--  where created_by = (select id from auth.users where lower(email) = lower('OWNER_EMAIL_HERE'))
--    and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = '360playlist';
