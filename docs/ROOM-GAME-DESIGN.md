# Room game design: the 360Playlist room on phones

Status: build spec v1, 15 Oct 2026, branch `jae/consolidate`. Author: independent game designer pass. Covers `/crew/<crew id>/room`. Phones first (390 x 844 and 360 x 800); landscape and desktop adapt (section 21). This file is design only: nothing in `src/` was changed to write it. Numbers are CSS pixels unless a line says otherwise. Where a number comes from the code it says which file.

How to read it: section 0 is the verdict. Sections 1 to 3 are the frame, layers and look. 4 to 10 are the room itself (camera, labels and pop-ups, buttons, Hoppers, chat, explore). 11 to 16 are the fountain, the door, Game Time, voice, sound and the first visit. 17 is a wireframe of every state. 18 to 23 are the quality bar, copy, builder notes, landscape and desktop, ideas, and the acceptance list.

## 0. Verdict on today's room, and the design in one paragraph

Measured on today's tree in my own copy (port 3117, 390 x 844, signed in as the local test account, plus Jae's five screenshots):

1. **It is a scene wrapped in a web page.** The world gets 437 of 844 px (52 percent). The rest is a 69 px header with three buttons, a 50 px status line, an 88 px row of six chips, and the "Step into the sound" panel below the fold. A phone never sees the room: the zoom is fixed at 0.85, which shows 14 x 16 of the 30 x 20 tiles, and the whole-room overview only exists on screens 700 px or wider (`CampaignWorld.tsx`).
2. **It has no app around it.** `BottomNav.tsx` hides the tabs on `/crew/<id>/room` (FULL_SCREEN), so the room looks like another site (image 4 against image 5).
3. **Chat is a page, not a layer.** Before the first message it spends three bands on a title bar, two tabs and a helper sentence, then clips what is left. In image 6 about a quarter of the sheet shows messages, and the input reads "Choose an area above" and refuses to type.
4. **It will not hold 60 phones.** `.world` and every `.player` animate `left` and `top` (layout work, not compositor work). One avatar is 77 SVG nodes, so 60 people is about 4,600 nodes on top of the 658-node scene. Baseline in headless Chrome at devicePixelRatio 3 on a dev build with 2 avatars: walking p95 frame 33 ms at normal speed and 117 ms at 4x CPU throttle, 56 of 494 frames over 33 ms. A production build is better and 60 avatars are worse. Treat these as the floor to beat.
5. **The copy is luxe and the labels are numbers.** "01", "Conversation areas", "Choose a room, or tap the floor to walk". Nobody on a danfo talks like that.

**The design.** The room is a place inside Hoppaz, not a page. The app's own header and tab bar frame it (CREW lit). The world fills everything between them and opens on the whole room for 1.5 seconds with the six room names readable, then zooms to you at the door. You tap the floor to walk, drag to look, pinch to zoom. Nothing else sits on the world except one chat button, one camera button, one sound icon and, when you stand by something usable, one orange pill (Game Time adds its banner while it runs). Everything the old screen said in paragraphs becomes a small card that pops over your head for 3 seconds. Chat is a see-through sheet you pull up over the bottom of the world and pull down to close, while the room keeps moving above it. Tap a person and a small menu opens on them: five vibe stickers, SAY HI, WALK TO, PROFILE. The Dave night is a sticker on the fountain. The door says EXIT TO MAP and only works when you mean it.

### Six rules (every decision below follows from these)

1. **The world never leaves.** Every overlay is anchored in the world, is a sheet over the lower part of it, or is the single pill. No page, no side panel, no status bar, no "room details".
2. **One thumb.** Everything you tap sits in the lower 60 percent. The top 20 percent is for reading only.
3. **One thing at a time.** One card, one pill, three bubbles, three stickers. Anything more is dropped, oldest and least important first.
4. **Hoppaz skin.** Tokens, fonts, 6 px radius, the lip button, stamp motion, lucide icons, DM Mono caps for labels. No new colours, no new fonts, no new icon set, no emoji.
5. **Say less, show more.** A pop-up is a name, one line and at most one action. Long content opens only when asked, as a sheet, and closes back onto the live world.
6. **Friday first.** About 60 people on Lagos mobile data. Every feature has a cheap path and a degrade path (sections 18 and 20).

## 1. The frame: sizes, safe areas, thumb zones

### 1.1 Frame arithmetic

The root layout (`app/layout.tsx`) is `fixed inset-0 flex flex-col`: the `main` area is `flex-1`, `BottomNav` is `flex-none` under it. With the tab bar back in the room, the room gets exactly `main`. All sizes below follow from that.

- Header height = 56 + `env(safe-area-inset-top)`. Landscape (height under 500): 44 + inset.
- Tab bar height = 53 + `env(safe-area-inset-bottom)` (52 min-height plus 1 px hairline, from `BottomNav.tsx`).
- World = viewport minus both. The world is `position: relative; overflow: hidden; isolation: isolate; touch-action: none`.

| Frame | Viewport | Insets top / bottom | Header | Tab bar | World W x H | Full view scale | Follow scale | Tile on screen (follow) |
|---|---|---|---|---|---|---|---|---|
| A. iPhone 14, browser tab or Chrome emulation | 390 x 844 | 0 / 0 | 56 | 53 | 390 x 735 | 0.394 | 1.11 | 35.5 |
| B. iPhone 14, installed to home screen | 390 x 844 | 47 / 34 | 103 | 87 | 390 x 654 | 0.394 | 1.11 | 35.5 |
| C. Android | 360 x 800 | 0 / 0 | 56 | 53 | 360 x 691 | 0.364 | 1.02 | 32.7 |
| D. Pro Max | 430 x 932 | 0 / 0 | 56 | 53 | 430 x 823 | 0.434 | 1.22 | 39.0 |
| E. iPhone SE | 375 x 667 | 0 / 0 | 56 | 53 | 375 x 558 | 0.379 | 1.07 | 34.1 |
| F. Landscape | 844 x 390 | 0 / 0 | 44 | 53 | 844 x 293 | 0.444 | 1.02 | 32.6 |

- **Full view scale** = `0.97 * min(W / sceneW, H / sceneH)`. The scene is 960 x 640 at width 30 and 1152 x 640 at width 36 (32 px tiles, `layout.grid`). At A the whole 30-wide room is 378 x 252 px, centred, with about 241 px of dark lawn above and below. That empty band is deliberate: it carries the room name tags and the first-visit hint (sections 4 and 5).
- **Follow scale** = `clamp(W / 352, 0.95, 1.30)`, but never so large that fewer than 9 tiles show vertically (`H / 288` caps it). That gives about 11 tiles across on every portrait phone, so a 360 phone and a Pro Max see about the same amount of room.
- Zoom limits: minimum is the full view scale, maximum is 2.2. Pinch between them.
- All of A to F must show no horizontal scroll and must keep the header title on one line (section 3).

### 1.2 Thumb zones at 390 x 844 (frame A)

Right thumb, one hand, phone held low.

| Zone | y range (screen) | What lives there |
|---|---|---|
| Easy (bottom 40 percent) | 506 to 844 | tab bar (791 to 844), the bottom row (chat, action pill, camera), the chat sheet in every state, the Hopper menu when the person is low on screen |
| Reach (middle 40 percent) | 170 to 506 | the world you tap to walk, zone cards over your head, bubbles |
| Read-only (top 20 percent) | 0 to 170 | header (back and logo are the only taps), Game Time banner, sound icon, hint chips |

Frame C (360 x 800) is the same shape: easy zone from 480, bottom row at y 687 to 735 of the screen, tab bar at 747.

### 1.3 Targets

- Every tap target is at least 44 x 44. A smaller visible control (the 36 px icon buttons, the 26 px name tags) gets its 44 px from padding or an invisible `::before`, the way `TopChrome.tsx` does it (36 px chip, 44 px button).
- Gap between two neighbouring targets: at least 8 px.
- Hit-test order, top to bottom (it follows the z-order in section 2): modal sheets and their scrim, the chat sheet, the bottom row and action pill, HUD icons, Hopper menu and in-world cards, name and zone tags and the door plate, avatars (a 44 px circle around the avatar centre, whatever the zoom), the fountain sticker, the floor. The tab bar sits outside all of it and always wins.

## 2. Layers and z-order

All layers live inside one room container (`isolation: isolate`). Numbers are `z-index` inside it. The tab bar is a sibling under `main`, so the chat sheet and sheets stop at its top edge and never cover it (except under the phone keyboard, which covers it anyway).

| z | Layer | Contents | Space | Pointer |
|---|---|---|---|---|
| 0 | World art | the clubhouse scene (`ClubhouseArt`), one compositor layer | scene px, scaled by the camera | the floor (tap to walk) |
| 1 | Floor decals | area outlines (dashed), walk destination ring, tap X | scene | none |
| 2 | World props | fountain sticker, Game Time shimmer and search effects (GameTimeLayer, `worldLayer`) | scene | sticker only |
| 3 | Avatars | everyone, sorted by y (`z = 3 + y / 1000`), shadows | scene | 44 px per avatar |
| 4 | In-world labels | zone tags, area tags, name tags, door plate, speaking rings, bubbles, vibe stickers, hint chips | screen px, positioned from scene coordinates, never scaled | tags and plate |
| 5 | In-world cards | zone and area pop-up, welcome card, Hopper menu | screen px, anchored to an avatar | yes |
| 6 | HUD | Game Time banner and chips (GameTimeLayer chrome mount), sound and voice icons, "full" chip | screen | yes |
| 7 | Bottom row | chat button, action pill, camera button | screen | yes |
| 8 | Chat sheet | the sheet, its keyboard pad | screen | the sheet only |
| 9 | Modal sheets | fountain event sheet, win sheet, profile, explore, leave-the-hunt card, with a `bg-ink/60` scrim | screen | yes, scrim closes |
| (app) | Tab bar `z-30`, Toaster `z-50` | outside the room container | | |

Toaster: it sits 84 px above the screen bottom, which is right on top of the bottom row. While the room is mounted it sets `--hz-toast-lift: 64px` on `<html>` (the Toaster already reads it). In the room, feedback is in-world; toasts are only for failures (no connection, could not send).

## 3. Colour, type and the header

### 3.1 Colour: tokens only

