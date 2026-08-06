// Shared place shape for listings (suburb) and meetup pins (exact).

export type PlacePrecision = 'suburb' | 'exact';

/** A resolved place ready to persist / show on a map. */
export interface PlaceValue {
  /** Human label, e.g. "Fitzroy, VIC" or a street / POI name. */
  label: string;
  /** Provider place id (Google place_id, or synthetic text:/geo: fallback). */
  placeId: string;
  lat: number;
  lng: number;
  /**
   * ISO 3166-1 alpha-2 country of the resolved place, uppercased. Null on the
   * free-text fallback, which has no resolved country. Carried so the catalog can
   * scope by country without re-geocoding a stored label.
   */
  countryCode?: string | null;
  precision: PlacePrecision;
}

/**
 * Fallback map centre (Melbourne CBD), used ONLY when a place has no resolved
 * coordinates.
 *
 * This is not a statement about where the marketplace operates — the autocomplete
 * is worldwide (see `searchPlaces`). It is a last-resort centre so a map has
 * something to render. A place built on this centre must not be shown on a map as
 * if it were the user's location: see the `text:` guard in `PlacePicker`.
 */
export const FALLBACK_MAP_CENTER = { lat: -37.8136, lng: 144.9631 } as const;
