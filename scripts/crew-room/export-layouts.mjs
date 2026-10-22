// Writes the walkable grid of the room templates, at both widths, as SQL.
//
//   node scripts/crew-room/export-layouts.mjs
//       Writes every template into the LAYOUT_SEED block of supabase/crew_rooms.sql. Run it whenever walls, props, areas or
//       templates move, then load the SQL. NOTE: loading crew_rooms.sql puts the slow room helpers back; run
//       supabase/crew_rooms_scale.sql straight after it (see that file's header).
//
//   node scripts/crew-room/export-layouts.mjs --only emergency-room --out supabase/emergency_room_template.sql
//       Writes ONE template as a small, re-runnable file and leaves crew_rooms.sql alone. This is how a template that is added
//       after launch reaches the database without re-running crew_rooms.sql: one transaction, the layout rows at both
//       widths (on conflict do update), and a check at the end that the walk grid and the area look-up that
//       crew_rooms_scale.sql keeps by trigger are filled and that the spawn and every zone stop are walkable.
//       A template with `pickable: false` in src/lib/campaign/templates.ts also gets the server-side lock: the table
//       crew_room_template_locks and a trigger on crew_rooms that refuses (template_locked) any crew that has no lock row
//       for that template. The lock rows themselves are inserted by the setup file of the crew the template belongs to.
import fs from 'node:fs';
import { loadCampaign } from '../rooms/load-campaign.mjs';
const root=new URL('../../',import.meta.url);
const args=process.argv.slice(2);
const opt=(name)=>{const i=args.indexOf(name);return i<0?null:args[i+1]??null;};
const {ROOM_TEMPLATES,ROOM_WIDTHS,sceneBlocks}=loadCampaign();
const only=opt('--only');
const out=opt('--out');
if(args.includes('--only')!==args.includes('--out')) throw new Error('--only <template key> and --out <file> go together');
const dataOf=(t,width)=>{
  const l=t.layout(width);
  return {grid:l.grid,spawn:l.spawn,zones:l.zones,privateAreas:l.privateAreas,blocks:sceneBlocks(l)};
};
const rowOf=(t,width)=>`('${t.key}',${width},'${JSON.stringify(dataOf(t,width)).replaceAll("'","''")}'::jsonb)`;

// The server side of `pickable: false`: only crews with a row in crew_room_template_locks may have a room on this template.
const lockBlock=(t)=>`
-- The lock: this template is locked to the crew(s) listed in crew_room_template_locks. The setup file of the crew it belongs to
-- adds its row (setup_emergencyroom.sql, BEFORE it puts the room on the template). A template with no rows is open to every
-- crew, and so is every other template (the clubhouse has none). Lock rows have no foreign key on purpose: if the crew is ever
-- deleted its row stays, so the template stays locked rather than silently opening to everyone.
create table if not exists public.crew_room_template_locks (
  template text not null,
  crew_id  uuid not null,
  primary key (template, crew_id)
);
alter table public.crew_room_template_locks enable row level security;   -- no policies: closed to the app
revoke all on table public.crew_room_template_locks from public, anon, authenticated;

-- Fires only when a room is made with a template or its template column is written (BEFORE INSERT OR UPDATE OF template), and
-- returns at once when the template did not change. Otherwise two primary-key look-ups. security definer so it can read the
-- locked-down table whoever writes the room. A function replaced by crew_rooms.sql or crew_rooms_scale.sql does not touch it,
-- and neither file drops crew_rooms or its triggers, so the lock survives both.
create or replace function public._crew_room_template_lock() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'UPDATE' and new.template is not distinct from old.template then return new; end if;
  if exists (select 1 from public.crew_room_template_locks where template = new.template)
     and not exists (select 1 from public.crew_room_template_locks where template = new.template and crew_id = new.crew_id) then
    raise exception 'template_locked';
  end if;
  return new;
end $fn$;
revoke all on function public._crew_room_template_lock() from public, anon, authenticated;

drop trigger if exists crew_room_template_lock on public.crew_rooms;
create trigger crew_room_template_lock before insert or update of template on public.crew_rooms
  for each row execute function public._crew_room_template_lock();

do $lockcheck$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.crew_rooms'::regclass and tgname = 'crew_room_template_lock' and not tgisinternal) then
    raise exception '${t.key}: the template lock trigger was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.crew_room_template_locks'::regclass)
     or has_table_privilege('anon', 'public.crew_room_template_locks', 'select')
     or has_table_privilege('authenticated', 'public.crew_room_template_locks', 'select') then
    raise exception '${t.key}: the lock table must be closed to anon and authenticated';
  end if;
end $lockcheck$;
`;