Every colour comes from `globals.css` and `tailwind.config.ts`. They flip with the day theme on their own, so the HUD, sheets and cards are tested in both. The world viewport background stays the dark lawn (`#222A23` with the dot grid, today's `.viewport`) in both themes because it is art.

| Use | Token | Notes |
|---|---|---|
| HUD button and card face | `bg-ink-2/90` with `border-line` | no `backdrop-filter` (cheap phones; the Play HUD says the same) |
| Chat sheet | `rgb(var(--ground) / .90)` body, `bg-ink-2/95` header strip | translucent, no blur |
| Primary action | `.btn` (orange `#FF4D00`, ink label, 4 px ember lip `#B83600`) | the only filled orange on screen |
| Text | `text-cream`, secondary `text-dim` | |
| Online, speaking, live | `keke` | dots and rings only |
| Verified tick, cold hint | `lagoon` | |
| Warm hint, time warning | `danfo` | |
| Hot hint, last 10 seconds, errors | `fireant` | |
| Rewards: the ticket win, the box burst | `violet` (text) and `brand.violet` (shapes) | violet is kept for drops and rewards, per `Toaster.tsx` |
| Speech bubble, fountain sticker keyline | `brand.cream #F5EBDD` with ink text | fixed in both themes, like the map signs |
| Orange as text or border | tappable things only | nothing that is not a button is orange, except the unread count |

### 3.2 Type scale

Fonts are the app's, self-hosted (`layout.tsx`): **Poppins** 600 and 900 only (display and numbers, never below 600), **Archivo** 400, 500, 600 (everything you read; there is no 700, so emphasis is 600), **DM Mono** 400 and 500 (labels, times, counts). Sizes are screen px and stay constant at every zoom, including everything drawn in the world (section 5.4).

| Where | Font | Size / line | Case | Notes |
|---|---|---|---|---|
| Header title | Poppins 900 | 22 / 24 | as typed ("360Playlist") | never truncates, rule in 3.3 |
| Header line 2 | DM Mono 500 | 10.5 / 12, tracking .08em | caps | "12 HERE" with a 6 px `keke` dot |
| Zone tag | DM Mono 500 | 11 / 13, tracking .08em | caps | count in orange mono next to it |
| Area tag | DM Mono 500 | 10 / 12, tracking .08em | caps | |
| Name tag | DM Mono 500 | 10 / 12 | caps | was 9 px |
| Door plate | DM Mono 500 | 11 / 13, tracking .08em | caps | |
| Wall hint, small chips | DM Mono 500 | 10 / 12 | caps | |
| Zone pop-up title | Poppins 900 | 15 / 18 | as typed | |
| Zone pop-up line | Archivo 400 | 13 / 18 | sentence | `text-cream/80` |
| Pop-up action | Poppins 900 | 12 / 14, tracking .02em | caps | 36 px chip, 44 px hit |
| Action pill | Poppins 900 | 14 / 16, tracking .02em | caps | fits 190 px at most ("SEE THE DAVE NIGHT" measures 148 px) |
| Bottom row labels | DM Mono 500 | 11 / 12, tracking .08em | caps | "CHAT" measures 30 px |
| Chat sheet title | Poppins 900 | 15 / 18 | caps | "CHAT" and "12 HERE" in mono beside it |
| Chat tab | DM Mono 500 | 11 / 13, tracking .08em | caps | |
| Chat name | Archivo 600 | 13 / 16 | as typed | |
| Chat time | DM Mono 500 | 10.5 / 16 | | `text-dim`, "22:22" (`chatTime()`) |
| Chat message | Archivo 400 | 15 / 21 | sentence | never smaller than 15 |
| Chat input | Archivo 400 | 16 / 20 | | 16 so iOS does not zoom (the global input rule) |
| Speech bubble | Archivo 600 | 12 / 15 | sentence | ink on cream |
| Vibe sticker | Poppins 900 | 10 / 11 | caps | two lines at most |
| Game Time title | Poppins 900 | 13 / 15 | as typed | |
| Game Time countdown | Poppins 900, `.num` tabular | 22 / 22 | | the big number in the banner |
| Game Time label | DM Mono 500 | 10 / 12 | caps | |
| Sheet title | Poppins 900 | 22 / 24 | as typed | |
| Sheet facts | DM Mono 500 | 11 / 14 | caps | "FRI 16 OCT · 8PM" |

Minimum on screen is 10 px, and only for DM Mono caps labels on a plate. Anything a person has to read as a sentence is 13 px or more. No text is ever drawn straight on the art: it sits on an ink plate (`bg-ink/88`, `border-line`, radius 4) or a cream bubble.

### 3.3 Header (the app's own, compact)

The header is the sub-page pattern of `PageHeader.tsx` made compact, on the same material as the tab bar so the room is sandwiched between two matching bars: `bg-ink-2`, `border-b border-line`, `pad-top` for the safe area.

```
[ < ]  360Playlist (tick)                          (LOGO)
       * 12 HERE                                    (compass)
```

- Left to right: back (44 x 44, `ChevronLeft` size 26, stroke 2.2, no border, exactly like `PageHeader`), 4 px, the title block (flex-1, `min-w-0`), the logo badge at the right end.
- **Back** goes to the crew hub `/crew/<id>`. While a Game Time is live it asks first (12.3).
- **Title block**: line 1 is the name in Poppins 900 22 with the `VerifiedBadge` (size 18, lagoon) 6 px after it, on one line, no ellipsis. Line 2 is "12 HERE" in DM Mono with the green dot. When the room is full: "FULL · 60 WALKING". The name is `content.brand` ("360Playlist"). The seeded crew row and brand string still carry a space between the two words and must be renamed (20.2).
- **Never truncates.** Width budget at 360: 360 - 16 (side padding) - 44 (back) - 4 - 44 (badge) - 8 - 16 = 228 px for the title block. "360Playlist" at 22 px is 130 px and the tick adds 24, so 154 fits with 74 px spare. For other crews: fit the name by dropping the size 22, 20, 18, 16 until it fits on one line; below 16 it wraps to two lines (header grows to 68); it ellipsises only past 28 characters. 360Playlist always renders at 22.
- **Logo badge** (right end): the round crew logo (`crews.logo_url`; for 360Playlist `public/brands/360playlist.jpg`, 400 x 400, `object-cover`, `rounded-full`), 36 px visible in a 44 px target, 1 px `border-line`. A 16 px `Compass` badge sits on its lower-right corner on `bg-ink-2` with a hairline, the same trick as the Shirt badge on the Me avatar. Tap opens EXPLORE (section 10). The first visit names it (section 16) and pulses it once for 600 ms after the zoom-in. With no logo it falls back to the `FaceDisc` initial.
- No map pin, no Crews link, no chat button, no customise button in the header. The owner's CUSTOMISE lives in the crew hub (and as a row inside the EXPLORE card footer for the owner only: "ROOM SETTINGS", leaving the room).

## 4. The world and the camera

### 4.1 What the world is

The scene is `ClubhouseArt`: 960 x 640 scene px at width 30 (1152 x 640 at width 36), 32 px tiles, drawn once. Everything else (avatars, labels, stickers, effects) is drawn on top of it. The world fills the area between the two bars, edge to edge, with no controls bar, status line or side panel. The six old section chips, the "Step into the sound" panel, the status line and the MUSIC bar are gone (their jobs are in sections 5, 6 and 10).

### 4.2 Camera states

| State | Enters when | The camera | Leaves when |
|---|---|---|---|
| FULL | the room opens; the camera button while following | scale = full view scale, scene centred, nothing clipped | camera button, a tap on a tag or avatar (FLY), a walk (FOLLOW) |
| FOLLOW | after the open sequence; the camera button from FULL or FREE; any walk | my avatar at the anchor point, scale = follow scale (or my last pinch), eased | a drag or pinch (FREE), the camera button (FULL) |
| FREE | one finger drags more than 8 px, or two fingers pinch | follows the fingers, clamped to the scene, no inertia in v1 | the camera button or a tap on the floor (FOLLOW, 400 ms) |
| FLY | tap a zone tag, "WALK TO", or a "ADA VIBED YOU" chip | tween 600 to 700 ms to the target, then FOLLOW | the tween ends |

### 4.3 Camera rules

- **One transform.** The camera is a single `transform: translate3d(x, y, 0) scale(s)` on the world layer, written from a `requestAnimationFrame` loop, with `will-change: transform` set only while the camera or an avatar moves. No `left` or `top` transitions anywhere in the world (that is the main cause of today's jank).
- **Anchor.** In FOLLOW my avatar sits at 50 percent of the width and, where the scene is taller than the free height, at 58 percent of the height, so there is more room above my head for cards and bubbles than below. Where the scene fits vertically it is centred vertically and only the width scrolls: at frame A the follow view already shows the room's full height (709 of 735 px), and an avatar at the entrance stands at about y 634.
- **Free height** = the world minus the chat sheet minus the keyboard. When the sheet or keyboard changes the free height the camera re-centres over 250 ms. So I never lose my avatar behind the sheet.
- **Smoothing.** Critically damped follow with a 120 ms time constant, plus a half-tile look-ahead in the walking direction. The camera may trail the avatar by up to 1.5 tiles at full walking speed. Scale tweens interpolate in log space so a zoom feels even.
- **Clamp.** Never show more than half a tile beyond the scene. If the scene is smaller than the world at the current scale it is centred.
- **Zoom.** Minimum = full view scale, maximum = 2.2, follow scale as in 1.1. A pinch overshoots by at most 6 percent and springs back. The follow scale I pinched to is kept for the visit.
- **Pixels.** The world is drawn at `min(devicePixelRatio, 2)`; section 18.3.

### 4.4 The open sequence

`t = 0` is the first painted world frame (the snapshot is in and the scene has drawn). Before that the room shows the header, the tab bar and a dark world with the lawn dots and the line "WALKING IN" (DM Mono 11, centred); it uses the real frame so nothing jumps.

| t (ms) | What happens | Curve |
|---|---|---|
| 0 | World at FULL. The six zone tags stamp in, 40 ms apart (`animate-stamp`). People already in the room are on their tiles. The bottom row and the sound icon fade in (150 ms). A hint sits in the lower lawn band: "6 ROOMS. TAP ONE." (DM Mono 10, `text-cream/70`) | |
| 0 to 1500 | **Hold at FULL.** Tags are live: a tap on a tag flies to that room at once. A tap on the floor or an avatar skips the hold (the tap is consumed, it does not walk) | |
| 1500 | **Zoom to you.** Scale from full to follow (about 2.8x at frame A) while the centre travels to the anchor on my avatar at the entrance. 900 ms. The hint fades (200 ms). Tags cross-fade to their follow-zoom form (300 ms) | `cubic-bezier(.45, 0, .2, 1)` |
| 2400 | Arrived. A ring pulses once under my feet (600 ms) and the "You" tag shows for 2 s. The logo badge pulses once (first open of the session). First visit only: the welcome card pops at 2600 (section 16) | stamp |

- Skip: any tap during the hold shortens it to 0 and plays the tween in 500 ms.
- Later opens in the same session (same room, `sessionStorage`, in `try/catch`): hold 900 ms, same tween.
- `prefers-reduced-motion`: no hold, no tween, no stamp. The room opens in FOLLOW. The first-visit card adds "Tap the arrows button to see every room."
- Low-tier phones (`deviceTier() === "low"`): tween 600 ms, tags appear without the stamp.
- If the room is full (watching) the sequence stops after the hold and stays at FULL (4.7).

### 4.5 Input

- `touch-action: none` on the world. Pointer events. One pointer: tap (moved at most 8 px and shorter than 300 ms) or pan. Two pointers: pinch about their midpoint.
- Tap on: a tag (walk there), an avatar at scale 0.6 or more (menu), the sticker or door plate (their action), anything else (walk).
- Under scale 0.6 an avatar is about 15 x 24 px, too small to pick. A tap on an avatar there flies to them instead of opening a menu (FLY, then the next tap opens the menu).
- Desktop: wheel zooms about the cursor, arrow keys and WASD walk, drag pans. There is no on-screen D-pad on touch. Keys do nothing while an input has focus (today's rule).
- No double-tap in v1.

### 4.6 Walking feel and feedback

- Walk speed stays 85 ms per tile (`step` in `CampaignWorld.tsx`). The camera smoothing hides how fast that is.
- **Tap snapping.** A tap on a wall or furniture tile walks to the nearest walkable tile within 1 tile of the tap (closest to the tap point first). Fingers are 40 to 50 px and a tile is 35 px; without this half the taps would bump.
- **Destination ring.** 22 px, 2 px cream stroke, pulses once (scale .8 to 1.2 in 450 ms), stays until I arrive, fades in 150 ms. It replaces the dashed square.
- **Wall bump** (no tile within 1 of the tap is walkable): my avatar nudges 3 px toward the tap and back in 120 ms, an X (14 px, 2 px cream) draws at the tap point and fades in 600 ms, the hint "NOT THAT WAY" shows for 1 s beside it, `sfx.knock()` plays and `haptics.buzz("refused")` fires. One hint at a time; a new tap moves it. This is the only feedback. There is no status line.
- A tap during a walk re-targets at once (today's behaviour).
- A screen-reader line: a visually hidden `role="status"` region still announces "You are in the Courtyard" and "Walking". The visible status line is gone, the announcement is not.

### 4.7 Watching a full room

When capacity is reached the Hopper watches: no avatar, FULL camera only (pinch and drag allowed, no follow, no camera button). One chip at the top of the hint slot: "FULL. WATCHING. YOU WALK IN WHEN A SPOT OPENS." (two lines at 360, `danfo` dot). Chat (General) works, the sticker and the door work without walking, SEARCH is not offered. When a spot opens the chip turns to "YOU'RE IN" for 2 s and the open sequence runs from FULL.

## 5. Labels and pop-ups in the world

### 5.1 Zone tags (replace the numbered chips and the numbered markers)

- Text: the zone name in caps without a leading "THE": LISTENING STUDIO, 360 STAGE, AWARDS GALLERY, COURTYARD, RECORD LOUNGE, ARTIST CORNER. Plate `bg-ink/88`, `border-line`, radius 4, height 26, padding 0 8, DM Mono 11. Widest is 120 px of text (136 px plate). Any name wider than 100 px wraps to two lines (LISTENING STUDIO, AWARDS GALLERY), so no plate is wider than about 112 px.
- A count of people in the zone (any tile inside the zone rectangle, me included) follows in orange mono: "360 STAGE 3". Zero shows no number. The count is the reason to look: it tells you where the room is busy.
- Anchor: the zone's `plaque` tile, 12 px above it. Clamp the plate inside the world with 4 px margins, so the left room's tag never clips at 390 or 360.
- **LOD.** Under scale 0.6 (FULL): all six, full opacity. At 0.6 and above: only tags whose anchor is on screen, at 70 percent opacity, and never the zone I stand in (its card says it). Never more than 3.
- **Tap** = walk to that zone's `stop` tile with the camera FLYing, and the zone card shows on arrival. This replaces the six chips. Target 44 px (invisible `::before`).
- The baked plaque text in the art (LISTENING STUDIO, AWARDS GALLERY, RECORD LOUNGE, ARTIST CORNER) is removed from `ClubhouseArt`: two labels for one room is noise. "GOOD MUSIC. GOOD COMPANY." stays as floor decor.

### 5.2 Area tags

Four conversation areas (booth-1, booth-2, courtyard-corner, lounge-table): a dashed 2 px outline on the floor (scene, `#F47945` at .7, as today) and a tag at its top-left corner, visible from scale 0.9: `MessageCircle` 12 px plus "COURTYARD CORNER" in DM Mono 10. When I am inside, the tag turns cream-faced with the count: "COURTYARD CORNER · 2". Tap = walk into the area (`areaArrival`, as today). The small chat-bubble buttons at each area corner are removed.

### 5.3 Name tags

Mine is always "You". Others show within 8 tiles of me or of the camera centre, nearest first, at most 12, only at scale 0.6 and above. 6 px under the feet, DM Mono 10 on an ink plate. Away (25 s without a heartbeat, today's rule): "ADA · AWAY" at 60 percent opacity.

### 5.4 How labels stay readable at every zoom

Labels are DOM elements in a label layer (z 4) that is a sibling of the scaled world, not a child. Each label has a scene anchor `(ax, ay)`. The camera loop writes `--cx`, `--cy` and `--s` on the label layer once per frame, and each label sits at `translate3d((ax - cx) * s, (ay - cy) * s, 0)`, so it follows the world and stays the same size on screen. React does not re-render per frame. There are never more than 40 label nodes (6 zone tags, 4 area tags, 12 name tags, the door plate, bubbles, stickers).

### 5.5 The pop-up system

| Element | Trigger | Anchor | Lives | Max at once | Replace rule | Layer | Motion |
|---|---|---|---|---|---|---|---|
| Zone or area card | 500 ms inside a zone or area, or a tap on its tag | over my head, follows me | 3 s (5 s with an action), tap to dismiss, gone when I leave | 1 (the "card" slot) | crossfade 120 ms; same zone not again for 60 s unless tapped | 5 | stamp-in .18 s |
| Welcome card | first visit, after the zoom | over my head | 8 s or GOT IT | 1 (card slot) | blocks zone cards for 6 s | 5 | stamp |
| Hopper menu | tap an avatar at scale 0.6 or more | over that avatar | until a choice, an outside tap, a walk, or 8 s idle | 1 | opening another closes it | 5 | stamp |
| Hint chip | wall bump; waves; "ADA VIBED YOU" | the tap point, or my head | 1 s (bump), 2.5 s (social), 6 s (WAVE BACK) | 1 (the "hint" slot) | replace | 4 | fade 120 ms |
| Speech bubble | a new message | the speaker's head | 2.5 s + 40 ms per character, 6 s max | 3 | oldest dropped; one per speaker | 4 | fade-in 100 ms |
| Vibe sticker | a vibe sent or received | the sender's head | 3 s | 3, and 2 per head | stacks up 52 px | 4 | stamp .18 s, rise 8 px on exit |
| Game Time hint | a search result | the searched object | 2.5 s | 1 | replace | 4 | stamp |
| Game Time feed chip | someone found a box | under the banner | 2.5 s | 2 | 3 in 5 s become "3 BOXES FOUND. 4 LEFT." | 6 | slide 8 px + fade |
| Speaking ring | someone you can hear talks | their feet | while talking + 300 ms | 8 | nearest first | 4 | pulse |

Hard cap: 8 transient elements on screen at once (tags and the destination ring do not count). A ninth evicts the oldest of the lowest priority. Priority, high to low: Game Time, Hopper menu, card, hint, feed chip, bubble, sticker.

Suppression: no zone cards in the 10 seconds before a Game Time opens or while a sheet is up; no bubbles under scale 0.6 (FULL); every transient clears when a modal sheet opens.

### 5.6 The zone and area card

```
+------------------------------+
| The 360 Stage                |   Poppins 900 15 / 18
| Mic is open. Say it loud.    |   Archivo 400 13 / 18, 2 lines max
| [ SEE NEXT NIGHT  > ]        |   optional: one action, 36 px chip, 44 px hit
+---------------v--------------+
```

- 264 px wide (248 at 360, never wider than the world minus 32), 8 px padding, `bg-ink-2/95`, `border-line`, radius 6 (`rounded-hz`), `shadow-sheet`, an 8 px tail.
- Height 62 without an action, 104 with one. Bottom centre sits 12 px above my head (66 px sprite at follow scale), clamped inside the world with 8 px margins, flipping below me when there is no room above. It follows me while it lives.
- Copy for every zone is in section 19. The old long text (the awards list, the artist story, the next night) opens only from the card's action, as a sheet in the style of section 11.3. Nothing long ever shows by itself.
- Private areas get a smaller card: the area name, "Chat here stays here. 2 inside." with a 12 px `Lock`, no action. Entering an area also makes the Area tab appear in the chat sheet (9.2), plays `sfx.hotspot()` and `haptics.buzz("hotspot")`.

## 6. The bottom row, the HUD icons and sound

### 6.1 The bottom row

One row, 12 px above the tab bar, 48 px tall, 12 px side margins (frame A: y 675 to 723 of the world). Three slots.

| Slot | Idle | While an action pill shows |
|---|---|---|
| Left | **CHAT** pill: `MessageCircle` 18 + "CHAT" + unread count. 44 high, 88 wide, `bg-ink-2/90`, `border-line`, `rounded-hz` | collapses to the icon only, 44 x 44, count badge stays |
| Centre | empty | the **action pill** (section 7), width = row width minus the two side slots minus 16 |
| Right | **Camera** button, 44 x 44, `bg-ink-2/90`, icon only | unchanged |

- **Unread count**: a 16 px orange circle with an ink DM Mono 10 number at the top-right of the CHAT pill, "9+" above nine. It counts General messages from others that I have not seen (sheet closed, or scrolled up), and the Area tab keeps its own dot. Opening the sheet at the bottom clears it.
- **Camera button.** In FOLLOW it shows `Maximize2` and a tap goes to FULL (600 ms). In FULL or FREE it shows `LocateFixed` (the crosshair the map already uses for "where am I") and a tap goes back to me (FOLLOW, 600 ms). Icon only, so the first tap shows a 1 s label above it: "FULL VIEW" or "BACK TO ME" (DM Mono 10 on a plate). The first-visit card names it too.
- At 360 the row is: CHAT pill (88) + gap + camera (44) when idle; with a pill: 44 + 8 + pill 232 + 8 + 44. "SEE THE DAVE NIGHT" needs 206, so it fits at 360 with 26 px to spare.
- While the chat sheet is open (peek or half) the row rides up with the sheet's top edge (12 px above it) and the CHAT button is hidden, because the sheet is the chat. At full the row is hidden.

### 6.2 HUD icons (top right of the world)

- **Sound**: 36 px visible `bg-ink-2/90` square, 44 px hit, 8 px from the top and right of the world. Icon `Volume2` when the music is on and sound is not muted, `VolumeX` otherwise (the same two switches as today's `MusicSwitch`: `music.setOn` and `sfx` mute). `aria-pressed`, label "Music". The word "MUSIC ON" and the whole bar are gone.
- **Mic** (only when voice is on, section 14): under the sound icon, same size.
- Game Time's banner lives at the top left of the world and leaves this column free (section 13).

## 7. The action pill

When I stand next to something usable, one thumb-sized pill appears in the bottom row. Walking alone never navigates away: a pill needs a press.

### 7.1 Look

The app's lip button (`.btn`) with full rounding: orange face `#FF4D00`, ink label, Poppins 900 14 caps, 4 px ember lip, `radius 24`, height 48, side padding 20, icon 18 plus 8 px gap. It sinks 4 px on press. It enters with the stamp (`animate-stamp`, .18 s) and leaves with a 120 ms fade. If the label does not fit the available width it steps down 14, 13, 12 px; it never truncates.

### 7.2 The registry (what Game Time uses)

The room store (`src/lib/crew-room/roomStore.ts`) gets two calls. Game Time's world mount and the room itself use the same two.

```ts
type RoomAction = {
  id: string;             // "gt-search", "go-live", "exit", "event"
  label: string;          // "SEARCH"
  icon: "search" | "door" | "ticket" | "mic";
  priority: number;       // higher wins
  onPress: () => void;
  cooldownUntil?: number; // ms timestamp: shows the ring and disables the press
};
setAction(action: RoomAction): void   // add or replace by id
clearAction(id: string): void
```

- Exactly one pill shows: the highest `priority`, ties to the most recently set. Others wait and come back when the winner clears.
- Priorities: `gt-search` 100 (Game Time wins), `go-live` 60, `exit` 40, `event` 30.
- Range: orthogonal contact only (a tile that shares an edge with the object's rectangle, no diagonals) for `exit` and `event`; `go-live` shows anywhere inside the 360 Stage zone. Game Time keeps the server's own rule, within one tile with diagonals (`game_time.sql`), because the server decides. Appear after I have stood still 250 ms in range, or at once if my walk's destination is in range. Disappear when I am 2 tiles away (hysteresis, so it does not flicker).
- The door is orthogonal-only on purpose: the spawn tile (15, 17) is diagonal to the door at (13 to 14, 16), so nobody is greeted by EXIT TO MAP the moment they arrive.
- Only the owner gets `go-live`, and only on the stage.

### 7.3 The pills

| Pill | Where | Icon | Label | Press |
|---|---|---|---|---|
| Event | next to the fountain | `Ticket` | SEE THE DAVE NIGHT | opens the fountain sheet (11.3) |
| Exit | next to the door | `DoorOpen` | EXIT TO MAP | goes to `/` (asks first while a Game Time is live) |
| Search | next to a Game Time object | `Search` | SEARCH | one search (13.4) |
| Go live | owner, on the stage | `Mic` | GO LIVE (END LIVE while live) | starts the stage voice (14.4). With stage voice on: staff on the stage, SPEAK TO ALL |

The event label is `SEE THE <HEADLINE> NIGHT`, where HEADLINE is the text before the first ":" of `eventTitle(event)` in caps, so "LEAD · DAVE: The Boy Who Played the Harp" gives DAVE. If it is longer than 14 characters or has no colon the label is "SEE THE EVENT".

Search is bigger than the others: height 56, minimum width 168, because it is the Friday button. While a search is cooling down (the server's 3 s gap) it shows a ring sweeping once round the pill border in 3000 ms and the face dims to `bg-ink-3` with `text-dim` (the `.btn:disabled` look).

## 8. Tap a Hopper

Tapping another avatar (at scale 0.6 or more; under that, the tap flies to them, 4.5) opens a small menu on them. It is a card in the world (layer 5), not a sheet: the game stays visible and alive around it.

### 8.1 The menu

```
+--------------------------------------+
| (A) ADA          AT THE COURTYARD    |   name Archivo 600 14, place DM Mono 10 dim
| VIBE                                 |   DM Mono 10 dim; shows the sticker name while pressed
| [s1] [s2] [s3] [s4] [s5]             |   five drawn stickers, 44 x 44 each, 6 px apart
| [SAY HI] [WALK TO] [PROFILE]         |   44 high; SAY HI is the orange .btn, the others ghost
+-------------------v------------------+
```

- 280 x 160. 8 px padding. `bg-ink-2/95`, `border-line`, radius 6, `shadow-sheet`. Header row 32 (a `FaceDisc` 28, the name, the zone name: "AT THE COURTYARD"), label row 14, stickers 44, buttons 44, gaps 4, 6, 6.
- Anchor: centred over the person, 10 px above their head plus an 8 px tail; the card clamps inside the world (8 px margin) and the tail slides along the bottom edge to keep pointing at them; flips below if there is no room above.
- Closes on: a choice, a tap outside, the moment I start walking, 8 s idle, opening a sheet.
- **VIBE** is the sticker row. Press a chip to preview (the label row shows its name), release on it to send, slide off to cancel. Five stickers for Friday, drawn SVG, no emoji, with the street names from `docs/PLAY-MODE.md` (Jae signs off the set): WE OUTSIDE (a danfo front), BIG VIBES (a speaker with waves), OMO (wide eyes), FRESH (a sparkle), NO WAHALA (an open palm). Ten later.
- **SAY HI** is the existing wave: `wave(key)` in `src/lib/chat.ts` (`send_wave`): wave first, and a DM opens when it is mutual. Greyed to "WAVED" after one.
- **WALK TO**: I walk to a tile next to them and the camera follows. Not offered when watching.
- **PROFILE**: opens the existing `PersonCard` as a modal sheet (face, name, WAVE, ADD TO CREW, Block, Report with its reasons). It is where block and report live.
- Tapping myself does nothing in v1 (no self menu, nothing that tells people to tap their avatar: Play is being removed, `docs/COPY-AUDIT.md`).

### 8.2 What each person sees

| Action | I see | They see | Others nearby see |
|---|---|---|---|
| VIBE | my sticker over my own head for 3 s, `sfx.vibe()`, `haptics.buzz("pick")` | the sticker over my head with a small "TO YOU" plate, a pulse ring at my feet, `sfx.vibe()`, `haptics.buzz("wave")`. If I am off their screen: a hint chip "ADA VIBED YOU" (tap = FLY to me) | the sticker over my head if they are within 8 tiles of me |
| SAY HI | hint chip "WAVED AT ADA" for 1.5 s | hint chip "ADA WAVED AT YOU" with a WAVE BACK button for 6 s, `sfx.wave()`, `haptics.buzz("wave")` | nothing (waves are private) |
| SAY HI, mutual | chip "YOU BOTH WAVED. SAY HI" with OPEN DM (leaves the room, `/chat/dm/<id>`, never automatic) | the same | nothing |
| WALK TO | I walk, camera follows | nothing (nobody is told someone is coming) | nothing |

iPhone Safari cannot vibrate (`haptics.ts`), so every buzz above has a sound and a picture beside it.

### 8.3 No spam

- **Vibes, sender**: 1 every 3 seconds (the chips show a thin ring counting down), 3 a minute to the same person (then the label row says "GIVE THEM A MINUTE"), 12 a minute in all, 100 an hour.
- **Vibes, receiver**: at most 5 arrive a minute and 30 an hour; extras are dropped on the server and the sender still sees "sent" (a block or a mute is never revealed). A "Mute vibes" switch in Me, Settings. A blocked pair never see each other's vibes or waves.
- **Waves**: the server's rules stand (`send_wave`: once per person, 30 a day, "slow_down" past that).
- A vibe is a sticker id and nothing else, never text. It is delivered to the target and to people within 8 tiles of the sender, not to the whole room: that bounds traffic and noise at 60 people.
- Watchers cannot vibe or wave (they have no avatar).

## 9. Chat that keeps you in the game

### 9.1 The sheet: states and sizes

A translucent sheet rises over the lower part of the world, inside the room container, always stopping at the top of the tab bar. The room keeps moving above it: avatars walk, bubbles pop, the sticker bobs.

| State | Height (A, world 735) | C (691) | E (558) | World left above | Shows |
|---|---|---|---|---|---|
| CLOSED | 0 | 0 | 0 | all | the CHAT pill in the bottom row |
| PEEK | 156 (192 in an area) | 156 / 192 | 156 / 192 | 579 | grab handle (24), the last 2 messages (76), the composer (56); in an area add the 36 px tab strip |
| HALF | 338 | 318 | 280 | 397 | header strip 44, tab strip 36 in an area, messages, composer 56 |
| FULL | 603 | 559 | 426 | 132 | the same, as many messages as fit; the world is a 132 px strip with my avatar in it |

- HALF = `clamp(280, 0.46 * worldHeight, 420)`. FULL = `worldHeight - 132`. PEEK = 156.
- The CHAT pill opens HALF. `?chat=1` (from the crew hub's chat preview) opens HALF. Pull down once: PEEK. Again: CLOSED. Pull up from HALF: FULL.
- The camera re-centres on my avatar in the part of the world above the sheet (4.3). My avatar is never behind it.
- The bottom row rides on top of the sheet (12 px above its edge), minus the CHAT pill; at FULL the row hides.

### 9.2 Tabs: General first, Area only inside an area

- General is the default and the only conversation unless I am inside one of the four conversation areas.
- Inside an area a 36 px tab strip appears under the header: `[GENERAL] [COURTYARD CORNER · 2]` in the app's `.chip` style (selected = solid orange with an ink label, DM Mono 11). The Area chip gets a 6 px orange dot for unread. Entering an area does not steal the tab: the sheet stays on General unless it was already on an area tab, and the area card (5.6) tells me chat is there.
- Leaving the area while the Area tab is open: the sheet returns to General and shows one dim mono line for 3 s, "You left COURTYARD CORNER. Back to General." The area draft is kept (`drafts.ts` does that today).
- No tab strip, no helper sentence and no list of areas when I am not in one. Areas are joined by walking in; their tags are in the world.

### 9.3 Gestures

- Drag the top 44 px (handle and header) with a finger: the sheet follows it. On release it snaps to the nearest state; a flick faster than 0.5 px/ms goes one state in its direction, and a fast flick down from HALF closes.
- Pull-to-close from the list: when the list is scrolled to the top and the drag goes down, the sheet drags (the iOS sheet feel). `overscroll-behavior: contain` on the list.
- A chevron-down button (44 x 44) in the header strip collapses one state. Escape closes on desktop. The hardware back button closes the sheet before it leaves the room.
- Tapping the world above the sheet behaves as normal (walk, tap an avatar), except that with the keyboard open the first tap only closes the keyboard. The sheet is a layer, not a mode.

### 9.4 Message layout (name, time, message at a size you can read)

```
[ face 28 ]  ADA  22:22
             hey i'm here, anyone at the stage?
```

- Flat lines, not bubbles: more messages in a short sheet. Face: `ChatFace` 28 px. Gap 10. Row padding 6 x 12. Line 1: name Archivo 600 13 / 16 cream, 8 px, time DM Mono 500 10.5 dim. Message Archivo 400 15 / 21 cream, full text, no truncation (400 characters is the limit). Text column 328 px wide at 390.
- Grouping: the same person within 2 minutes drops the face and name; the text indents 38 px; the time shows on tap.
- My rows: a `bg-ink-3` tint, `rounded-hz`, name "You". Others have no background. Nothing in chat is orange except the unread count and the selected tab, because chat lines are not buttons (the rule `Bubble.tsx` already states).
- Day dividers on a date change: "TODAY", "FRI 16 OCT", DM Mono 10 centred.
- Sending: 60 percent opacity and a 12 px `Clock` where the time goes. Failed: "TAP TO RETRY" in `fireant`.
- Loading: three `bg-ink-3` skeleton rows with `animate-pulse2`. "Earlier messages": a 36 px ghost chip at the top of the list (`room.loadEarlier`).
- Scrolling: stick to the bottom when within 80 px of it; if I have scrolled up, a "3 NEW" orange chip (36 high) floats above the composer and jumps down on tap.
- Reading budget at frame A, HALF: 338 - 44 - 56 = 238 px of messages, which is 5 or 6 lines. Today at the same phone: 172 px, 2 messages.

### 9.5 Tap a message to react or reply

A tap on a line slides an action bar in under it (44 high, `bg-ink-2`, hairline, radius 6, 120 ms): four reaction buttons (`Heart`, `Flame`, `Laugh`, `PartyPopper`, 44 x 44, each with an `aria-label`), then REPLY (`CornerUpLeft`, DM Mono 11), then WALK TO (only for a person who is in the room, and not while I am watching: it flies the camera to them). Any other tap or a scroll closes it.

- Reactions show under the message as 24 px chips ("[Heart 3]", DM Mono 11); tapping mine again removes it.
- REPLY puts a "REPLYING TO ADA" chip (with an X) above the composer and starts the message with "@Ada ". It needs no new table. A real reply link is later.
- Reactions need a small table, which is not in the schema yet (section 20). Friday cut line: ship REPLY and WALK TO; if the reactions table is not ready, hide the four reaction buttons rather than show dead ones.

### 9.6 The composer and the keyboard

- 56 px row: the input (44 high, flex, the global input style, 16 px text) and SEND (44 x 44, the orange `.btn` with a `SendHorizontal` icon and the label "Send" for screen readers; greyed while empty).
- **It always works.** Placeholder: "Say something to everyone", or "Say something in COURTYARD CORNER". Never "Choose an area above", never disabled. Offline, the message stays in the list as pending and goes out when the connection returns, for up to 30 s, then shows "TAP TO RETRY". A quiet line "Reconnecting. Your draft is kept." shows only while offline.
- `enterkeyhint="send"`, `autocomplete="off"`, `maxLength` 400. Enter sends and keeps focus so chat flows.
- **The keyboard never covers it.** The sheet's bottom follows `visualViewport` (iOS) or the resized viewport (Android): `bottom = max(0, keyboardHeight - tabBarHeight)`. The composer is always fully above the keyboard. Focusing the input lifts PEEK to HALF; HALF and FULL stay. The camera's free height shrinks with it. Use `dvh` units, never `position: fixed` inside the world, and keep the page from scrolling.

### 9.7 Look and motion

- Body `rgb(var(--ground) / .90)`, header strip `bg-ink-2/95`, 1 px `border-line` top edge, radius 12 on the top corners (as `Sheet.tsx`), `shadow-sheet`, a 12 px fade on the oldest visible line. **No `backdrop-filter`**: a cheap phone cannot pay for it, and 90 percent already lets the room ghost through while keeping the text sharp.
- Opening uses the app's `animate-rise` (`.22s cubic-bezier(.2,.8,.2,1)` plus the violet misregistration ghost). The camera re-centres in the same 250 ms. Reduced motion: no slide, the sheet is just there.
- Grab handle 36 x 4, `bg-line`, 8 px from the top.

### 9.8 Speech bubbles over avatars

New messages also pop over the speaker's head (Gather style) so people see talk without opening chat.

- Look: the map sign's face: cream `#F5EBDD`, ink text Archivo 600 12 / 15, padding 5 x 8, radius 6, 2 px ember lip below (`#B83600`, the `hz-face` shadow), a 6 px tail to the head. Max width 156, two lines, cut with an ellipsis at 60 characters. Area messages carry a 10 px `Lock` on the left.
- Which: messages that arrive after I opened the room (never history), from people inside the viewport, at scale 0.6 or more. General bubbles for everyone; area bubbles only for people in my area (they are the only ones who receive them).
- Timing and limits: shown 2.5 s + 40 ms per character, 6 s at most; one bubble per speaker (a new message replaces it); at most 3 on screen; a queue of 2 for up to 2 s, then dropped. Order of preference: me, my area, nearest to me. Two bubbles that would overlap: the later one moves up by its height plus 4 px (at most twice).
- My own messages bubble too (feedback).
- They are `aria-hidden`: chat is the accessible record.

### 9.9 Empty and first states

General, empty: "Welcome to 360Playlist's community center. Say hi." Area, empty: "Only people in here get this chat." The first visit also shows the welcome card in the world (section 16).

## 10. Explore: other crews and this week's nights

**Where it lives: a pop-up from the logo badge at the right end of the header.** It costs no world space, it is one tap from anywhere, and it matches the crew hub's "Explore from here". Why not a tab in the chat sheet: chat is for talking to people who are here; Explore is for leaving, and mixing the two puts a "go away" button in the middle of a conversation.

- **Open.** Tap the logo badge (the Compass mark says what it is). A popover drops from the badge: width `min(340, W - 16)`, max height `min(60% of the world, 440)`, `bg-ink-2`, `border-line`, radius 6, `shadow-sheet`, an arrow to the badge, a transparent scrim that closes it on any outside tap. It opens with the stamp. Layer 9.
- **Two tabs** in the `.chip` style: OTHER CREWS and THIS WEEK.
- **OTHER CREWS**: rows of 60 px: crew logo or `FaceDisc` 40, name Archivo 600 15 with the lagoon tick for verified crews, "12 IN THE CREW" in DM Mono 10.5 dim, a chevron. Up to 8, verified first (the data is `room_rails(crew).crews`). Tap opens `/crew/<id>`.
- **THIS WEEK**: rows of 64 px: flyer thumbnail 40 x 52 (radius 4), title Archivo 600 14 (two lines), "FRI 16 OCT · 142 GOING" in mono, a chevron. Up to 8 (`room_rails(crew).trending`, ranked by people going plus check-ins). Tap opens the map on that night, `/?e=<event id>`.
- **Data**: one `room_rails(p_crew)` read the first time the popover opens, not when the room opens (it saves mobile data for everyone who never taps), cached 5 minutes. Loading: three `bg-ink-3` skeleton rows. Error: "Couldn't load." and a RETRY chip. Empty: "No other crews on the block yet." and "Nothing big this week yet. Check the map."
- **Leaving.** Rows navigate away on tap. While a Game Time is live they ask "Leave the hunt?" first (12.3).
- **Owner only**: a footer row, "ROOM SETTINGS" with `Settings2`, that opens the owner's settings on the crew page. The header no longer carries a Customise button.
- **Finding it**: the Compass badge, one pulse after the first zoom of each session, and the welcome coach mark (section 16).

## 11. The fountain sticker

The featured event, stuck on the courtyard fountain. Today's room has a plain fountain and an unexplained pin.

### 11.1 Look

- A flyer card centred on the fountain (`courtyard-fountain`, tiles 14 to 15 by 9 to 10; centre scene px (480, 320) at width 30, `x + 3 tiles` at width 36). **3.5 tiles wide** (112 scene px). Height follows the flyer's aspect, clamped to 0.72 to 1.0 of the width (112 to 155 px). The card is centred on the fountain, so a portrait flyer covers scene y 242 to 397 (tiles 7.6 to 12.4) and its ribbon lands on the path just south of the fountain.
- Flyer: `events.flyer_url`, rounded 6, **3 px cream keyline** (`#F5EBDD`, fixed in both themes), tilted **-3 degrees**, a hard shadow 3 px right and 4 px down in the scene's own shadow colour (`#181B21` at .35), matching the art's lower-right light.
- Ribbon: owner-typed, `crew_rooms.featured_ribbon` (at most 14 characters, "FREE" for 360Playlist). A strip under the flyer, 20 px tall, 10 px wider than the flyer on each side, orange `#FF4D00`, Poppins 900 caps in ink, tracking .06em, a 2 px ember lip, rotated +2 degrees against the flyer so it looks hand-stuck. The text auto-fits down to 9 px so 14 characters fit. **The ribbon is never derived from price or time.** Empty ribbon, no ribbon.
- Scene-scaled (it is part of the art), not counter-scaled. At FULL it is a 44 x 60 px thumbnail with an orange blob: that is the point, it is the room's magnet. Its hit area is at least 44 x 44 on screen whatever the zoom.
- **Under avatars, never solid.** Layer 2. Walkers pass over it. It does not change the walkable grid and the fountain stays solid underneath.
- Idle: a 3 px bob over 3.2 s (`ease-in-out`, `transform` only) and a 600 ms shine sweep every 7 s. Reduced motion: none.
- No featured event (`featured_event_id` null), or the event has ended (`dayLabel()` returns "ENDED"), or the template has no fountain: no sticker.
- Flyer image: 224 px wide WebP at most (about 40 KB), lazy, with the cream card and the title in Poppins as the fallback while it loads or if it fails.

### 11.2 Behaviour

- Tap the sticker (from anywhere in view) opens the sheet below. No walking needed, because it only informs.
- Standing next to the fountain shows the event pill (section 7). Walking past shows nothing until I stand still 250 ms.
- Nothing about the sticker changes by Game Time state.

### 11.3 The event sheet (in-room, over the world)

A modal sheet (layer 9) rising from the bottom of the world with the `Sheet.tsx` look: `bg-ink-2`, hairline top, radius 12, the grab handle, a 44 px close X, a `bg-ink/60` scrim, `animate-rise`. Max height 85 percent of the world; the world stays visible above it.

```
+----------------------------------------+
|                 ====                [X]|
|             +----------+               |   flyer, centred, object-contain, radius 6,
|             |  FLYER   |               |   at most 46 percent of the sheet height
|             +==[ FREE ]=+              |   the same ribbon, overlapping its lower edge
| FRI 16 OCT · 8PM                       |   DM Mono 11, tracking .08em (dayLabel + clock)
| DAVE: The Boy Who Played the Harp      |   Poppins 900 22 / 24, two lines
| Wole Soyinka Centre (National Theatre) |   Archivo 400 14 / 20, dim
| [          OPEN ON MAP           ]     |   the orange .btn, full width
+----------------------------------------+
```

- OPEN ON MAP goes to `/?e=<event id>`. **While a Game Time is live** (`roomStore.huntActive`) it first swaps the button area for the leave card: "Leave the hunt?", "The clock keeps running. You can walk back in.", STAY (ghost) and OPEN ON MAP (orange).
- Title is `eventTitle(event)`; the day is `dayLabel(starts_at)` plus `clockShort`. No price anywhere (the ribbon is the owner's words, and the event's own page has the price).
- Close: X, scrim, swipe down. The sheet never opens over a running walk: walking stops while it is up.

## 12. The exit door

The prop `entry-map-table` stays where it is and keeps its id. What changes is how it reads and when it works.

### 12.1 Look

- The unexplained map-pin card is removed.
- A plate hangs one tile above the table's top edge, counter-scaled (section 5.4): ink face `bg-ink`, cream text, `DoorOpen` 12 px plus "EXIT TO MAP" in DM Mono 11 caps, height 28, a 2 px ember lip underneath (the map sign's look). It is readable at every zoom.
- In range the plate turns into the pill's twin: orange face, ink text. That is the "tap me" signal, in the app's own colour logic.
- The welcome mat in the art reads **WELCOME TO 360PLAYLIST**: the mat plate widens from 132 to 192 px (6 tiles, exactly between the two entry planters) and the text is 10 px mono, tracking 1.5.
- The banner in the art reads **360PLAYLIST** (it is `brand.toUpperCase()` already; the seeded brand string has a space and must be fixed, section 20).

### 12.2 Behaviour

- **Walking never exits.** Not onto the table, not past the door.
- Tap the plate when I am not next to the door: I walk to the tile in front of it, and the EXIT TO MAP pill appears. Nothing navigates.
- Tap the plate when I am already next to it, or press the pill: go to `/`.
- Watching a full room: no walk; tapping the plate goes straight to `/`.
- The spawn tile is diagonal to the door, so nobody lands inside the pill's range (7.2).

### 12.3 "Leave the hunt?"

While `roomStore.huntActive` is true, every way out asks once: the door, the pill, the header back arrow, the Explore rows, OPEN ON MAP on the event sheet, and the tab bar tabs other than CREW. The card is centred, 300 px wide, `bg-ink-2`, hairline, radius 6, with a `bg-ink/60` scrim: "Leave the hunt?" (Poppins 900 18), "The clock keeps running. You can walk back in." (Archivo 14 dim), STAY (`btn-ghost`) and LEAVE (`.btn`). STAY is the default focus. The tab bar needs a small change for this (section 20).

## 13. Game Time HUD (for whoever builds the box hunt)

Game Time is the Friday event: staff hide 1 to 10 ticket boxes in the room's objects; members walk next to an object and SEARCH; the first finder of a box wins its code (`supabase/game_time.sql`). Its slot in the room is `GameTimeLayer`, mounted twice: a **world layer** (scene pixels, lines up with tiles) and a **chrome layer** (screen pixels). This section says what each draws and how it must behave so it feels like the rest of the room. It never owns the screen: the world stays visible and alive under all of it.

### 13.1 Phases and what shows

| Phase (from `game_time_state`) | Banner (chrome) | World | Pill |
|---|---|---|---|
| none (`game` null) | none | nothing | none |
| UPCOMING (`status: upcoming`, from `game_time_list` within 6 h) | teaser: "GAME TIME", the title, the countdown to opening | nothing | none |
| LAST 10 SECONDS before `opens_at` | the hype moment (13.7) | dimmed 20 percent | none |
| LIVE and I can search (`me.can_search`) | live banner: label, title, countdown to `closes_at`, boxes left | every `objects` entry shimmers | SEARCH when in range |
| I WON (`me.won`) | "YOU GOT IT. WATCH THE REST." muted | no shimmer for me | none |
| OVER (`over_reason`: `all_found`, `time_up`, `closed`) | "ALL FOUND", "TIME UP" or "CLOSED" plus "10 FOUND", for 10 s, then it folds away | no shimmer | none |
| WATCHING, or not a member | read-only banner | no shimmer | none |
| ROOM CHANGED (`room_ok` false) | "GAME TIME PAUSED" | nothing | none |

### 13.2 The banner

Top left of the world: x 8, y 8, width `W - 16 - 52` (322 at frame A, 292 at C; the 52 px on the right keeps the sound and mic icons clear), radius 6, `bg-ink-2/92`, `border-line`, layer 6.

```
+----------------------------------------+
| * GAME TIME                       04:21|   label DM Mono 10 (keke dot, 1.6 s pulse); countdown Poppins 900 22
| Dave ticket drop                       |   title Poppins 900 13, one line, ellipsis past 28 characters
| [#][#][#][#][#][#][#][ ][ ][ ]  7 LEFT |   pips (8 x 8, 3 apart) and DM Mono 10
+----------------------------------------+
```

- Live height 60. UPCOMING height 44 (label, title, and "OPENS IN 12:41" on the right; over an hour it reads "2:14:09").
- Countdown: cream above 60 s, `danfo` at 60 s or less, `fireant` and a 1 Hz pulse at 10 s or less. It is computed from `server_now` (clock-skew safe), never from the phone's clock.
- Pips show boxes left filled (cream) and found hollow (`border-line`). Past 10 boxes it shows "7 / 12 LEFT" as text.
- Under 10 minutes before opening the UPCOMING banner border turns `danfo` and the label becomes "STARTING SOON".

### 13.3 Shimmer (the world layer)

- Every id in `objects` (the eligible props: shimmer means "can be searched", never "has a box") twinkles: a 4-point star, 10 px, cream with a `danfo` centre, at the object's top-right corner, every 2.4 s with a random phase, 700 ms from .2 to 1 to .2 opacity. Counter-scaled to at least 8 px.
- Only objects in the viewport animate, at most 8 at once. At FULL they are 6 px dots. CSS animation only, no per-frame script. Reduced motion: a still star at 60 percent.
- When I am in range of one, its star becomes a steady ring (the SEARCH pill is the call to action).

### 13.4 Search (the one verb)

1. I walk next to a shimmering object (within one tile, diagonals count: the server's rule). The SEARCH pill appears (priority 100, 7.3).
   The pill enables only once my arrival has been sent to the server: the room flushes my steps every 200 ms and the server checks its own copy of my position, so a press in the first 400 ms after arriving would otherwise be refused.
2. I press it. The pill goes into its 3 s cooldown ring (the server's `retry_ms`). My avatar rummages for 600 ms: the object shakes 2 px and three 4 px cream dust puffs lift, `sfx.swish()`.
3. The server answers:

| Answer | What the room shows | Sound | Buzz |
|---|---|---|---|
| nothing, hint `cold` | chip over the object: `Snowflake` + "NOTHING HERE · COLD", 2 px `lagoon` border, 2.5 s | `sfx.tick(0)` | `refused` |
| nothing, hint `warm` | `Thermometer` + "NOTHING HERE · WARM", `danfo` | `sfx.chime(1)` | `snap` |
| nothing, hint `hot` | `Flame` + "NOTHING HERE · HOT", `fireant` | `sfx.sparkle()` | `quest` |
| win | the win burst and sheet (13.5) | `sfx.motif("full")` | `burstBig` |
| too fast (`slow_down`) | chip "SLOW DOWN" in `fireant`, 1.5 s | none | none |
| too far (`too_far`, `not_in_room`) | retried silently once after 400 ms (the server's copy of my position lags the walk), then "GET CLOSER" | none | `refused` |
| over, not open, already won (`all_found`, `game_closed`, `not_open_yet`, `already_won`) | chip "TOO LATE. IT'S OVER.", "NOT OPEN YET" or "YOU ALREADY GOT ONE." | none | none |
| anything else (`room_changed`, `unknown_object`) | chip "CAN'T SEARCH HERE" | none | none |

Hint chips are 28 px high, DM Mono 11 caps on an ink plate, state-coloured border and icon. They are the only information a search gives, and they sit on the object, not in a toast.

### 13.5 Win

1. At 0 ms a burst in the world: 14 squares of 8 px in `brand.violet`, gold `#D8B468` and cream fly out of the object over 900 ms (hard ease-out, no bounce), and the object's star becomes a tick.
2. At 700 ms the win sheet rises (layer 9, `animate-rise`):

```
+----------------------------------------+
|                 ====                [X]|
|   [ TICKET ]                           |   violet pill: violet is for rewards
|   You found it.                        |   Poppins 900 22
|   Dave ticket. Yours.                  |   Archivo 400 14
|   +--------------------------+ [COPY]  |
|   |  X7K2-91QM               |         |   the code: DM Mono 500 24, tracking .12em; COPY is 44 px
|   +--------------------------+         |
|   Saved in Me, Wins.                   |   DM Mono 10 dim
|   [            DONE             ]      |   the orange .btn
+----------------------------------------+
```

3. Everyone else in the room sees the feed chip "ADA FOUND A BOX. 6 LEFT." The chip never says where.
4. After DONE the banner reads "YOU GOT IT. WATCH THE REST." and there is no SEARCH for me (one win per account per campaign).
5. When the last box goes the room gets `sfx.crowdEhn()` and the banner "ALL FOUND".

### 13.6 Feed chips

Under the banner, 28 px, DM Mono 10 on `bg-ink-2/92`, 2.5 s, at most 2; three in 5 s merge into "3 BOXES FOUND. 4 LEFT.". They come from `game_time_feed` (no code, no spot).

### 13.7 The hype moment (Friday)

For members in the room at the opening: from 10 s before `opens_at` the world dims 20 percent, big numerals count down in the middle (10 to 1, Poppins 900 96, each stamping in .18 s, the last three `fireant`, `sfx.tick(k)` rising), then "GO!" stamps for 600 ms with `sfx.danfoHorn()` and `haptics.buzz("levelUp")`, every shimmer bursts once, and SEARCH works from that frame. Poll the state at `opens_at` minus 500 ms so the GO and the server agree. Reduced motion: the numbers change without the stamp.

### 13.8 What each mount draws

- **World layer**: the shimmer, the ring, the rummage and dust, the win burst. Positioned at `left: x * 32, top: y * 32` in scene px, as the stub's comment says. Click-through; only objects opt in to pointer events.
- **Chrome layer**: banner, feed chips, hint chips, hype numerals, win sheet, leave card. Screen px. Uses the room's slots and priorities (Game Time wins every slot, 5.5).

### 13.9 Edge cases

- First-time visitor while a game is live: the welcome card shows one tip, "Game Time is live. Find the shimmering things and SEARCH.", instead of the two usual tips.
- Reconnect: the banner and shimmer come straight from `game_time_state`; nothing replays.
- Watching a full room: read-only banner, no shimmer, no SEARCH, "WATCHING" in the hint slot.
- The pill must never be hidden by the chat sheet: it rides above the sheet (6.1).
- A search while the chat keyboard is open: the first tap closes the keyboard; the pill is above the sheet so it stays reachable.

## 14. Voice (dark until the flag is on)

Behind one flag: `NEXT_PUBLIC_ROOM_VOICE=1` and the server answering `GET /api/crew/rooms/voice` with `{ enabled: true }` (that needs the `LIVEKIT_*` env, not set locally). With either missing, nothing about voice renders: no mic, no tip, no mention in the welcome card.

### 14.1 The voice control

**Voice is on by default, the mic is not.** Walking into a crew room joins voice by itself as a listener, once the room's enter call has answered (the server then knows the Hopper is walking): you hear the people near you and the stage straight away. Nothing is sent and no permission is asked on the way in. The first tap on the control is when the phone is asked for the microphone, and nothing asks again by itself. Hotspot rooms never mount voice. `NEXT_PUBLIC_ROOM_VOICE_AUTO=0` turns only the automatic join off (back to tap to join).

Top right under the sound icon, 36 px visible, 44 hit, with a small speaker toggle (28 px, 44 by 32 hit) under it. Rules live in `src/lib/crew-room/voiceFlow.ts` and are checked by `scripts/crew-room/check-voice-flow.mjs`.

| State | Icon | Meaning |
|---|---|---|
| off | `Headphones` | not in voice (not joined yet, or left). A tap joins as a listener |
| listening | `Headphones` with a `keke` dot | I hear the room. A tap asks for the microphone |
| mic on | `Mic`, face lit `keke`, pulsing ring | people near me hear me. A tap mutes (`MicOff`) and another tap unmutes |
| muted | `MicOff` | in voice, mic closed |
| blocked | `MicOff` with a red dot and the chip "Mic blocked. Tap to allow" | the phone said no: listen-only. A tap asks again; a second no says "MIC BLOCKED. CHECK YOUR PHONE SETTINGS." |

**Speaker toggle.** `Volume2` / `VolumeX`: the room's voices off means nobody is heard, the stage included (no subscriptions, no speaking dots, no music dip). Remembered per room on the phone (`hz:voice-speaker:<crew>`). The mic is never remembered as on: every visit starts closed.

**One-time tip** on the control, once per device: "You can hear the room. Tap to talk." (7 s, not shown when the voices are off or the Hopper cannot talk).

**Safety.** The app going to the background or the screen locking (`visibilitychange` hidden) closes a live mic, lets go of the phone's microphone and ends a stage broadcast; on return nothing turns on, a label says "MIC IS OFF. TAP TO TALK.", and the mic opens again only on a tap. Leaving the room (or the page) hangs up. The speaking ring shows over my own head when I talk. Blocked people are never heard (they are not in the walkers list or the stage list, and a phone subscribes only to people it hears).

**Audio unlock.** Browsers hold audio back until a tap. A walk in from the ENTER button on the same page keeps the page's tap (Chrome and Android play at once); an iPhone plays after the first tap in the room, which unlocks it (a join never waits for the browser's answer). A label shows on each change: "VOICE ON" (a tap join), "MIC ON", "MIC OFF", "ROOM VOICES ON/OFF". Watchers can listen and cannot be heard (the route gives them no publish right): the icon shows `Headphones` only, labelled "LISTEN ONLY" on a tap join. First tap join shows one line, "Voice uses data.", once per device. Dropped: "VOICE LOST. TRYING AGAIN."

### 14.2 What I hear (the rules, in tiles)

- Same area: full volume.
- Not in my area but near: joins at 6 tiles, drops at 8 (hysteresis, so nobody flickers at the edge), volume falling off linearly from 1.0 at 2 tiles to 0.15 at the edge.
- While a person I can hear is talking the room music ducks (`music.duckVoice(true)`, down to about 20 percent of the map's level).

### 14.3 What I see

- A speaking ring under the talker: 2 px `keke` ellipse, a little wider than the avatar, scaled 1.0 to 1.25 by volume in three steps (`--v`), plus a 10 px `Mic` dot beside their name tag. At most 8 rings, nearest first. Mine shows too.
- When I turn my mic on, a faint dashed circle of 6 tiles around me shows for 1.5 s, and once per session the hint "PEOPLE NEAR YOU CAN HEAR YOU".

### 14.4 Staff on the stage talk to the whole room

Two modes behind two flags. **Off (default):** the owner-only GO LIVE below. **On** (`NEXT_PUBLIC_ROOM_STAGE_VOICE=1`, with the voice flag of 14 and the `LIVEKIT_*` env): staff on the stage speak to everyone, like a general voice channel. The owner is staff, and so is every **admin**, a role the owner gives with MAKE ADMIN in a member's profile sheet (`crew_set_role`, `supabase/crew_stage_voice.sql`).

**The rule.** The database decides, never the phone. A staff member is "on the stage" when their walker has a live heartbeat and the server-checked tile is inside the layout's stage zone (`stage`; `booth` and `deck` in event rooms). At most three speak at once: the owner first, then admins by join date. A fourth sees STAGE FULL.

**Who talks.**
- Staff on the stage with the mic already on (they tapped it) start by themselves.
- Staff with the mic off get the **SPEAK TO ALL** pill (priority 60). One tap joins voice, asks the server for the stage, then opens the mic (the browser asks the first time). A mic never opens without that tap.
- Leaving the stage ends it after 1.5 s. The mic stays on for the people near them; in a stage-only room the server takes the right to publish away.

**Who hears.**
- When the stage goes live every crew member in the room, walker or watcher, joins listen-only by themselves. A phone that left voice itself this visit stays out. 30 s after the stage empties, an automatic listener who never pressed the mic hangs up.
- Browsers hold audio back until a tap. The first touch anywhere in the room unlocks it; while it is still held the pill reads **TAP TO LISTEN**.
- One pill replaces the live chip: the speakers' faces (up to three), `LIVE ON STAGE`, the first name and `N LISTENING`, and a 44 px mute toggle. The stage lights come on and the music ducks.
- Mixed (default): stage voices at full volume wherever I stand; the people near me capped at half while the stage is live; at most 8 voices, stage first. Stage-only (`ROOM_VOICE_STAGE_ONLY=1`, for a concert night): only the stage is heard, and only staff on the stage may publish at all.
- Blocked people are left out of the stage list for the person who blocked them.

**Enforcement.** (1) Each phone subscribes to a stage voice only if the database's list (`crew_room_stage`, polled every 2 s) and the voice room's `stage` attribute both name them. (2) The attribute and the publish right are set only by the server (`POST /api/crew/rooms/voice/stage`, after it re-asks the database), which also clears any attribute the database no longer backs. Nobody can set their own attributes any more. A phone that cheats changes what that one phone hears.

**Where.** Crew rooms (the 360 Stage) now. Event rooms later (`stageZoneId`). Never hotspot rooms (strangers behind an 18+ gate, no voice). The Private Circle is Ola's separate product and is left alone.

#### The owner-only GO LIVE (flag off)

The crew owner, standing inside the 360 Stage zone, gets the **GO LIVE** pill (priority 60, `Mic`). Pressing it turns their mic on and:

- the stage lights up: four soft cream cones (12 percent) from the lamps over the console (scene x 359, 398, 560, 599 at width 30), under avatars;
- a "LIVE" tag (a `fireant` dot and the word) sits over the owner's head, which follows them;
- everyone in the room hears them at full volume wherever they stand (the route lets only the owner set the `live` attribute), and the music ducks;
- a banner chip under the Game Time banner (or in its place): "<NAME> IS LIVE · 54 LISTENING" with a 44 px mute toggle for me;
- the pill becomes END LIVE (stays until pressed, even if they walk off the stage).

## 15. Music, sound and buzz

- **Music** is the room loop at 0.35 of the map's level (`music.ts` `ROOM_LEVEL`), plus the voice duck lane (`music.duckVoice`). The uncommitted diff in `music.ts` and `MusicHost.tsx` already does both (`music.want(slot, own, inRoomPath)` sets the room level); the builder confirms Play on the map still plays at today's level (the post node is back at 1 off the room) and commits it. It starts on the first tap in the room, as today. The control is the sound icon (6.2).
- **Sound** uses the existing vocabulary only (`sfx.ts`). **Buzz** uses the existing named patterns only (`haptics.ts`): at most one every 400 ms, never over 400 ms, off with the Buzz switch, and iPhone Safari cannot vibrate, so every moment below also has a picture.

| Moment | Sound | Buzz |
|---|---|---|
| Tap the floor | none | none |
| Wall bump | `knock` | `refused` |
| Zone card | none (it is a label, not a reward) | none |
| Enter a conversation area | `hotspot` | `hotspot` |
| Vibe sent / received | `vibe` | `pick` / `wave` |
| Wave received | `wave` | `wave` |
| Mutual wave | `checkin` | `checkin` |
| Event sheet opens | `swish` | none |
| Search: cold, warm, hot | `tick(0)`, `chime(1)`, `sparkle` | `refused`, `snap`, `quest` |
| Win | `motif("full")` | `burstBig` |
| Game Time opens (GO!) | `danfoHorn` | `levelUp` |
| All boxes found | `crowdEhn` | none |
| New chat message | none (the bubble is the signal) | none |

## 16. The first visit

Shown once per Hopper per crew: the key `hz:room-seen:<crew id>` in `localStorage` (inside `try/catch`; if storage is blocked, once per session).

- **When**: at 2600 ms, after the zoom has landed (4.4).
- **What**: the welcome card, in the world over my head (layer 5, 300 px wide, 288 at 360), 12 px padding, the same look as the zone card:

```
+----------------------------------------+
| Welcome to 360Playlist's community     |   Poppins 900 16 / 20
| center                                 |
| 1  Tap the floor to walk.              |   Archivo 400 14 / 20
| 2  Tap anyone to wave or vibe.         |
| [          LET'S GO           ]        |   the orange .btn, 44 high
+----------------------------------------+
```

- **How it goes**: dismissed by LET'S GO, a tap outside it, or after 8 s. If I start walking it dims and goes in 4 s. It never blocks a tap outside its own rectangle. It is marked seen the moment it shows.
- Afterwards, one coach mark near the logo for 3 s: "Other crews and nights" with a pulse on the badge, in the hint slot.
- With reduced motion it adds "Tap the arrows button to see every room."
- While a Game Time is live: one tip only (13.9). With voice on: no mention until I tap the mic.
- The same sentence is the empty state of General chat (9.9), so the welcome is never lost.

## 17. Wireframes at 390 x 844

Frame A (browser, no insets): header 56, world 390 x 735, tab bar 53. One character is 8.48 px wide and one row is 28 px, so a frame is 46 columns by 34 rows (2 header rows, 26 world rows, 2 tab bar rows, plus rules). Legend: `@` me, `o` another Hopper, `*` a shimmering object or the lit tab, `(P)` the logo badge, `(ok)` the verified tick, `[~)]` the sound icon, `[+]` the camera button, `:` a dimmed scrim, `#` a wall. These are schematic: where a drawing and a number disagree, the number wins. Frame C (360 x 800) is the same drawing 30 px narrower and 44 px shorter; the numbers for it are in 1.1.

### W1. Open, t = 0 to 1500 ms: the whole room, names readable

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|                                         [~)] |
|                                              |
|                                              |
|                                              |
|                                              |
|                                              |
|                                              |
|                                              |
|                                              |
| +-----------+ +--------------+ +-----------+ |
| |      o    | | 360PLAYLIST  | |       o   | |
| |[LISTENING | | [360 STAGE 3]| |[AWARDS    | |
| | STUDIO 1] | |        o  o  | | GALLERY]  | |
| +-----------+ +----o---------+ +-----------+ |
| +-----------+ +-[COURTYARD 2]+ +-----------+ |
| |[RECORD    | |     (F) o    | |[ARTIST    | |
| | LOUNGE 1] | +--------------+ | CORNER]   | |
| |    o      |   [EXIT TO MAP]  |           | |
| +-----------+         @        +-----------+ |
|                                              |
|                                              |
|              6 ROOMS. TAP ONE.               |
|                                              |
|                                              |
| [o CHAT 2]                              [+]  |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

Scale 0.394: the 960 x 640 scene is 378 x 252 px, centred, with about 241 px of lawn above and below (that band is the empty rows). Zone tags are counter-scaled plates (DM Mono 11); names wider than 100 px wrap to two lines; the number is who is in that room. `(F)` is the fountain sticker, `@` is me at the entrance, `o` are other Hoppers. The sound icon, CHAT and the camera button fade in at t = 0. A tap on a tag flies there; a tap anywhere else skips the hold. Wireframes are schematic: sizes in this file's tables win.

### W2. Zoomed to you at the entrance, first visit (t = 2600 ms)

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|                                         [~)] |
|##############################################|
|#     +--------------------------------+     #|
|#     |          360PLAYLIST           |     #|
|#     +--------------------------------+     #|
|#                                            #|
|# [spk]       [==== console ====]      [spk] #|
|#                                            #|
|#          . . . . stage floor . . . .       #|
|##############################################|
| (tree)         /~~~~~~~~~~~~\        (tree)  |
|     o-o-o-o-o-o|            |-o-o-o-o-o-o-o  |
|:. .+------------------------------------+    |
|:   | Welcome to 360Playlist's           |]   |
|:   | community center                   |    |
|:   | 1  Tap the floor to walk.          |    |
|:   | 2  Tap anyone to wave or vibe.     |    |
|:. .|                                    |    |
|    |      [       LET'S GO       ]      |    |
|    +-----------------v------------------+    |
|      [pl]  [EXIT TO MAP]           [pl]      |
|            [map table]@ You                  |
|                                              |
|          [ WELCOME TO 360PLAYLIST ]          |
| [o CHAT 2]                              [+]  |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

Follow scale 1.11: 11 tiles across, and at 390 x 735 the room's full height still fits (only the width scrolls). The welcome card sits over my head and blocks nothing outside its own rectangle. The door plate is the ink version: the spawn tile is diagonal to the door, so no pill. CHAT is the full pill with its unread count.

### W3. Walked onto the stage: the zone card (3 s, follows me)

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|                                         [~)] |
|##############################################|
|#   +------------------------------------+   #|
|#   | The 360 Stage                      |   #|
|#   | Mic is open. Say it loud.          |   #|
|#   | [ SEE NEXT NIGHT  > ]              |   #|
|# [s+-----------------v------------------+k] #|
|#                    @ You     (o)           #|
|#          . . . . stage floor . . . .       #|
|##############################################|
| (tree)         /~~~~~~~~~~~~\        (tree)  |
|     o-o-o-o-o-o|            |-o-o-o-o-o-o-o  |
|:. . . . . . .  |   D A V E  |                |
|:    [bench]    |            |      [bench]   |
|:              [==== FREE ====]               |
|:     o ADA                                   |
|:      [pl]                         [pl]      |
|:. . . . . . . .                              |
|                                              |
|                                              |
|      [pl]  [EXIT TO MAP]           [pl]      |
|            [map table]                       |
|                                              |
|          [ WELCOME TO 360PLAYLIST ]          |
| [o CHAT 2]                              [+]  |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

264 x 104 with an action. It fades after 5 s (3 s with no action), on a tap, or the moment I walk out of the zone. `(o)` is the destination ring. A wall tap shows no card: an X at the tap point and the hint NOT THAT WAY for 1 s.

### W4. Next to the fountain: the event pill (priority 30)

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|                                         [~)] |
|##############################################|
|#     +--------------------------------+     #|
|#     |          360PLAYLIST           |     #|
|#     +--------------------------------+     #|
|#                                            #|
|# [spk]       [==== console ====]      [spk] #|
|#                                            #|
|#          . . . . stage floor . . . .       #|
|##############################################|
| (tree)         /~~~~~~~~~~~~\        (tree)  |
|     o-o-o-o-o-o|            |-o-o-o-o-o-o-o  |
|:. . . . . . .  |   D A V E  |                |
|:    [bench]    |            |      [bench]   |
|:        @ You [==== FREE ====]               |
|:                                             |
|:      [pl]                         [pl]      |
|:. . . . . . . .                              |
|                                              |
|                                              |
|      [pl]  [EXIT TO MAP]           [pl]      |
|            [map table]                       |
|                                              |
|          [ WELCOME TO 360PLAYLIST ]          |
| [o2]      [ SEE THE DAVE NIGHT ]        [+]  |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

Stand still 250 ms on a tile that shares an edge with the fountain and the orange pill stamps in. CHAT collapses to its icon, the camera button stays. Walking 2 tiles away clears it. The sticker is non-solid and under avatars: walkers pass over it.

### W5. The event sheet (tap the sticker, or the pill)

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|: : : : : : : : : : : : : : : : : : : : :[~)] |
|##############################################|
|# : : +--------------------------------+: : :#|
|#: : :|: : : : : 360PLAYLIST : : : : : | : : #|
|# : : +--------------------------------+: : :#|
|#: : : : : : : : : : : : : : : : : : : : : : #|
|# [spk] : : : [==== console ====] : : :[spk]:#|
|#: : : : : : : : : : : : : : : : : : : : : : #|
|# : : : : :.:.:.:.:stage:floor:.:.:.:.: : : :#|
|##############################################|
|:(tree) : : : : /~~~~~~~~~~~~\: : : : (tree): |
|+--------------------------------------------+|
||                  ======               [X]  ||
||              +--------------+              ||
||              |              |              ||
||              |    FLYER     |              ||
||              |              |              ||
||              |              |              ||
||             [==== FREE ====]+              ||
|| FRI 16 OCT . 8PM                           ||
|| DAVE: The Boy Who Played the Harp          ||
|| Wole Soyinka Centre (National Theatre)     ||
||                                            ||
||  [              OPEN ON MAP              ] ||
||                                            ||
|+--------------------------------------------+|
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

An in-room sheet with the `Sheet.tsx` look: flyer (at most 46 percent of its height), the owner's ribbon, day in mono, title, venue, one orange button. The world above stays alive under a 60 percent scrim. While a Game Time is live OPEN ON MAP first swaps to STAY / OPEN ON MAP (12.3).

### W6. Tap a Hopper: the menu opens on them

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|                                         [~)] |
|##############################################|
|#     +--------------------------------+     #|
|#     |          360PLAYLIST           |     #|
|#     +--------------------------------+     #|
|#                                            #|
|# [spk]       [==== console ====]      [spk] #|
|#                                            #|
|#     +---------------------------------+    #|
|######| (A) ADA     AT THE COURTYARD    |#####|
| (tree| VIBE                            |ee)  |
|     o| [s1]  [s2]  [s3]  [s4]  [s5]    |o-o  |
|:. . .| [SAY HI][WALK TO][PROFILE]      |     |
|:    [|                                 |h]   |
|:     +---------------------------------+     |
|:                     v                       |
|:      [pl]           o             [pl]      |
|:. . . . . . . .     ADA                      |
|                                              |
|                                              |
|      [pl]  [EXIT TO MAP]           [pl]      |
|            [map table]                       |
|          @ You                               |
|          [ WELCOME TO 360PLAYLIST ]          |
| [o CHAT 2]                              [+]  |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

280 x 160, five 44 px stickers (WE OUTSIDE, BIG VIBES, OMO, FRESH, NO WAHALA), then SAY HI (orange) / WALK TO / PROFILE. Press a sticker to read its name in the label row, release to send. The tail slides to keep pointing at the person; the menu flips below them near the top of the world. The room behind keeps moving.

### W7. What the other person sees: a vibe over the sender's head

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|                                         [~)] |
|##############################################|
|#     +--------------------------------+     #|
|#     |          360PLAYLIST           |     #|
|#     +--------------------------------+     #|
|#                                            #|
|# [spk]       [==== console ====]      [spk] #|
|#                                            #|
|#          . . . . stage floor . . . .       #|
|##############################################|
| (tree)         /~~~~~~~~~~~~\        (tree)  |
|     o-o-o-o-o-o|            |-o-o-o-o-o-o-o  |
|:. . . . . . .  |   D A V E  |                |
|: [BIG VIBES]   |            |      [bench]   |
|:  [ TO YOU ]  [==== FREE ====]               |
|:      o                                      |
|:  (~~~~~~~)                        [pl]      |
|:. . JIDE. . . .                              |
|                                              |
|                                              |
|      [pl]                          [pl]      |
|            [map table]                       |
|                            @ You (ADA)       |
|          [ WELCOME TO 360PLAYLIST ]          |
| [o CHAT 2]                              [+]  |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

ADA's phone, 3 s after JIDE pressed BIG VIBES: the sticker stamps in over JIDE with a small TO YOU plate and a pulse ring at his feet, `sfx.vibe()`, and a short buzz on Android. If JIDE is off ADA's screen the hint chip "JIDE VIBED YOU" shows instead and a tap flies the camera to him. A wave shows only a chip, "JIDE WAVED AT YOU", with WAVE BACK for 6 s.

### W8. Chat, PEEK (156 px): the room is still alive above it

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|                                         [~)] |
|##############################################|
|#     +--------------------------------+     #|
|#     |          360PLAYLIST           |     #|
|#     +--------------------------------+     #|
|#                                            #|
|# [spk]       [==== console ====]      [spk] #|
|#                             [BIG VIBES]    #|
|#          . . . . stage floor . .o. .       #|
|##############################################|
| (tree)         /~~~~~~~~~~~~\        (tree)  |
|     o-o-[on my way]         |-o-o-o-o-o-o-o  |
|:. . . . . . .o |   D A V E  |                |
|:    [bench] JIDE            |      [bench]   |
|:              [==== FREE ====]               |
|:                     @ You                   |
|:      [pl]                         [pl]      |
|:. . . . . . . .                              |
|                                              |
|                                              |
|      [pl]                          [pl] [+]  |
|------------------======----------------------|
| (A) ADA 22:21   hey, anyone at the stage?    |
| (J) JIDE 22:22  on my way, save me a spot    |
| [ Say something to everyone          ] [>]   |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

The sheet is 156 px: handle, the last two messages, the composer. The camera has re-centred my avatar in the part of the world above the sheet. A bubble `[on my way]` pops over JIDE and a vibe sticker `[BIG VIBES]` over another Hopper. The bottom row rides 12 px above the sheet and CHAT is hidden because the sheet is the chat. A tap on the world above the sheet still walks.

### W9. Chat, HALF (338 px), inside an area, a message tapped

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|                                         [~)] |
|##############################################|
|#     +--------------------------------+     #|
|#     |          360PLAYLIST           |     #|
|#     +--------------------------------+     #|
|#                                            #|
|# [spk] [brb] [==== console ====]      [spk] #|
|#     @ You                                  #|
|#          . . . . stage floor . . . .       #|
|##############################################|
| (tree)         /~~~~~~~~~~~~\        (tree)  |
|     o-o-o-o-o-o|            |-o-o-o-o-o-o-o  |
|:. . . . . . .  |   D A V E  |                |
|------------------======----------------------|
| CHAT   12 HERE                           [v] |
| [GENERAL]  [COURTYARD CORNER . 2 *]          |
| (A) ADA  22:21                               |
|     anyone at the stage?                     |
| (J) JIDE  22:22                              |
|     on my way, save me a spot                |
| [H] [F] [L] [P]  |  REPLY  |  WALK TO        |
| (Y) You  22:23     [H 1]                     |
|     ok see you by the fountain               |
|                                              |
| [ Say something in COURTYARD CORNER  ] [>]   |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

The Area tab appears only because I stand in Courtyard Corner. The action bar under JIDE's line holds four reactions (heart, fire, laugh, party), REPLY and WALK TO. 238 px of messages: five or six lines against today's two. The composer is 56 px and never disabled.

### W10. Chat, FULL (603 px): a 132 px strip of the room is left on top

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|                                         [~)] |
|##############################################|
|#             [ 360PLAYLIST ]                #|
|#                     @ You                  #|
|##############################################|
|------------------======----------------------|
| CHAT   12 HERE                           [v] |
| [GENERAL]  [COURTYARD CORNER . 2 *]          |
|              TODAY                           |
| (A) ADA  22:19                               |
|     who is on the stage tonight?             |
| (K) KEMI  22:20                              |
|     the DAVE night is on the fountain        |
|     go tap the flyer                         |
| (J) JIDE  22:22                              |
|     on my way, save me a spot                |
| (A) ADA  22:23                               |
|     see you at the fountain                  |
| (Y) You  22:23     [Heart 1]                 |
|     ok see you by the fountain               |
| (K) KEMI  22:24                              |
|     who has the 360 stickers?                |
|                                 [ 3 NEW ]    |
|                                              |
| [ Say something to everyone          ] [>]   |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

FULL is for reading back. The world is a strip of 132 px with my avatar kept in it, the bottom row is hidden, the tab strip is shown because I am in an area, and "3 NEW" floats above the composer when I have scrolled up and something arrived.

### W11. EXPLORE from the logo: this week (the other tab lists crews)

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|     +--------------------------------------+ |
|#####| [OTHER CREWS]  [THIS WEEK]           |#|
|#    |......................................|#|
|#    | (F) LEAD . DAVE: The Boy Who Played  |#|
|#    |     the Harp                         |#|
|#    |     FRI 16 OCT . 142 GOING         > |#|
|# [sp|                                      |#|
|#    | (F) Lagos Jazz Night                 |#|
|#    |     SAT 17 OCT . 96 GOING          > |#|
|#####|                                      |#|
| (tre| (F) Rooftop Sundays                  | |
|     |     SUN 18 OCT . 61 GOING          > | |
|:. . |                                      | |
|:    | (F) Afrobeats on the Island          | |
|:    |     FRI 23 OCT . 40 GOING          > | |
|:    |                                      | |
|:    | ROOM SETTINGS  (owner only)          | |
|:. . +--------------------------------------+ |
|                                              |
|                                              |
|      [pl]  [EXIT TO MAP]           [pl]      |
|            [map table]                       |
|                       @ You                  |
|          [ WELCOME TO 360PLAYLIST ]          |
|                                              |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

A popover from the logo badge, not a panel: 340 px wide, at most 60 percent of the world, one read of `room_rails` the first time it opens. Rows open the map on that night (`/?e=<id>`); the OTHER CREWS tab opens `/crew/<id>`. While a Game Time is live each row asks "Leave the hunt?" first.

### W12. Game Time, live: banner, shimmer, SEARCH, a HOT hint

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
| +------------------------------------+  [~)] |
|#| * GAME TIME                 04:21  |#######|
|#| Dave ticket drop                   |+     #|
|#| [#][#][#][#][#][#][#][ ][ ][ ]  7 LEFT    #|
|#+------------------------------------++     #|
|#  [ ADA FOUND A BOX. 6 LEFT. ]          *   #|
|# [spk]       [==== console ====]      [spk] #|
|#                                            #|
|#          . . . . stage floor . . . .       #|
|##############################################|
| (tree)         /~~~~~~~~~~~~\        (tree)  |
|     o-o-o-o-o-o|            |-o-o-o-o-o-o-o  |
|:.[Flame HOT].  |   D A V E  |                |
|:    [bench]*   |            |      [bench]*  |
|:        @ You [==== FREE ====]               |
|:                                             |
|:      [pl]*                        [pl]      |
|:. . . . . . . .                              |
|                                              |
|                                              |
|      [pl]  [EXIT TO MAP]           [pl]      |
|            [map table]                       |
|                                              |
|          [ WELCOME TO 360PLAYLIST ]          |
| [o2]            [ SEARCH ]              [+]  |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

Banner top left (322 x 60), leaving the sound icon free. `*` marks shimmering objects (every eligible prop, so the shimmer never gives a box away). The orange pill is Game Time's (priority 100) and cools down for 3 s with a ring. The chip on the object (28 px, `fireant` border for HOT) is the only answer a search gives. The feed chip under the banner never says where.

### W13. Game Time, win: the burst, then the sheet

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|: : : : : : : : : : : : : : : : : : : : :[~)] |
|##############################################|
|# : : +--------------------------------+: : :#|
|#: : :|: : : : : 360PLAYLIST : : : : : | : : #|
|# : : +-------x + * : * x--------------+: : :#|
|#: : : : : : : : : :+:*:x:+: : : : : : : : : #|
|# [spk] : : : [==== console ====] : : :[spk]:#|
|#: : : : : : :+:*:x: : : : : : : : : : : : : #|
|# : @ You :.:.:.:.:stage:floor:.:.:.:.: : : :#|
|##############################################|
|:(tree) : : : : /~~~~~~~~~~~~\: : : : (tree): |
|+--------------------------------------------+|
||                  ======               [X]  ||
||                                            ||
||  [ TICKET ]                                ||
||  You found it.                             ||
||  Dave ticket. Yours.                       ||
||                                            ||
||  +-----------------------------+           ||
||  |  X7K2-91QM                  |  [COPY]   ||
||  +-----------------------------+           ||
||                                            ||
||  Saved in Me, Wins.                        ||
||                                            ||
||  [                 DONE                 ]  ||
|+--------------------------------------------+|
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

The burst (14 squares in violet, gold and cream) plays in the world for 900 ms and the sheet rises at 700 ms. The ticket pill is violet because violet is for rewards. The code is shown once and saved in Me through `my_game_time_wins()`. Everyone else sees only the feed chip.

### W14. Next to the door: EXIT TO MAP (priority 40)

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
|                                         [~)] |
|##############################################|
|#     +--------------------------------+     #|
|#     |          360PLAYLIST           |     #|
|#     +--------------------------------+     #|
|#                                            #|
|# [spk]       [==== console ====]      [spk] #|
|#                                            #|
|#          . . . . stage floor . . . .       #|
|##############################################|
| (tree)         /~~~~~~~~~~~~\        (tree)  |
|     o-o-o-o-o-o|            |-o-o-o-o-o-o-o  |
|:. . . . . . .  |   D A V E  |                |
|:    [bench]    |            |      [bench]   |
|:              [==== FREE ====]               |
|:                                             |
|:      [pl]                         [pl]      |
|:. . . . . . . .                              |
|                                              |
|                                              |
|      [pl]  [[EXIT TO MAP]]         [pl]      |
|            [map table]                       |
|                  @ You                       |
|          [ WELCOME TO 360PLAYLIST ]          |
| [o2]          [ EXIT TO MAP ]           [+]  |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

