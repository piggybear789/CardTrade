// domain/services/tracking/index.ts
// Current tracking binding; swap this one factory when a carrier API is chosen.

import { ManualTrackingService } from './manualTracking';
import type { TrackingService } from './types';

/** Return the configured shipment tracking service. */
export function getTrackingService(): TrackingService {
  return new ManualTrackingService();
}

/** Whether the configured provider can safely refresh a carrier status. */
export function isTrackingStatusPollingAvailable(): boolean {
  return typeof getTrackingService().fetchStatus === 'function';
}

export type { TrackingService, TrackingSnapshot, TrackingState } from './types';
