// Mapbox Geocoding helpers (browser-safe publishable token).

import { AU_DEFAULT_CENTER, type PlacePrecision, type PlaceValue } from './types';

export function readMapboxToken(): string | null {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
  return token || null;
}

interface MapboxContext {
  id: string;
  text: string;
  short_code?: string;
}

interface MapboxFeature {
  id: string;
  place_name: string;
  text: string;
  center: [number, number];
  place_type: string[];
  context?: MapboxContext[];
}

interface MapboxGeocodeResponse {
  features?: MapboxFeature[];
}

function suburbLabel(feature: MapboxFeature): string {
  const region = feature.context?.find((c) => c.id.startsWith('region.'));
  const short = region?.short_code?.replace(/^AU-/, '') ?? region?.text;
  if (short) return `${feature.text}, ${short}`;
  return feature.text;
}

function toPlace(feature: MapboxFeature, precision: PlacePrecision): PlaceValue {
  const [lng, lat] = feature.center;
  return {
    label: precision === 'suburb' ? suburbLabel(feature) : feature.place_name,
    placeId: feature.id,
    lat,
    lng,
    precision,
  };
}

function typesFor(precision: PlacePrecision): string {
  return precision === 'suburb'
    ? 'place,locality,neighborhood'
    : 'address,poi,place,locality';
}

/**
 * Forward-geocode a query (AU-biased). Returns up to `limit` places.
 */
export async function searchPlaces(
  query: string,
  precision: PlacePrecision,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<PlaceValue[]> {
  const token = readMapboxToken();
  if (!token || !query.trim()) return [];

  const params = new URLSearchParams({
    access_token: token,
    country: 'au',
    types: typesFor(precision),
    limit: String(options?.limit ?? 5),
    language: 'en',
    proximity: `${AU_DEFAULT_CENTER.lng},${AU_DEFAULT_CENTER.lat}`,
  });

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    query.trim(),
  )}.json?${params}`;

  const res = await fetch(url, { signal: options?.signal });
  if (!res.ok) return [];
  const body = (await res.json()) as MapboxGeocodeResponse;
  return (body.features ?? []).map((f) => toPlace(f, precision));
}

/**
 * Reverse-geocode a coordinate. Used when the user clicks / drags the map pin.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  precision: PlacePrecision,
  options?: { signal?: AbortSignal },
): Promise<PlaceValue | null> {
  const token = readMapboxToken();
  if (!token) return null;

  const params = new URLSearchParams({
    access_token: token,
    types: typesFor(precision),
    limit: '1',
    language: 'en',
  });

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?${params}`;
  const res = await fetch(url, { signal: options?.signal });
  if (!res.ok) return null;
  const body = (await res.json()) as MapboxGeocodeResponse;
  const feature = body.features?.[0];
  if (!feature) {
    return {
      label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      placeId: `manual:${lat},${lng}`,
      lat,
      lng,
      precision,
    };
  }
  // Keep the clicked coordinates as the pin, but use the locality/place label.
  const place = toPlace(feature, precision);
  return { ...place, lat, lng };
}

export function mapsExternalUrl(lat: number, lng: number, label?: string): string {
  const q = label ? encodeURIComponent(label) : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
