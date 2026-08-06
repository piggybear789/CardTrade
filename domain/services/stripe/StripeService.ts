// domain/services/stripe/StripeService.ts
//
// The real Stripe binding for the `PaymentService` / `KycService` contract
// (Req 2, 4, 5, 6, 7, 8). Nothing outside `domain/services/**` imports this;
// callers depend only on the interfaces in `../types`.
//
// Escrow is a GENUINE authorisation here. Where the Pinch binding had to charge
// the collateral and refund it later — real money leaving a trader's account for
// a trade that had not gone wrong — Stripe exposes the primitives directly:
//
//   placeHold        -> PaymentIntent, capture_method: 'manual'   (no funds move)
//   voidHold         -> paymentIntents.cancel
//   partialCapture   -> paymentIntents.capture({ amount_to_capture })
//                       Stripe releases the uncaptured remainder automatically,
//                       which is exactly the Friction_Tax shape (Req 7.2).
//   fullCapture      -> paymentIntents.capture()                  (Req 8.2)
//   requestTransfer  -> PaymentIntent (+ Transfer when settling to a Seller)
//
// The cost of a real authorisation is that it EXPIRES: online card auths last
// about 7 days. Every hold therefore reports `expiresAt`, read from the charge's
// `capture_before`, so callers can surface the deadline and/or re-authorise.
//
// Failure is reported through the `status` field rather than thrown, so the
// existing compensating logic still runs (Req 4.4, 5.6, 7.6, 8.6). `createPayer`
// is the deliberate exception: Req 2.6 expects verification state to stay
// unchanged when payer creation fails, so it throws.

// Deliberately NOT `server-only`: like `PinchService`, this module is reachable
// from smoke scripts and Node-only tests. In this codebase the `server-only`
// guard sits on the Supabase repository files instead. Credentials stay server
// side because `config.ts` only ever reads `process.env`, and nothing under
// `components/**` imports this module.
import { createHash } from 'node:crypto';

import type Stripe from 'stripe';

import type {
  CaptureResult,
  Cents,
  InstrumentSetup,
  ManagedMerchant,
  ManagedMerchantDetails,
  Payer,
  PayerCreateOptions,
  PayerDetails,
  PayerService,
  PaymentService,
  PlatformBalance,
  PreAuthHold,
  RefundResult,
  TransferResult,
  VaultedInstrument,
} from '../types';
import type { StripeConfig } from './config';
import { metadataFor } from './metadata';

/**
 * Collateral holds and cash collections are card-only on purpose.
 *
 * BECS Direct Debit (`au_becs_debit`) does not support manual capture at all, so
 * it cannot back an authorisation hold, and its 7-year no-questions-asked
 * dispute window makes it a poor fit for escrow where the platform is merchant
 * of record. Naming the type explicitly also stops Stripe's dynamic payment
 * methods from silently selecting an ineligible one.
 */
const CARD_ONLY = ['card'];

export interface StripeServiceOptions {
  client: Stripe;
  config: StripeConfig;
}

/** A hold/transfer failure that carries no provider id. */
function failedHold(payerId: string, amount: Cents): PreAuthHold {
  return { holdId: '', payerId, amount, status: 'FAILED' };
}

export class StripeService implements PaymentService, PayerService {
  constructor(private readonly opts: StripeServiceOptions) {}

  private get stripe(): Stripe {
    return this.opts.client;
  }

  // --- Payers (Stripe Customers) -------------------------------------------

  /**
   * Create a Stripe Customer for a Profile (Req 2.1).
   *
   * A Stripe Customer belongs to the platform, not to a sub-merchant, so the
   * per-merchant payer mapping the Pinch binding needed (`payer_refs`, and the
   * reusable `profiles.payment_token` that fed it) has no equivalent here. One
   * Customer per Profile is enough to pay anybody.
   *
   * @throws {Stripe.errors.StripeError} so Req 2.6 leaves verification unchanged.
   */
  async createPayer(
    profileId: string,
    details?: PayerDetails,
    _options?: PayerCreateOptions,
  ): Promise<Payer> {
    const customer = await this.stripe.customers.create(
      {
        name: details?.displayName,
        email: details?.email,
        phone: details?.mobile,
        metadata: { cardtrade_profile_id: profileId },
      },
      // Idempotent per Profile: a retry after a timeout returns the same
      // Customer instead of creating a duplicate payer.
      { idempotencyKey: `payer:${profileId}` },
    );

    return { payerId: customer.id, profileId };
  }

