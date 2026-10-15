-- One-off: make the 360Playlist brand crew on a database, after crew_rooms.sql (and crew_rails.sql) are loaded.
-- Safe to run again: it finds the crew it made and only fixes it up.
--
-- Before running:
--   1. 360's account must exist. They sign up in the app once with this email.
--   2. Replace OWNER_EMAIL_HERE below with that email.
--
-- It makes the crew open and verified, makes the account its owner, sets the round logo, creates the room,
-- puts the Dave night on the fountain with the ribbon FREE, and finally prints the crew page and invite links.

do $$
declare
  v_owner uuid;
  v_crew  uuid;
  v_dave  uuid;
  v_code  text;
begin
  select id into v_owner from auth.users where lower(email) = lower('OWNER_EMAIL_HERE');
  if v_owner is null then
    raise exception '360Playlist owner account not found. Sign up in the app with that email first.';
  end if;

  select id into v_crew from public.crews where name in ('360Playlist', '360 Playlist') order by verified desc limit 1;
  if v_crew is null then
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

  insert into public.crew_rooms (crew_id, width, content)
    values (v_crew, 30, jsonb_build_object(
      'brand', '360Playlist', 'strapline', '', 'musicTitle', '', 'musicUrl', '', 'audioUrl', '',
      'artistTitle', '', 'artistNote', '', 'eventKeywords', '360Playlist, Dave', 'awards', '[]'::jsonb))
    on conflict (crew_id) do nothing;

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
