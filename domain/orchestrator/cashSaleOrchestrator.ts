// domain/orchestrator/cashSaleOrchestrator.ts
//
// Bilateral Cash_Sale contract orchestration (Req 4). Buy Now creates an
// agreement and reserves the Item without charging. Versioned fulfillment terms
// require both participants' acceptance before an idempotent payment submission.
// Cleared funds then gate delivery or face-to-face handover.

import type { Cents, PaymentService } from '../services/types';
import type { TrackingService, TrackingState } from '../services/tracking/types';
import {
  canReceiveFunds,
  sellerIdentityDisclosure,
  type MerchantRecord,
  type SellerIdentityDisclosure,
} from './merchantOnboarding';

export type PayoutMode = 'platform' | 'direct';
export type ItemStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD';
export type KycStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
export type FulfillmentMethod = 'DELIVERY' | 'IN_PERSON';
export type CashSaleStatus =
  | 'AGREEMENT'
  | 'PAYMENT_PENDING'
  | 'ESCROW_HELD'
  | 'IN_TRANSIT'
  | 'HANDOVER'
  | 'INSPECTION'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED'
  | 'FAILED'
  | 'REFUNDED';

/**
 * Platform fee rate in basis points (1 bp = 0.01%), so 500 bp = 5% of the
 * agreed item price. Held in basis points rather than a float percentage so the
 * fee stays exact integer arithmetic end-to-end — no floating-point money.
 */
export const PLATFORM_FEE_BPS = 500;

/**
 * The Platform_Fee for a given agreed item price, in integer AUD cents (Req 4.7).
 *
 * The fee is charged on the item price only — shipping is a pass-through cost to
 * the carrier, not platform revenue, so it is excluded from the base. Rounded to
 * the nearest cent; a price of 0 yields a fee of 0.
 */
export function platformFeeCentsFor(agreedPriceCents: Cents): Cents {
  return Math.round((agreedPriceCents * PLATFORM_FEE_BPS) / 10_000);
}

export interface BuyerRecord {
  profileId: string;
  kycStatus: KycStatus;
  payerId: string | null;
  paymentSourceId: string | null;
  displayName?: string | null;
  contactEmail?: string | null;
  paymentToken?: string | null;
  paymentTokenType?: 'credit-card' | 'bank-account' | null;
}
export interface ItemRecord {
  id: string;
  ownerId: string;
  fmvCents: Cents;
  status: ItemStatus;
  title?: string;
  description?: string;
  condition?: string;
  imagePaths?: string[];
}

/** Persisted aggregate used by the pure orchestrator and UI boundary. */
export interface CashSaleRecord {
  id: string;
  itemId: string;
  buyerId: string;
  sellerId: string;
  amountCents: Cents;
  agreedPriceCents: Cents;
  platformFeeCents: Cents;
  status: CashSaleStatus;
  version: number;
  transferId: string | null;
  paymentNonce: string | null;
  paymentRequestedAt: string | null;
  paymentSettledAt: string | null;
  fulfillmentMethod: FulfillmentMethod | null;
  shippingCostCents: Cents;
  shippingNotes: string | null;
  deliveryAddress: string | null;
  meetingLocation: string | null;
  meetingAt: string | null;
  termsVersion: number;
  buyerTermsAcceptedVersion: number | null;
  sellerTermsAcceptedVersion: number | null;
  buyerTermsAcceptedAt: string | null;
  sellerTermsAcceptedAt: string | null;
  trackingCarrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  trackingStatus: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  inspectionAcceptedAt: string | null;
  /** Carrier-confirmed delivery instant; null until the provider confirms. */
  carrierDeliveredAt: string | null;
  /** When an untouched INSPECTION contract completes on its own. */
  inspectionDeadlineAt: string | null;
  autoCompleted: boolean;
  buyerHandoverConfirmedAt: string | null;
  sellerHandoverConfirmedAt: string | null;
  completedAt: string | null;
  conversationId: string | null;
  sellerIdentity: SellerIdentityDisclosure;
  buyerSellerIdentityConfirmedAt: string;
}

export type CashSaleError =
  | 'BUYER_NO_PAYMENT_METHOD'
  | 'BUYER_CONFIRMATION_REQUIRED'
  | 'SELLER_IDENTITY_UNVERIFIED'
  | 'SELLER_IDENTITY_CHANGED'
  | 'SELLER_NOT_PAYABLE'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_UNAVAILABLE'
  | 'SELF_PURCHASE'
  | 'TRANSFER_FAILED'
  | 'CASH_SALE_NOT_FOUND'
  | 'NOT_PARTICIPANT'
  | 'NOT_PERMITTED'
  | 'INVALID_TERMS'
  | 'STALE_TERMS'
  | 'ALREADY_RECORDED'
  | 'NOT_SUPPORTED'
  | 'INVALID_STATE';

