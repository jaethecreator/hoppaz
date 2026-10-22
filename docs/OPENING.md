# The openings: the bus title and the short Hoppaz opening

Two things play when Hoppaz opens. Each has its own switch. Both are inlined at build time: redeploy after changing one.

| What | Switch | For whom | Length |
|---|---|---|---|
| **Bus title** (the city title sequence: the orange Hoppaz bus crosses Third Mainland Bridge, Lagos at night, ends on the wordmark and Paz) | `NEXT_PUBLIC_BUS_INTRO=off` | Someone opening Hoppaz for the first time on this device. Once. | about 4.5 s, tap to skip |
| **Opening** (the wordmark bounces in over a night skyline, LAGOS under it, an okada rides across) | `NEXT_PUBLIC_OPENING=off` | A cold start, and the app coming back after 10 minutes or more in the background. Not on the first visit. | about 1.65 s, tap to skip |

Both are on unless set to `off` (or `0`, `false`). Reduced motion: the title is skipped, the opening is one still frame for under a second.

## The order on a first visit

1. The bus title plays on the map (tap to skip). The first run's cards wait: the title is a dialog.
2. The camera swoops in, then the first run starts as built (location card, events, the pull to the nearest room).
3. The opening does not play on that visit. Every later cold start has it.

A link to one thing (`?e=`, `?hotspot=`, `?date=`, `/event/...`, `/room/...`) gets neither, the same people the first run leaves alone.

## Bus title

Restored from 45577cd~1 (`TitleSequence.tsx`, keyframes now in `title-sequence.css`). `src/lib/opening/busIntro.ts` decides who gets it:
no mark `hz-bus-intro-v1`, no location answer, a first run no further than its first card, no saved location or avatar. The mark is
written when it starts, so a skip, a finish or leaving mid-way all count. On a test host `/?bus-intro` plays it again, and `/reset`
wipes a browser to a first visit. Paz's tour is not part of it and is still removed.

## Opening

- `OpeningCover.tsx`: inline SVG in the page's HTML, not drawn. `opening.css`: the animation, 100 percent CSS. No video, no new image
  (the wordmark is the existing `public/brand/wordmark-cream.png`).
- `src/lib/opening/boot.ts`: a script in `<head>` that decides a cold start before first paint and sets `html[data-opening="in"]`.
  A cold start is a visit with an empty `sessionStorage` for this tab: opening the installed app, a new tab, a link. A reload and moving
  around the app keep it, so they never replay it. It also puts a tap handler on at once.
- `OpeningHost.tsx` (client): tidies up, handles a tap or Escape, and plays it again when the app comes back after
  `BACKGROUND_GAP_MS` (10 minutes, `src/lib/opening/timing.ts`) in the background.
- The CSS ends it by itself after `OPENING_MS` (1.65 s) even if the app is slow to start, so it can never hold the app longer.
- Never on: `/report`, `/admin`, `/dev`, `/reset`, `/account`, `/auth`, `/api` (`OPENING_SKIP_PATH`).
- On a test host `/?opening` plays it whatever the rules say.
