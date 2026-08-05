// Geoapify Address Autocomplete + Static Maps (browser-safe publishable key).

import type { PlacePrecision, PlaceValue } from './types';

export function readGeoapifyKey(): string | null {
  const key = process.env.NEXT_PUBLIC_GEOAPIFY_KEY?.trim();
  return key || null;
}

interface GeoapifyProperties {
  place_id?: string | number;
  name?: string;
  formatted?: string;
  address_line1?: string;
  city?: string;
  suburb?: string;
  state?: string;
  state_code?: string;
  country?: string;
  country_code?: string;
  result_type?: string;
  lat: number;
  lon: number;
}

interface GeoapifyFeature {
  properties: GeoapifyProperties;
}

interface GeoapifyAutocompleteResponse {
  features?: GeoapifyFeature[];
}

/**
 * Short region label. Geoapify returns ISO 3166-2 codes like `AU-VIC` or `US-CA`,
 * so strip whatever country prefix is present rather than assuming `AU-` — the
 * previous `/^AU-?/i` left `US-CA` intact for every non-Australian result.
 */
function stateShort(props: GeoapifyProperties): string | undefined {
  const code = props.state_code?.replace(/^[A-Z]{2}-/i, '').toUpperCase();
  if (code) return code;
  return props.state || undefined;
}

/**
 * Locality label. Includes the country when it is not the searcher's own, so
 * "Richmond, VIC" and "Richmond, VA, United States" are distinguishable — the
 * single most common way an international address picker misleads people.
 */
function suburbLabel(props: GeoapifyProperties, homeCountry?: string): string {
  const locality = props.suburb || props.city || props.name || props.address_line1;
  const state = stateShort(props);
  const foreign =
    props.country_code != null &&
    homeCountry != null &&
    props.country_code.toUpperCase() !== homeCountry.toUpperCase();
  const parts = [locality, state, foreign ? props.country : null].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return props.formatted || 'Unknown place';
}

function exactLabel(props: GeoapifyProperties, homeCountry?: string): string {
  return (
    props.formatted || props.address_line1 || props.name || suburbLabel(props, homeCountry)
  );
}

function toPlace(
  feature: GeoapifyFeature,
  precision: PlacePrecision,
  homeCountry?: string,
): PlaceValue {
  const props = feature.properties;
  const placeId =
    props.place_id != null
      ? String(props.place_id)
      : `geo:${props.lat},${props.lon}`;

  return {
    label:
      precision === 'suburb'
        ? suburbLabel(props, homeCountry)
        : exactLabel(props, homeCountry),
    placeId,
    lat: props.lat,
    lng: props.lon,
    countryCode: props.country_code?.toUpperCase() ?? null,
    precision,
  };
}

/** Geoapify `type` filter — suburb search stays at locality level. */
function typeFor(precision: PlacePrecision): string | undefined {
  return precision === 'suburb' ? 'locality' : undefined;
}

