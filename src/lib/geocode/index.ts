import { googlePlaces } from "./google";
import { photon } from "./photon";
import type { GeocodeProvider } from "./types";

/**
 * The provider the server uses. GEOCODE_PROVIDER=google switches to Google Places once it is built; Photon until then.
 * Server only (the route imports it). The browser imports ./lagos and ./types directly, so no provider code ships to the phone.
 */
export function geocoder(): GeocodeProvider {
  return process.env.GEOCODE_PROVIDER === "google" ? googlePlaces : photon;
}
