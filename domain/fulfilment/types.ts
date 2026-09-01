// domain/fulfilment/types.ts
//
// One vocabulary for "how do the goods change hands", shared by Cash_Sales and
// 2-way Trades.
//
// The two tables spell the same concept differently — `cash_sales` has
// `fulfillment_method / shipping_cost_cents / shipping_notes`, `trades` has
// `handover_method / delivery_cost_cents / delivery_details` — because they were
// built months apart. Renaming either set would touch the terms RPCs, the
// Realtime publication, the seeds and the hand-maintained database types, so the
// columns stay put and each flow adapts its row into the shapes below. Everything
// above the adapter speaks one language.
//
// Pure: no Supabase, React, or service imports.

/**
 * How the goods reach the other party.
 *
 * Deliberately the same two values as the `cardtrade.handover_method` enum, which
 * both tables already use, so an adapter is a field rename and never a mapping
 * table.
 */
export type FulfilmentMethod = 'IN_PERSON' | 'DELIVERY';

/**
 * A provider-resolved place: a label plus the coordinates and provider id that
 * prove it came from address autocomplete rather than free text.
 *
 * Contractual locations must be resolved. A typed string cannot be mapped, cannot
 * be verified, and cannot be compared between two people who think they agreed on
 * the same spot.
 */
export interface ResolvedPlace {
  label: string;
  placeId: string;
  lat: number;
  lng: number;
  /** ISO-3166-1 alpha-2, when the provider reported one. */
  countryCode?: string | null;
}

/** A meeting point and time for `IN_PERSON` fulfilment. */
export interface MeetingTerms {
  place: ResolvedPlace | null;
  /** ISO instant. */
  at: string | null;
}

/** Postage cost and free-text handling notes for `DELIVERY` fulfilment. */
export interface DeliveryTerms {
  /** Integer AUD cents. `0` means free postage; `null` means not agreed yet. */
  costCents: number | null;
  notes: string | null;
}

/**
 * The fulfilment half of a contract's terms, method-tagged.
 *
 * `method` is nullable because both flows let a method be chosen before its
 * details are filled in — a trade offer picks "post it" and the postage price is
 * agreed later in the room.
 */
export interface FulfilmentTerms {
  method: FulfilmentMethod | null;
  meeting: MeetingTerms;
  delivery: DeliveryTerms;
}

/**
 * A private postal address.
 *
 * NEVER stored on a Realtime-published row and never returned to a party who is
 * not entitled to read it. `cash_sales` keeps the buyer's in
 * `cash_sale_delivery_details`; `trades` keeps BOTH traders' in
 * `trade_delivery_details`, because a swap posts in both directions.
 */
export interface DeliveryAddress {
  label: string;
  placeId: string;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
}

/** Normalized carrier states, mirroring `TrackingState` on the tracking seam. */
export type FulfilmentTrackingState =
  | 'LABEL_CREATED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'EXCEPTION'
  | 'UNKNOWN';

/** One party's outbound shipment. */
export interface ShipmentSnapshot {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: FulfilmentTrackingState | null;
  /** Carrier-confirmed delivery instant, never the sender's own assertion. */
  carrierDeliveredAt: string | null;
}

/** Why a set of fulfilment terms cannot be saved. */
export type FulfilmentTermsError =
  | 'method-required'
  /**
   * A real method, but not one this flow offers. Trades are face-to-face only: their
   * collateral is a card authorisation with a deadline, and postage in both directions
   * cannot be made to fit inside it. A Cash_Sale has no such limit and still posts.
   */
  | 'method-not-supported'
  | 'meeting-place-required'
  | 'meeting-place-unresolved'
  | 'meeting-time-required'
  | 'meeting-time-past'
  /**
   * Scheduled so far ahead that the collateral would lapse before the inspection
   * window closed. Trades only — a Cash_Sale's money is already collected and has
   * no authorisation to outlive.
   */
  | 'meeting-time-too-far'
  | 'delivery-cost-required'
  | 'delivery-cost-invalid'
  | 'delivery-address-required'
  | 'delivery-address-unresolved';

/** Validation outcome. Errors are values here, as everywhere in the domain. */
export type FulfilmentValidation =
  | { ok: true }
  | { ok: false; error: FulfilmentTermsError };
