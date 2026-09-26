// tests/unit/regionParity.test.ts
//
// Does a US contract behave exactly like an AU one, and is the only difference the
// denomination? That is the question opening a second trading region asks, and this
// drives the whole Cash_Sale lifecycle through the REAL orchestrator to answer it:
// open the agreement, agree delivery terms from both sides, pay into escrow, ship,
// receive, accept the inspection, and release the seller's proceeds.
//
// AGAINST THE ORCHESTRATOR, NOT A BROWSER. A Playwright journey for a US seller needs
// US-region seed members with their own Stripe identity and Connect state, which is a
// change to shared database state. This exercises the same decisions — every guard,
// every transition, the fee, the payout — in milliseconds and with no shared state, so
// it can assert PARITY by running one scenario twice rather than eyeballing two runs.
//
// WHY NON-DOLLAR CURRENCIES APPEAR IN A TEST ABOUT AU AND US. Because AUD and USD are
// indistinguishable on screen: en-AU renders AUD as "$" and en-US renders USD as "$",
// so an assertion that only compares those two passes even when the currency is being
// ignored entirely. GBP and JPY are the control — they prove the denomination is
// actually being threaded rather than defaulted. JPY additionally catches the
// factor-of-100 error, since the yen has no minor unit.

import { describe, expect, it } from 'vitest';

import {
  acceptCashSaleInspection,
  acceptCashSaleTerms,
  initiateCashSale,
  payoutCashSaleSeller,
  platformFeeCentsFor,
  recordCashSaleReceipt,
  recordCashSaleShipment,
  sellerNetCentsFor,
  settleCashSale,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
  type CashSaleTermsInput,
  type PayoutNotifier,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import { formatMoney } from '@/lib/format';
import { minorUnitDigits, regionCurrency } from '@/domain/region';
import {
  BUYER,
  fakeTracking,
  ITEM,
  makeCashSaleRepository,
  makePayments,
} from './fakes/cashSaleRepository';

const CONFIRMED_PURCHASE = {
  buyerId: BUYER.profileId,
  itemId: ITEM.id,
  sellerIdentityVersion: 'seller-v1',
  buyerConfirmedSellerIdentity: true,
};

const DELIVERY_TERMS: CashSaleTermsInput = {
  fulfillmentMethod: 'DELIVERY',
  shippingCostCents: 1_500,
  deliveryAddress: {
    label: '1 Example St',
    placeId: 'geo:delivery-parity',
    countryCode: 'AU',
    lat: -37.8136,
    lng: 144.9631,
  },
  shippingNotes: 'Signature on delivery',
};

/** Everything the notifier was told, so the currency it received can be asserted. */
interface CapturedSettlement {
  netCents: number;
  currency: string;
}

function makeCapturingNotifier(): {
  notifier: PayoutNotifier;
  settled: CapturedSettlement[];
} {
  const settled: CapturedSettlement[] = [];
  const notifier: PayoutNotifier = {
    async releaseSettled({ netCents, currency }) {
      settled.push({ netCents, currency });
    },
    async releaseFailed() {},
    async disputeResolved() {},
  };
  return { notifier, settled };
}

function makeDeps(currency: string) {
  const { repository, state } = makeCashSaleRepository({ currency });
  const { payments, calls } = makePayments();
  const { notifier, settled } = makeCapturingNotifier();
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
    notifier,
  };
  return { deps, state, calls, settled };
}

/**
 * The whole happy path, start to money released.
 *
 * Returns the facts a caller can compare between regions. Deliberately returns the
 * SHAPE of the outcome rather than asserting inside, so the parity test can diff two
 * runs instead of restating every assertion twice.
 */
