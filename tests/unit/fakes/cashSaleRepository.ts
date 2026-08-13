// tests/unit/fakes/cashSaleRepository.ts
// In-memory CashSaleRepository mirroring the SQL guards: expected-state updates,
// database-owned terms versioning, and single-winner nonce claiming.

import { platformFeeCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import type {
  BuyerRecord,
  CashSaleLineItem,
  CashSaleRecord,
  CashSaleRepository,
  ItemRecord,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { MerchantRecord } from '@/domain/orchestrator/merchantOnboarding';
import type {
  TrackingService,
  TrackingState,
} from '@/domain/services/tracking/types';

/** Mirrors cardtrade.cash_sale_inspection_days(). */
export const INSPECTION_WINDOW_DAYS = 7;

export interface FakeState {
  sale: CashSaleRecord | null;
  item: ItemRecord;
  /** Contract line items (0064). Populated only for a SHOPFRONT contract. */
  lineItems: CashSaleLineItem[];
  /**
   * `fromStatus` / `toStatus` are recorded because `disputeOriginStatus` reads the
   * status to restore back out of this log, exactly as the SQL repository does — so a
   * withdrawal test exercises the real lookup rather than a shortcut field.
   */
  events: {
    event: string;
    actorId: string | null;
    fromStatus?: CashSaleRecord['status'] | null;
    toStatus?: CashSaleRecord['status'] | null;
  }[];
  payerRefs: Record<string, string>;
}

const IDENTITY = {
  version: 'seller-v1',
  legalEntityName: 'Seller One Pty Ltd',
  tradingName: 'Seller One Cards',
  registrationNumber: '12345678901',
  organisationType: 'company',
  verifiedAt: '2026-07-25T00:00:00.000Z',
};

export const APPROVED_SELLER: MerchantRecord = {
  profileId: 'seller-1',
  merchantRef: 'mch_seller',
  merchantStatus: 'APPROVED',
  liveEnabled: true,
  transactionsEnabled: true,
  settlementsEnabled: true,
  legalEntityName: IDENTITY.legalEntityName,
  tradingName: IDENTITY.tradingName,
  registrationNumber: IDENTITY.registrationNumber,
  organisationType: IDENTITY.organisationType,
  identityVersion: IDENTITY.version,
  identityDisclosureConsentedAt: '2026-07-24T00:00:00.000Z',
  identityVerifiedAt: IDENTITY.verifiedAt,
  // The Identity_Gate since 0069. A seller now needs BOTH: this check to be
  // disclosed and to sell at all, and the `merchant_*` fields above to be paid.
  identityCheckStatus: 'VERIFIED',
  identityCheckVerifiedAt: IDENTITY.verifiedAt,
};

/**
 * The region both default parties trade in (0065).
 *
 * Both fixtures carry it because `initiateCashSale` refuses an UNKNOWN region — a
 * missing region is not treated as permissive, so leaving these unset would make
 * every contract-opening test fail on the region guard instead of exercising what
 * it was written for. Tests that WANT a mismatch override one of them; see
 * `tests/unit/regionGuard.test.ts`.
 */
export const TEST_REGION = 'AU';

export const BUYER: BuyerRecord = {
  profileId: 'buyer-1',
  payerId: 'payer_platform',
  paymentSourceId: 'src_saved',
  displayName: 'Buyer One',
  contactEmail: 'buyer@example.com',
  paymentTokenType: 'credit-card',
  regionCode: TEST_REGION,
};

export const ITEM: ItemRecord = {
  id: 'item-1',
  ownerId: 'seller-1',
  fmvCents: 10_000,
  status: 'AVAILABLE',
  title: 'Charizard Base Set',
  ownerRegionCode: TEST_REGION,
};

export function makeCashSaleRepository(options: {
  buyer?: BuyerRecord | null;
  item?: ItemRecord;
  payee?: MerchantRecord | null;
  existingPayerRef?: string | null;
} = {}) {
  const state: FakeState = {
    sale: null,
    item: { ...(options.item ?? ITEM) },
    lineItems: [],
    events: [],
    payerRefs: {},
  };
  const buyer = options.buyer === undefined ? BUYER : options.buyer;
  const payee = options.payee === undefined ? APPROVED_SELLER : options.payee;

  const repository: CashSaleRepository = {
    async loadBuyer() {
      return buyer;
    },

    // --- Dispute resolution (0044) -----------------------------------------
    // Mirrors the SQL guards: only a DISPUTED sale with a NOT_DUE refund gets a
    // nonce, so a test can assert a retried resolution does not refund twice.
    async markRefundDue({ amountCents }) {
      if (!state.sale) return null;
      if (state.sale.status !== 'DISPUTED') return state.sale;
      if (state.sale.refundStatus !== 'NOT_DUE') return state.sale;
      state.sale = {
        ...state.sale,
        refundStatus: 'PENDING',
        refundCents: amountCents,
        refundNonce: state.sale.refundNonce ?? `refund:${state.sale.id}`,
      };
      return state.sale;
    },

    async recordRefundResult({ status, refundId, error }) {
      if (!state.sale) return null;
      state.sale = {
        ...state.sale,
        refundStatus: status,
        refundRef: refundId ?? state.sale.refundRef,
        refundAttempts: state.sale.refundAttempts + 1,
        ...(status === 'FAILED' && error ? {} : {}),
      };
      return state.sale;
    },

    async recordDisputeResolution({ outcome, resolvedBy, resolvedAt, status, returnDeadlineAt }) {
      if (!state.sale) return null;
      // Conditional on DISPUTED, matching the repository's `.eq('status', ...)`.
      if (state.sale.status !== 'DISPUTED') return null;
      state.sale = {
        ...state.sale,
        disputeResolution: outcome,
        disputeResolvedAt: resolvedAt,
        // Persisted rather than discarded: since 0084 a resolution can come from a
        // CONCEDING PARTY as well as from an operator, so "who decided this" is the
        // field that tells those two apart. The SQL repository has always written it.
        disputeResolvedBy: resolvedBy,
        status,
        ...(status === 'COMPLETED' ? { completedAt: resolvedAt } : {}),
        ...(status === 'RETURN_PENDING' && returnDeadlineAt
          ? { returnDeadlineAt }
          : {}),
      };
      return state.sale;
    },
    // Return-conditional refunds (0088). Each mirrors the guards its SQL counterpart
    // applies, so a test cannot pass on a transition the database would refuse.
    async recordReturnShipment({ carrier, trackingNumber, trackingUrl, trackingStatus, shippedAt }) {
      if (!state.sale) return null;
      if (state.sale.status !== 'RETURN_PENDING') return null;
      // Matches `.is('return_shipped_at', null)`: once only.
      if (state.sale.returnShippedAt) return null;
      state.sale = {
        ...state.sale,
        status: 'RETURN_IN_TRANSIT',
        returnTrackingCarrier: carrier,
        returnTrackingNumber: trackingNumber,
        returnTrackingUrl: trackingUrl,
        returnTrackingStatus: trackingStatus,
        returnShippedAt: shippedAt,
      };
      return state.sale;
    },
    async recordReturnFinalised() {
      if (!state.sale) return null;
      if (state.sale.status !== 'RETURN_IN_TRANSIT') return null;
      // Matches the SQL guards: carrier-confirmed and not contested.
      if (!state.sale.returnCarrierDeliveredAt) return null;
      if (state.sale.returnDisputedAt) return null;
      state.sale = { ...state.sale, status: 'REFUNDED' };
      return state.sale;
    },
    async recordReturnDispute({ reason, disputedAt }) {
      if (!state.sale) return null;
      if (state.sale.returnDisputedAt) return null;
      if (
        state.sale.status !== 'RETURN_PENDING' &&
        state.sale.status !== 'RETURN_IN_TRANSIT'
      ) {
        return null;
      }
      state.sale = {
        ...state.sale,
        returnDisputedAt: disputedAt,
        returnDisputeReason: reason,
      };
      return state.sale;
    },
    async listDuePayouts({ maxAttempts }) {
      const sale = state.sale;
      if (!sale) return [];
      const owed =
        sale.status === 'COMPLETED' &&
        (sale.sellerPayoutStatus === 'PENDING' || sale.sellerPayoutStatus === 'FAILED') &&
        sale.sellerPayoutAttempts < maxAttempts;
      return owed ? [sale.id] : [];
    },
    async listDueRefunds({ maxAttempts }) {
      const sale = state.sale;
      if (!sale) return [];
      // Mirrors the SQL predicate: a queued or failed refund with an amount and a
      // collection to refund against, regardless of the sale's own status — a partial
      // refund leaves it COMPLETED and a full one leaves it REFUNDED.
      const owed =
        (sale.refundStatus === 'PENDING' || sale.refundStatus === 'FAILED') &&
        (sale.refundCents ?? 0) > 0 &&
        Boolean(sale.transferId) &&
        (sale.refundAttempts ?? 0) < maxAttempts;
      return owed ? [sale.id] : [];
    },
    async markPayoutDue() {
      if (!state.sale) return null;
      if (state.sale.status !== 'COMPLETED') return state.sale;
      if (state.sale.sellerPayoutStatus !== 'NOT_DUE') return state.sale;
      // Mirrors the SQL: the nonce is assigned once and then never changes, so a
      // retry reuses it and the provider deduplicates.
      state.sale = {
        ...state.sale,
        sellerPayoutStatus: 'PENDING',
        sellerPayoutNonce: state.sale.sellerPayoutNonce ?? `payout:${state.sale.id}`,
      };
      return state.sale;
    },
    async recordPayoutResult({ status, transferId, error: _error }) {
      if (!state.sale) return null;
      state.sale = {
        ...state.sale,
        sellerPayoutStatus: status,
        sellerPayoutRef: transferId ?? state.sale.sellerPayoutRef,
        sellerPayoutAttempts: state.sale.sellerPayoutAttempts + 1,
      };
      return state.sale;
    },
    async loadSellerPayee() {
      return payee;
    },
    async findPayerRef({ merchantRef }) {
      return options.existingPayerRef ?? state.payerRefs[merchantRef] ?? null;
    },
    async savePayerRef({ merchantRef, payerId }) {
      state.payerRefs[merchantRef] = payerId;
    },
    async loadItem() {
      return state.item;
    },
    async createAgreement(params) {
      // Mirrors `create_cash_sale_agreement` after 0064: a SHOPFRONT is gated on
      // being open rather than AVAILABLE, and is never reserved, so the next
      // buyer can still contract against it.
      const shopfront = (state.item.listingKind ?? 'SINGLE') === 'SHOPFRONT';
      if (shopfront) {
        if (state.item.closedAt) return null;
      } else {
        if (state.item.status !== 'AVAILABLE') return null;
        state.item = { ...state.item, status: 'RESERVED' };
      }
      state.lineItems = (params.lineItems ?? []).map((line, index) => ({
        id: `line-${index + 1}`,
        description: line.description,
        condition: line.condition ?? null,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        imagePath: line.imagePath ?? null,
        sortOrder: index,
      }));
      state.sale = {
        id: 'sale-1',
        itemId: params.itemId,
        itemTitle: state.item.title ?? 'Test item',
        fromShopfront: shopfront,
        disputedBy: null,
        disputeResolution: null,
        disputeResolvedBy: null,
        disputeResolvedAt: null,
        refundCents: 0,
        refundStatus: 'NOT_DUE',
        refundRef: null,
        refundNonce: null,
        refundAttempts: 0,
        buyerId: params.buyerId,
        sellerId: params.sellerId,
        agreedPriceCents: params.agreedPriceCents,
        platformFeeCents: params.platformFeeCents,
        amountCents: params.agreedPriceCents + params.platformFeeCents,
        status: 'AGREEMENT',
        version: 1,
        transferId: null,
        paymentNonce: null,
        paymentRequestedAt: null,
        paymentSettledAt: null,
        fulfillmentMethod: null,
        shippingCostCents: 0,
        shippingNotes: null,
        deliveryAddressConfigured: false,
        meetingLocation: null,
        meetingLat: null,
        meetingLng: null,
        meetingPlaceId: null,
        meetingAt: null,
        termsVersion: 1,
        buyerTermsAcceptedVersion: null,
        sellerTermsAcceptedVersion: null,
        buyerTermsAcceptedAt: null,
        sellerTermsAcceptedAt: null,
        trackingCarrier: null,
        trackingNumber: null,
        trackingUrl: null,
        trackingStatus: null,
        shippedAt: null,
        receivedAt: null,
        inspectionAcceptedAt: null,
        carrierDeliveredAt: null,
        inspectionDeadlineAt: null,
        returnTrackingCarrier: null,
        returnTrackingNumber: null,
        returnTrackingUrl: null,
        returnTrackingStatus: null,
        returnShippedAt: null,
        returnCarrierDeliveredAt: null,
        returnDeadlineAt: null,
        returnWarnedAt: null,
        returnDisputedAt: null,
        returnDisputeReason: null,        autoCompleted: false,
        buyerHandoverConfirmedAt: null,
        sellerHandoverConfirmedAt: null,
        completedAt: null,
        conversationId: 'conversation-1',
        sellerIdentity: { sellerId: params.sellerId, ...IDENTITY },
        buyerSellerIdentityConfirmedAt: params.buyerSellerIdentityConfirmedAt,
        sellerPayoutStatus: 'NOT_DUE',
        sellerPayoutRef: null,
        sellerPayoutNonce: null,
        sellerPayoutAttempts: 0,
      };
      return state.sale;
    },
    async loadCashSale() {
      return state.sale;
    },
    async updateTerms({ expectedTermsVersion, terms }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'AGREEMENT') {
        return { ok: false as const, reason: 'STALE' as const };
      }
      if (sale.termsVersion !== expectedTermsVersion) {
        return { ok: false as const, reason: 'STALE' as const };
      }
      // The database trigger bumps the version and clears both acceptances.
      const { deliveryAddress, ...publicTerms } = terms;
      state.sale = {
        ...sale,
        ...publicTerms,
        deliveryAddressConfigured:
          terms.fulfillmentMethod === 'DELIVERY'
            ? Boolean(deliveryAddress) || sale.deliveryAddressConfigured
            : false,
        amountCents:
          sale.agreedPriceCents + sale.platformFeeCents + terms.shippingCostCents,
        termsVersion: sale.termsVersion + 1,
        version: sale.version + 1,
        buyerTermsAcceptedVersion: null,
        sellerTermsAcceptedVersion: null,
        buyerTermsAcceptedAt: null,
        sellerTermsAcceptedAt: null,
      };
      return { ok: true as const, sale: state.sale };
    },
    async updateAgreedPrice({ expectedTermsVersion, agreedPriceCents }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'AGREEMENT') return null;
      if (sale.termsVersion !== expectedTermsVersion) return null;
      // Matches the trigger: a price change bumps the version and clears ticks.
      // The percentage Platform_Fee is re-derived from the new price, mirroring
      // the Supabase repository.
      const feeCents = platformFeeCentsFor(agreedPriceCents);
      state.sale = {
        ...sale,
        agreedPriceCents,
        platformFeeCents: feeCents,
        amountCents: agreedPriceCents + feeCents + sale.shippingCostCents,
        termsVersion: sale.termsVersion + 1,
        version: sale.version + 1,
        buyerTermsAcceptedVersion: null,
        sellerTermsAcceptedVersion: null,
        buyerTermsAcceptedAt: null,
        sellerTermsAcceptedAt: null,
      };
      return state.sale;
    },
    async loadLineItems() {
      return state.lineItems;
    },
    async replaceLineItems({
      expectedTermsVersion,
      lineItems,
      agreedPriceCents,
      platformFeeCents,
    }) {
      const sale = state.sale;
      // Mirrors `replace_cash_sale_items`: participant, AGREEMENT, matching
      // version, and shopfront-only.
      if (!sale || sale.status !== 'AGREEMENT') return null;
      if (sale.termsVersion !== expectedTermsVersion) return null;
      if (!sale.fromShopfront) return null;
      if (lineItems.length === 0) return null;

      state.lineItems = lineItems.map((line, index) => ({
        id: `line-${index + 1}`,
        description: line.description,
        condition: line.condition ?? null,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        imagePath: line.imagePath ?? null,
        sortOrder: index,
      }));
      // The price write is what clears the ticks, exactly as the trigger does —
      // including when the new lines total the same, because the goods changed.
      state.sale = {
        ...sale,
        agreedPriceCents,
        platformFeeCents,
        amountCents: agreedPriceCents + platformFeeCents + sale.shippingCostCents,
        termsVersion: sale.termsVersion + 1,
        version: sale.version + 1,
        buyerTermsAcceptedVersion: null,
        sellerTermsAcceptedVersion: null,
        buyerTermsAcceptedAt: null,
        sellerTermsAcceptedAt: null,
      };
      return state.sale;
    },
    async acceptTerms({ actor, termsVersion, acceptedAt }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'AGREEMENT' || sale.termsVersion !== termsVersion) {
        return null;
      }
      state.sale =
        actor === 'BUYER'
          ? { ...sale, buyerTermsAcceptedVersion: termsVersion, buyerTermsAcceptedAt: acceptedAt }
          : { ...sale, sellerTermsAcceptedVersion: termsVersion, sellerTermsAcceptedAt: acceptedAt };
      return state.sale;
    },
    async claimPayment({ termsVersion, nonce, requestedAt }) {
      const sale = state.sale;
      if (
        !sale ||
        sale.status !== 'AGREEMENT' ||
        sale.termsVersion !== termsVersion ||
        sale.buyerTermsAcceptedVersion !== termsVersion ||
        sale.sellerTermsAcceptedVersion !== termsVersion ||
        sale.paymentNonce !== null
      ) {
        return null;
      }
      state.sale = {
        ...sale,
        status: 'PAYMENT_PENDING',
        paymentNonce: nonce,
        paymentRequestedAt: requestedAt,
      };
      return state.sale;
    },
    async recordPaymentSubmission({ transferId }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'PAYMENT_PENDING') return null;
      state.sale = { ...sale, transferId };
      return state.sale;
    },
    async failPayment({ transferId }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'PAYMENT_PENDING') return null;
      state.sale = {
        ...sale,
        status: 'FAILED',
        transferId: transferId ?? sale.transferId,
      };
      return state.sale;
    },
    async settlePayment({ settledAt }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'PAYMENT_PENDING' || !sale.fulfillmentMethod) {
        return null;
      }
      state.sale = {
        ...sale,
        status: sale.fulfillmentMethod === 'IN_PERSON' ? 'HANDOVER' : 'ESCROW_HELD',
        paymentSettledAt: settledAt,
      };
      return state.sale;
    },
    async recordShipment(params) {
      const sale = state.sale;
      if (!sale || sale.status !== 'ESCROW_HELD') return null;
      state.sale = {
        ...sale,
        status: 'IN_TRANSIT',
        trackingCarrier: params.carrier,
        trackingNumber: params.trackingNumber,
        trackingUrl: params.trackingUrl,
        trackingStatus: params.trackingStatus,
        shippedAt: params.shippedAt,
      };
      return state.sale;
    },
    async recordReceipt({ receivedAt }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'IN_TRANSIT') return null;
      state.sale = { ...sale, status: 'INSPECTION', receivedAt };
      return state.sale;
    },
    async applyTracking({ status, deliveredAt }) {
      const sale = state.sale;
      if (!sale) return null;
      if (status !== 'DELIVERED') {
        state.sale = { ...sale, trackingStatus: status };
        return state.sale;
      }
      const delivered = deliveredAt ?? new Date().toISOString();
      const deadline = new Date(
        new Date(delivered).getTime() + INSPECTION_WINDOW_DAYS * 86_400_000,
      ).toISOString();
      state.sale = {
        ...sale,
        trackingStatus: 'DELIVERED',
        carrierDeliveredAt: delivered,
        inspectionDeadlineAt: deadline,
        returnTrackingCarrier: null,
        returnTrackingNumber: null,
        returnTrackingUrl: null,
        returnTrackingStatus: null,
        returnShippedAt: null,
        returnCarrierDeliveredAt: null,
        returnDeadlineAt: null,
        returnWarnedAt: null,
        returnDisputedAt: null,
        returnDisputeReason: null,        ...(sale.status === 'IN_TRANSIT'
          ? { status: 'INSPECTION' as const, receivedAt: sale.receivedAt ?? delivered }
          : {}),
      };
      return state.sale;
    },
    async acceptInspection({ acceptedAt }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'INSPECTION') return null;
      state.sale = {
        ...sale,
        status: 'COMPLETED',
        inspectionAcceptedAt: acceptedAt,
        completedAt: acceptedAt,
      };
      return state.sale;
    },
    async confirmHandover({ actor, confirmedAt }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'HANDOVER') return null;
      const next =
        actor === 'BUYER'
          ? { ...sale, buyerHandoverConfirmedAt: confirmedAt }
          : { ...sale, sellerHandoverConfirmedAt: confirmedAt };
      state.sale =
        next.buyerHandoverConfirmedAt && next.sellerHandoverConfirmedAt
          ? { ...next, status: 'COMPLETED', completedAt: confirmedAt }
          : next;
      return state.sale;
    },
    async cancelAgreement({ cancelledAt }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'AGREEMENT') return null;
      state.sale = { ...sale, status: 'CANCELLED', completedAt: null };
      void cancelledAt;
      return state.sale;
    },
    async raiseDispute({ actorId, disputedAt }) {
      const sale = state.sale;
      // The four statuses the SQL `.in(...)` guard allows, not just INSPECTION — a
      // withdrawal has to restore whichever one the contract came from, so the fake
      // has to be able to reach them.
      const DISPUTABLE: CashSaleRecord['status'][] = [
        'INSPECTION',
        'IN_TRANSIT',
        'HANDOVER',
        'ESCROW_HELD',
      ];
      if (!sale || !DISPUTABLE.includes(sale.status)) return null;
      state.sale = { ...sale, status: 'DISPUTED', disputedBy: actorId };
      void disputedAt;
      return state.sale;
    },
    async disputeOriginStatus() {
      // Newest DISPUTE_RAISED wins, mirroring the `order(...).limit(1)` in SQL.
      for (let i = state.events.length - 1; i >= 0; i -= 1) {
        const entry = state.events[i];
        if (entry.event === 'DISPUTE_RAISED') return entry.fromStatus ?? null;
      }
      return null;
    },
    async withdrawDispute({ actorId, restoreStatus, withdrawnAt }) {
      const sale = state.sale;
      // Every guard the SQL update carries, so a test can prove the accused party and
      // a decided case are both refused.
      if (!sale) return null;
      if (sale.status !== 'DISPUTED') return null;
      if (sale.disputedBy !== actorId) return null;
      if (sale.disputeResolution) return null;
      state.sale = { ...sale, status: restoreStatus, disputedBy: null };
      void withdrawnAt;
      return state.sale;
    },
    async attachConversation() {
      const sale = state.sale;
      if (!sale) return null;
      state.sale = { ...sale, conversationId: sale.conversationId ?? 'conversation-1' };
      return state.sale;
    },
    async setItemStatus({ status }) {
      state.item = { ...state.item, status };
    },
    async logEvent({ event, actorId, fromStatus, toStatus }) {
      state.events.push({ event, actorId, fromStatus, toStatus });
    },
  };

  return { repository, state };
}

