// domain/services/tracking/manualTracking.ts
// Manual tracking fallback. A carrier API can replace this binding without
// changing cash-sale actions, persistence, or UI (Req 4.13).

import type { TrackingService, TrackingSnapshot } from './types';

/**
 * Manual provider cannot poll a carrier, so `fetchStatus` is intentionally not
 * implemented. Delivery confirmation therefore has to arrive from a real carrier
 * integration (or the test-mode simulation) before the inspection clock starts.
 */

const TRACKING_URLS: Record<string, (number: string) => string> = {
  'australia post': (number) =>
    `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(number)}`,
  auspost: (number) =>
    `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(number)}`,
  startrack: (number) =>
    `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(number)}`,
  sendle: (number) =>
    `https://track.sendle.com/tracking?ref=${encodeURIComponent(number)}`,
  aramex: (number) =>
    `https://www.aramex.com/au/en/track/shipment?q=${encodeURIComponent(number)}`,
  'couriers please': (number) =>
    `https://www.couriersplease.com.au/tools-track?con=${encodeURIComponent(number)}`,
  dhl: (number) =>
    `https://www.dhl.com/au-en/home/tracking.html?tracking-id=${encodeURIComponent(number)}`,
  fedex: (number) =>
    `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(number)}`,
  tnt: (number) =>
    `https://www.tnt.com/express/en_au/site/tracking.html?searchType=con&cons=${encodeURIComponent(number)}`,
  ups: (number) =>
    `https://www.ups.com/track?tracknum=${encodeURIComponent(number)}`,
};

/** Normalize manually supplied tracking details and provide a carrier URL. */
export class ManualTrackingService implements TrackingService {
  async registerShipment(input: {
    carrier: string;
    trackingNumber: string;
  }): Promise<TrackingSnapshot> {
    const carrier = input.carrier.trim();
    const trackingNumber = input.trackingNumber.trim();
    const url = TRACKING_URLS[carrier.toLowerCase()]?.(trackingNumber) ?? null;
    return {
      carrier,
      trackingNumber,
      trackingUrl: url,
      status: 'LABEL_CREATED',
    };
  }
}