export type CashSaleResult =
  | { ok: true; sale: CashSaleRecord }
  | { ok: false; error: CashSaleError; detail?: string };
export interface CreateCashSaleParams {
  itemId: string;
  buyerId: string;
  sellerId: string;
  agreedPriceCents: Cents;
  platformFeeCents: Cents;
  sellerIdentity: SellerIdentityDisclosure;
  buyerSellerIdentityConfirmedAt: string;
}

export interface CashSaleTermsInput {
  fulfillmentMethod: FulfillmentMethod;
  shippingCostCents?: Cents;
  shippingNotes?: string | null;
  deliveryAddress?: string | null;
  meetingLocation?: string | null;
  meetingAt?: string | null;
}

export interface ShipmentInput {
  carrier: string;
  trackingNumber: string;
}

/** Persistence seam; Supabase and tests supply concrete implementations. */
export interface CashSaleRepository {
  loadBuyer(buyerId: string): Promise<BuyerRecord | null>;
  loadSellerPayee(sellerId: string): Promise<MerchantRecord | null>;
  findPayerRef(params: { profileId: string; merchantRef: string }): Promise<string | null>;
  savePayerRef(params: {
    profileId: string;
    merchantRef: string;
    payerId: string;
  }): Promise<void>;
  loadItem(itemId: string): Promise<ItemRecord | null>;
  createAgreement(params: CreateCashSaleParams): Promise<CashSaleRecord | null>;
  loadCashSale(cashSaleId: string): Promise<CashSaleRecord | null>;
  updateTerms(params: {
    cashSaleId: string;
    expectedTermsVersion: number;
    terms: Required<CashSaleTermsInput>;
  }): Promise<CashSaleRecord | null>;
  /**
   * Renegotiate the agreed item price. The database clears both acceptances and
   * bumps the terms version, exactly as a fulfillment change does.
   */
  updateAgreedPrice(params: {
    cashSaleId: string;
    expectedTermsVersion: number;
    agreedPriceCents: Cents;
  }): Promise<CashSaleRecord | null>;
  acceptTerms(params: {
    cashSaleId: string;
    actor: 'BUYER' | 'SELLER';
    termsVersion: number;
    acceptedAt: string;
  }): Promise<CashSaleRecord | null>;
  claimPayment(params: {
    cashSaleId: string;
    termsVersion: number;
    nonce: string;
    requestedAt: string;
  }): Promise<CashSaleRecord | null>;
  recordPaymentSubmission(params: {
    cashSaleId: string;
    transferId: string;
  }): Promise<CashSaleRecord | null>;
  failPayment(params: { cashSaleId: string; transferId?: string }): Promise<CashSaleRecord | null>;
  settlePayment(params: { cashSaleId: string; settledAt: string }): Promise<CashSaleRecord | null>;
  recordShipment(params: {
    cashSaleId: string;
    carrier: string;
    trackingNumber: string;
    trackingUrl: string | null;
    trackingStatus: string;
    shippedAt: string;
  }): Promise<CashSaleRecord | null>;
  recordReceipt(params: { cashSaleId: string; receivedAt: string }): Promise<CashSaleRecord | null>;
  /**
   * Apply a carrier tracking state. A DELIVERED state moves IN_TRANSIT to
   * INSPECTION and sets the auto-completion deadline.
   */
  applyTracking(params: {
    cashSaleId: string;
    status: TrackingState;
    deliveredAt?: string | null;
  }): Promise<CashSaleRecord | null>;
  acceptInspection(params: { cashSaleId: string; acceptedAt: string }): Promise<CashSaleRecord | null>;
  confirmHandover(params: {
    cashSaleId: string;
    actor: 'BUYER' | 'SELLER';
    confirmedAt: string;
  }): Promise<CashSaleRecord | null>;
  cancelAgreement(params: {
    cashSaleId: string;
    actorId: string;
    reason: string | null;
    cancelledAt: string;
  }): Promise<CashSaleRecord | null>;
  raiseDispute(params: {
    cashSaleId: string;
    actorId: string;
    reason: string;
    disputedAt: string;
  }): Promise<CashSaleRecord | null>;
  /**
   * Resolve or create the participant-only conversation for a contract and link
   * it to the sale. Idempotent: repeated calls return the same conversation.
   */
  attachConversation(params: {
    cashSaleId: string;
    actorId: string;
  }): Promise<CashSaleRecord | null>;
  setItemStatus(params: { itemId: string; status: ItemStatus }): Promise<void>;
  logEvent(params: {
    cashSaleId: string;
    actorId: string | null;
    event: string;
    fromStatus: CashSaleStatus | null;
    toStatus: CashSaleStatus | null;
    detail?: string;
  }): Promise<void>;
}
export interface CashSaleOrchestratorDeps {
  repository: CashSaleRepository;
  payments: PaymentService;
  tracking: TrackingService;
  platformFeeCents?: Cents;
  payoutMode?: PayoutMode;
  now?: () => Date;
  createNonce?: () => string;
}

