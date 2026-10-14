-- ============================================================================
-- Hoppaz: card deck tests (cards.sql, phase A)
-- Run against a LOCAL database that has the whole load order applied, cards.sql
-- last:
--   docker exec -i supabase_db_hoppaz-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/cards_test.sql
--
-- One transaction that always rolls back, so nothing is kept. Every check
-- raises an exception on failure; the last line printed is
-- ALL CARD TESTS PASSED. The real no-spawn zones are switched off inside the
-- transaction so the test places are free; one zone of its own tests the guard.
-- ============================================================================
begin;

create function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $f$
begin
  if p_cond is not true then raise exception 'TEST FAILED: %', p_msg; end if;
end $f$;

create function pg_temp.eq(p_got text, p_want text, p_msg text) returns void language plpgsql as $f$
begin
  if p_got is distinct from p_want then raise exception 'TEST FAILED: % (got %, wanted %)', p_msg, p_got, p_want; end if;
end $f$;

-- A Hopper with an account (an email), so the drop_claims account gate lets them claim.
create function pg_temp.newuser() returns uuid language plpgsql as $f$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cardtest-' || u || '@cardtest.invalid', '{}', '{}', now(), now());
  return u;
end $f$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

create function pg_temp.as_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $f$;

create function pg_temp.as_admin() returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $f$;

-- A point p metres east and n metres north of the test origin (Lagos mainland, the zones are off).
create function pg_temp.at(p_east double precision, p_north double precision) returns geography language sql as $f$
  select st_project(st_project(st_point(3.35, 6.55)::geography, p_east, radians(90))::geography, p_north, radians(0))::geography;
$f$;

-- A box at the origin that may pay cards up to p_cap, holding one card prize of p_tier.
create function pg_temp.box(p_cap text, p_tier text, p_xp integer default 10, p_geog geography default null) returns uuid language plpgsql as $f$
declare d uuid;
begin
  insert into public.game_drops (title, geog, opens_at, closes_at, radius_m, claim_method, max_claims, reward_model, kind, card_max_tier)
  values ('Card test box', coalesce(p_geog, pg_temp.at(0, 0)), now() - interval '1 minute', now() + interval '1 hour', 250, 'proximity', 100, 'fixed', 'staff', p_cap)
  returning id into d;
  insert into public.drop_rewards (drop_id, reward_type, title, xp_amount, card_tier) values (d, 'card', 'A card', p_xp, p_tier);
  return d;
end $f$;

-- Claim a box standing at the origin, as that Hopper. Returns the claim's answer.
create function pg_temp.claim(p_user uuid, p_drop uuid) returns jsonb language plpgsql as $f$
declare res jsonb;
begin
  perform pg_temp.as_user(p_user);
  select public.claim_game_drop(p_drop, st_y(pg_temp.at(0, 0)::geometry), st_x(pg_temp.at(0, 0)::geometry), null) into res;
  perform pg_temp.as_admin();
  return res;
end $f$;

create function pg_temp.cards_from(p_user uuid, p_drop uuid) returns jsonb language plpgsql as $f$
declare res jsonb;
begin
  perform pg_temp.as_user(p_user);
  select public.my_drop_cards(p_drop) into res;
  perform pg_temp.as_admin();
  return res;
end $f$;

create temp table t (k text primary key, v uuid);
grant all on t to authenticated, anon;

