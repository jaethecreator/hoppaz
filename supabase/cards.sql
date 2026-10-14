-- ============================================================================
-- Hoppaz: the card deck, phase A (cards, sets, the box picker, the album, Visited)
-- Run order: schema.sql, chat_accounts.sql, hunt_items.sql, spawning.sql,
-- spawn_points_lagos.sql, box_guards.sql, daily_box.sql, play.sql, then THIS
-- FILE. Safe to run again. Spec: docs/CARDS.md. Test: tests/cards_test.sql.
-- A test deck for staging is in cards_sample.sql (never production).
--
-- Cards are mainly places, Nomad List style. A box that is allowed to pay cards
-- (game_drops.card_max_tier) and has a 'card' prize (drop_rewards.card_tier)
-- gives one when it is claimed: a trigger on drop_claims calls grant_card inside
-- the claim, so claim_game_drop itself is untouched, and neither play.sql nor a
-- schema.sql run again can undo it. Standing at a card's place stamps it Visited.
--
-- What it adds:
--   card_sets        57 councils plus city-wide and campus sets. Public when live.
--   cards            the catalogue. Only live, signed-off cards ever drop or show;
--                    the public read is the view cards_public (no weight, no
--                    counters). A point in an active no-spawn zone is refused.
--   card_copies      every copy a Hopper holds. Rare, Epic and Legendary (the
--                    capped tiers: 1,000, 100 and 10 a season) carry copy_no,
--                    "7 of 10"; copy 1 is the first finder forever. Owner-only.
--   album            one row per card a Hopper has: copies, the play-day it was
--                    stamped Visited (a date, no time, no place), and which art
--                    they have seen. Owner-only.
--   card_pity        card claims since a Rare and since an Epic. Owner-only.
--   set_completions  who finished which set, numbered per set. Owner-only.
--   card_rules       the numbers (shares, pity, XP, visit caps). Server only.
--   drop_rewards.card_tier, game_drops.card_max_tier, and 'card' in the
--   reward_type check. card_max_tier can only be set by the service role and
--   definer functions (the staff spawner), never through the app's key.
--   activity_log.action gets 'card_visit' (score 0: a streak day, not the board).
--
-- Functions: grant_card (service role; the picker), stamp_visit, my_album,
-- my_card, my_drop_cards (what a claim just gave you, for the reveal).
--
-- How a box picks a card (CARDS.md, "How a box picks a card"):
--   1. Tier: the prize's card_tier, never above the box's card_max_tier.
--   2. Pity: on the 10th card claim without a Rare the grant lifts to Rare, on
--      the 60th without an Epic to Epic, within the box cap; the XP is topped up
--      to that tier's XP.
--   3. Bucket (Common and Rare): distance from the box point to the card, under
--      3 km 30%, 3 to 8 km 30%, the rest 40%. An empty bucket passes its share
--      on. Epic and Legendary are city-wide. No box point means far.
--   4. Card: live cards of the tier in the bucket, by weight, halved if you own
--      it, never one this box already gave.
--   5. Sold out: a capped tier only issues below copies_total, else re-pick. A
--      tier with nothing left goes one tier down, then XP only.
--   6. Copy: a card_copies row and the album row. A first card in a set brings up
--      to 2 Common starters from it. A finished set (every live Common and Rare)
--      pays 500 XP, the set badge and a numbered completion.
--
-- Not in phase A: Wanted: your shot (card_shots, likes, winners), trading,
-- gifting, Gist, foils, Card of the Day.
-- ============================================================================

-- ------------------------------------------------------------------ tables ---
create table if not exists public.card_sets (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  name        text not null check (char_length(name) between 2 and 80),
  title       text not null check (char_length(title) between 2 and 60),   -- what finishing it makes you: "Yaba Local"
  kind        text not null check (kind in ('council', 'city', 'campus')),
  live        boolean not null default false,
  completions integer not null default 0 check (completions >= 0),
  created_at  timestamptz not null default now()
);

