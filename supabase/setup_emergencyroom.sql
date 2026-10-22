-- One-off: make the Emergency Room brand crew (Emergency Room by SOS) on a database, after crew_rooms.sql, crew_rails.sql,
-- crew_reactions.sql, game_time.sql and crew_rooms_scale.sql are loaded, and after emergency_room_template.sql (the layout of
-- the room). Safe to run again: it finds the crew it made and only fixes it up.
--
-- Before running:
--   1. The Emergency Room owner's account must exist. They sign up in the app once with this email.
--   2. Replace OWNER_EMAIL_HERE below with that email.
--   3. supabase/emergency_room_template.sql must have been run (it holds the room layout the crew's room uses).
--
-- It makes the crew open and verified, makes the account its owner, sets the round logo (/brands/emergency-room-sos.jpg, the
-- file ships with the app), creates the room on the emergency-room template with the owner content (brand "Emergency Room by SOS",
-- strapline "Electronic music, every week", event words "Emergency Room, SOS" so the featured sticker finds their next night),
-- makes room for a whole night (capacity 90), and prints the crew page and invite links. There is no Game Time and no event in it.
--
-- It will NOT take over somebody else's crew. It only touches a crew called Emergency Room that this owner made. If some other
-- account already has a crew with that name (anyone signed in can make one), it stops and prints that crew's id, so you
-- can look at it and rename or delete it (as staff) before running this again.
--
-- A run again keeps what the owner has typed in MANAGE CREW: it sets the brand name, and fills the strapline and event words
-- only while they are empty. If the room was on another template (the clubhouse), it moves the room to the Emergency Room
-- template and sends everyone walking back in through the new entrance; it refuses while a Game Time is scheduled or live.
--
-- Header pictures: the owner upload screen is off for launch and this crew has no header pictures yet, so none are set here.
-- To add some later, put the files (JPEG, about 1080 px wide, under 300 KB each) in public/brands/, ship the app, and set
-- crews.header_images (up to 5) as setup_360playlist.sql shows.

do $$
declare
  v_owner uuid;
  v_crew  uuid;
  v_code  text;
  v_other record;
  v_room  public.crew_rooms;
begin
  select id into v_owner from auth.users where lower(email) = lower('OWNER_EMAIL_HERE');
  if v_owner is null then
    raise exception 'Emergency Room owner account not found. Sign up in the app with that email first.';
  end if;

  if not exists (select 1 from public.crew_room_layouts where template = 'emergency-room' and width = 30)
     or not exists (select 1 from public.crew_room_layouts where template = 'emergency-room' and width = 36) then
    raise exception 'The emergency-room room layout is not loaded. Run supabase/emergency_room_template.sql first.';
  end if;

  -- The brand crew: the one this owner made.
  select id into v_crew from public.crews
    where created_by = v_owner and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'emergencyroom'
    order by verified desc, created_at limit 1;

  if v_crew is null then
    -- Nothing of the owner's yet. Another account holding the name is a stop sign, not something to adopt.
    select id, name, created_by, verified into v_other from public.crews
      where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'emergencyroom' order by verified desc, created_at limit 1;
    if v_other.id is not null then
      raise exception 'A crew called % already exists and is not this owner''s (crew id %, made by account %). Check it, then rename or remove it as staff and run this again.',
        v_other.name, v_other.id, v_other.created_by;
    end if;
    insert into public.crews (name, created_by, visibility, verified)
      values ('Emergency Room', v_owner, 'open', true)
      returning id into v_crew;
  else
    update public.crews set name = 'Emergency Room', visibility = 'open', verified = true where id = v_crew;
  end if;

  insert into public.crew_members (crew_id, user_id, role)
    values (v_crew, v_owner, 'owner')
    on conflict (crew_id, user_id) do update set role = 'owner';

  update public.crews set logo_url = '/brands/emergency-room-sos.jpg' where id = v_crew;

  select * into v_room from public.crew_rooms where crew_id = v_crew;
  if not found then
    insert into public.crew_rooms (crew_id, width, template, content, capacity)
      values (v_crew, 30, 'emergency-room', jsonb_build_object(
        'brand', 'Emergency Room by SOS', 'strapline', 'Electronic music, every week', 'musicTitle', '', 'musicUrl', '', 'audioUrl', '',
        'artistTitle', '', 'artistNote', '', 'eventKeywords', 'Emergency Room, SOS', 'awards', '[]'::jsonb), 90);
  else
    if v_room.template is distinct from 'emergency-room' then
      if public._crew_room_hunt_busy(v_crew) then
        raise exception 'A Game Time is scheduled or live for this crew: its room cannot change template until it is over.';
      end if;
      update public.crew_rooms set template = 'emergency-room', version = version + 1, updated_at = clock_timestamp() where crew_id = v_crew;
      -- Everyone walks back in through the new entrance.
      delete from public.crew_room_circles where crew_id = v_crew;
      delete from public.crew_room_presence where crew_id = v_crew;
    end if;
    update public.crew_rooms
       set content = jsonb_set(
                       jsonb_set(
                         jsonb_set(coalesce(content, '{}'::jsonb), '{brand}', to_jsonb('Emergency Room by SOS'::text)),
                         '{strapline}', to_jsonb(case when coalesce(content->>'strapline', '') = '' then 'Electronic music, every week' else content->>'strapline' end)),
                       '{eventKeywords}', to_jsonb(case when coalesce(content->>'eventKeywords', '') = '' then 'Emergency Room, SOS' else content->>'eventKeywords' end)),
           capacity = greatest(capacity, 90)
     where crew_id = v_crew;
  end if;

  select invite_code into v_code from public.crews where id = v_crew;
  raise notice 'Emergency Room crew page: /crew/%', v_crew;
  raise notice 'Emergency Room room:      /crew/%/room', v_crew;
  raise notice 'Emergency Room invite:    /crew/join/%', v_code;
end $$;
