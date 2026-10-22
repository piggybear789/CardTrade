// tests/unit/cashSaleBankPayment.test.ts
//
// Bank rails for cash sales (0158): which buyers are offered which rail, that each rail
// is priced by the same function the Pay dialog shows, that the claim re-prices the
// contract for the rail charged, and that a bank approval is resumable rather than a
// failed sale (domain/payments/paymentMethods.ts, cashSaleOrchestrator.acceptCashSaleTerms).

import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import {
  ABANDONED_PAYMENT_MINUTES,
  acceptCashSaleTerms,
  confirmCashSalePayment,
  getCashSalePaymentAction,
  initiateCashSale,
  sweepAbandonedPayments,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { cashSaleFeeMinor } from '@/domain/fees/processingFee';
import {
  paymentMethodsFor,
  serviceFeeForMethod,
  totalForMethod,
  type MethodPricingFacts,
} from '@/domain/payments/paymentMethods';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { collectionStatusOf } from '@/domain/services/stripe/StripeService';
import { metadataFor } from '@/domain/services/stripe/metadata';
import { translateStripeEvent } from '@/domain/services/stripe/webhook';
import type { TransferResult } from '@/domain/services/types';
import { BUYER, ITEM, fakeTracking, makeCashSaleRepository } from './fakes/cashSaleRepository';
import { DELIVERY_TERMS, PURCHASE } from './helpers/disputedCashSale';

const T0 = Date.parse('2026-10-21T00:00:00.000Z');

/**
 * An AUD sale with posted terms agreed, ready for the buyer to press Pay. `buyerAtPay`
 * swaps the buyer record after the agreement opens, e.g. to a buyer with no saved card,
 * who may open a contract from a listing and pay from their bank.
 */
async function payableSale(options: { buyerAtPay?: typeof BUYER; payments?: InMemoryService } = {}) {
  const payments = options.payments ?? new InMemoryService();
  const { repository, setBuyer } = makeCashSaleRepository();
  let now = T0;
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments,
    tracking: fakeTracking,
    now: () => new Date(now),
  };
  const created = await initiateCashSale(deps, PURCHASE);
  if (!created.ok) throw new Error(`setup: ${created.error}`);
  const priced = await updateCashSaleTerms(deps, {
    cashSaleId: created.sale.id,
    actorId: ITEM.ownerId,
    expectedTermsVersion: created.sale.termsVersion,
    terms: { ...DELIVERY_TERMS, deliveryAddress: undefined },
  });
  if (!priced.ok) throw new Error('setup: postage');
  const addressed = await updateCashSaleTerms(deps, {
    cashSaleId: created.sale.id,
    actorId: BUYER.profileId,
    expectedTermsVersion: priced.sale.termsVersion,
    terms: DELIVERY_TERMS,
  });
  if (!addressed.ok) throw new Error('setup: address');
  if (options.buyerAtPay) setBuyer(options.buyerAtPay);
  return {
    deps,
    payments,
    sale: addressed.sale,
    advance(minutes: number) {
      now += minutes * 60_000;
    },
  };
}

describe('which rails a buyer is offered', () => {
  it('offers a bank rail only in its currency, to a buyer whose bank runs it', () => {
    expect(paymentMethodsFor({ currency: 'aud', buyerRegion: 'AU' })).toEqual(['CARD', 'PAYTO']);
    // US bank is defined but not offered: Payment Element will not render Link alone.
    expect(paymentMethodsFor({ currency: 'usd', buyerRegion: 'US' })).toEqual(['CARD']);
    expect(paymentMethodsFor({ currency: 'eur', buyerRegion: 'NL' })).toEqual(['CARD', 'IDEAL']);
    expect(paymentMethodsFor({ currency: 'eur', buyerRegion: 'BE' })).toEqual(['CARD', 'BANCONTACT']);
    expect(paymentMethodsFor({ currency: 'eur', buyerRegion: 'AT' })).toEqual(['CARD', 'EPS']);
    expect(paymentMethodsFor({ currency: 'pln', buyerRegion: 'PL' })).toEqual(['CARD', 'P24']);
    // A German buyer has no rail here, and an Australian buyer of a EUR sale has none.
    expect(paymentMethodsFor({ currency: 'eur', buyerRegion: 'DE' })).toEqual(['CARD']);
    expect(paymentMethodsFor({ currency: 'eur', buyerRegion: 'AU' })).toEqual(['CARD']);
    // No region is card only, never a guess.
    expect(paymentMethodsFor({ currency: 'aud', buyerRegion: null })).toEqual(['CARD']);
  });

  it('never offers a rail marked as not offered, whatever the amount', () => {
    expect(paymentMethodsFor({ currency: 'usd', buyerRegion: 'US', amountMinor: 1_000 })).not.toContain('US_BANK');
  });
});