create table if not exists public.cards (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  set_id         uuid not null references public.card_sets(id) on delete cascade,
  person         boolean not null default false,
  name           text not null check (char_length(name) between 2 and 60),
  fact           text not null check (char_length(fact) between 10 and 400),
  fact_source    text not null check (char_length(fact_source) between 4 and 400),
  lore           text check (char_length(lore) <= 300),
  known_for      text check (char_length(known_for) <= 200),
  question       text check (char_length(question) <= 200),
  visit_tip      text check (char_length(visit_tip) <= 200),
  tier           text not null check (tier in ('common', 'rare', 'epic', 'legendary')),
  tier_reason    text check (char_length(tier_reason) <= 200),
  founders_call  boolean not null default false,
  geog           geography(point, 4326) not null,
  radius_m       integer not null default 150 check (radius_m between 25 and 500),
  weight         numeric not null default 1 check (weight > 0),
  copies_total   integer check (copies_total > 0),
  copies_issued  integer not null default 0 check (copies_issued >= 0),
  art_kind       text not null default 'map' check (art_kind in ('map', 'generated', 'photo', 'owned')),
  art_path       text,
  art_version    integer not null default 1 check (art_version >= 1),
  art_credit     text check (char_length(art_credit) <= 120),
  status         text not null default 'draft' check (status in ('draft', 'live', 'retired')),
  signed_off     boolean not null default false,
  sensitive      boolean not null default false,
  campaign_hold  boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint cards_live_signed check (status <> 'live' or signed_off),
  constraint cards_capped_tiers check ((tier = 'common') = (copies_total is null)),
  constraint cards_issued_cap check (copies_total is null or copies_issued <= copies_total)
);
-- Copies a season: Legendary 10, Epic 100, Rare 1,000, Common unlimited (CARDS.md). Kept in step on a run again.
alter table public.cards drop constraint if exists cards_capped_tiers;
alter table public.cards add constraint cards_capped_tiers check ((tier = 'common') = (copies_total is null));
create index if not exists cards_geog_idx on public.cards using gist (geog);
create index if not exists cards_pick_idx on public.cards (tier, set_id) where status = 'live' and signed_off and not campaign_hold;