The plate turns orange (`[[ ]]`) and the pill appears only when I stand on a tile that shares an edge with the door, the tiles in front of it. The spawn tile is diagonal to the door, so arriving never shows this. Walking onto the table does nothing; only the plate or the pill leaves.

### W15. Leave the hunt? (door, back arrow, Explore rows, OPEN ON MAP, tab bar)

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
| +------------------------------------+  [~)] |
|#| * GAME TIME                 03:02  |#######|
|#| Dave ticket drop                   |+     #|
|#| [#][#][#][#][#][ ][ ][ ][ ][ ]  5 LEFT    #|
|#+------------------------------------++     #|
|#                                            #|
|# [spk]       [==== console ====]      [spk] #|
|#                                            #|
|#      +------------------------------+      #|
|#######|                              |#######|
| (tree)|   Leave the hunt?            |tree)  |
|     o-|                              |o-o-o  |
|:. . . |   The clock keeps running.   |       |
|:    [b|   You can walk back in.      |nch]   |
|:      |                              |       |
|:      |   [  STAY  ]    [  LEAVE  ]  |       |
|:      |                              |]      |
|:. . . +------------------------------+       |
|                                              |
|                                              |
|      [pl]  [EXIT TO MAP]           [pl]      |
|            [map table]                       |
|                  @ You                       |
|          [ WELCOME TO 360PLAYLIST ]          |
|                                              |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

