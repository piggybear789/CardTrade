// lib/location/geoapify.ts
//
// DEPRECATED — this file now re-exports from the Google Maps integration.
// Kept only so existing imports continue to resolve during migration.
// New code should import from '@/lib/location/googleMaps' directly.

export {
  readGoogleMapsKey as readGeoapifyKey,
  searchPlaces,
  mapsExternalUrl,
  staticMapUrl,
  embedMapUrl,
} from './googleMaps';
