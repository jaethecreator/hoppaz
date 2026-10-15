/**
 * What each hotspot room says about its real place: the sign, the colours, the welcome line, Paz's line and the four
 * venues on its landmarks. Data only (no JSX, no imports): the art (src/components/campaign/art/Hotspot*Art.tsx), the
 * layouts (src/lib/campaign/rooms/hotspot*.ts) and scripts/rooms/check-campaign.mjs all read it.
 *
 * Slugs are the 13 in supabase/hotspot_zones.sql. `wave` is the roll-out order there (1 is open). Place data comes from
 * the other copy's catalog (~/hoppaz-scratch-1007, snapshot rooms/snapshot/rooms-2026-10-14) for its venue names,
 * addresses and sources, and from Jae's plan notes for the local flavour. The looks are new.
 *
 * Real venue names are on the landmarks on purpose (Jae, 15 Oct). Each is shown by name only: no logos, no photos, and
 * every blurb says "inspired by" or points at the venue's own page, so a room never claims to be the venue. A venue whose
 * own site says it is not open yet carries `status`.
 */
export type LandmarkKind = "campus" | "cinema" | "restaurant" | "bar" | "gallery" | "museum" | "stage" | "garden" | "shop" | "lounge" | "market" | "station" | "hotel" | "landmark";

export type HotspotLandmark = {
  /** Stable. Used in the prop id (`venue-<n>`) mapping and in cards. */
  id: string;
  /** The real venue's name, as it is signed. */
  name: string;
  kind: LandmarkKind;
  /** One line for the card in the room: what the corner is, never a claim to be the venue. */
  blurb: string;
  address?: string;
  /** The venue's own page, or the listing the name came from. */
  source?: string;
  /** Only when the venue's own page says it is not open yet. */
  status?: string;
  /** Something about this venue that could not be verified, for the person who confirms the names. Never shown in the app. */
  verify?: string;
};

export type HotspotRoomData = {
  slug: string;
  wave: 1 | 2 | 3 | 4;
  /** The junction the hotspot is named for (`hotspots.junction`), shown on the sign. */
  junction: string;
  /** The sign over the room, upper case. */
  sign: string;
  /** What the zone is called to people ("Yaba"). */
  place: string;
  /** Two roads that meet at the junction. */
  roads: [string, string];
  /** The room's three colours (hex): the signs and awnings use them, the street is shared. */
  palette: { primary: string; secondary: string; accent: string };
  /** The line on the welcome card. Short, second person, no em dash. */
  welcome: string;
  /** Paz's line when you walk in. */
  paz: string;
  /** The hero landmark: the one big thing that tells you where you are. */
  hero: { id: string; name: string; blurb: string; /** What it looks like, for whoever draws the room. Not shown. */ art?: string };
  /** Exactly four venues, in the order they sit in the room (left to right). */
  landmarks: [HotspotLandmark, HotspotLandmark, HotspotLandmark, HotspotLandmark];
  /** Local objects the art draws round the hero (danfo, brt, railway ...), for the art file's author and the check. */
  local: string[];
};

