// domain/services/tracking/index.ts
//
// Tracking service factory. Uses Ship24 when SHIP24_API_KEY is set, falls back
// to the manual provider (URL generation only, no polling).

import { ManualTrackingService } from './manualTracking';
import { Ship24TrackingService } from './ship24Tracking';
import type { TrackingService } from './types';

let _cached: TrackingService | null = null;

/** Return the configured shipment tracking service. */
export function getTrackingService(): TrackingService {
  if (_cached) return _cached;
  const apiKey = process.env.SHIP24_API_KEY;
  if (apiKey) {
    _cached = new Ship24TrackingService(apiKey);
  } else {
    _cached = new ManualTrackingService();
  }
  return _cached;
}

/** Whether the configured provider can poll carrier status. */
export function isTrackingStatusPollingAvailable(): boolean {
  return typeof getTrackingService().fetchStatus === 'function';
}

export type { TrackingService, TrackingSnapshot, TrackingState } from './types';