-- ------------------------------------------------------------------- the deck ---
do $t$
declare s_home uuid; s_far uuid; s_off uuid;
begin
  update public.no_spawn_zones set active = false;
  insert into public.card_sets (key, name, title, kind, live) values ('test-home', 'Test Home', 'Test Local', 'council', true) returning id into s_home;
  insert into public.card_sets (key, name, title, kind, live) values ('test-far', 'Test Far', 'Test Far Local', 'council', true) returning id into s_far;
  insert into public.card_sets (key, name, title, kind, live) values ('test-off', 'Test Off', 'Test Off Local', 'council', false) returning id into s_off;
  insert into t values ('s_home', s_home), ('s_far', s_far);

  -- home set: three Commons and a Rare near the origin, an Epic (2 copies) and a Legendary (1 copy)
  insert into public.cards (key, set_id, name, fact, fact_source, tier, geog, radius_m, status, signed_off, copies_total)
  values ('t-c1', s_home, 'Test Common One', 'A test fact long enough.', 'test source', 'common', pg_temp.at(100, 0), 100, 'live', true, null),
         ('t-c2', s_home, 'Test Common Two', 'A test fact long enough.', 'test source', 'common', pg_temp.at(1000, 0), 100, 'live', true, null),
         ('t-c3', s_home, 'Test Common Three', 'A test fact long enough.', 'test source', 'common', pg_temp.at(2000, 0), 400, 'live', true, null),
         ('t-r1', s_home, 'Test Rare', 'A test fact long enough.', 'test source', 'rare', pg_temp.at(0, 1500), 100, 'live', true, 1000),
         ('t-e1', s_home, 'Test Epic', 'A test fact long enough.', 'test source', 'epic', pg_temp.at(0, 20000), 150, 'live', true, 2),
         ('t-l1', s_home, 'Test Legend', 'A test fact long enough.', 'test source', 'legendary', pg_temp.at(0, 30000), 150, 'live', true, 1);
  -- far set: one Common 20 km away; a draft that must never drop; a card in a set that is not live
  insert into public.cards (key, set_id, name, fact, fact_source, tier, geog, status, signed_off)
  values ('t-f1', s_far, 'Test Far Common', 'A test fact long enough.', 'test source', 'common', pg_temp.at(20000, 0), 'live', true),
         ('t-d1', s_far, 'Test Draft', 'A test fact long enough.', 'test source', 'common', pg_temp.at(50, 0), 'draft', false),
         ('t-o1', s_off, 'Test Off Set', 'A test fact long enough.', 'test source', 'common', pg_temp.at(60, 0), 'live', true);
  -- the other real cards (cards_sample.sql on a staging database) must not get in the way
  update public.cards set status = 'retired' where key not like 't-%';
end $t$;

-- ------------------------------------------------------------- the checks ----
do $t$
begin
  begin
    insert into public.cards (key, set_id, name, fact, fact_source, tier, geog, status, signed_off)
    values ('t-bad', (select v from t where k = 's_home'), 'Bad', 'A test fact long enough.', 'test source', 'common', pg_temp.at(0, 0), 'live', false);
    raise exception 'TEST FAILED: a live card that is not signed off went in';
  exception when check_violation then null;
  end;
  begin
    insert into public.cards (key, set_id, name, fact, fact_source, tier, geog, copies_total)
    values ('t-bad2', (select v from t where k = 's_home'), 'Bad', 'A test fact long enough.', 'test source', 'epic', pg_temp.at(0, 0), null);
    raise exception 'TEST FAILED: an Epic with no copy limit went in';
  exception when check_violation then null;
  end;
  -- a card in a no-spawn zone is refused
  insert into public.no_spawn_zones (name, reason, geog, source, active)
  values ('Card test zone', 'test', st_buffer(pg_temp.at(5000, 5000), 200), 'staff', true);
  begin
    insert into public.cards (key, set_id, name, fact, fact_source, tier, geog)
    values ('t-zone', (select v from t where k = 's_home'), 'Zone', 'A test fact long enough.', 'test source', 'common', pg_temp.at(5000, 5000));
    raise exception 'TEST FAILED: a card in a no-spawn zone went in';
  exception when check_violation then null;
  end;
  update public.no_spawn_zones set active = false where name = 'Card test zone';
  raise notice 'ok: card checks and the zone guard';
end $t$;