  /**
   * Vault a payment method against a Customer so later charges (collateral
   * holds, cash-sale collections) have a source to draw on.
   *
   * `token` carries a Stripe PaymentMethod id (`pm_...`) produced by Stripe.js
   * or a SetupIntent — raw card details never reach our server. Unlike the
   * single-use CaptureJS tokens Pinch issued, a PaymentMethod is durable, so it
   * is attached and set as the Customer's default rather than exchanged for a
   * separate vaulted-source id.
   *
   * @throws {Stripe.errors.StripeError} when Stripe rejects the method.
   */
  async attachPaymentSource(params: {
    payerId: string;
    token: string;
    sourceType: 'credit-card' | 'bank-account';
    ipAddress?: string;
  }): Promise<{ sourceId: string }> {
    const method = await this.stripe.paymentMethods.attach(params.token, {
      customer: params.payerId,
    });

    await this.stripe.customers.update(params.payerId, {
      invoice_settings: { default_payment_method: method.id },
    });

    return { sourceId: method.id };
  }

  /**
   * Open a Stripe SetupIntent so the browser can vault a card via Payment
   * Element (Req 2.1, 5.4).
   *
   * This replaces the CaptureJS arrangement wholesale. Under Pinch we rendered
   * our own card number/CVC/expiry inputs and validated them before handing the
   * values to a tokeniser; with Payment Element those fields live inside a
   * Stripe-owned iframe, so card data never touches our DOM, our zod schemas, or
   * our form state.
   *
   * `usage: 'off_session'` matters: collateral holds and dispute captures happen
   * long after the cardholder has gone, so the mandate has to permit it.
   *
   * @throws {Stripe.errors.StripeError} when the intent cannot be created.
   */
  async beginInstrumentSetup(params: { payerId: string }): Promise<InstrumentSetup> {
    const publishableKey = this.opts.config.publishableKey;
    if (!publishableKey) {
      throw new Error(
        '[payments] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set, so the browser cannot ' +
          'initialise Stripe.js to collect a card.',
      );
    }

    const intent = await this.stripe.setupIntents.create({
      customer: params.payerId,
      payment_method_types: CARD_ONLY,
      usage: 'off_session',
      metadata: { cardtrade_payer_id: params.payerId },
    });

    if (!intent.client_secret) {
      throw new Error('[payments] Stripe returned a SetupIntent with no client secret.');
    }

    return { setupId: intent.id, clientSecret: intent.client_secret, publishableKey };
  }

  /**
   * Confirm a completed SetupIntent and report the vaulted card.
   *
   * The brand and last4 are read back FROM Stripe rather than accepted from the
   * client, so the saved-method label cannot be spoofed. Ownership is checked
   * against `payerId` before anything is returned.
   *
   * @throws {Error} when the setup is unfinished or belongs to another payer.
   */
  async completeInstrumentSetup(params: {
    payerId: string;
    setupId: string;
  }): Promise<VaultedInstrument> {
    const intent = await this.stripe.setupIntents.retrieve(params.setupId, {
      expand: ['payment_method'],
    });

    const owner = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
    if (owner !== params.payerId) {
      throw new Error('[payments] SetupIntent does not belong to this payer.');
    }
    if (intent.status !== 'succeeded') {
      throw new Error(`[payments] SetupIntent is ${intent.status}, not succeeded.`);
    }

    const method = intent.payment_method;
    if (!method || typeof method === 'string') {
      throw new Error('[payments] SetupIntent succeeded without an attached payment method.');
    }

    // Make it the default so `placeHold` / `requestTransfer` pick it up without
    // needing to be told which instrument to use.
    await this.stripe.customers.update(params.payerId, {
      invoice_settings: { default_payment_method: method.id },
    });

    return {
      sourceId: method.id,
      brand: method.card?.brand,
      last4: method.card?.last4,
    };
  }