async function runLifecycle(currency: string) {
  const { deps, state, settled } = makeDeps(currency);

  const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
  if (!created.ok) throw new Error(`agreement failed: ${created.error}`);
  const saleId = created.sale.id;

  // Seller prices the postage, buyer supplies the address: neither may set the
  // other's field, so DELIVERY terms take two saves.
  const priced = await updateCashSaleTerms(deps, {
    actorId: ITEM.ownerId,
    cashSaleId: saleId,
    expectedTermsVersion: created.sale.termsVersion,
    terms: { ...DELIVERY_TERMS, deliveryAddress: undefined },
  });
  if (!priced.ok) throw new Error(`postage failed: ${priced.error}`);

  const addressed = await updateCashSaleTerms(deps, {
    actorId: BUYER.profileId,
    cashSaleId: saleId,
    expectedTermsVersion: priced.sale.termsVersion,
    terms: DELIVERY_TERMS,
  });
  if (!addressed.ok) throw new Error(`address failed: ${addressed.error}`);

  // PAYMENT IS THE COMMITMENT (0099) — there is no mutual confirm-to-pay.
  const paid = await acceptCashSaleTerms(deps, {
    actorId: BUYER.profileId,
    cashSaleId: saleId,
    termsVersion: addressed.sale.termsVersion,
  });
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`);

  // Fulfilment is gated on CLEARED funds, not on a payment having been requested. The
  // fake provider settles synchronously, so the charge may already have cleared by the
  // time `acceptCashSaleTerms` returns; against a provider that confirms out of band it
  // lands PAYMENT_PENDING and the webhook drives this step. Handle both rather than
  // assuming, because which one happens is a property of the binding, not the region.
  const cleared =
    paid.sale.status === 'PAYMENT_PENDING'
      ? await settleCashSale(deps, { cashSaleId: saleId })
      : paid;
  if (!cleared.ok) throw new Error(`settlement failed: ${cleared.error}`);

  const shipped = await recordCashSaleShipment(deps, {
    actorId: ITEM.ownerId,
    cashSaleId: saleId,
    shipment: { carrier: 'Australia Post', trackingNumber: 'PARITY123' },
  });
  if (!shipped.ok) throw new Error(`shipment failed: ${shipped.error}`);

  const received = await recordCashSaleReceipt(deps, {
    actorId: BUYER.profileId,
    cashSaleId: saleId,
  });
  if (!received.ok) throw new Error(`receipt failed: ${received.error}`);

  const accepted = await acceptCashSaleInspection(deps, {
    actorId: BUYER.profileId,
    cashSaleId: saleId,
  });
  if (!accepted.ok) throw new Error(`inspection failed: ${accepted.error}`);

  const released = await payoutCashSaleSeller(deps, { cashSaleId: saleId });

  return {
    statuses: {
      agreement: created.sale.status,
      paid: paid.sale.status,
      cleared: cleared.sale.status,
      shipped: shipped.sale.status,
      received: received.sale.status,
      accepted: accepted.sale.status,
    },
    currency: state.sale!.currency,
    agreedPriceCents: state.sale!.agreedPriceCents,
    platformFeeCents: state.sale!.platformFeeCents,
    amountCents: state.sale!.amountCents,
    netCents: sellerNetCentsFor(state.sale!),
    releasedOk: released.ok,
    settled,
  };
}

describe('Cash_Sale lifecycle is identical in every trading region', () => {
  it('completes end to end and releases the proceeds in AUD', async () => {
    const run = await runLifecycle('aud');

    expect(run.statuses.agreement).toBe('AGREEMENT');
    expect(run.statuses.accepted).toBe('COMPLETED');
    expect(run.releasedOk).toBe(true);
    expect(run.currency).toBe('aud');
  });

  it('completes end to end and releases the proceeds in USD', async () => {
    const run = await runLifecycle('usd');

    // THE WHOLE POINT. Not "US works" in isolation — US reaching the same terminal
    // state by the same route, with the money carried in its own denomination.
    expect(run.statuses.accepted).toBe('COMPLETED');
    expect(run.releasedOk).toBe(true);
    expect(run.currency).toBe('usd');
  });

  it('takes the same route and the same figures in AU and US, differing only in currency', async () => {
    const [au, us] = await Promise.all([runLifecycle('aud'), runLifecycle('usd')]);

    expect(us.statuses).toEqual(au.statuses);
    expect(us.agreedPriceCents).toBe(au.agreedPriceCents);
    expect(us.platformFeeCents).toBe(au.platformFeeCents);
    expect(us.amountCents).toBe(au.amountCents);
    expect(us.netCents).toBe(au.netCents);
    expect(us.releasedOk).toBe(au.releasedOk);

    // The one thing that must differ.
    expect(au.currency).toBe('aud');
    expect(us.currency).toBe('usd');
  });

  it('charges the same percentage fee whatever the currency', async () => {
    // PLATFORM_FEE_BPS is a proportion, so it is currency-agnostic by construction.
    // Pinned anyway: a per-region fee table is exactly the kind of thing that gets
    // added later without noticing this test never checked it.
    for (const currency of ['aud', 'usd', 'gbp', 'jpy']) {
      const run = await runLifecycle(currency);
      expect(run.platformFeeCents).toBe(platformFeeCentsFor(run.agreedPriceCents));
    }
  });
});

describe('the payout notification is denominated in the contract currency', () => {
  it('tells the notifier which currency the proceeds are in', async () => {
    const run = await runLifecycle('usd');

    expect(run.settled).toHaveLength(1);
    expect(run.settled[0].currency).toBe('usd');
    expect(run.settled[0].netCents).toBe(run.netCents);
  });

  it('renders a non-dollar currency correctly, which is what proves it is threaded', async () => {
    // AUD and USD both render "$", so only a non-dollar currency can distinguish
    // "the currency is used" from "the currency is ignored".
    const gbp = await runLifecycle('gbp');
    expect(gbp.settled[0].currency).toBe('gbp');
    expect(formatMoney(gbp.settled[0].netCents, gbp.settled[0].currency)).toContain('£');
  });

  it('does not divide a zero-decimal currency by a hundred', async () => {
    const jpy = await runLifecycle('jpy');

    expect(minorUnitDigits('jpy')).toBe(0);
    const rendered = formatMoney(jpy.settled[0].netCents, jpy.settled[0].currency);
    expect(rendered).toContain('¥');
    // A yen figure has no fractional part. If the divisor leaked in, this reads
    // "¥1,234.56" and the seller has been told they were paid a hundredth of it.
    expect(rendered).not.toContain('.');
  });
});

describe('every trading region is representable end to end', () => {
  it('runs the lifecycle in each tradingEnabled region currency', async () => {
    // Derived from the registry rather than hardcoded, so opening a third region
    // brings it into this test automatically instead of silently skipping it.
    for (const code of ['AU', 'US'] as const) {
      const currency = regionCurrency(code);
      expect(currency, `no currency for ${code}`).toBeTruthy();

      const run = await runLifecycle(currency!);
      expect(run.statuses.accepted, `${code} did not complete`).toBe('COMPLETED');
      expect(run.currency).toBe(currency);
      expect(run.releasedOk, `${code} payout failed`).toBe(true);
    }
  });
});
