---
name: "hoppaz-event-scout"
description: "Run the Hoppaz event scout for Lagos: pull events from Tix, Eventbrite, Chowdeck, Luma and the other sources in the weekend guide skill, with ticket types, prices, organiser details that the page itself publishes, flyers and venue pins, then check them with the loader and send them to the review queue in the staff desk (nothing goes live). Use when Jae says scout, run the scout, pull events, fill the review queue, or load events. Run 2 to 3 times a week."
---

# Hoppaz event scout

Author: Jae (Jide Kelekun). This is the run book for the scout. It fills the **review queue** (`ev_pulled`) in the staff desk with
real events from ticket sites. Staff approve each one; only then does it become a listing in the app. The design is in
`docs/OUTREACH-FLOW.md` (sections "Scout" and "Import batch"). The output format is `ScoutBatch` in `src/lib/events-r1/types.ts`.

It works through every source in `hoppaz-weekend-guide` (tables 3a, 3b, 3c, the tentpole calendar and the organiser watchlist). Load that
skill too: this one adds the fields the guide does not collect, and the loader step. No em dashes anywhere.

## The weekly routine (10 minutes, 2 to 3 times a week)

Needs Jae's computer online, the Claude desktop app (built-in browser, `Claude_Browser__*`), and the Hoppaz repo folder.

1. **Make the day folder.** `D=~/hoppaz-scout/$(date +%F)` then `mkdir -p $D/raw $D/flyers`.
2. **Site access.** In the built-in browser, ask for `site` access once per platform: tix.africa (and core.tix.africa), chowdeck.com (and
   api.chowdeck.com), eventbrite.com, luma.com. If a prompt is refused or a page is blocked, say so and ask Jae. Never skip a source quietly.
3. **Run the four extractions** (snippets below): Tix, Chowdeck, Eventbrite, Luma. Each saves `raw/<source>.json`.
4. **Work the other sources** in the source table, one by one: read the page, write rows into `raw/<label>.json` in the generic shape, or
   write "nothing new" in the run note. Leads only; mark `confidence: "lead"` unless you read the event's own ticket page.
5. **Contacts and lineup.** For events that are new or within 14 days, open the event page and note what it publishes (Tix has a "Contact Us"
   block). Put it in `raw/<source>.extras.json` (format below). Skip events whose contacts an earlier day already holds: the loader
   carries those over.
6. **Build, flyers, pins, check** in one go from the repo folder:
   `node scripts/events/load-scout.mjs $D --build --fetch-flyers --geocode`
   This is a dry run. It sends nothing. Read the table and totals.
7. **Show Jae the report.** Counts per source, refused events and why, warnings, pins by origin, flyers found, sources covered, anything blocked.
   Optionally `node scripts/events/load-scout.mjs $D --plan` to see the site's own report (still writes nothing).
8. **Only when Jae says go:** `node scripts/events/load-scout.mjs $D --apply`. It uploads flyers, then sends the batch. Print the server report.
   Tell Jae to open the review queue in the staff desk.
9. **Report back** in one short message: found, refused, sent, failed or blocked sources, new pins to check. Never post anywhere else.

Set up once: `~/hoppaz-scout/.env` with `HOPPAZ_SITE_URL=https://...` and `HOPPAZ_ADMIN_TOKEN=...`. Jae creates it. Never ask for the token, never
print it, never write it into any file in the repo. The loader reads this file only, never the repo's `.env.local`.

## Rules (all of them, every run)

- **Never invent a value.** Unknown stays `null`, `""` or `[]`. A missing time is `null`, not noon. A missing price is `null`, not 0.
  Capacity is `null` unless the page publishes a number, and then the words that say so go in `capacity_quote`.
- **Never guess a handle.** An Instagram handle is stored only if the page shows it tied to this organiser (a link in their contact block, a host
  profile). Put where you saw it in `..._seen_on`. A handle is never built from a name. The loader drops a handle with no note and refuses one that looks derived.
- **Nothing goes live.** Everything lands in the review queue. Staff approve.
- **Reruns update the same rows.** A row is `(source_site, source_id)`. Keep ids exactly as the source gives them (the loader does).
- **No source skipped.** If a source is blocked, empty, or needs a login Jae does not have in the pane: say so in the report and ask Jae (screenshots work).
- **Contact no organiser.** No emails, DMs, forms, follows, likes, comments, sign ups, or ticket purchases. Reading public pages only.
- **No logins** except what Jae already has open in the browser pane. Never type or store a password. Never get past a login wall, captcha or bot check.
- **No paid services.** No Apify, no Google Places, no paid APIs.
- **Low and human paced.** Caps and pauses are in "Site terms". Stop and ask Jae if a site slows down, errors, or shows a challenge.
- **Lagos State only. In person only.** The normalisers drop other states, online events and webinars and list them in `skipped.json`.
- **Hoppaz's own Hops** (Chowdeck vendor "Hoppaz") are left out: they are already on Hoppaz.

