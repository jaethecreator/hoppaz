-- ============================================================================
-- Hoppaz: Game Time searches that do not queue behind the disk (16 Oct 2026)
-- Run order: after game_time.sql (xp_rewards.sql, if it is loaded, may come before or after).
-- Safe to run twice. Run it before doors open: it waits for a lock on two tables and gives up
-- after 3 s (lock_timeout), rolling back whole; run it again then. Nothing else changes:
-- game_time_search keeps every check (account, crew, one win per campaign, the server's tile
-- next to the object, the 2.5 s gap, the game's lock).
--
-- Why: every search takes the game's lock and holds it until its commit is on disk.
-- On a small plan whose disk budget is spent (tens of ms a commit) that is a few
-- dozen searches a second for the whole hunt, and the opening second of a hunt is
-- when everyone presses SEARCH.
--
-- What: a "nothing here" search writes only bookkeeping (the gap, the search count, a
-- box moved to another object), so it need not wait for the disk; a win must. Two
-- statement triggers decide that for whichever version of game_time_search is
-- installed, without copying it:
--   game_time_rate   every counted search writes its gap row first: that transaction
--                    stops waiting for the disk (a crash could lose the last fraction of
--                    a second of searches, which only means a search could come sooner);
--   game_time_wins   a win turns the wait back on, so the win, the claimed box and the
--                    feed line are on disk before the answer leaves the database.
-- ============================================================================
begin;
set local lock_timeout = '3s';

create or replace function public._gt_quick_commit() returns trigger
language plpgsql set search_path = public as $$
begin
  perform set_config('synchronous_commit', 'off', true);
  return null;
end $$;

create or replace function public._gt_durable_commit() returns trigger
language plpgsql set search_path = public as $$
begin
  perform set_config('synchronous_commit', 'on', true);
  return null;
end $$;

drop trigger if exists game_time_rate_quick_commit on public.game_time_rate;
create trigger game_time_rate_quick_commit after insert or update on public.game_time_rate
  for each statement execute function public._gt_quick_commit();
drop trigger if exists game_time_wins_durable_commit on public.game_time_wins;
create trigger game_time_wins_durable_commit after insert on public.game_time_wins
  for each statement execute function public._gt_durable_commit();

revoke all on function public._gt_quick_commit(), public._gt_durable_commit() from public, anon, authenticated;
commit;
