// tests/unit/fakes/cashSaleRepository.ts
// In-memory CashSaleRepository mirroring the SQL guards: expected-state updates,
// database-owned terms versioning, and single-winner nonce claiming.

import type {
  BuyerRecord,
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
  events: { event: string; actorId: string | null }[];
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
};

export const BUYER: BuyerRecord = {
  profileId: 'buyer-1',
  kycStatus: 'VERIFIED',
  payerId: 'payer_platform',
  paymentSourceId: 'src_saved',
  displayName: 'Buyer One',
  contactEmail: 'buyer@example.com',
  paymentToken: 'tkn_reusable',
  paymentTokenType: 'credit-card',
};

export const ITEM: ItemRecord = {
  id: 'item-1',
  ownerId: 'seller-1',
  fmvCents: 10_000,
  status: 'AVAILABLE',
  title: 'Charizard Base Set',
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
    events: [],
    payerRefs: {},
  };
  const buyer = options.buyer === undefined ? BUYER : options.buyer;
  const payee = options.payee === undefined ? APPROVED_SELLER : options.payee;

  const repository: CashSaleRepository = {
    async loadBuyer() {
      return buyer;
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
      if (state.item.status !== 'AVAILABLE') return null;
      state.item = { ...state.item, status: 'RESERVED' };
      state.sale = {
        id: 'sale-1',
        itemId: params.itemId,
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
        deliveryAddress: null,
        meetingLocation: null,
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
        autoCompleted: false,
        buyerHandoverConfirmedAt: null,
        sellerHandoverConfirmedAt: null,
        completedAt: null,
        conversationId: 'conversation-1',
        sellerIdentity: { sellerId: params.sellerId, ...IDENTITY },
        buyerSellerIdentityConfirmedAt: params.buyerSellerIdentityConfirmedAt,
      };
      return state.sale;
    },
    async loadCashSale() {
      return state.sale;
    },
    async updateTerms({ expectedTermsVersion, terms }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'AGREEMENT') return null;
      if (sale.termsVersion !== expectedTermsVersion) return null;
      // The database trigger bumps the version and clears both acceptances.
      state.sale = {
        ...sale,
        ...terms,
        amountCents:
          sale.agreedPriceCents + sale.platformFeeCents + terms.shippingCostCents,
        termsVersion: sale.termsVersion + 1,
        version: sale.version + 1,
        buyerTermsAcceptedVersion: null,
        sellerTermsAcceptedVersion: null,
        buyerTermsAcceptedAt: null,
        sellerTermsAcceptedAt: null,
      };
      return state.sale;
    },
    async updateAgreedPrice({ expectedTermsVersion, agreedPriceCents }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'AGREEMENT') return null;
      if (sale.termsVersion !== expectedTermsVersion) return null;
      // Matches the trigger: a price change bumps the version and clears ticks.
      state.sale = {
        ...sale,
        agreedPriceCents,
        amountCents: agreedPriceCents + sale.platformFeeCents + sale.shippingCostCents,
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
        ...(sale.status === 'IN_TRANSIT'
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
    async raiseDispute({ disputedAt }) {
      const sale = state.sale;
      if (!sale || sale.status !== 'INSPECTION') return null;
      state.sale = { ...sale, status: 'DISPUTED' };
      void disputedAt;
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
    async logEvent({ event, actorId }) {
      state.events.push({ event, actorId });
    },
  };

  return { repository, state };
}

/** Payment service double recording transfer calls and their nonces. */
export function makePayments(options: { transferStatus?: 'SETTLED' | 'FAILED' } = {}) {
  const calls = {
    createPayer: [] as { merchantRef?: string; token?: string }[],
    transfers: [] as {
      payerId: string;
      nonce: string;
      merchantRef?: string;
      applicationFee?: number;
      amount: number;
    }[],
  };
  const payments = {
    async createPayer(
      profileId: string,
      _details?: unknown,
      opts?: { merchantRef?: string; source?: { token: string } },
    ) {
      calls.createPayer.push({ merchantRef: opts?.merchantRef, token: opts?.source?.token });
      return { payerId: `payer_on_${opts?.merchantRef ?? 'platform'}`, profileId };
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
