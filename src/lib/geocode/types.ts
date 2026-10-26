/**
 * Place search for the create-an-event Where step. The browser talks to /api/geocode, the route talks to one provider.
 * A provider answers in the shapes below and nothing else, so swapping Photon for Google Places later touches one file.
 */

/** One suggestion from a search. */
export type PlaceSuggestion = {
  /** Stable enough for a list key: provider id, else name and coordinates. */
  id: string;
  /** The venue or street name, as a host would say it. */
  name: string;
  /** The rest of the address on one line (street, district, city). May be empty. */
  address: string;
  lat: number;
  lng: number;
};

/** What the Where step hands to the form: a name for the event page, the address line, and the pin. */
export type PlaceSpot = {
  place_name: string;
  address: string;
  lat: number;
  lng: number;
  /** True when the host dropped the pin by hand: the name is typed, the address is a guess from the pin. */
  manual?: true;
};

export interface GeocodeProvider {
  /** Short name for logs and the cache key. */
  readonly name: string;
  /** Up to MAX_RESULTS suggestions for a typed query, already limited to Lagos where the provider can. */
  search(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]>;
  /** A short address line for a point, or null when there is nothing near. Optional. */
  reverse?(lat: number, lng: number, signal?: AbortSignal): Promise<string | null>;
}