describe('pricing a contract per rail', () => {
  const sale: MethodPricingFacts = {
    agreedPriceCents: 10_000,
    shippingCostCents: 1_500,
    platformFeeCents: 999, // a stored card fee from before a rate change
    amountCents: 10_000 + 1_500 + 999,
    currency: 'aud',
    paymentMethod: null,
  };

  it('keeps a stored card fee on a contract priced for card', () => {
    expect(serviceFeeForMethod(sale, 'CARD')).toBe(999);
    expect(totalForMethod(sale, 'CARD')).toBe(sale.amountCents);
  });

  it('prices a bank rail fresh from price plus postage', () => {
    expect(serviceFeeForMethod(sale, 'PAYTO')).toBe(cashSaleFeeMinor(10_000, 1_500, 'aud', 'PAYTO'));
    expect(totalForMethod(sale, 'PAYTO')).toBe(11_500 + cashSaleFeeMinor(10_000, 1_500, 'aud', 'PAYTO'));
  });

  it('re-prices card after an abandoned bank attempt left the row priced for the bank', () => {
    const bankPriced = { ...sale, paymentMethod: 'PAYTO' as const };
    expect(serviceFeeForMethod(bankPriced, 'CARD')).toBe(cashSaleFeeMinor(10_000, 1_500, 'aud'));
  });
});

describe('paying a cash sale from the bank', () => {
  it('opens a bank approval priced for the rail, and settles at that price', async () => {
    const s = await payableSale();
    const expected = totalForMethod(s.sale, 'PAYTO');

    const paid = await acceptCashSaleTerms(s.deps, {
      actorId: BUYER.profileId,
      cashSaleId: s.sale.id,
      termsVersion: s.sale.termsVersion,
      expectedAmountCents: expected,
      paymentMethod: 'PAYTO',
    });

    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.sale.status).toBe('PAYMENT_PENDING');
    expect(paid.nextAction?.paymentMethod).toBe('PAYTO');
    expect(paid.nextAction?.clientSecret).toBeTruthy();
    // The claim re-priced the contract, so the seller's net is unchanged and the
    // charge is exactly the figure the dialog showed beside PayTo.
    expect(paid.sale.paymentMethod).toBe('PAYTO');
    expect(paid.sale.platformFeeCents).toBe(cashSaleFeeMinor(ITEM.fmvCents, DELIVERY_TERMS.shippingCostCents, 'aud', 'PAYTO'));
    expect(paid.sale.amountCents).toBe(expected);
    expect(paid.sale.amountCents - paid.sale.platformFeeCents).toBe(s.sale.amountCents - s.sale.platformFeeCents);

    // The buyer approves in their bank; the read-back settles against the re-priced total.
    s.payments.completeChallenge(paid.sale.transferId!, 'SETTLED');
    const confirmed = await confirmCashSalePayment(s.deps, { actorId: BUYER.profileId, cashSaleId: s.sale.id });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.sale.status).toBe('ESCROW_HELD');
    expect(confirmed.settledNow).toBe(true);
  });

  it('refuses a total that is not the chosen rail’s (ESC-31)', async () => {
    const s = await payableSale();
    const paid = await acceptCashSaleTerms(s.deps, {
      actorId: BUYER.profileId,
      cashSaleId: s.sale.id,
      termsVersion: s.sale.termsVersion,
      expectedAmountCents: totalForMethod(s.sale, 'CARD'),
      paymentMethod: 'PAYTO',
    });
    expect(paid).toMatchObject({ ok: false, error: 'STALE_TERMS' });
    expect((await s.deps.repository.loadCashSale(s.sale.id))?.status).toBe('AGREEMENT');
  });

  it('refuses a rail this buyer is not offered, with the sale untouched', async () => {
    const s = await payableSale();
    const paid = await acceptCashSaleTerms(s.deps, {
      actorId: BUYER.profileId,
      cashSaleId: s.sale.id,
      termsVersion: s.sale.termsVersion,
      paymentMethod: 'IDEAL',
    });
    expect(paid).toMatchObject({ ok: false, error: 'NOT_SUPPORTED' });
    const sale = await s.deps.repository.loadCashSale(s.sale.id);
    expect(sale?.status).toBe('AGREEMENT');
    expect(sale?.paymentNonce).toBeNull();
  });

  it('needs no saved card for a bank rail, and still needs one for card', async () => {
    const noCard = { ...BUYER, paymentSourceId: null };
    const byCard = await payableSale({ buyerAtPay: noCard });
    expect(
      await acceptCashSaleTerms(byCard.deps, {
        actorId: BUYER.profileId,
        cashSaleId: byCard.sale.id,
        termsVersion: byCard.sale.termsVersion,
      }),
    ).toMatchObject({ ok: false, error: 'BUYER_NO_PAYMENT_METHOD' });

    const byBank = await payableSale({ buyerAtPay: noCard });
    const paid = await acceptCashSaleTerms(byBank.deps, {
      actorId: BUYER.profileId,
      cashSaleId: byBank.sale.id,
      termsVersion: byBank.sale.termsVersion,
      paymentMethod: 'PAYTO',
    });
    expect(paid.ok).toBe(true);
    if (paid.ok) expect(paid.sale.status).toBe('PAYMENT_PENDING');
  });

  it('puts the sale back to AGREEMENT when the provider will not open the rail', async () => {
    const payments = new InMemoryService();
    payments.requestTransfer = async (params): Promise<TransferResult> => ({
      transferId: '',
      amount: params.amount,
      status: 'FAILED',
    });
    const s = await payableSale({ payments });
    const paid = await acceptCashSaleTerms(s.deps, {
      actorId: BUYER.profileId,
      cashSaleId: s.sale.id,
      termsVersion: s.sale.termsVersion,
      paymentMethod: 'PAYTO',
    });
    expect(paid).toMatchObject({ ok: false, error: 'NOT_SUPPORTED' });
    if (!paid.ok) expect(paid.detail).toContain('Nothing was charged');
    const sale = await s.deps.repository.loadCashSale(s.sale.id);
    // Not FAILED, and the item was not relisted: the buyer can pay another way.
    expect(sale?.status).toBe('AGREEMENT');
  });

  it('resumes an outstanding approval on another device, then lets the sweep abandon it', async () => {
    const s = await payableSale();
    const paid = await acceptCashSaleTerms(s.deps, {
      actorId: BUYER.profileId,
      cashSaleId: s.sale.id,
      termsVersion: s.sale.termsVersion,
      paymentMethod: 'PAYTO',
    });
    if (!paid.ok) throw new Error(paid.error);

    const action = await getCashSalePaymentAction(s.deps, { actorId: BUYER.profileId, cashSaleId: s.sale.id });
    expect(action).toMatchObject({ ok: true, paymentMethod: 'PAYTO' });
    if (action.ok) expect(action.clientSecret).toBeTruthy();

    s.advance(ABANDONED_PAYMENT_MINUTES + 1);
    const tally = await sweepAbandonedPayments(s.deps);
    expect(tally.abandoned).toBe(1);
    const reopened = await s.deps.repository.loadCashSale(s.sale.id);
    expect(reopened?.status).toBe('AGREEMENT');

    // Paying by card afterwards is priced for card again, not at the bank rate left
    // on the row by the abandoned attempt.
    const byCard = await acceptCashSaleTerms(s.deps, {
      actorId: BUYER.profileId,
      cashSaleId: s.sale.id,
      termsVersion: reopened!.termsVersion,
      expectedAmountCents: totalForMethod(reopened!, 'CARD'),
    });
    expect(byCard.ok).toBe(true);
    if (!byCard.ok) return;
    expect(byCard.sale.platformFeeCents).toBe(cashSaleFeeMinor(ITEM.fmvCents, DELIVERY_TERMS.shippingCostCents, 'aud'));
    expect(byCard.sale.paymentMethod).toBe('CARD');
  });
});

