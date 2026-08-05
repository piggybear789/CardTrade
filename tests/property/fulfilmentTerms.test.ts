// tests/property/fulfilmentTerms.test.ts
//
// Properties of the shared fulfilment validator and normalizer, which the Cash_Sale
// room, the trade room and the trade negotiation counter all now go through.
//
// The point of one implementation is that the same terms get the same answer
// wherever they are entered. These properties pin the invariants that made the three
// hand-written copies disagree: a free-text meeting point being accepted in one place
// and refused in another, and a row ending up with both a meeting point and a postage
// price.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DELIVERY_COST_MAX_CENTS,
  areFulfilmentTermsComplete,
  isResolvedPlace,
  normalizeFulfilmentTerms,
  validateFulfilmentTerms,
  type FulfilmentTerms,
} from '@/domain/fulfilment';
import { DEAL_DELIVERY_COST_MAX } from '@/lib/marketplace-constants';

/** A place the address provider resolved: real coordinates and a provider id. */
const resolvedPlace = fc.record({
  label: fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
  placeId: fc
    .string({ minLength: 3, maxLength: 30 })
    .filter((s) => !s.startsWith('text:') && !s.startsWith('legacy:')),
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

/** A future instant, as the ISO string the validator receives. */
const futureIso = fc
  .integer({ min: 60_000, max: 365 * 24 * 3_600_000 })
  .map((ms) => new Date(Date.now() + ms).toISOString());

const deliveryCost = fc.integer({ min: 0, max: DELIVERY_COST_MAX_CENTS });

describe('the domain cost cap matches the app constant', () => {
  it('does not drift from DEAL_DELIVERY_COST_MAX', () => {
    // `domain/` may not import `lib/`, so the cap is duplicated. This test is the
    // thing that stops the copies diverging.
    expect(DELIVERY_COST_MAX_CENTS).toBe(DEAL_DELIVERY_COST_MAX);
  });
});

describe('validateFulfilmentTerms', () => {
  it('accepts a resolved place with a future time', () => {
    fc.assert(
      fc.property(resolvedPlace, futureIso, (place, at) => {
        const result = validateFulfilmentTerms({
          method: 'IN_PERSON',
          meeting: { place, at },
          delivery: { costCents: null, notes: null },
        });
        expect(result.ok).toBe(true);
      }),
    );
  });

  it('refuses any meeting point the provider did not resolve', () => {
    // A typed string cannot be mapped and cannot be compared between two people who
    // each believe they agreed on the same spot. An invented pin is worse than none,
    // because it looks authoritative.
    fc.assert(
      fc.property(
        resolvedPlace,
        futureIso,
        fc.constantFrom('text:', 'legacy:'),
        (place, at, prefix) => {
          const result = validateFulfilmentTerms({
            method: 'IN_PERSON',
            meeting: { place: { ...place, placeId: `${prefix}${place.placeId}` }, at },
            delivery: { costCents: null, notes: null },
          });
          expect(result).toEqual({ ok: false, error: 'meeting-place-unresolved' });
        },
      ),
    );
  });

  it('always requires a meeting time', () => {
    // Trades used to treat this as optional, which left a face-to-face trade with no
    // instant to measure an inspection window from — so its collateral raced the card
    // authorisation with nothing to stop it.
    fc.assert(
      fc.property(resolvedPlace, (place) => {
        const result = validateFulfilmentTerms({
          method: 'IN_PERSON',
          meeting: { place, at: null },
          delivery: { costCents: null, notes: null },
        });
        expect(result).toEqual({ ok: false, error: 'meeting-time-required' });
      }),
    );
  });

  it('refuses a meeting time in the past', () => {
    fc.assert(
      fc.property(
        resolvedPlace,
        fc.integer({ min: 1_000, max: 365 * 24 * 3_600_000 }),
        (place, agoMs) => {
          const result = validateFulfilmentTerms({
            method: 'IN_PERSON',
            meeting: { place, at: new Date(Date.now() - agoMs).toISOString() },
            delivery: { costCents: null, notes: null },
          });
          expect(result).toEqual({ ok: false, error: 'meeting-time-past' });
        },
      ),
    );
  });

  it('accepts any whole postage amount within the cap, including free', () => {
    fc.assert(
      fc.property(deliveryCost, (costCents) => {
        const result = validateFulfilmentTerms({
          method: 'DELIVERY',
          meeting: { place: null, at: null },
          delivery: { costCents, notes: null },
        });
        expect(result.ok).toBe(true);
      }),
    );
  });

  it('refuses a negative, fractional or over-cap postage amount', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1_000_000, max: -1 }),
          fc.constant(1.5),
          fc.integer({ min: DELIVERY_COST_MAX_CENTS + 1, max: Number.MAX_SAFE_INTEGER }),
        ),
        (costCents) => {
          const result = validateFulfilmentTerms({
            method: 'DELIVERY',
            meeting: { place: null, at: null },
            delivery: { costCents, notes: null },
          });
          expect(result).toEqual({ ok: false, error: 'delivery-cost-invalid' });
        },
      ),
    );
  });

  it('demands a resolved address only from the party who receives goods', () => {
    fc.assert(
      fc.property(deliveryCost, resolvedPlace, (costCents, place) => {
        const terms: FulfilmentTerms = {
          method: 'DELIVERY',
          meeting: { place: null, at: null },
          delivery: { costCents, notes: null },
        };
        // A Cash_Sale Seller receives nothing by post and is never asked.
        expect(validateFulfilmentTerms(terms).ok).toBe(true);
        // A Buyer, or either trader on a swap, must supply one.
        expect(
          validateFulfilmentTerms(terms, { requireDeliveryAddress: true }),
        ).toEqual({ ok: false, error: 'delivery-address-required' });
        expect(
          validateFulfilmentTerms(terms, {
            requireDeliveryAddress: true,
            deliveryAddress: {
              label: place.label,
              placeId: place.placeId,
              countryCode: null,
              lat: place.lat,
              lng: place.lng,
            },
          }).ok,
        ).toBe(true);
      }),
    );
  });

  it('refuses terms with no method at all', () => {
    expect(
      validateFulfilmentTerms({
        method: null,
        meeting: { place: null, at: null },
        delivery: { costCents: 0, notes: null },
      }),
    ).toEqual({ ok: false, error: 'method-required' });
  });
});

