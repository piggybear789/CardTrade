// domain/services/pinch/PinchService.ts
//
// The real Pinch Payments binding for the `PaymentService` + `KycService` seam
// (`domain/services/types.ts`). Selected by `PAYMENTS_PROVIDER=pinch` in
// `domain/services/index.ts`; no orchestrator, action, or component changes with
// it, per the service-seam contract.
//
// ESCROW MAPPING (important). The public Pinch API exposes payments, refunds and
// vaulted sources — there is no authorize/void/partial-capture primitive. The
// Pre_Auth_Hold contract is therefore realised as `charge-and-refund`:
//
//   placeHold(amount)              -> POST /payments/realtime for `amount`
//                                     (holdId = the `pmt_...` id)
//   voidHold(holdId)               -> POST /refunds for the full amount
//   partialCapture(holdId, amount) -> POST /refunds for (charged - amount),
//                                     keeping `amount` as the Friction_Tax
//   fullCapture(holdId)            -> keep the charge; no refund issued
//   requestTransfer(amount)        -> POST /payments/realtime for `amount`
//
// Funds really move on `placeHold`, which differs from a true authorization
// hold. See `.kiro/steering/pinch-payments.md`.
//
// FAILURE STYLE. Provider calls that the contract models with a `status` field
// (holds, captures, transfers) never throw: an API error is converted to
// `FAILED`/unchanged status so the orchestrators run their existing compensating
// logic (Req 4.4, 5.6, 7.6, 8.6). `createPayer` does throw, because Req 2.6
// expects a Payer-creation failure to leave KYC_Status untouched.
//
// Server-only module: it holds credentials and performs network I/O.

import type {
  CaptureResult,
  Cents,
  KycResult,
  KycService,
  ManagedMerchant,
  ManagedMerchantDetails,
  Payer,
  PayerCreateOptions,
  PayerDetails,
  PaymentService,
  PreAuthHold,
  TransferResult,
  VerifiedIdentity,
} from '../types';
import type { PinchConfig } from './config';
import { PinchApiError, type PinchClient } from './PinchClient';
import { encodeMetadata, parseRef } from './metadata';

// ---------------------------------------------------------------------------
// Provider response shapes (only the fields we consume)
// ---------------------------------------------------------------------------

interface PinchPayerResponse {
  id: string;
}

interface PinchPaymentResponse {
  id: string;
  amount: number;
  status?: string;
  metadata?: string | null;
  attempts?: Array<{ status?: string; dishonour?: { type?: string; reason?: string } | null }>;
}

interface PinchRefundResponse {
  id: string;
  amount: number;
  status?: string;
}

interface PinchMerchantResponse {
  id: string;
  compliance?: {
    status?: string;
    liveEnabled?: boolean;
    transactionsEnabled?: boolean;
    settlementsEnabled?: boolean;
    merchantNotes?: string | null;
    complianceOfficerNotes?: string | null;
  } | null;
}

/** Map a provider merchant payload onto the contract's {@link ManagedMerchant}. */
function toManagedMerchant(response: PinchMerchantResponse): ManagedMerchant {
  const compliance = response.compliance ?? {};
  return {
    merchantRef: response.id,
    complianceStatus: compliance.status ?? 'new',
    liveEnabled: Boolean(compliance.liveEnabled),
    transactionsEnabled: Boolean(compliance.transactionsEnabled),
    settlementsEnabled: Boolean(compliance.settlementsEnabled),
    notes: compliance.complianceOfficerNotes ?? compliance.merchantNotes ?? undefined,
  };
}

/** Payment statuses that mean the money was successfully taken. */
const COLLECTED_STATUSES = new Set(['approved', 'settled']);

/** Refund statuses that mean the reversal was accepted by Pinch. */
const REFUND_ACCEPTED_STATUSES = new Set(['requested', 'pending', 'submitted', 'completed']);

/**
 * Split a display name into the `firstName` / `lastName` pair Pinch expects.
 * `firstName` is required by `POST /payers`; `lastName` is optional.
 */
function splitName(displayName: string | undefined, fallback: string): {
  firstName: string;
  lastName?: string;
} {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: fallback };
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

