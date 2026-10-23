-- Release 1: event cover pictures on real data (re-runnable).
--
-- The cover of an event is its flyer_url (set through ev_create_event / ev_update_event as cover_url). A host's phone shrinks the
-- photo to a JPEG and uploads it to the EXISTING public bucket crew-images (made by crew_rooms.sql, 2 MB, jpeg, png or webp), in the
-- host's own folder:
--
--     crew-images / event-covers / <the host's user id> / <file>.jpg
--
-- and keeps the full public link ("<storage host>/storage/v1/object/public/crew-images/event-covers/<uid>/<file>.jpg") as cover_url,
-- because every place that draws a flyer (cards, the map, the event page, the share card) uses flyer_url as an image address as is.
--
-- The older crew picture policies only match a file straight under <crew id>/ (one folder), so they never touch this path and this
-- file does not change them. It adds three policies of its own, named events_r1_cover_*: the host with an account (not a guest)
-- writes, lists and deletes in their own folder, a single file, a safe name, image extension; reads are public through the bucket.
-- The bucket's size and type limits (2 MB, jpeg/png/webp) are the bucket's own and stay as crew_rooms.sql sets them.
-- Nothing else here: no table, no function that already exists is changed.
--
-- Needs: crew_rooms.sql (the crew-images bucket), chat_accounts.sql (has_account()).
-- Test:  supabase/tests/events_r1_covers_test.sql

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'crew-images' and public) then
    raise exception 'events_r1_covers: run crew_rooms.sql first (the public crew-images bucket is missing)';
  end if;
end $$;

create or replace function public._ev_cover_path_owner(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.has_account()
     and array_length(storage.foldername(p_name), 1) = 2
     and (storage.foldername(p_name))[1] = 'event-covers'
     and (storage.foldername(p_name))[2] = auth.uid()::text
     and storage.filename(p_name) ~ '^[A-Za-z0-9._-]{1,120}\.(jpg|jpeg|png|webp)$';
$$;
revoke all on function public._ev_cover_path_owner(text) from public, anon;
grant execute on function public._ev_cover_path_owner(text) to authenticated;

drop policy if exists events_r1_cover_upload on storage.objects;
create policy events_r1_cover_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'crew-images' and public._ev_cover_path_owner(name));
drop policy if exists events_r1_cover_read on storage.objects;
create policy events_r1_cover_read on storage.objects for select to authenticated
  using (bucket_id = 'crew-images' and public._ev_cover_path_owner(name));
drop policy if exists events_r1_cover_remove on storage.objects;
create policy events_r1_cover_remove on storage.objects for delete to authenticated
  using (bucket_id = 'crew-images' and public._ev_cover_path_owner(name));
