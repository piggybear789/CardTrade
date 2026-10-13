// tests/unit/ship24RouteReturnDelivery.test.ts
//
// ESC-11: a carrier "delivered" for a RETURN only opens the seller's inspection
// window. The webhook must not refund, close the sale, or reach the payment binding.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcCalls: Array<{ name: string; args: unknown }> = [];
const paymentServiceCalls: unknown[] = [];

/** A chainable query stub: resolves the RETURN-leg lookup to one sale, all else empty. */
function query(table: string) {
  const filters: Record<string, unknown> = {};
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    in: () => builder,
    is: () => builder,
    update: () => builder,
    limit: async () => ({
      data: table === 'cash_sales' && 'return_tracking_number' in filters ? [{ id: 'sale-r1' }] : [],
      error: null,
    }),
  };
  return builder;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => query(table),
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: [], error: null };
    },
  }),
}));
vi.mock('@/lib/errors/errorLog', () => ({ logBackgroundFailure: async () => undefined }));
vi.mock('@/domain/services', () => ({
  getPaymentService: (...args: unknown[]) => {
    paymentServiceCalls.push(args);
    throw new Error('the Ship24 route must not reach the payment binding');
  },
}));

describe('Ship24 webhook, return leg (ESC-11)', () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    paymentServiceCalls.length = 0;
    process.env.SHIP24_WEBHOOK_SECRET = 'test-secret';
  });

  it('applies the return delivery and moves no money', async () => {
    const { POST } = await import('@/app/api/webhooks/ship24/route');
    const response = await POST(
      new Request('https://example.test/api/webhooks/ship24', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-token': 'test-secret' },
        body: JSON.stringify({
          trackings: [
            {
              tracker: { trackerId: 't1', trackingNumber: 'RET777' },
              shipment: { trackingNumber: 'RET777', statusMilestone: 'delivered' },
              events: [{ occurrenceDatetime: '2026-10-13T01:00:00Z', statusMilestone: 'delivered' }],
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(rpcCalls.map((call) => call.name)).toEqual(['apply_cash_sale_return_tracking']);
    expect(paymentServiceCalls).toHaveLength(0);
  });
});