export interface PinchServiceOptions {
  client: PinchClient;
  config: PinchConfig;
  /**
   * KYC delegate used for verification runs and verified-identity retrieval.
   * Pinch Glassbox KYC has no public REST API, so `getPaymentService()` supplies
   * the deterministic MockService here while payments run against real Pinch
   * (`PINCH_KYC_MODE=mock`). Absent + `provider` mode -> verification errors.
   */
  kycDelegate?: KycService;
  /** Optional logger for non-fatal provider failures. Defaults to `console`. */
  logger?: Pick<Console, 'warn'>;
}

/**
 * Real Pinch Payments implementation of the payment + KYC contracts.
 */
export class PinchService implements PaymentService, KycService {
  private readonly logger: Pick<Console, 'warn'>;

  constructor(private readonly opts: PinchServiceOptions) {
    this.logger = opts.logger ?? console;
  }

  // -------------------------------------------------------------------------
  // Payer / KYC
  // -------------------------------------------------------------------------

  /**
   * Create a Pinch Payer for a Profile (Req 2.1). The Profile id is stamped into
   * the payer's metadata so provider-side records can be traced back to us.
   *
   * @throws Error when `details.email` is absent (Pinch requires an email
   * address) or when the provider rejects the request — Req 2.6 turns that into
   * "verification could not be started" with KYC_Status unchanged.
   */
  async createPayer(
    profileId: string,
    details?: PayerDetails,
    options?: PayerCreateOptions,
  ): Promise<Payer> {
    const email = details?.email?.trim();
    if (!email) {
      throw new Error(
        'Pinch requires a contact email to create a Payer; none was supplied for this profile.',
      );
    }

    const { firstName, lastName } = splitName(details?.displayName, 'NoDitto');
    const response = await this.opts.client.request<PinchPayerResponse>(
      'POST',
      '/payers',
      {
        firstName,
        ...(lastName ? { lastName } : {}),
        emailAddress: email,
        ...(details?.mobile ? { mobileNumber: details.mobile } : {}),
        // Attaching the source inline creates the payer AND its instrument in one
        // call — the documented way to reuse a token on a sub-merchant.
        ...(options?.source
          ? {
              source: {
                sourceType: options.source.sourceType,
                token: options.source.token,
              },
            }
          : {}),
        metadata: JSON.stringify({ cardtrade: { profileId } }),
      },
      { merchantRef: options?.merchantRef },
    );

    if (!response?.id) {
      throw new Error('Pinch did not return a payer id.');
    }
    return { payerId: response.id, profileId };
  }

  /**
   * Run identity verification (Req 2.2, 2.3). Delegated: Pinch Glassbox KYC is
   * not exposed by the public REST API, so the configured delegate (the
   * deterministic Mock in `PINCH_KYC_MODE=mock`) resolves the outcome while the
   * Payer itself is a real Pinch record.
   */
  async runVerification(payerId: string): Promise<KycResult> {
    if (!this.opts.kycDelegate) {
      throw new Error(
        'Pinch Glassbox KYC is not wired up. Set PINCH_KYC_MODE=mock to use the simulated ' +
          'verification, or supply a KYC delegate.',
      );
    }

    // The outcome is simulated, but the SUBJECT is real: confirm the Payer
    // actually exists on Pinch before reporting a verification result, so a bad
    // or stale payer reference is rejected instead of silently "verified".
    try {
      const payer = await this.opts.client.request<PinchPayerResponse>(
        'GET',
        `/payers/${encodeURIComponent(payerId)}`,
      );
      if (!payer?.id) {
        return { payerId, outcome: 'REJECTED', reason: 'No Pinch payer record was found.' };
      }
    } catch (err) {
      this.warn('runVerification', payerId, err);
      return {
        payerId,
        outcome: 'REJECTED',
        reason: 'The payment provider could not confirm this payer record.',
      };
    }

    return this.opts.kycDelegate.runVerification(payerId);
  }

  /** Verified identity data for a Police_Evidence_Pack (Req 2.5, 8.4). */
  async getVerifiedIdentity(profileId: string): Promise<VerifiedIdentity | null> {
    if (!this.opts.kycDelegate) return null;
    return this.opts.kycDelegate.getVerifiedIdentity(profileId);
  }

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------

