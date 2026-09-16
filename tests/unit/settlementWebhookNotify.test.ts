// tests/unit/settlementWebhookNotify.test.ts
//
// The ASYNC settlement path (FEAT-002): a purchase whose payment clears via the
// CASH_SALE_SETTLE webhook must notify both parties exactly once, and a trade
// whose collateral locks via the hold.active webhook must notify both traders.
//
// The key anti-double-notify property is asserted here too: when the sale was
// ALREADY settled synchronously (submitClaimedPayment drove settleCashSale
// inline), the webhook's settleCashSale returns INVALID_STATE, and this path must
// NOT re-notify — the action layer already announced that purchase.
//
// Mirrors tests/unit/webhookAuthentication.test.ts: the pipeline runs for real,
// with a valid mock signature; only the orchestrators and the notifier are
// stubbed, keeping the test about the pipeline's own branching.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MOCK_SIGNATURE_HEADER,
  signWebhookBody,
} from '@/domain/services/mock/MockService';
import { createFakeAdmin, type FakeAdmin } from './fakes/supabaseChain';

const SECRET = 'dev-mock-webhook-secret';

let admin: FakeAdmin;

// The settlement result the cash-sale orchestrator returns for this delivery.
let settleResult: unknown = { ok: false, error: 'INVALID_STATE' };
// The applyEvent result the trade orchestrator returns for this delivery.
let applyEventResult: unknown = { ok: false, error: 'INVALID_TRANSITION' };

const notifyCashSaleSettled = vi.fn(async (_p: { buyerId: string; sellerId: string; cashSaleId: string }) => {});
const notifyTradeCollateralLocked = vi.fn(
  async (_p: { initiatorId: string; counterpartId: string; tradeId: string }) => {},
);

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin.client,
}));

vi.mock('@/domain/services', () => ({
  isLivePaymentsProvider: () => false,
  getPaymentService: () => ({}),
}));

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

vi.mock('@/domain/orchestrator/supabaseTradeRepository', () => ({
  createDefaultTradeOrchestrator: () => ({ applyEvent: async () => applyEventResult }),
}));
vi.mock('@/domain/orchestrator/supabaseTradeProposalRepository', () => ({
  createSupabaseCollateralSideEffects: () => ({}),
}));
vi.mock('@/domain/orchestrator/supabaseCashSaleRepository', () => ({
  createDefaultCashSaleOrchestrator: () => ({
    settleCashSale: async () => settleResult,
    failCashSale: async () => settleResult,
  }),
}));
vi.mock('@/domain/orchestrator/supabaseMerchantRepository', () => ({
  createDefaultMerchantOnboardingOrchestrator: () => ({}),
}));

vi.mock('@/lib/notifications/settlementNotifier', () => ({
  notifyCashSaleSettled: (p: { buyerId: string; sellerId: string; cashSaleId: string }) =>
    notifyCashSaleSettled(p),
  notifyTradeCollateralLocked: (p: { initiatorId: string; counterpartId: string; tradeId: string }) =>
    notifyTradeCollateralLocked(p),
}));

const { handleWebhookDelivery } = await import('@/lib/webhook/webhookPipeline');

function headers(signature: string): Headers {
  const h = new Headers();
  h.set(MOCK_SIGNATURE_HEADER, signature);
  return h;
}

async function deliver(body: string): Promise<Response> {
  return handleWebhookDelivery(body, headers(signWebhookBody(body, SECRET)));
}

/** A transfer.settled event that references a cash sale (-> CASH_SALE_SETTLE). */
function cashSettleEnvelope(eventId: string): string {
  return JSON.stringify({
    eventId,
    type: 'transfer.settled',
    payload: { cashSaleId: 'sale-9' },
  });
}

/** A hold.active event for a trade (-> TRADE_EVENT HOLDS_CONFIRMED). */
function holdActiveEnvelope(eventId: string): string {
  return JSON.stringify({
    eventId,
    type: 'hold.active',
    payload: { tradeId: 'trade-9' },
  });
}

