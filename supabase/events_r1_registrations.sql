-- ============================================================================
-- DRAFT FOR OLA, NOT RUN ON PRODUCTION
-- Hoppaz Release 1, file 2 of 6: registrations (the Audience), approval, capacity and the waitlist.
-- Written from the fake layer (src/lib/events-r1/fake/registrations.ts and rules.ts).
--
-- RUN ORDER: schema.sql, chat_accounts.sql, crew_rooms.sql, events_r1_events.sql, then THIS FILE. Then tickets, pops, reports,
--            rooms (see EVENTS_R1_ORDER.md). Safe to run again. It replaces only the stubs events_r1_events.sql left for it
--            (_ev_going, _ev_reg_status, _ev_fill_waitlist, _ev_copy_settings). It writes two stubs of its own, only when missing,
--            for events_r1_tickets.sql: ev_issue_ticket and ev_void_ticket (no ticket is made until that file is run).
--
-- WHAT IT IS. Swiping right on the deck stays what it is today: "interested", a private like. Register is the commitment. A
-- registration is one row per person per event. Free events only in Release 1 (an event with a price is refused).
--
--   ev_registrations           one row per person per event: status, answers to the host's questions, who invited them, the place
--                              on the waitlist. Closed to anon and authenticated: no policy, no grant.
--   ev_registration_settings   the host's questions and the three messages (Pending, Going, Declined), one small jsonb row per
--                              event, on a closed table. No row means the defaults.
--
-- Statuses: requested (free, approval on, waiting for the host), going, waitlisted, declined, cancelled, checked_in.
-- Places (capacity) are counted from going and checked_in only. Someone waiting for approval, on the waitlist, declined or
-- cancelled does not use a place.
--
--   ev_register(event, opts)            opts: { answers: {question id: text}, referrerId: uuid }. Needs a session and an account
--                                       (has_account()). The event row is locked (for update), so two people cannot take the last
--                                       place. Outcome: going (a place and no approval), requested (approval on), waitlisted (full
--                                       and the waitlist is on). Full with no waitlist: full. { ok, registration } or { ok: false,
--                                       reason }. Registering again while registered returns the same registration.
--                                       reasons: no_session, need_account, not_found, cancelled, event_over, paid_not_open, declined,
--                                       full, answer_needed (with the question), too_many_answers, answer_too_long.
--   ev_cancel_registration(event)       my own. Text: ok | not_found | not_registered | already_checked_in. If I was going, my ticket
--                                       is voided and the next waitlisted person is promoted, in the same transaction. With approval
--                                       on, the next waitlisted person moves to requested and the host decides (as in the fake layer).
--   ev_decide(registration, action)     host or staff. action approve | decline. Approving someone when the event is full puts them on
--                                       the waitlist instead. { ok, registration } or { ok: false, reason: not_found | not_allowed |
--                                       bad_action | nothing_to_approve | already_checked_in }.
--   ev_promote(registration)            host or staff: a waitlisted person goes in now. no_free_place when full (raise the capacity).
--   ev_audience(event)                  host or staff: { ok, counts: {going, checked_in, pending, waitlist, declined}, registrations }.
--                                       going counts going and checked_in together, like the door counts.
--   ev_export(event)                    host or staff: rows (name, email, phone, status, registered, checked_in, invited_by), cancelled
--                                       left out. Nothing for anyone else. The screen builds the CSV: it should put a ' in front of
--                                       any cell that starts with = + - or @, so a spreadsheet does not run a guest's name as a formula.
--   ev_get_registration_settings(event) { questions, messages } for anyone who can open the event.
--   ev_set_registration_settings(event, settings)   host or staff. Name and Email are always asked and required. Text: ok | code.
--   ev_viewer_state(event)              what the one button on the event page should be, for this viewer (the ViewerState type).
--
-- The waitlist order is the time people joined (created_at; someone who cancels and registers again goes to the back).
-- ev_audience returns every email to the host: say so on the registration screen (the framework doc asks for a data-sharing line).
-- ============================================================================
begin;

