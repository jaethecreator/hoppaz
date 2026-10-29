-- Saved checkout details. DRAFT FOR OLA, NOT RUN ANYWHERE (not even locally). Release 1, file 13 in the run order (see EVENTS_R1_ORDER.md).
-- Written from the fake layer (src/lib/events-r1/fake/account.ts), which is the spec. Nothing in an older SQL file is edited and no
-- existing function is replaced. Safe to run again.
--
-- WHAT IT ADDS
--   Checkout asks for first name, last name, email and phone. Under the fields a switch, "Save my details for next time", on by default.
--   When it is on, the four values are kept here, one row per person, and the next checkout shows a "Paying as" card instead of the form.
--   The person sees and deletes them in Me ("Saved checkout details", Delete). Answers to a host's own checkout questions are NEVER kept here:
--   the table has no column for them.
--   ev_saved_details()                      the caller's row as jsonb { first_name, last_name, email, phone, updated_at }, or null
--   ev_save_details(first, last, email, phone)  keep or replace it: 'ok', or not_open, need_account, bad_details (no first name or no email,
--                                           or a value too long)
--   ev_delete_saved_details()               forget it: 'ok' (nothing saved is fine), or not_open, need_account
--   Only the person can read or change their own row: the table is closed to anon and authenticated, the functions use auth.uid().
--   Deleting the account (profiles row) deletes the row (on delete cascade).
--
-- Needs (load first):
--   schema.sql, chat_accounts.sql                          profiles, has_account()
--   events_r1_events.sql                                   _ev_open()
-- Test: supabase/tests/events_r1_saved_details_test.sql
--
-- The app degrades quietly until this runs (src/lib/events-r1/real/account.ts): no "Paying as" card, the fields start empty, nothing is saved.

do $$
begin
  if to_regprocedure('public._ev_open()') is null or to_regprocedure('public.has_account()') is null then
    raise exception 'events_r1_saved_details: run chat_accounts.sql and events_r1_events.sql first';
  end if;
end $$;

create table if not exists public.ev_saved_details (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_name  text not null default '' check (char_length(last_name) <= 60),
  email      text not null check (char_length(email) between 3 and 200),
  phone      text not null default '' check (char_length(phone) <= 30),
  updated_at timestamptz not null default now()
);
alter table public.ev_saved_details enable row level security;
revoke all on table public.ev_saved_details from public, anon, authenticated;

create or replace function public.ev_saved_details() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); d public.ev_saved_details;
begin
  if not public._ev_open() or me is null then return null; end if;
  select * into d from public.ev_saved_details where user_id = me;
  if not found then return null; end if;
  return jsonb_build_object('first_name', d.first_name, 'last_name', d.last_name, 'email', d.email, 'phone', d.phone, 'updated_at', d.updated_at);
end $$;
revoke all on function public.ev_saved_details() from public, anon;
grant execute on function public.ev_saved_details() to authenticated;

create or replace function public.ev_save_details(p_first text, p_last text, p_email text, p_phone text) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  f text := btrim(coalesce(p_first, ''));
  l text := btrim(coalesce(p_last, ''));
  e text := btrim(coalesce(p_email, ''));
  ph text := btrim(coalesce(p_phone, ''));
begin
  if not public._ev_open() then return 'not_open'; end if;
  if me is null or not public.has_account() then return 'need_account'; end if;
  if f = '' or char_length(f) > 60 or char_length(l) > 60 or char_length(e) < 3 or char_length(e) > 200 or position('@' in e) = 0
     or char_length(ph) > 30 then
    return 'bad_details';
  end if;
  insert into public.ev_saved_details (user_id, first_name, last_name, email, phone, updated_at)
  values (me, f, l, e, ph, now())
  on conflict (user_id) do update set first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
                                      phone = excluded.phone, updated_at = now();
  return 'ok';
end $$;
revoke all on function public.ev_save_details(text, text, text, text) from public, anon;
grant execute on function public.ev_save_details(text, text, text, text) to authenticated;

create or replace function public.ev_delete_saved_details() returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if not public._ev_open() then return 'not_open'; end if;
  if me is null or not public.has_account() then return 'need_account'; end if;
  delete from public.ev_saved_details where user_id = me;
  return 'ok';
end $$;
revoke all on function public.ev_delete_saved_details() from public, anon;
grant execute on function public.ev_delete_saved_details() to authenticated;