Centred card, 300 px wide, STAY is the default focus. It shows only while Game Time is live (`roomStore.huntActive`).

### W16. Voice on (flag): the owner is live from the stage

```text
+----------------------------------------------+
| <  360Playlist (ok)                     (P)  |
|    * 12 HERE                                 |
+----------------------------------------------+
| +------------------------------------+  [~)] |
|#| * ADA IS LIVE . 54 LISTENING       |#######|
|#| owner on the stage                 |+ [M] #|
|#| [ mute ]                           ||     #|
|#+------------------------------------++     #|
|#       /|\      /|\       /|\      /|\      #|
|# [spk]       [==== console ====]      [spk] #|
|#            [LIVE] @ You                    #|
|#          . . . . stage floor . . . .       #|
|##############################################|
| (tree)         /~~~~~~~~~~~~\        (tree)  |
|     o-o-o-o-o-o|            |-o-o-o-o-o-o-o  |
|:. . . . . . .  |   D A V E  |                |
|:    [bench]    |            |      [bench]   |
|:              [==== FREE ====]               |
|:                             ((o))           |
|:      [pl]                   KEMI Micl]      |
|:. . . . . . . .                              |
|                                              |
|                                              |
|      [pl]                          [pl]      |
|            [map table]                       |
|                                              |
|          [ WELCOME TO 360PLAYLIST ]          |
| [o2]           [ END LIVE ]             [+]  |
|                                              |
+----------------------------------------------+
|    [m]      [e]        [c]      [t]      (o) |
|    MAP    EVENTS     *CREW*    CHAT      ME  |
+----------------------------------------------+
```

