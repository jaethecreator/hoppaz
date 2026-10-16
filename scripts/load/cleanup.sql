-- Removes everything scripts/load/seed.sql made: the load test users (load-NNN@load.invalid), their crew, room,
-- messages and hunt. LOCAL OR THROWAWAY DATABASES ONLY.
--   docker exec -i hoppaz-load-db psql -U postgres -d load -v ON_ERROR_STOP=1 < scripts/load/cleanup.sql
begin;
delete from public.game_time_wins where campaign_key = 'load-test';
delete from public.game_time_rate where user_id::text like '10ad0000-0000-4000-8000-000000000%';
delete from public.crews where id = '10ad0000-0000-4000-8000-c00000000001';
delete from auth.users where id::text like '10ad0000-0000-4000-8000-000000000%' and email like 'load-%@load.invalid';
commit;
