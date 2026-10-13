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

// Set explicitly: there is no default mock secret any more (ESC-16).
const SECRET = 'test-mock-webhook-secret';
process.env.WEBHOOK_SECRET = SECRET;

let admin: FakeAdmin;

// The settlement result the cash-sale orchestrator returns for this delivery.
let settleResult: unknown = { ok: false, error: 'INVALID_STATE' };
// The applyEvent result the trade orchestrator returns for this delivery.
let applyEventResult: unknown = { ok: false, error: 'INVALID_TRANSITION' };

const notifyCashSaleSettled = vi.fn(async (_p: { buyerId: string; sellerId: string; cashSaleId: string }) => {});
const notifyTradeCollateralLocked = vi.fn(
  async (_p: { initiatorId: string; counterpartId: string; tradeId: string }) => {},
);

// The per-hold reconcile result for this delivery (ESC-08).
let reconcileResult: unknown = { kind: 'NO_OP', reason: 'UNKNOWN_HOLD' };
const reconcileTradeHoldStatus = vi.fn(async (_p: Record<string, unknown>) => reconcileResult);
vi.mock('@/lib/trades/collateralLock', () => ({
  reconcileTradeHoldStatus: (p: Record<string, unknown>) => reconcileTradeHoldStatus(p),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin.client,
}));

vi.mock('@/domain/services', () => ({
  acceptsMockWebhooks: () => true,
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

/** A hold.active event for one trader's hold (-> HOLD_STATUS, ESC-08). */
function holdActiveEnvelope(eventId: string): string {
  return JSON.stringify({
    eventId,
    type: 'hold.active',
    payload: { tradeId: 'trade-9', holdId: 'pi_9' },
  });
}

beforeEach(() => {
  notifyCashSaleSettled.mockClear();
  notifyTradeCollateralLocked.mockClear();
  reconcileTradeHoldStatus.mockClear();
  reconcileResult = { kind: 'NO_OP', reason: 'UNKNOWN_HOLD' };
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

describe('hold.active — routed to the one lock rule (ESC-08)', () => {
  // The pipeline no longer dispatches HOLDS_CONFIRMED or notifies itself. It hands
  // the ONE hold to `reconcileTradeHoldStatus`, whose `confirmCollateralIfComplete`
  // sends the notification exactly once (tests/unit/collateralLockNotification.test.ts).
  it('reconciles the named hold and never notifies from the pipeline itself', async () => {
    admin = createFakeAdmin({
      selects: { trades: [{ data: { initiator_id: 'trader-a' } }] },
      defaults: { webhook_logs: { data: null } },
    });
    reconcileResult = { kind: 'RECORDED', status: 'ACTIVE', confirm: { kind: 'LOCKED' } };

    const response = await deliver(holdActiveEnvelope('evt_hold_1'));

    expect(response.status).toBe(200);
    expect(reconcileTradeHoldStatus).toHaveBeenCalledTimes(1);
    expect(reconcileTradeHoldStatus.mock.calls[0][0]).toMatchObject({
      tradeId: 'trade-9',
      holdId: 'pi_9',
      status: 'ACTIVE',
      actorId: 'trader-a',
    });
    expect(notifyTradeCollateralLocked).not.toHaveBeenCalled();
  });

  it('acks a stale hold id as a NO_OP rather than locking', async () => {
    admin = createFakeAdmin({
      selects: { trades: [{ data: { initiator_id: 'trader-a' } }] },
      defaults: { webhook_logs: { data: null } },
    });
    reconcileResult = { kind: 'NO_OP', reason: 'STALE_HOLD' };

    const response = await deliver(holdActiveEnvelope('evt_hold_2'));

    expect(response.status).toBe(200);
    expect(notifyTradeCollateralLocked).not.toHaveBeenCalled();
  });

  it('a status-only hold event (no hold id) is never applied', async () => {
    const response = await deliver(
      JSON.stringify({ eventId: 'evt_hold_3', type: 'hold.active', payload: { tradeId: 'trade-9' } }),
    );
    expect(response.status).toBe(200);
    expect(reconcileTradeHoldStatus).not.toHaveBeenCalled();
  });
});