  /**
   * Collect `amount` from the payer for a Cash_Sale or victim payout (Req 4.2,
   * 8.3) via a realtime payment against the payer's default source.
   *
   * Returns `FAILED` (never throws) so the caller can compensate per Req 4.4.
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
      const payment = await this.charge({
        payerId: params.payerId,
        amount: params.amount,
        ref: params.ref,
        nonce: params.nonce,
        kind: 'TRANSFER',
        description: `NoDitto payment ${params.ref}`,
        merchantRef: params.merchantRef,
        applicationFee: params.applicationFee,
      });
      return {
        transferId: payment.id,
        amount: payment.amount ?? params.amount,
        status: this.isCollected(payment) ? 'SETTLED' : 'FAILED',
      };
    } catch (err) {
      this.warn('requestTransfer', params.ref, err);
      return { transferId: '', amount: params.amount, status: 'FAILED' };
    }
  }

  /**
   * Place collateral for `amount` (Req 5.4) by CHARGING it via
   * `POST /payments/realtime` against the payer's default source. This is the
   * `charge-and-refund` strategy documented in `.kiro/steering/pinch-payments.md`:
   * the public Pinch API exposes no authorize/pre-auth primitive, so the
   * collateral genuinely moves on `placeHold` and is refunded on `voidHold` /
   * `partialCapture` if the trade completes cleanly. `holdId` is the real
   * `pmt_...` payment id, which every later void/capture call charges against.
   *
   * Returns `FAILED` (never throws) so the caller runs the existing
   * HOLDS_FAILED compensating path (Req 5.6) — e.g. the payer has no usable
   * source, or the charge was dishonoured.
   */
  async placeHold(params: { payerId: string; amount: Cents; ref: string }): Promise<PreAuthHold> {
    if (!params.payerId) {
      return { holdId: '', payerId: params.payerId, amount: params.amount, status: 'FAILED' };
    }
    try {
      const payment = await this.charge({
        payerId: params.payerId,
        amount: params.amount,
        ref: params.ref,
        kind: 'HOLD',
        description: 'NoDitto collateral hold',
      });
      return {
        holdId: payment.id,
        payerId: params.payerId,
        amount: payment.amount ?? params.amount,
        status: this.isCollected(payment) ? 'ACTIVE' : 'FAILED',
      };
    } catch (err) {
      this.warn('placeHold', params.ref, err);
      return { holdId: '', payerId: params.payerId, amount: params.amount, status: 'FAILED' };
    }
  }

  /**
   * Release collateral (Req 6.7, 7.5, 8.5) by refunding the full charged amount
   * via `POST /refunds`. Reads the payment back first so the refund amount is
   * exactly what was actually collected, not merely what was requested.
   */
  async voidHold(holdId: string): Promise<PreAuthHold> {
    try {
      const payment = await this.getPayment(holdId);
      const amount = payment.amount ?? 0;
      const refund = await this.refund(holdId, amount, 'NoDitto collateral released');
      return {
        holdId,
        payerId: '',
        amount,
        status: this.isRefundAccepted(refund) ? 'VOIDED' : 'FAILED',
      };
    } catch (err) {
      this.warn('voidHold', holdId, err);
      // A void that cannot be confirmed must not silently claim success: the
      // caller's compensating logic depends on knowing collateral is still live.
      return { holdId, payerId: '', amount: 0, status: 'FAILED' };
    }
  }

  /**
   * Take `amount` as the Friction_Tax (Req 7.2) by refunding the charged hold
   * MINUS `amount`, so exactly the friction tax remains captured on the
   * merchant's side.
   */
  async partialCapture(params: { holdId: string; amount: Cents }): Promise<CaptureResult> {
    try {
      const payment = await this.getPayment(params.holdId);
      const charged = payment.amount ?? 0;
      const refundAmount = Math.max(charged - params.amount, 0);
      const refund = await this.refund(
        params.holdId,
        refundAmount,
        'NoDitto dispute resolution — friction tax',
      );
      return {
        captureId: params.holdId,
        holdId: params.holdId,
        amount: params.amount,
        status: this.isRefundAccepted(refund) ? 'SETTLED' : 'FAILED',
      };
    } catch (err) {
      this.warn('partialCapture', params.holdId, err);
      return { captureId: '', holdId: params.holdId, amount: params.amount, status: 'FAILED' };
    }
  }

