// domain/fulfilment/inspection.ts
//
// The 2-way Trade inspection window: how long a trader has to accept or dispute
// once the goods are with them, and when an untouched trade completes on its own.
//
// THE WHOLE TRADE IS BUDGETED OUT OF ONE CARD AUTHORISATION, and this module owns
// the budget. Collateral is an uncaptured authorisation that lapses about seven days
// after it is PLACED, and it cannot be extended — that needs Interchange Plus
// pricing, and the attempt is on file, rejected as ineligible. So every window in a
// trade's life has to be carved out of those 168 hours:
//
//     |<-- 24h -->|<---------- 120h ---------->|<-- 24h -->|
//     placement   meeting                  inspection    margin
//                                             closes
//     |<------------------ 168h authorisation ------------------>|
//
// The three add up to exactly the authorisation, which is asserted in the tests. It
// is written as a partition rather than three independent numbers because the last
// time these were free to drift, a fourteen-day dispute return window ended up backed
// by a seven-day hold.
//
// PLACEMENT IS RELATIVE TO THE MEETING, NOT TO AGREEMENT. Bonds used to be placed the
// moment terms were agreed, which spent the authorisation on WAITING: agree today,
// meet in three weeks, and the collateral was long dead before anyone shook hands.
// Placing it the day before the meeting spends the budget on the part that carries
// risk, and lets two traders pick any date they like.
//
// WHY AUTO-COMPLETE AT ALL. Without it an unresponsive counterpart parks both
// traders' collateral until the authorisation lapses, and the trade dies with no
// resolution and no recourse. The lapse is not a neutral outcome: it silently
// removes the guarantee both sides were promised.
//
// Pure: no Supabase, React, or service imports.

import type { FulfilmentMethod } from './types';

/**
 * How long before the agreed meeting the collateral is placed, in hours.
 *
 * A day, not an hour, and not at the meeting itself. A declined card has to be
 * survivable: found the evening before it is a text message and a new card, found in
 * a car park it is two people standing there with nothing to do. The trade cannot
 * reach the meeting without live collateral, so this lead time is the only chance to
 * fix a decline.
 */
export const BOND_PLACEMENT_LEAD_HOURS = 24;

/**
 * The inspection window, in hours.
 *
 * Five days, and the figure is derived rather than chosen: it is whatever is left of
 * the authorisation once the placement lead and the safety margin are taken out. Six
 * days would end at the exact instant the collateral dies, which means a dispute
 * raised on the last evening would find nothing to capture.
 */
export const TRADE_INSPECTION_HOURS = 120;

/**
 * The minimum window a trader always gets, in hours.
 *
 * A face-to-face deadline is measured from the AGREED meeting instant, which can
 * already be in the past by the time both traders get round to confirming. Without
 * a floor, a trade confirmed four days after the meeting would auto-complete
 * immediately and neither party would ever have had a chance to dispute.
 */
export const TRADE_INSPECTION_FLOOR_HOURS = 24;

/**
 * How long a card authorisation lasts, in days.
 *
 * Stripe reports the real deadline per charge as `capture_before` and that value
 * always wins. This is the planning figure used BEFORE a hold exists — when terms are
 * still being agreed — and the backstop when the provider reports nothing. Seven days
 * is the standard online-card window; extending it requires Interchange Plus pricing,
 * which this platform does not have. The attempt is on file, rejected with "This
 * account is not eligible for the requested card features".
 */
export const CARD_AUTHORISATION_DAYS = 7;

/**
 * Slack between the end of the inspection window and the death of the collateral.
 *
 * Three things have to happen after a trader sees a problem and before the money is
 * gone: they raise the dispute, the hourly reconciler notices, and a capture makes a
 * network round trip. Landing on the exact instant the authorisation lapses loses all
 * three races.
 */
export const COLLATERAL_MARGIN_HOURS = 24;