Only with the flag on. The mic icon (`[M]`) sits under the sound icon; the banner chip says who is live and has a 44 px mute toggle for me; four soft cones light the stage; a LIVE tag follows the owner; a speaking ring and a mic dot sit on KEMI, who is talking near me. The orange pill is END LIVE (priority 60) for the owner. The mic itself starts off for everyone.

### W17. Landscape 844 x 390 (frame F): chat docks to the right

```text
+--------------------------------------------------------------------------------------------------+
| < 360Playlist (ok)    * 12 HERE                                                             (P)  |
+--------------------------------------------------------------------------------------------------+
| ###################################################[~)]###  +----------------------------------+ |
| #            +-----------------------------+             #  | CHAT  12 HERE                [v] | |
| #            |         360PLAYLIST         |             #  | [GENERAL]                        | |
| #            +-----------------------------+             #  | (A) ADA 22:21                    | |
| #  [spk]         [==== console ====]               [spk] #  |     anyone at the stage?         | |
| #        o-o-o-o-o-o-o-o-o-o-o-o-o-o-o-o-o-o-o-o-o-o-o-o-o  | (J) JIDE 22:22                   | |
| #                      /~~~~~~~~~~~~\                    #  |     on my way, save me a spot    | |
| #      @ You           | D A V E    |                    #  |                                  | |
| #                     [==== FREE ====]                   #  | [ Say something to everyone ] [>]| |
| #[o2]##[ SEE THE DAVE NIGHT ]########################[+]##  +----------------------------------+ |
+--------------------------------------------------------------------------------------------------+
|        [m]                 [e]                 [c]                 [t]                 (o)       |
|        MAP               EVENTS              *CREW*               CHAT                 ME        |
+--------------------------------------------------------------------------------------------------+
```

