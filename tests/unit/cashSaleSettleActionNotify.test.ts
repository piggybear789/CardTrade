// tests/unit/cashSaleSettleActionNotify.test.ts
//
// The SYNCHRONOUS settlement path (FEAT-002): Stripe realtime (and the mock)
// settle a cash sale INLINE inside acceptCashSaleTerms, so the returned status is
// ESCROW_HELD / HANDOVER rather than PAYMENT_PENDING. When that happens, the
// action layer — not the webhook — must announce the purchase to BOTH parties.
//
// The distinct-event property is asserted both ways:
//   * settled inline  -> notifyCashSaleSettled fires, the seller-only "Payment
//     started" heads-up does NOT (that would be a second, misleading message);
//   * still pending    -> only the seller "Payment started" fires, and the
//     settlement pair is left for the CASH_SALE_SETTLE webhook, so a single
//     purchase is never announced twice.
//
// `acceptCashSaleTerms` here is the ACTION wrapper in lib/actions; the auth,
// orchestrator and notifier seams are stubbed so the test is about the wrapper's
// own branching.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let authUserId: string | null = 'buyer-1';
let acceptResult: unknown = { ok: false, error: 'INVALID_STATE' };

interface Note {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

const createNotification = vi.fn(async (_input: Note) => true);
const notifyCashSaleSettled = vi.fn(
  async (_p: { buyerId: string; sellerId: string; cashSaleId: string }) => {},
);

vi.mock('@/lib/supabase/cachedAuth', () => ({
  getCachedAuthUser: async () => (authUserId ? { id: authUserId } : null),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({}),
}));

vi.mock('@/domain/services', () => ({
  getPaymentService: () => ({}),
}));

vi.mock('@/domain/orchestrator/supabaseCashSaleRepository', () => ({
  createDefaultCashSaleOrchestrator: () => ({
    acceptTerms: async () => acceptResult,
  }),
}));

vi.mock('@/lib/notifications/createNotification', () => ({
  createNotification: (input: Note) => createNotification(input),
}));

vi.mock('@/lib/notifications/settlementNotifier', () => ({
  notifyCashSaleSettled: (p: { buyerId: string; sellerId: string; cashSaleId: string }) =>
    notifyCashSaleSettled(p),
}));

vi.mock('@/lib/email', () => ({
  emailNotify: {},
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

const { acceptCashSaleTerms } = await import('@/lib/actions/cashSale');

const SALE = {
  id: 'sale-1',
  buyerId: 'buyer-1',
  sellerId: 'seller-1',
};

beforeEach(() => {
  authUserId = 'buyer-1';
  createNotification.mockClear();
  notifyCashSaleSettled.mockClear();
});

describe('acceptCashSaleTerms — settlement notifications', () => {
  it('notifies both parties (and not the seller heads-up) when THIS call settled inline to ESCROW_HELD', async () => {
    // `settledNow` is the signal the orchestrator sets ONLY on the call that drove
    // the PAYMENT_PENDING -> settled transition. The action keys off it, not the
    // status, so this is the genuine "I settled it" case.
    acceptResult = { ok: true, sale: { ...SALE, status: 'ESCROW_HELD' }, settledNow: true };

    const result = await acceptCashSaleTerms('sale-1', 1);

    expect(result.ok).toBe(true);
    expect(notifyCashSaleSettled).toHaveBeenCalledTimes(1);
    expect(notifyCashSaleSettled).toHaveBeenCalledWith({
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      cashSaleId: 'sale-1',
    });
    // The "Payment started" seller heads-up must not also fire.
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('treats an inline HANDOVER settlement (in-person) the same way', async () => {
    acceptResult = { ok: true, sale: { ...SALE, status: 'HANDOVER' }, settledNow: true };

    await acceptCashSaleTerms('sale-1', 1);

    expect(notifyCashSaleSettled).toHaveBeenCalledTimes(1);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('does NOT re-notify on the claim-race fallback: a reloaded already-settled sale with no settledNow', async () => {
    // The concurrent-double-submit / retry path: claimPayment lost the race, so the
    // orchestrator reloaded a sale that is ALREADY ESCROW_HELD and returned it
    // WITHOUT `settledNow`. The status alone looks identical to a fresh settle, so
    // this asserts the action gates on `settledNow` (the "did I drive it" signal)
    // rather than the status — otherwise a single purchase double-notifies.
    acceptResult = { ok: true, sale: { ...SALE, status: 'ESCROW_HELD' } };

    const result = await acceptCashSaleTerms('sale-1', 1);

    expect(result.ok).toBe(true);
    // Neither the settlement pair nor the seller heads-up: the call that actually
    // settled already announced the purchase.
    expect(notifyCashSaleSettled).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('does NOT re-notify on a claim-race fallback that reloaded a HANDOVER sale either', async () => {
    acceptResult = { ok: true, sale: { ...SALE, status: 'HANDOVER' } };

    await acceptCashSaleTerms('sale-1', 1);

    expect(notifyCashSaleSettled).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('sends only the seller "Payment started" heads-up when still PAYMENT_PENDING', async () => {
    acceptResult = { ok: true, sale: { ...SALE, status: 'PAYMENT_PENDING' } };

    await acceptCashSaleTerms('sale-1', 1);

    // Settlement pair is deferred to the webhook; only the seller heads-up here.
    expect(notifyCashSaleSettled).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledTimes(1);
    const [note] = createNotification.mock.calls[0];
    expect(note.userId).toBe('seller-1');
    expect(note.type).toBe('SALE');
    expect(note.title).toBe('Payment started');
  });
});
