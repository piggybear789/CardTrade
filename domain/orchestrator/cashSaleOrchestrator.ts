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
  // `kycStatus` used to be carried here. It was selected, threaded through, and
  // never compared to anything — the documented buyer verification gate did not
  // actually exist. A cash Buyer needs a payment method, not payout onboarding, so
  // there is deliberately no verification field on this record.
  payerId: string | null;
  paymentSourceId: string | null;
  displayName?: string | null;
  contactEmail?: string | null;
  /**
   * Instrument kind behind `paymentSourceId`, for display only. The reusable
   * card token that used to sit alongside it is gone: it existed solely so a
   * payer could be minted on a new sub-merchant, which platform-scoped Stripe
   * Customers make unnecessary.
   */
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
  /**
   * Item title as snapshotted onto the contract. Needed so a payout notification
   * can name what was sold without the notifier re-reading the Item, which may
   * since have been edited or delisted.
   */
  itemTitle: string;
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
  meetingLat: number | null;
  meetingLng: number | null;
  meetingPlaceId: string | null;
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
  /** Release leg of escrow (Req 4.3). See {@link CashSalePayoutStatus}. */
  sellerPayoutStatus: CashSalePayoutStatus;
  /** Provider transfer id once the Seller has been paid. */
  sellerPayoutRef: string | null;
  /**
   * Persisted idempotency key for the release. Assigned once when the payout
   * falls due and reused on every retry, so an ambiguous timeout cannot pay the
   * Seller twice out of platform funds.
   */
  sellerPayoutNonce: string | null;
  sellerPayoutAttempts: number;
  /** Operator decision on a dispute, or `null` while none has been made. */
  disputeResolution: CashSaleDisputeOutcome | null;
  disputeResolvedAt: string | null;
  /** Amount returned to the Buyer, in cents. Subtracted from the Seller release. */
  refundCents: Cents;
  refundStatus: CashSalePayoutStatus;
  refundRef: string | null;
  /**
   * Persisted idempotency key for the refund. Same rule as the payout nonce, and
   * for a sharper reason: a duplicated refund spends the PLATFORM's money, since
   * the Buyer was only ever debited once.
   */
  refundNonce: string | null;
  refundAttempts: number;
}

/**
 * How an operator resolved a Cash_Sale dispute.
 *
 * - `REFUND_BUYER`   — full refund; the sale ends REFUNDED and the item returns to
 *   the catalog so the Seller can relist.
 * - `PARTIAL_REFUND` — the Buyer keeps the item at a reduced price; the sale
 *   completes and the Seller is released the remainder. The cash-sale analogue of
 *   the trade Friction_Tax.
 * - `RELEASE_SELLER` — dispute not upheld; the sale completes and the Seller is
 *   released in full.
 */
export type CashSaleDisputeOutcome = 'REFUND_BUYER' | 'PARTIAL_REFUND' | 'RELEASE_SELLER';

/**
 * How many times a Seller release is retried automatically before it is left for
 * an operator. Bounded for the same reason as the Full_Capture retries (Req 8.6):
 * an unbounded retry loop against a provider that keeps refusing is just a slow
 * way to hide a problem.
 */
export const MAX_PAYOUT_ATTEMPTS = 8;

/**
 * State of the Seller release for a Cash_Sale.
 *
 * `FAILED` is operationally significant: the Buyer has been debited and the
 * platform is holding money that belongs to the Seller.
 */