export const HOTSPOT_ROOM_DATA: HotspotRoomData[] = [
  {
    slug: "yaba",
    wave: 1,
    junction: "Jibowu",
    sign: "JIBOWU",
    place: "Yaba",
    roads: ["Herbert Macaulay Street", "Murtala Muhammed Way"],
    palette: { primary: "#F2B705", secondary: "#0E0B0A", accent: "#FF4D00" },
    welcome: "Jibowu. Danfos, trains and students. Everybody passes through.",
    paz: "Jibowu never sits still. Walk, wave, say hi.",
    hero: { id: "jibowu-junction", name: "Jibowu junction", blurb: "The BRT shelter, the footbridge and the railway crossing, all on one corner." },
    landmarks: [
      { id: "unilag", name: "UNILAG", kind: "campus", blurb: "A campus gate inspired by the University of Lagos in Akoka.", address: "University of Lagos, Akoka, Lagos", source: "https://unilag.edu.ng/campus/" },
      { id: "ozone", name: "Ozone Cinemas", kind: "cinema", blurb: "Yaba's cinema stop at the E-Centre on Commercial Avenue.", address: "E-Centre, 1-11 Commercial Avenue, Yaba, Lagos", source: "https://ozone.reachcinema.io/" },
      { id: "mila", name: "Mila", kind: "restaurant", blurb: "Mila Kitchen & Cocktail Bar's Akoka setting.", address: "Akoka, Lagos", source: "https://www.milalagos.com/", verify: "Its site still says opening soon, but it posted food and cocktails on 13 Oct 2026. Shown as open." },
      { id: "beeriga", name: "Beeriga", kind: "bar", blurb: "A waterfront hangout at Bariga Jetty.", address: "Beeriga, Bariga Jetty, Lagos", source: "https://ranked.ng/place/beeriga-7gq2tw" },
    ],
    local: ["danfo", "keke", "brt shelter", "footbridge", "railway crossing", "suya grill"],
  },
  {
    slug: "lekki",
    wave: 1,
    junction: "Lekki Phase 1 (Admiralty Way)",
    sign: "LEKKI PHASE 1",
    place: "Lekki",
    roads: ["Admiralty Way", "Fatai Idowu Arobieke Street"],
    palette: { primary: "#3E8FB8", secondary: "#F5EBDD", accent: "#FF4D00" },
    welcome: "Lekki Phase 1. Admiralty Way, the lagoon and good company.",
    paz: "Breeze is free. Walk the lagoon edge.",
    hero: { id: "admiralty-lagoon-edge", name: "Admiralty Way lagoon edge", blurb: "The strip runs down to the lagoon, with the Lekki-Ikoyi bridge pylon on the skyline." },
    landmarks: [
      { id: "bay", name: "Bay Lounge", kind: "bar", blurb: "A waterfront stop on Admiralty Road.", address: "Block 12A, 10 Admiralty Road, Lekki Phase 1, Lagos", source: "https://www.instagram.com/thebayloungelekki/" },
      { id: "circa", name: "Circa Lagos", kind: "restaurant", blurb: "A Lekki dining stop on Kola Adeyina Close.", address: "Kola Adeyina Close, Lekki Phase 1, Lagos", source: "https://www.tripadvisor.ca/Restaurant_Review-g2492082-d14791977-Reviews-Circa_Lagos-Lekki_Lagos_State.html" },
      { id: "eros", name: "Ilé Eros", kind: "restaurant", blurb: "A contemporary Nigerian dining stop in Lekki Phase 1.", address: "5b Abeke Animashaun Street, Lekki Phase 1, Lagos", source: "https://www.waze.com/live-map/directions/ng/la/lagos/ile-eros-lagos?to=place.ChIJcylNVdP1OxAREeaFqp4aYmc" },
      { id: "nature", name: "Lekki Conservation Centre", kind: "garden", blurb: "A planted corner inspired by the wider Lekki area's conservation heritage.", address: "Lekki Conservation Centre, Lagos", source: "https://ncfnigeria.org/our-centers/" },
    ],
    local: ["palm", "lagoon water", "jetty", "bridge pylon", "keke", "bicycle rack"],
  },
  {
    slug: "victoria-island",
    wave: 1,
    junction: "Adeola Odeku",
    sign: "ADEOLA ODEKU",
    place: "Victoria Island",
    roads: ["Akin Adesola Street", "Adeola Odeku Street"],
    palette: { primary: "#C94A8A", secondary: "#0E0B0A", accent: "#F2B705" },
    welcome: "Adeola Odeku. Lounges, lights and the island at full volume.",
    paz: "The island is loud tonight. Find your corner.",
    hero: { id: "odeku-lounge-strip", name: "The Adeola Odeku lounge strip", blurb: "Neon signs down both sides and a queue that never ends." },
    landmarks: [
      { id: "terra", name: "Terra Kulture", kind: "stage", blurb: "A culture and performance corner inspired by Terra Kulture on Tiamiyu Savage Street.", address: "1376 Tiamiyu Savage Street, Victoria Island, Lagos", source: "https://terrakulture.com" },
      { id: "rsvp", name: "RSVP", kind: "restaurant", blurb: "A Victoria Island dining stop with space for gatherings.", address: "RSVP Lagos, Victoria Island, Lagos", source: "https://rsvplagos.com/" },
      { id: "eko", name: "Eko Hotels", kind: "hotel", blurb: "An event pavilion inspired by Eko Hotels' convention and performance spaces.", address: "1415 Adetokunbo Ademola Street, Victoria Island, Lagos", source: "https://www.ekohotels.com/" },
      { id: "place", name: "The Place", kind: "restaurant", blurb: "A familiar food stop with a Victoria Island branch on Adetokunbo Ademola Street.", address: "15 Adetokunbo Ademola Street, Victoria Island, Lagos", source: "https://www.theplace.com.ng/locations/" },
    ],
    local: ["neon signs", "valet stand", "keke", "palm", "billboard", "suya grill"],
  },
  {
    slug: "ikeja",
    wave: 1,
    junction: "Allen Roundabout",
    sign: "ALLEN",
    place: "Ikeja",
    roads: ["Allen Avenue", "Obafemi Awolowo Way"],
    palette: { primary: "#2FA84F", secondary: "#0E0B0A", accent: "#F2B705" },
    welcome: "Allen. Fela's side of town, phones, plugs and good food.",
    paz: "Allen is Allen. Walk the circle, find your people.",
    hero: { id: "allen-roundabout", name: "Allen Roundabout", blurb: "The circle at the middle of Allen Avenue, with the whole of Ikeja round it." },
    landmarks: [
      { id: "kalakuta", name: "Kalakuta Museum", kind: "museum", blurb: "A music and heritage corner inspired by Fela's legacy at Kalakuta Museum in Allen.", address: "Gbemisola Street, off Allen Avenue, Ikeja, Lagos", source: "https://felakuti.com/legacy/kalakuta-museum", verify: "House number 7 or 8 (sources disagree), no site of its own." },
      { id: "shrine", name: "New Afrika Shrine", kind: "stage", blurb: "A stage corner inspired by the New Afrika Shrine, Ikeja's home of live music.", address: "NERDC Road, Agidingbi, Ikeja, Lagos", source: "https://felakuti.com/legacy/new-afrika-shrine" },
      { id: "computer-village", name: "Computer Village", kind: "market", blurb: "Phones, gadgets and repairs: the plug market of Otigba Street.", address: "Otigba Street, Ikeja, Lagos", verify: "Still trading in 2026 (a move to Katangowa has stalled, Nairametrics 28 Jun 2026). No site of its own." },
      { id: "place-gra", name: "The Place GRA", kind: "restaurant", blurb: "A familiar Ikeja food stop with a listed branch on Isaac John Street.", address: "45 Isaac John Street, GRA, Ikeja, Lagos", source: "https://www.theplace.com.ng/locations/" },
    ],
    local: ["roundabout", "danfo", "keke", "phone stalls", "palm", "billboard"],
  },
  // ---- Waves 2 to 4: place data only. No room is drawn for these yet (HOTSPOT_ROOMS in templates.ts lists the drawn ones).
  {
    slug: "lagos-island",
    wave: 2,
    junction: "Obalende",
    sign: "OBALENDE",
    place: "Lagos Island",
    roads: ["Obalende Road", "Massey Bamgboshe Street"],
    palette: { primary: "#0B4F6C", secondary: "#F4D58D", accent: "#FF4D00" },
    welcome: "Obalende. Suya smoke, TBS lights and the whole Island on one junction.",
    paz: "Suya first, then TBS. Do not make me ask twice.",
    hero: { id: "tafawa-balewa-square", name: "Tafawa Balewa Square", blurb: "The wide square at the heart of Lagos Island, with its gate of white horses.", art: "Wide open square behind a gate topped with four white horse sculptures and red eagles, tall Independence House tower behind it." },
    landmarks: [
      { id: "glover-memorial-hall", name: "Glover Memorial Hall", kind: "stage", blurb: "Inspired by the old Marina hall where Lagos has watched plays and concerts for generations.", address: "Customs Street, Marina, Lagos Island", source: "https://en.wikipedia.org/wiki/Glover_Memorial_Hall" },
      { id: "freedom-park", name: "Freedom Park", kind: "garden", blurb: "Inspired by the old prison yard turned park: open stage, old cell walls, food court, live music nights.", address: "1 Hospital Road (old Broad Street prison site), Lagos Island", source: "https://www.freedomparklagos.com" },
      { id: "muson-centre", name: "MUSON Centre", kind: "stage", blurb: "Inspired by the Onikan concert hall for choir, orchestra and big shows, a short walk from TBS.", address: "8/9 Marina, Onikan, Lagos Island", source: "https://en.wikipedia.org/wiki/Muson_Centre" },
      { id: "obalende-bus-terminus", name: "Obalende Bus Terminus", kind: "station", blurb: "Inspired by the busy Obalende terminus beside Suya Junction: BRT, danfo and grill smoke after dark.", address: "Ikoyi Road, Obalende, Lagos Island", source: "https://www.byfood.com/experiences/lagos-street-food-walking-tour-47808", verify: "Name from a food tour page; confirm the stop's name." },
    ],
    local: ["danfo", "BRT bus", "suya grill stand", "hawker with a tray on the head", "Marina boat", "cricket whites on the TBS oval", "bunting and flags"],
  },
  {
    slug: "ikoyi",
    wave: 2,
    junction: "Bourdillon (Alexander Avenue), Ikoyi",
    sign: "BOURDILLON",
    place: "Ikoyi",
    roads: ["Bourdillon Road", "Alexander Avenue"],
    palette: { primary: "#2E4A3E", secondary: "#E8DCC4", accent: "#C9A24B" },
    welcome: "Bourdillon side of Ikoyi. Dress nice, speak soft, tip loud.",
    paz: "Bridge on the left, money on the right. Walk well.",
    hero: { id: "lekki-ikoyi-link-bridge", name: "Lekki-Ikoyi Link Bridge", blurb: "The cable-stayed bridge that ties Ikoyi to Lekki, lit up over the lagoon.", art: "Long cable-stayed bridge over the creek, one tall pylon with a fan of cables, lagoon water and Ikoyi skyline behind it." },
    landmarks: [
      { id: "bogobiri-house", name: "Bogobiri House", kind: "hotel", blurb: "Inspired by the Afrocentric boutique hotel with an art gallery, a bamboo bar and live music nights.", address: "9 Maitama Sule Street, off Awolowo Road, Ikoyi", source: "https://en.wikipedia.org/wiki/Bogobiri_House" },
      { id: "the-jazzhole", name: "The Jazzhole", kind: "shop", blurb: "Inspired by the record shop, bookstore and cafe where jazz vinyl and African books fill the shelves.", address: "168 Awolowo Road, Ikoyi", source: "https://www.thevinylfactory.com/features/the-worlds-best-record-shops-055-the-jazz-hole-lagos" },
      { id: "danfo-bistro", name: "Danfo Bistro", kind: "restaurant", blurb: "Inspired by the Nigerian-classics bistro off Bourdillon, named for the yellow bus, built for group nights out.", address: "2 Alexander Road, off Bourdillon Road, Ikoyi", source: "https://urbanpumpkin.com/best-restaurants-in-ikoyi/" },
      { id: "pitstop-village", name: "Pitstop Village", kind: "restaurant", blurb: "Inspired by the Alexander Avenue village: coffee roastery, healthy plates, reservation-only dining room.", address: "44/46 Alexander Avenue, Ikoyi", source: "https://urbanpumpkin.com/best-restaurants-in-ikoyi/" },
    ],
    local: ["danfo passing through", "black SUV", "palm-lined avenue", "estate gate with security guard", "lagoon boats", "hawker with plantain chips", "LASTMA officer"],
  },
  {
    slug: "surulere",
    wave: 2,
    junction: "Ojuelegba",
    sign: "OJUELEGBA",
    place: "Surulere, Mushin and Oshodi",
    roads: ["Western Avenue", "Ojuelegba Road"],
    palette: { primary: "#6BBF2A", secondary: "#1A1A1A", accent: "#FF4D00" },
    welcome: "Ojuelegba. Wizkid made it a song, now you are standing in it.",
    paz: "Ojuelegba bridge, danfo below. Mind the horn.",
    hero: { id: "ojuelegba-bridge", name: "Ojuelegba Bridge", blurb: "The flyover over Ojuelegba junction, danfos and Red Line trains all round it.", art: "Concrete flyover over a packed junction, danfo jammed underneath, hawkers weaving through, billboards on every side." },
    landmarks: [
      { id: "sankofa-lounge-and-bar", name: "Sankofa Lounge and Bar", kind: "lounge", blurb: "Inspired by the Adeniran Ogunsanya Street lounge that runs late, with a restaurant and live entertainment.", address: "62 Adeniran Ogunsanya Street, Surulere", source: "https://wanderlog.com/place/details/13314778/sankofa-lounge-and-bar--restaurant--club--surulere-lagos" },
      { id: "adeniran-ogunsanya-shopping-mall", name: "Adeniran Ogunsanya Mall", kind: "shop", blurb: "Inspired by the street's shopping mall of about 150 shops and a car park, redone in 2011.", address: "Adeniran Ogunsanya Street, Surulere", source: "https://en.wikipedia.org/wiki/Adeniran_Ogunsanya_Street,_Lagos" },
      { id: "teslim-balogun-stadium", name: "Teslim Balogun Stadium", kind: "landmark", blurb: "Inspired by Surulere's football ground, rebuilt for EKO 2026 with a new grass pitch and new seats.", address: "Surulere, Lagos", source: "https://allafrica.com/stories/202608100719.html" },
      { id: "wole-soyinka-centre-national-theatre", name: "National Theatre", kind: "stage", blurb: "Inspired by the big theatre in Iganmu, reopened in 2025, with its own Blue Line stop.", address: "Iganmu, off Badagry Road, Surulere", source: "https://www.icirnigeria.org/heres-what-to-know-about-national-theatre-renamed-wole-soyinka-centre/" },
    ],
    local: ["danfo", "keke", "BRT bus", "hawker with sachets and gala", "football jerseys on a rack", "Red Line train", "billboards", "generator"],
  },
  {
    slug: "ojota",
    wave: 3,
    junction: "Ojota",
    sign: "OJOTA",
    place: "Ojota and Gbagada",
    roads: ["Ikorodu Road", "Ogudu Road"],
    palette: { primary: "#B3261E", secondary: "#2B2D42", accent: "#FFB703" },
    welcome: "Ojota. Everybody passes through. You came to stay.",
    paz: "Ojota never sleeps. It just changes drivers.",
    hero: { id: "ojota-interchange", name: "Ojota Interchange", blurb: "The big interchange where Ikorodu Road meets Ogudu Road, buses in every lane.", art: "Big road interchange on Ikorodu Road with pedestrian bridges overhead, a crowded bus stop below, buses and danfo everywhere." },
    landmarks: [
      { id: "mile-12-market", name: "Mile 12 Market", kind: "market", blurb: "Inspired by Lagos' big wholesale food market: trucks of tomatoes, onions and yams, baskets and shouting.", address: "Mile 12, Ketu, Ikorodu Road, Lagos", source: "https://archive.businessday.ng/features/article/mile-12-market-preferred-destination-for-lagos-wholesalers-retailers/" },
      { id: "ojota-bus-stop", name: "Ojota Bus Stop", kind: "station", blurb: "Inspired by the crowded Ojota terminus for local and interstate buses, pedestrian bridge overhead.", address: "Ojota, Ikorodu Road, Kosofe", source: "https://intercity.ng/blog/most-popular-bus-stops-in-lagos" },
      { id: "the-poise-bar-rooftop", name: "The Poise Bar Rooftop", kind: "bar", blurb: "Inspired by the Ogudu Road rooftop bar and lounge on top of FishFarm Lagos: food, drinks, open sky.", address: "1-3 Ogudu Road, Ogudu (inside FishFarm Lagos)", source: "https://www.instagram.com/thepoisebarrooftoplagos/", verify: "Instagram only; confirm." },
      { id: "third-mainland-bridge", name: "Third Mainland Bridge", kind: "landmark", blurb: "Inspired by the long lagoon bridge that starts at Oworonshoki and runs across to the Island.", address: "Starts at Oworonshoki, ends at Adeniji Adele, Lagos Island", source: "https://en.wikipedia.org/wiki/Third_Mainland_Bridge" },
    ],
    local: ["danfo", "BRT bus", "keke", "interstate coach", "pedestrian bridge", "market truck loaded with tomatoes", "hawker with groundnut and zobo"],
  },
  {
    slug: "festac",
    wave: 3,
    junction: "Mile 2",
    sign: "MILE 2",
    place: "Festac and Apapa",
    roads: ["Lagos-Badagry Expressway", "Jakande Estate Road"],
    palette: { primary: "#7B2D8E", secondary: "#F6C90E", accent: "#00B4A6" },
    welcome: "Mile 2. Train overhead, trailers below, you in the middle.",
    paz: "Blue Line up top, bus below. Pick one.",
    hero: { id: "mile-2-blue-line-station", name: "Mile 2 Station", blurb: "The Blue Line station raised over the Badagry Expressway, trailers rolling below.", art: "Raised concrete rail viaduct with a blue train and station platform above a crowded bus park and the Mile 2 bridge." },
    landmarks: [
      { id: "boundary-market-ajegunle", name: "Boundary Market", kind: "market", blurb: "Inspired by Ajegunle's Boundary market: open stalls and lock-up shops for food, clothes and livestock.", address: "Boundary, Ajegunle, Ajeromi-Ifelodun", source: "https://en.wikipedia.org/wiki/Ajeromi-Ifelodun" },
      { id: "shugaspot", name: "Shugaspot", kind: "lounge", blurb: "Inspired by the Festac 4th Avenue spot with live music, DJ mashups and roomy seating.", address: "4th Avenue, 402 Road, B Close, Festac Town", source: "https://bestlagos.ng/best-lounges-festac/", verify: "One listing only; confirm it is open." },
      { id: "the-grasshopper-place", name: "The Grasshopper Place", kind: "bar", blurb: "Inspired by the 1st Avenue hangout for comedy, karaoke and themed party nights.", address: "Plot 1, 1st Avenue, K Close, Festac Town", source: "https://bestlagos.ng/best-lounges-festac/", verify: "One listing only; confirm it is open." },
      { id: "festival-mall-festac", name: "Festival Mall", kind: "shop", blurb: "Inspired by the Amuwo Odofin mall beside the Festival Hotel, built around a supermarket and a cinema.", address: "Festival Mall, Janet Faje Street, Amuwo Odofin Estate", source: "https://archive.businessday.ng/real-estate/article/new-formal-experience-for-shoppers-as-festival-mall-opens-for-business/", verify: "Cinema operating in 2026 not confirmed." },
    ],
    local: ["danfo", "BRT bus", "Blue Line train overhead", "keke", "container truck", "tanker", "hawker with plantain chips", "Festac gate arch"],
  },
  {
    slug: "ajah",
    wave: 3,
    junction: "Ajah (Mobil Road)",
    sign: "AJAH",
    place: "Ajah and beyond",
    roads: ["Lekki-Epe Expressway", "Mobil Estate Road"],
    palette: { primary: "#00A6A6", secondary: "#F7E7CE", accent: "#FF4D00" },
    welcome: "Ajah. Past the traffic, past the bridge, now breathe.",
    paz: "The flyover is tall. Your plans should be taller.",
    hero: { id: "ajah-flyover", name: "Ajah Flyover", blurb: "The flyover that lifts the Lekki-Epe road over Ajah's busiest junction.", art: "Dual-carriageway flyover over a busy roundabout on the Lekki-Epe Expressway, danfo and BRT underneath, footbridges at both ends." },
    landmarks: [
      { id: "pan-atlantic-university", name: "Pan-Atlantic University", kind: "campus", blurb: "Inspired by the Lekki-Epe campus of Pan-Atlantic University and Lagos Business School.", address: "Km 22 Lekki-Epe Expressway, Ajah", source: "https://en.wikipedia.org/wiki/Ajah,_Lagos" },
      { id: "novare-lekki-mall", name: "Novare Lekki Mall", kind: "shop", blurb: "Inspired by the Sangotedo mall on the Lekki-Epe Expressway, with a supermarket and chain stores.", address: "Lekki-Epe Expressway at Cardinal Olubunmi Okojie Way, Sangotedo", source: "https://estateintel.com/novare-lekki-mall-opens-this-week/" },
      { id: "atican-beach", name: "Atican Beach", kind: "landmark", blurb: "Inspired by the Okun Ajah beach off Abraham Adesanya Estate Road, with a resort hotel on site.", address: "Abraham Adesanya Estate Road, Okun Ajah", source: "https://wakaabuja.com/atican-beach/" },
      { id: "la-campagne-tropicana", name: "La Campagne Tropicana", kind: "hotel", blurb: "Inspired by the Ibeju-Lekki resort of beach, lagoon and forest huts for weekend getaways.", address: "Ikegun, Ibeju-Lekki, off Lekki-Epe Expressway", source: "https://wakaabuja.com/la-campagne-tropicana/" },
    ],
    local: ["danfo", "BRT bus", "keke", "estate gate", "palm trees", "Mobil filling station", "hawker with roasted corn", "sand and block lorry"],
  },
  {
    slug: "alimosho",
    wave: 4,
    junction: "Ikotun",
    sign: "IKOTUN",
    place: "Alimosho",
    roads: ["Idimu - Ikotun Road", "Egbe Road"],
    palette: { primary: "#8E3B1F", secondary: "#F2D0A4", accent: "#FF4D00" },
    welcome: "Ikotun. Big market, bigger energy. Hold your bag, hold your head.",
    paz: "Ikotun market has everything. Even your next fit.",
    hero: { id: "ikotun-market", name: "Ikotun Market", blurb: "A sprawl of umbrellas and stalls where Ikotun buys and sells everything.", art: "Open-air market of crowded lock-up shops, umbrellas, bales of clothes and sellers calling out, the Ikotun roundabout beside it." },
    landmarks: [
      { id: "iyana-ipaja-terminal", name: "Iyana Ipaja Terminal", kind: "station", blurb: "Inspired by the Iyana Ipaja bus park where coaches and danfo load for Ikeja and beyond.", address: "Iyana Ipaja, Alimosho", source: "https://intercity.ng/blog/lagos-to-abuja-gigm-bus-guide-from-iyana-ipaja-terminal" },
      { id: "the-place-ikotun", name: "The Place", kind: "bar", blurb: "Inspired by the Ikotun club and lounge with live bands, big screens and snooker tables.", address: "Ikotun, Alimosho (street not confirmed)", source: "https://nigeriapropertycentre.com/area-guides/lagos/ikotun", verify: "One listing only; confirm." },
      { id: "kaf-mall", name: "KAF Mall", kind: "cinema", blurb: "Inspired by the Ikotun mall with a grocery bazaar, fast-food counters and a Filmworld cinema inside.", address: "Ikotun-Idimu Road, Ikotun (cinema listing)", source: "https://nigeriapropertycentre.com/area-guides/lagos/ikotun", verify: "Street address not found; confirm." },
      { id: "brainfield-event-centre", name: "Brainfield Event Centre", kind: "landmark", blurb: "Inspired by the Isheri-Igando Road event centre with a pool, a kids' play area and a cinema.", address: "Isheri-Igando Road, Igando", source: "https://nigeriapropertycentre.com/area-guides/lagos/ikotun", verify: "One listing only; confirm." },
    ],
    local: ["danfo", "keke", "BRT bus", "market umbrella stalls", "bale of second-hand clothes", "hawker with pure water sachets", "generator"],
  },
  {
    slug: "ojo-badagry",
    wave: 4,
    junction: "Iyana Iba",
    sign: "IYANA IBA",
    place: "Ojo and Badagry",
    roads: ["Lasu-Isheri Road", "Lagos-Badagry Expressway"],
    palette: { primary: "#4A2C2A", secondary: "#E9C46A", accent: "#2A9D8F" },
    welcome: "Iyana Iba. Gadgets, hustle and LASU, all on one road.",
    paz: "Alaba has the gadget. LASU has the gist.",
    hero: { id: "alaba-international-market", name: "Alaba International Market", blurb: "The electronics market of Ojo, stalls stacked with TVs and speakers.", art: "Huge electronics market of stacked shopfronts: TVs, speakers, fans and cables spilling onto the road, signboards everywhere." },
    landmarks: [
      { id: "lasu-ojo", name: "LASU Ojo", kind: "campus", blurb: "Inspired by LASU's Ojo main campus and the student crowd that fills Iba and First Gate.", address: "Km 15 Badagry Expressway, Ojo (LASU main campus)", source: "https://en.wikipedia.org/wiki/Lagos_State_University" },
      { id: "macaulays-lounge", name: "Macaulay's Lounge", kind: "lounge", blurb: "Inspired by the LASU Iba Road restaurant, bar and lounge near the Apple Bite bus stop, open late.", address: "1 Olokun Close, LASU Iba Road, Apple Bite Bus Stop, Ojo", source: "https://www.instagram.com/macaulayslounge/" },
      { id: "lagos-international-trade-fair-complex", name: "Trade Fair Complex", kind: "landmark", blurb: "Inspired by the old trade fair grounds on the Badagry Expressway, a big walled complex being revived.", address: "Lagos-Badagry Expressway, Ojo (PMB 0199, Festac Post Office)", source: "https://www.bpe.gov.ng/lagos-international-trade-fair-complex/" },
      { id: "badagry-heritage-museum", name: "Badagry Heritage Museum", kind: "museum", blurb: "Inspired by the Badagry museum in the former district officer's office from 1863, on slave trade history.", address: "Lander Road, Marina, Badagry", source: "https://www.aaa.com/tripcanvas/attraction/badagry-heritage-museum-VA23361" },
    ],
    local: ["danfo", "keke", "trailer on the Badagry Expressway", "stacked TVs and speakers outside shops", "hawker with pure water sachets", "boat on Badagry creek", "goods cart", "generator"],
  },
  {
    slug: "ikorodu",
    wave: 4,
    junction: "Ikorodu Garage",
    sign: "IKORODU GARAGE",
    place: "Ikorodu and Epe",
    roads: ["Ikorodu Road", "Ayangburen Road"],
    palette: { primary: "#2B59C3", secondary: "#CFE8FF", accent: "#FF9F1C" },
    welcome: "Ikorodu Garage. Long road, long queue, longer night.",
    paz: "Garage queue is long. The night is longer.",
    hero: { id: "ikorodu-garage", name: "Ikorodu Garage", blurb: "The garage where Ikorodu's buses load and the queue wraps round the block.", art: "Big motor park and bus terminal: rows of yellow danfo and BRT buses, queue lines, market stalls, conductors calling destinations." },
    landmarks: [
      { id: "lasustech", name: "LASUSTECH", kind: "campus", blurb: "Inspired by the LASUSTECH campus in Ikorodu, a university crowd on a lagoon-town road.", address: "Itoikin Road, Ikorodu", source: "https://en.wikipedia.org/wiki/Lagos_State_University_of_Science_and_Technology" },
      { id: "the-place-lounge-and-nightclub-ikorodu", name: "The Place Lounge", kind: "lounge", blurb: "Inspired by the Ayangburen Road lounge and nightclub that runs late with finger food and cocktails.", address: "52 Ayangburen Road, Ikorodu", source: "https://www.instagram.com/theplaceikd/", verify: "Last Instagram post Apr 2025; confirm it is open." },
      { id: "dream-park-cinemas", name: "Dream Park Cinemas", kind: "cinema", blurb: "Inspired by the Ikorodu entertainment centre with a cinema, pool, water slides and kids' game rooms.", address: "Obafemi Awolowo Road, Ikorodu (directory listing)", source: "https://en.wikipedia.org/wiki/Ikorodu", verify: "No street address found; confirm it is open." },
      { id: "ikorodu-ferry-terminal-ipakodo", name: "Ikorodu Ferry Terminal", kind: "station", blurb: "Inspired by the Ipakodo ferry jetty where boats cross the lagoon to Falomo, CMS and Ebute Ero.", address: "Ipakodo, Ikorodu", source: "https://thisdaylive.com/index.php/2018/03/23/lagos-renovates-upgrades-ikorodu-ferry-terminal", verify: "Ferry service has stopped and restarted since 2023; confirm." },
    ],
    local: ["danfo", "BRT bus", "keke", "queue barriers at the BRT lane", "market stalls", "ferry boat at the jetty", "hawker with oranges", "conductor shouting destinations"],
  },
];

export const hotspotRoomData = (slug: string | null | undefined): HotspotRoomData | null => HOTSPOT_ROOM_DATA.find((h) => h.slug === slug) ?? null;
