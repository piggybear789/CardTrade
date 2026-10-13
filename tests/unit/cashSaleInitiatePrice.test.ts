// tests/unit/cashSaleInitiatePrice.test.ts
//
// ESC-22: a buyer opening a purchase on a SINGLE listing cannot choose the price. The
// public action ignores a supplied `agreedPriceCents` and the sale opens at the
// listing's own price.

import { describe, expect, it, vi } from 'vitest';

const initiate = vi.fn(async (_params: Record<string, unknown>) => ({ ok: false as const, error: 'ITEM_NOT_FOUND' as const }));

vi.mock('@/lib/supabase/cachedAuth', () => ({ getCachedAuthUser: async () => ({ id: 'buyer-1' }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'buyer-1' } } }) } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/domain/services', () => ({ getPaymentService: () => ({}) }));
vi.mock('@/domain/orchestrator/supabaseCashSaleRepository', () => ({
  createDefaultCashSaleOrchestrator: () => ({ initiateCashSale: (p: Record<string, unknown>) => initiate(p) }),
}));
vi.mock('@/lib/notifications/createNotification', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/notifications/settlementNotifier', () => ({ notifyCashSaleSettled: vi.fn() }));
vi.mock('@/lib/email', () => ({ emailNotify: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/errors/withActionLog', () => ({ withActionLog: (_n: string, fn: unknown) => fn }));

import { initiateCashSale as initiateDomain } from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import { ITEM, fakeTracking, makeCashSaleRepository, makePayments } from './fakes/cashSaleRepository';
import { PURCHASE } from './helpers/disputedCashSale';

describe('initiateCashSale price (ESC-22)', () => {
  it('the public action never forwards a buyer-supplied price', async () => {
    const { initiateCashSale } = await import('@/lib/actions/cashSale');
    await initiateCashSale({
      itemId: 'item-1',
      sellerIdentityVersion: 'v1',
      buyerConfirmedSellerIdentity: true,
      agreedPriceCents: 1,
    });
    expect(initiate).toHaveBeenCalledTimes(1);
    expect(initiate.mock.calls[0][0]).not.toHaveProperty('agreedPriceCents');
  });

  it('a SINGLE listing opens at its own price when no price is passed', async () => {
    const { repository } = makeCashSaleRepository();
    const { payments } = makePayments();
    const result = await initiateDomain(
      { repository, payments: payments as unknown as PaymentService, tracking: fakeTracking },
      PURCHASE,
    );
    expect(result.ok && result.sale.agreedPriceCents).toBe(ITEM.fmvCents);
  });
});
