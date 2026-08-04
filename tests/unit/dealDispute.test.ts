// tests/unit/dealDispute.test.ts
//
// Deal dispute resolution arithmetic.
//
// WHAT THESE PROTECT. A disputed deal's cash is an uncaptured authorisation, and the
// three outcomes differ only in how much of it is captured. Two mistakes here are
// invisible in a screenshot and expensive in production:
//
//   1. A SPLIT that is silently widened to a full capture or a full release. The two
//      produce different terminal states for the deal and different copy for the
//      parties, so reinterpreting one as the other misreports the finding AND moves the
//      wrong amount.
//   2. A split reported as REFUNDED. `refund_cents > 0` is true on a split, so a naive
//      "any refund means refunded" rule would tell a recipient who WAS paid that they
//      received nothing.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DEAL_DISPUTE_OUTCOMES,
  dealDisputeMovesMoney,
  dealPaymentStatusFor,
  dealTerminalStateFor,
  parseDealDisputeOutcome,
  resolveDealCashDisposition,
} from '@/domain/deal/dealDispute';

const HELD = 25_000;

describe('resolveDealCashDisposition', () => {
  it('releases the whole authorisation when the deal is unwound', () => {
    expect(
      resolveDealCashDisposition({ heldCents: HELD, outcome: 'REFUND_PAYER' }),
    ).toEqual({ captureCents: 0, releaseCents: HELD });
  });

  it('captures the whole authorisation when the dispute is not upheld', () => {
    expect(
      resolveDealCashDisposition({ heldCents: HELD, outcome: 'RELEASE_RECIPIENT' }),
    ).toEqual({ captureCents: HELD, releaseCents: 0 });
  });

  it('splits into a capture and a release that sum to what was held', () => {
    expect(
      resolveDealCashDisposition({
        heldCents: HELD,
        outcome: 'SPLIT',
        recipientCents: 18_000,
      }),
    ).toEqual({ captureCents: 18_000, releaseCents: 7_000 });
  });

  it('refuses a split of zero rather than treating it as an unwind', () => {
    expect(
      resolveDealCashDisposition({ heldCents: HELD, outcome: 'SPLIT', recipientCents: 0 }),
    ).toBeNull();
  });

  it('refuses a split of the whole amount rather than treating it as an uphold', () => {
    expect(
      resolveDealCashDisposition({
        heldCents: HELD,
        outcome: 'SPLIT',
        recipientCents: HELD,
      }),
    ).toBeNull();
  });

  it('refuses a split larger than what was authorised', () => {
    // Capturing more than the authorisation is not something the provider would allow,
    // and an arbitrator who typed an extra zero should be told, not silently clamped.
    expect(
      resolveDealCashDisposition({
        heldCents: HELD,
        outcome: 'SPLIT',
        recipientCents: HELD * 10,
      }),
    ).toBeNull();
  });

  it('refuses a missing split amount', () => {
    expect(
      resolveDealCashDisposition({ heldCents: HELD, outcome: 'SPLIT' }),
    ).toBeNull();
  });

  it('handles a goods-for-goods deal with no cash at all', () => {
    // Both non-split outcomes collapse to "nothing moves", and neither is an error: a
    // goods swap can still be disputed, and the outcome is a record of what was found.
    expect(
      resolveDealCashDisposition({ heldCents: 0, outcome: 'REFUND_PAYER' }),
    ).toEqual({ captureCents: 0, releaseCents: 0 });
    expect(
      resolveDealCashDisposition({ heldCents: 0, outcome: 'RELEASE_RECIPIENT' }),
    ).toEqual({ captureCents: 0, releaseCents: 0 });
    // A split of nothing is incoherent, so it is refused.
    expect(
      resolveDealCashDisposition({ heldCents: 0, outcome: 'SPLIT', recipientCents: 1 }),
    ).toBeNull();
  });

  it('never disposes of more or less than was authorised', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.constantFrom(...DEAL_DISPUTE_OUTCOMES),
        fc.integer({ min: 0, max: 5_000_000 }),
        (heldCents, outcome, recipientCents) => {
          const disposition = resolveDealCashDisposition({
            heldCents,
            outcome,
            recipientCents,
          });
          if (disposition === null) return;

          // The invariant the whole flow rests on: what is taken plus what is given
          // back is exactly what was authorised. Anything else means the platform
          // either short-changed someone or tried to capture money it never held.
          expect(disposition.captureCents + disposition.releaseCents).toBe(heldCents);
          expect(disposition.captureCents).toBeGreaterThanOrEqual(0);
          expect(disposition.releaseCents).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe('dealPaymentStatusFor', () => {
  it('reports a split as SETTLED, not REFUNDED', () => {
    // The recipient WAS paid, just less than agreed. `refund_cents` carries the rest.
    expect(dealPaymentStatusFor({ captureCents: 18_000, releaseCents: 7_000 })).toBe(
      'SETTLED',
    );
  });

  it('reports a full release as REFUNDED', () => {
    expect(dealPaymentStatusFor({ captureCents: 0, releaseCents: HELD })).toBe('REFUNDED');
  });

  it('reports a no-cash deal as REFUNDED rather than claiming a settlement', () => {
    expect(dealPaymentStatusFor({ captureCents: 0, releaseCents: 0 })).toBe('REFUNDED');
  });
});

describe('dealTerminalStateFor', () => {
  it('unwinds to CANCELLED and upholds to COMPLETED', () => {
    expect(dealTerminalStateFor('REFUND_PAYER')).toBe('CANCELLED');
    expect(dealTerminalStateFor('SPLIT')).toBe('COMPLETED');
    expect(dealTerminalStateFor('RELEASE_RECIPIENT')).toBe('COMPLETED');
  });

  it('only ever lands in a terminal state', () => {
    // Guards against a future outcome being added that routes back into ESCROW_LOCKED,
    // which would leave money held with no further decision owed.
    for (const outcome of DEAL_DISPUTE_OUTCOMES) {
      expect(['COMPLETED', 'CANCELLED']).toContain(dealTerminalStateFor(outcome));
    }
  });
});

describe('parseDealDisputeOutcome', () => {
  it('accepts only the three outcomes', () => {
    for (const outcome of DEAL_DISPUTE_OUTCOMES) {
      expect(parseDealDisputeOutcome(outcome)).toBe(outcome);
    }
  });

  it('refuses anything else rather than defaulting', () => {
    // Each outcome moves a different amount of someone else's money, so a mistyped
    // payload must fail rather than pick one.
    for (const bad of ['refund_payer', 'REFUND', '', null, undefined, 0, {}]) {
      expect(parseDealDisputeOutcome(bad)).toBeNull();
    }
  });
});

describe('dealDisputeMovesMoney', () => {
  it('is false for a goods-only deal and for a missing cash row', () => {
    expect(dealDisputeMovesMoney(null)).toBe(false);
    expect(dealDisputeMovesMoney({ captureCents: 0, releaseCents: 0 })).toBe(false);
  });

  it('is true whenever an authorisation is captured or released', () => {
    expect(dealDisputeMovesMoney({ captureCents: 0, releaseCents: 100 })).toBe(true);
    expect(dealDisputeMovesMoney({ captureCents: 100, releaseCents: 0 })).toBe(true);
  });
});
