// Shared place shape for listings (suburb) and meetup pins (exact).

export type PlacePrecision = 'suburb' | 'exact';

/** A resolved place ready to persist / show on a map. */
export interface PlaceValue {
  /** Human label, e.g. "Fitzroy, VIC" or a street / POI name. */
  label: string;
  /** Provider place id (Geoapify place_id, or synthetic text:/geo: fallback). */
  placeId: string;
  lat: number;
  lng: number;
  precision: PlacePrecision;
}

/** Australia-ish default map centre (Melbourne CBD). */
export const AU_DEFAULT_CENTER = { lat: -37.8136, lng: 144.9631 } as const;