## Folder layout

```
~/hoppaz-scout/
  .env                      HOPPAZ_SITE_URL, HOPPAZ_ADMIN_TOKEN (Jae makes it)
  venue-cache.json          every OpenStreetMap answer, so a venue is asked once
  2026-11-02/
    raw/tix.json            what the browser returned, per source (+ tix.extras.json, ...)
    flyers/                 one file per event: <source>_<id>.jpg
    events.json             the ScoutBatch (built by the loader)
    provenance.json         where capacity, handles and contacts were seen
    flyer-jobs.json         flyer addresses to download
    skipped.json            rows dropped, with the reason, and notes
    batch.normalized.json   what would be sent (valid events, pins resolved)
    import-report.json      the server's report after --apply
```

## Raw file format

One file per source per run: `raw/<name>.json`.

```json
{ "source": "tix", "site": "tix", "fetched_at": "2026-11-02T09:00:00.000Z", "complete": true, "note": "", "rows": [ ... ] }
```

- `source`: `tix`, `eventbrite`, `chowdeck`, `luma` or `generic` (which reader to use).
- `site`: the `source_site` written to every event. Same as `source` for the four platforms. For generic, a short lower case label (see the table).
- `complete`: `true` only if you fetched the **whole** upcoming list for that source (every page, the full window). See "Events no longer seen".
- `rows`: the objects exactly as the snippet returns them (shapes below).

### Extras file (what the event page publishes)

`raw/<name>.extras.json` sits next to the raw file and maps a row key to details read off the event page. Key: the **slug** for Tix and Chowdeck, the long
**number at the end of the event url** for Eventbrite, the **url slug** (for example `fakemixer`) for Luma, the row `id` for generic rows.

```json
{
  "karaokeliveinnov": {
    "organiser_name": "Name as the page shows it",
    "organiser_instagram": "https://www.instagram.com/theirhandle/",
    "organiser_instagram_seen_on": "Tix event page, Contact Us block",
    "event_instagram": "@eventhandle",
    "event_instagram_seen_on": "Tix event page, description",
    "organiser_email": "bookings@example.com",
    "organiser_phone": "0803 000 0000",
    "contact_seen_on": "Tix event page, Contact Us block",
    "lineup": [ { "time": "22:00", "name": "DJ Name" }, "Host Name" ],
    "capacity": 300,
    "capacity_quote": "the exact words on the page that give the number"
  }
}
```

Only those keys are read. A handle without `_seen_on`, or an email or phone without `contact_seen_on`, or a capacity without `capacity_quote`, is dropped and
the drop is printed. `event_instagram` is a handle that belongs to the event itself (a dedicated event page); `organiser_instagram` is the organiser's.

## Step by step

### 1. Access (once per platform)

The cloud container cannot reach the ticket sites; the built-in browser on Jae's computer can. Use `Claude_Browser__navigate` to open one page of the platform, then
`Claude_Browser__javascript_tool` for the snippet. No top-level `return` in snippets (it silently gives undefined): end with the value you want. Do not send
credentials with the fetches (it breaks CORS).

### 2. Saving the output

Snippets finish by downloading the file from the page:

```js
const dl=(name,data)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.download=name;document.body.appendChild(a);a.click();a.remove();};
```

Then `mv ~/Downloads/tix.json $D/raw/`. If the pane blocks the download (it can block repeat downloads from one site), print the file in pieces instead:
`JSON.stringify(file).slice(0,60000)`, then `.slice(60000,120000)`, and so on, and write the pieces to the file with the Write tool. Check the file parses
(`node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" $D/raw/tix.json`).

### 3. Build, flyers, check

`node scripts/events/load-scout.mjs $D --build --fetch-flyers --geocode` (dry run). What it does, in order:

1. Reads `raw/*.json` and `*.extras.json`, normalises every row to a `ScoutEvent`, merges rows with the same ids, writes `events.json`, `provenance.json`,
   `flyer-jobs.json`, `skipped.json`. Contact details found on an earlier day for the same event are reused (with their "seen on" notes).
