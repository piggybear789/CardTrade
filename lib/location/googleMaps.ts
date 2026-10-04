// lib/location/googleMaps.ts
//
// Google Maps integration: Places Autocomplete (New) for address search,
// Maps Embed API for map previews. Replaces the former Geoapify binding.
//
// APIs used (all require the same NEXT_PUBLIC_GOOGLE_MAPS_API_KEY):
//   - Places API (New): POST https://places.googleapis.com/v1/places:autocomplete
//   - Maps Embed API:   iframe src https://www.google.com/maps/embed/v1/place
//   - Geocoding API:    GET https://maps.googleapis.com/maps/api/geocode/json
//                       (reverse only — "Use my current location", see
//                       `reverseGeocodeSuburb`)
//
// The Embed API is free with unlimited usage. Places Autocomplete is billed
// per-request (no session tokens needed when we only need coordinates — we
// follow up with Geocoding rather than Place Details).

import type { PlacePrecision, PlaceValue } from './types';

export function readGoogleMapsKey(): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  return key || null;
}

// ---------------------------------------------------------------------------
// Places Autocomplete (New) — REST API
// ---------------------------------------------------------------------------

interface PlacePrediction {
  placeId: string;
  text: { text: string };
  structuredFormat?: {
    mainText: { text: string };
    secondaryText?: { text: string };
  };
  types?: string[];
}

interface AutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: PlacePrediction;
  }>;
}

/** Google Place Details (New) response for getting coordinates. */
interface PlaceDetailsResponse {
  location?: { latitude: number; longitude: number };
  addressComponents?: Array<{
    longText: string;
    shortText: string;
    types: string[];
  }>;
}

/**
 * Derive the `includedPrimaryTypes` filter from our precision model.
 * - `suburb`: localities, postal codes, administrative areas
 * - `exact`: everything (addresses, POIs, landmarks)
 */
function primaryTypesFor(precision: PlacePrecision): string[] | undefined {
  if (precision === 'suburb') {
    // Use the `(regions)` collection which covers localities, sublocalities,
    // postal codes, administrative areas — i.e. area-level results.
    return ['(regions)'];
  }
  // `exact` means any result type is valid (addresses, POIs, etc.)
  return undefined;
}

/**
 * Forward-autocomplete a query using Google Places Autocomplete (New).
 *
 * Worldwide by default. Use `options.countries` to restrict, or
 * `options.biasCountry` to bias without excluding.
 */
export async function searchPlaces(
  query: string,
  precision: PlacePrecision,
  options?: {
    limit?: number;
    signal?: AbortSignal;
    countries?: string[];
    biasCountry?: string | null;
  },
): Promise<PlaceValue[]> {
  const apiKey = readGoogleMapsKey();
  if (!apiKey || !query.trim()) return [];

  const body: Record<string, unknown> = {
    input: query.trim(),
    languageCode: 'en',
  };

  // Country restriction
  const countries = options?.countries?.filter(Boolean) ?? [];
  if (countries.length > 0) {
    body.includedRegionCodes = countries.map((c) => c.toLowerCase());
  }

  // Location bias — bias to a country without restricting
  const bias = options?.biasCountry?.trim().toLowerCase();
  if (bias && countries.length === 0) {
    // Bias toward the country's approximate centre. For AU that's roughly
    // -25.27, 133.77. For simplicity, we use regionCode which biases results.
    body.regionCode = bias;
  }

  // Type restriction
  const types = primaryTypesFor(precision);
  if (types) {
    body.includedPrimaryTypes = types;
  }

  const url = `https://places.googleapis.com/v1/places:autocomplete`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!res.ok) return [];
  const data = (await res.json()) as AutocompleteResponse;

  const predictions = (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is PlacePrediction => p != null)
    .slice(0, options?.limit ?? 5);

  // Fetch coordinates for each prediction via Place Details (New).
  // We request only `location` + `addressComponents` to minimise cost.
  const places = await Promise.all(
    predictions.map((p) => resolvePlace(p, precision, apiKey, options?.signal)),
  );

  return places.filter((p): p is PlaceValue => p != null);
}

/**
 * Resolve a place prediction to a full PlaceValue with coordinates.
 * Uses Google Place Details (New) with a minimal field mask.
 */
