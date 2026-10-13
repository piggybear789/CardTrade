// tests/unit/releasePolicy.test.ts
//
// The one rule for when held money may leave the platform (design §1.1).

import { describe, expect, it } from 'vitest';

import {
  CAPTURED_COLLATERAL_HOLDBACK_HOURS,
  IN_PERSON_MIN_HOLD_HOURS,
  NEW_SELLER_HOLDBACK_HOURS,
  decideRelease,
  exceedsNewSellerExposure,
  type ReleaseFacts,
} from '@/domain/payouts/releasePolicy';

const HOUR = 3_600_000;
const NOW = new Date('2026-05-10T12:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();
const later = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();

function facts(over: Partial<ReleaseFacts> = {}): ReleaseFacts {
  return {
    source: 'CASH_SALE',
    currency: 'aud',
    qualifyingCompletedSales: 5,
    paymentSettledAt: ago(48),
    openChargeDispute: false,
    openFraudWarning: false,
    staffHold: false,
    ...over,
  };
}

describe('decideRelease', () => {
  it('releases an established seller on the next drain', () => {
    expect(decideRelease(facts(), NOW)).toEqual({ kind: 'RELEASE_NOW' });
  });

  it('holds a new seller until 7 days after collection', () => {
    expect(decideRelease(facts({ qualifyingCompletedSales: 2, paymentSettledAt: ago(24) }), NOW)).toEqual({
      kind: 'RELEASE_AT',
      at: later(NEW_SELLER_HOLDBACK_HOURS - 24),
      reason: 'NEW_SELLER',
    });
  });

  it('releases a new seller once the holdback has passed', () => {
    expect(
      decideRelease(facts({ qualifyingCompletedSales: 0, paymentSettledAt: ago(NEW_SELLER_HOLDBACK_HOURS + 1) }), NOW),
    ).toEqual({ kind: 'RELEASE_NOW' });
  });

  it('fails closed for a new seller with no collection instant', () => {
    expect(decideRelease(facts({ qualifyingCompletedSales: 0, paymentSettledAt: null }), NOW)).toEqual({
      kind: 'HELD',
      reason: 'STAFF',
    });
  });

  it('holds an in-person deal for 24h after the later confirmation', () => {
    expect(decideRelease(facts({ inPersonConfirmedAt: ago(2) }), NOW)).toEqual({
      kind: 'RELEASE_AT',
      at: later(IN_PERSON_MIN_HOLD_HOURS - 2),
      reason: 'IN_PERSON',
    });
  });

  it('takes the max of every applicable floor', () => {
    // New-seller floor ends in 6 days; the in-person floor in 23 hours.
    const decision = decideRelease(
      facts({ qualifyingCompletedSales: 1, paymentSettledAt: ago(24), inPersonConfirmedAt: ago(1) }),
      NOW,
    );
    expect(decision).toEqual({ kind: 'RELEASE_AT', at: later(NEW_SELLER_HOLDBACK_HOURS - 24), reason: 'NEW_SELLER' });

    // And the other way round: an old collection, a fresh confirmation.
    const other = decideRelease(
      facts({ qualifyingCompletedSales: 1, paymentSettledAt: ago(NEW_SELLER_HOLDBACK_HOURS - 1), inPersonConfirmedAt: ago(1) }),
      NOW,
    );
    expect(other).toEqual({ kind: 'RELEASE_AT', at: later(IN_PERSON_MIN_HOLD_HOURS - 1), reason: 'IN_PERSON' });
  });

  it('holds captured collateral for 7 days after the capture', () => {
    expect(
      decideRelease(facts({ source: 'CAPTURED_COLLATERAL', paymentSettledAt: null, capturedAt: ago(1) }), NOW),
    ).toEqual({ kind: 'RELEASE_AT', at: later(CAPTURED_COLLATERAL_HOLDBACK_HOURS - 1), reason: 'CAPTURED_COLLATERAL' });
    expect(
      decideRelease(
        facts({ source: 'CAPTURED_COLLATERAL', paymentSettledAt: null, capturedAt: ago(CAPTURED_COLLATERAL_HOLDBACK_HOURS) }),
        NOW,
      ),
    ).toEqual({ kind: 'RELEASE_NOW' });
  });

  it('never applies the new-seller rule to captured collateral, and fails closed without a capture instant', () => {
    expect(
      decideRelease(
        facts({ source: 'CAPTURED_COLLATERAL', qualifyingCompletedSales: 0, paymentSettledAt: null, capturedAt: ago(200) }),
        NOW,
      ),
    ).toEqual({ kind: 'RELEASE_NOW' });
    expect(decideRelease(facts({ source: 'CAPTURED_COLLATERAL', capturedAt: null }), NOW)).toEqual({
      kind: 'HELD',
      reason: 'STAFF',
    });
  });

  it('applies the same rules to a trade cash leg', () => {
    expect(decideRelease(facts({ source: 'TRADE_CASH', qualifyingCompletedSales: 0, paymentSettledAt: ago(1) }), NOW).kind).toBe(
      'RELEASE_AT',
    );
  });

  it('lets HELD dominate any instant, in a fixed order', () => {
    const base = facts({ qualifyingCompletedSales: 0, paymentSettledAt: ago(1), inPersonConfirmedAt: ago(1) });
    expect(decideRelease({ ...base, staffHold: true }, NOW)).toEqual({ kind: 'HELD', reason: 'STAFF' });
    expect(decideRelease({ ...base, staffHold: true, openFraudWarning: true }, NOW)).toEqual({
      kind: 'HELD',
      reason: 'FRAUD_WARNING',
    });
    expect(decideRelease({ ...base, staffHold: true, openFraudWarning: true, openChargeDispute: true }, NOW)).toEqual({
      kind: 'HELD',
      reason: 'CHARGE_DISPUTE',
    });
  });
});

describe('exceedsNewSellerExposure', () => {
  const base = { qualifyingCompletedSales: 0, openCollectedMinor: 150_000, currency: 'aud' };

  it('refuses a new seller over the per-currency limit', () => {
    expect(exceedsNewSellerExposure({ ...base, addMinor: 50_000 })).toBe(false);
    expect(exceedsNewSellerExposure({ ...base, addMinor: 50_001 })).toBe(true);
  });

  it('never limits an established seller', () => {
    expect(exceedsNewSellerExposure({ ...base, qualifyingCompletedSales: 3, addMinor: 10_000_000 })).toBe(false);
  });

  it('refuses a new seller in an unlisted currency', () => {
    expect(exceedsNewSellerExposure({ ...base, currency: 'gbp', openCollectedMinor: 0, addMinor: 1 })).toBe(true);
  });

  it('uses a non-null override as the limit whatever the currency or history', () => {
    expect(exceedsNewSellerExposure({ ...base, currency: 'gbp', addMinor: 50_000, overrideMinor: 250_000 })).toBe(false);
    expect(exceedsNewSellerExposure({ ...base, addMinor: 150_000, overrideMinor: 250_000 })).toBe(true);
    // An override binds even an established seller.
    expect(exceedsNewSellerExposure({ ...base, qualifyingCompletedSales: 9, addMinor: 1, overrideMinor: 150_000 })).toBe(true);
  });

  it('treats an override of 0 as a pause and null as no override', () => {
    expect(exceedsNewSellerExposure({ ...base, openCollectedMinor: 0, addMinor: 1, overrideMinor: 0 })).toBe(true);
    expect(exceedsNewSellerExposure({ ...base, addMinor: 1, overrideMinor: null })).toBe(false);
  });
});
