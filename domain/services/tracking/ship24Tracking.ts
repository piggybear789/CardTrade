// domain/services/tracking/ship24Tracking.ts
//
// Ship24 carrier tracking integration. Registers shipments with Ship24 so they
// are polled automatically, and provides `fetchStatus` for on-demand reads.
// Webhook delivery is handled separately by the webhook route.
//
// Ship24's free tier includes API access and webhooks. The API is RESTful with
// Bearer token auth.

import type { TrackingService, TrackingSnapshot, TrackingState } from './types';

const BASE_URL = 'https://api.ship24.com/public/v1';

/** Map our carrier names (from the select) to Ship24 courier codes. */
const COURIER_CODES: Record<string, string> = {
  'australia post': 'australia-post',
  'auspost': 'australia-post',
  'startrack': 'startrack',
  'sendle': 'sendle',
  'aramex': 'aramex',
  'couriers please': 'couriers-please',
  'dhl': 'dhl',
  'fedex': 'fedex',
  'tnt': 'tnt',
  'ups': 'ups',
};

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

/** Build a carrier tracking URL (same map as ManualTrackingService). */
const TRACKING_URLS: Record<string, (n: string) => string> = {
  'australia-post': (n) => `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(n)}`,
  'startrack': (n) => `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(n)}`,
  'sendle': (n) => `https://track.sendle.com/tracking?ref=${encodeURIComponent(n)}`,
  'aramex': (n) => `https://www.aramex.com/au/en/track/shipment?q=${encodeURIComponent(n)}`,
  'couriers-please': (n) => `https://www.couriersplease.com.au/tools-track?con=${encodeURIComponent(n)}`,
  'dhl': (n) => `https://www.dhl.com/au-en/home/tracking.html?tracking-id=${encodeURIComponent(n)}`,
  'fedex': (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
  'tnt': (n) => `https://www.tnt.com/express/en_au/site/tracking.html?searchType=con&cons=${encodeURIComponent(n)}`,
  'ups': (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
};

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
    const courierCode = COURIER_CODES[carrier.toLowerCase()];

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

      const shipment = data.data?.trackings?.[0]?.shipment;
      const lastEvent = data.data?.trackings?.[0]?.events?.[0];
      const status = mapStatus(shipment?.statusMilestone);
      const resolvedCourier = courierCode ?? carrier.toLowerCase();

      return {
        carrier,
        trackingNumber,
        trackingUrl: TRACKING_URLS[resolvedCourier]?.(trackingNumber) ?? null,
        status,
        deliveredAt: status === 'DELIVERED' && lastEvent?.occurrenceDatetime
          ? lastEvent.occurrenceDatetime
          : null,
      };
    } catch (err) {
      // Fallback: if Ship24 is down, still register with the URL and UNKNOWN status.
      console.error('[Ship24] registerShipment failed, falling back:', err);
      const resolvedCourier = courierCode ?? carrier.toLowerCase();
      return {
        carrier,
        trackingNumber,
        trackingUrl: TRACKING_URLS[resolvedCourier]?.(trackingNumber) ?? null,
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
    const courierCode = COURIER_CODES[carrier.toLowerCase()];

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

      const shipment = data.data?.trackings?.[0]?.shipment;
      const lastEvent = data.data?.trackings?.[0]?.events?.[0];
      if (!shipment) return null;

      const status = mapStatus(shipment.statusMilestone);
      const resolvedCourier = courierCode ?? carrier.toLowerCase();

      return {
        carrier,
        trackingNumber,
        trackingUrl: TRACKING_URLS[resolvedCourier]?.(trackingNumber) ?? null,
        status,
        deliveredAt: status === 'DELIVERED' && lastEvent?.occurrenceDatetime
          ? lastEvent.occurrenceDatetime
          : null,
      };
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