  // --- Collateral holds ----------------------------------------------------

  /**
   * Authorise `amount` of a Trader's collateral (Req 5.4) without moving funds.
   *
   * Returns `FAILED` rather than throwing so the caller runs the existing
   * HOLDS_FAILED compensating path (Req 5.6) — e.g. the Customer has no vaulted
   * payment method, or the issuer declined the authorisation.
   */
  async placeHold(params: { payerId: string; amount: Cents; ref: string }): Promise<PreAuthHold> {
    if (!params.payerId) return failedHold(params.payerId, params.amount);

    try {
      const paymentMethod = await this.defaultPaymentMethod(params.payerId);
      if (!paymentMethod) {
        // No vaulted instrument: nothing to authorise against. Surface this the
        // same way a decline is surfaced so the orchestrator compensates once.
        return failedHold(params.payerId, params.amount);
      }

      const intent = await this.stripe.paymentIntents.create(
        {
          amount: params.amount,
          currency: this.opts.config.currency,
          customer: params.payerId,
          payment_method: paymentMethod,
          payment_method_types: CARD_ONLY,
          capture_method: 'manual',
          // DO NOT add `payment_method_options.card.request_extended_authorization`
          // here without first confirming account eligibility.
          //
          // Extended authorisations would raise the window from ~7 days to as much
          // as 30, which is exactly what the DELIVERY trade path needs. But
          // requesting it on this account fails the ENTIRE PaymentIntent with
          // "This account is not eligible for the requested card features" —
          // verified against the test API by scripts/smoke-stripe-test.ts, which
          // went from an ACTIVE hold to FAILED the moment it was added.
          //
          // `if_available` does NOT protect against this. It degrades gracefully
          // for network and merchant-category ineligibility, not for account-level
          // ineligibility, so it is not the safe no-op it appears to be.
          //
          // Prerequisites before revisiting:
          //  * IC+ pricing. Stripe gates the feature to it; blended pricing needs
          //    a support request.
          //  * Visa extends only CUSTOMER-initiated transactions outside the
          //    travel categories. This hold is `off_session`, hence
          //    merchant-initiated, so Visa would refuse to extend it even on IC+
          //    unless holds move to being placed while the Trader is present.
          //    Mastercard documents no such restriction.
          confirm: true,
          off_session: true,
          description: 'NoDitto collateral hold',
          metadata: metadataFor('HOLD', params.ref),
          expand: ['latest_charge'],
        },
        // `ref` is `hold:<tradeId>:<traderId>` — stable for this trade and
        // trader, so a retry cannot double-authorise the same collateral.
        { idempotencyKey: `hold:${params.ref}` },
      );

      // `requires_capture` is the authorised-but-uncaptured state. Anything else
      // (requires_action for an SCA challenge, canceled, processing) is not a
      // live hold as far as the escrow contract is concerned.
      if (intent.status !== 'requires_capture') {
        return failedHold(params.payerId, params.amount);
      }

      return {
        holdId: intent.id,
        payerId: params.payerId,
        amount: intent.amount_capturable || params.amount,
        status: 'ACTIVE',
        expiresAt: captureBefore(intent),
      };
    } catch (err) {
      this.warn('placeHold', params.ref, err);
      return failedHold(params.payerId, params.amount);
    }
  }

  /**
   * Release collateral at $0 cost (Req 6.7, 7.5, 8.5) by cancelling the
   * authorisation. No funds ever moved, so there is nothing to refund.
   */
  async voidHold(holdId: string): Promise<PreAuthHold> {
    try {
      const intent = await this.stripe.paymentIntents.cancel(holdId);
      return {
        holdId,
        payerId: typeof intent.customer === 'string' ? intent.customer : '',
        amount: intent.amount,
        status: intent.status === 'canceled' ? 'VOIDED' : 'FAILED',
      };
    } catch (err) {
      this.warn('voidHold', holdId, err);
      // A void that cannot be confirmed must not claim success: the caller's
      // compensating logic depends on knowing collateral may still be live.
      return { holdId, payerId: '', amount: 0, status: 'FAILED' };
    }
  }