export interface InitiateCashSaleParams {
  buyerId: string;
  itemId: string;
  sellerIdentityVersion: string;
  buyerConfirmedSellerIdentity: boolean;
  agreedPriceCents?: Cents;
}

/**
 * Format integer cents as AUD for an audit/chat detail string. The domain stays
 * free of UI helpers, so this local formatter keeps `lib/format` out of it.
 */
function formatCents(cents: Cents): string {
  return `$${(Math.trunc(cents) / 100).toFixed(2)}`;
}

function currentIso(deps: CashSaleOrchestratorDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

function participantRole(
  sale: CashSaleRecord,
  actorId: string,
): 'BUYER' | 'SELLER' | null {
  if (sale.buyerId === actorId) return 'BUYER';
  if (sale.sellerId === actorId) return 'SELLER';
  return null;
}

function termsComplete(input: Required<CashSaleTermsInput>): boolean {
  if (input.fulfillmentMethod === 'DELIVERY') {
    return (
      Boolean(input.deliveryAddress?.trim()) &&
      Number.isInteger(input.shippingCostCents) &&
      input.shippingCostCents >= 0
    );
  }
  return Boolean(input.meetingLocation?.trim());
}

function normalizeTerms(input: CashSaleTermsInput): Required<CashSaleTermsInput> {
  return {
    fulfillmentMethod: input.fulfillmentMethod,
    shippingCostCents:
      input.fulfillmentMethod === 'DELIVERY'
        ? Math.trunc(input.shippingCostCents ?? 0)
        : 0,
    shippingNotes:
      input.fulfillmentMethod === 'DELIVERY'
        ? input.shippingNotes?.trim() || null
        : null,
    deliveryAddress:
      input.fulfillmentMethod === 'DELIVERY'
        ? input.deliveryAddress?.trim() || null
        : null,
    meetingLocation:
      input.fulfillmentMethod === 'IN_PERSON'
        ? input.meetingLocation?.trim() || null
        : null,
    meetingAt:
      input.fulfillmentMethod === 'IN_PERSON' ? input.meetingAt ?? null : null,
  };
}

/** Buy Now creates a reserved agreement; it does not submit payment. */
export async function initiateCashSale(
  deps: CashSaleOrchestratorDeps,
  params: InitiateCashSaleParams,
): Promise<CashSaleResult> {
  const buyer = await deps.repository.loadBuyer(params.buyerId);
  if (!buyer?.payerId || !buyer.paymentSourceId) {
    return {
      ok: false,
      error: 'BUYER_NO_PAYMENT_METHOD',
      detail: 'Add a payment method before starting an agreement.',
    };
  }

  const item = await deps.repository.loadItem(params.itemId);
  if (!item) return { ok: false, error: 'ITEM_NOT_FOUND' };
  if (item.ownerId === params.buyerId) return { ok: false, error: 'SELF_PURCHASE' };
  if (item.status !== 'AVAILABLE') return { ok: false, error: 'ITEM_UNAVAILABLE' };

  const payee = await deps.repository.loadSellerPayee(item.ownerId);
  const sellerIdentity = sellerIdentityDisclosure(payee);
  if (!sellerIdentity) return { ok: false, error: 'SELLER_IDENTITY_UNVERIFIED' };
  if (!params.buyerConfirmedSellerIdentity) {
    return { ok: false, error: 'BUYER_CONFIRMATION_REQUIRED' };
  }
  if (params.sellerIdentityVersion !== sellerIdentity.version) {
    return { ok: false, error: 'SELLER_IDENTITY_CHANGED' };
  }

  const agreedPriceCents = Math.trunc(params.agreedPriceCents ?? item.fmvCents);
  if (!Number.isInteger(agreedPriceCents) || agreedPriceCents <= 0) {
    return { ok: false, error: 'INVALID_TERMS', detail: 'The agreed price is invalid.' };
  }

  const sale = await deps.repository.createAgreement({
    itemId: item.id,
    buyerId: params.buyerId,
    sellerId: item.ownerId,
    agreedPriceCents,
    platformFeeCents: deps.platformFeeCents ?? platformFeeCentsFor(agreedPriceCents),
    sellerIdentity,
    buyerSellerIdentityConfirmedAt: currentIso(deps),
  });
  return sale ? { ok: true, sale } : { ok: false, error: 'ITEM_UNAVAILABLE' };
}
/** Edit fulfillment terms and clear both stale acceptances via the repository. */
export async function updateCashSaleTerms(
  deps: CashSaleOrchestratorDeps,
  params: {
    actorId: string;
    cashSaleId: string;
    expectedTermsVersion: number;
    terms: CashSaleTermsInput;
  },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (!participantRole(sale, params.actorId)) {
    return { ok: false, error: 'NOT_PARTICIPANT' };
  }
  if (sale.status !== 'AGREEMENT') return { ok: false, error: 'INVALID_STATE' };
  if (sale.termsVersion !== params.expectedTermsVersion) {
    return { ok: false, error: 'STALE_TERMS' };
  }

  const terms = normalizeTerms(params.terms);
  if (!termsComplete(terms)) {
    return { ok: false, error: 'INVALID_TERMS' };
  }
  if ((terms.deliveryAddress?.length ?? 0) > 1000) {
    return { ok: false, error: 'INVALID_TERMS', detail: 'Delivery address is too long.' };
  }

  const updated = await deps.repository.updateTerms({
    cashSaleId: sale.id,
    expectedTermsVersion: sale.termsVersion,
    terms,
  });
  if (!updated) return { ok: false, error: 'STALE_TERMS' };
  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: params.actorId,
    event: 'TERMS_UPDATED',
    fromStatus: sale.status,
    toStatus: updated.status,
    detail:
      terms.fulfillmentMethod === 'DELIVERY'
        ? `shipping for ${formatCents(terms.shippingCostCents)}`
        : `meeting in person at ${terms.meetingLocation}`,
  });
  return { ok: true, sale: updated };
}