create table if not exists public.card_copies (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.cards(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  copy_no    integer check (copy_no > 0),
  foil_no    integer check (foil_no > 0),
  drop_id    uuid references public.game_drops(id) on delete set null,
  starter    boolean not null default false,
  xp_bonus   integer not null default 0 check (xp_bonus >= 0),   -- the pity top-up, so the reveal can say so
  created_at timestamptz not null default now()
);
create unique index if not exists card_copies_copy_no_idx on public.card_copies (card_id, copy_no) where copy_no is not null;
create unique index if not exists card_copies_foil_no_idx on public.card_copies (card_id, foil_no) where foil_no is not null;
create index if not exists card_copies_user_idx on public.card_copies (user_id, created_at desc);
create index if not exists card_copies_drop_idx on public.card_copies (drop_id, user_id);

create table if not exists public.album (
  user_id          uuid not null references public.profiles(id) on delete cascade,
  card_id          uuid not null references public.cards(id) on delete cascade,
  copies           integer not null default 1 check (copies >= 0),
  first_at         timestamptz not null default now(),
  visited_on       date,                     -- a play-day, nothing finer: no time, no coordinates
  xp_paid          boolean not null default false,
  seen_art_version integer not null default 1,
  primary key (user_id, card_id)
);

create table if not exists public.card_pity (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  since_rare integer not null default 0 check (since_rare >= 0),
  since_epic integer not null default 0 check (since_epic >= 0)
);

create table if not exists public.set_completions (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  set_id        uuid not null references public.card_sets(id) on delete cascade,
  completion_no integer not null check (completion_no > 0),
  completed_at  timestamptz not null default now(),
  unique (user_id, set_id),
  unique (set_id, completion_no)
);

create table if not exists public.card_rules (
  key   text primary key,
  value jsonb not null
);
-- Defaults. A run again never overwrites what staff have tuned.
insert into public.card_rules (key, value) values
  ('xp_by_tier', '{"common": 10, "rare": 25, "epic": 60, "legendary": 150}'),
  ('odds',       '{"common": 84, "rare": 13, "epic": 2.7, "legendary": 0.3}'),
  ('buckets',    '{"near_km": 3, "mid_km": 8, "near": 0.30, "mid": 0.30, "far": 0.40, "far_min": 0.15}'),
  ('pity',       '{"rare": 9, "epic": 59}'),
  ('sets',       '{"complete_xp": 500, "starters": 2}'),
  ('visit',      '{"xp": 30, "radius_max": 150, "per_day": 3, "spacing_m": 300, "fix_max_s": 120, "accuracy_cap": 30, "max_speed_mps": 50}')
on conflict (key) do nothing;

-- ---------------------------------------------- columns on existing tables ---
alter table public.drop_rewards add column if not exists card_tier text;
alter table public.drop_rewards drop constraint if exists drop_rewards_card_tier_check;
alter table public.drop_rewards add constraint drop_rewards_card_tier_check
  check (card_tier is null or card_tier in ('common', 'rare', 'epic', 'legendary'));
alter table public.game_drops add column if not exists card_max_tier text;
alter table public.game_drops drop constraint if exists game_drops_card_max_tier_check;
alter table public.game_drops add constraint game_drops_card_max_tier_check
  check (card_max_tier is null or card_max_tier in ('common', 'rare', 'epic', 'legendary'));

-- 'card' joins the reward types, and 'card_visit' the activity actions. Widened,
-- never dropped and added bare: whatever the live check allows is kept, and a
-- run again with the value already there does nothing (the daily_box.sql way).
do $$
declare v_def text; v_list text[];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.drop_rewards'::regclass and c.conname = 'drop_rewards_reward_type_check';
  if v_def is null or v_def not like '%''card''%' then
    v_list := case when v_def is null then array['xp', 'badge', 'discount', 'upgrade', 'ticket', 'collectible']
                   else array(select m[1] from regexp_matches(v_def, '''([^'']+)''', 'g') as m) end;
    v_list := v_list || 'card'::text;
    alter table public.drop_rewards drop constraint if exists drop_rewards_reward_type_check;
    execute format('alter table public.drop_rewards add constraint drop_rewards_reward_type_check check (reward_type in (%s))',
                   (select string_agg(quote_literal(x), ', ') from unnest(v_list) x));
  end if;

  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.activity_log'::regclass and c.conname = 'activity_log_action_check';
  if v_def is null or v_def not like '%''card_visit''%' then
    v_list := case when v_def is null then array['checkin', 'quest', 'photo', 'post', 'drop', 'crew']
                   else array(select m[1] from regexp_matches(v_def, '''([^'']+)''', 'g') as m) end;
    v_list := v_list || 'card_visit'::text;
    alter table public.activity_log drop constraint if exists activity_log_action_check;
    execute format('alter table public.activity_log add constraint activity_log_action_check check (action in (%s))',
                   (select string_agg(quote_literal(x), ', ') from unnest(v_list) x));
  end if;
end $$;

insert into public.game_score_rules (key, score) values ('card_visit', 0) on conflict (key) do nothing;

-- ---------------------------------------------------------------- guards ---
-- A card never sits in a no-spawn zone (CARDS.md): a landmark inside one gets a public viewpoint point instead.
create or replace function public.cards_guard_geog()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare zone_name text;
begin
  select z.name into zone_name from no_spawn_zones z where z.active and st_intersects(z.geog, new.geog) limit 1;
  if found then
    raise exception 'Card % sits in a no-box area (%). Give it a public viewpoint point instead.', new.key, zone_name
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.cards_guard_geog() from public, anon, authenticated;
drop trigger if exists cards_guard_geog on public.cards;
create trigger cards_guard_geog before insert or update of geog on public.cards
  for each row execute function public.cards_guard_geog();

-- Only the service role and definer functions may let a box pay cards: organisers must not be able to mint them.
create or replace function public.game_drops_guard_card_tier()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.card_max_tier is distinct from (case when tg_op = 'UPDATE' then old.card_max_tier end) then
    raise exception 'card_max_tier is set by staff only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function public.game_drops_guard_card_tier() from public, anon, authenticated;
drop trigger if exists game_drops_guard_card_tier on public.game_drops;
create trigger game_drops_guard_card_tier before insert or update of card_max_tier on public.game_drops
  for each row execute function public.game_drops_guard_card_tier();

-- --------------------------------------------------------------- helpers ---
create or replace function public.card_tier_rank(p_tier text)
returns integer language sql immutable as $$
  select case p_tier when 'common' then 1 when 'rare' then 2 when 'epic' then 3 when 'legendary' then 4 end;
$$;
create or replace function public.card_tier_name(p_rank integer)
returns text language sql immutable as $$
  select (array['common', 'rare', 'epic', 'legendary'])[p_rank];
$$;
create or replace function public.card_rule(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from card_rules where key = p_key;
$$;
revoke all on function public.card_rule(text) from public, anon, authenticated;

-- Cards a box can give: live, signed off, not held for a campaign.
create or replace function public.card_droppable(c public.cards)
returns boolean language sql immutable as $$
  select c.status = 'live' and c.signed_off and not c.campaign_hold;
$$;

-- A finished set: every live Common and Rare in it is in the album. Pays once, numbered per set.
create or replace function public.check_set_completion(p_user uuid, p_set uuid)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare s card_sets; n integer; v_xp integer := coalesce((card_rule('sets') ->> 'complete_xp')::integer, 500);
begin
  if exists (select 1 from set_completions where user_id = p_user and set_id = p_set) then return false; end if;
  select * into s from card_sets where id = p_set and live;
  if not found then return false; end if;
  if not exists (select 1 from cards c where c.set_id = p_set and card_droppable(c) and c.tier in ('common', 'rare')) then return false; end if;
  if exists (select 1 from cards c where c.set_id = p_set and card_droppable(c) and c.tier in ('common', 'rare')
               and not exists (select 1 from album a where a.user_id = p_user and a.card_id = c.id)) then
    return false;
  end if;
  update card_sets set completions = completions + 1 where id = p_set returning completions into n;
  insert into set_completions (user_id, set_id, completion_no) values (p_user, p_set, n);
  update profiles set xp = profiles.xp + v_xp where id = p_user;
  insert into badge_catalog (key, name, icon, description)
  values ('set:' || s.key, s.title, '🗺️', 'Finished the ' || s.name || ' set.')
  on conflict (key) do nothing;
  perform award_badge(p_user, 'set:' || s.key);
  return true;
end $$;
revoke all on function public.check_set_completion(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- picker ---
-- One card for one claim (steps 1 to 6 above). Returns the copy, or null when the
-- box pays XP only. p_lat and p_lng are the claim's position (null for an avatar
-- claim): a walked box stamps its card Visited if you stood inside its radius.
create or replace function public.grant_card(p_user uuid, p_drop uuid, p_reward uuid,
                                             p_lat double precision default null, p_lng double precision default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  d game_drops; r drop_rewards; box geography; cap integer; want integer; t integer; v_final integer;
  pity card_pity; rules jsonb := card_rule('buckets'); xp_rules jsonb := card_rule('xp_by_tier');
  near_m double precision := coalesce((rules ->> 'near_km')::numeric, 3) * 1000;
  mid_m double precision := coalesce((rules ->> 'mid_km')::numeric, 8) * 1000;
  share_near numeric; share_mid numeric; share_far numeric; total numeric; roll numeric; bucket text;
  c cards; v_copy_no integer; tried uuid[] := '{}'; copy_id uuid; bonus integer := 0; first_in_set boolean;
  n_starters integer := coalesce((card_rule('sets') ->> 'starters')::integer, 2); guard integer := 0;
  base_want integer; rare_due boolean;
begin
  select * into d from game_drops where id = p_drop;
  if not found or d.card_max_tier is null then return null; end if;
  select * into r from drop_rewards where id = p_reward and drop_id = p_drop;
  if not found or r.reward_type <> 'card' or r.card_tier is null then return null; end if;

  cap := card_tier_rank(d.card_max_tier);
  want := least(card_tier_rank(r.card_tier), cap);
  base_want := want;

  -- pity: the counts are card claims since the last Rare (or better) and Epic (or better)
  insert into card_pity (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into pity from card_pity where user_id = p_user for update;
  rare_due := pity.since_rare >= coalesce((card_rule('pity') ->> 'rare')::integer, 9);
  if pity.since_epic >= coalesce((card_rule('pity') ->> 'epic')::integer, 59) and cap >= 3 then want := greatest(want, 3);
  elsif pity.since_rare >= coalesce((card_rule('pity') ->> 'rare')::integer, 9) and cap >= 2 then want := greatest(want, 2);
  end if;

  box := coalesce(d.geog, (select e.geog from events e where e.id = d.event_id));
  t := want;
  while t >= 1 and copy_id is null loop
    guard := guard + 1;
    exit when guard > 200;   -- belt and braces: every pass either issues, marks a card tried, or drops a tier
    -- which bucket: shares of the buckets that have a card, an empty one passing its share on
    if t >= 3 or box is null then
      bucket := 'all';
    else
      select coalesce(sum(case when b = 'near' then (rules ->> 'near')::numeric end), 0),
             coalesce(sum(case when b = 'mid' then (rules ->> 'mid')::numeric end), 0),
             coalesce(sum(case when b = 'far' then (rules ->> 'far')::numeric end), 0)
        into share_near, share_mid, share_far
      from (select distinct case when st_distance(x.geog, box) < near_m then 'near'
                                 when st_distance(x.geog, box) < mid_m then 'mid' else 'far' end as b
              from cards x
             where card_droppable(x) and x.tier = card_tier_name(t)
               and (x.copies_total is null or x.copies_issued < x.copies_total)
               and not (x.id = any (tried))
               and not exists (select 1 from card_copies cc where cc.drop_id = p_drop and cc.card_id = x.id and not cc.starter)) q;
      total := share_near + share_mid + share_far;
      if total <= 0 then
        -- nothing of this tier left: one tier down, or back to the box's own tier when a pity lift fails
        t := case when t > base_want then (case when t >= 3 and rare_due and cap >= 2 and base_want < 2 then 2 else base_want end) else t - 1 end;
        continue;
      end if;
      -- the far bucket keeps at least far_min of the whole when it has cards
      if share_far > 0 and share_far / total < coalesce((rules ->> 'far_min')::numeric, 0.15) then
        share_far := coalesce((rules ->> 'far_min')::numeric, 0.15) * (share_near + share_mid) / (1 - coalesce((rules ->> 'far_min')::numeric, 0.15));
        total := share_near + share_mid + share_far;
      end if;
      roll := random() * total;
      bucket := case when roll < share_near then 'near' when roll < share_near + share_mid then 'mid' else 'far' end;
    end if;

    -- the card: by weight, halved when you already have it
    select x.* into c
      from cards x
     where card_droppable(x) and x.tier = card_tier_name(t)
       and (x.copies_total is null or x.copies_issued < x.copies_total)
       and not (x.id = any (tried))
       and not exists (select 1 from card_copies cc where cc.drop_id = p_drop and cc.card_id = x.id and not cc.starter)
       and (bucket = 'all'
            or (bucket = 'near' and st_distance(x.geog, box) < near_m)
            or (bucket = 'mid' and st_distance(x.geog, box) >= near_m and st_distance(x.geog, box) < mid_m)
            or (bucket = 'far' and st_distance(x.geog, box) >= mid_m))
     order by -ln(1 - random()) / (x.weight * case when exists (select 1 from album a where a.user_id = p_user and a.card_id = x.id) then 0.5 else 1 end)
     limit 1;
    if not found then
      t := case when t > base_want then (case when t >= 3 and rare_due and cap >= 2 and base_want < 2 then 2 else base_want end) else t - 1 end;
      continue;
    end if;

    v_copy_no := null;
    if c.copies_total is not null then
      -- a capped tier: issue only below the season's copies, else pick again
      update cards set copies_issued = copies_issued + 1
       where id = c.id and copies_issued < copies_total
      returning copies_issued into v_copy_no;
      if not found then
        tried := tried || c.id;
        continue;
      end if;
    end if;
    v_final := t;
    if v_final > card_tier_rank(r.card_tier) then
      bonus := greatest(0, coalesce((xp_rules ->> card_tier_name(v_final))::integer, 0) - r.xp_amount);
    end if;
    insert into card_copies (card_id, user_id, copy_no, drop_id, xp_bonus) values (c.id, p_user, v_copy_no, p_drop, bonus)
    returning id into copy_id;
  end loop;

  if copy_id is null then
    -- XP only: the claim still counts towards pity
    update card_pity set since_rare = since_rare + 1, since_epic = since_epic + 1 where user_id = p_user;
    return null;
  end if;

  if bonus > 0 then update profiles set xp = xp + bonus where id = p_user; end if;
  update card_pity
     set since_rare = case when v_final >= 2 then 0 else since_rare + 1 end,
         since_epic = case when v_final >= 3 then 0 else since_epic + 1 end
   where user_id = p_user;

  first_in_set := not exists (select 1 from album a join cards x on x.id = a.card_id where a.user_id = p_user and x.set_id = c.set_id);
  insert into album (user_id, card_id, copies) values (p_user, c.id, 1)
  on conflict (user_id, card_id) do update set copies = album.copies + 1;

  -- a walked box stamps its card if you stood inside its radius (no extra XP)
  if p_lat is not null and p_lng is not null and st_dwithin(c.geog, st_point(p_lng, p_lat)::geography, c.radius_m) then
    update album set visited_on = coalesce(visited_on, lagos_play_day()) where user_id = p_user and card_id = c.id;
  end if;

  -- a first card in a set brings up to two Common starters from it
  if first_in_set and n_starters > 0 then
    with s as (
      select x.id from cards x
       where x.set_id = c.set_id and x.id <> c.id and x.tier = 'common' and card_droppable(x)
         and not exists (select 1 from album a where a.user_id = p_user and a.card_id = x.id)
       order by random() limit n_starters
    ), ins as (
      insert into card_copies (card_id, user_id, drop_id, starter) select s.id, p_user, p_drop, true from s returning card_id
    )
    insert into album (user_id, card_id, copies) select p_user, ins.card_id, 1 from ins
    on conflict (user_id, card_id) do update set copies = album.copies + 1;
  end if;

  perform check_set_completion(p_user, c.set_id);
  return copy_id;
end $$;
revoke all on function public.grant_card(uuid, uuid, uuid, double precision, double precision) from public, anon, authenticated;
grant execute on function public.grant_card(uuid, uuid, uuid, double precision, double precision) to service_role;

-- The claim pays its card in the same transaction. A card that cannot be given
-- never undoes the claim (the XP is still paid); the reason goes to the log.
create or replace function public.drop_claims_grant_card()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.reward_id is null then return new; end if;
  begin
    perform grant_card(new.user_id, new.drop_id, new.reward_id, new.lat, new.lng);
  exception when others then
    raise warning 'grant_card failed for claim %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.drop_claims_grant_card() from public, anon, authenticated;
drop trigger if exists drop_claims_grant_card on public.drop_claims;
create trigger drop_claims_grant_card after insert on public.drop_claims
  for each row execute function public.drop_claims_grant_card();

-- ---------------------------------------------------------------- Visited ---
-- I'M HERE: you hold the card and your phone is inside its radius (plus the fix's
-- accuracy, at most 30 m). Needs a fix under 2 minutes old (play_tick keeps it)
-- that is not a hop of over 50 m/s from your last claim or fix. The first stamp of
-- a card pays visit XP when the card is a tight place (radius 150 m or less), at
-- most 3 a play-day and none within 300 m of a card already paid today; a paid
-- stamp counts as an outside day (streak yes, board no). What is kept is the
-- play-day only. Returns {ok, reason, xp, outside, distance_m}.
create or replace function public.stamp_visit(p_card uuid, p_lat double precision, p_lng double precision, p_accuracy double precision default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid(); c cards; a album; f play_fix; v jsonb := card_rule('visit'); here geography; dist double precision;
  slack double precision; today date := lagos_play_day(); paid_today integer; v_xp integer := 0; prev record;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;
  if p_lat is null or p_lng is null then return jsonb_build_object('ok', false, 'reason', 'location_required'); end if;
  perform pg_advisory_xact_lock(hashtextextended('claim:' || me::text, 0));
  select * into c from cards where id = p_card and status = 'live' and signed_off;
  if not found then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  select * into a from album where user_id = me and card_id = p_card;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
  if a.visited_on is not null then return jsonb_build_object('ok', true, 'already', true, 'xp', 0, 'outside', false); end if;

  select * into f from play_fix where user_id = me;
  if not found or f.at < now() - make_interval(secs => coalesce((v ->> 'fix_max_s')::integer, 120)) then
    return jsonb_build_object('ok', false, 'reason', 'no_fix');
  end if;
  here := st_point(p_lng, p_lat)::geography;
  -- the same speed rule as a claim, against the newest of your last claim position and your fix
  select x.lat, x.lng, x.at into prev from (
      select c2.lat, c2.lng, c2.claimed_at as at from drop_claims c2
       where c2.user_id = me and c2.lat is not null and c2.lng is not null and c2.claimed_at > now() - interval '2 hours'
      union all
      select f.lat, f.lng, f.at) x
   order by x.at desc limit 1;
  -- 50 m of the gap is GPS wobble, not movement: the app takes the fix a moment before the stamp
  if found and greatest(st_distance(st_point(prev.lng, prev.lat)::geography, here) - 50, 0) / greatest(extract(epoch from now() - prev.at), 1)
               > coalesce((v ->> 'max_speed_mps')::numeric, 50) then
    return jsonb_build_object('ok', false, 'reason', 'too_fast');
  end if;

  slack := least(greatest(coalesce(p_accuracy, 0), 0), coalesce((v ->> 'accuracy_cap')::numeric, 30));
  dist := st_distance(c.geog, here);
  if dist > c.radius_m + slack then
    return jsonb_build_object('ok', false, 'reason', 'too_far', 'distance_m', round(dist - c.radius_m));
  end if;

  if c.radius_m <= coalesce((v ->> 'radius_max')::integer, 150) and not a.xp_paid then
    select count(*) into paid_today from album x where x.user_id = me and x.visited_on = today and x.xp_paid;
    if paid_today < coalesce((v ->> 'per_day')::integer, 3)
       and not exists (select 1 from album x join cards y on y.id = x.card_id
                        where x.user_id = me and x.visited_on = today and x.xp_paid
                          and st_dwithin(y.geog, c.geog, coalesce((v ->> 'spacing_m')::numeric, 300))) then
      v_xp := coalesce((v ->> 'xp')::integer, 30);
    end if;
  end if;

  update album set visited_on = today, xp_paid = (v_xp > 0) where user_id = me and card_id = p_card;
  if v_xp > 0 then
    update profiles set xp = profiles.xp + v_xp where id = me;
    insert into activity_log (user_id, action, source_id, outside_score)
    values (me, 'card_visit', p_card, coalesce((select score from game_score_rules where key = 'card_visit'), 0))
    on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'xp', v_xp, 'outside', v_xp > 0);
end $$;
revoke all on function public.stamp_visit(uuid, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.stamp_visit(uuid, double precision, double precision, double precision) to authenticated;

-- ------------------------------------------------------------ the public read ---
-- Live, signed-off cards with no weight and no counters. Places are public, so the point is too.
create or replace view public.cards_public as
  select c.id, c.key, s.key as set_key, s.name as set_name, c.person, c.name, c.fact, c.fact_source, c.lore,
         c.known_for, c.question, c.visit_tip, c.tier, c.tier_reason, c.founders_call,
         st_y(c.geog::geometry) as lat, st_x(c.geog::geometry) as lng, c.radius_m, c.copies_total,
         c.art_kind, c.art_path, c.art_version, c.art_credit
    from public.cards c join public.card_sets s on s.id = c.set_id
   where c.status = 'live' and c.signed_off and not c.campaign_hold and s.live;

-- The reveal: the cards a claim of this box just gave you, the prize first and the starters after it.
create or replace function public.my_drop_cards(p_drop uuid)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', c.key, 'name', c.name, 'tier', c.tier, 'set_key', s.key, 'set_name', s.name, 'fact', c.fact,
           'copy_no', cc.copy_no, 'copies_total', c.copies_total, 'starter', cc.starter, 'xp_bonus', cc.xp_bonus,
           'art_kind', c.art_kind, 'art_path', c.art_path, 'new', a.copies = 1)
         order by cc.starter, cc.created_at), '[]'::jsonb)
    from card_copies cc
    join cards c on c.id = cc.card_id
    join card_sets s on s.id = c.set_id
    left join album a on a.user_id = cc.user_id and a.card_id = cc.card_id
   where cc.drop_id = p_drop and cc.user_id = auth.uid();
$$;
revoke all on function public.my_drop_cards(uuid) from public, anon, authenticated;
grant execute on function public.my_drop_cards(uuid) to authenticated;

-- The album: every live set with your count, and every card you hold.
create or replace function public.my_album()
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', s.key, 'name', s.name, 'title', s.title, 'kind', s.kind,
               'needed', (select count(*) from cards c where c.set_id = s.id and card_droppable(c) and c.tier in ('common', 'rare')),
               'total', (select count(*) from cards c where c.set_id = s.id and card_droppable(c)),
               'owned', (select count(*) from album a join cards c on c.id = a.card_id where a.user_id = auth.uid() and c.set_id = s.id and card_droppable(c)),
               'completion_no', (select sc.completion_no from set_completions sc where sc.user_id = auth.uid() and sc.set_id = s.id))
             order by s.kind, s.name)
        from card_sets s where s.live), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', c.key, 'name', c.name, 'tier', c.tier, 'set_key', s.key, 'copies', a.copies,
               'copy_nos', (select coalesce(jsonb_agg(cc.copy_no order by cc.copy_no), '[]'::jsonb) from card_copies cc
                             where cc.user_id = a.user_id and cc.card_id = c.id and cc.copy_no is not null),
               'copies_total', c.copies_total, 'visited', a.visited_on is not null,
               'new_art', a.seen_art_version < c.art_version, 'art_kind', c.art_kind, 'art_path', c.art_path)
             order by card_tier_rank(c.tier) desc, c.name)
        from album a join cards c on c.id = a.card_id join card_sets s on s.id = c.set_id
       where a.user_id = auth.uid() and c.status = 'live' and c.signed_off), '[]'::jsonb));
