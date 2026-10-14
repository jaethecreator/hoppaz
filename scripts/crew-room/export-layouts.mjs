// Writes the walkable grid of every room template, at both widths, into supabase/crew_rooms.sql (the LAYOUT_SEED
// block). Run it whenever walls, props, areas or templates move, then load the SQL.
import fs from 'node:fs';
import { loadCampaign } from '../rooms/load-campaign.mjs';
const root=new URL('../../',import.meta.url);
const {ROOM_TEMPLATES,ROOM_WIDTHS,sceneBlocks}=loadCampaign();
const rows=[];
for(const t of ROOM_TEMPLATES) for(const width of ROOM_WIDTHS){
  const l=t.layout(width);
  const data={grid:l.grid,spawn:l.spawn,zones:l.zones,privateAreas:l.privateAreas,blocks:sceneBlocks(l)};
  rows.push(`('${t.key}',${width},'${JSON.stringify(data).replaceAll("'","''")}'::jsonb)`);
}
const seed='insert into public.crew_room_layouts(template,width,data) values\n'+rows.join(',\n')+'\non conflict(template,width) do update set data=excluded.data;';
const file=new URL('supabase/crew_rooms.sql',root);
let sql=fs.readFileSync(file,'utf8');
const pattern=/-- LAYOUT_SEED(?:\ninsert into public\.crew_room_layouts[\s\S]*?on conflict\((?:template,)?width\) do update set data=excluded\.data;)?/;
if(!pattern.test(sql)) throw new Error('LAYOUT_SEED marker not found in supabase/crew_rooms.sql');
sql=sql.replace(pattern,()=>'-- LAYOUT_SEED\n'+seed);
fs.writeFileSync(file,sql);
console.log(`Generated ${rows.length} room collision layouts (${ROOM_TEMPLATES.map(t=>t.key).join(', ')}) from the campaign manifest.`);
