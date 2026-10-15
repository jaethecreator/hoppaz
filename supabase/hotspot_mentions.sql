-- ============================================================================
-- Hoppaz: tag an alias in a hotspot chat and they get a ping.
--
-- RUN ORDER: schema.sql, chat_accounts.sql, ..., hotspots.sql, then this file. crew_friends.sql may be before or after it:
--            crew_friend_inbox() (crew_friends.sql) reads the pings when this table exists and says nothing when it does not.
--            Safe to run again. It adds a table, a trigger and two functions; it replaces nothing of hotspots.sql or
--            chat_accounts.sql, so re-running either of those cannot undo it.
--
-- HOW A TAG TRAVELS. Hotspot chat refuses an "@name" (hotspot_text_problem: no_links), on purpose: it is how people would swap
-- handles. A tag is therefore not an "@" in the stored text. The app writes it as the alias inside two white square brackets,
-- U+27E6 alias U+27E7, which the filter reads as plain words, and shows it as "@alias". Typing "@" in the box lists the aliases in
-- the room; picking one writes the token. A token that is not an alias in the room pings nobody.
--
-- WHAT HAPPENS. After a message is stored in a hotspot channel, each token (at most 3 per message) is matched, case
-- insensitively, against the aliases of people with a live visit in that same hotspot. The match is made here; the sender
-- never learns who an alias is and the target never learns who tagged them: hotspot_mentions holds the target, the sender's
-- ALIAS, the place, the hotspot's slug and an excerpt, and no sender id at all (who tagged whom for the limits lives in
-- hotspot_mention_log, which nothing can read).
--
-- WHO GETS NO PING. Yourself. Someone who left the room. Anyone either of you has blocked (the global blocks and the hotspot
-- blocks, both directions). A muted sender cannot post, so there is no message to ping from. A sender tags the same person at
-- most once a minute and makes at most 20 tags a day; a tag over the limit is just words in the message.
--
-- WHO READS. The target, and only the target: row level security on hotspot_mentions. They arrive live over Realtime and are
-- in crew_friend_inbox().mentions (unseen, last 24 hours) for the badge and the "tagged you" list. crew_friend_mention_seen
-- marks them seen.
-- ============================================================================
begin;

-- Who tagged whom and when: for the limits only. RLS on and nothing granted.
create table if not exists public.hotspot_mention_log (
  from_user  uuid not null references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists hotspot_mention_log_from_idx on public.hotspot_mention_log (from_user, created_at desc);
create index if not exists hotspot_mention_log_pair_idx on public.hotspot_mention_log (from_user, to_user, created_at desc);
alter table public.hotspot_mention_log enable row level security;
revoke all on public.hotspot_mention_log from anon, authenticated;

-- The pings. No sender id on purpose (see above).
create table if not exists public.hotspot_mentions (
  id         uuid primary key default gen_random_uuid(),
  to_user    uuid not null references public.profiles(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  channel    text not null,
  hotspot_id uuid,
  slug       text not null default '',
  place      text not null default '',
  from_alias text not null,
  excerpt    text not null default '',
  seen_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hotspot_mentions_to_idx on public.hotspot_mentions (to_user, seen_at, created_at desc);
alter table public.hotspot_mentions enable row level security;
drop policy if exists hotspot_mentions_target_read on public.hotspot_mentions;
create policy hotspot_mentions_target_read on public.hotspot_mentions for select to authenticated using (to_user = auth.uid());
revoke all on public.hotspot_mentions from anon, authenticated;
grant select on public.hotspot_mentions to authenticated;

do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'hotspot_mentions') then
    alter publication supabase_realtime add table public.hotspot_mentions;
  end if;
end $do$;

-- The trigger. It never refuses a message and never raises: a ping that cannot be made is simply not made.
create or replace function public.hotspot_mentions_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sender uuid; hid uuid; h hotspots; place text; tok text; target uuid; n int; done int := 0; shown text;
begin
  begin
    select ri.user_id into sender from room_identities ri where ri.id = new.author_key;
    if sender is null or new.body is null or position(U&'\27E6' in new.body) = 0 then return new; end if;
    if new.channel !~ '^hotspot:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return new; end if;
    hid := substr(new.channel, 9)::uuid;
    select * into h from hotspots where id = hid;
    if not found then return new; end if;
    place := public.hotspot_place_name(h.junction, h.name);
    shown := left(regexp_replace(regexp_replace(new.body, U&'\27E6', '@', 'g'), U&'\27E7', '', 'g'), 80);

    for tok in select t.m[1] from regexp_matches(new.body, U&'\27E6([^\27E6\27E7]{1,40})\27E7', 'g') as t(m) loop
      exit when done >= 3;
      done := done + 1;
      -- the alias, among people with a live visit in THIS hotspot
      select ri.user_id into target
        from hotspot_visits v
        join room_identities ri on ri.id = v.key
       where v.hotspot_id = hid and v.fades_at > now() and ri.channel = new.channel and not ri.anon
         and lower(ri.alias) = lower(btrim(tok))
       limit 1;
      continue when target is null or target = sender;
      continue when public.is_blocked(sender, target)
                 or public.hotspot_blocked(sender, target);
      continue when exists (select 1 from hotspot_mention_log
                             where from_user = sender and to_user = target and created_at > now() - interval '1 minute');
      select count(*) into n from hotspot_mention_log where from_user = sender and created_at > now() - interval '1 day';
      exit when n >= 20;
      insert into hotspot_mention_log (from_user, to_user) values (sender, target);
      insert into hotspot_mentions (to_user, message_id, channel, hotspot_id, slug, place, from_alias, excerpt)
      values (target, new.id, new.channel, hid, h.slug, coalesce(place, ''), coalesce(new.author_name, 'A Hopper'), shown);
    end loop;

    if random() < 0.02 then
      delete from hotspot_mentions where created_at < now() - interval '3 days';
      delete from hotspot_mention_log where created_at < now() - interval '2 days';
    end if;
  exception when others then
    -- a failed ping must never fail the message
    null;
  end;
  return new;
end $$;
revoke all on function public.hotspot_mentions_after() from public, anon, authenticated;

drop trigger if exists messages_hotspot_mentions on public.messages;
create trigger messages_hotspot_mentions after insert on public.messages
  for each row when (new.channel like 'hotspot:%') execute function public.hotspot_mentions_after();

-- "Seen": the toast was tapped, or the list was. Only my own pings; ids that are not mine do nothing.
create or replace function public.crew_friend_mention_seen(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or p_ids is null then return 0; end if;
  update hotspot_mentions set seen_at = now()
   where to_user = auth.uid() and seen_at is null and id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.crew_friend_mention_seen(uuid[]) from public, anon;
grant execute on function public.crew_friend_mention_seen(uuid[]) to authenticated;

commit;
