# Hoppaz UI upgrade

14 October 2026. What we are changing so the app feels natural, gets every Hopper's email,
and always shows where to go next. It draws on about 104 screens from Eventbrite, Tix,
Jetron, Lagos Life, MyLagosApp, Bello, PartyVerse and a few nightlife apps (the "APps flow"
folder). Every change below names the screens it comes from.

## The goals

1. **Nobody wonders where they are.** Labelled tabs, one clear place for each thing, and
   familiar patterns instead of a long tour.
2. **Every Hopper gives an email.** There is no guest mode. Sign-up is short, fun and
   happens early: it is part of joining Lagos, not a form in the way.
3. **After every action, you land where the result lives.** That moment is rich, so the app
   feels deep and alive rather than empty.

## Done tonight

| Change | Why |
|---|---|
| The Today tab is now **EVENTS** | People look for "events", not "today" (Bello 1972, MyLagosApp 1967). |
| The map's day chips collapse into **one orange calendar button** that names the pick ("NEXT 20", "TODAY", "SAT 17") | One control instead of a strip of 15. It pops and says what you are looking at. |
| The map's bottom "NEXT 20 · Tap your avatar to play" card is gone | It repeated the calendar, and Play is leaving. |
| The Events tab has the same orange calendar in its header and is titled "Events" | The same control in both places. |
| **Event rooms are open to everyone going** (WE OUTSIDE or I'm Going), not only people who checked in | The room is alive before the night. One chat per event, not two. |
| A whole-app copy audit (in progress): lines that point people the wrong way are fixed, and the list is in `docs/COPY-AUDIT.md` | Old copy still mentioned Play, "tap your avatar" and check-in-only rooms. |

## 1. Navigation: five labelled tabs

**MAP · EVENTS · ROOMS · CHAT · ME.** Every tab is labelled, with an orange bar on the active
one. Icon-only bars are where people get lost (Jetron 2009, IMG_2049). No tab is ever a dead
end; avoid the waitlist tab in IMG_1951.

- **MAP:** events, hotspots and your home base, plus the orange calendar.
- **EVENTS:** Ola's swipe deck. Right means WE OUTSIDE, left means pass. "We outside" lists
  your nights.
- **ROOMS** (was CREW): the place you enter rooms. Crews stay crews, but every crew opens
  as a room. See section 4.
- **CHAT:** every conversation you have. See section 5.
- **ME:** profile, home base, collection, settings.

## 2. Sign-up: early, short and fun (no guest mode)

Jae chose this direction on 14 Oct: his flow, plus hooks that keep the whole city in view.

1. **City splash.** About 2 seconds of Lagos at night. No buttons.
2. **"Set your location to get started."** The ask shows real Lagos flyers with "2 km away"
   (Tix 1980).
3. **A peek at the nearest hotspot room.** It is live: the room, people in it, chat moving.
   The app picks the hotspot closest to you. Nobody chooses a home base up front.
4. **Make your Hopper.** Pick your avatar look (Lagos Life 2033: fabrics, skin tones).
5. **STEP IN: Google or email.** This is the sign-up, and it is the only way into the room.
   The username is made automatically and can be changed later (Bello 1971–1972).
6. **You spawn in the room.**
   - The chat says "New Hopper in Jibowu".
   - Paz says: "This is the spot closest to you. Chat with people near you, or head out to
     see what's on tonight." He points at the room's door.
7. **The door, or Back, opens the map of events near you.** Exploring Lagos starts here.

**Home base is earned, not picked.** It becomes yours from where you spend the most time
over 30 days. Visiting other areas stays the point of Hoppaz, and the community rivalry comes
from where people actually hang out.

Everything after that is optional and asked when it is useful:
- **Interests:** later, one screen of emoji chips with Skip (Eventbrite 2014).
- **Notifications:** asked the first time it matters, showing sample alerts: "Game time in
  Jibowu", "3 of your crew are going" (Tix 1981, Eventbrite 2013).

Never an 8-step form before any content; the orange app at IMG_1942–1949 is the warning.

**Needs:** hotspot rooms on the new room engine (the 360 crew room is the template), so the
nearest room can be shown and entered.

## 3. Land where the result lives (and make it rich)

| You do | You land on | What makes it feel deep |
|---|---|---|
| Sign up (STEP IN) | the nearest hotspot room | "New Hopper in Jibowu", people say hi, Paz points at the door to the map, and a welcome box shimmers |
| WE OUTSIDE on an event | that event's room | Who else is going (faces), the countdown, the line-up on the walls, and chat open |
| Join a crew (invite link) | the crew's room | Members wave, "you're member #47", the crew's next event |
| Open a box | a full-screen reveal, then your Collection | The new card flips in, with a NEW tag and the set's progress ("3 of 8 Yaba") |
| Check in at a venue | the event room, with a stamp moment | The stamp, XP counting up, the badge, and your hotspot's score going up |
| Win a Game Time ticket | a full-screen win with the code | Confetti, the reward sound, copy code, and the ticket on your Me page |

Every landing has a clear way back, like "Back to events" or "Back to map" (Tix 1987).

## 4. Rooms (the CREW tab becomes ROOMS)

The CREW tab becomes ROOMS. Crews are still crews (communities), but you enter them as rooms.
The tab has four sections:
1. **Your home base:** your hotspot room, with "12 here now", faces, and its league position.
2. **Your crews:** each crew card is its room, with live faces, ENTER and Invite.
3. **Brands:** verified brand rooms. 360 Playlist is first.
4. **Tonight:** rooms for tonight's events, plus events you're going to.

At the bottom: **Start a crew**.

**A crew page is a hub, not a dead end.** The top has the brand, verified badge, members and
"N in the room now", a big ENTER ROOM button, and Invite or Join. Then a chat preview, then
"Explore from here": the crew's events on the map, nearby hotspots, tonight's deck and other
crews.

## 5. Chat: your conversations, clearly connected

- One list: **direct messages**, plus **each room's chat** with its room icon (hotspot, crew,
  event).