export type CashSalePayoutStatus = 'NOT_DUE' | 'PENDING' | 'SETTLED' | 'FAILED';

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
  | 'INVALID_STATE'
  /** The Seller release could not be settled; platform is holding their funds. */
  | 'PAYOUT_FAILED'
  /** A dispute refund was rejected by the provider; the sale stays DISPUTED. */
  | 'REFUND_FAILED'
  /** A PARTIAL_REFUND amount was zero, negative, or the whole collected amount. */
  | 'INVALID_REFUND_AMOUNT'
  /** Resolution needs a refund but nothing was ever collected from the Buyer. */
  | 'NOTHING_TO_REFUND';

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
  meetingLat?: number | null;
  meetingLng?: number | null;
  meetingPlaceId?: string | null;
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
  /**
   * Queue the Seller release for a COMPLETED sale, assigning the stable payout
   * nonce. Idempotent: only a NOT_DUE sale transitions.
   */
  markPayoutDue(cashSaleId: string): Promise<CashSaleRecord | null>;
  /**
   * Cash_Sale ids with a release still owed, oldest first.
   *
   * Excludes anything past {@link MAX_PAYOUT_ATTEMPTS} so a permanently broken
   * release stops consuming retries and waits for an operator instead.
   */
  listDuePayouts(params: { limit: number; maxAttempts: number }): Promise<string[]>;
  /** Record the outcome of a release attempt (Req 4.3, 4.4). */
  recordPayoutResult(params: {
    cashSaleId: string;
    status: CashSalePayoutStatus;
    transferId?: string;
    error?: string;
  }): Promise<CashSaleRecord | null>;
  /**
   * Queue a dispute refund, assigning the stable nonce. Idempotent: only a
   * DISPUTED sale with a NOT_DUE refund transitions (Req 4.15).
   */
  markRefundDue(params: {
    cashSaleId: string;
    amountCents: Cents;
  }): Promise<CashSaleRecord | null>;
  /** Record the outcome of a refund attempt (Req 4.15). */
  recordRefundResult(params: {
    cashSaleId: string;
    status: CashSalePayoutStatus;
    refundId?: string;
    error?: string;
  }): Promise<CashSaleRecord | null>;
  /**
   * Persist the operator's decision and the resulting terminal status. Only a
   * DISPUTED sale transitions, so a concurrent second resolution is a no-op.
   */
  recordDisputeResolution(params: {
    cashSaleId: string;
    outcome: CashSaleDisputeOutcome;
    resolvedBy: string;
    resolvedAt: string;
    status: 'COMPLETED' | 'REFUNDED';
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
/**
 * Why a release could not be sent, in the member-safe form a notification uses.
 *
 * `NOT_PAYABLE` is the only cause the Seller can resolve themselves, which is why
 * it is distinguished here rather than collapsed into a generic failure.
 */
export type PayoutNotifyCause = 'NOT_PAYABLE' | 'PROVIDER_REJECTED';

/**
 * Side-channel for telling a Seller their money moved (Req 9).
 *
 * Injected rather than imported so this module stays pure and Node-testable:
 * `createNotification` is `server-only` and would drag Supabase into the domain
 * layer. Implementations MUST be best-effort and never throw — a failed
 * notification must not change a release outcome (Req 9.5).
 */
export interface PayoutNotifier {
  releaseSettled(params: {
    sellerId: string;
    cashSaleId: string;
    itemTitle: string;
    netCents: Cents;
  }): Promise<void>;
  releaseFailed(params: {
    sellerId: string;
    cashSaleId: string;
    itemTitle: string;
    cause: PayoutNotifyCause;
  }): Promise<void>;
  /**
   * Tell BOTH parties how a dispute was decided.
   *
   * Both, not just the winner: a decision that moves money is something each side
   * needs to be able to reconcile, and a Buyer who is told nothing after raising a
   * dispute has no way to know it was even looked at.
   */
  disputeResolved(params: {
    buyerId: string;
    sellerId: string;
    cashSaleId: string;
    itemTitle: string;
    outcome: CashSaleDisputeOutcome;
    refundCents: Cents;
    sellerNetCents: Cents;
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
  /** Optional; when absent no payout notifications are emitted. */
  notifier?: PayoutNotifier;
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
    meetingLat:
      input.fulfillmentMethod === 'IN_PERSON' ? normalizeCoord(input.meetingLat) : null,
    meetingLng:
      input.fulfillmentMethod === 'IN_PERSON' ? normalizeCoord(input.meetingLng) : null,
    meetingPlaceId:
      input.fulfillmentMethod === 'IN_PERSON'
        ? input.meetingPlaceId?.trim() || null
        : null,
    meetingAt:
      input.fulfillmentMethod === 'IN_PERSON' ? input.meetingAt ?? null : null,
  };
}

function normalizeCoord(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
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

  // The buyer's own payer serves any payee. The previous provider scoped payers
  // to the merchant they were created under, so paying a newly-onboarded seller
  // meant minting a SECOND payer on that sub-merchant and re-attaching a stored
  // reusable card token. A Stripe Customer is platform-scoped, so the payer is
  // simply reused and no card credential has to be kept for the purpose.
  const existing = await deps.repository.findPayerRef({
    profileId: buyer.profileId,
    merchantRef,
  });
  if (existing) return { payerId: existing, merchantRef };

  const payer = await deps.payments.createPayer(buyer.profileId, {
    displayName: buyer.displayName ?? undefined,
    email: buyer.contactEmail ?? undefined,
  });
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

  // COLLECT ONLY — deliberately no `merchantRef`, whatever PAYOUT_MODE says.
  //
  // Passing it here made Stripe forward to the Seller at AGREEMENT time, before
  // the goods shipped and before the Buyer could inspect them, which meant there
  // was no escrow: the money was already gone when a dispute could first arise.
  // Funds now always land in the platform balance and are released explicitly by
  // `payoutCashSaleSeller` once the sale completes (Req 4.3).
  const transfer = await deps.payments.requestTransfer({
    payerId: target.payerId,
    amount: sale.amountCents,
    ref: `cash-sale:${sale.id}`,
    nonce: sale.paymentNonce,
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

  // Stripe realtime payments settle synchronously. Advance ESCROW_HELD here so
  // the sale does not wait on a webhook (or the mock Demo panel).
  if (transfer.status === 'SETTLED') {
    return settleCashSale(deps, { cashSaleId: sale.id });
  }

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

/**
 * Release escrowed proceeds to the Seller once a Cash_Sale is COMPLETED (Req 4.3).
 *
 * This is the second half of escrow. Collection put the Buyer's money in the
 * platform balance at agreement; this pays the Seller their net once the Buyer
 * has accepted the goods (or the inspection window lapsed).
 *
 * Uses `payoutToMerchant`, NOT `requestTransfer` — the latter creates a fresh
 * PaymentIntent against the payer and would charge the Buyer a second time for
 * one purchase.
 *
 * Safe to call more than once. The nonce is persisted by `markPayoutDue` and
 * reused verbatim, so a retry after an ambiguous provider timeout is
 * deduplicated by the provider rather than paying twice.
 */
export async function payoutCashSaleSeller(
  deps: CashSaleOrchestratorDeps,
  params: { cashSaleId: string },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };
  if (sale.status !== 'COMPLETED') {
    return { ok: false, error: 'INVALID_STATE', detail: sale.status };
  }
  // Already released — not an error, so a retry or double-click is harmless.
  if (sale.sellerPayoutStatus === 'SETTLED') return { ok: true, sale };

  const queued =
    sale.sellerPayoutStatus === 'NOT_DUE'
      ? await deps.repository.markPayoutDue(sale.id)
      : sale;
  const current = queued ?? sale;
  const nonce = current.sellerPayoutNonce;
  if (!nonce) return { ok: false, error: 'PAYOUT_FAILED', detail: 'Missing payout nonce' };

  // Notify only on a TRANSITION into failure. A release that was already FAILED
  // and fails again on the hourly retry must not notify a second time (Req 9.3).
  const wasAlreadyFailed = current.sellerPayoutStatus === 'FAILED';

  const payee = await deps.repository.loadSellerPayee(sale.sellerId);
  if (!canReceiveFunds(payee)) {
    // The funds stay in the platform balance and the sale stays payable. This is
    // recoverable: once the Seller finishes payout onboarding, the queued release
    // is retried. It is NOT a reason to leave the sale looking settled.
    await deps.repository.recordPayoutResult({
      cashSaleId: sale.id,
      status: 'FAILED',
      error: 'Seller cannot receive funds yet',
    });
    // Recorded as an event too, so the Transfer_History shows this failure the
    // same way it shows a provider rejection. Without it, the most common real
    // failure was the one the Member could not see (Req 5.7).
    await deps.repository.logEvent({
      cashSaleId: sale.id,
      actorId: null,
      event: 'SELLER_PAYOUT_FAILED',
      fromStatus: sale.status,
      toStatus: sale.status,
    });
    if (!wasAlreadyFailed) {
      await notifyQuietly(deps, (notifier) =>
        notifier.releaseFailed({
          sellerId: sale.sellerId,
          cashSaleId: sale.id,
          itemTitle: sale.itemTitle,
          cause: 'NOT_PAYABLE',
        }),
      );
    }
    return { ok: false, error: 'SELLER_NOT_PAYABLE' };
  }

  // The Seller receives everything except the Platform_Fee and anything already
  // refunded to the Buyer. Shipping is a pass-through cost to the carrier, so it
  // belongs to the Seller, and the fee is computed on the item price alone.
  //
  // Subtracting the refund is what makes PARTIAL_REFUND work: the Buyer keeps the
  // item at a reduced price and the Seller is released the remainder. Without it a
  // partially-refunded sale would pay the Seller the full amount and the platform
  // would absorb the difference.
  const net = sellerNetCentsFor(sale);

  const payout = await deps.payments.payoutToMerchant({
    merchantRef: payee!.merchantRef!,
    amount: net,
    ref: `cash-sale-payout:${sale.id}`,
    nonce,
    // Lets the provider draw against the original charge, so the release works
    // before those funds have cleared into the available balance.
    ...(current.transferId ? { sourcePaymentRef: current.transferId } : {}),
  });

  if (payout.status !== 'SETTLED') {
    const failed = await deps.repository.recordPayoutResult({
      cashSaleId: sale.id,
      status: 'FAILED',
      transferId: payout.transferId || undefined,
      error: 'Provider rejected the seller payout',
    });
    await deps.repository.logEvent({
      cashSaleId: sale.id,
      actorId: null,
      event: 'SELLER_PAYOUT_FAILED',
      fromStatus: sale.status,
      toStatus: sale.status,
    });
    if (!wasAlreadyFailed) {
      await notifyQuietly(deps, (notifier) =>
        notifier.releaseFailed({
          sellerId: sale.sellerId,
          cashSaleId: sale.id,
          itemTitle: sale.itemTitle,
          cause: 'PROVIDER_REJECTED',
        }),
      );
    }
    return { ok: false, error: 'PAYOUT_FAILED', detail: failed?.id ?? sale.id };
  }

  const settled = await deps.repository.recordPayoutResult({
    cashSaleId: sale.id,
    status: 'SETTLED',
    transferId: payout.transferId,
  });
  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: null,
    event: 'SELLER_PAYOUT_SETTLED',
    fromStatus: sale.status,
    toStatus: sale.status,
  });
  // Reached only on a transition into SETTLED: the early return above means an
  // already-settled release never gets here, so this cannot notify twice (Req 9.4).
  await notifyQuietly(deps, (notifier) =>
    notifier.releaseSettled({
      sellerId: sale.sellerId,
      cashSaleId: sale.id,
      itemTitle: sale.itemTitle,
      netCents: net,
    }),
  );
  return { ok: true, sale: settled ?? sale };
}

/**
 * What the Seller is owed on a Cash_Sale: collected amount, less the Platform_Fee,
 * less anything refunded to the Buyer.
 *
 * Clamped at zero so a full refund can never produce a negative release, and
 * exported so the read model and the UI compute the same number from the same
 * place rather than each re-deriving it.
 */
export function sellerNetCentsFor(sale: {
  amountCents: Cents;
  platformFeeCents: Cents;
  refundCents?: Cents;
}): Cents {
  const gross = Math.max(sale.amountCents - sale.platformFeeCents, 0);
  return Math.max(gross - Math.max(sale.refundCents ?? 0, 0), 0);
}

/**
 * Resolve a disputed Cash_Sale (Req 4.15).
 *
 * ORDER MATTERS AND IS DELIBERATE. The refund is queued (assigning a stable nonce)
 * and attempted BEFORE the sale leaves DISPUTED. If the provider refuses, the sale
 * stays DISPUTED with `refundStatus = FAILED` and the operator can retry — rather
 * than a "resolved" sale whose money never moved, which is the one outcome nobody
 * can detect after the fact.
 *
 * RELEASE_SELLER moves no money here at all: it completes the sale and lets the
 * ordinary release path pay the Seller, so there is exactly one code path that
 * pays a Seller regardless of how the sale got to COMPLETED.
 *
 * Safe to call more than once. An already-resolved sale returns success without
 * re-refunding, and the persisted nonce means a retried refund is deduplicated by
 * the provider.
 */
export async function resolveCashSaleDispute(
  deps: CashSaleOrchestratorDeps,
  params: {
    cashSaleId: string;
    /** The operator making the decision. Recorded for auditability. */
    actorId: string;
    outcome: CashSaleDisputeOutcome;
    /** Required for PARTIAL_REFUND; ignored otherwise. */
    refundCents?: Cents;
  },
): Promise<CashSaleResult> {
  const sale = await deps.repository.loadCashSale(params.cashSaleId);
  if (!sale) return { ok: false, error: 'CASH_SALE_NOT_FOUND' };

  // Already resolved — idempotent success, so a double-click or a retry after a
  // lost response cannot refund twice.
  if (sale.disputeResolution) return { ok: true, sale };
  if (sale.status !== 'DISPUTED') {
    return { ok: false, error: 'INVALID_STATE', detail: sale.status };
  }

  const collected = Math.max(sale.amountCents, 0);
  const refundTarget = resolveRefundAmount(params, collected);
  if (refundTarget === null) {
    return { ok: false, error: 'INVALID_REFUND_AMOUNT' };
  }

  // No money to return: complete the sale and let the normal release run.
  if (refundTarget === 0) {
    return completeResolvedDispute(deps, sale, params, 0);
  }

  if (!sale.transferId) {
    // Nothing was ever collected, so there is nothing to send back. Refusing is
    // safer than reporting a refund that cannot happen.
    return { ok: false, error: 'NOTHING_TO_REFUND' };
  }

  const queued = await deps.repository.markRefundDue({
    cashSaleId: sale.id,
    amountCents: refundTarget,
  });
  const current = queued ?? sale;
  const nonce = current.refundNonce;
  if (!nonce) {
    return { ok: false, error: 'REFUND_FAILED', detail: 'Missing refund nonce' };
  }

  const refund = await deps.payments.refundPayment({
    paymentRef: sale.transferId,
    // Explicit even for a full refund, so the recorded intent and the provider
    // request agree and a partial can never be silently widened to a full one.
    amount: refundTarget,
    nonce,
    ref: `cash-sale-refund:${sale.id}`,
  });

  if (refund.status !== 'SETTLED') {
    await deps.repository.recordRefundResult({
      cashSaleId: sale.id,
      status: 'FAILED',
      error: 'Provider rejected the refund',
    });
    await deps.repository.logEvent({
      cashSaleId: sale.id,
      actorId: params.actorId,
      event: 'DISPUTE_REFUND_FAILED',
      fromStatus: sale.status,
      toStatus: sale.status,
    });
    // Deliberately still DISPUTED.
    return { ok: false, error: 'REFUND_FAILED', detail: refund.reason };
  }

  await deps.repository.recordRefundResult({
    cashSaleId: sale.id,
    status: 'SETTLED',
    refundId: refund.refundId,
  });

  return completeResolvedDispute(deps, sale, params, refundTarget);
}

/**
 * The refund a given outcome implies, or `null` when the request is incoherent.
 *
 * A PARTIAL_REFUND of zero or of the whole amount is rejected rather than silently
 * reinterpreted: an operator who meant "release" or "refund everything" should say
 * so, because the two produce different final statuses and different item states.
 */
function resolveRefundAmount(
  params: { outcome: CashSaleDisputeOutcome; refundCents?: Cents },
  collected: Cents,
): Cents | null {
  switch (params.outcome) {
    case 'RELEASE_SELLER':
      return 0;
    case 'REFUND_BUYER':
      return collected;
    case 'PARTIAL_REFUND': {
      const requested = Math.trunc(params.refundCents ?? 0);
      if (!Number.isFinite(requested) || requested <= 0 || requested >= collected) {
        return null;
      }
      return requested;
    }
  }
}

/**
 * Apply the terminal state for a resolved dispute.
 *
 * A full refund ends the sale REFUNDED and returns the item to the catalog, because
 * the exchange did not stand. The other two outcomes complete the sale — the Buyer
 * keeps the item either way — and leave it SOLD, with the release queued so the
 * Seller is paid whatever remains.
 */
async function completeResolvedDispute(
  deps: CashSaleOrchestratorDeps,
  sale: CashSaleRecord,
  params: { actorId: string; outcome: CashSaleDisputeOutcome },
  refundCents: Cents,
): Promise<CashSaleResult> {
  const fullRefund = params.outcome === 'REFUND_BUYER';

  const updated = await deps.repository.recordDisputeResolution({
    cashSaleId: sale.id,
    outcome: params.outcome,
    resolvedBy: params.actorId,
    resolvedAt: currentIso(deps),
    status: fullRefund ? 'REFUNDED' : 'COMPLETED',
  });
  if (!updated) return { ok: false, error: 'INVALID_STATE' };

  await deps.repository.setItemStatus({
    itemId: sale.itemId,
    status: fullRefund ? 'AVAILABLE' : 'SOLD',
  });

  await deps.repository.logEvent({
    cashSaleId: sale.id,
    actorId: params.actorId,
    event: `DISPUTE_RESOLVED_${params.outcome}`,
    fromStatus: 'DISPUTED',
    toStatus: fullRefund ? 'REFUNDED' : 'COMPLETED',
    detail: refundCents > 0 ? String(refundCents) : undefined,
  });

  await notifyQuietly(deps, (notifier) =>
    notifier.disputeResolved({
      buyerId: sale.buyerId,
      sellerId: sale.sellerId,
      cashSaleId: sale.id,
      itemTitle: sale.itemTitle,
      outcome: params.outcome,
      refundCents,
      sellerNetCents: sellerNetCentsFor({ ...updated, refundCents }),
    }),
  );

  // The Seller is owed something on both completing outcomes, so queue the release
  // through the SAME path a normal completion uses.
  if (!fullRefund) {
    const released = await payoutCashSaleSeller(deps, { cashSaleId: sale.id });
    if (released.ok) return released;
    // A failed release does not un-resolve the dispute: the decision stands and the
    // release retries. Re-read so the caller sees the recorded payout state.
    const refreshed = await deps.repository.loadCashSale(sale.id);
    return { ok: true, sale: refreshed ?? updated };
  }

  return { ok: true, sale: updated };
}

/**
 * Run a notification without letting it affect the release.
 *
 * Req 9.5: the recorded outcome and the persisted event must stand whether or not
 * the Member could be told about it. A notifier that throws is a bug in the
 * notifier, not a reason to fail a payout that already succeeded at the provider.
 */
async function notifyQuietly(
  deps: CashSaleOrchestratorDeps,
  send: (notifier: PayoutNotifier) => Promise<void>,
): Promise<void> {
  if (!deps.notifier) return;
  try {
    await send(deps.notifier);
  } catch {
    // Deliberately swallowed.
  }
}

/** Outcome of one pass over the owed-release queue. */
export interface ProcessDuePayoutsResult {
  /** How many sales were considered. */
  considered: number;
  /** How many releases settled on this pass. */
  settled: number;
  /** How many are still owed after this pass. */
  stillOwed: number;
}

/**
 * Drain the queue of owed Seller releases (Req 4.3).
 *
 * Needed because a release can fail for reasons that later resolve on their own:
 * the Seller had not finished payout onboarding, or the provider was briefly
 * unavailable. Without a retry the Buyer's money simply stays in the platform
 * balance forever, which is the worst possible failure mode — silent, and in the
 * platform's favour.
 *
 * Each retry reuses the sale's persisted nonce, so re-running this is safe even
 * if a previous attempt actually succeeded but the response was lost.
 */
export async function processDueCashSalePayouts(
  deps: CashSaleOrchestratorDeps,
  params: { limit?: number; maxAttempts?: number } = {},
): Promise<ProcessDuePayoutsResult> {
  const limit = Math.max(1, Math.min(params.limit ?? 25, 200));
  const maxAttempts = params.maxAttempts ?? MAX_PAYOUT_ATTEMPTS;

  const due = await deps.repository.listDuePayouts({ limit, maxAttempts });
  let settled = 0;

  for (const cashSaleId of due) {
    // One failure must not abort the batch: unrelated sellers are waiting.
    const result = await payoutCashSaleSeller(deps, { cashSaleId });
    if (result.ok && result.sale.sellerPayoutStatus === 'SETTLED') settled += 1;
  }

  return { considered: due.length, settled, stillOwed: due.length - settled };
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

  // Buyer accepted the goods, so the Seller's money is now owed (Req 4.3). A
  // failed release is queued for retry rather than surfaced to the Buyer: from
  // their side the purchase IS complete, and the platform holding the funds is
  // an operator problem, not theirs.
  if (updated.status === 'COMPLETED') {
    const released = await payoutCashSaleSeller(deps, { cashSaleId: sale.id });
    if (released.ok) return released;
    // Release failed. Re-read so the caller sees the recorded payout state
    // rather than the pre-attempt snapshot, which would still say NOT_DUE.
    const refreshed = await deps.repository.loadCashSale(sale.id);
    return { ok: true, sale: refreshed ?? updated };
  }
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

  // Both parties confirmed the in-person handover, so the release is owed
  // (Req 4.3). Only fires on the second confirmation, when status flips.
  if (updated.status === 'COMPLETED') {
    const released = await payoutCashSaleSeller(deps, { cashSaleId: sale.id });
    if (released.ok) return released;
    // Release failed. Re-read so the caller sees the recorded payout state
    // rather than the pre-attempt snapshot, which would still say NOT_DUE.
    const refreshed = await deps.repository.loadCashSale(sale.id);
    return { ok: true, sale: refreshed ?? updated };
  }
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
  /** Release escrowed proceeds to the Seller on a COMPLETED sale (Req 4.3). */
  payoutSeller(params: { cashSaleId: string }): Promise<CashSaleResult>;
  /** Resolve a disputed sale: refund, part-refund, or release (Req 4.15). */
  resolveDispute(params: {
    cashSaleId: string;
    actorId: string;
    outcome: CashSaleDisputeOutcome;
    refundCents?: number;
  }): Promise<CashSaleResult>;
  /** Retry every release still owed (Req 4.3). */
  processDuePayouts(params?: {
    limit?: number;
    maxAttempts?: number;
  }): Promise<ProcessDuePayoutsResult>;
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
    payoutSeller: (params) => payoutCashSaleSeller(deps, params),
    resolveDispute: (params) => resolveCashSaleDispute(deps, params),
    processDuePayouts: (params) => processDueCashSalePayouts(deps, params),
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
