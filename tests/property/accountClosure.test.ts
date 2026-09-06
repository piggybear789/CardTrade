// tests/property/accountClosure.test.ts
//
// Properties of the closure eligibility rule (Req 7.2, 7.3).
//
// Closure is the one irreversible thing a member can do to their own account, and
// the money rule is the only thing standing between "I am done with this app" and
// an open contract with no counterparty. These properties pin the two invariants
// the refusal rests on: money in flight always blocks, and the categories reported
// are exactly the ones present.
//
// The generators produce NON-NEGATIVE counts, because that is the valid input space
// — a count is a count of rows. The negative and otherwise-nonsense inputs are
// asserted as explicit examples below, where the defensive rule is the point rather
// than an exception to it.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  evaluateClosureEligibility,
  type ClosureBlocker,
  type MoneyInFlightSnapshot,
} from '@/domain/account/accountClosure';

const RUNS = { numRuns: 100 };

/** Each blocker paired with the snapshot field that reports it. */
const FIELD_BY_BLOCKER: readonly (readonly [ClosureBlocker, keyof MoneyInFlightSnapshot])[] = [
  ['ACTIVE_CASH_SALE', 'activeCashSaleCount'],
  ['ACTIVE_TRADE_COLLATERAL', 'activeTradeCollateralCount'],
  ['PENDING_PAYOUT', 'pendingPayoutCount'],
  ['OPEN_DISPUTE', 'openDisputeCount'],
];

/** A count as the repository would report it: a non-negative integer. */
const count = fc.nat({ max: 50 });

/** Any valid snapshot, including the all-zero one. */
const snapshot: fc.Arbitrary<MoneyInFlightSnapshot> = fc.record({
  activeCashSaleCount: count,
  activeTradeCollateralCount: count,
  pendingPayoutCount: count,
  openDisputeCount: count,
});

/**
 * A snapshot with at least one positive count: build any snapshot, then force one
 * chosen field positive. Filtering for "at least one positive" would also work but
 * would throw away most generated values; this constrains the space instead.
 */
const snapshotWithMoneyInFlight: fc.Arbitrary<MoneyInFlightSnapshot> = fc
  .tuple(
    snapshot,
    fc.constantFrom(...FIELD_BY_BLOCKER.map(([, field]) => field)),
    fc.integer({ min: 1, max: 50 }),
  )
  .map(([base, field, positive]) => ({ ...base, [field]: positive }));

const ZERO: MoneyInFlightSnapshot = {
  activeCashSaleCount: 0,
  activeTradeCollateralCount: 0,
  pendingPayoutCount: 0,
  openDisputeCount: 0,
};

describe('Feature: mobile-release-readiness, Property 1: Money in flight always blocks closure', () => {
  // Validates: Requirements 7.2, 7.3
  it('refuses closure with a non-empty blocker list whenever any count is positive', () => {
    fc.assert(
      fc.property(snapshotWithMoneyInFlight, (s) => {
        const decision = evaluateClosureEligibility(s);
        expect(decision.closable).toBe(false);
        expect(decision.blockers.length).toBeGreaterThan(0);
      }),
      RUNS,
    );
  });

  it('closes with no blockers only for the all-zero snapshot', () => {
    const decision = evaluateClosureEligibility(ZERO);
    expect(decision.closable).toBe(true);
    expect(decision.blockers).toEqual([]);
  });

  it('is closable if and only if the blocker list is empty, for any snapshot', () => {
    fc.assert(
      fc.property(snapshot, (s) => {
        const decision = evaluateClosureEligibility(s);
        expect(decision.closable).toBe(decision.blockers.length === 0);
      }),
      RUNS,
    );
  });
});

describe('Feature: mobile-release-readiness, Property 2: Blockers report exactly the categories present', () => {
  // Validates: Requirements 7.3
  it('lists a category if and only if that category count is positive', () => {
    fc.assert(
      fc.property(snapshot, (s) => {
        const { blockers } = evaluateClosureEligibility(s);
        for (const [blocker, field] of FIELD_BY_BLOCKER) {
          expect(blockers.includes(blocker)).toBe(s[field] > 0);
        }
      }),
      RUNS,
    );
  });

  it('never repeats a category', () => {
    fc.assert(
      fc.property(snapshot, (s) => {
        const { blockers } = evaluateClosureEligibility(s);
        expect(new Set(blockers).size).toBe(blockers.length);
      }),
      RUNS,
    );
  });

  it('reports blockers in one deterministic order regardless of the counts', () => {
    fc.assert(
      fc.property(snapshot, (s) => {
        const order = FIELD_BY_BLOCKER.map(([blocker]) => blocker);
        const { blockers } = evaluateClosureEligibility(s);
        const positions = blockers.map((blocker) => order.indexOf(blocker));
        // Strictly increasing: same relative order every time, never amount-ranked.
        for (let i = 1; i < positions.length; i += 1) {
          expect(positions[i]).toBeGreaterThan(positions[i - 1]);
        }
      }),
      RUNS,
    );
  });

  it('is a pure function of the snapshot', () => {
    fc.assert(
      fc.property(snapshot, (s) => {
        expect(evaluateClosureEligibility(s)).toEqual(evaluateClosureEligibility(s));
      }),
      RUNS,
    );
  });
});

describe('a count that is not a non-negative integer never reads as clear', () => {
  // A negative count is nonsense data. Reading it as "no money in flight" would let
  // a closure through on a bad read, so it blocks and its category is reported.
  const nonsense: readonly [string, number][] = [
    ['negative', -1],
    ['very negative', -9_999],
    ['fractional', 0.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative Infinity', Number.NEGATIVE_INFINITY],
  ];

  for (const [label, value] of nonsense) {
    for (const [blocker, field] of FIELD_BY_BLOCKER) {
      it(`refuses closure when ${field} is ${label}, and names ${blocker}`, () => {
        const decision = evaluateClosureEligibility({ ...ZERO, [field]: value });
        expect(decision.closable).toBe(false);
        expect(decision.blockers).toContain(blocker);
      });
    }
  }

  it('refuses closure when every count is negative, naming every category', () => {
    const decision = evaluateClosureEligibility({
      activeCashSaleCount: -1,
      activeTradeCollateralCount: -2,
      pendingPayoutCount: -3,
      openDisputeCount: -4,
    });
    expect(decision.closable).toBe(false);
    expect(decision.blockers).toEqual([
      'ACTIVE_CASH_SALE',
      'ACTIVE_TRADE_COLLATERAL',
      'PENDING_PAYOUT',
      'OPEN_DISPUTE',
    ]);
  });

  it('refuses closure when a count is missing entirely from an untyped boundary', () => {
    const partial = { activeCashSaleCount: 0, activeTradeCollateralCount: 0, pendingPayoutCount: 0 };
    const decision = evaluateClosureEligibility(partial as unknown as MoneyInFlightSnapshot);
    expect(decision.closable).toBe(false);
    expect(decision.blockers).toEqual(['OPEN_DISPUTE']);
  });
});
