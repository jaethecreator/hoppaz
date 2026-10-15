-- Hoppaz: reactions on crew room chat messages (the four buttons in the bar that opens when you tap a message).
--
-- Run after supabase/crew_rooms.sql (it uses _crew_room_message_visible and the message table). Safe to run again.
-- Until it is run the chat hides the four buttons and keeps REPLY and WALK TO, so nothing breaks.
--
--   crew_room_reactions   one row per (message, person, kind). kind is one of heart, fire, laugh, party.
--   crew_room_react       toggles a reaction: adds it, or takes it off if it was already there. Returns true when added.
--
-- A person can react to a message they can read (General, or the area messages they received) and is not blocked by
-- its author. Reading uses the same rule. At most 30 changes in 10 seconds, so a thumb cannot flood a thread.

create table if not exists public.crew_room_reactions (
  message_id uuid not null references public.crew_room_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  crew_id    uuid not null references public.crews(id) on delete cascade,
  kind       text not null check (kind in ('heart', 'fire', 'laugh', 'party')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, kind)
);
create index if not exists crew_room_reactions_user on public.crew_room_reactions(user_id, created_at desc);

alter table public.crew_room_reactions enable row level security;
drop policy if exists crew_room_reactions_read on public.crew_room_reactions;
create policy crew_room_reactions_read on public.crew_room_reactions for select to authenticated
  using (public._crew_room_message_visible(message_id));
revoke all on public.crew_room_reactions from anon, authenticated;
grant select on public.crew_room_reactions to authenticated;

create or replace function public.crew_room_react(p_message uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  crew uuid;
begin
  if auth.uid() is null then raise exception 'need_account'; end if;
  if p_kind not in ('heart', 'fire', 'laugh', 'party') then raise exception 'invalid_reaction'; end if;
  if not public._crew_room_message_visible(p_message) then raise exception 'not_in_crew'; end if;
  select crew_id into crew from crew_room_messages where id = p_message;
  if (select count(*) from crew_room_reactions where user_id = auth.uid() and created_at > clock_timestamp() - interval '10 seconds') >= 30 then
    raise exception 'slow_down';
  end if;
  if exists (select 1 from crew_room_reactions where message_id = p_message and user_id = auth.uid() and kind = p_kind) then
    delete from crew_room_reactions where message_id = p_message and user_id = auth.uid() and kind = p_kind;
    return false;
  end if;
  insert into crew_room_reactions (message_id, user_id, crew_id, kind) values (p_message, auth.uid(), crew, p_kind)
  on conflict do nothing;
  return true;
end $$;
revoke all on function public.crew_room_react(uuid, text) from public, anon;
grant execute on function public.crew_room_react(uuid, text) to authenticated;

-- New and removed reactions reach the open rooms as they happen (the same Realtime setup as the messages).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crew_room_reactions') then
      alter publication supabase_realtime add table public.crew_room_reactions;
    end if;
  end if;
end $$;