/** Bounds for a renegotiated price, in integer AUD cents. */
const AGREED_PRICE_MIN = 1;
const AGREED_PRICE_MAX = 99_999_999_999;

/**
 * Propose a new agreed item price (Req 4.3). Allowed only while the contract is
 * still in AGREEMENT, and it invalidates both parties' acceptances.
 */
export async function proposeCashSalePrice(
  deps: CashSaleOrchestratorDeps,
  params: {
    actorId: string;
    cashSaleId: string;
    expectedTermsVersion: number;
    agreedPriceCents: Cents;
  },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (!participantRole(sale, params.actorId)) {
    return { ok: false, error: 'NOT_PARTICIPANT' };
  }
  if (sale.status !== 'AGREEMENT') return { ok: false, error: 'INVALID_STATE' };
  if (sale.termsVersion !== params.expectedTermsVersion) {
    return { ok: false, error: 'STALE_TERMS' };
  }

  const price = Math.trunc(params.agreedPriceCents);
  if (!Number.isInteger(price) || price < AGREED_PRICE_MIN || price > AGREED_PRICE_MAX) {
    return { ok: false, error: 'INVALID_TERMS', detail: 'Enter a valid price.' };
  }

  const updated = await deps.repository.updateAgreedPrice({
    cashSaleId: sale.id,
    expectedTermsVersion: sale.termsVersion,
    agreedPriceCents: price,
  });
  if (!updated) return { ok: false, error: 'STALE_TERMS' };

  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: params.actorId,
    event: 'PRICE_PROPOSED',
    fromStatus: sale.status,
    toStatus: updated.status,
    detail: `item price set to ${formatCents(price)}`,
  });
  return { ok: true, sale: updated };
}

async function resolvePaymentPayer(
  deps: CashSaleOrchestratorDeps,
  sale: CashSaleRecord,
  buyer: BuyerRecord,
  payee: MerchantRecord | null,
): Promise<{ payerId: string; merchantRef?: string } | null> {
  if ((deps.payoutMode ?? 'platform') !== 'direct') {
    return buyer.payerId ? { payerId: buyer.payerId } : null;
  }
  if (!canReceiveFunds(payee)) return null;
  const merchantRef = payee!.merchantRef!;
  const existing = await deps.repository.findPayerRef({
    profileId: buyer.profileId,
    merchantRef,
  });
  if (existing) return { payerId: existing, merchantRef };
  if (!buyer.paymentToken) return null;

  const payer = await deps.payments.createPayer(
    buyer.profileId,
    {
      displayName: buyer.displayName ?? undefined,
      email: buyer.contactEmail ?? undefined,
    },
    {
      merchantRef,
      source: {
        token: buyer.paymentToken,
        sourceType: buyer.paymentTokenType ?? 'credit-card',
      },
    },
  );
  await deps.repository.savePayerRef({
    profileId: buyer.profileId,
    merchantRef,
    payerId: payer.payerId,
  });
  return { payerId: payer.payerId, merchantRef };
}

