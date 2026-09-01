// tests/unit/disputeReturnWindow.test.ts
//
// The return window on a disputed Trade, and whether its collateral outlives it.
//
// WHY THIS NEEDS ITS OWN TEST. `DISPUTE_RETURN_WINDOW_DAYS` sat in
// `disputeResolution.ts` as a number nothing read, which is how a fourteen-day return
// window came to be backed by an authorisation that lapses in about seven — the two
// figures never met in any code path, so nothing could notice they disagree. These
// pin down the arithmetic that now makes the mismatch visible, and the boundaries
// where it flips, because every one of them is a case where the platform either warns
// too late or cries wolf.

import { describe, expect, it } from 'vitest';

import {
  DISPUTE_RETURN_WINDOW_DAYS,
  disputeCollateralRisk,
  disputeReturnDeadline,
  disputeReturnOverdue,
} from '@/domain/dispute/returnWindow';

const RAISED = '2026-03-01T00:00:00.000Z';
const DAY_MS = 86_400_000;

/** An instant `days` after the dispute was raised, as an ISO string. */
function afterRaise(days: number): string {
  return new Date(Date.parse(RAISED) + days * DAY_MS).toISOString();
}

describe('disputeReturnDeadline', () => {
  it('is fourteen days from the transition into DISPUTED', () => {
    expect(disputeReturnDeadline(RAISED)).toBe(afterRaise(DISPUTE_RETURN_WINDOW_DAYS));
  });

  it('is unknown rather than now when the raise instant is missing or junk', () => {
    // Defaulting to `Date.now()` would make every dispute instantly overdue.
    expect(disputeReturnDeadline(null)).toBeNull();
    expect(disputeReturnDeadline(undefined)).toBeNull();
    expect(disputeReturnDeadline('not a date')).toBeNull();
  });
});

describe('disputeCollateralRisk', () => {
  const deadline = afterRaise(DISPUTE_RETURN_WINDOW_DAYS);

  it('reports the real case: a 7-day authorisation under a 14-day window', () => {
    // This is not an edge case, it is the DEFAULT. Collateral is placed when the
    // trade starts and lapses ~7 days later; a dispute is raised partway through, so
    // its window reaches past the authorisation almost every time.
    const holdExpiry = afterRaise(4);
    expect(disputeCollateralRisk(deadline, holdExpiry, new Date(RAISED))).toBe(
      'expired-first',
    );
  });

  it('separates collateral already gone from collateral about to go', () => {
    // Different conversations: one needs an operator, the other is still a race.
    const gone = afterRaise(2);
    expect(disputeCollateralRisk(deadline, gone, new Date(afterRaise(3)))).toBe('expired');
    expect(disputeCollateralRisk(deadline, gone, new Date(afterRaise(1)))).toBe(
      'expired-first',
    );
  });

  it('treats the moment of expiry as already expired, not as one last chance', () => {
    const holdExpiry = afterRaise(5);
    expect(disputeCollateralRisk(deadline, holdExpiry, new Date(holdExpiry))).toBe(
      'expired',
    );
  });

  it('calls under a day of margin tight, and a day or more safe', () => {
    const now = new Date(RAISED);
    // Boundary either side of exactly 24h of headroom.
    const barelyPast = new Date(Date.parse(deadline) + DAY_MS - 1).toISOString();
    const aFullDayPast = new Date(Date.parse(deadline) + DAY_MS).toISOString();

    expect(disputeCollateralRisk(deadline, barelyPast, now)).toBe('tight');
    expect(disputeCollateralRisk(deadline, aFullDayPast, now)).toBe('safe');
  });

  it('stays quiet when there is nothing to compare, rather than inventing a warning', () => {
    // A trade with no recorded hold expiry is not evidence of danger. Matches
    // `inspectionHoldRisk`, which makes the same call for the same reason.
    const now = new Date(RAISED);
    expect(disputeCollateralRisk(deadline, null, now)).toBe('safe');
    expect(disputeCollateralRisk(null, null, now)).toBe('safe');
  });

  it('still reports expiry when the deadline itself is unknown', () => {
    // The collateral being gone is true regardless of what it was meant to back, so
    // an unknown deadline must not suppress it.
    const now = new Date(afterRaise(9));
    expect(disputeCollateralRisk(null, afterRaise(7), now)).toBe('expired');
  });
});

describe('disputeReturnOverdue', () => {
  it('turns over exactly on the deadline', () => {
    const deadline = afterRaise(DISPUTE_RETURN_WINDOW_DAYS);
    expect(disputeReturnOverdue(deadline, new Date(Date.parse(deadline) - 1))).toBe(false);
    expect(disputeReturnOverdue(deadline, new Date(deadline))).toBe(true);
  });

  it('is never overdue without a deadline', () => {
    // A missing deadline must not be read as "late" — that would flag every dispute
    // raised before the window existed.
    expect(disputeReturnOverdue(null, new Date())).toBe(false);
  });

  it('is independent of whether the collateral survived', () => {
    // The two answer different questions, and conflating them is how a trade ends up
    // either chasing a return it already has or writing off one it does not.
    const deadline = afterRaise(DISPUTE_RETURN_WINDOW_DAYS);
    const now = new Date(afterRaise(8));

    expect(disputeReturnOverdue(deadline, now)).toBe(false);
    expect(disputeCollateralRisk(deadline, afterRaise(7), now)).toBe('expired');
  });
});