/**
 * Forward-autocomplete a query. Worldwide by default.
 *
 * WAS HARD-FILTERED TO `countrycode:au`. Do not reinstate that. A valid overseas
 * address returned an empty dropdown with no explanation, so the field looked
 * broken rather than restricted — the worst of both outcomes. If the marketplace
 * ever needs to constrain entry to specific countries, pass `countries` and say so
 * in the UI; never answer an out-of-scope address with silence.
 *
 * @param options.countries Optional ISO 3166-1 alpha-2 allowlist. Omit for worldwide.
 * @param options.biasCountry Ranks nearby results first WITHOUT excluding anything
 *   else. Bias is a preference; `filter` is a wall.
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
  const apiKey = readGeoapifyKey();
  if (!apiKey || !query.trim()) return [];

  const params = new URLSearchParams({
    text: query.trim(),
    apiKey,
    lang: 'en',
    limit: String(options?.limit ?? 5),
  });

  const countries = options?.countries?.filter(Boolean) ?? [];
  if (countries.length > 0) {
    params.set('filter', `countrycode:${countries.join(',').toLowerCase()}`);
  }

  const bias = options?.biasCountry?.trim().toLowerCase();
  if (bias) params.set('bias', `countrycode:${bias}`);

  const type = typeFor(precision);
  if (type) params.set('type', type);

  const url = `https://api.geoapify.com/v1/geocode/autocomplete?${params}`;
  const res = await fetch(url, { signal: options?.signal });
  if (!res.ok) return [];
  const body = (await res.json()) as GeoapifyAutocompleteResponse;
  return (body.features ?? []).map((f) =>
    toPlace(f, precision, options?.biasCountry ?? undefined),
  );
}

/** Google Maps deep link for "Open in Maps". */
export function mapsExternalUrl(lat: number, lng: number, label?: string): string {
  const q = label ? encodeURIComponent(label) : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/**
 * Zoom to use for each precision.
 *
 * Derived from ground resolution rather than taste. At 640 px wide, the frame
 * covers `640 * 156543 * cos(lat) / 2^zoom` metres, so in Sydney:
 *
 *   z11 -> 40 km   (metropolitan; two adjacent suburbs are ~17 px apart)
 *   z13 -> 10 km   (the suburb plus its neighbours)
 *   z15 -> 2.5 km  (streets around a single address)
 *
 * So 13 is already the right frame for a `suburb` centroid — it is NOT street
 * level — and 15 is the right frame for an `exact` meeting point, which 13 draws
 * too wide to be useful for finding a door.
 *
 * WHAT THIS CANNOT FIX. Locality size varies by two orders of magnitude: a Sydney
 * suburb is ~2 km across and Croydon Shire, QLD is ~170 km, needing about z8 to
 * frame. A single zoom per precision therefore renders remote localities as near
 * empty land. Measured on the real API, Croydon Shire is byte-identical at z10,
 * z12, z13 and z15 (96% flat land colour), while Burwood at z13 is 95% drawn
 * content. That is an accurate map of an empty place, not a broken request — the
 * principled fix is framing the geocoder's `bbox` for the place (Geoapify's `area=
 * rect:` parameter) instead of a centroid plus a guessed zoom, which needs the
 * bbox persisted alongside the coordinates.
 */
const ZOOM_BY_PRECISION: Record<PlacePrecision, number> = {
  suburb: 13,
  exact: 15,
};

/** Zoom for callers that specify neither `zoom` nor `precision`. */
const DEFAULT_ZOOM = 13;

/**
 * Geoapify Static Maps image URL (no JS map library).
 * Returns null when the publishable key is missing.
 */
export function staticMapUrl(
  lat: number,
  lng: number,
  options?: {
    width?: number;
    height?: number;
    /** Explicit zoom. Wins over `precision`. */
    zoom?: number;
    /** Derives an appropriate zoom — see {@link ZOOM_BY_PRECISION}. */
    precision?: PlacePrecision | null;
  },
): string | null {
  const apiKey = readGeoapifyKey();
  if (!apiKey) return null;

  const width = options?.width ?? 640;
  const height = options?.height ?? 360;
  const zoom =
    options?.zoom ??
    (options?.precision ? ZOOM_BY_PRECISION[options.precision] : DEFAULT_ZOOM);
  const params = new URLSearchParams({
    style: 'osm-bright',
    width: String(width),
    height: String(height),
    center: `lonlat:${lng},${lat}`,
    zoom: String(zoom),
    // Pass the colour as a RAW `#`. URLSearchParams percent-encodes the value
    // itself, so a pre-encoded `%23` became `%25 23` and Geoapify rejected the
    // whole request with 400 ("marker[0][1] does not match any of the allowed
    // types") — which surfaced as PlaceMap's onError fallback, i.e. every
    // location rendered as a bare "Open in Maps" link instead of a map.
    marker: `lonlat:${lng},${lat};color:#0f172a;size:medium`,
    apiKey,
  });

  return `https://maps.geoapify.com/v1/staticmap?${params}`;
}