  /**
   * Keep the entire collateral charge on Objective_Fraud (Req 8.2). The funds
   * were already collected when the hold was placed, so this issues no refund —
   * it re-reads the payment to confirm the charge actually cleared before
   * reporting success.
   */
  async fullCapture(holdId: string): Promise<CaptureResult> {
    try {
      const payment = await this.getPayment(holdId);
      return {
        captureId: holdId,
        holdId,
        amount: payment.amount ?? 0,
        status: this.isCollected(payment) ? 'SETTLED' : 'FAILED',
      };
    } catch (err) {
      this.warn('fullCapture', holdId, err);
      return { captureId: '', holdId, amount: 0, status: 'FAILED' };
    }
  }

  /**
   * Vault a tokenised card or bank account against a Payer so subsequent charges
   * (collateral holds, cash-sale transfers) have a source to draw on.
   *
   * The token must come from CaptureJS — raw instrument details never reach our
   * server. CaptureJS tokens are single-use, so the returned `src_...` id is what
   * gets reused for later charges.
   *
   * @throws {PinchApiError} when the provider rejects the token or payer.
   */
  async attachPaymentSource(params: {
    payerId: string;
    token: string;
    sourceType: 'credit-card' | 'bank-account';
    ipAddress?: string;
  }): Promise<{ sourceId: string }> {
    const response = await this.opts.client.request<{ id?: string }>(
      'POST',
      `/payers/${encodeURIComponent(params.payerId)}/sources`,
      {
        sourceType: params.sourceType,
        token: params.token,
        ...(params.ipAddress ? { ipAddress: params.ipAddress } : {}),
      },
    );
    if (!response?.id) {
      throw new Error('Pinch did not return a payment source id.');
    }
    return { sourceId: response.id };
  }

  // -------------------------------------------------------------------------
  // Managed Merchants (payees)
  // -------------------------------------------------------------------------

  /**
   * Open a Managed Merchant so a User can be paid.
   *
   * Pinch creates the payee first and enables it only after merchant compliance.
   * Current guidance requires identity, financial, and business-registration
   * evidence before live approval. `ipAddress`/`userAgent` are required for AML.
   *
   * The returned merchant has every enable flag false: identity and business
   * verification happen after creation, and the decision arrives via the
   * `compliance-updated` webhook.
   *
   * @throws {PinchApiError} when the submission is rejected.
   */
  async createManagedMerchant(details: ManagedMerchantDetails): Promise<ManagedMerchant> {
    const response = await this.opts.client.request<PinchMerchantResponse>(
      'POST',
      '/merchants/managed',
      {
        companyName: details.tradingName ?? details.legalEntityName,
        legalEntityName: details.legalEntityName,
        companyEmail: details.businessEmail,
        bankAccountRoutingNumber: details.bankAccountBsb.replace(/[\s-]/g, ''),
        bankAccountNumber: details.bankAccountNumber.replace(/[\s-]/g, ''),
        ...(details.bankAccountName ? { bankAccountName: details.bankAccountName } : {}),
        ...(details.businessRegistrationNumber
          ? { companyRegistrationNumber: details.businessRegistrationNumber }
          : {}),
        ...(details.organisationType ? { organisationType: details.organisationType } : {}),
        ...(details.natureOfBusiness ? { natureOfBusiness: details.natureOfBusiness } : {}),
        country: details.contact.country ?? 'AU',
        contacts: [
          {
            isPrimaryContact: true,
            contactType: 'owner',
            email: details.contact.email,
            ...(details.contact.firstName ? { firstName: details.contact.firstName } : {}),
            ...(details.contact.lastName ? { lastName: details.contact.lastName } : {}),
            ...(details.contact.phone ? { phone: details.contact.phone } : {}),
            ...(details.contact.dateOfBirth ? { dob: details.contact.dateOfBirth } : {}),
            ...(details.contact.streetAddress
              ? { streetAddress: details.contact.streetAddress }
              : {}),
            ...(details.contact.suburb ? { suburb: details.contact.suburb } : {}),
            ...(details.contact.state ? { state: details.contact.state } : {}),
            ...(details.contact.postcode ? { postcode: details.contact.postcode } : {}),
            country: details.contact.country ?? 'AU',
          },
        ],
        ipAddress: details.ipAddress,
        userAgent: details.userAgent,
      },
    );

    if (!response?.id) {
      throw new Error('Pinch did not return a managed merchant id.');
    }
    return toManagedMerchant(response);
  }

