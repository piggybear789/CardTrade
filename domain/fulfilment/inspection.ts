// domain/fulfilment/inspection.ts
//
// The 2-way Trade inspection window: how long a trader has to accept or dispute
// once the goods are with them, and when an untouched trade completes on its own.
//
// THE WHOLE TRADE IS BUDGETED OUT OF ONE CARD AUTHORISATION, and this module owns
// the budget. Collateral is an uncaptured, OFF-SESSION authorisation, which the card
// networks treat as merchant-initiated: Visa releases those after about 4 days 18
// hours (114h), the shortest common brand, not the seven days of a customer-present
// auth. It cannot be extended — that needs Interchange Plus pricing, and the attempt
// is on file, rejected as ineligible. So every window in a trade's life has to be
// carved out of those 114 hours (ESC-17a):
//
//     |<-- 24h -->|<------- 72h ------->|<-- 18h -->|
//     placement   meeting           inspection    margin
//                                      closes
//     |<------------- 114h authorisation ------------->|
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
 * The Cash_Sale buyer's inspection window, in days. Matches
 * `cardtrade.cash_sale_inspection_days()` (0011); pinned by
 * `tests/unit/tradeClockAgreement.test.ts`. Since ESC-02 it always runs from the moment
 * we learn of delivery (or from a staff START_CLOCK), never from the carrier's own
 * timestamp.
 */
export const CASH_SALE_INSPECTION_DAYS = 7;

/**
 * The in-person Cash_Sale buyer inspection, in hours (ESC-20). The second handover
 * confirmation opens it instead of completing on the spot. Matches
 * `cardtrade.in_person_inspection_hours()` (0138), pinned by tradeClockAgreement.
 */
export const IN_PERSON_INSPECTION_HOURS = 24;

/**
 * The handover methods a Trade offers. Face-to-face only.
 *
 * Not a preference. Collateral is a card authorisation that lapses in about a week and
 * cannot be extended on this account, and a posted trade has to cover dispatch, then
 * postage in BOTH directions, then an inspection window — best case around six days,
 * typically eight to twelve, and nobody controls Australia Post. The face-to-face
 * timeline fits inside the authorisation by construction; the posted one cannot be
 * made to, at any schedule.
 *
 * A Cash_Sale still posts, and the asymmetry is honest: its money is captured into the
 * platform balance at agreement and has no deadline to outlive.
 */
export const TRADE_HANDOVER_METHODS = ['IN_PERSON'] as const satisfies readonly FulfilmentMethod[];

/**
 * The inspection window, in hours.
 *
 * Three days, matching `cardtrade.trade_inspection_hours()` (0057), which is what
 * actually sets the deadline — pinned by `tests/unit/tradeClockAgreement.test.ts`.
 * This was 120 while the SQL said 72, so members were promised five days and given
 * three (ESC-17a). 120 would also need a hold to outlive the Visa merchant-initiated
 * budget (24 + 120 > 114).
 */
export const TRADE_INSPECTION_HOURS = 72;

/**
 * The inspection window as member copy ("3 days"), derived from the constant so the
 * text cannot drift from the clock again.
 */
export const TRADE_INSPECTION_LABEL = `${TRADE_INSPECTION_HOURS / 24} days`;

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
 * How long a card authorisation lasts, in hours.
 *
 * Stripe reports the real deadline per charge as `capture_before` and that value
 * always wins. This is the planning figure used BEFORE a hold exists — when terms are
 * still being agreed — and the backstop when the provider reports nothing. 114 hours
 * is Visa's merchant-initiated window (about 4 days 18 hours), the shortest common
 * brand; the seven-day figure this replaced (`CARD_AUTHORISATION_DAYS`) is the
 * customer-present window and would aim the custody backstop two days after a Visa
 * hold had already died. Extending it requires Interchange Plus pricing, which this
 * platform does not have. The attempt is on file, rejected with "This account is not
 * eligible for the requested card features".
 */
export const CARD_AUTHORISATION_HOURS = 114;

/**
 * Slack between the end of the inspection window and the death of the collateral.
 *
 * Three things have to happen after a trader sees a problem and before the money is
 * gone: they raise the dispute, the hourly reconciler notices, and a capture makes a
 * network round trip. Landing on the exact instant the authorisation lapses loses all
 * three races. It is whatever the budget leaves over (114 − 24 − 72), so the
 * partition stays an equality, and it matches `cardtrade.collateral_margin_hours()`
 * (0133).
 */
export const COLLATERAL_MARGIN_HOURS = 18;

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
  CARD_AUTHORISATION_HOURS - BOND_PLACEMENT_LEAD_HOURS;

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
    // ESC-17b: THE CLAMP BEATS THE FLOOR. A window that outlives the money backing it
    // is a right to dispute that cannot be honoured; a shorter real window, with both
    // traders told to check now (0142 notifies under six hours), is the honest one.
    // Matches `set_trade_inspection_deadline` in 0142.
    return new Date(Math.min(deadline, lastUsefulMoment)).toISOString();
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
