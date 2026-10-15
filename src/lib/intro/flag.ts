/**
 * The one switch for the whole first-run intro: the city title sequence, Paz's
 * tour (cards, spotlight, arrow), the "Replay the intro" and "Replay the tour"
 * rows on Me, the first-run location sheet that opens by itself, and every
 * intro-driven redirect or gate. While it is false a new person opens straight
 * onto the map with every event in view, and an account is asked for at the
 * first thing that needs one (WE OUTSIDE, chat, joining a crew).
 *
 * Nothing is deleted. Every entry point reads this constant and does nothing
 * when it is false:
 *
 *   src/components/intro/IntroHost.tsx   renders nothing (layout.tsx does not mount it either)
 *   src/lib/intro/store.ts               introEvent, introReplay, introPending, introAsksLocation
 *   src/lib/intro/active.ts              introActive, useIntroActive: the gates stay Ola's own
 *   src/lib/intro/actions.ts             registerIntroAction, runIntroAction
 *   src/components/intro/ReplayTourRow.tsx, src/components/me/SettingsGroup.tsx   the Me rows
 *   src/app/page.tsx                     the title sequence, the camera swoop, the first-run location sheet
 *
 * TO TURN THE INTRO BACK ON: set this to true. That is all. Two things to know
 * when you do. The tour keeps its progress per person in localStorage, so
 * people who have used the app meanwhile will start it from the top the next
 * time they open the map. And the title sequence is remembered per device
 * (hoppaz.v1 seenTitle), so a device that never saw it plays it once.
 *
 * Review it any time at /dev/intro (development only; it works while this is true).
 *
 * (Typed as boolean on purpose: a bare `false` literal makes TypeScript treat
 * the code behind each check as unreachable.)
 */
export const INTRO_ENABLED: boolean = false;
