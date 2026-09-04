// domain/dispute/returnWindow.ts
//
// The return window on a disputed Trade, and whether the collateral behind it will
// still be there when it closes.
//
// WHY THIS MODULE EXISTS. `DISPUTE_RETURN_WINDOW_DAYS` was declared in
// `disputeResolution.ts` and used by nothing — no deadline column, no derivation, no
// scheduled check. Read from the outside it looked like an enforced 14-day right; it
// was a number in a file. Consolidating it here is the same move `frictionTax.ts`
// made for the Friction_Tax amounts: one definition, and the arithmetic that gives it
// meaning sitting next to it.
//
// THE ARITHMETIC THAT MATTERS. Collateral is an uncaptured card authorisation that
// lapses about seven days after it was PLACED, and extended authorisation is not
// available on this account — the attempt is on file, rejected with "This account is
// not eligible for the requested card features". A condition dispute is raised
// partway through a Trade that has already spent days shipping, so a fourteen-day
// return window is, in every realistic case, longer than the collateral behind it.
//
// SO WHY NOT SHORTEN THE WINDOW TO FIT. Because the shortfall is ours, not the
// trader's. Cutting their time to return goods because our authorisation lapses
// charges them for an infrastructure limit they did not choose and cannot see. This
// is the same judgement `inspectionHoldRisk` already makes for the inspection
// window, in almost the same words: report the mismatch, do not silently correct it.
// What makes reporting honest rather than a shrug is that the loss is now actionable
// — `expire_lapsed_holds` (0109) flags the Trade for an operator the moment the
// authorisation actually lapses.
//
// Pure: no Supabase, React, or service imports.

/** The return window for a disputed Item: 14 calendar days (Req 7.5, 7.7). */
export const DISPUTE_RETURN_WINDOW_DAYS = 14;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Parse an ISO instant, returning `null` for absent or unparseable input. */
function instant(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * When the disputed Item must be back with its sender.
 *
 * Measured from the transition into DISPUTED, because that is the moment the
 * returning trader learns they have to send anything.
 */
export function disputeReturnDeadline(raisedAt: string | null | undefined): string | null {
  const raised = instant(raisedAt);
  if (!raised) return null;
  return new Date(raised.getTime() + DISPUTE_RETURN_WINDOW_DAYS * DAY_MS).toISOString();
}

/** How a return deadline sits against the collateral still backing the Trade. */
export type DisputeCollateralRisk = 'safe' | 'tight' | 'expired-first' | 'expired';

/**
 * Whether the return window will outlive the collateral holding it up.
 *
 * Mirrors {@link import('../fulfilment/inspection').inspectionHoldRisk}, with one
 * state it does not need: by the time a dispute is under way the authorisation may
 * ALREADY have lapsed, and "expired" is a different conversation from "will expire".
 * The first means there is nothing left to capture and an operator is the only
 * remedy; the second is still a deadline worth racing.
 *
 * @param returnDeadlineAt   From {@link disputeReturnDeadline}.
 * @param earliestHoldExpiry The soonest `expiresAt` across the Trade's active holds.
 * @param now                Injected so the boundary is testable without fake timers.
 */
export function disputeCollateralRisk(
  returnDeadlineAt: string | null | undefined,
  earliestHoldExpiry: string | null | undefined,
  now: Date = new Date(),
): DisputeCollateralRisk {
  const expiry = instant(earliestHoldExpiry);
  // No expiry to compare against says nothing about safety, but it is the only
  // answer that does not invent a warning. Matches `inspectionHoldRisk`.
  if (!expiry) return 'safe';

  if (expiry.getTime() <= now.getTime()) return 'expired';

  const deadline = instant(returnDeadlineAt);
  if (!deadline) return 'safe';

  if (expiry.getTime() < deadline.getTime()) return 'expired-first';
  // Less than a day of margin: the return can still land in time, but a late
  // handover leaves the remedy with nothing behind it.
  if (expiry.getTime() - deadline.getTime() < DAY_MS) return 'tight';
  return 'safe';
}

/**
 * True once the disputed Item is late.
 *
 * Separate from {@link disputeCollateralRisk} because they answer different
 * questions: this one is about the trader's obligation, that one about whether the
 * platform can still act on it. A return can be overdue while collateral is intact,
 * and collateral can be gone while the return is not yet due.
 */
export function disputeReturnOverdue(
  returnDeadlineAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const deadline = instant(returnDeadlineAt);
  if (!deadline) return false;
  return deadline.getTime() <= now.getTime();
}