2. `--fetch-flyers`: downloads each flyer into `flyers/`, **one at a time, 2 seconds apart**, and stops after three failures in a row. If the site blocks flyer
   downloads, say so and ask Jae; do not push harder. Fallback: open the image address in the browser pane and save it by hand into `flyers/<source>_<id>.jpg`
   (the exact file name is in `flyer-jobs.json`).
3. Validates every event (every problem per event is listed). Refused: no name or ids, past only, outside Lagos, online only, capacity with no quote, a handle
   that is not a clean handle or looks derived from a name, bad prices or links.
4. Pins (next section), then validates again, prints a table and totals, writes `batch.normalized.json`.

`--apply` sends only valid events. Events refused only for being past, online or outside Lagos are simply left out. Any other refusal blocks the send until you fix it
or Jae says `--drop-invalid`. It refuses a localhost site unless `--allow-local`, and it never writes to a database or contacts an organiser.

### 4. Review and send

Show Jae the totals and anything refused or warned. On his go: `--apply` (pins come from `venues.json`, the source and the saved `venue-cache.json`, so they match the dry run; add `--geocode` only to search for venues the cache has not seen). The server answers with an `ImportReport` (new, updated, unchanged, blocked, skipped,
flagged gone, organisers matched and new); print it. Re-running the same day updates the same rows.

## Venue pins (never by hand)

Each event gets a point in this order, and the first answer wins:

1. **`scripts/events/venues.json`** (exact or close venue name; `by` says where the point came from). `pin_by: "venues"`. An entry with `by: "osm"` reads back as `pin_by: "osm"`
   until staff check it and change `by` to `"checked"`.
2. **Coordinates the source itself publishes** (Tix, Chowdeck, Eventbrite and Luma all do), if they are inside Lagos. `pin_by: "source"`. If the venue file and the source
   disagree by more than 1.5 km the table flags `pin_differs_from_source`: look at it.
3. **OpenStreetMap search** through Photon (`https://photon.komoot.io`, no key), bounded to the Lagos box, only with `--geocode`. Accepted only if the result is in Lagos State **and** its
   name matches the venue name. `pin_by: "osm"`. At most **1 request per second**, one request per venue, every answer (found or not) saved in `~/hoppaz-scout/venue-cache.json`
   (a miss is retried after 30 days). Vague places ("TBA", "Lagos", "address sent after payment") are never searched.
4. **None.** `lat` and `lng` are `null` and the server flags `no_pin`. Never a guess.

`--save-pins` writes the confident new OpenStreetMap pins into `scripts/events/venues.json` as `by: "osm"` with a `check` note, for staff to look at on a map. Only that flag
touches the file; review the diff before committing it.

