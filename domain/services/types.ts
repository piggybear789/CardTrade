// domain/services/types.ts
//
// The Payment/KYC Service contract — the single seam that lets the real Stripe
// integration replace the MockService later. Both `MockService` (this phase)
// and a future `StripeService` implement these interfaces, so the rest of the
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
 * ignores them (its payer ids are derived from the profile id), while the Stripe
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
  /** The Profile's contact email — required by Stripe. */
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
  /**
   * `EXPIRED` is reached without any call from us, when {@link PreAuthHold.expiresAt}
   * passes and the provider releases the collateral itself. It is deliberately
   * distinct from `VOIDED`: a void is escrow succeeding at $0 cost (Req 6.7),
   * an expiry is escrow having FAILED to resolve in time.
   */
  status:
    | 'ACTIVE'
    | 'VOIDED'
    | 'PARTIALLY_CAPTURED'
    | 'FULLY_CAPTURED'
    | 'FAILED'
    | 'EXPIRED';
  /**
   * ISO-8601 instant after which the authorisation lapses and the provider
   * releases the funds on its own, moving the hold to a terminal state without
   * any call from us.
   *
   * Set by providers that place a genuine authorisation: card authorisations for
   * online payments are typically valid for ~7 days, so a Trade must reach
   * INSPECTION and resolve inside that window, or the collateral must be
   * re-authorised before this instant. Absent when the provider's holds do not
   * expire (e.g. a charge-and-refund strategy, where funds have already moved,
   * or the deterministic MockService).
   *
   * Callers must treat this as advisory-but-real: after it passes, `voidHold`
   * and `partialCapture` will fail because there is nothing left to act on.
   */
  expiresAt?: string;
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
 * What the platform actually holds with the provider right now.
 *
 * WHY THIS IS ON THE SEAM. Every other figure in this system is a statement about our
 * OWN database: what we believe we owe. None of them can tell us whether the money to
 * pay it is there. Cash_Sale proceeds sit in the platform balance commingled with fee
 * revenue, so three things can drain it without touching a single row — a chargeback
 * (the platform is `losses_collector`), a provider fee, or an automatic payout sweeping
 * the balance to the platform's own bank account. Reconciliation needs one number the
 * provider owns.
 *
 * `pending` is included deliberately: card funds clear over days, so available alone
 * would report a shortfall on every healthy platform that took a payment this morning.
 *
 * Reports failure as `UNAVAILABLE` rather than throwing. A reconciliation panel that
 * cannot read the balance must say "unknown" — never imply solvency it did not verify.
 */
export interface PlatformBalance {
  availableCents: Cents;
  pendingCents: Cents;
  /** Lower-cased ISO currency the figures are denominated in. */
  currency: string;
  status: 'READ' | 'UNAVAILABLE';
  /** Provider-side detail when the read failed. Operator-facing only. */
  reason?: string;
}

/**
 * The result of returning collected funds to the payer.
 *
 * Reports failure through `status` rather than throwing, matching every other
 * money-moving primitive here, so the caller's compensating logic still runs and a
 * disputed sale is never left looking resolved when the money did not move.
 */
export interface RefundResult {
  refundId: string;
  /** Amount actually returned, in integer cents. */
  amount: Cents;
  status: 'SETTLED' | 'FAILED';
  /** Provider-side detail on failure. Never shown to a member verbatim. */
  reason?: string;
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
  /**
   * The payee's verified legal name, as held by the provider after identity
   * verification. Populated once onboarding completes; `null` before that.
   *
   * This is the buyer-safe disclosure for a Cash_Sale (Req 4.8-4.12): it is a
   * name the provider actually checked against a government document, not
   * something the Seller typed into our form. It is the ONE identity field worth
   * surfacing — contact details, address, date of birth, document numbers, and
   * bank details are all deliberately excluded and must never be exposed.
   */
  legalName?: string | null;
}