async function submitClaimedPayment(
  deps: CashSaleOrchestratorDeps,
  sale: CashSaleRecord,
): Promise<CashSaleResult> {
  const buyer = await deps.repository.loadBuyer(sale.buyerId);
  if (!buyer?.payerId || !buyer.paymentSourceId) {
    await deps.repository.failPayment({ cashSaleId: sale.id });
    await deps.repository.setItemStatus({ itemId: sale.itemId, status: 'AVAILABLE' });
    return { ok: false, error: 'BUYER_NO_PAYMENT_METHOD' };
  }

  const payee = await deps.repository.loadSellerPayee(sale.sellerId);
  const identity = sellerIdentityDisclosure(payee);
  if (!identity || identity.version !== sale.sellerIdentity.version) {
    await deps.repository.failPayment({ cashSaleId: sale.id });
    await deps.repository.setItemStatus({ itemId: sale.itemId, status: 'AVAILABLE' });
    return { ok: false, error: 'SELLER_IDENTITY_CHANGED' };
  }
  if ((deps.payoutMode ?? 'platform') === 'direct' && !canReceiveFunds(payee)) {
    await deps.repository.failPayment({ cashSaleId: sale.id });
    await deps.repository.setItemStatus({ itemId: sale.itemId, status: 'AVAILABLE' });
    return { ok: false, error: 'SELLER_NOT_PAYABLE' };
  }

  let target: { payerId: string; merchantRef?: string } | null;
  try {
    target = await resolvePaymentPayer(deps, sale, buyer, payee);
  } catch (error) {
    await deps.repository.failPayment({ cashSaleId: sale.id });
    await deps.repository.setItemStatus({ itemId: sale.itemId, status: 'AVAILABLE' });
    return {
      ok: false,
      error: 'TRANSFER_FAILED',
      detail: error instanceof Error ? error.message : 'Could not prepare payment.',
    };
  }
  if (!target || !sale.paymentNonce) return { ok: false, error: 'TRANSFER_FAILED' };

  const transfer = await deps.payments.requestTransfer({
    payerId: target.payerId,
    amount: sale.amountCents,
    ref: `cash-sale:${sale.id}`,
    nonce: sale.paymentNonce,
    ...(target.merchantRef
      ? {
          merchantRef: target.merchantRef,
          applicationFee: sale.platformFeeCents,
        }
      : {}),
  });

  if (transfer.status === 'FAILED') {
    const failed = await deps.repository.failPayment({
      cashSaleId: sale.id,
      transferId: transfer.transferId || undefined,
    });
    await deps.repository.setItemStatus({ itemId: sale.itemId, status: 'AVAILABLE' });
    await deps.repository.logEvent({
      cashSaleId: sale.id,
      actorId: null,
      event: 'PAYMENT_FAILED',
      fromStatus: 'PAYMENT_PENDING',
      toStatus: 'FAILED',
    });
    return {
      ok: false,
      error: 'TRANSFER_FAILED',
      detail: failed?.id ?? sale.id,
    };
  }
  const submitted = await deps.repository.recordPaymentSubmission({
    cashSaleId: sale.id,
    transferId: transfer.transferId,
  });
  return { ok: true, sale: submitted ?? sale };
}
/** Record one party's acceptance; the second acceptance claims and submits payment. */
export async function acceptCashSaleTerms(
  deps: CashSaleOrchestratorDeps,
  params: { actorId: string; cashSaleId: string; termsVersion: number },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  const actor = participantRole(sale, params.actorId);
  if (!actor) return { ok: false, error: 'NOT_PARTICIPANT' };
  if (sale.status !== 'AGREEMENT') return { ok: false, error: 'INVALID_STATE' };
  if (!sale.fulfillmentMethod) return { ok: false, error: 'INVALID_TERMS' };
  if (sale.termsVersion !== params.termsVersion) {
    return { ok: false, error: 'STALE_TERMS' };
  }
  if (
    (actor === 'BUYER' && sale.buyerTermsAcceptedVersion === sale.termsVersion) ||
    (actor === 'SELLER' && sale.sellerTermsAcceptedVersion === sale.termsVersion)
  ) {
    return { ok: false, error: 'ALREADY_RECORDED' };
  }

  const accepted = await deps.repository.acceptTerms({
    cashSaleId: sale.id,
    actor,
    termsVersion: sale.termsVersion,
    acceptedAt: currentIso(deps),
  });
  if (!accepted) return { ok: false, error: 'STALE_TERMS' };

  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: params.actorId,
    event: 'TERMS_ACCEPTED',
    fromStatus: sale.status,
    toStatus: accepted.status,
    detail: `${actor} accepted terms v${sale.termsVersion}`,
  });

  const bothAccepted =
    accepted.buyerTermsAcceptedVersion === accepted.termsVersion &&
    accepted.sellerTermsAcceptedVersion === accepted.termsVersion;
  if (!bothAccepted) return { ok: true, sale: accepted };

  const nonce =
    deps.createNonce?.() ?? `cash-sale:${sale.id}:terms:${sale.termsVersion}`;
  const claimed = await deps.repository.claimPayment({
    cashSaleId: sale.id,
    termsVersion: sale.termsVersion,
    nonce,
    requestedAt: currentIso(deps),
  });
  if (!claimed) {
    const current = await deps.repository.loadCashSale(sale.id);
    return current ? { ok: true, sale: current } : { ok: false, error: 'INVALID_STATE' };
  }

  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: params.actorId,
    event: 'PAYMENT_REQUESTED',
    fromStatus: 'AGREEMENT',
    toStatus: 'PAYMENT_PENDING',
    detail: `Terms v${sale.termsVersion} accepted by both parties.`,
  });
  return submitClaimedPayment(deps, claimed);
}

