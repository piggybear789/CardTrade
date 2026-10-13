// tests/unit/offerTransitions.test.ts
//
// ESC-22: the one Offer status rule. Only a PENDING offer moves, and nothing ever
// returns to PENDING (members used to be able to revive a declined offer directly).

import { describe, expect, it } from 'vitest';

import { offerTransition, type OfferStatus } from '@/domain/offers/offerTransitions';

const ALL: OfferStatus[] = ['PENDING', 'ACCEPTED', 'DECLINED', 'COUNTERED', 'WITHDRAWN'];

describe('offerTransition', () => {
  it.each(['ACCEPTED', 'DECLINED', 'COUNTERED', 'WITHDRAWN'] as const)('PENDING -> %s is allowed', (to) => {
    expect(offerTransition('PENDING', to)).toEqual({ ok: true });
  });

  it('nothing moves back to PENDING, and no terminal status moves at all', () => {
    for (const from of ALL.filter((s) => s !== 'PENDING')) {
      for (const to of ALL) {
        expect(offerTransition(from, to), `${from} -> ${to}`).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
      }
    }
  });

  it('PENDING -> PENDING is not a transition', () => {
    expect(offerTransition('PENDING', 'PENDING')).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
  });
});
