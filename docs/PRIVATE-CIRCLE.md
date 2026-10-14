# Private Circle setup

The Circle is an invite-only queer community at `/circle`. Its event, quest, membership, and voice-room data lives in separate tables with row-level security; it does not reuse the public events feed.

## Database

After the main Hoppaz `schema.sql` has been applied, run `supabase/queer_community.sql` in the Supabase SQL editor. It creates empty tables, so no private event or quest is visible until a Hoppaz admin adds it.

An existing Hoppaz admin can open `/circle` and create a single-use invite. Share the generated link directly with the intended person. Invite codes are stored as SHA-256 hashes and expire after 14 days.

## Live audio

Create a LiveKit Cloud project and set these server-only environment variables in the deployment environment:

```text
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-server-api-key
LIVEKIT_API_SECRET=your-server-api-secret
```

Keep the API secret off the client. Hoppaz checks membership before minting a short-lived room token. If these variables are absent, the private map and quests still work, while audio rooms show a setup message.

## Adding private listings

Use the Supabase SQL editor or a trusted admin tool to insert rows into `queer_events` and `queer_quests`. These tables are readable only by active Circle members. Do not copy private listings into the public `events` table.