Header 44, tab bar 53, so the world is 844 x 293. The chat is a 320 px side panel over the right of the world instead of a bottom sheet (a bottom sheet would leave under 150 px of world). The camera's free width shrinks by 320 while it is open, so I stay in view. The bottom row, banner and sound icon sit in the left part. Follow scale 1.02 (height-limited), full view 0.444.

## 18. Phone quality bar and performance budget

### 18.1 The bar

| Area | Rule | Check |
|---|---|---|
| Safe areas | header `pad-top`, tab bar bottom inset (both exist); in landscape the HUD side margins are `max(12px, env(safe-area-inset-left/right))`; the chat sheet's bottom is the tab bar's top | frame B (47 / 34 insets) and landscape with a notch |
| Targets | at least 44 x 44, 8 px apart (1.3) | an automated check that lists any visible button under 43.5 px in the room |
| No horizontal scroll | `overflow: hidden` on the world and room, `min-w-0` on flex children, every popover and sheet `max-width: W - 16` | 360, 375, 390, 430, 844 wide |
| Landscape | section 21 | 844 x 390 |
| Nothing truncated that matters | the title never ellipsises for 360Playlist (3.3), pill labels step down in size before they truncate, tags wrap to two lines, chat messages show in full | 360 x 800 |
| Every icon labelled or obvious | see 18.2 | |
| Text size | 10 px floor (mono labels on plates only), 13 px for anything read as a sentence, 15 px for chat | |
| Contrast | cream on ink is above 12:1; ink on the orange face is 5.9:1; `text-dim` on `bg-ink-2` is 6:1; text never sits straight on the art | day and night themes |
| Reduced motion | no camera tween, no stamp, no bob or shine, no bubble rise, sheets appear without sliding, countdown numerals change without the stamp | `prefers-reduced-motion` |
| Screen readers | the world is a labelled group; a hidden `role="status"` line says "You are in the Courtyard" and "Walking"; chat is a `role="log"` (it is today); sheets are dialogs with the Escape key; bubbles are `aria-hidden` | VoiceOver and TalkBack pass |
| Focus (desktop) | the global orange 2 px focus ring; focus returns to the trigger when a sheet closes | |

