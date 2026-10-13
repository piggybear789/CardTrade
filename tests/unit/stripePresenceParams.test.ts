// tests/unit/stripePresenceParams.test.ts
//
// ESC-03 seam: a BUYER_PRESENT collection is on-session (no `off_session`, the
// requested 3-D Secure level set), a challenge comes back as REQUIRES_ACTION with the
// client secret, and the read-back / cancel mappings match design §1.9.

import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

import { StripeService, collectionStatusOf } from '@/domain/services/stripe/StripeService';
import type { StripeConfig } from '@/domain/services/stripe/config';

function service(stripe: unknown) {
  const config = {
    secretKey: 'sk_test_x',
    publishableKey: 'pk_test_x',
    currency: 'aud',
    accountCountry: 'au',
    payoutMode: 'platform',
    identityFingerprintSecret: 'secret',
  } as unknown as StripeConfig;
  return new StripeService({ client: stripe as Stripe, config } as unknown as ConstructorParameters<
    typeof StripeService
  >[0]);
}

function stubStripe(intent: Partial<Stripe.PaymentIntent>) {
  const create = vi.fn(async () => ({ id: 'pi_1', amount: 1000, amount_received: 0, ...intent }));
  return {
    create,
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
        retrieve: vi.fn(async () => ({ id: 'pi_1', status: 'succeeded', amount_received: 1000 })),
        cancel: vi.fn(async () => {
          throw Object.assign(new Error('unexpected state'), { code: 'payment_intent_unexpected_state' });
        }),
      },
    },
  };
}

describe('requestTransfer presence (ESC-03)', () => {
  it('BUYER_PRESENT omits off_session and sets request_three_d_secure', async () => {
    const { stripe, create } = stubStripe({ status: 'succeeded', amount_received: 1000 });
    const result = await service(stripe).requestTransfer({
      payerId: 'cus_1',
      amount: 1000,
      ref: 'cash-sale:1',
      nonce: 'n1',
      presence: { kind: 'BUYER_PRESENT', threeDS: 'any' },
    });
    expect(result.status).toBe('SETTLED');
    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('off_session');
    expect(body.payment_method_options).toEqual({ card: { request_three_d_secure: 'any' } });
  });

  it('without presence stays off-session', async () => {
    const { stripe, create } = stubStripe({ status: 'succeeded', amount_received: 1000 });
    await service(stripe).requestTransfer({ payerId: 'cus_1', amount: 1000, ref: 'r', nonce: 'n' });
    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.off_session).toBe(true);
    expect(body).not.toHaveProperty('payment_method_options');
  });

  it('requires_action comes back as REQUIRES_ACTION with the secret', async () => {
    const { stripe } = stubStripe({ status: 'requires_action', client_secret: 'pi_1_secret' });
    const result = await service(stripe).requestTransfer({
      payerId: 'cus_1',
      amount: 1000,
      ref: 'r',
      nonce: 'n',
      presence: { kind: 'BUYER_PRESENT', threeDS: 'automatic' },
    });
    expect(result).toMatchObject({ status: 'REQUIRES_ACTION', clientSecret: 'pi_1_secret', transferId: 'pi_1' });
  });
});

describe('collectionStatusOf mapping (§1.9)', () => {
  const of = (status: Stripe.PaymentIntent.Status, extra: Partial<Stripe.PaymentIntent> = {}) =>
    collectionStatusOf({ status, amount_received: 0, ...extra } as Stripe.PaymentIntent);

  it('maps each status', () => {
    expect(of('succeeded', { amount_received: 500 })).toEqual({ status: 'SETTLED', amountReceived: 500 });
    expect(of('requires_action', { client_secret: 's' })).toEqual({
      status: 'REQUIRES_ACTION',
      amountReceived: 0,
      clientSecret: 's',
    });
    expect(of('processing').status).toBe('PENDING');
    expect(of('requires_confirmation').status).toBe('PENDING');
    expect(of('canceled').status).toBe('FAILED');
    expect(of('requires_payment_method').status).toBe('FAILED');
  });

  it('never returns a secret for a finished intent', () => {
    expect(of('succeeded', { client_secret: 's' })).not.toHaveProperty('clientSecret');
  });
});

describe('cancelCollection (§1.9)', () => {
  it('a succeeded intent that refuses cancel reads as ALREADY_SETTLED', async () => {
    const { stripe } = stubStripe({});
    expect(await service(stripe).cancelCollection('pi_1')).toEqual({ status: 'ALREADY_SETTLED' });
  });
});