/** Provider settlement unlocks fulfillment; it does not complete the sale. */
export async function settleCashSale(
  deps: CashSaleOrchestratorDeps,
  params: { cashSaleId: string },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (sale.status !== 'PAYMENT_PENDING') {
    return { ok: false, error: 'INVALID_STATE', detail: sale.status };
  }
  const settled = await deps.repository.settlePayment({
    cashSaleId: sale.id,
    settledAt: currentIso(deps),
  });
  if (!settled) return { ok: false, error: 'INVALID_STATE' };
  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: null,
    event: 'PAYMENT_CLEARED',
    fromStatus: sale.status,
    toStatus: settled.status,
  });
  return { ok: true, sale: settled };
}

/** Provider failure releases the reserved Item. */
export async function failCashSale(
  deps: CashSaleOrchestratorDeps,
  params: { cashSaleId: string },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (sale.status !== 'PAYMENT_PENDING') {
    return { ok: false, error: 'INVALID_STATE', detail: sale.status };
  }
  const failed = await deps.repository.failPayment({ cashSaleId: sale.id });
  if (!failed) return { ok: false, error: 'INVALID_STATE' };
  await deps.repository.setItemStatus({ itemId: sale.itemId, status: 'AVAILABLE' });
  return { ok: true, sale: failed };
}
export async function recordCashSaleShipment(
  deps: CashSaleOrchestratorDeps,
  params: { actorId: string; cashSaleId: string; shipment: ShipmentInput },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (sale.sellerId !== params.actorId) return { ok: false, error: 'NOT_PERMITTED' };
  if (sale.status !== 'ESCROW_HELD' || sale.fulfillmentMethod !== 'DELIVERY') {
    return { ok: false, error: 'INVALID_STATE' };
  }
  if (!params.shipment.carrier.trim() || params.shipment.trackingNumber.trim().length < 2) {
    return { ok: false, error: 'INVALID_TERMS', detail: 'Carrier and tracking number are required.' };
  }
  const tracking = await deps.tracking.registerShipment(params.shipment);
  const updated = await deps.repository.recordShipment({
    cashSaleId: sale.id,
    carrier: tracking.carrier,
    trackingNumber: tracking.trackingNumber,
    trackingUrl: tracking.trackingUrl,
    trackingStatus: tracking.status,
    shippedAt: currentIso(deps),
  });
  if (!updated) return { ok: false, error: 'INVALID_STATE' };
  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: params.actorId,
    event: 'SHIPMENT_RECORDED',
    fromStatus: sale.status,
    toStatus: updated.status,
    detail: `${tracking.carrier} ${tracking.trackingNumber}`,
  });
  return { ok: true, sale: updated };
}

export async function recordCashSaleReceipt(
  deps: CashSaleOrchestratorDeps,
  params: { actorId: string; cashSaleId: string },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (sale.buyerId !== params.actorId) return { ok: false, error: 'NOT_PERMITTED' };
  if (sale.status !== 'IN_TRANSIT') return { ok: false, error: 'INVALID_STATE' };
  const updated = await deps.repository.recordReceipt({
    cashSaleId: sale.id,
    receivedAt: currentIso(deps),
  });
  if (!updated) return { ok: false, error: 'INVALID_STATE' };
  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: params.actorId,
    event: 'RECEIPT_RECORDED',
    fromStatus: sale.status,
    toStatus: updated.status,
  });
  return { ok: true, sale: updated };
}

/**
 * Refresh a shipment from the carrier (Req 4.13, 4.14a).
 *
 * A carrier-confirmed DELIVERED state is what starts the inspection clock — the
 * seller's own word never does — after which the contract auto-completes unless
 * the buyer accepts or disputes first.
 */