Attribution: venue data from **OpenStreetMap contributors**, available under the **Open Database Licence (ODbL)**, https://www.openstreetmap.org/copyright. Photon is run by komoot.
Keep the request rate and volume low (Photon's usage policy), with the descriptive user agent the loader sends.

## Events no longer seen

The batch carries `sources_covered`: sites for which this run saw the **whole** upcoming list. The server marks upcoming rows of a covered site that are not in the batch
as `gone` (a flag for staff, nothing is deleted). Seen again later clears it. So:

- Set `complete: true` only when you paged to the end with the full window. A short window, a failed page, a rate limit, or a login wall means `complete: false`.
- **Tix:** complete if the loop ended because a page came back with fewer than 50 rows, with the 120 day window. **Chowdeck:** complete if you read every page up to `meta.total_pages`.
- **Eventbrite, Luma, every generic source:** always `complete: false` (searches overlap and featured lists are partial). They never flag anything gone.
- If one raw file for a site is incomplete, the site is left out of `sources_covered`.

## How organisers are matched (the server does it)

The scout only reports `organiser_name`, `organiser_handle`, `organiser_email`, `organiser_phone`. `ev_o_import` matches an existing organiser by Instagram handle, then by
name key, then by email, or makes a new one at stage `pulled`. An organiser who said no (`declined` or `do_not_contact`) makes the row `blocked`; it is never listed.
The name key is the same rule in `nameKey()` in `scout-lib.mjs`: lower case of NFKD text with everything except a-z and 0-9 removed. The scout never sets a stage and never contacts anyone.

## Sources

Method labels: **A** = platform snippet below (browser). **P** = read the page in the browser (`get_page_text`, `read_page`) and write generic rows. **L** = lead only
(`confidence: "lead"`, confirm on the ticket page before it is a row you trust). `site` is the label written to `source_site`.

### 3a. Both guides

| Source | site | Method | Complete? | First run check |
|---|---|---|---|---|
| Tix Africa | `tix` | A: GraphQL (snippet 1) + event pages for contacts (snippet 1b) | yes, when paged to the end | Verified 2 Nov 2026 |
| Eventbrite | `eventbrite` | A: JSON-LD (snippet 3) | never | Verified 2 Nov 2026 |
| Chowdeck events | `chowdeck` | A: API (snippet 2) | yes, when all pages read | Verified 2 Nov 2026 |
| Partyverse | `partyverse` | P + L: @partyverseapp Instagram monthly carousel, only if Jae is already signed in to Instagram in the pane; else ask for screenshots | never | Treat each entry as a lead (name, date, venue only); no ticket link until confirmed on the organiser's page |
| Nairabox, Afritickets, Ariya, Syticks, Show.ng, Selar | `nairabox`, `afritickets`, `ariya`, `syticks`, `showng`, `selar` | P | never | Unverified. On first run find each site's Lagos or explore page, check whether it ships JSON-LD (try snippet 3's JSON-LD reader) or `__NEXT_DATA__` (try snippet 4's reader), note the result in the platform log, and use the matching reader (`source: "eventbrite"` for JSON-LD pages, with the site label in `site`) if the shape is the same |
| Luma | `luma` | A: `__NEXT_DATA__` (snippet 4) | never | Verified 2 Nov 2026 (Lagos page lists about 5 featured events) |
| Big-ticket sites: Jetron Ticket, Meetumo, Mainstack, organisers' own sites | `jetron`, `meetumo`, `mainstack`, `own-site` | P (og:image for the flyer) | never | Verified in October; re-check that the page still shows price and time |
| AllEvents | `allevents` | P: `allevents.in/lagos/<category>` (all, parties, business, startup, conferences, finance) | never | Unverified. Check whether the page is readable without a login before relying on it |

### 3b. Weekday Guide extras

| Source | site | Method | First run check |
|---|---|---|---|
| Luma `lu.ma` Lagos discover and organiser calendars | `luma` | A (snippet 4) on each calendar page | Calendar pages are unverified: confirm they hold the same `__NEXT_DATA__` shape before relying on them |
| Meetup (Lagos tech groups, GDG Lagos, dev communities) | `meetup` | P | Unverified. Public group pages only; if the site wants a login, report it |
| dev.events (`dev.events/meetups/AF/NG/Lagos/tech`) | `devevents` | P | Unverified |
| StartupMapHub (`startupmaphub.com/events/city/Lagos`) | `startupmaphub` | P | Unverified |
| 10times (`10times.com/nigeria`) | `10times` | P | Unverified. Often shows big trade shows with a date range, no start time: leave the time `null` |
| CreateWith (Lagos events) | `createwith` | P | Unverified |
| Tech media roundups: TechCabal, Techpoint Africa, Techeconomy, Technext, Benjamin Dada | `techcabal`, `techpoint`, `techeconomy`, `technext`, `benjamindada` | P + L | Leads: copy name, date, venue and the ticket link they cite; confirm on the ticket page before `confidence: "confirmed"` |
| Hubs and organisers: CcHub, Zone Tech Park, Google for Startups and GDG Lagos, Microsoft ADC, Ventures Platform, Startup Grind Lagos, Lagos Startup Week, Social Media Week Lagos, Lagos Business School, LCCI, NACC, British Council, Alliance Francaise, Goethe-Institut | `own-site` (or `luma` if listed there) | P on their site or Luma calendar; their Instagram only if Jae is signed in | Unverified per site. Note the working address of each in the platform log |
| Social: LinkedIn Events and posts ("Lagos" + "this week"), X searches ("Lagos meetup", "Lagos tech event") | `social` | P + L, only with logins Jae already has open | Leads only; if not signed in, say so |

### 3c. Weekend Guide extras (leads only)

nothingtodoinlagos Substack, Pulse Picks, Guardian Life "events this weekend", club and promoter Instagram pages: site `media` (Substack, Pulse, Guardian) or `instagram` (promoter and club pages).
Method P + L. Instagram only if Jae is signed in; otherwise ask for screenshots and type the rows from them. Every row is a lead until the ticket page is read.

### Tentpole calendar (check every month)

Felabration, Blockfest Africa, Moonshot by TechCabal, Lagos Fashion Week, Lagos Cocktail Week, Social Media Week Lagos, Lagos Startup Week, Flytime Fest, the December "Detty December"
concerts, Lagos Countdown, visiting international artists (search "<month> <year> Lagos concert"). Site `tentpole`. Method P: their own sites and a search pass, then the ticket page.
Multi-day events: one row per festival with `starts_at` of day one and `ends_at` of the last day, unless the ticket page sells separate days (then one row per day, id includes the day).
The National Theatre is also the Wole Soyinka Centre for Culture and Creative Arts (Iganmu); `venues.json` knows both names.

### Organiser watchlist

`events/organisers.md` in the Hoppaz Library holds one row per organiser who ran a good event. Check every row each run (their Luma calendar, site or ticket page). Site `own-site` or `luma`.
Add organisers you meet. The server's organiser records (`ev_organisers`) are separate: they are made by the import, not by you.

### Generic row shape (`source: "generic"`)

```json
{ "id": "optional stable id or url", "name": "...", "date": "2026-11-14", "time": "19:00", "start": "ISO with offset, instead of date + time", "end": "ISO", "end_time": "23:00",
  "venue": "...", "address": "...", "area": "...", "lat": null, "lng": null, "description": "...",
  "tickets": [ { "name": "Regular", "price": 5000, "sold_out": false } ], "price": 5000, "free": false, "sold_out": false,
  "ticket_url": "https://...", "image": "https://... (flyer)", "category": "...", "organiser": "...",
  "confidence": "lead" }
```

Lagos time. A date with no time stays `null`. Without an `id` the id is `<date>-<namekey>`, so the same lead gets the same id on a rerun. Prices are whole naira.
`organiser_instagram` etc. go in the extras file, not in the row. A row that does not say it is in Lagos (state, coordinates, Lagos or a Lagos area in the text) is skipped.

## The four platform snippets

### 1. Tix (`core.tix.africa/graphql`)

Run on any tix.africa page. Verified 2 Nov 2026: the schema cannot be introspected, so the field list was probed. Event fields that exist: `id slug title description address locationName
city state country lat lng startDate endDate timezone currency status discoveryImage headerImage tickets`. Ticket fields: `id name price soldOut status`. These do **not** exist: `category`,
`organizer`, `latitude`, `longitude`, `capacity`. Do not ask for `quantityOrdered` (it errors and it is sales data, not capacity).

```js
const q=`query filterEvents($fromDate: Int, $toDate: Int, $country: String, $ended: Boolean, $discoverable: Boolean, $page: Int, $per: Int) { filterEvents(fromDate: $fromDate, toDate: $toDate, country: $country, ended: $ended, discoverable: $discoverable, page: $page, per: $per) { id slug title description address locationName city state country lat lng startDate endDate timezone currency status discoveryImage headerImage tickets { edges { node { id name price soldOut status } } } } }`;
const from=Math.floor(Date.now()/1000), to=from+120*86400;
let rows=[], complete=false, err=null;
for(let p=1;p<=40;p++){
  const r=await fetch('https://core.tix.africa/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationName:'filterEvents',variables:{discoverable:true,ended:false,per:50,page:p,country:'NG',fromDate:from,toDate:to},query:q})});
  const j=await r.json();
  if(j.errors||!j.data){err=JSON.stringify(j.errors||j).slice(0,300);break;}
  const d=j.data.filterEvents; rows=rows.concat(d);
  if(d.length<50){complete=true;break;}
  await new Promise(r=>setTimeout(r,1200));
}
rows=rows.filter(e=>e.state==='Lagos'||/lagos/i.test(e.address||'')).map(e=>({...e,description:(e.description||'').slice(0,6000)}));
const file={source:'tix',site:'tix',fetched_at:new Date().toISOString(),complete:complete&&!err,window:{from,to},rows};
const dl=(name,data)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.download=name;document.body.appendChild(a);a.click();a.remove();};
dl('tix.json',file);
({count:rows.length,complete:file.complete,err,bytes:JSON.stringify(file).length})
```

Field map: `id` (base64 of `Event-<uuid>`; the loader uses the uuid as `source_id`), `slug` -> `ticket_url` `https://tix.africa/discover/<slug>`, `title` -> `name`, `description` (HTML, made text) -> `description`,
`locationName` -> `venue`, `city`/`address` -> `area`, `lat`/`lng` -> pin (`pin_by: "source"`), `startDate`/`endDate` -> `starts_at`/`ends_at`, tickets (`status: "active"` only) -> `tickets`, `headerImage` -> `flyer_url`.

**Times:** `startDate` is Lagos wall clock stored as a UTC epoch (seconds). 1793991600 is 19:00 on 6 Nov, and the event page says 7:00 PM WAT. The loader formats it in UTC and adds no hour. The `timezone` field is
sometimes `WAT`, sometimes `UTC` and does not change that rule; if it is anything else the loader notes it: check the page. Prices are naira without fees. `0` means free.
Tix has no category and no organiser name in the API: category stays `null`; `organiser_name` comes from the extras file if the page shows it.

#### 1b. Tix event page contacts

For Lagos events in the next 14 days that no earlier day already holds, navigate to `https://tix.africa/discover/<slug>`, wait, and run (**at most 40 pages a run, 2.5 seconds apart**):

```js
await new Promise(r=>setTimeout(r,2500));
const label=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^contact us$/i.test((e.textContent||'').trim()));
const box=label&&(label.parentElement?.parentElement||label.parentElement);
({ title:document.title, contact_text:box?.innerText||null, links:[...(box?.querySelectorAll('a[href]')||[])].map(a=>a.href).filter(h=>!/tix\.africa|tixdotafrica/.test(h)), page_text:document.body.innerText.slice(0,3000) })
```

Verified 2 Nov 2026 on one event: the page's "Contact Us" block held an Instagram link for the event, and the footer held Tix's own links (`tixdotafrica`: never use those). The block markup may differ between events: adapt, and
look at the page. From the block take the Instagram link, a `mailto:` or `tel:` link, or an email or number printed in the block. Write them to `tix.extras.json` with `..._seen_on: "Tix event page, Contact Us block"`.
Take a lineup or running order from the description text only if one is published. Never open links to organisers' own sites for contact details beyond what the event page itself shows.

### 2. Chowdeck (`api.chowdeck.com/customer/event`)

Run on any chowdeck.com page (same site fetch). Verified 2 Nov 2026: 17 events nationwide on one page, `meta.total_pages` 1.

```js
let rows=[], complete=false, err=null;
for(let p=1;p<=10;p++){
  const j=await (await fetch('https://api.chowdeck.com/customer/event?page='+p)).json();
  if(!Array.isArray(j.data)){err='bad page '+p;break;}
  rows=rows.concat(j.data.map(e=>({...e,description:(e.description||'').slice(0,6000)})));
  if(p>=(j.meta?.total_pages||1)){complete=true;break;}
  await new Promise(r=>setTimeout(r,1000));
}
const file={source:'chowdeck',site:'chowdeck',fetched_at:new Date().toISOString(),complete:complete&&!err,rows};
const dl=(name,data)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.download=name;document.body.appendChild(a);a.click();a.remove();};
dl('chowdeck.json',file);
({count:rows.length,lagos:rows.filter(e=>/lagos/i.test(e.address?.state||'')).length,complete:file.complete,err})
```

Field map: `id` -> `source_id`; `slug` -> `ticket_url` `https://chowdeck.com/events/<slug>`; `name`; `description`; `landmark` -> `venue` (else `address.street`); `address.city` -> `area`; `address.latitude/longitude` -> pin;
`starts_at`/`ends_at` -> **real UTC, shown in Lagos time (plus one hour)**; `category.name` -> `category`; `vendor.name` -> `organiser_name`; `cover_image_url` -> flyer; `ticket_types[].tickets[]` (`is_active` only) -> `tickets`
with `price` in **kobo** divided by 100; group tickets get "(group of N)". Skipped: not published, not public, not physical, not Lagos, and vendor "Hoppaz".
`quantity` on a ticket is stock for that type, **not** capacity and not seats left: never used. The API has no per-ticket sold out flag: `sold_out` stays false (unknown). `total_tickets_sold` is sales data: not used.
No organiser Instagram, email or phone in the API: leave them `null` unless the event page `chowdeck.com/events/<slug>` publishes a contact block (check once on first run and say what you found).
Flyers on `files.chowdeck.com`: `--fetch-flyers` first; if blocked, download from the browser one at a time.

### 3. Eventbrite (JSON-LD)

Lists: `https://www.eventbrite.com/d/nigeria--lagos/events--this-week/`, `--this-weekend/`, `--next-week/`, `--this-month/` and `.../business--events--this-week/`, pages `?page=2` and so on (at most 4 list pages per list).
Verified 2 Nov 2026: the list page JSON-LD has name, **date only** startDate, url, image, location with geo. The event page JSON-LD has the full time with offset, `offers` (an `AggregateOffer` with `lowPrice`, `highPrice`,
`priceCurrency`), `organizer.name`, and the event type can be a subtype (`MusicEvent`, `EducationEvent`). The JSON-LD `url` of an event page can name a different (series) id from the card you opened:
**the id is the number at the end of the url you opened**, which the snippet records as `page_url`.

Run on a list page (collects the cards, then reads each event page; **at most 40 event pages a run, 2.5 seconds apart**; prices may be in USD):

```js
await new Promise(r=>setTimeout(r,3500));
const ldOf=(doc)=>[...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap(s=>{try{return [].concat(JSON.parse(s.textContent))}catch(e){return []}});
const cards=ldOf(document).flatMap(j=>j.itemListElement||[]).map(i=>i.item).filter(Boolean);
const rows=[];
for(const c of cards.slice(0,40)){
  try{
    const html=await (await fetch(c.url)).text();
    const doc=new DOMParser().parseFromString(html,'text/html');
    const ld=ldOf(doc).find(x=>/Event$/.test([].concat(x['@type']||[]).join(' ')))||null;
    rows.push({page_url:c.url,listing_ld:c,ld});
  }catch(e){rows.push({page_url:c.url,listing_ld:c,ld:null})}
  await new Promise(r=>setTimeout(r,2500));
}
const file={source:'eventbrite',site:'eventbrite',fetched_at:new Date().toISOString(),complete:false,note:location.href,rows};
const dl=(name,data)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.download=name;document.body.appendChild(a);a.click();a.remove();};
dl('eventbrite-'+(location.pathname.split('/').filter(Boolean).pop()||'list')+'.json',file);
({cards:cards.length,withPage:rows.filter(r=>r.ld).length})
```

Several list pages give several files (`eventbrite-events--this-week.json`, ...); all use `site: "eventbrite"` and merge, with repeats removed by id.
Field map: `ld.name`, `ld.description`, `ld.startDate`/`endDate` (offset aware; a date alone gives `null` time), `ld.location.name` -> `venue`, `streetAddress`/`addressLocality` -> `area`, `ld.location.geo` -> pin (list or page),
`ld.offers` -> `tickets` (an `AggregateOffer` becomes a "Lowest price" and a "Highest price" line, not invented tiers; **non-naira prices are not converted**, the label shows the currency and the naira price is `null`;
`availability: SoldOut` -> sold out), `ld.organizer.name`, `ld.image` -> flyer, `eventAttendanceMode` online only -> skipped, region not Lagos -> skipped.
Eventbrite does not put Instagram handles in JSON-LD. The organiser page (`/o/...`) sometimes lists social links: open it once per **new** organiser, and take an Instagram link only from the organiser's own block,
with `organiser_instagram_seen_on: "Eventbrite organiser page"`. Ticket tier names are not in JSON-LD; leave them out.

### 4. Luma (`luma.com/lagos`, organiser calendars)

Verified 2 Nov 2026: `__NEXT_DATA__` holds `props.pageProps.initialData.data.events[]`; each item has `api_id`, `event` (name, `start_at`/`end_at` in UTC, `url` slug, `cover_url`, `location_type`, `geo_address_info`, `coordinate`),
`hosts[]` (name, `instagram_handle`, website), `calendar` (name, `instagram_handle`, `is_personal`) and `ticket_info` (`price`, `max_price`, `is_free`, `is_sold_out`, `spots_remaining`). Only a handful of featured events are listed.

```js
await new Promise(r=>setTimeout(r,2500));
const nd=JSON.parse(document.getElementById('__NEXT_DATA__').textContent);
const items=nd.props.pageProps.initialData.data.events||[];
const rows=[];
for(const it of items.slice(0,20)){
  let page_description='';
  try{
    const html=await (await fetch('https://luma.com/'+it.event.url)).text();
    const doc=new DOMParser().parseFromString(html,'text/html');
    page_description=doc.querySelector('meta[property="og:description"]')?.content||'';
  }catch(e){}
  rows.push({...it,page_description});
  await new Promise(r=>setTimeout(r,2500));
}
const file={source:'luma',site:'luma',fetched_at:new Date().toISOString(),complete:false,note:location.href,rows};
const dl=(name,data)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.download=name;document.body.appendChild(a);a.click();a.remove();};
dl('luma.json',file);
({count:rows.length})
```

Field map: `event.api_id` -> `source_id`; `event.url` -> `ticket_url` `https://luma.com/<url>`; `start_at`/`end_at` UTC -> Lagos time (plus one hour); `geo_address_info.address` -> `venue`; `coordinate` -> pin; `hosts[0].name` -> `organiser_name`;
`hosts[0].instagram_handle` -> `organiser_handle` (it is the host's own profile, so it is tied to the organiser); a non-personal `calendar.instagram_handle` -> `event_handle`; `ticket_info` -> `tickets` (`price` as `{cents, currency}`,
naira only). `spots_remaining` is what is left, not capacity: never used. `location_type` not offline -> skipped.
**Check on first paid event:** the shape of `ticket_info.price`. The reader expects `{cents, currency}`; if it is a plain number or another shape the price stays `null` with a note. Tell Jae what you saw, and add it to the platform log.
The og:description is only a summary; if the event page shows the full text, put it in the extras file as `page_description`.
Other calendar pages (`luma.com/<calendar slug>`) are unverified: run the same snippet and confirm the shape before trusting it; if `events` is missing, report it.

## Site terms and what to watch

- **Public pages only.** No logins, no bypassing a login wall, captcha or bot check, no undocumented private endpoints. The GraphQL and API addresses above are the ones the sites' own public pages call.
- **Respect robots.txt** of each site; if a path is disallowed, do not fetch it, and say so.
- **Keep volume small and human paced.** Per run: Tix 3 list pages (1.2 s apart) and up to 40 event pages (2.5 s apart); Chowdeck 1 to 2 pages; Eventbrite up to 4 list pages per list and 40 event pages (2.5 s); Luma 1 page and up to 20 event pages (2.5 s);
  flyers one at a time, 2 s apart; OpenStreetMap 1 request a second, once per venue. Two to three runs a week, not more. Stop at the first error, slowdown or challenge and ask Jae.
- **Terms.** Tix, Eventbrite and Chowdeck terms generally restrict automated or bulk collection of their listings. This skill was not checked against the current text of each site's terms (not verified).
  It is a risk, and Jae decides whether to run each source. Say so in the first report after any change in a site's behaviour. Keep what is collected to what the public page shows anyway.
- **Other sources:** Instagram, LinkedIn and X forbid automated collection and require a login: read them only as Jae, signed in, by eye in the pane, a few pages, never scripted at volume. Meetup, AllEvents, 10times and the others: read the page like a person would, and stop if asked to log in or solve a challenge.
- **OpenStreetMap / Photon:** see the attribution above and keep to 1 request a second.

## Data and terms (personal data and flyers)

- **Personal data.** An organiser's email address or phone number is personal data under the Nigeria Data Protection Act 2023. Collect one **only** if the event page publishes it for contact. Store it for **one purpose**: to invite that
  organiser to claim their listing. It is never used for anything else, never shared, never added to a list. It is deleted on request (staff remove it from the organiser record and the pulled rows). Do not collect personal social accounts of
  private individuals: an Instagram handle is taken only where it is shown as the organiser's or the event's own page. Do not collect attendee data of any kind. This is a working rule, not legal advice.
- **Contact basis.** The scout contacts nobody. Staff decide whether and how to reach out, from the review queue and organiser tracker. Organisers who say no are marked and never relisted.
- **Flyers.** Flyers belong to the organisers. Hoppaz uses a flyer only to promote that event, with a link back to the organiser's ticket page, and removes it on request. The loader stores a shrunk copy (1200 px JPEG) in the `event-flyers` bucket under `scout/`;
  it does not alter or crop it. If a flyer cannot be saved, the row keeps the organiser's own picture link and staff decide at review.
- **Descriptions** are copied only as far as needed for the listing (trimmed to 4000 characters, tags removed). The ticket link always goes back to the organiser's page.

## Platform log (update as you learn)

- 2026-11-02 (trial, read only, from the built-in browser): Tix GraphQL `filterEvents` answered 200 with the fields above; introspection is off. Event fields `lat`, `lng`, `state`, `city`, `endDate`, `timezone` exist, so Tix gives pins and the state to filter on. Ticket nodes have `name`, `price`, `soldOut`, `status` (`inactive` tickets exist and are left out).
  A Tix event page showed an Instagram link in a "Contact Us" block.
- 2026-11-02: Chowdeck API answered 200: 17 events, `ticket_types[].tickets[]` with `price` in kobo, `address.latitude/longitude`, `vendor.name`, `category.name`. No contact fields. No per-ticket sold out flag.
- 2026-11-02: Eventbrite Lagos "this week" list: 19 JSON-LD items, date only start. Event page JSON-LD has full time with `+01:00`, `AggregateOffer` in USD for one event, `organizer.name`, and an event `url` that named a different id from the card opened.
- 2026-11-02: Luma Lagos page: 5 featured events with host `instagram_handle`; paid `ticket_info.price` shape not seen yet.
- Not run in the trial: Partyverse (Instagram), Nairabox, Afritickets, Ariya, Syticks, Show.ng, Selar, AllEvents, Meetup, dev.events, StartupMapHub, 10times, CreateWith, media roundups, hubs, tentpoles. First run for each: note what works here.