-- the app's key cannot let a box pay cards
do $t$
declare u uuid := pg_temp.newuser(); msg text;
begin
  perform pg_temp.as_user(u);
  begin
    insert into public.game_drops (title, geog, opens_at, closes_at, card_max_tier)
    values ('Mint', pg_temp.at(0, 0), now(), now() + interval '1 hour', 'legendary');
    raise exception 'TEST FAILED: a Hopper set card_max_tier';
  exception when insufficient_privilege then get stacked diagnostics msg = message_text;
  end;
  perform pg_temp.as_admin();
  perform pg_temp.ok(msg like '%staff only%', 'the card guard refuses it, not only the row policy (' || msg || ')');
  raise notice 'ok: card_max_tier is staff only';
end $t$;

-- ------------------------------------------------- a claim pays a card -------
do $t$
declare a uuid := pg_temp.newuser(); d uuid := pg_temp.box('common', 'common'); res jsonb; got jsonb; prize jsonb;
begin
  insert into t values ('a', a);
  res := pg_temp.claim(a, d);
  perform pg_temp.ok((res ->> 'ok')::boolean, 'the claim works: ' || res::text);
  perform pg_temp.eq(res ->> 'xp', '10', 'the claim pays the prize XP');
  got := pg_temp.cards_from(a, d);
  prize := got -> 0;
  perform pg_temp.eq(prize ->> 'starter', 'false', 'the prize comes first');
  perform pg_temp.eq(prize ->> 'tier', 'common', 'a Common box pays a Common');
  perform pg_temp.ok(prize ->> 'key' in ('t-c1', 't-c2', 't-c3', 't-f1'), 'only live, signed-off cards in live sets: ' || (prize ->> 'key'));
  -- a first card in a set brings its starters (the home set has three Commons, the far set only one)
  if prize ->> 'set_key' = 'test-home' then
    perform pg_temp.eq(jsonb_array_length(got)::text, '3', 'a first home card brings two Common starters');
  else
    perform pg_temp.eq(jsonb_array_length(got)::text, '1', 'the far set has no other Common to start with');
  end if;
  perform pg_temp.ok(not exists (select 1 from public.card_copies where user_id = a and card_id in (select id from public.cards where key in ('t-d1', 't-o1'))),
                     'a draft card and a card in a set that is not live never drop');
  perform pg_temp.eq((select since_rare || '/' || since_epic from public.card_pity where user_id = a), '1/1', 'pity counts the card claim');
  raise notice 'ok: a claim pays a card and its starters';
end $t$;

-- no card unless the box may pay one, and never above its cap
do $t$
declare u uuid := pg_temp.newuser(); d uuid; res jsonb;
begin
  d := pg_temp.box(null, 'common');
  res := pg_temp.claim(u, d);
  perform pg_temp.ok((res ->> 'ok')::boolean, 'the uncapped claim works');
  perform pg_temp.eq(jsonb_array_length(pg_temp.cards_from(u, d))::text, '0', 'a box with no card_max_tier pays no card');
  d := pg_temp.box('rare', 'legendary', 150);
  res := pg_temp.claim(u, d);
  perform pg_temp.eq(pg_temp.cards_from(u, d) -> 0 ->> 'tier', 'rare', 'a Legendary prize in a Rare box pays a Rare');
  raise notice 'ok: the box cap';
end $t$;

-- pity: the 10th card claim without a Rare lifts to Rare, with the XP topped up
do $t$
declare u uuid := pg_temp.newuser(); d uuid := pg_temp.box('epic', 'common', 10); xp_before integer; got jsonb;
begin
  insert into public.card_pity (user_id, since_rare, since_epic) values (u, 9, 9);
  select xp into xp_before from public.profiles where id = u;
  perform pg_temp.claim(u, d);
  got := pg_temp.cards_from(u, d) -> 0;
  perform pg_temp.eq(got ->> 'tier', 'rare', 'pity lifts the grant to Rare');
  perform pg_temp.eq(got ->> 'xp_bonus', '15', 'the XP is topped up to a Rare (25 - 10)');
  perform pg_temp.eq(((select xp from public.profiles where id = u) - xp_before)::text, '25', 'the Hopper got 25 XP in all');
  perform pg_temp.eq((select since_rare || '/' || since_epic from public.card_pity where user_id = u), '0/10', 'a Rare zeroes since_rare only');
  -- and at 59 without an Epic, an Epic box lifts to Epic
  update public.card_pity set since_epic = 59 where user_id = u;
  d := pg_temp.box('epic', 'common', 10);
  perform pg_temp.claim(u, d);
  perform pg_temp.eq(pg_temp.cards_from(u, d) -> 0 ->> 'tier', 'epic', 'pity lifts the grant to Epic');
  perform pg_temp.eq((select since_rare || '/' || since_epic from public.card_pity where user_id = u), '0/0', 'an Epic zeroes both');
  raise notice 'ok: pity';