export async function syncCashSaleTracking(
  deps: CashSaleOrchestratorDeps,
  params: { actorId: string; cashSaleId: string },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (!participantRole(sale, params.actorId)) {
    return { ok: false, error: 'NOT_PARTICIPANT' };
  }
  if (!sale.trackingCarrier || !sale.trackingNumber) {
    return { ok: false, error: 'INVALID_STATE', detail: 'No shipment to track yet.' };
  }
  if (!deps.tracking.fetchStatus) {
    return {
      ok: false,
      error: 'NOT_SUPPORTED',
      detail: 'Automated tracking is not configured for this carrier.',
    };
  }

  const snapshot = await deps.tracking.fetchStatus({
    carrier: sale.trackingCarrier,
    trackingNumber: sale.trackingNumber,
  });
  if (!snapshot) {
    return { ok: false, error: 'NOT_SUPPORTED', detail: 'The carrier returned no status.' };
  }
  if (snapshot.status === sale.trackingStatus && snapshot.status !== 'DELIVERED') {
    return { ok: true, sale };
  }

  const updated = await deps.repository.applyTracking({
    cashSaleId: sale.id,
    status: snapshot.status,
    deliveredAt: snapshot.deliveredAt ?? null,
  });
  return updated ? { ok: true, sale: updated } : { ok: false, error: 'INVALID_STATE' };
}

export async function acceptCashSaleInspection(
  deps: CashSaleOrchestratorDeps,
  params: { actorId: string; cashSaleId: string },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (sale.buyerId !== params.actorId) return { ok: false, error: 'NOT_PERMITTED' };
  if (sale.status !== 'INSPECTION') return { ok: false, error: 'INVALID_STATE' };
  const updated = await deps.repository.acceptInspection({
    cashSaleId: sale.id,
    acceptedAt: currentIso(deps),
  });
  if (!updated) return { ok: false, error: 'INVALID_STATE' };
  await deps.repository.setItemStatus({ itemId: sale.itemId, status: 'SOLD' });
  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: params.actorId,
    event: 'INSPECTION_ACCEPTED',
    fromStatus: sale.status,
    toStatus: updated.status,
  });
  return { ok: true, sale: updated };
}

export async function confirmCashSaleHandover(
  deps: CashSaleOrchestratorDeps,
  params: { actorId: string; cashSaleId: string },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  const actor = participantRole(sale, params.actorId);
  if (!actor) return { ok: false, error: 'NOT_PARTICIPANT' };
  if (sale.status !== 'HANDOVER' || sale.fulfillmentMethod !== 'IN_PERSON') {
    return { ok: false, error: 'INVALID_STATE' };
  }
  if (
    (actor === 'BUYER' && sale.buyerHandoverConfirmedAt) ||
    (actor === 'SELLER' && sale.sellerHandoverConfirmedAt)
  ) {
    return { ok: false, error: 'ALREADY_RECORDED' };
  }
  const updated = await deps.repository.confirmHandover({
    cashSaleId: sale.id,
    actor,
    confirmedAt: currentIso(deps),
  });
  if (!updated) return { ok: false, error: 'INVALID_STATE' };
  if (updated.status === 'COMPLETED') {
    await deps.repository.setItemStatus({ itemId: sale.itemId, status: 'SOLD' });
  }
  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: params.actorId,
    event: 'HANDOVER_CONFIRMED',
    fromStatus: sale.status,
    toStatus: updated.status,
  });
  return { ok: true, sale: updated };
}
/**
 * Ensure the contract has its participant chat (Req 4.2). Contracts opened
 * before the conversation link existed are repaired on first view.
 */
export async function ensureCashSaleConversation(
  deps: CashSaleOrchestratorDeps,
  params: { actorId: string; cashSaleId: string },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (!participantRole(sale, params.actorId)) {
    return { ok: false, error: 'NOT_PARTICIPANT' };
  }
  if (sale.conversationId) return { ok: true, sale };

  const attached = await deps.repository.attachConversation({
    cashSaleId: sale.id,
    actorId: params.actorId,
  });
  return attached
    ? { ok: true, sale: attached }
    : { ok: false, error: 'INVALID_STATE', detail: 'Chat could not be opened.' };
}

export async function cancelCashSaleAgreement(
  deps: CashSaleOrchestratorDeps,
  params: { actorId: string; cashSaleId: string; reason?: string },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (!participantRole(sale, params.actorId)) return { ok: false, error: 'NOT_PARTICIPANT' };
  if (sale.status !== 'AGREEMENT') return { ok: false, error: 'INVALID_STATE' };
  const reason = params.reason?.trim() || null;
  if ((reason?.length ?? 0) > 500) return { ok: false, error: 'INVALID_TERMS' };
  const updated = await deps.repository.cancelAgreement({
    cashSaleId: sale.id,
    actorId: params.actorId,
    reason,
    cancelledAt: currentIso(deps),
  });
  if (!updated) return { ok: false, error: 'INVALID_STATE' };
  await deps.repository.setItemStatus({ itemId: sale.itemId, status: 'AVAILABLE' });
  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: params.actorId,
    event: 'CANCELLED',
    fromStatus: sale.status,
    toStatus: updated.status,
    ...(reason ? { detail: reason } : {}),
  });
  return { ok: true, sale: updated };
}

