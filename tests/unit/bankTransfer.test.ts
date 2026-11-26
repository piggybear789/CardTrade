// The BANK_TRANSFER rail (0178): who is offered it, what it costs, and that the
// abandoned-payment sweep gives it days rather than 30 minutes.
import { describe, expect, it } from 'vitest';

import {
  BANK_TRANSFER_WAIT_HOURS,
  isBankMethod,
  isPushMethod,
  paymentMethodsFor,
} from '@/domain/payments/paymentMethods';
import { cashSaleFeeMinor, stripeCostMinor } from '@/domain/fees/processingFee';
import { bankTransferInstructionsOf, collectionStatusOf } from '@/domain/services/stripe/StripeService';
import type Stripe from 'stripe';

describe('BANK_TRANSFER rail', () => {
  it('is offered to a US buyer on a USD sale, and nowhere else', () => {
    expect(paymentMethodsFor({ currency: 'usd', buyerRegion: 'US' })).toContain('BANK_TRANSFER');
    expect(paymentMethodsFor({ currency: 'usd', buyerRegion: 'GB' })).not.toContain('BANK_TRANSFER');
    expect(paymentMethodsFor({ currency: 'eur', buyerRegion: 'US' })).not.toContain('BANK_TRANSFER');
    expect(paymentMethodsFor({ currency: 'aud', buyerRegion: 'AU' })).not.toContain('BANK_TRANSFER');
  });

  it('is a bank method the buyer sends themselves', () => {
    expect(isBankMethod('BANK_TRANSFER')).toBe(true);
    expect(isPushMethod('BANK_TRANSFER')).toBe(true);
    expect(isPushMethod('PAYTO')).toBe(false);
    expect(isPushMethod('CARD')).toBe(false);
  });

  it('costs the buyer less than card, and is in profit once the sale passes break-even', () => {
    for (const price of [2000, 4000, 15_000, 100_000]) {
      expect(cashSaleFeeMinor(price, 0, 'usd', 'BANK_TRANSFER')).toBeLessThan(cashSaleFeeMinor(price, 0, 'usd'));
    }
    // No fixed part (2026-11-24): NoDitto absorbs the ~US$0.25 payout fee on small sales.
    for (const price of [4000, 15_000, 100_000]) {
      const fee = cashSaleFeeMinor(price, 0, 'usd', 'BANK_TRANSFER');
      expect(fee - stripeCostMinor(price, fee, 'usd', 'BANK_TRANSFER')).toBeGreaterThan(0);
    }
    // 2%: a US$40 sale is US$0.80, against US$1.80 by card.
    expect(cashSaleFeeMinor(4000, 0, 'usd', 'BANK_TRANSFER')).toBe(80);
    expect(cashSaleFeeMinor(4000, 0, 'usd')).toBe(180);
  });

  it('waits three days for the money', () => {
    expect(BANK_TRANSFER_WAIT_HOURS).toBe(72);
  });
});

describe('bank transfer read-back', () => {
  const waiting = {
    id: 'pi_1',
    status: 'requires_action',
    amount: 4180,
    currency: 'usd',
    client_secret: 'pi_1_secret',
    payment_method_types: ['customer_balance'],
    next_action: {
      type: 'display_bank_transfer_instructions',
      display_bank_transfer_instructions: {
        amount_remaining: 2000,
        currency: 'usd',
        reference: 'GYUNR4ZFASF3',
        hosted_instructions_url: 'https://payments.stripe.com/x',
        financial_addresses: [
          {
            type: 'aba',
            aba: {
              account_holder_name: 'NoDitto Company',
              account_number: '11119955570445961',
              routing_number: '999999999',
              bank_name: 'US Test Bank',
            },
          },
          { type: 'swift', swift: {} },
        ],
      },
    },
  } as unknown as Stripe.PaymentIntent;

  it('reads the account, reference and the amount still owed', () => {
    expect(bankTransferInstructionsOf(waiting)).toEqual({
      amountRemaining: 2000,
      currency: 'usd',
      reference: 'GYUNR4ZFASF3',
      accountHolderName: 'NoDitto Company',
      bankName: 'US Test Bank',
      accountNumber: '11119955570445961',
      routingNumber: '999999999',
      hostedInstructionsUrl: 'https://payments.stripe.com/x',
    });
  });

  it('is REQUIRES_ACTION with the instructions until the money lands', () => {
    const status = collectionStatusOf(waiting);
    expect(status.status).toBe('REQUIRES_ACTION');
    expect(status.bankTransfer?.reference).toBe('GYUNR4ZFASF3');
  });

  it('carries no instructions on a card intent', () => {
    const card = { ...waiting, next_action: { type: 'use_stripe_sdk' }, payment_method_types: ['card'] } as unknown as Stripe.PaymentIntent;
    expect(bankTransferInstructionsOf(card)).toBeNull();
  });
});
