// domain/services/types.ts
//
// The Payment/KYC Service contract — the single seam that lets the real Pinch
// integration replace the MockService later. Both `MockService` (this phase)
// and a future `PinchService` implement these interfaces, so the rest of the
// system depends only on the interface, never on a concrete implementation.
//
// This module is PURE types/interfaces with no runtime dependencies (no
// Supabase, React, crypto, or fetch). All monetary amounts are integer AUD
// cents to avoid floating-point drift.

/** Integer AUD cents (e.g. 199 === $1.99). Never a fractional/float dollar amount. */
export type Cents = number;

/**
 * A payment-provider payer, created when a User begins KYC (Req 2.1). Links the
 * provider-side payer reference back to the owning Profile.
 */
export interface Payer {
  payerId: string;
  profileId: string;
}

/**
 * Contact details a real provider needs to create a Payer record. The Mock
 * ignores them (its payer ids are derived from the profile id), while the Pinch
 * integration requires at least a name and an email address per
 * `POST /payers`. Callers source these from the owning Profile.
 */
export interface PayerCreateOptions {
  /**
   * Create the payer under this sub-merchant rather than the platform merchant.
   * A provider Payer belongs to the merchant it was created under, so paying a
   * different sub-merchant requires a payer record on that sub-merchant.
   */
  merchantRef?: string;
  /**
   * Attach a tokenised instrument at creation time. Reusing a token captured
   * earlier under the platform merchant is what lets a Buyer pay a Seller who
   * onboarded after the card was captured (requires multi-use token reuse to be
   * enabled on the parent merchant).
   */
  source?: { token: string; sourceType: 'credit-card' | 'bank-account' };
}

export interface PayerDetails {
  /** The Profile's display name; split into first/last for the provider. */
  displayName?: string;
  /** The Profile's contact email — required by Pinch. */
  email?: string;
  /** Optional Australian mobile number (10 digits, no country code). */
  mobile?: string;
}

/**
 * A credit pre-authorization hold placed on a Trader's payment instrument for
 * 100% of an Item's Fair_Market_Value (Req 5.4). Its status tracks the hold
 * lifecycle through voids and partial/full captures.
 */
export interface PreAuthHold {
  holdId: string;
  payerId: string;
  amount: Cents;
  status: 'ACTIVE' | 'VOIDED' | 'PARTIALLY_CAPTURED' | 'FULLY_CAPTURED' | 'FAILED';
}

/**
 * The result of capturing funds from a hold — a Friction_Tax partial capture
 * (Req 7.2) or a fraud full capture (Req 8.2). `SETTLED` means the funds have
 * cleared; `FAILED` triggers compensating logic in the orchestrator.
 */
export interface CaptureResult {
  captureId: string;
  holdId: string;
  amount: Cents;
  status: 'SETTLED' | 'FAILED';
}

/**
 * The result of a bank-to-bank transfer — a Cash_Sale settlement (Req 4.2) or
 * the payout of captured fraud collateral to the victim (Req 8.3).
 */
export interface TransferResult {
  transferId: string;
  amount: Cents;
  status: 'SETTLED' | 'FAILED';
}

/**
 * A sub-merchant account under the platform's own merchant, created so a User
 * can RECEIVE money (a Cash_Sale seller, or a fraud victim paid captured
 * collateral). Distinct from a {@link Payer}, which only ever pays.
 *
 * The provider verifies identity and business details before enabling the
 * account, which is why the three enable flags are reported independently:
 * transactions may be permitted before settlements are.
 */
export interface ManagedMerchant {
  merchantRef: string;
  /** Provider compliance status verbatim (e.g. `new`, `approved`). */
  complianceStatus: string;
  liveEnabled: boolean;
  transactionsEnabled: boolean;
  settlementsEnabled: boolean;
  /** Provider/compliance notes, when supplied. */
  notes?: string;
}

/**
 * The details a provider needs to open a sub-merchant. Modelled on Pinch's
 * `POST /merchants/managed`. `legalEntityName` and the registration number are
 * persisted only as a buyer-safe disclosure after the seller explicitly
 * consents; bank/contact/document data stays private. Current Pinch compliance
 * guidance requires business-registration evidence for live approval.
 *
 * `ipAddress` and `userAgent` are required by the provider for AML purposes and
 * must come from the actual request that initiated onboarding, which is why this
 * cannot be built inside a pure domain function.
 */
