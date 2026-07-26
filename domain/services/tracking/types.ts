// domain/services/tracking/types.ts
// Provider-neutral shipment tracking seam for Cash_Sale delivery (Req 4.13).

/** Normalized carrier states CardTrade reasons about. */
export type TrackingState =
  | 'LABEL_CREATED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'EXCEPTION'
  | 'UNKNOWN';

/** A normalized tracking snapshot safe to persist on a participant-only sale. */
export interface TrackingSnapshot {
  carrier: string;
  trackingNumber: string;
  trackingUrl: string | null;
  status: TrackingState;
  /** Carrier-confirmed delivery time; only set when `status` is DELIVERED. */
  deliveredAt?: string | null;
}

/** Shipment tracking provider contract. */
export interface TrackingService {
  /** Register or normalize a carrier tracking number. */
  registerShipment(input: {
    carrier: string;
    trackingNumber: string;
  }): Promise<TrackingSnapshot>;
  /**
   * Re-read the carrier's current state. Optional: a manual provider cannot poll,
   * so callers must treat `undefined` as "no automated tracking available".
   */
  fetchStatus?(input: {
    carrier: string;
    trackingNumber: string;
  }): Promise<TrackingSnapshot | null>;
}
