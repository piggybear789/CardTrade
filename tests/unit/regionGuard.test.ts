// tests/unit/regionGuard.test.ts
//
// The region precondition on opening a contract (0065).
//
// WHAT THIS PINS SHUT. The catalog is region-scoped, and it would be easy to treat
// that as sufficient. It is not: a browse filter is bypassed by a shared link, a
// watchlist entry, a saved search, or opening `/listings/[id]` directly. Before this
// guard a Buyer could agree a contract with a Seller in another jurisdiction and the
// failure would surface at transfer time, with the Buyer's money already collected
// into the platform balance and the goods possibly already posted.
//
// The second thing pinned here is that an ABSENT region is refused rather than
// waved through. "We do not know where either party is" is not a basis for taking
// someone's money, and a permissive default would mean every pre-0065 Profile
// silently bypassed the guard entirely.

import { describe, expect, it } from 'vitest';

import {
  checkRegionCompatibility,
  isTradingRegion,
  normalizeRegionCode,
  regionMismatchMessage,
  tradingRegions,
} from '@/domain/region';
import { initiateCashSale } from '@/domain/orchestrator/cashSaleOrchestrator';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import {
  BUYER,
  fakeTracking,
  ITEM,
  TEST_REGION,
  makeCashSaleRepository,
} from './fakes/cashSaleRepository';

function deps(options: Parameters<typeof makeCashSaleRepository>[0] = {}) {
  const { repository } = makeCashSaleRepository(options);
  return {
    repository,
    payments: new InMemoryService(),
    tracking: fakeTracking,
  };
}

const AGREEMENT = {
  buyerId: BUYER.profileId,
  itemId: ITEM.id,
  sellerIdentityVersion: 'seller-v1',
  buyerConfirmedSellerIdentity: true,
};

describe('normalizeRegionCode', () => {
  it('accepts any casing and surrounding whitespace', () => {
    expect(normalizeRegionCode('au')).toBe('AU');
    expect(normalizeRegionCode('  Au  ')).toBe('AU');
  });

  it('rejects anything that is not a listed region', () => {
    // Rejected rather than passed through. A code nothing recognises would become a
    // catalog predicate that matches no row, which reads to a member as an outage.
    expect(normalizeRegionCode('ZZ')).toBeNull();
    expect(normalizeRegionCode('AUS')).toBeNull();
    expect(normalizeRegionCode('all')).toBeNull();
    expect(normalizeRegionCode('')).toBeNull();
    expect(normalizeRegionCode(null)).toBeNull();
    expect(normalizeRegionCode(42)).toBeNull();
  });
});

describe('checkRegionCompatibility', () => {
  it('permits two parties in the same enabled region', () => {
    expect(checkRegionCompatibility('AU', 'AU')).toBeNull();
  });

  it('refuses when either region is missing', () => {
    expect(checkRegionCompatibility(null, 'AU')).toMatchObject({
      reason: 'UNKNOWN_REGION',
    });
    expect(checkRegionCompatibility('AU', null)).toMatchObject({
      reason: 'UNKNOWN_REGION',
    });
    expect(checkRegionCompatibility(undefined, undefined)).toMatchObject({
      reason: 'UNKNOWN_REGION',
    });
  });

  it('refuses two different regions', () => {
    expect(checkRegionCompatibility('AU', 'GB')).toMatchObject({
      reason: 'CROSS_REGION',
      buyerRegion: 'AU',
      sellerRegion: 'GB',
    });
  });

  it('refuses a matched pair in a region that is not open for deals', () => {
    // Browsable is not tradeable. A region can exist in the registry — so its
    // listings are visible and its filter works — long before Connect onboarding
    // and currency handling are finished for it.
    expect(isTradingRegion('GB')).toBe(false);
    expect(checkRegionCompatibility('GB', 'GB')).toMatchObject({
      reason: 'REGION_NOT_ENABLED',
    });
  });

  it('treats an unknown code as unknown rather than as a literal match', () => {
    // Two identical garbage values must NOT satisfy the guard. Comparing raw
    // strings would have let `checkRegionCompatibility('ZZ', 'ZZ')` through.
    expect(checkRegionCompatibility('ZZ', 'ZZ')).toMatchObject({
      reason: 'UNKNOWN_REGION',
    });
  });

  it('only offers enabled regions as a member-selectable trading region', () => {
    // `setTradingRegion` and the onboarding step both read this. Offering a
    // browse-only region would badge a member ready to trade and then refuse every
    // contract they opened — the shape of the 0060 mistake.
    for (const region of tradingRegions()) {
      expect(isTradingRegion(region.code)).toBe(true);
    }
  });
});

