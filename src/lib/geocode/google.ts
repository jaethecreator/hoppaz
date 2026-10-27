import type { GeocodeProvider } from "./types";

/**
 * Google Places goes here, later. Not built and never called: nothing imports this file yet, and it makes no request.
 *
 * Why it may be wanted: OpenStreetMap knows fewer Lagos venues and house addresses than Google does. When the founder decides to
 * pay for it (check the current Places pricing and the free monthly allowance first), implement search() and reverse() below
 * against the Places API (New) Text Search or Autocomplete, keep the key in a server only env var (GOOGLE_PLACES_KEY, never
 * NEXT_PUBLIC_), restrict it to the Lagos box with locationRestriction, and return the same PlaceSuggestion rows. Then set
 * GEOCODE_PROVIDER=google (index.ts) and nothing else changes: the route, the cache, the rate limit and the screen stay as they are.
 */
export const googlePlaces: GeocodeProvider = {
  name: "google",
  async search() {
    throw new Error("The Google Places provider is not built yet");
  },
};
