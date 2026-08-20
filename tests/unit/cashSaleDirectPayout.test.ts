// tests/unit/cashSaleDirectPayout.test.ts
//
// `direct` payout mode on a Cash_Sale contract (Req 4.8, 4.9): once both parties
// accept the terms, funds are collected and routed to the Seller's connected
// account with the flat Platform_Fee retained, an existing payer is reused rather
// than duplicated, and an unpayable Seller never gets a payment submitted.
//
// The Buyer's payer is PLATFORM-SCOPED. The previous provider scoped payers to the
// merchant they were created under, so paying a newly-onboarded Seller meant
// minting a second payer on that sub-merchant from a stored, reusable card token.
// A Stripe Customer can pay any connected account, so no such token is kept.

import { describe, expect, it } from 'vitest';

import {
  acceptCashSaleTerms,
  confirmCashSaleHandover,
  initiateCashSale,
  MAX_PAYOUT_ATTEMPTS,
  platformFeeCentsFor,
  processDueCashSalePayouts,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { MerchantRecord } from '@/domain/orchestrator/merchantOnboarding';
import type { PaymentService } from '@/domain/services/types';
import {
  APPROVED_SELLER,
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

const IN_PERSON_TERMS = {
  fulfillmentMethod: 'IN_PERSON' as const,
  meetingLocation: 'Melbourne Central, main concourse',
  meetingPlaceId: 'geo:meeting-1',
  meetingLat: -37.8183,
  meetingLng: 144.9671,
  meetingAt: '2099-01-15T03:00:00.000Z',
};

/** Build a direct-payout orchestrator and drive it to both-accepted. */
async function runToPayment(options: {
  payee?: MerchantRecord | null;
  buyer?: typeof BUYER;
  existingPayerRef?: string | null;
  payoutStatus?: 'SETTLED' | 'FAILED';
}) {
  const { repository, state } = makeCashSaleRepository({
    payee: options.payee,
    buyer: options.buyer,
    existingPayerRef: options.existingPayerRef,
  });
  const { payments, calls } = makePayments({ payoutStatus: options.payoutStatus });
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
    payoutMode: 'direct',
  };

  const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
  if (!created.ok) return { deps, created, state, calls, result: created };

  const terms = await updateCashSaleTerms(deps, {
    actorId: BUYER.profileId,
    cashSaleId: created.sale.id,
    expectedTermsVersion: created.sale.termsVersion,
    terms: IN_PERSON_TERMS,
  });
  if (!terms.ok) throw new Error(`terms failed: ${terms.error}`);

  const result = await acceptCashSaleTerms(deps, {
    actorId: BUYER.profileId,
    cashSaleId: created.sale.id,
    termsVersion: terms.sale.termsVersion,
  });

  return { deps, created, state, calls, result };
}

describe('cash sale — direct payout mode', () => {
  it('collects into the platform balance and does NOT pay the seller at agreement', async () => {
    const { state, calls, result } = await runToPayment({});

    expect(result.ok).toBe(true);

    // One platform-scoped payer, created with no sub-merchant target and no card
    // token — the provider needs neither to pay a connected account.
    expect(calls.createPayer).toEqual([
      { profileId: BUYER.profileId, email: BUYER.contactEmail },
    ]);
    expect(state.payerRefs).toEqual({ mch_seller: 'payer_platform_new' });

    // Collection carries NO merchantRef even in `direct` mode. Passing one made
    // the provider forward to the Seller at agreement time — before shipping and
    // before the Buyer could inspect — which meant the money was already gone
    // when a dispute could first arise. That is not escrow.
    expect(calls.transfers).toEqual([
      {
        payerId: 'payer_platform_new',
        nonce: expect.any(String),
        merchantRef: undefined,
        applicationFee: undefined,
        amount: ITEM.fmvCents + platformFeeCentsFor(ITEM.fmvCents),
      },
    ]);

    // And critically: the Seller has not been paid yet.
    expect(calls.payouts).toHaveLength(0);
  });

  it('releases the net to the seller once both parties confirm handover', async () => {
    const { deps, created, calls, result } = await runToPayment({});
    expect(result.ok).toBe(true);
    if (!created.ok) throw new Error('setup failed');
    const cashSaleId = created.sale.id;

    const first = await confirmCashSaleHandover(deps, {
      actorId: BUYER.profileId,
      cashSaleId,
    });
    expect(first.ok).toBe(true);
    expect(first.ok && first.sale.status).toBe('HANDOVER');
    expect(calls.payouts).toHaveLength(0);

    const completed = await confirmCashSaleHandover(deps, {
      actorId: ITEM.ownerId,
      cashSaleId,
    });

    expect(completed.ok).toBe(true);
    expect(completed.ok && completed.sale.status).toBe('COMPLETED');

    // Exactly one release, for the agreed price — the Platform_Fee stays behind
    // in the platform balance because `application_fee_amount` is incompatible
    // with separate charges and transfers.
    const fee = platformFeeCentsFor(ITEM.fmvCents);
    expect(calls.payouts).toEqual([
      {
        merchantRef: 'mch_seller',
        nonce: `payout:${cashSaleId}`,
        amount: ITEM.fmvCents + fee - fee,
        sourcePaymentRef: 'transfer-1',
      },
    ]);

    // The Buyer was charged exactly once across the whole lifecycle. This is the
    // assertion that would catch a release implemented with `requestTransfer`.
    expect(calls.transfers).toHaveLength(1);
    expect(completed.ok && completed.sale.sellerPayoutStatus).toBe('SETTLED');
  });

  it('leaves the release owed and retryable when the provider rejects it', async () => {
    const { deps, created, calls } = await runToPayment({ payoutStatus: 'FAILED' });
    if (!created.ok) throw new Error('setup failed');
    const cashSaleId = created.sale.id;

    await confirmCashSaleHandover(deps, {
      actorId: BUYER.profileId,
      cashSaleId,
    });
    const completed = await confirmCashSaleHandover(deps, {
      actorId: ITEM.ownerId,
      cashSaleId,
    });

    // The sale still completed for the participants — a failed release is an
    // operator problem, not something to block the Buyer's purchase on.
    expect(completed.ok).toBe(true);
    expect(completed.ok && completed.sale.status).toBe('COMPLETED');
    // But it is recorded as owed, so it can be retried rather than lost.
    expect(completed.ok && completed.sale.sellerPayoutStatus).toBe('FAILED');
    expect(calls.payouts).toHaveLength(1);
  });

  it('recovers a stuck release on a later drain pass', async () => {
    // First attempt fails, mirroring a seller who had not finished payout
    // onboarding or a provider blip.
    const { deps, created, calls } = await runToPayment({ payoutStatus: 'FAILED' });
    if (!created.ok) throw new Error('setup failed');
    const cashSaleId = created.sale.id;

    await confirmCashSaleHandover(deps, { actorId: BUYER.profileId, cashSaleId });
    await confirmCashSaleHandover(deps, { actorId: ITEM.ownerId, cashSaleId });
    expect(calls.payouts).toHaveLength(1);

    // The queue still lists it, so the money is not stranded.
    const stillOwed = await deps.repository.listDuePayouts({
      limit: 10,
      maxAttempts: MAX_PAYOUT_ATTEMPTS,
    });
    expect(stillOwed).toEqual([cashSaleId]);

    // Now the provider accepts. The retry reuses the SAME nonce, which is what
    // makes re-running the drain safe if an earlier attempt actually succeeded
    // but the response was lost.
    const drained = await processDueCashSalePayouts(
      { ...deps, payments: makePayments({}).payments as unknown as PaymentService },
      { limit: 10 },
    );
    expect(drained).toMatchObject({ considered: 1, settled: 1, stillOwed: 0 });
  });

  it('reuses an existing payer reference instead of creating another', async () => {
    const { calls } = await runToPayment({ existingPayerRef: 'payer_known' });

    expect(calls.createPayer).toHaveLength(0);
    expect(calls.transfers[0].payerId).toBe('payer_known');
  });

  it('rejects an unpayable seller without reserving the item', async () => {
    const { result, state, calls } = await runToPayment({
      payee: {
        ...APPROVED_SELLER,
        merchantStatus: 'PENDING',
        settlementsEnabled: false,
      },
    });

    // SELLER_NOT_PAYABLE, not SELLER_IDENTITY_UNVERIFIED. Since 0069 those are two
    // different failures and this seller has only the second problem: they passed the
    // identity check (so they are verified and disclosable) but have not finished
    // Connect, so there is nowhere to send the money. The refusal still stands and
    // the item is still not reserved — only the reason is now accurate.
    expect(result).toMatchObject({ ok: false, error: 'SELLER_NOT_PAYABLE' });
    expect(state.item.status).toBe('AVAILABLE');
    expect(calls.transfers).toHaveLength(0);
  });
});
