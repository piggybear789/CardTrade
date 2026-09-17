// domain/services/tracking/manualTracking.ts
// Manual tracking fallback. A carrier API can replace this binding without
// changing cash-sale actions, persistence, or UI (Req 4.13).

import { carrierTrackingUrl } from './carriers';
import type { TrackingService, TrackingSnapshot } from './types';

/**
 * Manual provider cannot poll a carrier, so `fetchStatus` is intentionally not
 * implemented. Delivery confirmation therefore has to arrive from a real carrier
 * integration (or the test-mode simulation) before the inspection clock starts.
 */

/** Normalize manually supplied tracking details and provide a carrier URL. */
export class ManualTrackingService implements TrackingService {
  async registerShipment(input: {
    carrier: string;
    trackingNumber: string;
  }): Promise<TrackingSnapshot> {
    const carrier = input.carrier.trim();
    const trackingNumber = input.trackingNumber.trim();
    // The URL map that used to live here is `domain/services/tracking/carriers.ts`,
    // shared with the Ship24 binding and with the carrier picker — see the note at the
    // top of that file for why three copies of one list was a correctness problem and
    // not just repetition.
    return {
      carrier,
      trackingNumber,
      trackingUrl: carrierTrackingUrl(carrier, trackingNumber),
      status: 'LABEL_CREATED',
    };
  }
}