export async function disputeCashSale(
  deps: CashSaleOrchestratorDeps,
  params: { actorId: string; cashSaleId: string; reason: string },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (!participantRole(sale, params.actorId)) return { ok: false, error: 'NOT_PARTICIPANT' };
  // Disputes are valid during active fulfillment: IN_TRANSIT (lost/damaged in
  // shipping), HANDOVER (in-person handover failed), or INSPECTION (item
  // received but condition dispute).
  const DISPUTABLE_STATUSES = new Set(['INSPECTION', 'IN_TRANSIT', 'HANDOVER', 'ESCROW_HELD']);
  if (!DISPUTABLE_STATUSES.has(sale.status)) return { ok: false, error: 'INVALID_STATE' };
  const reason = params.reason.trim();
  if (!reason || reason.length > 1000) return { ok: false, error: 'INVALID_TERMS' };
  const updated = await deps.repository.raiseDispute({
    cashSaleId: sale.id,
    actorId: params.actorId,
    reason,
    disputedAt: currentIso(deps),
  });
  if (!updated) return { ok: false, error: 'INVALID_STATE' };
  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: params.actorId,
    event: 'DISPUTE_RAISED',
    fromStatus: sale.status,
    toStatus: updated.status,
    detail: reason,
  });
  return { ok: true, sale: updated };
}

export interface CashSaleOrchestrator {
  initiateCashSale(params: InitiateCashSaleParams): Promise<CashSaleResult>;
  updateTerms(params: {
    actorId: string;
    cashSaleId: string;
    expectedTermsVersion: number;
    terms: CashSaleTermsInput;
  }): Promise<CashSaleResult>;
  proposePrice(params: {
    actorId: string;
    cashSaleId: string;
    expectedTermsVersion: number;
    agreedPriceCents: Cents;
  }): Promise<CashSaleResult>;
  acceptTerms(params: {
    actorId: string;
    cashSaleId: string;
    termsVersion: number;
  }): Promise<CashSaleResult>;
  settleCashSale(params: { cashSaleId: string }): Promise<CashSaleResult>;
  failCashSale(params: { cashSaleId: string }): Promise<CashSaleResult>;
  ensureConversation(params: {
    actorId: string;
    cashSaleId: string;
  }): Promise<CashSaleResult>;
  recordShipment(params: {
    actorId: string;
    cashSaleId: string;
    shipment: ShipmentInput;
  }): Promise<CashSaleResult>;
  recordReceipt(params: { actorId: string; cashSaleId: string }): Promise<CashSaleResult>;
  syncTracking(params: { actorId: string; cashSaleId: string }): Promise<CashSaleResult>;
  acceptInspection(params: { actorId: string; cashSaleId: string }): Promise<CashSaleResult>;
  confirmHandover(params: { actorId: string; cashSaleId: string }): Promise<CashSaleResult>;
  cancelAgreement(params: {
    actorId: string;
    cashSaleId: string;
    reason?: string;
  }): Promise<CashSaleResult>;
  raiseDispute(params: {
    actorId: string;
    cashSaleId: string;
    reason: string;
  }): Promise<CashSaleResult>;
}

/** Bind the pure lifecycle operations to injected services. */
export function createCashSaleOrchestrator(
  deps: CashSaleOrchestratorDeps,
): CashSaleOrchestrator {
  return {
    initiateCashSale: (params) => initiateCashSale(deps, params),
    updateTerms: (params) => updateCashSaleTerms(deps, params),
    proposePrice: (params) => proposeCashSalePrice(deps, params),
    acceptTerms: (params) => acceptCashSaleTerms(deps, params),
    settleCashSale: (params) => settleCashSale(deps, params),
    failCashSale: (params) => failCashSale(deps, params),
    ensureConversation: (params) => ensureCashSaleConversation(deps, params),
    recordShipment: (params) => recordCashSaleShipment(deps, params),
    recordReceipt: (params) => recordCashSaleReceipt(deps, params),
    syncTracking: (params) => syncCashSaleTracking(deps, params),
    acceptInspection: (params) => acceptCashSaleInspection(deps, params),
    confirmHandover: (params) => confirmCashSaleHandover(deps, params),
    cancelAgreement: (params) => cancelCashSaleAgreement(deps, params),
    raiseDispute: (params) => disputeCashSale(deps, params),
  };
}
