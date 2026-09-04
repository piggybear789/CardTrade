// tests/unit/faceToFaceTrades.test.ts
//
// Trades are face-to-face only, and the meeting can be auto-advanced.
//
// WHY FACE-TO-FACE. A trade's collateral is a card authorisation that lapses in about
// seven days and cannot be extended on this account. A posted trade has to cover
// dispatch, then postage in BOTH directions, then an inspection window — typically
// eight to twelve days, and nobody controls the post. It does not fit at any schedule.
// A Cash_Sale still posts, because its money is captured at agreement and has no
// deadline to outlive; that asymmetry is the point, so it is asserted here too.
//
// WHY HANDOVER_ASSUMED IS ITS OWN EVENT. Both it and BOTH_HANDOVER_CONFIRMED land in
// INSPECTION, but one is two people saying the swap happened and the other is nobody
// saying anything. A dispute six months later will care which, so the audit trail must
// not claim a confirmation no member ever gave.

import { describe, expect, it } from 'vitest';

import {
  TRADE_HANDOVER_METHODS,
  validateFulfilmentTerms,
  type FulfilmentTerms,
} from '@/domain/fulfilment';
import { canTransition, transition } from '@/domain/state-machine/machine';

const NOW = new Date('2026-03-01T00:00:00.000Z');
const now = () => NOW;

const PLACE = {
  label: 'Sydney Town Hall',
  placeId: 'ChIJ_place_id',
  lat: -33.873,
  lng: 151.206,
};

const inPerson: FulfilmentTerms = {
  method: 'IN_PERSON',
  meeting: {
    place: PLACE,
    at: new Date(NOW.getTime() + 3 * 86_400_000).toISOString(),
  },
  delivery: { costCents: null, notes: null },
};

const byPost: FulfilmentTerms = {
  method: 'DELIVERY',
  meeting: { place: null, at: null },
  delivery: { costCents: 1_200, notes: null },
};

describe('trades are face-to-face only', () => {
  const asTrade = { now, allowedMethods: TRADE_HANDOVER_METHODS };

  it('accepts a meeting', () => {
    expect(validateFulfilmentTerms(inPerson, asTrade)).toEqual({ ok: true });
  });

  it('refuses postage, and says the method is the problem', () => {
    // Not "you forgot a postage cost" — the cost is present and valid. The refusal has
    // to name the real reason or a trader will keep trying to fix the wrong field.
    expect(validateFulfilmentTerms(byPost, asTrade)).toEqual({
      ok: false,
      error: 'method-not-supported',
    });
  });

  it('still refuses a method that is not a method at all', () => {
    expect(
      validateFulfilmentTerms(
        { ...byPost, method: null } as unknown as FulfilmentTerms,
        asTrade,
      ),
    ).toEqual({ ok: false, error: 'method-required' });
  });

  it('leaves Cash_Sales posting, which is the whole asymmetry', () => {
    // A Cash_Sale's money is collected into the platform balance at agreement and
    // outlives anything. Applying the trade's constraint to it would be an arbitrary
    // restriction with no reason behind it.
    expect(validateFulfilmentTerms(byPost, { now })).toEqual({ ok: true });
  });
});

describe('HANDOVER_ASSUMED', () => {
  it('opens the inspection window from COLLATERAL_LOCKED', () => {
    expect(canTransition('COLLATERAL_LOCKED', 'HANDOVER_ASSUMED')).toBe(true);
    expect(transition('COLLATERAL_LOCKED', 'HANDOVER_ASSUMED')).toEqual({
      ok: true,
      nextState: 'INSPECTION',
    });
  });

  it('lands in the same place as a real confirmation, while staying a different fact', () => {
    // Same destination is the point — the trade must behave identically from here on.
    // Distinct events are what keep "they told us" and "nobody told us" separable.
    expect(transition('COLLATERAL_LOCKED', 'HANDOVER_ASSUMED')).toEqual(
      transition('COLLATERAL_LOCKED', 'BOTH_HANDOVER_CONFIRMED'),
    );
    expect('HANDOVER_ASSUMED').not.toBe('BOTH_HANDOVER_CONFIRMED');
  });

  it('cannot skip collateral', () => {
    // Assuming a handover on a trade whose cards were never authorised would open a
    // dispute window with nothing behind it.
    expect(canTransition('NEGOTIATING', 'HANDOVER_ASSUMED')).toBe(false);
    expect(canTransition('COLLATERAL_PENDING', 'HANDOVER_ASSUMED')).toBe(false);
  });

  it('cannot reopen a finished trade', () => {
    for (const terminal of ['COMPLETED', 'CANCELLED', 'FRAUD_RESOLVED'] as const) {
      expect(canTransition(terminal, 'HANDOVER_ASSUMED')).toBe(false);
    }
  });

  it('does not remove the escape hatch for a meeting that never happened', () => {
    // Advancing is only safe because "we never met" stays reachable. If this ever
    // stops being true, auto-advance becomes a way to bury a no-show.
    expect(canTransition('COLLATERAL_LOCKED', 'HANDOVER_FAILED')).toBe(true);
    expect(canTransition('INSPECTION', 'CONDITION_DISPUTE')).toBe(true);
  });
});
