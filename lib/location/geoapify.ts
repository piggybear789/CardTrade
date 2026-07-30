// Geoapify Address Autocomplete + Static Maps (browser-safe publishable key).

import { AU_DEFAULT_CENTER, type PlacePrecision, type PlaceValue } from './types';

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

function stateShort(props: GeoapifyProperties): string | undefined {
  const code = props.state_code?.replace(/^AU-?/i, '').toUpperCase();
  if (code) return code;
  return props.state || undefined;
}

function suburbLabel(props: GeoapifyProperties): string {
  const locality = props.suburb || props.city || props.name || props.address_line1;
  const state = stateShort(props);
  if (locality && state) return `${locality}, ${state}`;
  return locality || props.formatted || 'Unknown place';
}

function exactLabel(props: GeoapifyProperties): string {
  return props.formatted || props.address_line1 || props.name || suburbLabel(props);
}

function toPlace(feature: GeoapifyFeature, precision: PlacePrecision): PlaceValue {
  const props = feature.properties;
  const placeId =
    props.place_id != null
      ? String(props.place_id)
      : `geo:${props.lat},${props.lon}`;

  return {
    label: precision === 'suburb' ? suburbLabel(props) : exactLabel(props),
    placeId,
    lat: props.lat,
    lng: props.lon,
    precision,
  };
}

/** Geoapify `type` filter — suburb search stays at locality level. */
function typeFor(precision: PlacePrecision): string | undefined {
  return precision === 'suburb' ? 'locality' : undefined;
}

/**
 * Forward-autocomplete a query (AU-biased). Returns up to `limit` places.
 */
export async function searchPlaces(
  query: string,
  precision: PlacePrecision,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<PlaceValue[]> {
  const apiKey = readGeoapifyKey();
  if (!apiKey || !query.trim()) return [];

  const params = new URLSearchParams({
    text: query.trim(),
    apiKey,
    lang: 'en',
    limit: String(options?.limit ?? 5),
    filter: 'countrycode:au',
    bias: `proximity:${AU_DEFAULT_CENTER.lng},${AU_DEFAULT_CENTER.lat}`,
  });

  const type = typeFor(precision);
  if (type) params.set('type', type);

  const url = `https://api.geoapify.com/v1/geocode/autocomplete?${params}`;
  const res = await fetch(url, { signal: options?.signal });
  if (!res.ok) return [];
  const body = (await res.json()) as GeoapifyAutocompleteResponse;
  return (body.features ?? []).map((f) => toPlace(f, precision));
}

/** Google Maps deep link for "Open in Maps". */
export function mapsExternalUrl(lat: number, lng: number, label?: string): string {
  const q = label ? encodeURIComponent(label) : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/**
 * Geoapify Static Maps image URL (no JS map library).
 * Returns null when the publishable key is missing.
 */
export function staticMapUrl(
  lat: number,
  lng: number,
  options?: { width?: number; height?: number; zoom?: number },
): string | null {
  const apiKey = readGeoapifyKey();
  if (!apiKey) return null;

  const width = options?.width ?? 640;
  const height = options?.height ?? 360;
  const zoom = options?.zoom ?? 13;
  const params = new URLSearchParams({
    style: 'osm-bright',
    width: String(width),
    height: String(height),
    center: `lonlat:${lng},${lat}`,
    zoom: String(zoom),
    marker: `lonlat:${lng},${lat};color:%230f172a;size:medium`,
    apiKey,
  });

  return `https://maps.geoapify.com/v1/staticmap?${params}`;
}
