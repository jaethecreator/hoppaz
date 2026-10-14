// Crew rooms through the real REST and Realtime APIs, against an isolated LOCAL fixture crew (three new accounts and
// one crew, removed at the end). Refuses any database that is not on this machine.
//   node scripts/crew-room/check-live.mjs            run and clean up
//   node scripts/crew-room/check-live.mjs --keep     keep the fixtures for browser QA (written to FILE)
//   node scripts/crew-room/check-live.mjs --cleanup  remove fixtures kept by --keep
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import assert from "node:assert/strict";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("LOCAL database required");
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options);
const FILE = "/tmp/hoppaz-crew-room-qa.json";
const checked = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const pass = (line) => console.log(`PASS: ${line}`);

async function cleanup(fixture) {
  checked(await admin.from("crews").delete().eq("id", fixture.crewId));
  for (const actor of fixture.actors) checked(await admin.auth.admin.deleteUser(actor.id));
}
if (process.argv.includes("--cleanup")) {
  await cleanup(JSON.parse(await readFile(FILE, "utf8")));
  await unlink(FILE).catch(() => {});
  console.log("Removed isolated local room QA fixtures.");
  process.exit(0);
}

const fixture = { crewId: randomUUID(), actors: [] };
const clients = [];
const channels = [];
try {
  for (const name of ["Ami · QA", "Jide · QA", "Seyi · QA"]) {
    const email = `roomqa-${randomUUID()}@roomqa.invalid`;
    const password = `${randomUUID()}Aa!`;
    const { user } = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
    const client = createClient(url, publicKey, options);
    const { session } = checked(await client.auth.signInWithPassword({ email, password }));
    fixture.actors.push({ id: user.id, name, email, password, access_token: session.access_token, refresh_token: session.refresh_token });
    clients.push(client);
    checked(await admin.from("profiles").update({ display_name: name }).eq("id", user.id));
  }
  checked(await admin.from("crews").insert({ id: fixture.crewId, name: "360 Playlist · QA", created_by: fixture.actors[0].id }));
  checked(
    await admin
      .from("crew_members")
      .insert(fixture.actors.slice(0, 3).map((actor, i) => ({ crew_id: fixture.crewId, user_id: actor.id, role: i === 0 ? "owner" : "member" })))
  );
  const sessions = clients.map(() => randomUUID());
  const rpc = async (i, name, args = {}) => checked(await clients[i].rpc(name, { p_crew: fixture.crewId, ...args }));
  for (let i = 0; i < 3; i++) await rpc(i, "crew_room_enter", { p_session: sessions[i] });

  // Two in Listening Booth 1, one in the booth next door.
  for (let i = 0; i < 3; i++) {
    checked(
      await admin
        .from("crew_room_presence")
        .update({ x: [3, 4, 6][i], y: [4, 6, 4][i], last_moved_at: new Date(Date.now() - 1000).toISOString() })
        .eq("crew_id", fixture.crewId)
        .eq("user_id", fixture.actors[i].id)
    );
  }
  const state = await rpc(0, "crew_room_step", { p_session: sessions[0], p_seq: 0, p_steps: [] });
  const circle = state.self.circle_id;
  assert.ok(circle);
  assert.notEqual(state.peers.find((p) => p.id === fixture.actors[2].id).circle_id, circle);
  const moved = await rpc(0, "crew_room_step", { p_session: sessions[0], p_seq: 1, p_steps: [{ x: 4, y: 4 }] });
  assert.equal(moved.self.circle_id, circle, "moving inside an area preserves its conversation");

  const seen = [[], [], []];
  for (let i = 0; i < 3; i++) {
    await clients[i].realtime.setAuth(fixture.actors[i].access_token);
    const channel = clients[i]
      .channel(`local-qa-${randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crew_room_messages", filter: `crew_id=eq.${fixture.crewId}` }, (e) =>
        seen[i].push(e.new)
      );
    channels.push(channel);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Realtime subscription timeout")), 10000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR") {
          clearTimeout(timeout);
          reject(new Error("Realtime subscription failed"));
        }
      });
    });
  }
  const general = await rpc(0, "crew_room_send", { p_scope: "general", p_body: "Welcome to the local crew room test.", p_request: randomUUID() });
  const privateId = await rpc(0, "crew_room_send", {
    p_scope: "nearby",
    p_body: "Only people in Listening Booth 1 receive this.",
    p_circle: circle,
    p_request: randomUUID(),
  });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const ids = (i) => seen[i].map((m) => m.id);
  assert.ok(ids(1).includes(privateId), "area recipient must receive the Realtime message");
  assert.ok(!ids(2).includes(privateId), "a member outside the area must not receive the private Realtime payload");
  assert.ok(seen.every((_, i) => ids(i).includes(general)), "General Realtime reaches all members");
  const payload = seen[1].find((m) => m.id === privateId);
  assert.ok(payload.body && payload.author_name && payload.created_at && payload.circle_id === circle, "the Realtime payload carries the whole message, so the app appends it without a read");
  for (let i = 0; i < 3; i++) {
    const messages = checked(await clients[i].from("crew_room_messages").select("id").eq("crew_id", fixture.crewId));
    assert.equal(messages.some((m) => m.id === privateId), i !== 2, "REST audience must match Realtime");
  }
  pass("three authenticated clients, adjacent areas, movement inside an area, General, private REST history and private Realtime delivery");

  // History is read per conversation: General and the area session do not share a window.
  for (let n = 0; n < 5; n++) await rpc(1, "crew_room_send", { p_scope: "nearby", p_body: `Area line ${n}`, p_circle: circle, p_request: randomUUID() });
  const generalPage = checked(
    await clients[1]
      .from("crew_room_messages")
      .select("id,scope,created_at")
      .eq("crew_id", fixture.crewId)
      .eq("scope", "general")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(2)
  );
  assert.deepEqual(generalPage.map((m) => m.id), [general], "General is read on its own, whatever the areas say");
  const areaFirst = checked(
    await clients[1]
      .from("crew_room_messages")
      .select("id,created_at")
      .eq("crew_id", fixture.crewId)
      .eq("scope", "nearby")
      .eq("circle_id", circle)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(3)
  );
  const oldest = areaFirst[areaFirst.length - 1];
  const areaNext = checked(
    await clients[1]
      .from("crew_room_messages")
      .select("id,created_at")
      .eq("crew_id", fixture.crewId)
      .eq("scope", "nearby")
      .eq("circle_id", circle)
      .or(`created_at.lt."${oldest.created_at}",and(created_at.eq."${oldest.created_at}",id.lt.${oldest.id})`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(3)
  );
  assert.equal(areaFirst.length + areaNext.length, 6, "two pages of the area session hold all six area messages");
  assert.ok(!areaNext.some((m) => areaFirst.some((f) => f.id === m.id)), "pages do not overlap");
  pass("history pages per conversation (General apart from the area session, older pages by time and id)");

  // A second tab takes over; the first is told.
  const second = randomUUID();
  const took = await rpc(1, "crew_room_enter", { p_session: second });
  assert.equal(took.took_over, true);
  const old = await clients[1].rpc("crew_room_step", { p_crew: fixture.crewId, p_session: sessions[1], p_seq: 0, p_steps: [] });
  assert.match(old.error?.message ?? "", /room_session_replaced/);
  pass("a second tab takes the walker over and the first gets room_session_replaced");

  // The invite: a fourth Hopper sees the card by code, joins once, lands in the room.
  const email = `roomqa-${randomUUID()}@roomqa.invalid`;
  const password = `${randomUUID()}Aa!`;
  const { user } = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
  fixture.actors.push({ id: user.id, name: "Tolu · QA", email, password });
  const guest = createClient(url, publicKey, options);
  clients.push(guest);
  checked(await guest.auth.signInWithPassword({ email, password }));
  const code = checked(await admin.from("crews").select("invite_code").eq("id", fixture.crewId).single()).invite_code;
  const card = checked(await guest.rpc("crew_card", { p_code: code.toLowerCase() }));
  assert.equal(card.name, "360 Playlist · QA");
  assert.equal(card.in_room, 3);
  assert.equal(card.invite_code, null, "an outsider does not get the code back");
  const anon = createClient(url, publicKey, options);
  assert.equal(checked(await anon.rpc("crew_card", { p_code: code })).members, 3, "the share preview reads the card with the public key");
  const joined = checked(await guest.rpc("crew_join_code", { p_code: code }));
  assert.equal(joined.crew_id, fixture.crewId);
  assert.equal(joined.joined, true);
  assert.equal(checked(await guest.rpc("crew_join_code", { p_code: code })).joined, false);
  const inside = checked(await guest.rpc("crew_room_enter", { p_crew: fixture.crewId, p_session: randomUUID() }));
  assert.ok(inside.self, "the new member walks into the room");
  pass("invite by code: card for outsiders and the share preview, one join, straight into the room");

  // Membership removal immediately revokes old General and area history.
  checked(await admin.from("crew_members").delete().eq("crew_id", fixture.crewId).eq("user_id", fixture.actors[1].id));
  assert.equal(checked(await clients[1].from("crew_room_messages").select("id").eq("crew_id", fixture.crewId)).length, 0);
  checked(await admin.from("crew_members").insert({ crew_id: fixture.crewId, user_id: fixture.actors[1].id, role: "member" }));
  pass("revoked membership cannot fetch previous messages");

  if (process.argv.includes("--keep")) {
    await writeFile(FILE, JSON.stringify({ ...fixture, url, publicKey }), { mode: 0o600 });
    console.log("Isolated local fixtures retained for browser QA; run --cleanup after verification.");
  } else await cleanup(fixture);
} catch (error) {
  await cleanup(fixture);
  throw error;
} finally {
  for (let i = 0; i < channels.length; i++) await clients[i].removeChannel(channels[i]);
  for (const client of clients) client.realtime.disconnect();
  admin.realtime.disconnect();
}