describe('normalizeFulfilmentTerms', () => {
  it('never leaves both methods populated', () => {
    // A row carrying a meeting point AND a postage price has two answers to one
    // question, and whoever reads it picks.
    fc.assert(
      fc.property(
        fc.constantFrom('IN_PERSON' as const, 'DELIVERY' as const),
        resolvedPlace,
        futureIso,
        deliveryCost,
        (method, place, at, costCents) => {
          const normalized = normalizeFulfilmentTerms({
            method,
            meeting: { place, at },
            delivery: { costCents, notes: '  notes  ' },
          });
          if (method === 'IN_PERSON') {
            expect(normalized.delivery.costCents).toBeNull();
            expect(normalized.delivery.notes).toBeNull();
            expect(normalized.meeting.place).not.toBeNull();
          } else {
            expect(normalized.meeting.place).toBeNull();
            expect(normalized.meeting.at).toBeNull();
            expect(normalized.delivery.costCents).toBe(costCents);
          }
        },
      ),
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('IN_PERSON' as const, 'DELIVERY' as const, null),
        resolvedPlace,
        futureIso,
        deliveryCost,
        (method, place, at, costCents) => {
          const once = normalizeFulfilmentTerms({
            method,
            meeting: { place, at },
            delivery: { costCents, notes: 'x' },
          });
          expect(normalizeFulfilmentTerms(once)).toEqual(once);
        },
      ),
    );
  });

  it('leaves valid terms valid', () => {
    fc.assert(
      fc.property(resolvedPlace, futureIso, (place, at) => {
        const normalized = normalizeFulfilmentTerms({
          method: 'IN_PERSON',
          meeting: { place, at },
          delivery: { costCents: null, notes: null },
        });
        expect(validateFulfilmentTerms(normalized).ok).toBe(true);
        expect(areFulfilmentTermsComplete(normalized)).toBe(true);
      }),
    );
  });
});

describe('areFulfilmentTermsComplete', () => {
  it('is implied by validity, but not the reverse', () => {
    // Completeness is deliberately the weaker test: an in-flight contract agreed
    // before a rule tightened must stay readable rather than becoming invalid.
    fc.assert(
      fc.property(resolvedPlace, futureIso, (place, at) => {
        const valid: FulfilmentTerms = {
          method: 'IN_PERSON',
          meeting: { place, at },
          delivery: { costCents: null, notes: null },
        };
        expect(validateFulfilmentTerms(valid).ok).toBe(true);
        expect(areFulfilmentTermsComplete(valid)).toBe(true);

        // Same place, no time: still "set", no longer valid.
        const timeless: FulfilmentTerms = { ...valid, meeting: { place, at: null } };
        expect(areFulfilmentTermsComplete(timeless)).toBe(true);
        expect(validateFulfilmentTerms(timeless).ok).toBe(false);
      }),
    );
  });

  it('is false when no method has been chosen', () => {
    expect(
      areFulfilmentTermsComplete({
        method: null,
        meeting: { place: null, at: null },
        delivery: { costCents: 5_00, notes: null },
      }),
    ).toBe(false);
  });
});

describe('isResolvedPlace', () => {
  it('rejects out-of-range coordinates whatever the id looks like', () => {
    fc.assert(
      fc.property(
        resolvedPlace,
        fc.oneof(
          fc.double({ min: 90.001, max: 1e6, noNaN: true }),
          fc.double({ min: -1e6, max: -90.001, noNaN: true }),
        ),
        (place, lat) => {
          expect(isResolvedPlace({ ...place, lat })).toBe(false);
        },
      ),
    );
  });

  it('rejects a blank label', () => {
    fc.assert(
      fc.property(resolvedPlace, (place) => {
        expect(isResolvedPlace({ ...place, label: '   ' })).toBe(false);
      }),
    );
  });
});