$$;
revoke all on function public.my_album() from public, anon, authenticated;
grant execute on function public.my_album() to authenticated;

-- One card's page: everything public about it, and yours if you hold it. p_seen marks its new art as seen.
create or replace function public.my_card(p_key text, p_seen boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare c cards_public; a album; mine jsonb;
begin
  select * into c from cards_public where key = p_key;
  if not found then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if auth.uid() is not null then
    select * into a from album where user_id = auth.uid() and card_id = c.id;
    if found then
      if p_seen then update album set seen_art_version = c.art_version where user_id = auth.uid() and card_id = c.id; end if;
      mine := jsonb_build_object('copies', a.copies, 'visited', a.visited_on is not null,
                                 'new_art', not p_seen and a.seen_art_version < c.art_version,
                                 'copy_nos', (select coalesce(jsonb_agg(cc.copy_no order by cc.copy_no), '[]'::jsonb) from card_copies cc
                                               where cc.user_id = auth.uid() and cc.card_id = c.id and cc.copy_no is not null));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'card', to_jsonb(c) - 'id', 'id', c.id, 'mine', mine);
end $$;
revoke all on function public.my_card(text, boolean) from public, anon, authenticated;
grant execute on function public.my_card(text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------- lock down ---
alter table public.card_sets       enable row level security;
alter table public.cards           enable row level security;
alter table public.card_copies     enable row level security;
alter table public.album           enable row level security;
alter table public.card_pity       enable row level security;
alter table public.set_completions enable row level security;
alter table public.card_rules      enable row level security;

revoke all on public.card_sets, public.cards, public.card_copies, public.album, public.card_pity,
              public.set_completions, public.card_rules from anon, authenticated;
grant all on public.card_sets, public.cards, public.card_copies, public.album, public.card_pity,
             public.set_completions, public.card_rules to service_role;

grant select on public.card_sets to anon, authenticated;
drop policy if exists card_sets_read_live on public.card_sets;
create policy card_sets_read_live on public.card_sets for select using (live);

grant select on public.card_copies, public.album, public.card_pity, public.set_completions to authenticated;
drop policy if exists card_copies_read_own on public.card_copies;
create policy card_copies_read_own on public.card_copies for select using (user_id = auth.uid());
drop policy if exists album_read_own on public.album;
create policy album_read_own on public.album for select using (user_id = auth.uid());
drop policy if exists card_pity_read_own on public.card_pity;
create policy card_pity_read_own on public.card_pity for select using (user_id = auth.uid());
drop policy if exists set_completions_read_own on public.set_completions;
create policy set_completions_read_own on public.set_completions for select using (user_id = auth.uid());
-- cards and card_rules have no policies: cards are read through cards_public, the rules by the functions

revoke all on public.cards_public from anon, authenticated;
grant select on public.cards_public to anon, authenticated;