/**
 * The details needed to open a sub-merchant — deliberately almost nothing.
 *
 * This used to carry the payee's BSB, account number, government registration
 * number, date of birth, residential address, and the request IP/user-agent,
 * because Stripe's `POST /merchants/managed` demanded all of it in the request
 * body and offered no tokenised alternative for a settlement account.
 *
 * With provider-hosted onboarding (see
 * {@link PaymentService.createMerchantOnboardingLink}) the provider collects and
 * verifies every one of those fields on its own pages. None of it reaches our
 * server, so none of it belongs on this interface.
 */
export interface ManagedMerchantDetails {
  /**
   * The Profile the account is being opened for.
   *
   * NOT provider data — it is the idempotency scope. A retry must not open a
   * second account for the same Member, and the only durable name for "the same
   * Member" is the Profile id. It used to be `businessEmail`, which is mutable,
   * shareable between Profiles, and outlives the row it was read from: a Profile
   * recreated against a Stripe account that still existed could neither reach the
   * old account (its reference was gone) nor create a new one (the key was taken
   * with a different body), which deadlocks onboarding for that address until the
   * key expires.
   */
  profileId: string;
  /** Contact email for the account. The one field a provider always needs. */
  businessEmail: string;
  /**
   * Public shop/trading name, when the Seller wants one. Display only — the
   * authoritative payee name is {@link ManagedMerchant.legalName}, which the
   * provider verifies against a government document.
   */
  tradingName?: string;
  /**
   * The Seller's own stated name, used only as a display fallback before
   * onboarding completes. NOT the verified identity: never present this to a
   * Buyer as though the provider had checked it.
   */
  legalEntityName?: string;
}

/**
 * A provider-hosted handshake for capturing and vaulting a payment instrument.
 *
 * Exists so the tokenisation UI stays behind the seam. The browser needs a
 * provider-issued secret to talk to the provider's own card fields directly, and
 * the alternative — importing a provider SDK into `lib/` or `components/` — would
 * leak the concrete provider into callers.
 */
export interface InstrumentSetup {
  /** Opaque id for this setup attempt, handed back to complete it. */
  setupId: string;
  /**
   * Short-lived secret the browser needs to complete the flow. Scoped to this
   * one setup attempt and useless for moving money, but still never logged.
   */
  clientSecret: string;
  /** Publishable/browser-safe key for initialising the provider's client SDK. */
  publishableKey: string;
}

/**
 * A vaulted instrument, reported after a {@link InstrumentSetup} completes.
 *
 * `brand`/`last4` are display-only, read back FROM the provider rather than
 * supplied by the client, so the label cannot be spoofed and no card data has to
 * pass through our forms.
 */
export interface VaultedInstrument {
  sourceId: string;
  /** e.g. `visa`, `mastercard`. Display only. */
  brand?: string;
  /** Last four digits. Display only. */
  last4?: string;
}

// The retired payer-gate types lived here: `KycResult`, `IdentityCheckSession`
// and `VerifiedIdentitySummary`. All three are gone along with the separate
// verification gate. Identity is now the Identity_Gate — Connect onboarding
// APPROVED with settlements enabled — and the only identity the platform holds is
// the provider-verified legal name Connect reports, persisted by
// `applyComplianceUpdate` as `merchant_legal_entity_name`. There is no synchronous
// verification call, no hosted identity session to open, and no summary to read
// back, so no seam member is needed for any of it.