- **A room's chat is the same conversation as the General chat inside the room.** There are
  two doors and the same messages. Tapping a room chat opens the room with chat beside it.
  This answers "how do crews and chat connect".
- Waves stay as they are (wave first, then DM).

## 6. The event page

- **Top:** a full-bleed flyer over a blurred copy of itself, with save and share
  (Tix 1990, Jetron 2001).
- **Key facts:** four icon rows for price, date, time and venue, plus a landmark hint
  ("Beside Shoprite Lekki", Tix 1992).
- **Tabs:** **Details · Moments · Room.** Moments are guests' photos, which open after you
  go (PartyVerse 1961). Room is who's going and the chat.
- **Bottom:** the WE OUTSIDE or ticket button stays put.
- **Hop stops:** a secret Hop stop shows "Undisclosed" until it is revealed (Jetron 2001).

## 7. The map

- One orange calendar (done).
- Hotspot pins in the map's own marker system, with "12 here" and box badges.
- A "Your home base" chip that flies the map to your home and opens its room.
- A Grid View switch to see the same events as a list (orange app 1954).
- No "Tap your avatar" copy. Play is gone.

## 8. Tour: four steps, under a minute

The first-run tour points at the real controls, with dots and Skip (Lagos Life 2035–2041):
1. **The map:** "Events and your people, live."
2. **EVENTS:** "Swipe right if we outside."
3. **Your home base:** "This is your turf. Bring your people."
4. **"Stuck? Ask Paz."**

It replaces the current 15-step tour.

## 9. Phone and website

The same flows on both. The website should feel like an app; Lagos Life proves a website
can. On wider screens, a room's chat sits beside the room and the event page puts the flyer
and details side by side. Share links always open in Hoppaz.

## Order of work

1. **Tonight:** the 360 crew room, with its invite link and crew hub. In progress.
2. **Thursday:** Game Time and the Dave drop.
3. **Next:**
   - the ROOMS tab and chat clarity (sections 4 and 5);
   - the new sign-up flow and the 4-step tour (sections 2 and 8);
   - the landing moments (section 3);
   - the event page (section 6);
   - the map extras (section 7).