### 18.2 Icons and what labels them

| Icon | Where | How a person knows what it is |
|---|---|---|
| `ChevronLeft` | header | the app's own back chevron; `aria-label` "Back to the crew" |
| Round logo with `Compass` | header | named in the first-visit coach mark; `aria-label` "Explore other crews and nights"; the popover has titled tabs |
| `Volume2` / `VolumeX` | world top right | universal; `aria-pressed`; "Music" label for screen readers |
| `MessageCircle` plus "CHAT" | bottom row | word beside it (icon only while a pill shows, still with its unread count) |
| `Maximize2` / `LocateFixed` | bottom row | 1 s label "FULL VIEW" or "BACK TO ME" on every toggle |
| `Headphones` / `Mic` / `MicOff` | voice | 1 s label on every change; "LISTEN ONLY" for watchers |
| `SendHorizontal` | composer | the universal send arrow; "Send" for screen readers |
| `ChevronDown` | chat strip | the sheet's own collapse |
| `Heart`, `Flame`, `Laugh`, `PartyPopper` | message bar | each `aria-label`led; the four are the usual set |
| Five drawn stickers | Hopper menu | the label row shows the name on press; the sticker on the world carries its lettering |

### 18.3 Performance budget

The target is 60 fps while walking, on a mid-range Android at a 4x CPU throttle, with 60 people in the room, on Lagos mobile data.

| Measure | Today (measured, 2 avatars, dev build, DPR 3) | Target |
|---|---|---|
| Walk frame, 1x CPU | average 22 ms, p95 33 ms | p95 at or under 17 ms |
| Walk frame, 4x CPU | average 27 ms, **p95 117 ms**, 56 of 494 frames over 33 ms | p95 at or under 20 ms, no frame over 50 ms, with 60 peers |
| DOM nodes in the world | 1,093 with 2 avatars; about 4,600 more at 60 avatars (77 SVG nodes each) | 1,500 or fewer with 60 avatars |
| Nodes per avatar | 77 | 1 |
| Camera and avatar movement | `left` and `top` transitions (layout) | `transform` only (compositor) |
| React work per walk step | state in the world on every step | one store write per 85 ms step; none per frame |
| World pixels | devicePixelRatio (3 on iPhone) | `min(devicePixelRatio, 2)`, about 2.25 times fewer pixels at 3 |
| Per-frame main-thread JS | not measured | 4 ms or less at 1x (16 ms at 4x) |

How the design expects to get there (the builder may choose another way if the numbers hold):

