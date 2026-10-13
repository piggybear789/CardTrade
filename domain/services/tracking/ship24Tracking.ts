// domain/services/tracking/ship24Tracking.ts
//
// Ship24 carrier tracking integration. Registers shipments with Ship24 so they
// are polled automatically, and provides `fetchStatus` for on-demand reads.
// Webhook delivery is handled separately by the webhook route.
//
// Ship24's free tier includes API access and webhooks. The API is RESTful with
// Bearer token auth.

import { carrierTrackingUrl, ship24CourierCode } from './carriers';
import type { TrackingService, TrackingSnapshot, TrackingState } from './types';

const BASE_URL = 'https://api.ship24.com/public/v1';

// THE COURIER-CODE MAP AND THE URL MAP BOTH MOVED to
// `domain/services/tracking/carriers.ts`, alongside the picker's own list. This file
// held one keyed on lowercased display names and a second keyed on slugs, the latter
// commented "same map as ManualTrackingService" — see that file's header for why three
// copies of one list was a correctness problem rather than duplication.

/** Map Ship24 statusMilestone to our TrackingState. */
function mapStatus(milestone: string | null | undefined): TrackingState {
  switch (milestone) {
    case 'info_received': return 'LABEL_CREATED';
    case 'in_transit': return 'IN_TRANSIT';
    case 'out_for_delivery': return 'OUT_FOR_DELIVERY';
    case 'available_for_pickup': return 'OUT_FOR_DELIVERY';
    case 'delivered': return 'DELIVERED';
    case 'failed_attempt': return 'IN_TRANSIT';
    case 'exception': return 'EXCEPTION';
    default: return 'UNKNOWN';
  }
}

/**
 * Milestones that are NOT a physical scan (ESC-02, round-3 review #5). A label is
 * often printed before the buyer pays; counting it would refuse an honest seller.
 */
export const PRE_SCAN_MILESTONES: readonly string[] = ['info_received', 'pending'];

/** The minimal event shape the timing helpers read. */
export interface Ship24EventLike {
  occurrenceDatetime: string | null | undefined;
  statusMilestone: string | null | undefined;
}

function instant(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The earliest physical carrier scan, in either event order. Events with no
 * milestone, or a pre-scan one, do not count. Null when none qualifies.
 */
export function firstCarrierScanAt(events: readonly Ship24EventLike[] | null | undefined): string | null {
  let best: { ms: number; iso: string } | null = null;
  for (const event of events ?? []) {
    if (!event.statusMilestone || PRE_SCAN_MILESTONES.includes(event.statusMilestone)) continue;
    const ms = instant(event.occurrenceDatetime);
    if (ms === null) continue;
    if (!best || ms < best.ms) best = { ms, iso: event.occurrenceDatetime as string };
  }
  return best?.iso ?? null;
}

/** The latest `delivered`-milestone event, in either event order. */
export function deliveredEventAt(events: readonly Ship24EventLike[] | null | undefined): string | null {
  let best: { ms: number; iso: string } | null = null;
  for (const event of events ?? []) {
    if (event.statusMilestone !== 'delivered') continue;
    const ms = instant(event.occurrenceDatetime);
    if (ms === null) continue;
    if (!best || ms > best.ms) best = { ms, iso: event.occurrenceDatetime as string };
  }
  return best?.iso ?? null;
}

/** Build a snapshot from a Ship24 tracking result. */
function snapshotFrom(
  carrier: string,
  trackingNumber: string,
  tracking: Ship24TrackResponse['data']['trackings'][number] | undefined,
): TrackingSnapshot {
  const status = mapStatus(tracking?.shipment?.statusMilestone);
  const events = tracking?.events ?? [];
  return {
    carrier,
    trackingNumber,
    trackingUrl: carrierTrackingUrl(carrier, trackingNumber),
    status,
    deliveredAt: status === 'DELIVERED' ? (deliveredEventAt(events) ?? events[0]?.occurrenceDatetime ?? null) : null,
    firstEventAt: firstCarrierScanAt(events),
  };
}

export class Ship24TrackingService implements TrackingService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ship24 API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async registerShipment(input: {
    carrier: string;
    trackingNumber: string;
  }): Promise<TrackingSnapshot> {
    const carrier = input.carrier.trim();
    const trackingNumber = input.trackingNumber.trim();
    const courierCode = ship24CourierCode(carrier);

    // POST /trackers/track is idempotent — creates if needed, returns results.
    const body: Record<string, unknown> = {
      trackingNumber,
      destinationCountryCode: 'AU',
    };
    if (courierCode) {
      body.courierCode = [courierCode];
    }

    try {
      const data = await this.request<Ship24TrackResponse>('/trackers/track', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      return snapshotFrom(carrier, trackingNumber, data.data?.trackings?.[0]);
    } catch (err) {
      // Fallback: if Ship24 is down, still register with the URL and UNKNOWN status.
      console.error('[Ship24] registerShipment failed, falling back:', err);
      return {
        carrier,
        trackingNumber,
        trackingUrl: carrierTrackingUrl(carrier, trackingNumber),
        status: 'LABEL_CREATED',
      };
    }
  }

  async fetchStatus(input: {
    carrier: string;
    trackingNumber: string;
  }): Promise<TrackingSnapshot | null> {
    const carrier = input.carrier.trim();
    const trackingNumber = input.trackingNumber.trim();
    const courierCode = ship24CourierCode(carrier);

    try {
      // Use the same idempotent endpoint to get current status.
      const body: Record<string, unknown> = {
        trackingNumber,
        destinationCountryCode: 'AU',
      };
      if (courierCode) {
        body.courierCode = [courierCode];
      }

      const data = await this.request<Ship24TrackResponse>('/trackers/track', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const tracking = data.data?.trackings?.[0];
      if (!tracking?.shipment) return null;
      return snapshotFrom(carrier, trackingNumber, tracking);
    } catch (err) {
      console.error('[Ship24] fetchStatus failed:', err);
      return null;
    }
  }
}

// Ship24 response types (subset of what they return)
interface Ship24TrackResponse {
  data: {
    trackings: Array<{
      tracker: { trackerId: string };
      shipment: {
        trackingNumber: string;
        statusMilestone: string | null;
      } | null;
      events: Array<{
        eventId: string;
        status: string;
        occurrenceDatetime: string;
        statusMilestone: string | null;
        statusCode: string | null;
      }>;
    }>;
  };
}
