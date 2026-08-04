// tests/unit/stripeWebhook.test.ts
//
// Covers the two pure pieces of the real Stripe webhook path (Req 10.1, 10.4,
// 10.5): signature verification (authenticity + replay window) and translation
// of Stripe's envelope into internal WebhookEvents.
//
// The translation cases pin down the behaviour that matters most in the move off
// Pinch: one provider event (`payment_intent.succeeded`) carries several
// different CardTrade meanings, and only the stamped metadata distinguishes
// them. Anything unroutable must translate to nothing rather than throw.

import { createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { metadataFor } from '@/domain/services/stripe/metadata';
import {
  translateStripeEvent,
  verifyStripeSignature,
} from '@/domain/services/stripe/webhook';

const SECRET = 'whsec_test_secret';
const client = new Stripe('sk_test_dummy');

/** Build a valid `stripe-signature` header for a body at a given timestamp. */
function sign(rawBody: string, timestampSeconds: number, secret = SECRET): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`, 'utf8')
    .digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}

/** A Stripe event envelope wrapping `object`. */
function event(type: string, object: unknown, id = 'evt_1'): Stripe.Event {
  return {
    id,
    object: 'event',
    api_version: null,
    created: 1_800_000_000,
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

/** A PaymentIntent carrying CardTrade metadata. */
function intent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pi_1',
    object: 'payment_intent',
    amount: 50_000,
    amount_capturable: 0,
    amount_received: 0,
    currency: 'aud',
    status: 'succeeded',
    latest_charge: 'ch_1',
    metadata: metadataFor('HOLD', 'hold:trade-1:trader-1'),
    ...overrides,
  };
}

describe('verifyStripeSignature', () => {
  const rawBody = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });
  const nowSeconds = Math.floor(Date.now() / 1000);

  it('accepts a correctly signed, fresh delivery and returns the parsed event', () => {
    const verified = verifyStripeSignature({
      client,
      rawBody,
      header: sign(rawBody, nowSeconds),
      secret: SECRET,
    });

    expect(verified?.id).toBe('evt_1');
  });

  it('rejects a tampered body', () => {
    expect(
      verifyStripeSignature({
        client,
        rawBody: `${rawBody} `,
        header: sign(rawBody, nowSeconds),
        secret: SECRET,
      }),
    ).toBeNull();
  });

  it('rejects the wrong secret, a missing header, and a malformed header', () => {
    expect(
      verifyStripeSignature({
        client,
        rawBody,
        header: sign(rawBody, nowSeconds, 'whsec_other'),
        secret: SECRET,
      }),
    ).toBeNull();
    expect(verifyStripeSignature({ client, rawBody, header: '', secret: SECRET })).toBeNull();
    expect(
      verifyStripeSignature({ client, rawBody, header: 'not-a-signature', secret: SECRET }),
    ).toBeNull();
  });

  it('rejects a replayed delivery outside the tolerance window', () => {
    const stale = nowSeconds - 600;
    expect(
      verifyStripeSignature({
        client,
        rawBody,
        header: sign(rawBody, stale),
        secret: SECRET,
        toleranceSeconds: 300,
      }),
    ).toBeNull();
  });
});

describe('translateStripeEvent — collateral holds', () => {
  it('maps amount_capturable_updated to hold.active with the trade id', () => {
    const [translated] = translateStripeEvent(
      event(
        'payment_intent.amount_capturable_updated',
        intent({ status: 'requires_capture', amount_capturable: 50_000 }),
      ),
    );

    expect(translated.type).toBe('hold.active');
    expect(translated.payload.holdId).toBe('pi_1');
    expect(translated.payload.tradeId).toBe('trade-1');
    expect(translated.payload.amount).toBe(50_000);
    expect(translated.eventId).toBe('evt_1');
  });

  it('maps a cancelled intent to hold.voided', () => {
    const [translated] = translateStripeEvent(
      event(
        'payment_intent.canceled',
        intent({ status: 'canceled', cancellation_reason: 'abandoned' }),
      ),
    );

    expect(translated.type).toBe('hold.voided');
    expect(translated.payload.reason).toBe('abandoned');
  });

  it('distinguishes a Friction_Tax partial capture from a full fraud capture', () => {
    // Captured 20 AUD of a 500 AUD authorisation: Stripe released the rest.
    const [partial] = translateStripeEvent(
      event('payment_intent.succeeded', intent({ amount: 50_000, amount_received: 2_000 })),
    );
    expect(partial.type).toBe('capture.partial.settled');
    expect(partial.payload.amount).toBe(2_000);

    const [full] = translateStripeEvent(
      event('payment_intent.succeeded', intent({ amount: 50_000, amount_received: 50_000 })),
    );
    expect(full.type).toBe('capture.full.settled');
  });

  it('routes a failure by kind: HOLD becomes hold.failed, TRANSFER becomes transfer.failed', () => {
    const [heldFailure] = translateStripeEvent(
      event(
        'payment_intent.payment_failed',
        intent({
          status: 'requires_payment_method',
          last_payment_error: { message: 'Your card was declined.' },
        }),
      ),
    );
    expect(heldFailure.type).toBe('hold.failed');
    expect(heldFailure.payload.reason).toBe('Your card was declined.');

    const [transferFailure] = translateStripeEvent(
      event(
        'payment_intent.payment_failed',
        intent({
          metadata: metadataFor('TRANSFER', 'cash-sale:sale-9'),
          last_payment_error: { code: 'insufficient_funds' },
        }),
      ),
    );
    expect(transferFailure.type).toBe('transfer.failed');
    expect(transferFailure.payload.cashSaleId).toBe('sale-9');
  });
});

describe('translateStripeEvent — cash sales and onboarding', () => {
  it('maps a settled TRANSFER intent to transfer.settled against the sale', () => {
    const [translated] = translateStripeEvent(
      event(
        'payment_intent.succeeded',
        intent({
          metadata: metadataFor('TRANSFER', 'cash-sale:sale-9'),
          amount_received: 12_500,
        }),
      ),
    );

    expect(translated.type).toBe('transfer.settled');
    expect(translated.payload.cashSaleId).toBe('sale-9');
    expect(translated.payload.amount).toBe(12_500);
  });

  it('treats payouts_enabled as the settlement gate on account.updated', () => {
    const [approved] = translateStripeEvent(
      event('account.updated', {
        id: 'acct_1',
        object: 'account',
        charges_enabled: true,
        payouts_enabled: true,
        metadata: { cardtrade_profile_id: 'profile-3' },
      }),
    );
    expect(approved.type).toBe('merchant.compliance.updated');
    expect(approved.payload.merchantRef).toBe('acct_1');
    expect(approved.payload.profileId).toBe('profile-3');
    expect(approved.payload.settlementsEnabled).toBe(true);

    // Able to transact but not yet to receive: must NOT read as approved, since
    // only payouts_enabled means money can actually arrive.
    const [pending] = translateStripeEvent(
      event('account.updated', {
        id: 'acct_2',
        object: 'account',
        charges_enabled: true,
        payouts_enabled: false,
        metadata: {},
      }),
    );
    expect(pending.payload.settlementsEnabled).toBe(false);
    expect(pending.payload.merchantActive).toBe(false);
  });
});

describe('translateStripeEvent — unroutable deliveries', () => {
  it('returns nothing for an intent with no CardTrade metadata', () => {
    expect(translateStripeEvent(event('payment_intent.succeeded', intent({ metadata: {} })))).toEqual(
      [],
    );
  });

  it('returns nothing for foreign metadata, rather than throwing', () => {
    expect(
      translateStripeEvent(
        event('payment_intent.succeeded', intent({ metadata: { some_other_system: 'x' } })),
      ),
    ).toEqual([]);
  });

  it('returns nothing for an event type we do not map', () => {
    expect(translateStripeEvent(event('customer.created', { id: 'cus_1' }))).toEqual([]);
  });

  it('ignores a hold-only event that arrives with TRANSFER metadata', () => {
    expect(
      translateStripeEvent(
        event(
          'payment_intent.amount_capturable_updated',
          intent({ metadata: metadataFor('TRANSFER', 'cash-sale:sale-9') }),
        ),
      ),
    ).toEqual([]);
  });
});

describe('translateStripeEvent — dispute refunds', () => {
  /** A Stripe Refund carrying CardTrade metadata for a cash sale. */
  function refund(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 're_1',
      object: 'refund',
      amount: 4_000,
      status: 'failed',
      failure_reason: 'expired_or_canceled_card',
      metadata: metadataFor('REFUND', 'cash-sale-refund:sale-1'),
      ...overrides,
    };
  }

  // `refundPayment` reports a `pending` refund as SETTLED, so this event is the only
  // signal that one later failed. Without it a sale sits at REFUNDED while the money
  // is still on the platform.
  it('translates a failed refund and attributes it to the cash sale', () => {
    const [translated, ...rest] = translateStripeEvent(
      event('charge.refund.updated', refund()),
    );

    expect(rest).toHaveLength(0);
    expect(translated.type).toBe('refund.failed');
    expect(translated.payload.cashSaleId).toBe('sale-1');
    expect(translated.payload.amount).toBe(4_000);
    expect(translated.payload.reason).toBe('expired_or_canceled_card');
  });

  it('ignores a refund update that is not a failure', () => {
    for (const status of ['pending', 'succeeded', 'requires_action']) {
      expect(
        translateStripeEvent(event('charge.refund.updated', refund({ status }))),
      ).toEqual([]);
    }
  });

  it('still translates a failure with no metadata, leaving it unroutable', () => {
    // Attribution is impossible, so the mapper must no-op rather than guess. The
    // translation still happens so the delivery is logged rather than dropped.
    const [translated] = translateStripeEvent(
      event('charge.refund.updated', refund({ metadata: {} })),
    );

    expect(translated.type).toBe('refund.failed');
    expect(translated.payload.cashSaleId).toBeUndefined();
  });

  it('derives the cash sale from refund and payout refs, not just the bare prefix', () => {
    // `parseRef` previously understood only `cash-sale:`, so `cash-sale-refund:` and
    // `cash-sale-payout:` yielded no cashSaleId — which would have made every failed
    // refund unroutable.
    expect(metadataFor('REFUND', 'cash-sale-refund:sale-9').cardtrade_cash_sale_id).toBe(
      'sale-9',
    );
    expect(metadataFor('TRANSFER', 'cash-sale-payout:sale-9').cardtrade_cash_sale_id).toBe(
      'sale-9',
    );
  });
});