end $t$;

-- numbered copies, sold out, one tier down
do $t$
declare d uuid := pg_temp.box('legendary', 'epic', 60); u1 uuid := pg_temp.newuser(); u2 uuid := pg_temp.newuser(); u3 uuid := pg_temp.newuser();
        g jsonb; issued integer;
begin
  -- the earlier test may have issued one Epic copy already: start from what is left
  select copies_issued into issued from public.cards where key = 't-e1';
  update public.cards set copies_issued = 0 where key = 't-e1';
  delete from public.card_copies where card_id = (select id from public.cards where key = 't-e1');
  -- a box gives each card once: three Hoppers, but this box's Epic can only go to one of them
  perform pg_temp.claim(u1, d);
  g := pg_temp.cards_from(u1, d) -> 0;
  perform pg_temp.eq(g ->> 'key' || ' #' || (g ->> 'copy_no') || ' of ' || (g ->> 'copies_total'), 't-e1 #1 of 2', 'the first finder gets copy 1');
  perform pg_temp.claim(u2, d);
  perform pg_temp.eq(pg_temp.cards_from(u2, d) -> 0 ->> 'tier', 'rare', 'this box already gave its Epic, so the next Hopper falls a tier');
  -- a second box: the Epic's last copy, then none left
  d := pg_temp.box('legendary', 'epic', 60);
  perform pg_temp.claim(u2, d);
  perform pg_temp.eq(pg_temp.cards_from(u2, d) -> 0 ->> 'copy_no', '2', 'the second copy is numbered 2');
  perform pg_temp.eq((select copies_issued::text from public.cards where key = 't-e1'), '2', 'two of two issued');
  d := pg_temp.box('legendary', 'epic', 60);
  perform pg_temp.claim(u3, d);
  perform pg_temp.eq(pg_temp.cards_from(u3, d) -> 0 ->> 'tier', 'rare', 'a sold-out Epic falls to a Rare');
  -- the Legendary: one copy
  d := pg_temp.box('legendary', 'legendary', 150);
  perform pg_temp.claim(u1, d);
  perform pg_temp.eq(pg_temp.cards_from(u1, d) -> 0 ->> 'key', 't-l1', 'the only Legendary');
  d := pg_temp.box('legendary', 'legendary', 150);
  perform pg_temp.claim(u2, d);
  perform pg_temp.ok(pg_temp.cards_from(u2, d) -> 0 ->> 'tier' in ('epic', 'rare'), 'no Legendary left, and the Epics are gone too: one tier down at a time');
  raise notice 'ok: copies and sold out';
end $t$;

-- every card of the tier gone and nothing below: XP only, and the claim still pays
do $t$
declare u uuid := pg_temp.newuser(); d uuid; res jsonb;
begin
  update public.cards set status = 'retired', signed_off = true where key like 't-%' and tier = 'common';
  d := pg_temp.box('common', 'common', 10);
  res := pg_temp.claim(u, d);
  perform pg_temp.ok((res ->> 'ok')::boolean and (res ->> 'xp') = '10', 'the claim still pays its XP');
  perform pg_temp.eq(jsonb_array_length(pg_temp.cards_from(u, d))::text, '0', 'no Common left: XP only');
  update public.cards set status = 'live' where key in ('t-c1', 't-c2', 't-c3', 't-f1');
  raise notice 'ok: XP only when the deck is empty';
end $t$;