/** Payment service double recording transfer calls and their nonces. */
export function makePayments(
  options: {
    transferStatus?: 'SETTLED' | 'FAILED';
    payoutStatus?: 'SETTLED' | 'FAILED';
    refundStatus?: 'SETTLED' | 'FAILED';
  } = {},
) {
  const calls = {
    createPayer: [] as { profileId: string; email?: string }[],
    /**
     * Refunds back to the Buyer, recorded separately again: a refund spends money
     * the platform is holding, so a test needs to assert both the amount AND that
     * it happened exactly once.
     */
    refunds: [] as {
      paymentRef: string;
      amount?: number;
      nonce: string;
      ref?: string;
    }[],
    transfers: [] as {
      payerId: string;
      nonce: string;
      merchantRef?: string;
      applicationFee?: number;
      amount: number;
    }[],
    /**
     * Seller releases out of the platform balance, recorded SEPARATELY from
     * `transfers` on purpose: a release must never charge a payer, so a test that
     * conflated the two could not catch the Buyer being double-charged.
     */
    payouts: [] as {
      merchantRef: string;
      nonce: string;
      amount: number;
      sourcePaymentRef?: string;
    }[],
  };
  const payments = {
    // A payer is platform-scoped: no sub-merchant targeting and no card token,
    // both of which the previous provider required to pay a new sub-merchant.
    async createPayer(profileId: string, details?: { email?: string }) {
      calls.createPayer.push({ profileId, email: details?.email });
      return { payerId: 'payer_platform_new', profileId };
    },
    async requestTransfer(params: {
      payerId: string;
      amount: number;
      ref: string;
      nonce: string;
      merchantRef?: string;
      applicationFee?: number;
    }) {
      calls.transfers.push({
        payerId: params.payerId,
        nonce: params.nonce,
        merchantRef: params.merchantRef,
        applicationFee: params.applicationFee,
        amount: params.amount,
      });
      return {
        transferId: 'transfer-1',
        amount: params.amount,
        status: options.transferStatus ?? 'SETTLED',
      };
    },
    async refundPayment(params: {
      paymentRef: string;
      amount?: number;
      nonce: string;
      ref?: string;
    }) {
      calls.refunds.push({
        paymentRef: params.paymentRef,
        amount: params.amount,
        nonce: params.nonce,
        ref: params.ref,
      });
      const ok = (options.refundStatus ?? 'SETTLED') === 'SETTLED';
      return {
        refundId: ok ? 'refund-1' : '',
        amount: params.amount ?? 0,
        status: ok ? ('SETTLED' as const) : ('FAILED' as const),
        ...(ok ? {} : { reason: 'Refund failed to settle' }),
      };
    },
    async payoutToMerchant(params: {
      merchantRef: string;
      amount: number;
      ref: string;
      nonce: string;
      sourcePaymentRef?: string;
    }) {
      calls.payouts.push({
        merchantRef: params.merchantRef,
        nonce: params.nonce,
        amount: params.amount,
        sourcePaymentRef: params.sourcePaymentRef,
      });
      return {
        transferId: 'payout-1',
        amount: params.amount,
        status: options.payoutStatus ?? 'SETTLED',
      };
    },
  };
  return { payments, calls };
}

/** Deterministic tracking double. `fetchStatus` is opt-in per test. */
export function makeTracking(options: {
  status?: TrackingState;
  deliveredAt?: string;
  pollable?: boolean;
} = {}) {
  const service: TrackingService = {
    async registerShipment(input) {
      return {
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: `https://track.example/${input.trackingNumber}`,
        status: 'LABEL_CREATED',
      };
    },
  };
  if (options.pollable !== false) {
    service.fetchStatus = async (input) => ({
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      trackingUrl: `https://track.example/${input.trackingNumber}`,
      status: options.status ?? 'IN_TRANSIT',
      deliveredAt: options.deliveredAt ?? null,
    });
  }
  return service;
}

/** Default tracking double: registers shipments, no carrier polling. */
export const fakeTracking = makeTracking({ pollable: false });
