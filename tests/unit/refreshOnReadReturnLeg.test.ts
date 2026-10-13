// tests/unit/refreshOnReadReturnLeg.test.ts
//
// ESC-30: a return's delivery no longer depends on the Ship24 webhook alone. The
// read-back asks the carrier, throttled by `return_tracking_checked_at`, and applies
// the answer through the same RPC the webhook calls.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }));

interface SaleRow {
  id: string;
  status: string;
  return_tracking_carrier: string | null;
  return_tracking_number: string | null;
  return_carrier_delivered_at: string | null;
}

const state: { sale: SaleRow | null; claimWins: boolean; claimUpdates: unknown[] } = {
  sale: null,
  claimWins: true,
  claimUpdates: [],
};
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const fetchCalls: unknown[] = [];

function builder() {
  let updating = false;
  const b = {
    select: () =>
      updating ? Promise.resolve({ data: state.claimWins ? [{ id: 'x' }] : [], error: null }) : b,
    update: (patch: unknown) => {
      updating = true;
      state.claimUpdates.push(patch);
      return b;
    },
    eq: () => b,
    is: () => b,
    or: () => b,
    maybeSingle: async () => ({ data: state.sale, error: null }),
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => builder(),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: [], error: null };
    },
  }),
}));

vi.mock('@/domain/services/tracking', () => ({
  getTrackingService: () => ({
    fetchStatus: async (input: unknown) => {
      fetchCalls.push(input);
      return { status: 'DELIVERED', deliveredAt: '2026-10-13T01:00:00.000Z' };
    },
  }),
}));

describe('checkCashSaleReturnLeg (ESC-30)', () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    fetchCalls.length = 0;
    state.claimUpdates.length = 0;
    state.claimWins = true;
    state.sale = {
      id: 'sale-1',
      status: 'RETURN_IN_TRANSIT',
      return_tracking_carrier: 'auspost',
      return_tracking_number: 'RET1',
      return_carrier_delivered_at: null,
    };
  });

  it('asks the carrier and applies the answer through the return RPC', async () => {
    const { checkCashSaleReturnLeg } = await import('@/lib/tracking/refreshOnRead');
    expect(await checkCashSaleReturnLeg('sale-1')).toBe(true);
    expect(fetchCalls).toEqual([{ carrier: 'auspost', trackingNumber: 'RET1' }]);
    expect(rpcCalls).toEqual([
      {
        name: 'apply_cash_sale_return_tracking',
        args: { p_cash_sale_id: 'sale-1', p_tracking_status: 'DELIVERED', p_delivered_at: '2026-10-13T01:00:00.000Z' },
      },
    ]);
    expect(state.claimUpdates[0]).toHaveProperty('return_tracking_checked_at');
  });

  it('does not ask when another caller holds the throttle', async () => {
    state.claimWins = false;
    const { checkCashSaleReturnLeg } = await import('@/lib/tracking/refreshOnRead');
    expect(await checkCashSaleReturnLeg('sale-1')).toBe(false);
    expect(fetchCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it('skips a return already delivered, or a sale not in a return', async () => {
    const { checkCashSaleReturnLeg } = await import('@/lib/tracking/refreshOnRead');
    state.sale = { ...state.sale!, return_carrier_delivered_at: '2026-10-12T00:00:00Z' };
    expect(await checkCashSaleReturnLeg('sale-1')).toBe(false);
    state.sale = { ...state.sale!, return_carrier_delivered_at: null, status: 'IN_TRANSIT' };
    expect(await checkCashSaleReturnLeg('sale-1')).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });
});