if(only){
  const t=ROOM_TEMPLATES.find((x)=>x.key===only);
  if(!t) throw new Error(`No template called ${only}. Known: ${ROOM_TEMPLATES.map((x)=>x.key).join(', ')}`);
  if(!/^[a-z][a-z0-9-]{1,30}$/.test(only)) throw new Error('template key must be lower case letters, digits and dashes');
  const rows=ROOM_WIDTHS.map((w)=>rowOf(t,w));
  const locked=t.pickable===false;
  const sql=`-- ============================================================================
-- Hoppaz: the "${t.name}" room template (${t.key}), layout rows for both widths.
-- GENERATED by scripts/crew-room/export-layouts.mjs --only ${t.key} --out supabase/emergency_room_template.sql
-- from src/lib/campaign/templates.ts. Do not edit by hand: change the room, run the script, load the file.
--
-- Run order: after crew_rooms.sql AND crew_rooms_scale.sql. Then, once the owner has signed up, setup_emergencyroom.sql
-- (that file adds the crew's row to the lock below, so it must run after this one).
-- Safe to run twice (and as often as you like): it only inserts or refreshes the ${t.key} rows${locked?', the lock table and the lock trigger':''}. It touches no other
-- template, no room, no walker and no existing function.
-- Re-run rule: crew_rooms.sql puts the old slow helpers back and says so; run crew_rooms_scale.sql after it. Your ${t.key}
-- rows survive both, but running this file again after them is harmless and re-checks the grids.
--
-- What it does: one transaction. It inserts the layout of ${t.key} at widths ${ROOM_WIDTHS.join(' and ')} (the walls and furniture as
-- blocks, the zones, the spawn). crew_rooms_scale.sql keeps a trigger on crew_room_layouts that fills the ready-made walk grid
-- (walk) and the area look-up (area_at) from that data on every insert and update, so no extra step is needed; the last
-- statement checks they were filled and that the spawn and every zone stop are walkable tiles.${locked?`
-- ${t.name} is locked to its own crew: it is not offered in MANAGE CREW (pickable: false), and the lock below makes
-- crew_room_set_template refuse any other crew with template_locked.`:`
-- A crew picks the template in MANAGE CREW (crew_room_set_template) once these rows exist.`}
-- ============================================================================
begin;
set local lock_timeout = '3s';

do $guard$
begin
  if to_regclass('public.crew_room_layouts') is null or to_regprocedure('public.crew_room_set_template(uuid,text)') is null then
    raise exception '${t.key}: crew_rooms.sql must be loaded first';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crew_room_layouts' and column_name = 'walk')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.crew_room_layouts'::regclass and tgname = 'crew_room_layout_grids' and not tgisinternal) then
    raise exception '${t.key}: crew_rooms_scale.sql must be loaded first (it keeps the walk grid of each layout)';
  end if;
end $guard$;

insert into public.crew_room_layouts(template,width,data) values
${rows.join(',\n')}
on conflict(template,width) do update set data=excluded.data;

-- The grids are kept by the trigger; refuse to commit if they are not there or the room cannot be walked.
do $verify$
declare
  l record;
  z jsonb;
  tiles int;
begin
  for l in select * from public.crew_room_layouts where template = '${t.key}' loop
    if l.gw is null or l.gh is null or l.walk is null or l.area_at is null
       or char_length(l.walk) <> l.gw * l.gh or coalesce(array_length(l.area_at, 1), 0) <> l.gw * l.gh then
      raise exception '${t.key} at width %: the walk grid is missing or the wrong size', l.width;
    end if;
    if substr(l.walk, (l.data->'spawn'->>'y')::int * l.gw + (l.data->'spawn'->>'x')::int + 1, 1) <> '1' then
      raise exception '${t.key} at width %: the spawn is not a walkable tile', l.width;
    end if;
    for z in select * from jsonb_array_elements(l.data->'zones') loop
      if substr(l.walk, (z->'stop'->>'y')::int * l.gw + (z->'stop'->>'x')::int + 1, 1) <> '1' then
        raise exception '${t.key} at width %: the stop of zone % is not a walkable tile', l.width, z->>'id';
      end if;
    end loop;
    tiles := char_length(replace(l.walk, '0', ''));
    if tiles < 120 then raise exception '${t.key} at width %: only % walkable tiles', l.width, tiles; end if;
    raise notice '${t.key} at width %: % x % tiles, % walkable', l.width, l.gw, l.gh, tiles;
  end loop;
  if (select count(*) from public.crew_room_layouts where template = '${t.key}') <> ${ROOM_WIDTHS.length} then
    raise exception '${t.key}: expected ${ROOM_WIDTHS.length} layout rows';
  end if;
end $verify$;
${locked?lockBlock(t):''}
commit;
`;
  fs.writeFileSync(new URL(out,root),sql);
  console.log(`Wrote ${rows.length} layout rows of ${only} to ${out}.`);
}else{
  const rows=[];
  for(const t of ROOM_TEMPLATES) for(const width of ROOM_WIDTHS) rows.push(rowOf(t,width));
  const seed='insert into public.crew_room_layouts(template,width,data) values\n'+rows.join(',\n')+'\non conflict(template,width) do update set data=excluded.data;';
  const file=new URL('supabase/crew_rooms.sql',root);
  let sql=fs.readFileSync(file,'utf8');
  const pattern=/-- LAYOUT_SEED(?:\ninsert into public\.crew_room_layouts[\s\S]*?on conflict\((?:template,)?width\) do update set data=excluded\.data;)?/;
  if(!pattern.test(sql)) throw new Error('LAYOUT_SEED marker not found in supabase/crew_rooms.sql');
  sql=sql.replace(pattern,()=>'-- LAYOUT_SEED\n'+seed);
  fs.writeFileSync(file,sql);
  console.log(`Generated ${rows.length} room collision layouts (${ROOM_TEMPLATES.map(t=>t.key).join(', ')}) from the campaign manifest.`);
}
