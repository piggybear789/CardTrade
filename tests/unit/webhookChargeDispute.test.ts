// tests/unit/webhookChargeDispute.test.ts
//
// ESC-14: a chargeback used to be recorded and nothing else — the seller was paid on
// the next hourly drain anyway, and the platform (losses_collector) absorbed both the
// payout and the reversal. An OPEN dispute now holds an UNRELEASED seller payout; a
// WON dispute clears the hold; a payout that already left is left for staff.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_SIGNATURE_HEADER, signWebhookBody } from '@/domain/services/mock/MockService';

const SECRET = 'test-mock-webhook-secret';
process.env.WEBHOOK_SECRET = SECRET;

const updates: Array<{ table: string; payload: unknown; filters: string[] }> = [];

function chain(table: string) {
  const filters: string[] = [];
  let payload: unknown = null;
  let op: 'select' | 'update' | 'upsert' = 'select';
  const builder: Record<string, unknown> = {
    select: () => builder,
    update: (p: unknown) => {
      op = 'update';
      payload = p;
      return builder;
    },
    upsert: async () => ({ error: null }),
    eq: (col: string, val: unknown) => {
      filters.push(`eq:${col}=${val}`);
      return builder;
    },
    neq: (col: string, val: unknown) => {
      filters.push(`neq:${col}=${val}`);
      return builder;
    },
    maybeSingle: async () => ({ data: table === 'charge_disputes' ? { cash_sale_id: 'sale-1' } : null, error: null }),
    then: (resolve: (v: unknown) => void) => {
      if (op === 'update') updates.push({ table, payload, filters });
      resolve({ data: null, error: null });
    },
  };
  return builder;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (t: string) => chain(t), rpc: async () => ({ data: null, error: null }) }),
}));
vi.mock('@/domain/services', () => ({ acceptsMockWebhooks: () => true, getPaymentService: () => ({}) }));
vi.mock('@/lib/regionBinding', () => ({
  regionForCashSale: async () => 'AU',
  regionForMerchantRef: async () => 'AU',
  regionForProfile: async () => 'AU',
  regionForTrade: async () => 'AU',
}));
vi.mock('@/domain/services/stripe', () => ({
  createStripeClient: () => ({}),
  readWebhookSecrets: () => [],
  STRIPE_SIGNATURE_HEADER: 'stripe-signature',
  translateStripeEvent: () => [],
  verifyStripeSignature: () => null,
}));
vi.mock('@/lib/errors/errorLog', () => ({ logBackgroundFailure: vi.fn(async () => undefined) }));

const { handleWebhookDelivery } = await import('@/lib/webhook/webhookPipeline');

function deliver(type: string, payload: Record<string, unknown>, eventId: string) {
  const body = JSON.stringify({ eventId, type, payload });
  const headers = new Headers();
  headers.set(MOCK_SIGNATURE_HEADER, signWebhookBody(body, SECRET));
  return handleWebhookDelivery(body, headers);
}

beforeEach(() => {
  updates.length = 0;
});

const salesUpdates = () => updates.filter((u) => u.table === 'cash_sales');

describe('chargeback payout hold (ESC-14)', () => {
  it('an OPEN dispute holds the unreleased payout', async () => {
    await deliver('charge.disputed', { disputeId: 'dp_1', captureId: 'ch_1', cashSaleId: 'sale-1' }, 'evt_cb_1');
    expect(salesUpdates()).toEqual([
      {
        table: 'cash_sales',
        payload: { seller_payout_hold_reason: 'CHARGE_DISPUTE' },
        filters: ['eq:id=sale-1', 'neq:seller_payout_status=SETTLED'],
      },
    ]);
  });

  it('resolves the sale from the recorded dispute when the event carries none', async () => {
    await deliver('charge.disputed', { disputeId: 'dp_2', captureId: 'ch_2' }, 'evt_cb_2');
    expect(salesUpdates()[0]?.filters).toContain('eq:id=sale-1');
  });

  it('a WON dispute clears only a chargeback hold', async () => {
    await deliver('charge.dispute.closed', { disputeId: 'dp_1', captureId: 'ch_1', cashSaleId: 'sale-1', disputeOutcome: 'won' }, 'evt_cb_3');
    expect(salesUpdates()).toEqual([
      {
        table: 'cash_sales',
        payload: { seller_payout_hold_reason: null },
        filters: ['eq:id=sale-1', 'eq:seller_payout_hold_reason=CHARGE_DISPUTE'],
      },
    ]);
  });

  it('a LOST dispute leaves the hold for staff', async () => {
    await deliver('charge.dispute.closed', { disputeId: 'dp_1', captureId: 'ch_1', cashSaleId: 'sale-1', disputeOutcome: 'lost' }, 'evt_cb_4');
    expect(salesUpdates()).toEqual([]);
  });
});
