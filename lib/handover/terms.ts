// lib/handover/terms.ts
//
// Shared helpers for face-to-face / postage handover terms used by deals and
// 2-way trades. `delivery_cost_cents` is the money source of truth;
// `delivery_details` is the human-readable blob rebuilt from cost + notes.

import { formatAud } from '@/lib/format';
import type { Enums } from '@/lib/supabase/database.types';

export type HandoverMethod = Enums<'handover_method'>;

/** Fields persisted for a handover choice (deals, trade proposals, trades). */
export interface HandoverTermsInput {
  handoverMethod: HandoverMethod;
  meetingLocation?: string | null;
  meetingLat?: number | null;
  meetingLng?: number | null;
  meetingPlaceId?: string | null;
  meetingAt?: string | null;
  deliveryCostCents?: number | null;
  deliveryNotes?: string | null;
}

/** Columns written to a row after normalizing a {@link HandoverTermsInput}. */
export interface HandoverTermsColumns {
  handover_method: HandoverMethod;
  meeting_location: string | null;
  meeting_lat: number | null;
  meeting_lng: number | null;
  meeting_place_id: string | null;
  meeting_at: string | null;
  delivery_details: string | null;
  delivery_cost_cents: number | null;
}

/**
 * Render a DELIVERY handover as human-readable `delivery_details`: the postage
 * price plus any shipping notes. Cost stays the machine-readable source of truth.
 */
export function describeDelivery(costCents: number, notes: string | null): string {
  const priceLine =
    costCents === 0
      ? 'Delivered — free delivery.'
      : `Delivered — ${formatAud(costCents)} delivery on top of the cash amount.`;
  return notes ? `${priceLine}\n${notes}` : priceLine;
}

/** Strip the generated price line so an edit form can re-show only free notes. */
export function deliveryNotesFromDetails(details: string | null | undefined): string {
  if (!details) return '';
  const lines = details.split('\n');
  if (lines[0]?.startsWith('Delivered —')) {
    return lines.slice(1).join('\n').trim();
  }
  return details;
}

/** True when the handover terms are fully specified for the chosen method. */
export function areHandoverTermsComplete(input: {
  handover_method: HandoverMethod | null;
  meeting_location: string | null;
  delivery_details: string | null;
}): boolean {
  if (input.handover_method === 'IN_PERSON') {
    return Boolean(input.meeting_location?.trim());
  }
  if (input.handover_method === 'DELIVERY') {
    return Boolean(input.delivery_details?.trim());
  }
  return false;
}

/**
 * Normalize a handover input into opposite-method-cleared columns ready to write.
 * Does not validate — callers check required fields first.
 */
export function toHandoverColumns(input: HandoverTermsInput): HandoverTermsColumns {
  if (input.handoverMethod === 'IN_PERSON') {
    const location = input.meetingLocation?.trim() || null;
    return {
      handover_method: 'IN_PERSON',
      meeting_location: location,
      meeting_lat:
        typeof input.meetingLat === 'number' && Number.isFinite(input.meetingLat)
          ? input.meetingLat
          : null,
      meeting_lng:
        typeof input.meetingLng === 'number' && Number.isFinite(input.meetingLng)
          ? input.meetingLng
          : null,
      meeting_place_id: input.meetingPlaceId?.trim() || null,
      meeting_at: input.meetingAt ?? null,
      delivery_details: null,
      delivery_cost_cents: null,
    };
  }

  // Method can be chosen on the offer/create form with details deferred to the
  // room — leave cost and the summary blank until someone fills them in.
  if (input.deliveryCostCents == null) {
    return {
      handover_method: 'DELIVERY',
      meeting_location: null,
      meeting_lat: null,
      meeting_lng: null,
      meeting_place_id: null,
      meeting_at: null,
      delivery_cost_cents: null,
      delivery_details: null,
    };
  }

  const cost = Math.trunc(input.deliveryCostCents);
  const notes = input.deliveryNotes?.trim() || null;
  return {
    handover_method: 'DELIVERY',
    meeting_location: null,
    meeting_lat: null,
    meeting_lng: null,
    meeting_place_id: null,
    meeting_at: null,
    delivery_cost_cents: cost,
    delivery_details: describeDelivery(cost, notes),
  };
}

/** One-line summary for dialog rows and inbox cards. */
export function summarizeHandover(input: {
  handover_method: HandoverMethod | null;
  meeting_location: string | null;
  delivery_cost_cents: number | null;
  delivery_details: string | null;
}): string {
  if (input.handover_method === 'IN_PERSON') {
    return input.meeting_location?.trim() || 'Face to face';
  }
  if (input.handover_method === 'DELIVERY') {
    if (input.delivery_cost_cents != null) {
      return input.delivery_cost_cents === 0
        ? 'Free delivery'
        : `${formatAud(input.delivery_cost_cents)} postage`;
    }
    // Method chosen, postage still open — don't leave the tab reading bare
    // "Delivery" with no hint that something is outstanding.
    return input.delivery_details?.trim() || 'Delivery — set postage';
  }
  return 'Not set';
}
