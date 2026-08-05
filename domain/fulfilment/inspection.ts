// domain/fulfilment/inspection.ts
//
// The 2-way Trade inspection window: how long a trader has to accept or dispute
// once the goods are with them, and when an untouched trade completes on its own.
//
// WHY A TRADE NEEDS ITS OWN NUMBER. A Cash_Sale gets 7 days from carrier-confirmed
// delivery, and can afford to: the money is already collected into the platform
// balance, so a long window costs nothing but time. A Trade's collateral is an
// UNCAPTURED CARD AUTHORISATION that lapses in about 7 days from when it was
// PLACED — and a trade's clock starts at collateral, not at delivery. Postage in
// both directions plus 7 days of inspection would routinely outlive the
// authorisation, at which point the provider releases the collateral mid-trade and
// a dispute has nothing left to capture. 72 hours is what fits.
//
// WHY AUTO-COMPLETE AT ALL. Without it an unresponsive counterpart parks both
// traders' collateral until the authorisation lapses, and the trade dies with no
// resolution and no recourse. The lapse is not a neutral outcome: it silently
// removes the guarantee both sides were promised.
//
// Pure: no Supabase, React, or service imports.

import type { FulfilmentMethod } from './types';

/**
 * The inspection window, in hours.
 *
 * Deliberately shorter than the Cash_Sale's 7 days. See the module note: this is a
 * consequence of collateral being a ~7-day authorisation, not a tuning knob.
 */
export const TRADE_INSPECTION_HOURS = 72;

/**
 * The minimum window a trader always gets, in hours.
 *
 * A face-to-face deadline is measured from the AGREED meeting instant, which can
 * already be in the past by the time both traders get round to confirming. Without
 * a floor, a trade confirmed four days after the meeting would auto-complete
 * immediately and neither party would ever have had a chance to dispute.
 */
export const TRADE_INSPECTION_FLOOR_HOURS = 24;

/** One hour in milliseconds. */
const HOUR_MS = 3_600_000;

/** Parse an ISO instant, returning `null` for absent or unparseable input. */
function instant(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** The later of two instants, ignoring nulls. */
function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/** Everything the deadline derivation needs. */
export interface TradeInspectionFacts {
  method: FulfilmentMethod | null;
  /** The agreed meeting instant, for `IN_PERSON`. */
  meetingAt?: string | null;
  /** Carrier-confirmed delivery of the initiator's outbound parcel. */
  initiatorCarrierDeliveredAt?: string | null;
  /** Carrier-confirmed delivery of the counterpart's outbound parcel. */
  counterpartCarrierDeliveredAt?: string | null;
}

/**
 * When an untouched trade in INSPECTION should complete on its own.
 *
 * The base instant is the moment the goods were with their new owner:
 *
 * - `IN_PERSON` — the agreed meeting instant. Both traders confirmed a handover at
 *   a time they had both accepted, so that instant is the exchange.
 * - `DELIVERY` — the LATER of the two carrier-confirmed deliveries, because the
 *   trade is only fully exchanged once both parcels have landed. A missing
 *   confirmation falls back to `enteredInspectionAt`; a trader's own word that a
 *   parcel arrived does not start a clock that can pay out against them.
 *
 * The result is then floored at `TRADE_INSPECTION_FLOOR_HOURS` from
 * `enteredInspectionAt`, so a late-confirmed trade still leaves room to dispute.
 *
 * @param enteredInspectionAt When the trade reached INSPECTION.
 * @returns The deadline as an ISO instant.
 */
export function deriveTradeInspectionDeadline(
  facts: TradeInspectionFacts,
  enteredInspectionAt: Date,
): string {
  const entered = enteredInspectionAt.getTime();

  let base: number;
  if (facts.method === 'IN_PERSON') {
    base = instant(facts.meetingAt)?.getTime() ?? entered;
  } else {
    const bothLanded = latest(
      instant(facts.initiatorCarrierDeliveredAt),
      instant(facts.counterpartCarrierDeliveredAt),
    );
    const eitherMissing =
      !instant(facts.initiatorCarrierDeliveredAt) ||
      !instant(facts.counterpartCarrierDeliveredAt);
    base = eitherMissing || !bothLanded ? entered : bothLanded.getTime();
  }

  const fromBase = base + TRADE_INSPECTION_HOURS * HOUR_MS;
  const floor = entered + TRADE_INSPECTION_FLOOR_HOURS * HOUR_MS;

  return new Date(Math.max(fromBase, floor)).toISOString();
}

/** How an inspection deadline sits against the collateral authorisation. */
export type InspectionHoldRisk = 'safe' | 'tight' | 'expired-first';

/**
 * Whether the inspection window will outlive the collateral holding it up.
 *
 * Reported rather than corrected. Silently shortening the window would take away
 * a trader's stated right to inspect, and silently extending it would promise a
 * guarantee the provider has already released. The room warns, and an operator or
 * a re-authorisation is the fix.
 *
 * @param earliestHoldExpiry The soonest `expiresAt` across the trade's holds.
 */
export function inspectionHoldRisk(
  inspectionDeadlineAt: string | null | undefined,
  earliestHoldExpiry: string | null | undefined,
): InspectionHoldRisk {
  const deadline = instant(inspectionDeadlineAt);
  const expiry = instant(earliestHoldExpiry);
  if (!deadline || !expiry) return 'safe';
  if (expiry.getTime() < deadline.getTime()) return 'expired-first';
  // Less than a day of margin: the trade can still resolve, but a dispute raised
  // at the deadline may not have collateral behind it for long.
  if (expiry.getTime() - deadline.getTime() < 24 * HOUR_MS) return 'tight';
  return 'safe';
}

/** True when an INSPECTION trade's window has closed and it should auto-complete. */
export function inspectionExpired(
  inspectionDeadlineAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const deadline = instant(inspectionDeadlineAt);
  if (!deadline) return false;
  return deadline.getTime() <= now.getTime();
}