-- ------------------------------------------------------------ set complete ---
do $t$
declare u uuid := pg_temp.newuser(); d uuid; xp_before integer; n integer := 0;
begin
  -- give the home set's four Commons and Rare one claim at a time, from boxes that only have home cards nearby
  update public.cards set status = 'retired' where key = 't-f1';
  select xp into xp_before from public.profiles where id = u;
  while not exists (select 1 from public.set_completions where user_id = u) and n < 10 loop
    n := n + 1;
    d := pg_temp.box('rare', case when exists (select 1 from public.album a join public.cards c on c.id = a.card_id where a.user_id = u and c.key = 't-r1') then 'common' else 'rare' end, 10);
    perform pg_temp.claim(u, d);
  end loop;
  perform pg_temp.ok(exists (select 1 from public.set_completions sc where sc.user_id = u and sc.set_id = (select v from t where k = 's_home')), 'the home set is complete after ' || n || ' boxes');
  perform pg_temp.eq((select completion_no::text from public.set_completions where user_id = u), '1', 'the first to finish is number 1');
  perform pg_temp.ok(exists (select 1 from public.badges where user_id = u and key = 'set:test-home'), 'the set badge');
  perform pg_temp.ok((select xp from public.profiles where id = u) - xp_before >= 500, 'the 500 XP');
  -- a box after that never pays it twice
  d := pg_temp.box('rare', 'common', 10);
  perform pg_temp.claim(u, d);
  perform pg_temp.eq((select count(*)::text from public.set_completions where user_id = u), '1', 'one completion per set');
  update public.cards set status = 'live' where key = 't-f1';
  insert into t values ('setter', u);
  raise notice 'ok: a finished set';
end $t$;

-- ----------------------------------------------------------------- Visited ---
do $t$
declare u uuid := (select v from t where k = 'setter'); c1 uuid := (select id from public.cards where key = 't-c1');
        c2 uuid := (select id from public.cards where key = 't-c2'); c3 uuid := (select id from public.cards where key = 't-c3');
        p geography; res jsonb; xp_before integer;