1. **Transform-only camera and movement** (4.3). Avatars move with a 85 ms linear `transform` transition. No `left`/`top` animation anywhere.
2. **Cached avatar sprites.** Draw each look once (an `OffscreenCanvas` or an SVG rasterised to an `ImageBitmap`, about 80 x 120 px at 2x), keyed by the look, and place it as one `<canvas>` or `<img>`. 60 avatars become 60 nodes. Rebuild only when a look changes. Drop the per-avatar `filter: drop-shadow` that `.player` uses today (a filter on 60 moving elements is expensive); bake a hard shadow into the sprite or use one ellipse.
3. **Static art is one layer.** Either rasterise `ClubhouseArt` once to a canvas at 2x scene pixels (1920 x 1280 at width 30, about 10 MB) shown with `image-rendering: pixelated`, or keep the SVG on its own `will-change: transform` layer and never change its scale during a walk. The art is `shapeRendering="crispEdges"` pixel work, so nearest-neighbour scaling is on-brand.
4. **DPR cap at 2** for the world's backing store (a canvas sized `css * min(dpr, 2)`); text and HUD stay DOM and crisp.
5. **Labels by CSS variable** (5.4), and **cull**: only avatars, bubbles and tags inside the viewport plus 2 tiles exist as nodes.
6. **Peers** move between 1.5 s snapshots by a 300 ms transform transition; do not re-render the world when a snapshot changes nothing visible.
7. **No `backdrop-filter`, no blurred shadows on anything that moves.** Hard offset shadows only (the app's own look). Animate `transform` and `opacity` only.
8. **Data diet.** The room code loads lazily; Explore reads when first opened; the flyer is a 224 px WebP (about 40 KB); the logo is under 20 KB; `livekit-client` loads only when someone taps the mic; no new webfont (fonts are already self-hosted); chat reads 40 messages a page.

How to test it: a Playwright or CDP script at 390 x 844, mobile emulation with touch, `deviceScaleFactor` 3, `Emulation.setCPUThrottlingRate(4)`, a fixture of 60 synthetic peers on a local database, and a series of far-corner taps; sample `requestAnimationFrame` deltas for 6 s. It passes when p95 is 20 ms or less and no delta is over 50 ms. Run it before the Friday drop and again with the chat sheet open.

## 19. Copy deck

Voice: short, second person, Paz the Conductor (loud, cheeky, Lagos street). No em dashes, no emoji, none of the words `docs/COPY-AUDIT.md` bans. The brand is **360Playlist**, one word, everywhere a person can read it (header, art, welcome, sheets).

| Where | Copy |
|---|---|
| Header title, line 2 | 360Playlist (tick), "12 HERE"; full: "FULL · 60 WALKING" |
| Opening, before the room | "WALKING IN" |
| Opening hint | "6 ROOMS. TAP ONE." |
| Welcome card | **Welcome to 360Playlist's community center** / "Tap the floor to walk." / "Tap anyone to wave or vibe." / LET'S GO |
| Coach mark at the logo | "Other crews and nights" |
| Camera labels | "FULL VIEW", "BACK TO ME" |
| Wall hint | "NOT THAT WAY" |
| Zone: Listening Studio | "Headphones on. First listen, before anybody." Action (only if the owner set a music link): OPEN THE MUSIC. None: "Next session loading. Pull up a seat." |
| Zone: The 360 Stage | "Mic is open. Say it loud." Action (only if a next event matches): SEE NEXT NIGHT |
| Zone: Awards Gallery | "Trophies on the wall. Go look." Action (if awards exist): SEE THE AWARDS. None: "Shelves are empty for now. Awards land soon." |
| Zone: The Courtyard | "Fountain, benches, good company." |
| Zone: Record Lounge | "Sit down. Pick your next favourite." Action (if a link): OPEN THE PLAYLIST |
| Zone: Artist Corner | "Meet the sound behind the sound." Action (if set): SEE THE ARTIST |
| Private area | "Chat here stays here. 2 inside." / alone: "You're first. Chat here stays here." |
| Fountain pill | "SEE THE DAVE NIGHT" (`SEE THE <HEADLINE> NIGHT`, else "SEE THE EVENT") |
| Event sheet | day line from `dayLabel` ("FRI 16 OCT · 8PM"), button OPEN ON MAP |
| Door plate and pill | "EXIT TO MAP" |
| Leave card | "Leave the hunt?" / "The clock keeps running. You can walk back in." / STAY, LEAVE |
| Chat | pill CHAT; tabs GENERAL and the area name in caps; placeholder "Say something to everyone" / "Say something in COURTYARD CORNER"; empty General "Welcome to 360Playlist's community center. Say hi."; empty area "Only people in here get this chat."; left an area "You left COURTYARD CORNER. Back to General."; pending "TAP TO RETRY"; "3 NEW" |
| Message bar | REPLY, WALK TO; reply chip "REPLYING TO ADA" |
| Hopper menu | label "VIBE"; stickers WE OUTSIDE, BIG VIBES, OMO, FRESH, NO WAHALA; SAY HI, WALK TO, PROFILE |
| Vibes | "ADA VIBED YOU"; cooldown "GIVE THEM A MINUTE" |
| Waves | "WAVED AT ADA"; "ADA WAVED AT YOU" + WAVE BACK; "YOU BOTH WAVED. SAY HI" + OPEN DM; "ALREADY WAVED"; "THAT'S A LOT OF WAVES TODAY. TRY TOMORROW" |
| Explore | tabs OTHER CREWS, THIS WEEK; "12 IN THE CREW", "142 GOING"; empty "No other crews on the block yet." and "Nothing big this week yet. Check the map."; error "Couldn't load." RETRY; owner row ROOM SETTINGS |
| Full room | "FULL. WATCHING. YOU WALK IN WHEN A SPOT OPENS."; later "YOU'RE IN" |
| Game Time | "GAME TIME"; "OPENS IN 12:41"; "STARTING SOON"; "7 LEFT"; "ADA FOUND A BOX. 6 LEFT."; "3 BOXES FOUND. 4 LEFT."; SEARCH; "NOTHING HERE · COLD" / "WARM" / "HOT"; "SLOW DOWN"; "TOO LATE. IT'S OVER."; "YOU ALREADY GOT ONE."; win "You found it." / "Dave ticket. Yours." / "Saved in Me, Wins." / DONE; "YOU GOT IT. WATCH THE REST."; "ALL FOUND", "TIME UP", "CLOSED"; "GAME TIME PAUSED"; the hype "GO!" |
| Voice | "VOICE ON", "MIC ON", "MIC OFF", "LISTEN ONLY", "Voice uses data.", "PEOPLE NEAR YOU CAN HEAR YOU", "MIC BLOCKED. CHECK YOUR PHONE SETTINGS.", "VOICE LOST. TRYING AGAIN.", owner GO LIVE / END LIVE, "ADA IS LIVE · 54 LISTENING" |
| Errors (the only toasts) | "No connection. Your message is kept." / "Couldn't send. Tap to retry." |

## 20. Notes for the builder

### 20.1 What changes where

| File | Change |
|---|---|
| `src/components/BottomNav.tsx` | remove `/^\/crew\/[^/]+\/room$/` from `FULL_SCREEN` (the room route only; DMs, circle, drop, avatar, admin, report, phone stay full screen). CREW already lights: `/crew/<id>/room` starts with `/crew`. While `roomStore.huntActive`, tab taps other than CREW ask "Leave the hunt?" first |
| `src/components/campaign/CampaignExp*.tsx` (the screen that mounts the header, the world and both Game Time layers) | the new header (3.3); drop `.detail` aside, `.tour` chips, the status bar and `MusicSwitch` bar, the Crews and Customise header buttons; keep the two `GameTimeLayer` mounts |
| `src/components/campaign/CampaignWorld.tsx` | camera on one transform; pointer input (tap, pan, pinch); tap snapping; destination ring and bump; label layer; Hopper menu; action registry; sticker; remove the D-pad, "Follow me", `nearbyStatus` button, overview hint, numbered `marker` buttons, area chat-icon buttons and the map-pin table marker |
| `src/components/crew-room/CrewRoomChat.tsx` | becomes the chat sheet (9): states, gestures, tabs only in an area, flat lines, message bar, composer; remove the audience banner and the area list |
| `src/components/campaign/ClubhouseArt.tsx` | remove the four baked zone plaques; widen the welcome mat to 192 px and write WELCOME TO 360PLAYLIST |
| `src/lib/crew-room/roomStore.ts` | add `setAction`/`clearAction` (7.2), `chat` state, unread count; `huntActive` exists |
| `src/components/campaign/Campaign.module.css` | delete `.detail*`, `.tour`, `.worldStatus`, `.controls`, `.camera`, `.nearbyStatus`, `.overviewHint`, `.marker*`, `.areaTarget`, `.peerTarget` once replaced |
| New (suggested names) | `RoomHud`, `ActionPill`, `HopperMenu`, `ZoneCard`, `FountainSticker`, `EventSheet`, `ExploreCard`, `LeaveHunt`, `useRoomCamera`, `RoomVoice` (the route's comment already names it), `src/lib/crew-room/vibes.ts` |

### 20.2 Things the design needs that the code or database do not have yet

1. **Wave key.** `send_wave(p_key)` takes a `room_identities.id` and needs `have_met` or `in_room(me, channel)`. Crew-room peers carry user ids, not room keys. Either mint identities for a `crew:<id>` channel on entry, or add a `crew_room_wave(peer)` that checks both are in the room.
2. **Vibes.** New RPC (sticker id from a fixed catalogue, the limits in 8.3, both people in the room, blocks respected) and a delivery path inside the 1.5 s room read or Realtime. Not in `crew_rooms.sql` today.
3. **Chat reactions.** A small table (`message id, user id, kind`) with RLS like the messages. Friday cut line in 9.5: ship REPLY and WALK TO, hide the reactions if the table is late.
4. **Rename.** The seeded crew row (the hub screenshot, image 2, shows it) and `content.brand` carry a space between the two words. Rename both to the one-word "360Playlist" (`scripts/crew-room/seed-local.mjs`, `scripts/rooms/load-campaign.mjs`).
5. **Featured event.** The columns exist (`featured_event_id`, `featured_ribbon` at most 14 characters, `crew_room_set_featured`). Set the local 360 room to the Dave event `9e733b14-e5c3-41ac-9e10-c2a4b5b8640c` with ribbon "FREE".
6. **Rails.** `room_rails(p_crew)` is in the uncommitted `supabase/crew_rails.sql`; it must be loaded.
7. **Game Time** (`supabase/game_time.sql`, uncommitted) sets `roomStore.huntActive` and registers its pill through `setAction`.
8. **Voice.** The route exists; `RoomVoice.tsx` and the `LIVEKIT_*` env do not. Dark by default.
9. **Zone counts** for the tags are worked out on the phone from the peers' tiles. No server call.

### 20.3 Deliberately not built

A D-pad on touch, a status line, the six section chips, the "Step into the sound" panel, numbers as names, the map-pin card, a "Conversation areas" button, a floating map button, per-zone description panels, a self menu, an automatic exit, any toast for a room event.

## 21. Landscape and desktop

**Landscape phone** (height under 500, frame F): header 44, tab bar stays (53), world 844 x 293. Chat docks as a 320 px panel on the right edge, full world height, instead of a bottom sheet (W17); the camera's free width shrinks by 320 while it is open. HUD side margins use the safe-area insets. Cards and the menu keep their sizes but clamp to the free area. Follow scale is height-limited (1.02); the open sequence is the same.

**Tablet and desktop** (width 900 or more, or a fine pointer): the same header and tab bar as the rest of the app. Chat is a 360 px right-docked panel with the same flat lines, tabs and composer (no sheet states). Wheel zooms about the cursor, drag pans, arrow keys and WASD walk, `E` or Space presses the action pill, `Enter` or `/` focuses the chat input, Escape closes the menu, card, sheet or popover. Icon buttons carry `title` tooltips. Nothing else changes: the same pop-ups, labels, pill, sticker, door and Game Time HUD. No on-screen D-pad here either.

## 22. MORE IDEAS, ranked by value for Friday

| # | Idea | Why it helps | Cost | When |
|---|---|---|---|---|
| 1 | **Game Time hype moment**: the last 10 s before the drop, numerals, danfo horn, every shimmer bursts, crowd "ehn" (specced in 13.7) | turns 60 people waiting into one shared shout; it is the screenshot and the story | low: one chrome overlay and existing sounds | Friday |
| 2 | **Zone counts on the tags** ("360 STAGE 3") (specced in 5.1) | shows where the crowd is, so nobody wanders an empty room; the reason to look at the full view | none: derived from peers | Friday |
| 3 | **Haptics and sound for every social beat** (15) | iPhone cannot buzz, so the sounds and pictures carry; Android gets the tap | low: names already exist | Friday |
| 4 | **Tap a name in chat to walk to them** (9.5) | "where are you?" solved in one tap; keeps people moving and meeting | low | Friday |
| 5 | **Emotes**: a sticker button beside the chat input sends one of the five stickers over my own head | talk without typing on a crowded night; reuses the vibe stickers and the bubble layer | low, once vibes ship | Friday |
| 6 | **First-visit mini quests**: three stamps (SAY HI TO SOMEONE, SIT IN A BOOTH, SEE THE DAVE NIGHT), each pip lights on the logo badge, XP through the quests system | gives a new Hopper a reason to explore the six rooms and to wave | medium: needs a quest hook and copy | later |
| 7 | **Presence faces**: five face discs next to "12 HERE" in the header, tap for the list | the room feels populated even from the full view | medium: faces and a list sheet | later |
| 8 | **Spatial music near the stage**: the loop swells within 6 tiles of the stage and sinks by the door | the room has places, not just names | medium: a distance gain on the music post node | later |
| 9 | **Room lighting follows the Lagos clock**: lamps and string lights on after dusk, the app's day and night | the room matches the app's own theme | medium: art tint layer | later |
| 10 | **Crowd wave from the stage**: the owner triggers it, every avatar puts a hand up for 1.5 s | a shared moment for a launch or a drop win | medium: a room-wide event | later |

## 23. Acceptance checks (what "done" means)

Run at 390 x 844 and 360 x 800 (touch emulation, DPR 3), then 430 x 932, 375 x 667, 844 x 390 and 1440 x 900.

1. The tab bar shows in the room with CREW lit; DMs, circle, drop and avatar still hide it.
2. Header: back, logo badge at the right, "360Playlist" with the tick on one line at 360 x 800, "12 HERE" under it. No map pin, no Crews link, no customise button, no chat button.
3. The world fills header to tab bar with no status line, no MUSIC bar, no chips, no side panel, and no horizontal scroll at any size.
4. On open the whole room shows for about 1.5 s with all six names readable, then zooms to you in about 0.9 s. A tap skips it. Reduced motion starts at follow.
5. Tap the floor walks; a tap on a wall within 1 tile snaps; a tap with nothing walkable shows the X, "NOT THAT WAY" and a bump. Drag pans; pinch zooms between full view and 2.2; the camera button toggles FULL VIEW and BACK TO ME. There is no D-pad on touch.
6. There is no "Conversation areas" button and no floating map button; CHAT shows with an unread count.
7. Walking into a zone for 500 ms shows one card for about 3 s, never two, never again within 60 s; no long text appears by itself.
8. Tap an avatar: the menu opens on them with five stickers, SAY HI, WALK TO, PROFILE. A vibe pops over the sender for 3 s with a tap on Android and a sound everywhere; the 4th vibe in a minute to one person is refused with "GIVE THEM A MINUTE"; SAY HI uses the existing wave and opens a DM only when mutual.
9. Chat opens at HALF, shows 5 or more lines at 390 x 844, pulls down to PEEK and CLOSED, pulls up to FULL, and the world above stays visible and live. The Area tab exists only inside an area. The input is never disabled and never says "Choose an area above". The keyboard never covers the composer.
10. A new message pops as a bubble over the speaker; at most 3 at once; none under full view.
11. Tap a message: the bar offers REPLY (and the reactions when they exist) and WALK TO.
12. Standing next to the fountain shows SEE THE DAVE NIGHT; the sticker on the fountain shows the Dave flyer, the keyline, the tilt and the ribbon "FREE" (from `featured_ribbon`, not from the price); tap opens the sheet with flyer, day, ribbon and OPEN ON MAP.
13. The door plate reads EXIT TO MAP; arriving at the spawn tile shows no pill; walking onto the door tiles does nothing; the pill or the plate leaves; with `huntActive` it asks "Leave the hunt?" first, from the door, back arrow, Explore rows, the event sheet and the tab bar.
14. The logo opens Explore: other crews (verified first, open `/crew/<id>`) and this week (open `/?e=<id>`). It reads once, on first open.
15. Art and copy say 360Playlist everywhere: header, banner (360PLAYLIST), mat (WELCOME TO 360PLAYLIST), welcome card, chat empty state.
16. The first visit shows the welcome card once; the second visit does not.
17. Room music is about 0.35 of the old level and Play on the map is unchanged; the sound control is a small icon.
18. Voice with the flag off shows nothing. With it on: the mic starts off, same-area voice is full volume, nearby voice joins at 6 tiles and drops at 8, speaking rings show, and the owner can GO LIVE from the stage.
19. Game Time: banner, shimmer, SEARCH pill (priority over every other pill), cold/warm/hot chips, feed chips, the win burst and sheet, the hype moment, and the "Leave the hunt?" guard all work as in 13, and the pill is never behind the chat sheet.
20. Touch audit: no visible control under 44 x 44; no text under 10 px; nothing truncated that matters at 360.
21. Performance: 6 s of far-corner taps at a 4x CPU throttle with 60 synthetic peers gives p95 frame 20 ms or less and no frame over 50 ms; the world backing store is at most 2x.
22. Day theme: header, HUD, cards and sheets read correctly; the world stays dark.
23. Landscape 844 x 390: chat docks right, the world stays usable, the tab bar stays.
24. A signed-in Hopper in a full room (watching) sees the "FULL. WATCHING." chip, can chat, can open the sticker and the door, and walks in when a spot opens.
