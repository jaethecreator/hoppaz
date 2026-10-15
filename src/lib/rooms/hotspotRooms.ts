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
  hero: { id: string; name: string; blurb: string };
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
      { id: "mila", name: "Mila", kind: "restaurant", blurb: "Mila Kitchen & Cocktail Bar's Akoka setting.", address: "Akoka, Lagos", source: "https://www.milalagos.com/", status: "Opening soon" },
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
      { id: "bay", name: "Bay Lounge", kind: "bar", blurb: "A waterfront stop on Admiralty Road.", address: "Block 12A, 10 Admiralty Road, Lekki Phase 1, Lagos", source: "https://www.thebaylounge.com/" },
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
      { id: "terra", name: "Terra Kulture", kind: "stage", blurb: "A culture and performance corner inspired by Terra Kulture on Tiamiyu Savage Street.", address: "1376 Tiamiyu Savage Street, Victoria Island, Lagos", source: "https://restaurant.terrakulture.com/" },
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
      { id: "kalakuta", name: "Kalakuta Museum", kind: "museum", blurb: "A music and heritage corner inspired by Fela's legacy at Kalakuta Museum in Allen.", address: "7 Gbemisola Street, Allen, Ikeja, Lagos", source: "https://www.kalakutamuseum.com/" },
      { id: "shrine", name: "New Afrika Shrine", kind: "stage", blurb: "A stage corner inspired by the New Afrika Shrine, Ikeja's home of live music.", address: "Pepple Street, Ikeja, Lagos" },
      { id: "computer-village", name: "Computer Village", kind: "market", blurb: "Phones, gadgets and repairs: the plug market of Otigba Street.", address: "Otigba Street, Ikeja, Lagos" },
      { id: "place-gra", name: "The Place GRA", kind: "restaurant", blurb: "A familiar Ikeja food stop with a listed branch on Isaac John Street.", address: "45 Isaac John Street, GRA, Ikeja, Lagos", source: "https://www.theplace.com.ng/locations/" },
    ],
    local: ["roundabout", "danfo", "keke", "phone stalls", "palm", "billboard"],
  },
];

export const hotspotRoomData = (slug: string | null | undefined): HotspotRoomData | null => HOTSPOT_ROOM_DATA.find((h) => h.slug === slug) ?? null;