  /**
   * Take `amount` as the Friction_Tax (Req 7.2).
   *
   * Capturing less than the authorised amount makes Stripe release the
   * remainder automatically, so this is a single call with no compensating
   * refund — the behaviour the Pinch binding had to emulate by refunding
   * (charged - amount).
   */
  async partialCapture(params: { holdId: string; amount: Cents }): Promise<CaptureResult> {
    try {
      const intent = await this.stripe.paymentIntents.capture(
        params.holdId,
        { amount_to_capture: params.amount },
        { idempotencyKey: `capture:partial:${params.holdId}:${params.amount}` },
      );

      return {
        captureId: chargeIdOf(intent) ?? params.holdId,
        holdId: params.holdId,
        amount: intent.amount_received || params.amount,
        status: intent.status === 'succeeded' ? 'SETTLED' : 'FAILED',
      };
    } catch (err) {
      this.warn('partialCapture', params.holdId, err);
      return { captureId: '', holdId: params.holdId, amount: params.amount, status: 'FAILED' };
    }
  }

  /** Capture the entire authorisation on Objective_Fraud (Req 8.2). */
  async fullCapture(holdId: string): Promise<CaptureResult> {
    try {
      const intent = await this.stripe.paymentIntents.capture(
        holdId,
        {},
        { idempotencyKey: `capture:full:${holdId}` },
      );

      return {
        captureId: chargeIdOf(intent) ?? holdId,
        holdId,
        amount: intent.amount_received || intent.amount,
        status: intent.status === 'succeeded' ? 'SETTLED' : 'FAILED',
      };
    } catch (err) {
      this.warn('fullCapture', holdId, err);
      return { captureId: '', holdId, amount: 0, status: 'FAILED' };
    }
  }

  // --- Transfers -----------------------------------------------------------

  /**
   * Collect `amount` and, when settling to a Seller, forward it on (Req 4.2, 8.3).
   *
   * This is Stripe's separate-charges-and-transfers flow: the platform collects
   * first, then transfers to the recipient's connected account. That shape is
   * required here because the platform must be able to hold funds before release
   * AND, on Objective_Fraud, pay captured collateral to the VICTIM rather than to
   * whoever paid (Req 8.3) — neither is possible with destination charges.
   *
   * `applicationFee` is the flat Platform_Fee (Req 4.7). Stripe's
   * `application_fee_amount` is not compatible with separate charges and
   * transfers, so the fee is retained by transferring `amount - applicationFee`
   * and leaving the difference in the platform balance.
   */
  async requestTransfer(params: {
    payerId: string;
    amount: Cents;
    ref: string;
    nonce: string;
    merchantRef?: string;
    applicationFee?: Cents;
  }): Promise<TransferResult> {
    try {
      const paymentMethod = await this.defaultPaymentMethod(params.payerId);
      if (!paymentMethod) return { transferId: '', amount: params.amount, status: 'FAILED' };

      const intent = await this.stripe.paymentIntents.create(
        {
          amount: params.amount,
          currency: this.opts.config.currency,
          customer: params.payerId,
          payment_method: paymentMethod,
          payment_method_types: CARD_ONLY,
          confirm: true,
          off_session: true,
          description: 'NoDitto payment',
          metadata: metadataFor('TRANSFER', params.ref),
          expand: ['latest_charge'],
        },
        // The persisted nonce, reused verbatim on retry (never regenerated).
        { idempotencyKey: params.nonce },
      );

      if (intent.status !== 'succeeded') {
        return { transferId: intent.id, amount: params.amount, status: 'FAILED' };
      }

      // Collect-only: collateral and platform-mode sales stay in the platform
      // balance, so there is no onward transfer to make.
      const settleDirect = params.merchantRef && this.opts.config.payoutMode === 'direct';
      if (!settleDirect) {
        return { transferId: intent.id, amount: intent.amount_received, status: 'SETTLED' };
      }

      const sourceTransaction = chargeIdOf(intent);
      const net = Math.max(params.amount - (params.applicationFee ?? 0), 0);

      const transfer = await this.stripe.transfers.create(
        {
          amount: net,
          currency: this.opts.config.currency,
          destination: params.merchantRef!,
          // Ties the transfer to the charge, so it succeeds even before the
          // funds have settled into the platform's available balance.
          ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
          metadata: metadataFor('TRANSFER', params.ref),
        },
        { idempotencyKey: `${params.nonce}:transfer` },
      );

      return { transferId: transfer.id, amount: net, status: 'SETTLED' };
    } catch (err) {
      this.warn('requestTransfer', params.ref, err);
      return { transferId: '', amount: params.amount, status: 'FAILED' };
    }
  }

