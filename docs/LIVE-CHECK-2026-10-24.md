# Live site check, Sat 24 Oct 2026

What `https://hoppaz.fun` serves compared with `main` at `3d564cf` (PRs #10, #11 and #12 merged).
Read-only checks: plain GET requests and one look in a browser. Nothing was signed in to, written or changed.
This file changes no code.

## Result

The release code is deployed, but the new screens are not visible. The live site behaves like the app with every
Release 1 flag off ("the app is exactly as it was", as the PR #11 checklist says).

| Check | Live | Expected with the release switched on |
| --- | --- | --- |
| `/create` | 404 | 200 (the one-page create) |
| `/tickets/return` | 404 | 200 (only with paid tickets on, see below) |
| Home screen | Old header, no Create button, no bus icon | "Events in Lagos" header, Create button, bus icon |
| `/api/events-r1/pay/sweep` (no auth) | 401 "Not allowed." | 401 (so this code is deployed) |
| Opening script in the page HTML | present | present |
| `/api/public/events`, `/api/public/hotspots` | 200, real events | 200 |
| `/discover`, `/crew`, `/chat`, `/me`, `/drop`, `/admin`, `/privacy` | 200 | 200 |

`/phone` (404) is dev-only on purpose, and `/quests` redirecting to `/me#earn` is as intended.

Why: `src/app/create/page.tsx` calls `notFound()` unless `NEXT_PUBLIC_EVENTS_R1` is exactly `"1"`
(`src/lib/events-r1/flags.ts`). `/tickets/return` also needs `NEXT_PUBLIC_PAID_TICKETS` (or the fake flag), so it
stays a 404 until paid tickets are switched on. Both values are inlined at build time, so a change only shows after a
new build.

At the time of the check the home page had the same `etag` for about 6 minutes, so no new deployment had gone live
in that time.

## What to check in Vercel (no secrets needed)

1. `NEXT_PUBLIC_EVENTS_R1=1` and `NEXT_PUBLIC_ROOMS_SEAL=1` are set under **Production**, not only Preview.
2. The value is exactly `1` (`true` or `on` do not work).
3. A new build ran after the change. Redeploy **without the build cache**, or push an empty commit under your own
   name (Vercel blocks commits authored by Jae).
4. `hoppaz.fun` points at the latest Production deployment, and that deployment's commit is `3d564cf` or later.
5. The domain is on the same Vercel project you edited.

## Order of the switch-on (from the PR #11 checklist)

1. Run the SQL, in the order in `supabase/EVENTS_R1_ORDER.md`.
2. Set the two Production variables above and redeploy.
3. `select public.ev_set_setting('events_r1','on');`
4. Keep `NEXT_PUBLIC_PAID_TICKETS` off until the Bachs live account, webhook and fee settings are ready
   (`supabase/EVENTS_R1_PAY.md`).

The SQL must run before the flag goes on, or the new screens call database functions that do not exist.

## Checked on `main`

- `package.json` and `package-lock.json` changed since the release only by the Next.js 16.4.2 bump (PR #10).
- No malware markers in the tree; `postcss.config.mjs` is the clean 105-byte file.
