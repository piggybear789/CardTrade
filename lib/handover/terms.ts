// lib/handover/terms.ts
//
// DISPLAY helpers for face-to-face / postage handover terms, plus the mapping onto
// the `trades` column names.
//
// The rules themselves — what a valid set of terms is, which fields the chosen
// method needs, how long an inspection window runs — moved to
// `domain/fulfilment`, which is pure and shared with the Cash_Sale. What is left
// here is the part that legitimately belongs in `lib/`: strings that need
// `formatMoney`, and the trade-specific column names. `domain/` may not import from
// `lib/`, which is exactly why the split falls where it does.
//
// The module header used to say "used by deals and 2-way trades". Deals are gone.

import { formatMoney } from '@/lib/format';
import { TRADE_NO_FEE_NOTE } from '@/lib/fees/feeLabels';
import { FX_FEE_BPS, currencyConversionFeeFor } from '@/domain/fees/fxFee';

/** "2%", from the rate the conversion fee is charged at (lib may not import components). */
function fxFeeRateLabel(): string {
  const percent = FX_FEE_BPS / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}
import { BOND_PLACEMENT_LEAD_HOURS, type FulfilmentMethod } from '@/domain/fulfilment';

/** The accept dialog's strings (design §1.12). */
export interface TradeAcceptCopy {
  description: string;
  collateralHint: string;
  feeHint: string;
}

/**
 * The trade accept-dialog copy, built from the constants so it cannot drift from the
 * code (design §1.12, ESC-01, ESC-29).
 *
 * Honest about what happens: accepting agrees terms; the temporary card hold lands
 * about a day before the meeting (trades have no fee); and since ESC-01 a hold that is about to
 * expire on an open problem IS charged, then refunded or paid out. Never "escrow",
 * never "not charged".
 *
 * `cashMinor` / `payerIsViewer` add the cash-payment sentence (ESC-05), for the paying
 * viewer only: the receiver pays nothing and is not told to.
 */
export function tradeAcceptCopy(params: {
  cashMinor: number;
  payerIsViewer: boolean;
  bondMinor: number | null;
  currency: string;
}): TradeAcceptCopy {
  const hold = params.bondMinor === null ? 'a temporary card hold' : `a temporary card hold of ${formatMoney(params.bondMinor, params.currency)}`;
  // ESC-05: only the trader who pays the cash is told to pay it, and when. On a converted
  // leg they also pay the Currency_Conversion fee; the platform never absorbs it.
  const fxFeeMinor = currencyConversionFeeFor(params.cashMinor, params.currency);
  const cashSentence =
    params.cashMinor > 0 && params.payerIsViewer
      ? ` You then pay the ${formatMoney(params.cashMinor, params.currency)} cash before the hold goes on` +
        (fxFeeMinor > 0
          ? `, plus a ${formatMoney(fxFeeMinor, params.currency)} currency conversion fee (${fxFeeRateLabel()}, not refunded). `
          : '. ') +
        'NoDitto holds it until the trade completes, and refunds it if the trade is cancelled.'
      : '';
  return {
    description:
      `Accepting agrees the terms. About ${BOND_PLACEMENT_LEAD_HOURS} hours before the meeting ` +
      `(or straight away if it's sooner) we place ${hold}. Trades have no fee.` +
      cashSentence,
    collateralHint:
      "A temporary card hold, not a charge. Make sure your card's available limit covers it. " +
      "It's released when the trade completes. If a problem is still open when the hold is about " +
      "to expire, it's charged and then refunded or paid out when staff decide.",
    feeHint: TRADE_NO_FEE_NOTE,
  };
}

/** Card-decline copy shared by the trade room's action bar and negotiation toasts. */
export const CARD_LIMIT_SENTENCE =
  "This usually means the card's available limit is too low. Switch card and try again.";

/** "Your card declined the hold." plus the card-limit sentence. */
export const HOLD_DECLINED_MESSAGE = `Your card declined the hold. ${CARD_LIMIT_SENTENCE}`;

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
export function describeDelivery(
  costCents: number,
  notes: string | null,
  currency: string,
): string {
  const priceLine =
    costCents === 0
      ? 'Delivered — free delivery.'
      : `Delivered — ${formatMoney(costCents, currency)} delivery on top of the cash amount.`;
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
 * Normalize a handover input into opposite-method-cleared columns ready to write.
 * Does not validate — callers check required fields first.
 */
export function toHandoverColumns(
  input: HandoverTermsInput,
  currency: string,
): HandoverTermsColumns {
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
    delivery_details: describeDelivery(cost, notes, currency),
  };
}

/** One-line summary for dialog rows and inbox cards. */
export function summarizeHandover(input: {
  handover_method: HandoverMethod | null;
  meeting_location: string | null;
  delivery_cost_cents: number | null;
  delivery_details: string | null;
  currency: string;
}): string {
  if (input.handover_method === 'IN_PERSON') {
    return input.meeting_location?.trim() || 'Face to face';
  }
  if (input.handover_method === 'DELIVERY') {
    if (input.delivery_cost_cents != null) {
      return input.delivery_cost_cents === 0
        ? 'Free delivery'
        : `${formatMoney(input.delivery_cost_cents, input.currency)} postage`;
    }
    // Method chosen, postage still open — don't leave the tab reading bare
    // "Delivery" with no hint that something is outstanding.
    return input.delivery_details?.trim() || 'Delivery — set postage';
  }
  return 'Not set';
}