  /**
   * Re-read a sub-merchant's compliance state. Used as a polling fallback when a
   * `compliance-updated` webhook was missed.
   */
  async getManagedMerchant(merchantRef: string): Promise<ManagedMerchant | null> {
    try {
      const merchants = await this.opts.client.request<PinchMerchantResponse[]>(
        'GET',
        '/merchants/managed',
      );
      const match = Array.isArray(merchants)
        ? merchants.find((m) => m?.id === merchantRef)
        : undefined;
      return match ? toManagedMerchant(match) : null;
    } catch (err) {
      this.warn('getManagedMerchant', merchantRef, err);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Execute a realtime payment carrying our CardTrade metadata and using `ref`
   * as the nonce, so a network-level retry cannot double-charge (the provider
   * returns the original payment for a repeated nonce).
   */
  private charge(params: {
    payerId: string;
    amount: Cents;
    ref: string;
    /** Persisted provider idempotency key. Defaults to ref for hold calls. */
    nonce?: string;
    kind: 'HOLD' | 'TRANSFER';
    description: string;
    /** Collect into this sub-merchant instead of the platform merchant. */
    merchantRef?: string;
    /** Platform cut retained by the parent merchant (sub-merchant charges only). */
    applicationFee?: Cents;
  }): Promise<PinchPaymentResponse> {
    return this.opts.client.request<PinchPaymentResponse>(
      'POST',
      '/payments/realtime',
      {
        payerId: params.payerId,
        amount: params.amount,
        description: this.withDishonourTrigger(params.description).slice(0, 999),
        nonce: params.nonce ?? params.ref,
        // `applicationFee` only has meaning on a Managed Merchant charge; sending
        // it on a platform-merchant charge would be rejected.
        ...(params.merchantRef && params.applicationFee !== undefined
          ? { applicationFee: params.applicationFee }
          : {}),
        metadata: encodeMetadata({
          kind: params.kind,
          ref: params.ref,
          ...parseRef(params.ref),
        }),
      },
      { merchantRef: params.merchantRef },
    );
  }

  /**
   * Append the configured test dishonour code to a payment description.
   *
   * Pinch's test environment fails a payment with a specific dishonour code when
   * that code appears, prefixed with `#`, in the description. This is how the
   * HOLDS_FAILED / transfer-failed compensating paths are exercised against the
   * real API. No-op unless `PINCH_TEST_DISHONOUR_CODE` is set in `test`.
   */
  private withDishonourTrigger(description: string): string {
    const code = this.opts.config.testDishonourCode;
    if (!code || this.opts.config.environment !== 'test') return description;
    return `${description} #${code}`;
  }

  /** Read a payment back from Pinch (used to size refunds and confirm status). */
  private getPayment(paymentId: string): Promise<PinchPaymentResponse> {
    if (!paymentId) return Promise.reject(new Error('A Pinch payment id is required.'));
    return this.opts.client.request<PinchPaymentResponse>(
      'GET',
      `/payments/${encodeURIComponent(paymentId)}`,
    );
  }

  /** Issue a refund against a payment. `nonce` makes the reversal idempotent. */
  private refund(paymentId: string, amount: Cents, reason: string): Promise<PinchRefundResponse> {
    return this.opts.client.request<PinchRefundResponse>('POST', '/refunds', {
      paymentId,
      amount,
      reason,
      nonce: `refund:${paymentId}:${amount}`,
    });
  }

  /** True when a payment (or its current attempt) shows the funds were taken. */
  private isCollected(payment: PinchPaymentResponse): boolean {
    const status = payment.status?.toLowerCase();
    if (status && COLLECTED_STATUSES.has(status)) return true;
    const attemptStatus = payment.attempts?.[payment.attempts.length - 1]?.status?.toLowerCase();
    return Boolean(attemptStatus && COLLECTED_STATUSES.has(attemptStatus));
  }

  /** True when Pinch accepted the refund request. */
  private isRefundAccepted(refund: PinchRefundResponse): boolean {
    const status = refund?.status?.toLowerCase();
    // A refund with no status echoed back still carries an id on success.
    if (!status) return Boolean(refund?.id);
    return REFUND_ACCEPTED_STATUSES.has(status);
  }

  /** Log a non-fatal provider failure without leaking credentials. */
  private warn(operation: string, ref: string, err: unknown): void {
    const detail =
      err instanceof PinchApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : 'unknown error';
    this.logger.warn(`[pinch] ${operation} failed for ${ref}: ${detail}`);
  }
}
