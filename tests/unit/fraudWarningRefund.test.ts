// tests/unit/fraudWarningRefund.test.ts
//
// ESC-14: an issuer's early fraud warning. Before anything shipped the buyer is
// refunded in full and the item relisted, so the seller loses nothing; after that the
// payout is held for staff. A redelivered warning does nothing.

import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';

import {
  acceptCashSaleTerms,
  recordCashSaleShipment,
  refundOnFraudWarning,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { translateStripeEvent } from '@/domain/services/stripe/webhook';
import { mapEventToAction } from '@/domain/webhook/mapEventToAction';
import { BUYER, ITEM } from './fakes/cashSaleRepository';
import { agreedSale } from './helpers/agreedSale';

async function paidSale() {
  const payments = new InMemoryService();
  const setup = await agreedSale(payments);
  const deferrals: unknown[] = [];
  const deps: CashSaleOrchestratorDeps = {
    ...setup.deps,
    repository: {
      ...setup.deps.repository,
      recordPayoutDeferral: async (p) => {
        deferrals.push(p);
      },
    },
  };
  const paid = await acceptCashSaleTerms(deps, {
    cashSaleId: setup.id,
    actorId: BUYER.profileId,
    termsVersion: setup.termsVersion,
  });
  if (!paid.ok || paid.sale.status !== 'ESCROW_HELD') throw new Error('setup: expected ESCROW_HELD');
  return { deps, payments, id: setup.id, deferrals };
}

describe('refundOnFraudWarning (ESC-14)', () => {
  it('refunds in full before shipment and moves the sale to REFUNDED', async () => {
    const s = await paidSale();
    expect(await refundOnFraudWarning(s.deps, { cashSaleId: s.id })).toBe('REFUNDED');
    const sale = await s.deps.repository.loadCashSale(s.id);
    expect(sale?.status).toBe('REFUNDED');
    expect(s.payments.refunds).toHaveLength(1);
  });

  it('is idempotent: a redelivered warning does nothing', async () => {
    const s = await paidSale();
    await refundOnFraudWarning(s.deps, { cashSaleId: s.id });
    expect(await refundOnFraudWarning(s.deps, { cashSaleId: s.id })).toBe('ALREADY_HANDLED');
    expect(s.payments.refunds).toHaveLength(1);
  });

  it('after shipment it holds the payout instead of refunding', async () => {
    const s = await paidSale();
    await recordCashSaleShipment(s.deps, {
      cashSaleId: s.id,
      actorId: ITEM.ownerId,
      shipment: { carrier: 'Australia Post', trackingNumber: 'AP1' },
    });
    expect(await refundOnFraudWarning(s.deps, { cashSaleId: s.id })).toBe('HELD');
    expect(s.payments.refunds).toHaveLength(0);
    expect(s.deferrals).toEqual([{ cashSaleId: s.id, releaseAt: null, holdReason: 'FRAUD_WARNING' }]);
  });
});

describe('early fraud warning translation', () => {
  it('maps radar.early_fraud_warning.created to FRAUD_WARNING by PaymentIntent', () => {
    const [event] = translateStripeEvent({
      id: 'evt_efw',
      object: 'event',
      type: 'radar.early_fraud_warning.created',
      created: 1_700_000_000,
      data: {
        object: {
          id: 'issfr_1',
          object: 'radar.early_fraud_warning',
          actionable: true,
          charge: 'ch_1',
          fraud_type: 'unauthorized_use_of_card',
          payment_intent: 'pi_1',
        },
      },
    } as unknown as Stripe.Event);
    expect(event?.type).toBe('charge.fraud_warning');
    expect(event?.payload.paymentRef).toBe('pi_1');
    expect(mapEventToAction(event!)).toEqual({ kind: 'FRAUD_WARNING' });
  });
});