beforeEach(() => {
  notifyCashSaleSettled.mockClear();
  notifyTradeCollateralLocked.mockClear();
  settleResult = { ok: false, error: 'INVALID_STATE' };
  applyEventResult = { ok: false, error: 'INVALID_TRANSITION' };
  admin = createFakeAdmin({ defaults: { webhook_logs: { data: null } } });
});

describe('CASH_SALE_SETTLE — settlement notifications', () => {
  it('notifies both parties once when the webhook drives the settlement', async () => {
    settleResult = {
      ok: true,
      sale: { id: 'sale-9', buyerId: 'buyer-9', sellerId: 'seller-9' },
    };

    const response = await deliver(cashSettleEnvelope('evt_settle_1'));

    expect(response.status).toBe(200);
    expect(notifyCashSaleSettled).toHaveBeenCalledTimes(1);
    expect(notifyCashSaleSettled).toHaveBeenCalledWith({
      buyerId: 'buyer-9',
      sellerId: 'seller-9',
      cashSaleId: 'sale-9',
    });
  });

  it('does NOT notify when the sale was already settled synchronously (INVALID_STATE)', async () => {
    settleResult = { ok: false, error: 'INVALID_STATE' };

    const response = await deliver(cashSettleEnvelope('evt_settle_2'));

    // The webhook records FAILURE (nothing transitioned), but the crucial property
    // is that it did not re-announce a purchase the synchronous path already did.
    expect(response.status).toBe(500);
    expect(notifyCashSaleSettled).not.toHaveBeenCalled();
  });

  it('does not re-notify a re-delivered (deduped) webhook', async () => {
    admin = createFakeAdmin({
      selects: { webhook_logs: [{ data: { event_id: 'evt_settle_3', outcome: 'SUCCESS' } }] },
      defaults: { webhook_logs: { data: null } },
    });
    settleResult = {
      ok: true,
      sale: { id: 'sale-9', buyerId: 'buyer-9', sellerId: 'seller-9' },
    };

    const response = await deliver(cashSettleEnvelope('evt_settle_3'));

    expect(response.status).toBe(200);
    // The alreadyProcessed guard short-circuits before dispatch, so no notify.
    expect(notifyCashSaleSettled).not.toHaveBeenCalled();
  });
});

describe('hold.active — trade collateral locked notifications', () => {
  it('notifies both traders when the event moves the trade into COLLATERAL_LOCKED', async () => {
    // trades.select('initiator_id') resolves the actor; then applyEvent returns the
    // locked trade with both party ids.
    admin = createFakeAdmin({
      selects: { trades: [{ data: { initiator_id: 'trader-a' } }] },
      defaults: { webhook_logs: { data: null } },
    });
    applyEventResult = {
      ok: true,
      trade: {
        id: 'trade-9',
        state: 'COLLATERAL_LOCKED',
        initiator_id: 'trader-a',
        counterpart_id: 'trader-b',
      },
    };

    const response = await deliver(holdActiveEnvelope('evt_hold_1'));

    expect(response.status).toBe(200);
    expect(notifyTradeCollateralLocked).toHaveBeenCalledTimes(1);
    expect(notifyTradeCollateralLocked).toHaveBeenCalledWith({
      initiatorId: 'trader-a',
      counterpartId: 'trader-b',
      tradeId: 'trade-9',
    });
  });

  it('does not notify when the trade did not enter COLLATERAL_LOCKED', async () => {
    admin = createFakeAdmin({
      selects: { trades: [{ data: { initiator_id: 'trader-a' } }] },
      defaults: { webhook_logs: { data: null } },
    });
    applyEventResult = { ok: false, error: 'INVALID_TRANSITION' };

    const response = await deliver(holdActiveEnvelope('evt_hold_2'));

    expect(response.status).toBe(500);
    expect(notifyTradeCollateralLocked).not.toHaveBeenCalled();
  });
});
