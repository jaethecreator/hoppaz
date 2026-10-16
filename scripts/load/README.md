# Crew room load test

`crew-room-load.mjs` puts 20, 50 or 100 fake phones in one crew room and measures the database. Each fake phone makes the
app's calls at the app's pace (copied from `useCrewRoom.ts` and `game-time/controller.ts`): enter, walk, beat, read the
room, General chat, chat catch-up, Game Time checks, searches next to objects, the inbox and announcements. No browsers.

It is a comparison tool, not a promise: this Mac is faster than a small Supabase server, its network is instant, and the
rest of the app (maps, hotspots, Realtime) is not running. Compare before and after on the same box.

**Local or throwaway databases only.** The script refuses any address that is not this Mac, and the shared local stack
(`supabase_db_hoppaz-local`) unless `--shared-ok`. Never point it at production.

## A throwaway copy of the local database

From the session folder (paths to taste; keep the two secret files private and never print them):

```bash
mkdir -p /tmp/hoppaz-load && cd /tmp/hoppaz-load && umask 077
openssl rand -hex 16 > pgpass && openssl rand -hex 32 > jwtsecret
docker exec supabase_db_hoppaz-local pg_dump -U postgres -d postgres -Fc --no-subscriptions > local.dump
docker network create hoppaz-load-net
docker run -d --name hoppaz-load-db --network hoppaz-load-net --cpus=2 --memory=1g --shm-size=256m \
  -e POSTGRES_PASSWORD="$(cat pgpass)" -p 127.0.0.1:3411:5432 public.ecr.aws/supabase/postgres:17.11.0.004 \
  postgres -D /etc/postgresql -c max_connections=60
docker exec hoppaz-load-db psql -U supabase_admin -d postgres -c "create database load"
docker exec hoppaz-load-db psql -U supabase_admin -d postgres -c "alter database load owner to postgres"
docker cp local.dump hoppaz-load-db:/tmp/local.dump
docker exec hoppaz-load-db pg_restore -U supabase_admin -d load /tmp/local.dump   # cron and realtime role errors are expected
docker exec hoppaz-load-db psql -U supabase_admin -d load -c "alter role authenticator with password '$(cat pgpass)'"
docker exec hoppaz-load-db psql -U supabase_admin -d load -c "alter system set pg_stat_statements.track = 'all'" \
  -c "alter system set track_functions = 'pl'" -c "select pg_reload_conf()"
docker run -d --name hoppaz-load-rest --network hoppaz-load-net \
  -e PGRST_DB_URI="postgres://authenticator:$(cat pgpass)@hoppaz-load-db:5432/load" -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$(cat jwtsecret)" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_EXTRA_SEARCH_PATH=public,extensions \
  -e PGRST_DB_POOL=10 -p 127.0.0.1:3410:3000 public.ecr.aws/supabase/postgrest:v16.4
```

2 CPUs, 1 GB and 60 connections are about a small Supabase plan; PostgREST's pool is 10. Load the SQL you want to test
(`supabase/crew_rooms_scale.sql` for "after"), then:

```bash
node scripts/load/crew-room-load.mjs --secret-file=/tmp/hoppaz-load/jwtsecret --mode=before --levels=20,50,100 --duration=60
node scripts/load/crew-room-load.mjs --secret-file=/tmp/hoppaz-load/jwtsecret --mode=after --levels=20,50,100 --duration=60
```

Every level runs `seed.sql` first (150 users `load-NNN@load.invalid`, "Load Test Crew", a live hunt with 10 boxes) and resets
the database statistics. `cleanup.sql` removes all of it.

- `--mode=before` is the app on `jae/perf-all` (crew_room_step and crew_room_state, the whole room in every answer).
- `--mode=after` is this branch (crew_room_move, crew_room_tick, Game Time every 15 s with the feed up). At the end it stops
  every walker, reads once more and checks that every phone's room matches the server's (`view`).
- `--capacity=100` with more phones than that: the rest watch a full room and try for a spot (before: every 15 s; after:
  only when the room has one).
- `--chat=0.6` messages per phone per minute (half go to the area chat when the phone stands in one); `--hunt=0` for a room
  with no hunt; `--out=file.json` keeps everything.

### A slow disk

A small Supabase plan that has spent its disk budget makes every commit wait. To see that here:

```bash
docker exec hoppaz-load-db psql -U supabase_admin -d load -c "alter system set commit_delay = 45000" \
  -c "alter system set commit_siblings = 0" -c "select pg_reload_conf()"
```

(`commit_delay = 0` puts it back.)

## What it prints

Per level: requests a second, errors, p50/p95/p99 latency, bytes out of the database, DB CPU (docker stats; 200% is both
CPUs), transactions a second, connections, connections waiting on a lock; per call the same; and the functions that took the
most time (`pg_stat_user_functions`). Stop the copy with `docker rm -f hoppaz-load-rest hoppaz-load-db` and
`docker network rm hoppaz-load-net`.
