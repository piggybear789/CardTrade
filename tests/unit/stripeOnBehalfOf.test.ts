// tests/unit/stripeOnBehalfOf.test.ts
//
// The Stripe binding for sales charged on behalf of a cross-border seller
// (`domain/payments/onBehalfOf.ts`): the collection carries `on_behalf_of` and is
// refused off-session, and the payout of a charge that settled in the contract's own
// currency is a plain transfer in that currency, with no FX quote. A payout whose
// source was converted keeps the quoted path.

import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

import { StripeService } from '@/domain/services/stripe/StripeService';
import type { StripeConfig } from '@/domain/services/stripe/config';

function service(stripe: unknown) {
  const config = {
    secretKey: 'sk_test_x',
    publishableKey: 'pk_test_x',
    currency: 'usd',
    country: 'us',
    payoutMode: 'platform',
    identityFingerprintSecret: 'secret',
  } as unknown as StripeConfig;
  return new StripeService({ client: stripe as Stripe, config } as unknown as ConstructorParameters<
    typeof StripeService
  >[0]);
}

function stubStripe(settledIn: string) {
  const create = vi.fn(async () => ({
    id: 'pi_1',
    status: 'succeeded',
    amount: 10_000,
    amount_received: 10_000,
    latest_charge: 'ch_1',
  }));
  const transfers = vi.fn(async () => ({ id: 'tr_1' }));
  const rawRequest = vi.fn(async () => ({ id: 'fxq_1', rates: { usd: { exchange_rate: 0.9 } } }));
  return {
    create,
    transfers,
    rawRequest,
    stripe: {
      customers: {
        retrieve: vi.fn(async () => ({
          id: 'cus_1',
          deleted: false,
          invoice_settings: { default_payment_method: 'pm_1' },
        })),
      },
      paymentMethods: { list: vi.fn(async () => ({ data: [{ id: 'pm_1' }] })) },
      paymentIntents: {
        create,
        retrieve: vi.fn(async () => ({
          id: 'pi_1',
          status: 'succeeded',
          latest_charge: { id: 'ch_1', balance_transaction: { currency: settledIn, amount: 10_000 } },
        })),
      },
      charges: {
        retrieve: vi.fn(async () => ({
          id: 'ch_1',
          balance_transaction: { currency: settledIn, amount: 10_000 },
        })),
      },
      transfers: { create: transfers },
      rawRequest,
    },
  };
}

describe('collection on behalf of a seller', () => {
  it('sets on_behalf_of and records the settlement in the contract currency', async () => {
    const { stripe, create } = stubStripe('eur');
    const result = await service(stripe).requestTransfer({
      payerId: 'cus_1',
      amount: 10_000,
      currency: 'eur',
      ref: 'cash-sale:1',
      nonce: 'n1',
      presence: { kind: 'BUYER_PRESENT', threeDS: 'automatic' },
      onBehalfOf: 'acct_seller',
    });
    const body = (create.mock.calls as unknown[][])[0]![0] as Record<string, unknown>;
    expect(body.on_behalf_of).toBe('acct_seller');
    expect(body.currency).toBe('eur');
    expect(body).not.toHaveProperty('transfer_data');
    expect(result).toMatchObject({ status: 'SETTLED', settlement: { amount: 10_000, currency: 'eur' } });
  });

  it('is refused off-session before any provider call', async () => {
    const { stripe, create } = stubStripe('eur');
    const result = await service(stripe).requestTransfer({
      payerId: 'cus_1',
      amount: 10_000,
      currency: 'eur',
      ref: 'cash-sale:1',
      nonce: 'n1',
      onBehalfOf: 'acct_seller',
    });
    expect(result.status).toBe('FAILED');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('payout of a sale', () => {
  it('transfers in the contract currency when the source charge settled in it', async () => {
    const { stripe, transfers, rawRequest } = stubStripe('eur');
    const result = await service(stripe).payoutToMerchant({
      merchantRef: 'acct_seller',
      amount: 10_000,
      currency: 'eur',
      ref: 'cash-sale-payout:1',
      nonce: 'payout:1',
      sourcePaymentRef: 'pi_1',
    });
    expect(result.status).toBe('SETTLED');
    expect(rawRequest).not.toHaveBeenCalled();
    const body = (transfers.mock.calls as unknown[][])[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({ amount: 10_000, currency: 'eur', source_transaction: 'ch_1' });
    expect(result).not.toHaveProperty('settlement');
  });

  it('keeps the quoted path when the source charge was converted', async () => {
    const { stripe, transfers, rawRequest } = stubStripe('usd');
    const result = await service(stripe).payoutToMerchant({
      merchantRef: 'acct_seller',
      amount: 9_000,
      currency: 'eur',
      ref: 'cash-sale-payout:1',
      nonce: 'payout:1',
      sourcePaymentRef: 'pi_1',
    });
    expect(result.status).toBe('SETTLED');
    expect(rawRequest).toHaveBeenCalled();
    const body = (transfers.mock.calls as unknown[][])[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({ currency: 'usd', amount: 10_000, fx_quote: 'fxq_1' });
  });
});