  /**
   * Release escrowed funds from the platform balance to a Seller (Req 4.3).
   *
   * `transfers.create` ONLY — deliberately no PaymentIntent. The Buyer was
   * already charged when the sale was agreed, so creating an intent here would
   * charge them twice for one purchase.
   *
   * Where the original charge is known, it is passed as `source_transaction` so
   * the transfer draws directly against it. Without that, Stripe requires the
   * funds to have cleared into the available balance first, which for card
   * payments can be days — the payout would fail with insufficient funds even
   * though the money is genuinely there.
   */
  async payoutToMerchant(params: {
    merchantRef: string;
    amount: Cents;
    ref: string;
    nonce: string;
    sourcePaymentRef?: string;
  }): Promise<TransferResult> {
    try {
      const sourceTransaction = params.sourcePaymentRef
        ? await this.chargeForPaymentRef(params.sourcePaymentRef)
        : undefined;

      const transfer = await this.stripe.transfers.create(
        {
          amount: params.amount,
          currency: this.opts.config.currency,
          destination: params.merchantRef,
          ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
          metadata: metadataFor('TRANSFER', params.ref),
        },
        { idempotencyKey: params.nonce },
      );

      return { transferId: transfer.id, amount: params.amount, status: 'SETTLED' };
    } catch (err) {
      this.warn('payoutToMerchant', params.ref, err);
      return { transferId: '', amount: params.amount, status: 'FAILED' };
    }
  }

  /**
   * Read the platform's own Stripe balance.
   *
   * Sums only the components denominated in the configured currency. Stripe returns a
   * balance array with one entry per currency, and adding cents across currencies would
   * produce a meaningless total that happens to look reassuring.
   *
   * `pending` is counted alongside `available` because card funds clear over days: a
   * platform that collected a payment this morning holds that money, it simply cannot
   * pay it out yet. Excluding it would report a shortfall on a healthy account.
   */
  async getPlatformBalance(): Promise<PlatformBalance> {
    const currency = this.opts.config.currency;
    try {
      const balance = await this.stripe.balance.retrieve();
      const sumFor = (entries: { amount: number; currency: string }[] | undefined) =>
        (entries ?? [])
          .filter((entry) => entry.currency === currency)
          .reduce((total, entry) => total + entry.amount, 0);

      return {
        availableCents: sumFor(balance.available),
        pendingCents: sumFor(balance.pending),
        currency,
        status: 'READ',
      };
    } catch (err) {
      this.warn('getPlatformBalance', 'balance', err);
      return {
        availableCents: 0,
        pendingCents: 0,
        currency,
        status: 'UNAVAILABLE',
        reason: err instanceof Error ? err.message : 'Balance read failed',
      };
    }
  }

