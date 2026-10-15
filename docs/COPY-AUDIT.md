# Copy audit, 14 Oct 2026

Testers were being led the wrong way by lines written before the product changed. This pass read every
user-facing string in `src/app`, `src/components`, `src/lib` (intro lines, toasts, error maps), the push text
(`public/sw.js`, `supabase/push.sql`, the test push route), share text and the privacy page, and checked each
against how Hoppaz works today.

## The truth the copy has to match

- Tabs: MAP, EVENTS (was TODAY), CREW, CHAT, ME. Events is a swipe deck: right is WE OUTSIDE (you're going),
  left is pass. I'M GOING and WE OUTSIDE both mean going.
- The map has a NEXT 20 chip (it reads TODAY or a day once one is picked) and an orange calendar button beside it.
  The day chip rail and the "NEXT 20 / Tap your avatar to play" card are gone.
- Play (tap your avatar for a game view) is being removed. Nothing outside Play should tell people to tap their
  avatar, enter Play or send their avatar. Boxes will live inside hotspot rooms; until then, say less.
- An event room is for everyone going (WE OUTSIDE) and everyone checked in. Checking in at the venue still earns
  the check-in XP and badges.
- Hotspots are community home bases with rooms. Crews are communities that open as rooms.
- Sign-up is name, email and password, with Google first. No guest mode going forward.
- Voice: short, second person, Paz the Conductor (loud, cheeky, Lagos street, not luxe). No new emoji, never the
  word "experience".

## Fixed, by section

Counts are strings changed in the app. Line numbers are after the fix.

| Section | Fixed |
|---|---|
| Map | 4 |
| Events | 4 |
| Event page | 0 (checked, nothing stale) |
| Chat | 3 |
| Crew | 0 (files owned by another agent, see Proposals) |
| Me | 4 |
| Intro / Paz | 3 |
| Boxes / Play leftovers | 3 |
| Account | 3 |
| Push | 2 |
| Privacy | 0 (deliberately, see Product decisions) |
| Admin | 1 |
| Total | 27 |

### Map

1. `src/app/error.tsx:31`, `src/app/global-error.tsx:46`, `src/app/not-found.tsx:16`
   - Before: "BACK TO TODAY"
   - Wrong: there is no Today tab, and the button goes to `/`, the map.
   - After: "BACK TO THE MAP"
2. `src/components/map-chrome/MapNotice.tsx:16`
   - Before: "Can't reach today's events."
   - Wrong: the map opens on NEXT 20 (several days), not just today.
   - After: "Can't reach the events."

### Events

3. `src/components/today/SwipeStack.tsx:302` (the WE OUTSIDE button's spoken label)
   - Before: "We outside. You're interested in going."
   - Wrong: WE OUTSIDE means you're going, not "interested".
   - After: "We outside. You're going."
4. `src/components/today/Empty.tsx:94`
   - Before: "Can't reach today's events."
   - Wrong: the deck shows NEXT 20 or a picked day, not only today.
   - After: "Can't reach the events."
5. `src/app/discover/page.tsx:292` (toast after WE OUTSIDE on a card)
   - Before: "We outside. Its group chat invite is in Crew."
   - Wrong: written before event rooms opened to everyone going. Saying WE OUTSIDE now puts you straight in the
     event room; the toast only pointed at a Crew invite.
   - After: "We outside. You're in its room in Chat."
6. `src/app/discover/page.tsx:346` (toast after the first right swipe of a visit)
   - Before: "We outside. It's in your WE OUTSIDE list, with its group chat."
   - Wrong: you are not in the group chat (you get an invite); you are in the event room.
   - After: "We outside. It's on your list, and you're in its room in Chat."

### Event page

Checked `GoingFoot`, `CheckInBlock`, `DropRow`, `EventQuestList`, `StubSheet`, share text. I'M GOING, CHECK IN,
"CHECK-IN OPENS AT THE VENUE", "Unlocks when you check in" and the EVENT CHAT link all match today. No change.

### Chat

7. `src/lib/chat.ts:60` (toast when you post in an event room you are not in)
   - Before: "CHECK IN AT THE EVENT TO JOIN ITS ROOM"
   - Wrong: the same mistake as the line fixed in 12f7156. The room is for everyone going; check-in is not the way in.
   - After: "SAY YOU'RE GOING TO THE EVENT TO JOIN ITS ROOM" (the toast shows it in sentence case; worded so the
     lower-casing does not mangle "WE OUTSIDE")
8. `src/lib/chat.ts:155` (wave refused)
   - Before: "YOU CAN WAVE AT PEOPLE AT THE SAME PARTY OR IN YOUR GROUP CHATS"
   - Wrong: you can wave at anyone in a room you are in, and event rooms now hold everyone going, before the night.
   - After: "YOU CAN WAVE AT PEOPLE IN YOUR ROOMS AND GROUP CHATS"
9. `src/components/chat/Inbox.tsx:46`
   - Before: "Wave at someone at the same party or in one of your group chats. If they wave back, your private chat opens."
   - Wrong: same as 8.
   - After: "Wave at someone in an event room or one of your group chats. If they wave back, your private chat opens."

### Crew

No edits: `src/app/crew/**` and `src/components/crew-room/**` belong to another agent right now. See Proposals.

### Me

10. `src/components/me/SettingsGroup.tsx:108` (Music on)
    - Before: "You hear soft music in Play, Today, Crew and Me. Quieter from 11pm to 7am."
    - Wrong: names Play and the old Today tab.
    - After: "You hear soft music in Events, Crew, Me and crew rooms. Quieter from 11pm to 7am."
    - Note: the working tree already had the other agent's "and crew rooms" on this line; the new line keeps it.
11. `src/components/me/SettingsGroup.tsx:210` (Spawn alerts off)
    - Before: "No alerts. You still see spots on the map when you look."
    - Wrong: spots and street boxes only show inside Play, never on the map.
    - After: "No alerts. Your phone stays quiet."
12. `src/components/me/SettingsGroup.tsx:211` (Spawn alerts on)
    - Before: "..., even with the app closed. Nothing between 11pm and 8am."
    - Wrong: quiet hours are 23:00 to 07:00 Lagos (`push_in_quiet_hours`, docs/PUSH.md).
    - After: "..., even with the app closed. Nothing between 11pm and 7am."
13. `src/components/cards/CardAlbum.tsx:46` (no cards yet)
    - Before: "Street boxes pay cards. Every card is a Lagos place: stand there and stamp it Visited."
    - Wrong: street boxes only exist in Play; a tester goes looking for them on the map.
    - After: "Cards come out of boxes. Every card is a Lagos place: stand there and stamp it Visited."

### Intro / Paz (`src/lib/intro/lines.ts`)

14. `lines.ts:105` (`deck_go`)
    - Before: "Tap Today and let's see the events."
    - Wrong: the tab is EVENTS.
    - After: "Tap Events and let's see the line-up."
15. `lines.ts:114` and `lines.ts:115` (`chat`)
    - Before: title "Every event has a chat", line "That's where your crew forms. Tap the chat!"
    - Wrong: says nothing about who is in it; the room is for everyone going.
    - After: title "Every event has a room", line "Everyone going is in it. Tap the chat!"
    - docs/INTRO.md rows 11 and 13 updated to match.

The Play steps of the tour (`face`, `box1`, `box2`, `box_far`, `spawns`, `leave_play` and the `backIn`,
`leavePlay` cards) still say "Tap your face" and "Send your avatar". They drive the tour into Play, so new words
alone would break it. See Product decisions, item 1.

### Boxes / Play leftovers

16. `src/app/drops/page.tsx:28` (Live drops, how to claim an avatar drop)
    - Before: "Send your avatar to open it, in Play."
    - Wrong: points at Play.
    - After: "A street box."
17. `src/components/play/PlayLayer.tsx:231` (toast when Play times out and drops you back on the map)
    - Before: "Play paused. Tap your avatar to come back."
    - Wrong: tells people to tap their avatar.
    - After: "Paused. You're back on the map."
18. `src/components/hotspots/room/copy.ts:37` (hotspot open on another screen)
    - Before: "Your avatar is in another hotspot, on another screen. One avatar, one place."
    - Wrong: leans on the Play avatar; hotspots are becoming home bases with rooms.
    - After: "You are in another hotspot, on another screen. One place at a time."

Lines inside the Play view itself ("Tap a box. Your avatar runs to it.", "Tap to send your avatar.", the HUD) are
left alone: they describe Play while it still runs and go when Play is removed.

### Account

19. `src/app/account/page.tsx:56` (under LOG OUT)
    - Before: "Logging out leaves this phone browsing as a guest."
    - Wrong: advertises guest mode, which is going.
    - After: "Log back in any time with Google or your email."
20. `src/components/chat/PersonCard.tsx:127` (sign-up nudge on a person)
    - Before: "Name, email and a password. Takes a minute."
    - Wrong: Google comes first on the sign-up form.
    - After: "Google, or name, email and a password. Takes a minute."
21. `src/components/app/AccountWall.tsx:7` (first perk on the sign-up wall)
    - Before: "Say WE OUTSIDE and get into the event's group chat"
    - Wrong: WE OUTSIDE puts you in the event room; the group chat is only an invite.
    - After: "Say WE OUTSIDE and get into the event room with everyone going"

### Push

22. `supabase/push.sql:257` (body of every spawn alert)
    - Before: "Under 1 km from you. Send your avatar to open a box." (or "About N km from you. ...")
    - Wrong: lands on lock screens telling people to send their avatar.
    - After: "Under 1 km from you. First come, first served." (spot boxes pay the first N to open them)
    - To go live, run `supabase/push.sql` again in Supabase. `supabase/tests/push_test.sql` only checks the
      distance prefix, so it still passes.
23. `src/app/api/push/test/route.ts:25` (SEND ME A TEST ALERT, development only)
    - Before: "About 1.4 km from you. Send your avatar to open a box."
    - After: "About 1.4 km from you. First come, first served."

`public/sw.js` only shows what the push carries ("Hoppaz" as a fallback title). No change.

### Privacy

No edits. The "Play and spawn alerts" section and the hotspot paragraph ("A hotspot can only be entered from
Play", "while Play is open it still sends your position about every 20 seconds", "While your avatar is in a room")
describe what the app does today. Softening them before Play is gone would understate the location data Hoppaz
collects. See Product decisions, item 5.

### Admin

24. `src/app/phone/PhoneFrame.tsx:17` (staff phone preview page picker)
    - Before: "Today"
    - After: "Events"

Checked the launch desk, the box spawner and the hotspot desk: staff copy, nothing that misleads testers.

### Docs that mirror app strings

- `docs/INTRO.md` rows 11 and 13: "Tap Events", "Every event has a room; everyone going is in it".
- `docs/MUSIC.md` "Lines as built": the new Music line.

## Needs a product decision

These need code or data changes, not just words, so they were left as they are.

1. **The first-run tour walks every new tester into Play.** `src/lib/intro/steps.ts` and `lines.ts`: after
   "Let's find you", Paz says "Tap your face" (`face`), then the three welcome boxes (`box1`, `box2`), "Too far to
   walk? Send your avatar, oya!" (`box_far`, button "Send it"), "Boxes drop all day" (`spawns`), "Want a ping?"
   (`alerts`, box alerts), "Tap the arrow to leave Play" (`leave_play`), plus the `backIn` ("Tap your face to jump
   back into Play") and `leavePlay` cards and the location nudge "Turn it on and I'll fly you to your boxes".
   The `keep` step ("Keep your Golden Danfo", the tour's one sign-up moment) hangs off the welcome boxes too.
   Proposal: drop the box part, so the tour runs welcome, install, locate, Events, deck, event room, Crew, Me, and
   move the sign-up moment to the first WE OUTSIDE.
2. **The map avatar still says PLAY.** `src/components/play/Avatar.tsx:61` draws a "PLAY" tag on your face and
   line 46 labels it "Your avatar. Tap to play." It is the front door to Play; taking it away is a UI change.
3. **Spawn alerts will go silent.** The Me row "SPAWN ALERTS" and `notify_spot_alert` only reach people whose
   Play was open in the last 6 hours (`play_fix`). With Play gone they reach nobody. The push also opens
   `/?spot=<id>`, which nothing in the app reads, so a tap lands on the plain map. Decide: remove the row and the
   alerts, or re-point them at hotspot rooms when boxes move there.
4. **Avatar drops cannot be opened without Play.** Drops with `claim_method = 'avatar'` (street boxes from the
   spawner) are opened by sending your avatar. They now read "A street box." on Live drops. Stop the spawner making
   them, or move them into hotspot rooms.
5. **Privacy page.** Rewrite the "Play and spawn alerts" section and the hotspot paragraph in the same change that
   removes Play and gives hotspots their new way in. "Your anonymous account has an internal ID" goes when guest
   mode goes.
6. **Guest mode leftovers.** Anonymous sessions still exist (`useSession` signs in anonymously), so these are true
   today and should go with guest mode: "Free. Your XP so far comes with you." (`SignupForm.tsx:146`), "Your XP
   comes with you." (`SettingsGroup.tsx:365`), and right swipes kept on the phone until sign-up (`swipeLog.ts`).
7. **Two chats per event.** WE OUTSIDE puts you in the event room (Chat tab, closes three days after) and sends an
   invite to the event group chat (Crew, stays). Testers will mix them up. Decide whether to merge them.
8. **Hotspots are only reachable from Play.** `PlayLayer.tsx` mounts the hotspot pins, row and rooms, and
   `/?hotspot=<slug>` opens Play on that hotspot (the crew hub's HOTSPOT card links there,
   `src/components/crew-room/CrewHub.tsx:274`). When Play goes, hotspots need their own way in (the home bases),
   or they vanish.
9. **Hop room refusal.** Posting in a Hop room you did not ride gives the event-room refusal (`not_at_event`), now
   "Say you're going to the event to join its room". The Hop needs its own reason code in `in_room`'s callers
   (`chat_accounts.sql`, `hotspots.sql`).

## Proposals for files another agent is changing

Not edited. Suggested text for whoever owns them:

1. `src/app/crew/page.tsx:102`
   - Now: "Say you're going to an event and you're invited to its group chat. Unlike the event room, it stays after the night."
   - Wrong: the event room also stays after the night (it closes three days after the event).
   - Proposed: "Say WE OUTSIDE and you're invited to its group chat. The event room shuts three days after; this one stays."
2. `src/app/crew/page.tsx:148` (no crews yet)
   - Now: "A crew is the people you actually go out with. Start one below, or join with a code."
   - Wrong: crews are communities with a room of their own now.
   - Proposed: "A crew is your people, with a room of its own. Start one below, or join with a code."
3. `src/app/crew/group/[id]/page.tsx:67`
   - Now: "Group chats open when you say you're going to an event. Tap I'M GOING on an event, and its invite lands in Crew."
   - Not wrong (I'M GOING still means going), but the deck says WE OUTSIDE.
   - Proposed: "Tap WE OUTSIDE on an event and its group chat invite lands in Crew."
4. `src/components/campaign/CampaignExperience.tsx:159` ("Customize", "Customize crew room", "Customize this preview")
   - The app spells the British way elsewhere ("Colour", "metres").
   - Proposed: "Customise", "Customise crew room", "Customise this preview".
5. `src/components/campaign/CampaignExperience.tsx:19` to `:24` and `src/lib/campaign/layout.ts:23` to `:28` (room blurbs)
   - Voice is luxe ("A tucked-away listening room. Put on your headphones and spend a little time with the music.").
     It is 360 Playlist's own room, so the brand may want its voice; if it should sound like Hoppaz, shorter and
     louder, for example "Headphones on. First listen, before anybody."

`src/components/BottomNav.tsx` (MAP, EVENTS, CREW, CHAT, ME), `src/components/crew-room/**`,
`src/lib/crew-room/**`, `src/lib/sound/music.ts`, `src/components/app/MusicHost.tsx` and
`supabase/crew_rooms.sql`: read, nothing stale.

## Checked and left alone

- No em dashes in any user-facing string. "Experience" appears only in a component name and a CSS class, never on
  screen.
- `src/components/SwipeDeck.tsx` and `src/components/reveal/BoxSheet.tsx` are not imported anywhere; their copy
  never shows.
- `src/app/dev/**` pages are development tools.