describe('the Stripe binding reads a bank approval as resumable', () => {
  const base = {
    id: 'pi_bank',
    object: 'payment_intent',
    amount: 11_830,
    amount_received: 0,
    client_secret: 'pi_bank_secret_x',
    currency: 'eur',
    metadata: metadataFor('TRANSFER', 'cash-sale:sale-1'),
  };

  it('maps a bank intent awaiting the buyer to REQUIRES_ACTION, and a declined card to FAILED', () => {
    const bank = { ...base, status: 'requires_payment_method', payment_method_types: ['ideal'] };
    expect(collectionStatusOf(bank as unknown as Stripe.PaymentIntent)).toMatchObject({
      status: 'REQUIRES_ACTION',
      clientSecret: 'pi_bank_secret_x',
    });
    const card = { ...base, status: 'requires_payment_method', payment_method_types: ['card'] };
    expect(collectionStatusOf(card as unknown as Stripe.PaymentIntent).status).toBe('FAILED');
  });

  it('drops a failed bank approval from the webhook instead of failing the sale', () => {
    const envelope = (object: unknown) =>
      ({
        id: 'evt_bank',
        object: 'event',
        api_version: null,
        created: 1_800_000_000,
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'payment_intent.payment_failed',
        data: { object },
      }) as unknown as Stripe.Event;

    const backedOut = { ...base, status: 'requires_payment_method', payment_method_types: ['ideal'] };
    expect(translateStripeEvent(envelope(backedOut))).toEqual([]);

    const declinedCard = { ...base, status: 'requires_payment_method', payment_method_types: ['card'] };
    const [failure] = translateStripeEvent(envelope(declinedCard));
    expect(failure?.type).toBe('transfer.failed');
  });
});