  /**
   * Return collected funds to the Buyer (Req 4.15).
   *
   * Refunds the PaymentIntent that collected the money. Omitting `amount` lets
   * Stripe return everything still refundable, which is what a full
   * dispute-in-favour-of-buyer resolution wants; passing it refunds part and leaves
   * the rest available to release to the Seller.
   *
   * `reverse_transfer` is deliberately NOT set. Under separate charges and
   * transfers the Seller has not been paid yet when a dispute is resolved — the
   * release is gated on completion — so there is no transfer to claw back. Setting
   * it would fail on a charge that was never forwarded.
   *
   * Keyed on the caller's persisted `nonce`, so a retry after an ambiguous timeout
   * is deduplicated by Stripe rather than refunding the Buyer twice out of platform
   * funds. Failure is reported through `status`, never thrown, so the caller can
   * leave the sale DISPUTED and try again.
   */
  async refundPayment(params: {
    paymentRef: string;
    amount?: Cents;
    nonce: string;
    ref?: string;
  }): Promise<RefundResult> {
    const requested = params.amount ?? 0;
    try {
      const refund = await this.stripe.refunds.create(
        {
          payment_intent: params.paymentRef,
          ...(params.amount != null ? { amount: params.amount } : {}),
          metadata: metadataFor('REFUND', params.ref ?? params.paymentRef),
        },
        { idempotencyKey: params.nonce },
      );

      // `pending` is a success path: card refunds routinely settle asynchronously,
      // and treating it as a failure would make the caller retry a refund that is
      // already on its way.
      const settled = refund.status === 'succeeded' || refund.status === 'pending';
      return {
        refundId: refund.id,
        amount: refund.amount,
        status: settled ? 'SETTLED' : 'FAILED',
        ...(settled ? {} : { reason: refund.failure_reason ?? refund.status ?? undefined }),
      };
    } catch (err) {
      this.warn('refundPayment', params.ref ?? params.paymentRef, err);
      return {
        refundId: '',
        amount: requested,
        status: 'FAILED',
        reason: err instanceof Error ? err.message : undefined,
      };
    }
  }

  /** Resolve the charge behind a collection PaymentIntent, for `source_transaction`. */
  private async chargeForPaymentRef(paymentRef: string): Promise<string | undefined> {
    if (!paymentRef.startsWith('pi_')) return undefined;
    try {
      const intent = await this.stripe.paymentIntents.retrieve(paymentRef, {
        expand: ['latest_charge'],
      });
      return chargeIdOf(intent);
    } catch {
      // Not fatal: fall back to drawing on the available balance.
      return undefined;
    }
  }

  // --- Seller payout accounts (Connect) ------------------------------------

  /**
   * Open a connected account so a User can RECEIVE money — a Cash_Sale Seller,
   * or a fraud victim paid captured collateral (Req 4, 8.3).
   *
   * Deliberately a RECIPIENT-shaped account: it requests only `transfers`, never
   * `card_payments`. A marketplace connected account never accepts payments
   * itself (the platform is merchant of record), and requesting payment
   * capabilities would impose a much heavier onboarding burden for no benefit.
   *
   * `controller` is set explicitly rather than using the legacy `type`
   * parameter. Platform-owned losses are mandatory for separate charges and
   * transfers, and Stripe requires platform-owned fees alongside it.
   *
   * NOTE ON BANK DETAILS. `details.bankAccountBsb` / `bankAccountNumber` are
   * deliberately IGNORED. Pinch had no tokenised equivalent for a settlement
   * account, so `POST /merchants/managed` took raw BSB/account numbers in the
   * request body and seller onboarding had to accept them. Stripe collects them
   * inside its own onboarding flow, so they never need to reach our server at
   * all. The fields remain on the interface only until `PayoutOnboarding` stops
   * collecting them; nothing here reads, persists, or logs them.
   */
  async createManagedMerchant(details: ManagedMerchantDetails): Promise<ManagedMerchant> {
    const body: Stripe.V2.Core.AccountCreateParams = {
      contact_email: details.businessEmail,
      display_name: details.tradingName || details.legalEntityName,
      dashboard: 'express',
      // RECIPIENT only — the account receives funds but is never merchant of
      // record. Requesting a `merchant` configuration would drag the Seller
      // through far heavier onboarding for a capability they never use.
      configuration: {
        recipient: {
          capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
        },
      },
      defaults: {
        currency: this.opts.config.currency,
        // Platform collects fees and carries negative-balance liability, which
        // separate charges and transfers requires.
        responsibilities: {
          fees_collector: 'application',
          losses_collector: 'application',
        },
      },
      identity: { country: 'au', entity_type: 'individual' },
      include: ['identity', 'configuration.recipient', 'requirements'],
      metadata: {
        // Stamped so an account whose reference we failed to persist can still be
        // traced back to the Profile that opened it. Without it an orphaned
        // account is only identifiable by an email address.
        cardtrade_profile_id: details.profileId,
        ...(details.legalEntityName ? { cardtrade_stated_name: details.legalEntityName } : {}),
        ...(details.tradingName ? { cardtrade_trading_name: details.tradingName } : {}),
      },
    };

    // Keyed on the Profile AND a fingerprint of the request, because Stripe binds
    // a key to the exact body it first saw and rejects any reuse with a different
    // one. A retry of the identical request still replays — which is the whole
    // point of the key — but a changed body (a new display name, or an edit to
    // this call) takes a new key instead of deadlocking onboarding until the old
    // key expires. Scoping to `profileId` rather than the email also means a
    // recreated Profile is a new subject rather than a collision with a dead one.
    const account = await this.stripe.v2.core.accounts.create(body, {
      idempotencyKey: `merchant:${details.profileId}:${fingerprint(body)}`,
    });

    return fromV2Account(account);
  }