create table if not exists public.ev_registrations (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  status        text not null check (status in ('requested', 'going', 'waitlisted', 'declined', 'cancelled', 'checked_in')),
  name          text not null default '',
  answers       jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) < 4096),
  referrer_id   uuid references public.profiles(id) on delete set null,
  waitlist_pos  integer check (waitlist_pos is null or waitlist_pos >= 1),
  -- clock_timestamp, not now(): the waitlist order is the order people joined, even inside one transaction.
  created_at    timestamptz not null default clock_timestamp(),
  updated_at    timestamptz not null default clock_timestamp(),
  checked_in_at timestamptz,
  unique (event_id, user_id)
);
create index if not exists ev_registrations_event_idx on public.ev_registrations (event_id, status, created_at);
create index if not exists ev_registrations_user_idx on public.ev_registrations (user_id, status);
alter table public.ev_registrations enable row level security;
revoke all on public.ev_registrations from anon, authenticated;
grant all on public.ev_registrations to service_role;

create table if not exists public.ev_registration_settings (
  event_id   uuid primary key references public.events(id) on delete cascade,
  questions  jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 20),
  messages   jsonb not null check (jsonb_typeof(messages) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.ev_registration_settings enable row level security;
revoke all on public.ev_registration_settings from anon, authenticated;
grant all on public.ev_registration_settings to service_role;

-- Stubs for the ticket file, written only when missing.
do $stubs$
begin
  if to_regprocedure('public.ev_issue_ticket(uuid)') is null then
    create function public.ev_issue_ticket(p_registration uuid) returns uuid
    language sql security definer set search_path = public, pg_temp as 'select null::uuid';
    revoke all on function public.ev_issue_ticket(uuid) from public, anon, authenticated;
    grant execute on function public.ev_issue_ticket(uuid) to service_role;
  end if;
  if to_regprocedure('public.ev_void_ticket(uuid)') is null then
    create function public.ev_void_ticket(p_registration uuid) returns void
    language plpgsql security definer set search_path = public, pg_temp as 'begin return; end';
    revoke all on function public.ev_void_ticket(uuid) from public, anon, authenticated;
    grant execute on function public.ev_void_ticket(uuid) to service_role;
  end if;
end $stubs$;

-- ------------------------------------------------------------- helpers (real) ---
create or replace function public._ev_going(p_event uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.ev_registrations r where r.event_id = p_event and r.status in ('going', 'checked_in');
$$;
revoke all on function public._ev_going(uuid) from public, anon, authenticated;

create or replace function public._ev_reg_status(p_event uuid, p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select r.status from public.ev_registrations r where r.event_id = p_event and r.user_id = p_user;
$$;
revoke all on function public._ev_reg_status(uuid, uuid) from public, anon, authenticated;

create or replace function public._ev_full(p_event uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select e.capacity is not null and public._ev_going(e.id) >= e.capacity from public.events e where e.id = p_event), false);
$$;
revoke all on function public._ev_full(uuid) from public, anon, authenticated;

-- Waitlist places: 1 = next, in the order people joined. The caller holds the event lock.
create or replace function public._ev_renumber_waitlist(p_event uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.ev_registrations r set waitlist_pos = n.pos
    from (select x.id, row_number() over (order by x.created_at, x.id)::int as pos
            from public.ev_registrations x where x.event_id = p_event and x.status = 'waitlisted') n
   where r.id = n.id and r.waitlist_pos is distinct from n.pos;
  update public.ev_registrations set waitlist_pos = null
   where event_id = p_event and status <> 'waitlisted' and waitlist_pos is not null;
end $$;
revoke all on function public._ev_renumber_waitlist(uuid) from public, anon, authenticated;

-- When places open (a cancel, a decline, a bigger capacity), waitlisted people move up in order, inside the caller's
-- transaction. Approval off: they are going, with a ticket. Approval on: they move to requested and the host decides.
-- The caller holds the event lock.
create or replace function public._ev_fill_waitlist(p_event uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e         public.events;
  w         record;
  v_room    integer;
  v_moved   integer := 0;
begin
  select * into e from public.events where id = p_event;
  if not found or e.status not in ('live', 'unlisted') then return; end if;
  if e.requires_approval then
    v_room := case when e.capacity is null then 1000000 else greatest(0, e.capacity - public._ev_going(p_event)) end
              - (select count(*)::int from public.ev_registrations where event_id = p_event and status = 'requested');
    for w in select id from public.ev_registrations where event_id = p_event and status = 'waitlisted' order by created_at, id loop
      exit when v_moved >= v_room;
      update public.ev_registrations set status = 'requested', waitlist_pos = null, updated_at = now() where id = w.id;
      v_moved := v_moved + 1;
    end loop;
  else
    for w in select id from public.ev_registrations where event_id = p_event and status = 'waitlisted' order by created_at, id loop
      exit when e.capacity is not null and public._ev_going(p_event) >= e.capacity;
      update public.ev_registrations set status = 'going', waitlist_pos = null, updated_at = now() where id = w.id;
      perform public.ev_issue_ticket(w.id);
    end loop;
  end if;
  perform public._ev_renumber_waitlist(p_event);
end $$;
revoke all on function public._ev_fill_waitlist(uuid) from public, anon, authenticated;

-- A registration as a screen gets it (the Registration type). The email is the person's account email.
create or replace function public._ev_reg_json(r public.ev_registrations) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', r.id, 'event_id', r.event_id, 'user_id', r.user_id, 'name', r.name,
    'email', coalesce((select u.email from auth.users u where u.id = r.user_id), ''),
    'phone', r.answers ->> 'phone', 'status', r.status, 'answers', r.answers,
    'referrer_id', r.referrer_id,
    'referrer_name', (select coalesce(nullif(btrim(p.display_name), ''), p.handle) from public.profiles p where p.id = r.referrer_id),
    'created_at', r.created_at, 'checked_in_at', r.checked_in_at, 'waitlist_pos', r.waitlist_pos);
$$;
revoke all on function public._ev_reg_json(public.ev_registrations) from public, anon, authenticated;

-- --------------------------------------------------- registration settings ---
create or replace function public._ev_default_questions() returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select '[{"id":"name","label":"Name","required":true,"builtin":"name","enabled":true},
           {"id":"email","label":"Email","required":true,"builtin":"email","enabled":true},
           {"id":"phone","label":"Phone","required":false,"builtin":"phone","enabled":false}]'::jsonb;
$$;
create or replace function public._ev_default_messages() returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'pending', 'Your request is in. The host will let you know soon.',
    'going', 'You''re in. See you there.',
    'declined', 'Sorry, the host can''t take your request this time.');
$$;
revoke all on function public._ev_default_questions(), public._ev_default_messages() from public, anon, authenticated;

create or replace function public._ev_settings(p_event uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'questions', coalesce((select s.questions from public.ev_registration_settings s where s.event_id = p_event), public._ev_default_questions()),
    'messages', public._ev_default_messages() || coalesce((select s.messages from public.ev_registration_settings s where s.event_id = p_event), '{}'::jsonb));
$$;
revoke all on function public._ev_settings(uuid) from public, anon, authenticated;

create or replace function public._ev_copy_settings(p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.ev_registration_settings (event_id, questions, messages)
  select p_to, s.questions, s.messages from public.ev_registration_settings s where s.event_id = p_from
  on conflict (event_id) do nothing;
end $$;
revoke all on function public._ev_copy_settings(uuid, uuid) from public, anon, authenticated;

create or replace function public.ev_get_registration_settings(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._ev_can_open(p_event) then return null; end if;
  return public._ev_settings(p_event);
end $$;

create or replace function public.ev_set_registration_settings(p_event uuid, p_settings jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cur     jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_ids     text[] := '{}';
  v_msgs    jsonb;
  q         jsonb;
  v_id      text;
  v_label   text;
  v_builtin text;
  v_req     boolean;
  v_on      boolean;
  k         text;
begin
  if auth.uid() is null then return 'no_session'; end if;
  perform 1 from public.events where id = p_event for update;
  if not found then return 'not_found'; end if;
  if not public._ev_manage(p_event) then return 'not_allowed'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then return 'bad_settings'; end if;
  v_cur := public._ev_settings(p_event);

  if p_settings ? 'questions' then
    if jsonb_typeof(p_settings -> 'questions') <> 'array' or jsonb_array_length(p_settings -> 'questions') > 20 then return 'bad_questions'; end if;
    for q in select value from jsonb_array_elements(p_settings -> 'questions') loop
      if jsonb_typeof(q) <> 'object' then return 'bad_questions'; end if;
      v_id := q ->> 'id';
      v_label := btrim(coalesce(q ->> 'label', ''));
      v_builtin := nullif(q ->> 'builtin', '');
      if v_id is null or v_id !~ '^[a-z0-9_]{1,40}$' then return 'bad_question_id'; end if;
      if v_label = '' or char_length(v_label) > 80 then return 'bad_question_label'; end if;
      if v_id = any (v_ids) then return 'duplicate_question'; end if;
      if v_builtin is not null and v_builtin not in ('name', 'email', 'phone') then return 'bad_questions'; end if;
      v_ids := v_ids || v_id;
      -- Name and Email are always asked, and always required.
      v_req := case when v_builtin in ('name', 'email') then true
                    when jsonb_typeof(q -> 'required') = 'boolean' then (q ->> 'required')::boolean else false end;
      v_on := case when v_builtin in ('name', 'email') then true
                   when jsonb_typeof(q -> 'enabled') = 'boolean' then (q ->> 'enabled')::boolean else true end;
      v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                 'id', v_id, 'label', v_label, 'required', v_req, 'builtin', v_builtin, 'enabled', v_on)));
    end loop;
    if not exists (select 1 from jsonb_array_elements(v_out) x where x ->> 'builtin' = 'name')
       or not exists (select 1 from jsonb_array_elements(v_out) x where x ->> 'builtin' = 'email') then
      return 'name_and_email_stay';
    end if;
  else
    v_out := v_cur -> 'questions';
  end if;

  v_msgs := v_cur -> 'messages';
  if p_settings ? 'messages' then
    if jsonb_typeof(p_settings -> 'messages') <> 'object' then return 'bad_messages'; end if;
    foreach k in array array['pending', 'going', 'declined'] loop
      if (p_settings -> 'messages') ? k then
        if jsonb_typeof(p_settings -> 'messages' -> k) <> 'string'
           or btrim(p_settings -> 'messages' ->> k) = '' or char_length(p_settings -> 'messages' ->> k) > 500 then
          return 'bad_message';
        end if;
        v_msgs := v_msgs || jsonb_build_object(k, btrim(p_settings -> 'messages' ->> k));
      end if;
    end loop;
  end if;

  insert into public.ev_registration_settings (event_id, questions, messages) values (p_event, v_out, v_msgs)
  on conflict (event_id) do update set questions = excluded.questions, messages = excluded.messages, updated_at = now();
  return 'ok';
end $$;

-- ------------------------------------------------------------------ register ---
create or replace function public.ev_register(p_event uuid, p_opts jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me        uuid := auth.uid();
  e         public.events;
  r         public.ev_registrations;
  v_opts    jsonb := coalesce(p_opts, '{}'::jsonb);
  v_answers jsonb := '{}'::jsonb;
  v_status  text;
  v_ref     uuid;
  v_name    text;
  v_txt     text;
  v_count   integer := 0;
  a         record;
  q         jsonb;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if not public.has_account() then return jsonb_build_object('ok', false, 'reason', 'need_account'); end if;
  if jsonb_typeof(v_opts) <> 'object' then v_opts := '{}'::jsonb; end if;

  -- The event row is the lock for everything that changes the places.
  select * into e from public.events where id = p_event for update;
  if not found or not public._ev_can_open(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if e.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  if e.status not in ('live', 'unlisted') then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if now() > coalesce(e.ends_at, e.starts_at + interval '3 hours') then return jsonb_build_object('ok', false, 'reason', 'event_over'); end if;
  if e.price_naira > 0 then return jsonb_build_object('ok', false, 'reason', 'paid_not_open'); end if;

  select * into r from public.ev_registrations where event_id = p_event and user_id = me for update;
  if r.id is not null and r.status <> 'cancelled' then
    if r.status = 'declined' then return jsonb_build_object('ok', false, 'reason', 'declined'); end if;
    return jsonb_build_object('ok', true, 'registration', public._ev_reg_json(r));
  end if;

  -- The answers: text only, short keys, a few of them.
  if jsonb_typeof(v_opts -> 'answers') = 'object' then
    for a in select key, value from jsonb_each(v_opts -> 'answers') loop
      if jsonb_typeof(a.value) <> 'string' or btrim(a.value #>> '{}') = '' then continue; end if;
      if a.key !~ '^[a-z0-9_]{1,40}$' then continue; end if;
      v_count := v_count + 1;
      if v_count > 20 then return jsonb_build_object('ok', false, 'reason', 'too_many_answers'); end if;
      v_txt := btrim(a.value #>> '{}');
      if char_length(v_txt) > 500 then return jsonb_build_object('ok', false, 'reason', 'answer_too_long'); end if;
      v_answers := v_answers || jsonb_build_object(a.key, v_txt);
    end loop;
  end if;
  -- A custom question the host switched on and made required needs an answer. Name and Email come from the account.
  for q in select value from jsonb_array_elements(public._ev_settings(p_event) -> 'questions') loop
    if q ->> 'builtin' is not null then continue; end if;
    if jsonb_typeof(q -> 'enabled') = 'boolean' and (q ->> 'enabled')::boolean is false then continue; end if;
    if jsonb_typeof(q -> 'required') = 'boolean' and (q ->> 'required')::boolean and (v_answers ->> (q ->> 'id')) is null then
      return jsonb_build_object('ok', false, 'reason', 'answer_needed', 'question', q ->> 'label');
    end if;
  end loop;

  -- Full: the waitlist if it is on, otherwise closed. Approval on: requested. Otherwise: in.
  if public._ev_full(p_event) then
    if not e.waitlist_on then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
    v_status := 'waitlisted';
  else
    v_status := case when e.requires_approval then 'requested' else 'going' end;
  end if;

  if jsonb_typeof(v_opts -> 'referrerId') = 'string' and (v_opts ->> 'referrerId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select p.id into v_ref from public.profiles p where p.id = (v_opts ->> 'referrerId')::uuid and p.id <> me;
  end if;
  select coalesce(nullif(btrim(p.display_name), ''), p.handle, 'Guest') into v_name from public.profiles p where p.id = me;

  if r.id is null then
    insert into public.ev_registrations (event_id, user_id, status, name, answers, referrer_id)
    values (p_event, me, v_status, coalesce(v_name, 'Guest'), v_answers, v_ref)
    returning * into r;
  else
    -- A returning person (they had cancelled): the same row, back in line at the end.
    update public.ev_registrations
       set status = v_status, name = coalesce(v_name, 'Guest'), answers = v_answers,
           referrer_id = coalesce(v_ref, referrer_id), created_at = clock_timestamp(), updated_at = clock_timestamp(),
           checked_in_at = null, waitlist_pos = null
     where id = r.id
    returning * into r;
  end if;
  if v_status = 'going' then perform public.ev_issue_ticket(r.id); end if;
  perform public._ev_renumber_waitlist(p_event);
  select * into r from public.ev_registrations where id = r.id;
  return jsonb_build_object('ok', true, 'registration', public._ev_reg_json(r));
end $$;

create or replace function public.ev_cancel_registration(p_event uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me      uuid := auth.uid();
  r       public.ev_registrations;
  v_was   boolean;
begin
  if me is null then return 'no_session'; end if;
  perform 1 from public.events where id = p_event for update;
  if not found then return 'not_found'; end if;
  select * into r from public.ev_registrations where event_id = p_event and user_id = me for update;
  if r.id is null then return 'not_registered'; end if;
  if r.status = 'cancelled' then return 'ok'; end if;
  if r.status = 'checked_in' then return 'already_checked_in'; end if;
  v_was := r.status = 'going';
  update public.ev_registrations set status = 'cancelled', waitlist_pos = null, updated_at = now() where id = r.id;
  if v_was then
    perform public.ev_void_ticket(r.id);
    perform public._ev_fill_waitlist(p_event);
  else
    perform public._ev_renumber_waitlist(p_event);
  end if;
  return 'ok';
end $$;

-- -------------------------------------------------------------- host actions ---
create or replace function public.ev_decide(p_registration uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event uuid;
  r       public.ev_registrations;
  v_was   boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if p_action is null or p_action not in ('approve', 'decline') then return jsonb_build_object('ok', false, 'reason', 'bad_action'); end if;
  select event_id into v_event from public.ev_registrations where id = p_registration;
  if v_event is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform 1 from public.events where id = v_event for update;
  if not public._ev_manage(v_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  select * into r from public.ev_registrations where id = p_registration for update;

  if p_action = 'approve' then
    if r.status not in ('requested', 'waitlisted') then return jsonb_build_object('ok', false, 'reason', 'nothing_to_approve'); end if;
    if not public._ev_full(v_event) then
      update public.ev_registrations set status = 'going', waitlist_pos = null, updated_at = now() where id = r.id;
      perform public.ev_issue_ticket(r.id);
    else
      -- No place left: the host's yes puts them on the waitlist.
      update public.ev_registrations set status = 'waitlisted', updated_at = now() where id = r.id;
    end if;
    perform public._ev_renumber_waitlist(v_event);
  else
    if r.status = 'checked_in' then return jsonb_build_object('ok', false, 'reason', 'already_checked_in'); end if;
    if r.status not in ('cancelled', 'declined') then
      v_was := r.status = 'going';
      update public.ev_registrations set status = 'declined', waitlist_pos = null, updated_at = now() where id = r.id;
      if v_was then
        perform public.ev_void_ticket(r.id);
        perform public._ev_fill_waitlist(v_event);
      else
        perform public._ev_renumber_waitlist(v_event);
      end if;
    end if;
  end if;
  select * into r from public.ev_registrations where id = p_registration;
  return jsonb_build_object('ok', true, 'registration', public._ev_reg_json(r));
end $$;

create or replace function public.ev_promote(p_registration uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event uuid;
  r       public.ev_registrations;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  select event_id into v_event from public.ev_registrations where id = p_registration;
  if v_event is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform 1 from public.events where id = v_event for update;
  if not public._ev_manage(v_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  select * into r from public.ev_registrations where id = p_registration for update;
  if r.status <> 'waitlisted' then return jsonb_build_object('ok', false, 'reason', 'not_waitlisted'); end if;
  if public._ev_full(v_event) then return jsonb_build_object('ok', false, 'reason', 'no_free_place'); end if;
  update public.ev_registrations set status = 'going', waitlist_pos = null, updated_at = now() where id = r.id;
  perform public.ev_issue_ticket(r.id);
  perform public._ev_renumber_waitlist(v_event);
  select * into r from public.ev_registrations where id = p_registration;
  return jsonb_build_object('ok', true, 'registration', public._ev_reg_json(r));
end $$;

create or replace function public.ev_audience(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if not exists (select 1 from public.events where id = p_event) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public._ev_manage(p_event) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  return jsonb_build_object(
    'ok', true,
    'counts', (select jsonb_build_object(
                 'going', count(*) filter (where r.status in ('going', 'checked_in')),
                 'checked_in', count(*) filter (where r.status = 'checked_in'),
                 'pending', count(*) filter (where r.status = 'requested'),
                 'waitlist', count(*) filter (where r.status = 'waitlisted'),
                 'declined', count(*) filter (where r.status = 'declined'))
                 from public.ev_registrations r where r.event_id = p_event),
    'registrations', coalesce((
      select jsonb_agg(public._ev_reg_json(t) order by t.created_at desc, t.id)
        from public.ev_registrations t
       where t.id in (select x.id from public.ev_registrations x
                       where x.event_id = p_event and x.status <> 'cancelled'
                       order by x.created_at desc, x.id limit 5000)), '[]'::jsonb));
end $$;

create or replace function public.ev_export(p_event uuid)
returns table (name text, email text, phone text, status text, registered timestamptz, checked_in timestamptz, invited_by text)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.name, coalesce(u.email, ''), r.answers ->> 'phone', r.status, r.created_at, r.checked_in_at,
         coalesce(nullif(btrim(rp.display_name), ''), rp.handle)
    from public.ev_registrations r
    left join auth.users u on u.id = r.user_id
    left join public.profiles rp on rp.id = r.referrer_id
   where r.event_id = p_event and r.status <> 'cancelled' and public._ev_manage(p_event)
   order by lower(r.name), r.id;
$$;

-- What the one button on the event page should be for this viewer (the ViewerState type), and whether they may see the
-- online link and the Join call button (from 15 minutes before the start until the end).
create or replace function public.ev_viewer_state(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me       uuid := auth.uid();
  e        public.events;
  r        public.ev_registrations;
  v_host   boolean;
  v_active boolean;
  v_see    boolean;
  v_status text;
  v_end    timestamptz;
  v_button text;
begin
  select * into e from public.events where id = p_event;
  if not found or not public._ev_can_open(p_event) then return null; end if;
  if me is not null then
    select * into r from public.ev_registrations where event_id = p_event and user_id = me and status <> 'cancelled';
  end if;
  v_active := r.id is not null;
  v_host := me is not null and me = coalesce(e.host_id, e.created_by);
  v_see := me is not null and (v_host or (v_active and r.status in ('going', 'checked_in')));
  v_status := public._ev_status_text(e.status, e.starts_at, e.ends_at);
  v_end := coalesce(e.ends_at, e.starts_at + interval '3 hours');

  if v_status <> 'live' then v_button := 'closed';
  elsif v_active then
    v_button := case r.status when 'going' then 'going' when 'checked_in' then 'going' when 'requested' then 'pending'
                              when 'waitlisted' then 'waitlisted' else 'declined' end;
  elsif e.price_naira > 0 then v_button := 'get_ticket';
  elsif public._ev_full(p_event) then v_button := case when e.waitlist_on then 'waitlist' else 'closed' end;
  else v_button := case when e.requires_approval then 'request' else 'register' end;
  end if;

  return jsonb_build_object(
    'signedIn', me is not null,
    'isHost', v_host,
    'interested', me is not null and exists (select 1 from public.swipes s where s.user_id = me and s.event_id = p_event and s.decision = 'in'),
    'registration', case when v_active then public._ev_reg_json(r) else null end,
    'button', v_button,
    'canSeeOnlineLink', v_see,
    'joinCallOpen', v_see and e.kind <> 'in_person' and v_status = 'live'
                    and now() >= e.starts_at - interval '15 minutes' and now() <= v_end);
end $$;

-- ----------------------------------------------------------------- access ---
revoke all on function public.ev_register(uuid, jsonb), public.ev_cancel_registration(uuid), public.ev_decide(uuid, text),
  public.ev_promote(uuid), public.ev_audience(uuid), public.ev_export(uuid), public.ev_get_registration_settings(uuid),
  public.ev_set_registration_settings(uuid, jsonb), public.ev_viewer_state(uuid) from public, anon;
grant execute on function public.ev_register(uuid, jsonb), public.ev_cancel_registration(uuid), public.ev_decide(uuid, text),
  public.ev_promote(uuid), public.ev_audience(uuid), public.ev_export(uuid), public.ev_get_registration_settings(uuid),
  public.ev_set_registration_settings(uuid, jsonb) to authenticated;
-- The button on the event page also works for a visitor with no account (it says Register, and signing in comes first).
grant execute on function public.ev_viewer_state(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