describe('regionMismatchMessage', () => {
  it('distinguishes a fixable cause from a permanent one', () => {
    // A member with no region can act; a member facing an overseas seller cannot.
    // One generic "not available in your region" would hide that difference.
    const mine = regionMismatchMessage({
      reason: 'UNKNOWN_REGION',
      buyerRegion: null,
      sellerRegion: 'AU',
    });
    expect(mine).toMatch(/your region/i);

    const theirs = regionMismatchMessage({
      reason: 'UNKNOWN_REGION',
      buyerRegion: 'AU',
      sellerRegion: null,
    });
    expect(theirs).toMatch(/seller/i);
    expect(theirs).not.toBe(mine);
  });

  it('names both regions on a cross-region refusal', () => {
    const message = regionMismatchMessage({
      reason: 'CROSS_REGION',
      buyerRegion: 'AU',
      sellerRegion: 'GB',
    });
    expect(message).toContain('Australia');
    expect(message).toContain('United Kingdom');
  });
});

describe('initiateCashSale — region precondition', () => {
  it('opens an agreement when both parties share an enabled region', async () => {
    const result = await initiateCashSale(deps(), AGREEMENT);
    expect(result.ok).toBe(true);
  });

  it('refuses a buyer in a different region from the seller', async () => {
    const result = await initiateCashSale(
      deps({ item: { ...ITEM, ownerRegionCode: 'GB' } }),
      AGREEMENT,
    );
    expect(result).toMatchObject({ ok: false, error: 'REGION_MISMATCH' });
    // The detail is what the member reads, so it has to say more than "refused".
    expect(result.ok === false && result.detail).toMatch(/United Kingdom/);
  });

  it('refuses when the seller has no region on file', async () => {
    const result = await initiateCashSale(
      deps({ item: { ...ITEM, ownerRegionCode: null } }),
      AGREEMENT,
    );
    expect(result).toMatchObject({ ok: false, error: 'REGION_MISMATCH' });
  });

  it('refuses when the buyer has no region on file', async () => {
    const result = await initiateCashSale(
      deps({ buyer: { ...BUYER, regionCode: null } }),
      AGREEMENT,
    );
    expect(result).toMatchObject({ ok: false, error: 'REGION_MISMATCH' });
  });

  it('reports the region problem before asking about seller identity', async () => {
    // Ordering matters for the member, not just for the code: being asked to
    // confirm a verified seller you can never buy from is a dead end. The region
    // check therefore precedes the identity disclosure, and this asserts it by
    // giving the seller NO payee record — which would otherwise fail with
    // SELLER_IDENTITY_UNVERIFIED.
    const result = await initiateCashSale(
      deps({ payee: null, item: { ...ITEM, ownerRegionCode: 'GB' } }),
      AGREEMENT,
    );
    expect(result).toMatchObject({ ok: false, error: 'REGION_MISMATCH' });
  });

  it('still refuses a self-purchase before considering region', async () => {
    // A buyer trading with themselves is a clearer error than a region one, and it
    // is reachable regardless of what regions say.
    const result = await initiateCashSale(deps(), {
      ...AGREEMENT,
      buyerId: ITEM.ownerId,
    });
    expect(result).toMatchObject({ ok: false, error: 'SELF_PURCHASE' });
  });

  it('uses the seller region and not the listing location', async () => {
    // The two are deliberately different facts: a seller may post a listing while
    // travelling, and the guard is about which jurisdiction the MONEY moves in.
    // Sharing the seller's region is sufficient even though nothing here says
    // anything about where the goods are.
    const result = await initiateCashSale(
      deps({
        buyer: { ...BUYER, regionCode: TEST_REGION },
        item: { ...ITEM, ownerRegionCode: TEST_REGION },
      }),
      AGREEMENT,
    );
    expect(result.ok).toBe(true);
  });
});
