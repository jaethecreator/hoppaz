-- ============================================================================
-- Hoppaz: owner announcements, the quiet way.
--
-- RUN ORDER: schema.sql, chat_accounts.sql, crew_rooms.sql, then this file. It needs only crews, crew_members, profiles and
--            has_account(); it replaces nothing of crew_rooms.sql, crew_rails.sql or chat_accounts.sql, so re-running any of
--            those cannot undo it. Safe to run again.
--
-- WHAT IT IS. A room's owner (and, once there are admins, its admins) posts a short announcement for the room's members. There
-- is no pop-up, no toast, no banner and no push: a member who has not been on all day opens the room and sees ONE thing, the
-- owner's logo pulsing with a small orange "!" while there is an announcement they have not seen. Tapping the logo opens the
-- owner and admins panel, which lists the announcements, latest first; opening it marks them seen and the pulse stops.
--
--   crew_announcements       one row per announcement. Never deleted by a person: a delete sets deleted_at, so a delete does
--                            not give back a slot in the daily limit.
--   crew_announcement_seen   when each member last opened the panel, per room. Unseen means: made after that moment (or, for
--                            someone who never opened it, after they joined, so a new member is not pulsed by old news), and
--                            not made by me.
--
--   crew_announcements(crew)        the panel's read: items (latest 20), unseen, is_staff, can_send
--   crew_announce(crew, body)       post. Staff only, 1 to 280 characters, at most 2 a day per room. sent:<id> | not_staff |
--                                   empty | too_long | slow_down | no_session | need_account
--   crew_announcement_edit(id, body)  ok | not_staff | gone | empty | too_long
--   crew_announcement_delete(id)      ok | not_staff | gone
--   crew_announcement_seen(crew)    I have opened the panel
--
-- Staff means a member whose role is not 'member'. Today the roles are owner and member, so v1 is the owner alone; when an
-- admin role is added to crew_members it is staff here without a change.
-- Who sees it: the room's members. TODO (needs a "last in the room" record that does not exist yet): also people who were in
-- the room in the last 14 days and are not members.
-- ============================================================================
begin;

create table if not exists public.crew_announcements (
  id         uuid primary key default gen_random_uuid(),
  crew_id    uuid not null references public.crews(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null check (char_length(btrim(body)) between 1 and 280),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);
create index if not exists crew_announcements_crew_idx on public.crew_announcements (crew_id, created_at desc);
alter table public.crew_announcements enable row level security;
drop policy if exists crew_announcements_member_read on public.crew_announcements;
create policy crew_announcements_member_read on public.crew_announcements for select to authenticated
  using (deleted_at is null and public.is_crew_member(crew_id));
revoke all on public.crew_announcements from anon, authenticated;
grant select on public.crew_announcements to authenticated;

create table if not exists public.crew_announcement_seen (
  user_id uuid not null references public.profiles(id) on delete cascade,
  crew_id uuid not null references public.crews(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, crew_id)
);
alter table public.crew_announcement_seen enable row level security;
drop policy if exists crew_announcement_seen_own on public.crew_announcement_seen;
create policy crew_announcement_seen_own on public.crew_announcement_seen for select to authenticated using (user_id = auth.uid());
revoke all on public.crew_announcement_seen from anon, authenticated;
grant select on public.crew_announcement_seen to authenticated;

-- Is the caller staff of this room (owner, or an admin role when there is one)?
create or replace function public._ca_staff(p_crew uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from crew_members where crew_id = p_crew and user_id = auth.uid() and role <> 'member');
$$;
revoke all on function public._ca_staff(uuid) from public, anon, authenticated;

-- The panel's read.
create or replace function public.crew_announcements(p_crew uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  base timestamptz; since timestamptz; staff boolean; sent int; items jsonb; fresh int;
begin
  if me is null then return jsonb_build_object('items', '[]'::jsonb, 'unseen', 0, 'is_staff', false, 'can_send', false); end if;
  select joined_at into base from crew_members where crew_id = p_crew and user_id = me;
  if base is null then return jsonb_build_object('items', '[]'::jsonb, 'unseen', 0, 'is_staff', false, 'can_send', false); end if;
  since := coalesce((select seen_at from crew_announcement_seen where user_id = me and crew_id = p_crew), base);
  staff := public._ca_staff(p_crew);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'body', t.body, 'at', t.created_at, 'edited', t.edited_at is not null,
           'by', t.who, 'mine', t.author_id = me,
           'fresh', t.created_at > since and t.author_id is distinct from me) order by t.created_at desc), '[]'::jsonb)
    into items
    from (select a.*, coalesce(nullif(btrim(p.display_name), ''), p.handle, 'The owner') as who
            from crew_announcements a left join profiles p on p.id = a.author_id
           where a.crew_id = p_crew and a.deleted_at is null
           order by a.created_at desc limit 20) t;
  select count(*)::int into fresh from crew_announcements
   where crew_id = p_crew and deleted_at is null and created_at > since and author_id is distinct from me;
  select count(*)::int into sent from crew_announcements where crew_id = p_crew and created_at > now() - interval '1 day';

  return jsonb_build_object('items', items, 'unseen', fresh, 'is_staff', staff, 'can_send', staff and sent < 2);