  /**
   * Start Stripe-hosted onboarding for a connected account.
   *
   * Stripe collects the legal entity, government registration, date of birth,
   * address, and disbursement bank account on its own pages, then returns the
   * User to `returnUrl`. Approval arrives asynchronously on `account.updated`;
   * returning from the flow does NOT by itself mean the account can be paid, so
   * callers must keep gating on `settlementsEnabled`.
   *
   * In test mode Stripe approves immediately, which is why no compliance
   * simulator is needed here — Pinch required one only because its compliance
   * step was a human review with no test hook.
   *
   * @throws {Stripe.errors.StripeError} when the link cannot be created.
   */
  async createMerchantOnboardingLink(params: {
    merchantRef: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string; expiresAt?: string }> {
    const link = await this.stripe.v2.core.accountLinks.create({
      account: params.merchantRef,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['recipient'],
          return_url: params.returnUrl,
          refresh_url: params.refreshUrl,
          // Ask for everything Stripe will eventually need, not just what is due
          // right now, so a Seller is not bounced back for more detail later.
          collection_options: { fields: 'eventually_due' },
        },
      },
    });

    return { url: link.url };
  }

  /**
   * Re-read a connected account's onboarding state (polling fallback for the
   * `account.updated` webhook).
   */
  async getManagedMerchant(merchantRef: string): Promise<ManagedMerchant | null> {
    try {
      const account = await this.stripe.v2.core.accounts.retrieve(merchantRef, {
        include: ['identity', 'configuration.recipient', 'requirements'],
      });
      return fromV2Account(account);
    } catch (err) {
      this.warn('getManagedMerchant', merchantRef, err);
      return null;
    }
  }

  // --- Identity ------------------------------------------------------------
  //
  // Deliberately empty. The payer gate that used to live here (a synchronous
  // verification run, plus a hosted Stripe Identity session and a summary read)
  // has been retired. Identity is now the Identity_Gate: Connect onboarding
  // APPROVED with settlements enabled, reported on account.updated and persisted
  // by applyComplianceUpdate along with the provider-verified legal name. That
  // makes identity a piece of state this service already reports rather than a
  // separate call it has to make.

  // --- Internals -----------------------------------------------------------

  /**
   * The Customer's vaulted PaymentMethod, preferring the invoice default and
   * falling back to the most recently attached card. Returns `null` when the
   * Customer has no usable instrument, which callers treat as a hold failure.
   */
  private async defaultPaymentMethod(payerId: string): Promise<string | null> {
    const customer = await this.stripe.customers.retrieve(payerId);
    if ((customer as Stripe.DeletedCustomer).deleted) return null;

    const preferred = (customer as Stripe.Customer).invoice_settings?.default_payment_method;
    if (typeof preferred === 'string' && preferred) return preferred;
    if (preferred && typeof preferred === 'object') return preferred.id;

    const methods = await this.stripe.paymentMethods.list({
      customer: payerId,
      type: 'card',
      limit: 1,
    });
    return methods.data[0]?.id ?? null;
  }

  /** Log a provider failure without leaking credentials or instrument data. */
  private warn(operation: string, ref: string, err: unknown): void {
    const message =
      err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
    console.warn(`[stripe] ${operation} failed for ${ref}: ${message}`);
  }
}

