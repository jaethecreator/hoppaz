// Real REST + Realtime integration checks against an isolated LOCAL fixture crew.
// --keep retains only these new fixtures for browser QA; --cleanup removes them.
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw new Error('LOCAL database required');
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const options = { auth: { persistSession:false,autoRefreshToken:false } };
const admin = createClient(url,secret,options);
const file = '/tmp/hoppaz-crew-room-qa.json';
const checked = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
async function cleanup(fixture) {
  checked(await admin.from('crews').delete().eq('id',fixture.crewId));
  for (const actor of fixture.actors) checked(await admin.auth.admin.deleteUser(actor.id));
  await unlink(file).catch(() => {});
}
if (process.argv.includes('--cleanup')) {
  await cleanup(JSON.parse(await readFile(file,'utf8'))); console.log('Removed isolated local room QA fixtures.'); process.exit(0);
}
const fixture = { crewId:randomUUID(),actors:[] };
const clients = [], channels = [];
try {
  for (const name of ['Ami · QA','Jide · QA','Seyi · QA']) {
    const email = `roomqa-${randomUUID()}@roomqa.invalid`, password = `${randomUUID()}Aa!`;
    const { user } = checked(await admin.auth.admin.createUser({email,password,email_confirm:true}));
    const client = createClient(url,publicKey,options);
    const { session } = checked(await client.auth.signInWithPassword({email,password}));
    fixture.actors.push({ id:user.id,name,email,password,access_token:session.access_token,refresh_token:session.refresh_token }); clients.push(client);
    checked(await admin.from('profiles').update({display_name:name}).eq('id',user.id));
  }
  checked(await admin.from('crews').insert({id:fixture.crewId,name:'360 Playlist · QA',created_by:fixture.actors[0].id}));
  checked(await admin.from('crew_members').insert(fixture.actors.map((actor,i) => ({crew_id:fixture.crewId,user_id:actor.id,role:i===0?'owner':'member'}))));
  const sessions = clients.map(() => randomUUID());
  const rpc = async (i,name,args={}) => checked(await clients[i].rpc(name,{p_crew:fixture.crewId,...args}));
  for (let i=0;i<3;i++) await rpc(i,'crew_room_enter',{p_session:sessions[i]});
  for (let i=0;i<3;i++) checked(await admin.from('crew_room_presence').update({x:[3,4,6][i],y:[4,6,4][i],last_moved_at:new Date(Date.now()-1000).toISOString()}).eq('crew_id',fixture.crewId).eq('user_id',fixture.actors[i].id));
  const state = await rpc(0,'crew_room_step',{p_session:sessions[0],p_seq:0,p_steps:[]});
  const circle = state.self.circle_id; assert.ok(circle); assert.notEqual(state.peers.find(p=>p.id===fixture.actors[2].id).circle_id,circle);
  const moved = await rpc(0,'crew_room_step',{p_session:sessions[0],p_seq:1,p_steps:[{x:4,y:4}]}); assert.equal(moved.self.circle_id,circle,'moving inside an area preserves its conversation');
  const seen = [[],[],[]];
  for (let i=0;i<3;i++) {
    await clients[i].realtime.setAuth(fixture.actors[i].access_token);
    const channel = clients[i].channel(`local-qa-${randomUUID()}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'crew_room_messages',filter:`crew_id=eq.${fixture.crewId}`},event=>seen[i].push(event.new.id));
    channels.push(channel);
    await new Promise((resolve,reject)=> { const timeout=setTimeout(()=>reject(new Error('Realtime subscription timeout')),10000); channel.subscribe(status=> { if(status==='SUBSCRIBED'){clearTimeout(timeout);resolve();} else if(status==='CHANNEL_ERROR'){clearTimeout(timeout);reject(new Error('Realtime subscription failed'));} }); });
  }
  const general = await rpc(0,'crew_room_send',{p_scope:'general',p_body:'Welcome to the local crew room test.',p_request:randomUUID()});
  const privateId = await rpc(0,'crew_room_send',{p_scope:'nearby',p_body:'Only people in Listening Booth 1 receive this.',p_circle:circle,p_request:randomUUID()});
  await new Promise(resolve=>setTimeout(resolve,2000));
  assert.ok(seen[1].includes(privateId),'nearby recipient must receive Realtime message');
  assert.ok(!seen[2].includes(privateId),'far-away member must not receive private Realtime payload');
  assert.ok(seen.every(feed=>feed.includes(general)),'general Realtime reaches all members');
  for(let i=0;i<3;i++) {
    const messages=checked(await clients[i].from('crew_room_messages').select('id').eq('crew_id',fixture.crewId));
    assert.equal(messages.some(m=>m.id===privateId),i!==2,'REST audience must match Realtime');
  }
  console.log('PASS: three authenticated clients, adjacent private areas, movement inside an area, general chat, private REST history and private Realtime delivery.');
  // Membership removal immediately revokes old general and nearby history.
  checked(await admin.from('crew_members').delete().eq('crew_id',fixture.crewId).eq('user_id',fixture.actors[1].id));
  assert.equal(checked(await clients[1].from('crew_room_messages').select('id').eq('crew_id',fixture.crewId)).length,0);
  checked(await admin.from('crew_members').insert({crew_id:fixture.crewId,user_id:fixture.actors[1].id,role:'member'}));
  console.log('PASS: revoked membership cannot fetch previous messages.');
  if(process.argv.includes('--keep')) {
    await writeFile(file,JSON.stringify({...fixture,url,publicKey}),{mode:0o600});
    console.log('Isolated local fixtures retained for browser QA; run --cleanup after verification.');
  } else await cleanup(fixture);
} catch(error) { await cleanup(fixture); throw error; }
finally { for(let i=0;i<channels.length;i++) await clients[i].removeChannel(channels[i]); for(const client of clients) client.realtime.disconnect(); admin.realtime.disconnect(); }