begin
  -- the claims above stood at the origin, 100 m from t-c1 (radius 100): a walked box stamps its card
  update public.album set visited_on = null, xp_paid = false where user_id = u;
  update public.drop_claims set claimed_at = now() - interval '3 hours' where user_id = u;   -- out of the speed window
  perform pg_temp.as_user(u);
  p := pg_temp.at(100, 0);
  res := public.stamp_visit(c1, st_y(p::geometry), st_x(p::geometry), 10);
  perform pg_temp.eq(res ->> 'reason', 'no_fix', 'no fresh fix, no stamp');
  perform pg_temp.as_admin();
  insert into public.play_fix (user_id, lat, lng, at) values (u, st_y(p::geometry), st_x(p::geometry), now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, at = excluded.at;
  select xp into xp_before from public.profiles where id = u;
  -- the app refreshes the fix (play_tick) where the phone is, then stamps
  p := pg_temp.at(100, 300);
  update public.play_fix set lat = st_y(p::geometry), lng = st_x(p::geometry), at = now() where user_id = u;
  perform pg_temp.as_user(u);
  res := public.stamp_visit(c1, st_y(p::geometry), st_x(p::geometry), 10);
  perform pg_temp.eq(res ->> 'reason', 'too_far', '300 m off is too far');
  perform pg_temp.as_admin();
  p := pg_temp.at(100, 30);
  update public.play_fix set lat = st_y(p::geometry), lng = st_x(p::geometry), at = now() where user_id = u;
  perform pg_temp.as_user(u);
  res := public.stamp_visit(c1, st_y(p::geometry), st_x(p::geometry), 10);
  perform pg_temp.ok((res ->> 'ok')::boolean and (res ->> 'xp') = '30', 'inside the radius: stamped with 30 XP: ' || res::text);
  res := public.stamp_visit(c1, st_y(p::geometry), st_x(p::geometry), 10);
  perform pg_temp.eq(res ->> 'already', 'true', 'a card stamps once');
  perform pg_temp.as_admin();
  perform pg_temp.eq(((select xp from public.profiles where id = u) - xp_before)::text, '30', 'paid once');
  perform pg_temp.eq((select outside_score::text from public.activity_log where user_id = u and action = 'card_visit' and source_id = c1), '0',
                     'a paid stamp is an outside day with no board score');
  -- t-c2 is 900 m from t-c1 but its radius is 100 and t-c3's is 400: t-c3 is too loose to pay
  update public.play_fix set lat = st_y(pg_temp.at(2000, 0)::geometry), lng = st_x(pg_temp.at(2000, 0)::geometry), at = now() - interval '200 seconds' where user_id = u;
  perform pg_temp.as_user(u);
  res := public.stamp_visit(c3, st_y(pg_temp.at(2000, 0)::geometry), st_x(pg_temp.at(2000, 0)::geometry), 10);
  perform pg_temp.eq(res ->> 'reason', 'no_fix', 'a fix over 2 minutes old is not fresh');
  perform pg_temp.as_admin();
  update public.play_fix set at = now() - interval '60 seconds' where user_id = u;
  perform pg_temp.as_user(u);
  res := public.stamp_visit(c3, st_y(pg_temp.at(2000, 0)::geometry), st_x(pg_temp.at(2000, 0)::geometry), 10);
  perform pg_temp.ok((res ->> 'ok')::boolean and (res ->> 'xp') = '0', 'a wide card (400 m) stamps with no XP: ' || res::text);
  -- jumping 1 km in a second from the fix is too fast
  perform pg_temp.as_admin();
  update public.play_fix set lat = st_y(pg_temp.at(0, 0)::geometry), lng = st_x(pg_temp.at(0, 0)::geometry), at = now() - interval '1 second' where user_id = u;
  perform pg_temp.as_user(u);
  res := public.stamp_visit(c2, st_y(pg_temp.at(1000, 0)::geometry), st_x(pg_temp.at(1000, 0)::geometry), 10);
  perform pg_temp.eq(res ->> 'reason', 'too_fast', 'a kilometre in a second is not on foot');
  perform pg_temp.as_admin();
  raise notice 'ok: Visited';
end $t$;

-- the visit spacing: a second paid stamp within 300 m of one paid today pays nothing
do $t$
declare u uuid := pg_temp.newuser(); s uuid := (select v from t where k = 's_far'); near1 uuid; near2 uuid; res jsonb;
begin
  insert into public.cards (key, set_id, name, fact, fact_source, tier, geog, radius_m, status, signed_off)
  values ('t-n1', s, 'Near One', 'A test fact long enough.', 'test source', 'common', pg_temp.at(-3000, 0), 50, 'live', true) returning id into near1;
  insert into public.cards (key, set_id, name, fact, fact_source, tier, geog, radius_m, status, signed_off)
  values ('t-n2', s, 'Near Two', 'A test fact long enough.', 'test source', 'common', pg_temp.at(-3000, 200), 50, 'live', true) returning id into near2;
  insert into public.album (user_id, card_id) values (u, near1), (u, near2);
  insert into public.play_fix (user_id, lat, lng, at) values (u, st_y(pg_temp.at(-3000, 0)::geometry), st_x(pg_temp.at(-3000, 0)::geometry), now());
  perform pg_temp.as_user(u);
  res := public.stamp_visit(near1, st_y(pg_temp.at(-3000, 0)::geometry), st_x(pg_temp.at(-3000, 0)::geometry), 5);
  perform pg_temp.eq(res ->> 'xp', '30', 'the first one pays');
  perform pg_temp.as_admin();
  update public.play_fix set lat = st_y(pg_temp.at(-3000, 200)::geometry), lng = st_x(pg_temp.at(-3000, 200)::geometry), at = now() where user_id = u;
  perform pg_temp.as_user(u);
  res := public.stamp_visit(near2, st_y(pg_temp.at(-3000, 200)::geometry), st_x(pg_temp.at(-3000, 200)::geometry), 5);
  perform pg_temp.ok((res ->> 'ok')::boolean and (res ->> 'xp') = '0', '200 m from one paid today: stamped, no XP');
  perform pg_temp.as_admin();
  raise notice 'ok: visit spacing';
end $t$;

-- ----------------------------------------------------------------- privacy ---
do $t$
declare a uuid := (select v from t where k = 'a'); b uuid := pg_temp.newuser(); n integer; alb jsonb; card jsonb;
begin
  perform pg_temp.as_user(b);
  select count(*) into n from public.album where user_id = a;
  perform pg_temp.eq(n::text, '0', 'b cannot read a''s album');
  select count(*) into n from public.card_copies where user_id = a;
  perform pg_temp.eq(n::text, '0', 'b cannot read a''s copies');
  begin
    perform 1 from public.cards limit 1;
    raise exception 'TEST FAILED: the cards table is readable with the app''s key';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.card_rules limit 1;
    raise exception 'TEST FAILED: the rules are readable with the app''s key';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.album (user_id, card_id) values (b, (select id from public.cards_public limit 1));
    raise exception 'TEST FAILED: a Hopper wrote their own album row';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_user(a);
  alb := public.my_album();
  perform pg_temp.ok(jsonb_array_length(alb -> 'cards') >= 1, 'a''s album lists a''s cards');
  perform pg_temp.ok(not (alb::text like '%' || a::text || '%'), 'no Hopper id in the album');
  perform pg_temp.as_anon();
  select count(*) into n from public.cards_public where key like 't-%';
  perform pg_temp.ok(n >= 6, 'anyone can read the live cards');
  select count(*) into n from public.cards_public where key in ('t-d1', 't-o1');
  perform pg_temp.eq(n::text, '0', 'not the draft, not a set that is not live');
  card := public.my_card('t-r1');
  perform pg_temp.ok((card ->> 'ok')::boolean and card -> 'mine' = 'null'::jsonb, 'a card page for a guest, with nothing of theirs');
  perform pg_temp.ok(not ((card -> 'card') ? 'weight') and not ((card -> 'card') ? 'copies_issued'), 'no weight, no counters');
  perform pg_temp.as_admin();
  raise notice 'ok: privacy';
end $t$;

-- ----------------------------------------------------------------- spawner ---
do $t$
declare rule uuid; sp uuid; made integer; g record;
begin
  -- night-safe, so the test passes at any hour (at night the spawner only uses night-safe spots)
  insert into public.spawn_points (name, kind, geog, area, active, weight, night_safe)
  values ('Card test spot', 'street', pg_temp.at(0, 0), null, true, 1, true) returning id into sp;
  insert into public.spawn_rules (name, active, kinds, boxes_per_wave, rewards)
  values ('Card test rule', false, '{street}', 1,
          '[{"type":"card","title":"A card","card_tier":"rare","xp_amount":25,"weight":13},{"type":"card","title":"A card","card_tier":"common","xp_amount":10,"weight":84},{"type":"card","title":"Bad","card_tier":"mythic"}]')
  returning id into rule;
  update public.spawn_points set active = false where id <> sp;
  made := public.spawn_boxes(now(), rule, true);
  perform pg_temp.eq(made::text, '1', 'one box spawned');
  select g2.card_max_tier, (select count(*) from public.drop_rewards r where r.drop_id = g2.id and r.reward_type = 'card') as n,
         (select string_agg(r.card_tier, ',' order by r.card_tier) from public.drop_rewards r where r.drop_id = g2.id) as tiers
    into g from public.game_drops g2 where g2.spawn_rule_id = rule;
  perform pg_temp.eq(g.card_max_tier, 'rare', 'the box may pay up to its highest card prize');
  perform pg_temp.eq(g.n::text, '2', 'the two good card prizes, not the bad tier');
  perform pg_temp.eq(g.tiers, 'common,rare', 'with their tiers');
  raise notice 'ok: the spawner';
end $t$;

do $t$ begin raise notice 'ALL CARD TESTS PASSED'; end $t$;

rollback;
