// lib/handover/terms.ts
//
// DISPLAY helpers for face-to-face / postage handover terms, plus the mapping onto
// the `trades` column names.
//
// The rules themselves — what a valid set of terms is, which fields the chosen
// method needs, how long an inspection window runs — moved to
// `domain/fulfilment`, which is pure and shared with the Cash_Sale. What is left
// here is the part that legitimately belongs in `lib/`: strings that need
// `formatAud`, and the trade-specific column names. `domain/` may not import from
// `lib/`, which is exactly why the split falls where it does.
//
// The module header used to say "used by deals and 2-way trades". Deals are gone.

import { formatAud } from '@/lib/format';
import {
  areFulfilmentTermsComplete,
  type FulfilmentMethod,
} from '@/domain/fulfilment';

/**
 * How the goods change hands.
 *
 * An alias of the shared {@link FulfilmentMethod} rather than a second definition
 * off the database enum: the two were structurally identical, and two names for one
 * concept is how the trade and sale rooms drifted apart in the first place.
 */
export type HandoverMethod = FulfilmentMethod;

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

/**
 * True when the stored handover terms are specified enough to act on.
 *
 * Delegates to the shared predicate so the trade room and the sale room agree on
 * what "set" means. Deliberately weaker than validation: it accepts terms agreed
 * before a rule tightened, so an in-flight contract does not become unreadable when
 * policy changes.
 */
export function areHandoverTermsComplete(input: {
  handover_method: HandoverMethod | null;
  meeting_location: string | null;
  delivery_details: string | null;
}): boolean {
  return areFulfilmentTermsComplete({
    method: input.handover_method,
    meeting: {
      place: input.meeting_location?.trim()
        ? {
            label: input.meeting_location,
            placeId: 'stored',
            lat: 0,
            lng: 0,
          }
        : null,
      at: null,
    },
    // `delivery_details` is the rendered blob; its presence is what the trade row
    // has always used to mean "postage was agreed".
    delivery: {
      costCents: input.delivery_details?.trim() ? 0 : null,
      notes: null,
    },
  });
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
