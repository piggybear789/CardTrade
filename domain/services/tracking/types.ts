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
  /**
   * Carrier-confirmed delivery time: the latest `delivered`-milestone event. Only set
   * when `status` is DELIVERED. Evidence only — the inspection clock never runs from
   * it (ESC-02).
   */
  deliveredAt?: string | null;
  /**
   * The first PHYSICAL carrier scan: the earliest event that is not a label being
   * printed or a pending placeholder (ESC-02, ESC-12). A scan before the buyer paid
   * means the parcel cannot be this sale's shipment. Null when there is no such event
   * yet, in which case the "predates payment" rule does not apply.
   */
  firstEventAt?: string | null;
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