end $$;

create or replace function public.crew_announce(p_crew uuid, p_body text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); txt text := btrim(coalesce(p_body, '')); n int; new_id uuid;
begin
  if me is null then return 'no_session'; end if;
  if not public.has_account() then return 'need_account'; end if;
  if not public._ca_staff(p_crew) then return 'not_staff'; end if;
  if txt = '' then return 'empty'; end if;
  if char_length(txt) > 280 then return 'too_long'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crew-announce:' || p_crew::text, 0));
  -- deleted ones still count: a delete does not give the slot back
  select count(*) into n from crew_announcements where crew_id = p_crew and created_at > now() - interval '1 day';
  if n >= 2 then return 'slow_down'; end if;
  insert into crew_announcements (crew_id, author_id, body, created_at) values (p_crew, me, txt, clock_timestamp())
  returning id into new_id;
  -- my own post is not news to me
  insert into crew_announcement_seen (user_id, crew_id, seen_at) values (me, p_crew, clock_timestamp())
  on conflict (user_id, crew_id) do update set seen_at = excluded.seen_at;
  return 'sent:' || new_id::text;
end $$;

create or replace function public.crew_announcement_edit(p_id uuid, p_body text) returns text
language plpgsql security definer set search_path = public as $$
declare a crew_announcements; txt text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then return 'gone'; end if;
  select * into a from crew_announcements where id = p_id and deleted_at is null;
  if not found then return 'gone'; end if;
  if not public._ca_staff(a.crew_id) then return 'not_staff'; end if;
  if txt = '' then return 'empty'; end if;
  if char_length(txt) > 280 then return 'too_long'; end if;
  update crew_announcements set body = txt, edited_at = now() where id = p_id;
  return 'ok';
end $$;

create or replace function public.crew_announcement_delete(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare a crew_announcements;
begin
  if auth.uid() is null then return 'gone'; end if;
  select * into a from crew_announcements where id = p_id and deleted_at is null;
  if not found then return 'gone'; end if;
  if not public._ca_staff(a.crew_id) then return 'not_staff'; end if;
  update crew_announcements set deleted_at = now() where id = p_id;
  return 'ok';
end $$;

-- I have opened the panel.
create or replace function public.crew_announcement_seen(p_crew uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from crew_members where crew_id = p_crew and user_id = auth.uid()) then return; end if;
  insert into crew_announcement_seen (user_id, crew_id, seen_at) values (auth.uid(), p_crew, clock_timestamp())
  on conflict (user_id, crew_id) do update set seen_at = excluded.seen_at;
end $$;

revoke all on function public.crew_announcements(uuid), public.crew_announce(uuid, text), public.crew_announcement_edit(uuid, text),
  public.crew_announcement_delete(uuid), public.crew_announcement_seen(uuid) from public, anon;
grant execute on function public.crew_announcements(uuid), public.crew_announce(uuid, text), public.crew_announcement_edit(uuid, text),
  public.crew_announcement_delete(uuid), public.crew_announcement_seen(uuid) to authenticated;

commit;
