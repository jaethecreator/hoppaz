# 360 Playlist release boundary

Prepared 14 October 2026. Crew rooms and text chat are now implemented locally; scheduled hunts, voice and payments are still separate. Nothing has been deployed. See `CREW-ROOMS.md` for behavior and the implemented fixed private-area interaction.

Later the same day the include list below was brought onto `jae/consolidate` on its own (no neighbourhood rooms, no QA settings, no main-page changes), with the crew card entry and the room route in the bottom navigation. The campaign code there imports nothing from `src/components/rooms` or `src/lib/rooms`.

## Include in the 360 campaign release

- `src/components/campaign/CampaignExperience.tsx`: campaign shell, content and local preview settings.
- `src/components/campaign/CampaignWorld.tsx`: avatar movement, camera and section interactions.
- `src/components/campaign/ClubhouseArt.tsx`: original venue artwork and corrected floor patterns.
- `src/components/campaign/Campaign.module.css`: campaign presentation and responsive layout.
- `src/lib/campaign/layout.ts`: geometry, props, dimensions, collision and campaign content contract.
- `src/lib/campaign/geometry.ts`: small campaign geometry types, separated from generic neighbourhood rooms.
- `src/lib/crew-room/`, `src/components/crew-room/`, `src/app/crew/[id]/room/page.tsx`: crew-owned room entry, shared presence, General/Area text chat and owner settings.
- `supabase/crew_rooms.sql`, `supabase/tests/crew_rooms_test.sql`, `scripts/crew-room/`: additive backend and isolated checks.
- `scripts/rooms/check-campaign.mjs`: campaign navigation/content checks.
- `docs/360-PLAYLIST-DESIGN.md`: Astra's reusable design contract.

The updated campaign and crew-room files are captured in the separate local `360-crew-rooms-core-2026-10-14.zip` review snapshot. The older `360-playlist-core-2026-10-14.zip` contains only the earlier campaign core. Neither is an apply-ready production patch. Use `360-HANDOFF-README.md` for the consolidated implementation and review handoff.

## Keep outside this release

| Workstream | Representative files | Boundary |
| --- | --- | --- |
| Event discovery and newcomer flow | `src/app/page.tsx`, `src/app/discover/page.tsx`, event/card/chrome/intro components, `src/lib/eventLink.ts` | Hold the banner-strip, event-detail and onboarding changes separately. |
| Four neighbourhood rooms and Play migration | `src/components/rooms/`, `src/lib/rooms/`, `src/app/room/[slug]/page.tsx`, main-map hotspot wiring | Hold Yaba/Lekki/VI/Ikeja rooms and general Play-to-map migration separately. |
| Existing user work | Admin/privacy/chat Composer/legacy Play changes; hotspot scripts/data/SQL; voice scripts | Preserve it separately. Do not include it merely because it is currently uncommitted. |

## Shared integration points to separate before publishing

The current local preview is connected to other experiments. A 360/crew-only release needs a narrow campaign entry and navigation registration:

1. The current dynamic room route imports the nine-room catalogue and generic room shell. The release route should render the campaign directly.
2. CampaignExperience now returns to Crews and does not import the generic room catalogue.
3. Campaign types now import `Tile`/`Block` from the dedicated campaign geometry file.
4. The bottom-navigation fullscreen entry should cover the campaign route only. Do not carry unrelated Play-mode navigation changes into the release.
5. The main page contains both event discovery changes and general hotspot integration. Its entire diff must not be treated as a 360 change. Add only the agreed campaign entry.

The snapshot leaves these decisions explicit rather than silently packaging the broader map work.

## Remaining feature: scheduled ticket hunt

The campaign preview remains separate from authenticated crew rooms. Crew linkage, shared avatars and text chat are implemented locally. Real scheduled hidden boxes are not implemented.

One crew now owns its room and its permanent general channel. Existing crew move chats (`move:<id>`) remain unchanged. Crew cards link directly to the room; messages use one canonical crew-room store rather than copying messages between systems.

Exclude the temporary local QA route `src/app/dev/crew-room/`, temporary QA build configuration/cache, local credentials/fixtures and all unrelated dirty files from any release patch.

For the proposed hunt: guests could look around, while signed-in eligible participants could post and claim. Those hunt eligibility and claim actions are not built. Current crew rooms require a signed-in crew member, and text chat stays accessible while moving, beside the map on desktop and beneath it on mobile.

Host setup: ticket inventory, campaign/crew, exact opening/closing times, approved hiding objects and per-account win limit. Before opening, objects look normal and a pinned announcement/countdown states the opening time. At opening, the server enables the round. Searching an object produces either an ordinary inspection response or a validated claim. Successful claims consume real inventory, reveal the winner's result privately, and remove that box for everyone. Further boxes can use new locations only while inventory remains. Claims after expiry or after the last ticket show a clear outcome.

Reuse existing reward/code inventory and transaction locking. Do not convert old geographical drops into remote campaign boxes by removing GPS checks globally: the existing remote path is restricted to personal near/welcome boxes. A shared campaign hunt needs scoped server checks for crew/participation, time, object and inventory. Do not publish hidden answers in a pre-start browser payload. The local avatar animation is not proof that a claim is valid.

## Voice notes: later layer

Voice notes should use the same campaign conversation and membership rules. Flow: record → stop → listen/cancel → send → play in a chat bubble. Start with short clips and explicit microphone access, show duration/upload status, allow retry and stop previous playback when another note starts. Store audio privately and authorise playback for chat members, following the existing private chat-image model. Recording/media permissions, device formats, storage, attachment handling and moderation make this a separate layer from embedding text chat.