// `isAdultFromDob` was removed here, and its removal is not a dropped safeguard.
//
// It fed `profiles.identity_is_adult`, part of the identity dossier that was withdrawn
// with the rest of the KYC surface; the column itself was dropped in migration 0043, so
// the function had no consumer and no destination. Age assurance on a payout recipient
// is Stripe's own onboarding requirement, evaluated inside Connect — reimplementing it
// from a date of birth would mean reading and holding a birthdate this integration
// deliberately never persists.

/**
 * A short, stable digest of a request body, for use as part of an idempotency key.
 *
 * Key order is normalised so a body that is semantically identical produces the
 * same digest regardless of how it was assembled. It carries no secrets: the
 * bodies fingerprinted here hold a Profile id, an email and display names.
 */
function fingerprint(body: unknown): string {
  const canonical = JSON.stringify(body, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort())
      : value,
  );
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

/** The shape we read off a v2 Account, narrowed to what this module needs. */
interface V2AccountLike {
  id: string;
  identity?: {
    individual?: { given_name?: string | null; surname?: string | null } | null;
  } | null;
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: { stripe_transfers?: { status?: string } | null } | null;
      } | null;
    } | null;
  } | null;
  requirements?: { entries?: Array<{ description?: string | null }> | null } | null;
}

/**
 * Project a v2 Account onto the provider-agnostic {@link ManagedMerchant}.
 *
 * `stripe_transfers.status === 'active'` is the ONLY signal that means money can
 * actually arrive, so it is what `settlementsEnabled` reports and what gates
 * `merchant_status = APPROVED`. A recipient account never accepts payments
 * itself, so `transactionsEnabled` mirrors it rather than reporting a separate
 * charges capability that will never be granted.
 */
function fromV2Account(account: unknown): ManagedMerchant {
  const a = account as V2AccountLike;
  const status =
    a.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ?? 'pending';
  const canSettle = status === 'active';

  const outstanding = (a.requirements?.entries ?? [])
    .map((entry) => entry?.description)
    .filter((description): description is string => Boolean(description));

  const individual = a.identity?.individual;
  const legalName =
    [individual?.given_name, individual?.surname].filter(Boolean).join(' ').trim() || null;

  return {
    merchantRef: a.id,
    complianceStatus: status,
    liveEnabled: canSettle,
    transactionsEnabled: canSettle,
    settlementsEnabled: canSettle,
    legalName,
    ...(outstanding.length ? { notes: `Outstanding: ${outstanding.join('; ')}` } : {}),
  };
}

/** The expanded Charge on an intent, when present. */
function latestCharge(intent: Stripe.PaymentIntent): Stripe.Charge | null {
  const charge = intent.latest_charge;
  return charge && typeof charge === 'object' ? charge : null;
}

/** The charge id on an intent, whether expanded or not. */
function chargeIdOf(intent: Stripe.PaymentIntent): string | undefined {
  const charge = intent.latest_charge;
  if (typeof charge === 'string') return charge;
  return charge?.id;
}

/**
 * When the authorisation lapses, as an ISO-8601 string.
 *
 * Stripe reports this as `capture_before` (a unix timestamp) on the charge's
 * card details. It is only present after the intent is confirmed, and only for
 * card authorisations, which is why {@link PreAuthHold.expiresAt} is optional.
 */
function captureBefore(intent: Stripe.PaymentIntent): string | undefined {
  const seconds = latestCharge(intent)?.payment_method_details?.card?.capture_before;
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : undefined;
}