/**
 * How far ahead a meeting may be scheduled.
 *
 * NOT a collateral constraint any more, and that is the point. While bonds were placed
 * at agreement this had to be derived from the authorisation, because every day of
 * waiting was a day of collateral burnt; it was capped at 72 hours and traders had
 * three days to meet. Placing the bond relative to the MEETING removes that coupling
 * entirely — the authorisation no longer starts until the day before, so the date can
 * be as far out as two people want.
 *
 * What is left is a staleness bound, chosen rather than derived: a trade that sits
 * open for months holds two cards off the market and is almost certainly abandoned.
 */
export const MAX_MEETING_LEAD_HOURS = 30 * 24;

/**
 * When the collateral for a given meeting will lapse, as an offset from the meeting.
 *
 * The authorisation starts a day early, so the trade has this much of it left from the
 * moment the two traders meet.
 */
export const COLLATERAL_HOURS_AFTER_MEETING =
  CARD_AUTHORISATION_DAYS * 24 - BOND_PLACEMENT_LEAD_HOURS;

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

/**
 * When the collateral for a trade should be placed: a day before the meeting.
 *
 * Returns `null` for an unusable meeting instant rather than guessing, because the
 * scheduled pass that reads this must never place a bond against a date it cannot
 * parse.
 */
export function bondPlacementInstant(meetingAt: string | null | undefined): string | null {
  const meeting = instant(meetingAt);
  if (!meeting) return null;
  return new Date(meeting.getTime() - BOND_PLACEMENT_LEAD_HOURS * HOUR_MS).toISOString();
}

/**
 * When the collateral placed for a given meeting is expected to lapse.
 *
 * A PLANNING figure only. Once a hold exists, `pre_auth_holds.expires_at` carries the
 * provider's own `capture_before` and that is the value anything consequential reads —
 * this is for deciding a deadline before the hold is placed.
 */
export function projectedCollateralLapse(meetingAt: string | null | undefined): string | null {
  const meeting = instant(meetingAt);
  if (!meeting) return null;
  return new Date(
    meeting.getTime() + COLLATERAL_HOURS_AFTER_MEETING * HOUR_MS,
  ).toISOString();
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
  earliestHoldExpiry?: string | null,
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
  const deadline = Math.max(fromBase, floor);

  // CLAMPED TO THE COLLATERAL, which the floor above could otherwise push past. A
  // trade confirmed late gets its 24-hour minimum from `TRADE_INSPECTION_FLOOR_HOURS`,
  // and there was nothing stopping that minimum landing after the authorisation dies —
  // a window whose whole purpose is "you can still dispute this" running on for a day
  // after the money to answer a dispute has been released. A promise the provider has
  // already made impossible is worse than a shorter one.
  const expiry = instant(earliestHoldExpiry);
  if (expiry) {
    const lastUsefulMoment = expiry.getTime() - COLLATERAL_MARGIN_HOURS * HOUR_MS;
    // Never move the deadline EARLIER than the floor, though: if the collateral is
    // already this close to lapsing the trade is in trouble either way, and cutting
    // the window below the stated minimum would take away a right to fix a problem
    // that is not the trader's fault. `inspectionHoldRisk` reports that case instead.
    return new Date(Math.max(Math.min(deadline, lastUsefulMoment), floor)).toISOString();
  }

  return new Date(deadline).toISOString();
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

/**
 * The latest meeting instant a trader may pick, for a date picker's maximum.
 *
 * NO LONGER BACKED OFF FROM THE COLLATERAL. While bonds were placed at agreement this
 * had to subtract the inspection window and margin from a hold that already existed,
 * because the meeting had to finish inside an authorisation already ticking. Bonds are
 * now placed a day before the meeting, so at the moment a date is chosen there is no
 * authorisation to outlive and nothing to subtract from — the only bound left is
 * staleness.
 */
export function latestSelectableMeetingInstant(from: Date = new Date()): string {
  return new Date(from.getTime() + MAX_MEETING_LEAD_HOURS * HOUR_MS).toISOString();
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