/**
 * The set of payment lifecycle changes reported via Webhook_Events. These
 * map to `TradeEvent`s / Cash_Sale updates in the Webhook_Handler (Req 10.4).
 * The MockService enqueues these after each payment operation; the real Stripe
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
  // A dispute refund that cleared as `pending` and then failed at the bank
  // (Req 4.15). MUST be observed: `refundPayment` treats `pending` as settled,
  // because card refunds normally settle asynchronously and calling that a failure
  // would make a resolution retry a refund already in flight. The cost of that
  // choice is this event — without it, a failed refund leaves a sale marked
  // REFUNDED while the money is still sitting on the platform.
  | 'refund.failed'
  // `kyc.verified` / `kyc.rejected` were removed with the payer gate. Identity now
  // arrives on `merchant.compliance.updated`, which is the same event that decides
  // payability — one signal, one event.
  | 'merchant.compliance.updated' // a sub-merchant's compliance decision changed
  // A payer disputed a charge with their bank (a chargeback).
  //
  // This MUST be observed. The platform is merchant of record and accepted
  // `losses_collector: application`, so it absorbs the loss directly — a
  // chargeback that nobody notices is money leaving with no record and no
  // opportunity to contest before the provider's evidence deadline.
  | 'charge.disputed'
  // The dispute reached a terminal outcome (won or lost).
  | 'charge.dispute.closed';

/**
 * The data carried by a Webhook_Event. Every field is optional because the
 * meaningful subset depends on the `type`: a `hold.*` event carries `holdId`
 * (and `tradeId`), a `transfer.*` event carries `transferId`, a `capture.*`
 * event carries `captureId`/`holdId`, and `merchant.compliance.updated` carries
 * `merchantRef`. The Webhook_Handler reads these to locate the target Trade or
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
  /** Failure detail for `*.failed` events. */
  reason?: string;
  /** Sub-merchant reference for `merchant.compliance.updated` events. */
  merchantRef?: string;
  /** Provider dispute reference for `charge.disputed` / `charge.dispute.closed`. */
  disputeId?: string;
  /**
   * Terminal dispute outcome on `charge.dispute.closed`. `lost` means the funds
   * are gone and the platform has absorbed them.
   */
  disputeOutcome?: 'won' | 'lost' | 'warning_closed' | 'other';
  /**
   * Instant by which evidence must be submitted to contest a dispute. Missing it
   * forfeits the dispute automatically, so it is a hard deadline, not advisory.
   */
  evidenceDueBy?: string;
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
 * the bytes that were actually signed, matching the real Stripe header contract.
 */
export interface SignedWebhookEnvelope {
  event: WebhookEvent;
  /** The canonical JSON string over which `signature` was computed (the request body). */
  rawBody: string;
  /** The HMAC signature carried in the provider's signature header. */
  signature: string;
}