async function resolvePlace(
  prediction: PlacePrediction,
  precision: PlacePrecision,
  apiKey: string,
  signal?: AbortSignal | null,
): Promise<PlaceValue | null> {
  const url = `https://places.googleapis.com/v1/places/${prediction.placeId}`;
  try {
    const res = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'location,addressComponents',
      },
      signal: signal ?? undefined,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PlaceDetailsResponse;
    if (!data.location) return null;

    const countryComponent = data.addressComponents?.find((c) =>
      c.types.includes('country'),
    );

    return {
      label: prediction.structuredFormat
        ? [
            prediction.structuredFormat.mainText.text,
            prediction.structuredFormat.secondaryText?.text,
          ]
            .filter(Boolean)
            .join(', ')
        : prediction.text.text,
      placeId: prediction.placeId,
      lat: data.location.latitude,
      lng: data.location.longitude,
      countryCode: countryComponent?.shortText?.toUpperCase() ?? null,
      precision,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Maps Static API — image URL for suburb-level previews
// ---------------------------------------------------------------------------

/**
 * Google Maps Static API image URL. Returns a plain image (no iframe overhead,
 * no Google branding bar eating the frame). Ideal for suburb-level previews
 * where an interactive map adds nothing.
 *
 * Requires the Maps Static API enabled on the key.
 */
export function staticMapUrl(
  lat: number,
  lng: number,
  options?: {
    width?: number;
    height?: number;
    zoom?: number;
    precision?: PlacePrecision | null;
  },
): string | null {
  const apiKey = readGoogleMapsKey();
  if (!apiKey) return null;

  const width = options?.width ?? 640;
  const height = options?.height ?? 200;
  const zoom =
    options?.zoom ??
    (options?.precision === 'exact' ? 15 : 12);

  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size: `${width}x${height}`,
    scale: '2', // retina
    maptype: 'roadmap',
    markers: `color:red|${lat},${lng}`,
    key: apiKey,
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params}`;
}

// ---------------------------------------------------------------------------
// Maps Embed API — iframe URL for exact/meeting-point maps
// ---------------------------------------------------------------------------

/**
 * Google Maps Embed API URL for a place/coordinate.
 *
 * The Embed API is FREE with unlimited usage. It renders an interactive map
 * in an iframe — no JS map library needed. Returns null when the key is missing.
 *
 * Zoom is controlled indirectly via the `zoom` param in the Embed URL.
 */
const ZOOM_BY_PRECISION: Record<PlacePrecision, number> = {
  suburb: 13,
  exact: 16,
};

const DEFAULT_ZOOM = 13;

export function embedMapUrl(
  lat: number,
  lng: number,
  options?: {
    zoom?: number;
    precision?: PlacePrecision | null;
  },
): string | null {
  const apiKey = readGoogleMapsKey();
  if (!apiKey) return null;

  const zoom =
    options?.zoom ??
    (options?.precision ? ZOOM_BY_PRECISION[options.precision] : DEFAULT_ZOOM);

  const params = new URLSearchParams({
    key: apiKey,
    q: `${lat},${lng}`,
    zoom: String(zoom),
  });

  return `https://www.google.com/maps/embed/v1/place?${params}`;
}

// ---------------------------------------------------------------------------
// External link (Open in Google Maps)
// ---------------------------------------------------------------------------

/** Google Maps deep link for "Open in Maps". */
export function mapsExternalUrl(lat: number, lng: number, label?: string): string {
  const q = label ? encodeURIComponent(label) : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// ---------------------------------------------------------------------------
// Geocoding API — reverse geocode a device position to its SUBURB
// ---------------------------------------------------------------------------

interface GeocodeResponse {
  status: string;
  results?: Array<{
    place_id: string;
    types: string[];
    geometry: { location: { lat: number; lng: number } };
    address_components: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }>;
}

/**
 * The suburb (locality) containing a point, as a suburb-precision `PlaceValue`.
 *
 * THE RETURNED COORDINATES ARE THE SUBURB'S, NOT THE DEVICE'S. A listing's "Based
 * near" pin is public, and the position the browser hands over can be accurate to a
 * front door. Only the locality's own centroid and place id leave this function, so
 * the result is exactly what picking the suburb from the autocomplete would have
 * stored — the device position is used for the lookup and then dropped.
 *
 * The label is built as `Suburb, STATE, Country`, the same shape the autocomplete
 * produces ("Croydon, NSW, Australia"), so a located place and a searched one read
 * identically on the listing.
 *
 * Requires the Geocoding API enabled on the key. Returns null on any failure
 * (disabled API, no locality at that point, network) so the caller can fall back
 * to search.
 */
export async function reverseGeocodeSuburb(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<PlaceValue | null> {
  const apiKey = readGoogleMapsKey();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    // `postal_town` is the UK's equivalent of a locality; elsewhere it is unused.
    result_type: 'locality|postal_town',
    key: apiKey,
  });

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
      { signal },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as GeocodeResponse;
    if (data.status !== 'OK' || !data.results?.length) return null;

    const result =
      data.results.find((r) => r.types.includes('locality')) ?? data.results[0];
    const component = (type: string) =>
      result.address_components.find((c) => c.types.includes(type));

    const suburb = component('locality') ?? component('postal_town');
    if (!suburb) return null;
    const state = component('administrative_area_level_1');
    const country = component('country');

    return {
      label: [suburb.long_name, state?.short_name, country?.long_name]
        .filter(Boolean)
        .join(', '),
      placeId: result.place_id,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      countryCode: country?.short_name?.toUpperCase() ?? null,
      precision: 'suburb',
    };
  } catch {
    return null;
  }
}