export interface ManagedMerchantDetails {
  /** Legal person or registered entity that will receive the sale proceeds. */
  legalEntityName: string;
  /** Public shop/trading name, when different from the legal entity. */
  tradingName?: string;
  businessEmail: string;
  /** Disbursement account BSB, 6 digits, no spaces or dashes. */
  bankAccountBsb: string;
  /** Disbursement account number, 3–9 digits. */
  bankAccountNumber: string;
  bankAccountName?: string;
  /** ABN/ACN or equivalent government business registration. */
  businessRegistrationNumber: string;
  /** Free-text descriptor, e.g. `individual` or `company`. */
  organisationType?: string;
  natureOfBusiness?: string;
  contact: {
    firstName?: string;
    lastName?: string;
    email: string;
    phone?: string;
    /** ISO `yyyy-mm-dd`. */
    dateOfBirth?: string;
    streetAddress?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
  /** External IP of the user completing onboarding. */
  ipAddress: string;
  /** User agent of the user completing onboarding. */
  userAgent: string;
}

/**
 * The outcome of an identity verification run (Req 2.2, 2.3). On `REJECTED`, the
 * `reason` carries the failure detail recorded against the Profile for review.
 */
export interface KycResult {
  payerId: string;
  outcome: 'VERIFIED' | 'REJECTED';
  reason?: string;
}

/**
 * Verified identity data supplied by the KYC_Service, stored for later use in
 * generating a Police_Evidence_Pack on Objective_Fraud (Req 2.5, 8.4).
 */
export interface VerifiedIdentity {
  profileId: string;
  legalName: string;
  dateOfBirth: string;
  documentType: string;
  documentNumber: string;
  verifiedAt: string;
}

/**
 * The set of payment/KYC lifecycle changes reported via Webhook_Events. These
 * map to `TradeEvent`s / Cash_Sale updates in the Webhook_Handler (Req 10.4).
 * The MockService enqueues these after each payment operation; the real Pinch
 * integration produces the equivalent set.
 */
export type WebhookEventType =
  | 'hold.active' // both pre-auths active -> HOLDS_CONFIRMED (Req 5.5)
  | 'hold.failed' // a hold failed/timed out -> HOLDS_FAILED (Req 5.6)
  | 'hold.voided' // a hold was released at $0 (Req 6.7, 7.5, 8.5)
  | 'capture.partial.settled' // Friction_Tax partial capture cleared (Req 7.2, 7.3)
  | 'capture.full.settled' // fraud full capture cleared (Req 8.2)
  | 'capture.failed' // a capture failed to settle (Req 7.6, 8.6)
  | 'transfer.settled' // cash-sale / victim payout cleared (Req 4.3, 8.3)
  | 'transfer.failed' // cash-sale transfer failed (Req 4.4)
  | 'kyc.verified' // identity verification succeeded (Req 2.2)
  | 'kyc.rejected' // identity verification failed (Req 2.3)
  | 'merchant.compliance.updated'; // a sub-merchant's compliance decision changed

/**
 * The data carried by a Webhook_Event. Every field is optional because the
 * meaningful subset depends on the `type`: a `hold.*` event carries `holdId`
 * (and `tradeId`), a `transfer.*` event carries `transferId`, a `capture.*`
 * event carries `captureId`/`holdId`, and `kyc.*` events carry `payerId`/
 * `profileId`. The Webhook_Handler reads these to locate the target Trade or
 * Cash_Sale and derive the state transition.
 */
export interface WebhookEventPayload {
  tradeId?: string;
  cashSaleId?: string;
  holdId?: string;
  transferId?: string;
  captureId?: string;
  payerId?: string;
  profileId?: string;
  amount?: Cents;
  /** Provider-side status string (e.g. the hold/capture/transfer status). */
  status?: string;
  /** Failure detail for `*.failed`/`kyc.rejected` events. */
  reason?: string;
  /** Sub-merchant reference for `merchant.compliance.updated` events. */
  merchantRef?: string;
  /** Compliance enable flags carried by `merchant.compliance.updated`. */
  liveEnabled?: boolean;
  transactionsEnabled?: boolean;
  settlementsEnabled?: boolean;
  /**
   * True when the provider reports the merchant account as active. The documented
   * `compliance-updated` payload carries a submission status plus a merchant
   * status rather than the enable flags, so this is the approval signal on that
   * path.
   */
  merchantActive?: boolean;
}

/**
 * A payment/KYC lifecycle notification. `eventId` is the idempotency key: the
 * Webhook_Handler dedupes on it so re-delivery of an already-successful event
 * does not re-apply a transition (Req 10.5). `type` selects the mapping to a
 * Trade_State transition (Req 10.4); `payload` carries the referenced ids.
 */
export interface WebhookEvent {
  eventId: string;
  type: WebhookEventType;
  /** ISO-8601 timestamp the event was produced. */
  occurredAt: string;
  payload: WebhookEventPayload;
}

/**
 * The signed HTTP delivery of a Webhook_Event. The Webhook_Handler recomputes
 * an HMAC over the exact `rawBody` bytes using the shared secret and compares it
 * to `signature` before applying any state change (Req 10.1, 10.2). Keeping the
 * raw body alongside the parsed event lets the authenticity check run against
 * the bytes that were actually signed, matching the real Pinch header contract.
 */
export interface SignedWebhookEnvelope {
  event: WebhookEvent;
  /** The canonical JSON string over which `signature` was computed (the request body). */
  rawBody: string;
  /** The HMAC signature carried in the provider's signature header. */
  signature: string;
}

/**
 * Payment provider contract — implemented by MockService now, PinchService
 * later. Methods resolve with explicit `status`-bearing results rather than
 * throwing, so the orchestrator can branch on failures and run compensating
 * actions (void holds, restore item availability) per Req 4.4, 5.6, 7.6, 8.6.
 */
export interface PaymentService {
  /**
   * Create a provider payer for a Profile (Req 2.1). `details` carries the
   * Profile's name/email, which a real provider needs and the Mock ignores.
   * `options` targets a sub-merchant and/or attaches a tokenised source.
   */
  createPayer(
    profileId: string,
    details?: PayerDetails,
    options?: PayerCreateOptions,
  ): Promise<Payer>;
  /**
   * Request a bank-to-bank transfer of `amount` (Req 4.2, 8.3).
   *
   * `merchantRef` routes the collection into a sub-merchant so funds settle
   * directly to the recipient; omit it to collect into the platform merchant
   * (the correct choice for collateral, which the platform holds).
   * `applicationFee` is the platform's cut of a sub-merchant collection — the
   * flat Platform_Fee (Req 4.7) — and is retained by the parent merchant.
   */
  requestTransfer(params: {
    payerId: string;
    amount: Cents;
    ref: string;
    /** Persisted idempotency key; retries MUST reuse this exact value. */
    nonce: string;
    merchantRef?: string;
    applicationFee?: Cents;
  }): Promise<TransferResult>;
  /**
   * Commit `amount` of a payer's collateral (Req 5.4).
   *
   * Implementations may reserve the funds (a true pre-authorisation) or record a
   * standing authorisation to charge the payer later. Either way an ACTIVE hold
   * means "we may take up to this much from this payer", NOT "this money has
   * been taken" — so a capture can still fail on insufficient funds.
   */
  placeHold(params: { payerId: string; amount: Cents; ref: string }): Promise<PreAuthHold>;
  /** Release a hold at $0 cost (Req 6.7, 7.5, 8.5). */
  voidHold(holdId: string): Promise<PreAuthHold>;
  /** Capture a fixed portion of a hold — the Friction_Tax (Req 7.2). */
  partialCapture(params: { holdId: string; amount: Cents }): Promise<CaptureResult>;
  /** Capture the entire hold amount on Objective_Fraud (Req 8.2). */
  fullCapture(holdId: string): Promise<CaptureResult>;
  /**
   * Vault a tokenised payment instrument against a payer so later charges
   * (collateral holds, cash-sale transfers) have a source to draw on.
   *
   * `token` comes from client-side tokenisation (Pinch CaptureJS) — raw card or
   * bank details must never reach the server. Optional on the contract because
   * the Mock has no instruments to store.
   */
  attachPaymentSource?(params: {
    payerId: string;
    token: string;
    sourceType: 'credit-card' | 'bank-account';
    ipAddress?: string;
  }): Promise<{ sourceId: string }>;
  /**
   * Open a sub-merchant so a User can be paid (Cash_Sale seller, fraud victim).
   * Optional on the contract: a provider without a platform/marketplace model
   * simply does not offer it.
   */
  createManagedMerchant?(details: ManagedMerchantDetails): Promise<ManagedMerchant>;
  /** Re-read a sub-merchant's compliance state (polling fallback for webhooks). */
  getManagedMerchant?(merchantRef: string): Promise<ManagedMerchant | null>;
}

/**
 * KYC contract — implemented by MockService now, Pinch Glassbox later.
 */
export interface KycService {
  /** KYC begins with payer creation (Req 2.1). See {@link PayerDetails}. */
  createPayer(
    profileId: string,
    details?: PayerDetails,
    options?: PayerCreateOptions,
  ): Promise<Payer>;
  /** Run identity verification; resolves VERIFIED or REJECTED (Req 2.2, 2.3). */
  runVerification(payerId: string): Promise<KycResult>;
  /** Retrieve stored verified identity data for a Police_Evidence_Pack (Req 2.5, 8.4). Null when none. */
  getVerifiedIdentity(profileId: string): Promise<VerifiedIdentity | null>;
}

/**
 * Optional capability the MockService exposes for demo control: emit a
 * Webhook_Event into the Webhook_Handler, exercising the exact code path a real
 * Pinch webhook would (Req 10). NOT part of the production PaymentService/
 * KycService contract — the real Pinch integration receives webhooks rather
 * than emitting them.
 */
export interface WebhookEmitter {
  emit(event: WebhookEvent): Promise<void>;
}