/**
 * Payment provider contract — implemented by MockService now, StripeService
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
   * Pay OUT of the platform balance to a Seller's connected account (Req 4.3).
   *
   * Distinct from {@link PaymentService.requestTransfer}, which charges a payer
   * and optionally forwards in one step. This method moves money that the
   * platform ALREADY holds and never touches a payer, so it is the only safe way
   * to release escrowed funds — calling `requestTransfer` at release time would
   * charge the Buyer a second time.
   *
   * `amount` is the NET the Seller receives; the caller subtracts the
   * Platform_Fee before calling, because `application_fee_amount` is not
   * compatible with separate charges and transfers.
   */
  payoutToMerchant(params: {
    /** Destination connected account. */
    merchantRef: string;
    /** Net amount to land in the Seller's account, in integer cents. */
    amount: Cents;
    ref: string;
    /** Persisted idempotency key; retries MUST reuse this exact value. */
    nonce: string;
    /**
     * The original collection payment reference, when known. Lets the provider
     * tie the payout to the incoming charge so it succeeds even before those
     * funds have settled into the platform's available balance.
     */
    sourcePaymentRef?: string;
  }): Promise<TransferResult>;

  /**
   * Return collected funds to the payer, in whole or in part (Req 4.15).
   *
   * The counterpart to {@link PaymentService.payoutToMerchant}: both spend money the
   * platform already holds, one towards the Seller and one back to the Buyer. A
   * Cash_Sale dispute resolves to one, the other, or a split of the two.
   *
   * `paymentRef` is the ORIGINAL collection reference (`cash_sales.transfer_id`),
   * not a hold. A Cash_Sale is collected up front, so there is no authorisation to
   * void and the money has to be actively sent back.
   *
   * Omit `amount` to return everything still refundable; pass it to refund part and
   * leave the remainder releasable to the Seller.
   *
   * MUST be idempotent on `nonce`. A resolution can be retried after an ambiguous
   * provider timeout, and refunding a Buyer twice spends the platform's own money.
   */
  refundPayment(params: {
    paymentRef: string;
    amount?: Cents;
    /** Stable idempotency key, persisted by the caller and reused verbatim. */
    nonce: string;
    /** Correlation label for provider-side records. */
    ref?: string;
  }): Promise<RefundResult>;

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
   * Read what the platform currently holds with the provider.
   *
   * The only figure in the system the provider owns rather than we do, and therefore
   * the only way to check that money believed to be held actually is. See
   * {@link PlatformBalance}.
   */
  getPlatformBalance(): Promise<PlatformBalance>;
  /**
   * Vault a tokenised payment instrument against a payer so later charges
   * (collateral holds, cash-sale transfers) have a source to draw on.
   *
   * `token` comes from client-side tokenisation (Stripe CaptureJS) — raw card or
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
   * Open a provider-hosted instrument capture flow for a payer.
   *
   * Preferred over {@link attachPaymentSource} where available: the provider
   * renders its own card fields, so no card number, CVC, or expiry ever enters
   * our DOM, our forms, or our validation code. The caller passes the returned
   * secret to the browser and nothing else.
   */
  beginInstrumentSetup?(params: { payerId: string }): Promise<InstrumentSetup>;
  /**
   * Confirm a completed {@link beginInstrumentSetup} and report the vaulted
   * instrument.
   *
   * Implementations MUST verify the setup belongs to `payerId` before returning,
   * so a client cannot claim someone else's instrument by guessing an id.
   */
  completeInstrumentSetup?(params: {
    payerId: string;
    setupId: string;
  }): Promise<VaultedInstrument>;
  /**
   * Open a sub-merchant so a User can be paid (Cash_Sale seller, fraud victim).
   * Optional on the contract: a provider without a platform/marketplace model
   * simply does not offer it.
   */
  createManagedMerchant?(details: ManagedMerchantDetails): Promise<ManagedMerchant>;
  /** Re-read a sub-merchant's compliance state (polling fallback for webhooks). */
  getManagedMerchant?(merchantRef: string): Promise<ManagedMerchant | null>;
  /**
   * Start a provider-hosted onboarding session for a sub-merchant.
   *
   * The provider collects everything it needs to pay this User — legal entity,
   * government registration, date of birth, address, and the disbursement bank
   * account — on its own pages. That is why {@link ManagedMerchantDetails} no
   * longer needs to carry bank details: they never reach our server at all.
   *
   * Returns a single-use URL to redirect the User to. Links are short-lived; if
   * one expires the caller requests another rather than reusing it.
   */
  createMerchantOnboardingLink?(params: {
    merchantRef: string;
    /** Where the provider returns the User once they finish. */
    returnUrl: string;
    /** Where the provider sends the User if the link expired mid-flow. */
    refreshUrl: string;
  }): Promise<{ url: string; expiresAt?: string }>;
}

/**
 * Payer creation — the provider Customer a Member pays and posts collateral
 * against.
 *
 * This used to sit on a separate `KycService` interface alongside
 * `runVerification`, `beginIdentityCheck` and `getIdentitySummary`. That whole
 * interface is gone: identity verification is now the single Identity_Gate, which
 * is Connect onboarding state (`merchant_status` with settlements enabled) and
 * needs no provider call of its own. Creating a payer was never a verification
 * step — it is a payment prerequisite — so it moved here rather than being
 * removed.
 *
 * Kept as its own interface, and intersected into {@link PaymentKycService}, so
 * the many existing `PaymentService`-only implementations in tests do not have to
 * grow a method they never use.
 */
export interface PayerService {
  /** Create (or return) the provider payer for a Profile. See {@link PayerDetails}. */
  createPayer(
    profileId: string,
    details?: PayerDetails,
    options?: PayerCreateOptions,
  ): Promise<Payer>;
}

/**
 * Optional capability the MockService exposes for demo control: emit a
 * Webhook_Event into the Webhook_Handler, exercising the exact code path a real
 * Stripe webhook would (Req 10). NOT part of the production contract — the real
 * Stripe integration receives webhooks rather than emitting them.
 */
export interface WebhookEmitter {
  emit(event: WebhookEvent): Promise<void>;
}
