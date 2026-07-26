// domain/orchestrator/merchantOnboarding.ts
//
// The Managed Merchant (sub-merchant) onboarding core.
//
// WHY IT EXISTS. Pinch settles funds only into a merchant's own bank account, so
// a User who RECEIVES money - a Cash_Sale seller (Req 4.2) or a fraud victim
// being paid captured collateral (Req 8.3) - must exist as a sub-merchant under
// the platform's parent merchant. Provider identity verification happens as part
// of that onboarding.
//
// `merchant_status` is now the sole verification signal in the app
// (`domain/bond/bondPolicy.ts` reads it via `public_profiles.is_verified` to
// decide Bond exemption). The standalone KYC payer check that used to gate
// paying/listing/trading separately has been retired - it never ran a real
// provider compliance decision, whereas this onboarding flow does.
// A trade-only User never needs the second one.
//
// Pure and injectable like the other orchestrators: it depends on a repository
// interface plus the payment-service seam, never on `server-only`/Supabase, so
// it is testable against fakes. The Supabase binding lives in
// `supabaseMerchantRepository.ts`.

import type {
  ManagedMerchant,
  ManagedMerchantDetails,
  PaymentService,
} from '../services/types';

/** Application-facing onboarding state (mirrors the `merchant_status` enum). */
export type MerchantStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

/** The sub-merchant facts stored against a Profile. */
export interface MerchantRecord {
  profileId: string;
  merchantRef: string | null;
  merchantStatus: MerchantStatus;
  complianceStatus?: string | null;
  liveEnabled: boolean;
  transactionsEnabled: boolean;
  settlementsEnabled: boolean;
  notes?: string | null;
  /** Buyer-safe identity submitted for provider compliance. */
  legalEntityName?: string | null;
  tradingName?: string | null;
  registrationNumber?: string | null;
  organisationType?: string | null;
  identityVersion?: string | null;
  identityDisclosureConsentedAt?: string | null;
  identityVerifiedAt?: string | null;
}

/** The narrow provider-approved seller identity that may be shown to buyers. */
export interface SellerIdentityDisclosure {
  sellerId: string;
  version: string;
  legalEntityName: string;
  tradingName: string | null;
  registrationNumber: string;
  organisationType: string | null;
  verifiedAt: string;
}

/** Return a buyer-safe disclosure only when provider compliance approved it. */
export function sellerIdentityDisclosure(
  merchant: MerchantRecord | null,
): SellerIdentityDisclosure | null {
  if (
    !merchant ||
    merchant.merchantStatus !== 'APPROVED' ||
    !merchant.identityDisclosureConsentedAt ||
    !merchant.identityVerifiedAt ||
    !merchant.identityVersion ||
    !merchant.legalEntityName ||
    !merchant.registrationNumber
  ) {
    return null;
  }

  return {
    sellerId: merchant.profileId,
    version: merchant.identityVersion,
    legalEntityName: merchant.legalEntityName,
    tradingName: merchant.tradingName ?? null,
    registrationNumber: merchant.registrationNumber,
    organisationType: merchant.organisationType ?? null,
    verifiedAt: merchant.identityVerifiedAt,
  };
}

/** Fields persisted by an onboarding/compliance update. */
export interface MerchantUpdate {
  profileId: string;
  merchantRef?: string | null;
  merchantStatus: MerchantStatus;
  complianceStatus?: string | null;
  liveEnabled?: boolean;
  transactionsEnabled?: boolean;
  settlementsEnabled?: boolean;
  notes?: string | null;
  legalEntityName?: string | null;
  tradingName?: string | null;
  registrationNumber?: string | null;
  organisationType?: string | null;
  identityVersion?: string | null;
  identityDisclosureConsentedAt?: string | null;
  identityVerifiedAt?: string | null;
  /** Set when the sub-merchant is first submitted. */
  submittedAt?: string;
  /** Set when the provider records a decision. */
  decisionAt?: string;
}

/** Data-access seam for the merchant onboarding core. */
export interface MerchantRepository {
  /** Load a Profile's sub-merchant state, or `null` if the Profile is missing. */
  loadMerchant(profileId: string): Promise<MerchantRecord | null>;
  /** Persist a sub-merchant state update. */
  updateMerchant(update: MerchantUpdate): Promise<void>;
  /** Resolve a Profile id from a provider merchant reference (webhook path). */
  findProfileIdByMerchantRef(merchantRef: string): Promise<string | null>;
}

/**
 * Typed failure codes for onboarding.
 * - `PROFILE_NOT_FOUND`   - no Profile for the id.
 * - `ALREADY_ONBOARDED`   - a sub-merchant already exists (PENDING or APPROVED),
 *                           so a second submission is rejected.
 * - `NOT_SUPPORTED`       - the active provider has no sub-merchant capability.
 * - `SUBMISSION_FAILED`   - the provider rejected the submission; state unchanged.
 */
export type MerchantOnboardingError =
  | 'PROFILE_NOT_FOUND'
  | 'ALREADY_ONBOARDED'
  | 'DISCLOSURE_CONSENT_REQUIRED'
  | 'NOT_SUPPORTED'
  | 'SUBMISSION_FAILED';

/** Discriminated result of an onboarding operation. */
export type MerchantOnboardingResult =
  | { ok: true; merchant: MerchantRecord }
  | { ok: false; error: MerchantOnboardingError; detail?: string };

/** Dependencies injected into the onboarding core. */
export interface MerchantOnboardingDeps {
  repository: MerchantRepository;
  /** The payment provider seam; must expose `createManagedMerchant`. */
  payments: PaymentService;
  /** Injectable clock for deterministic timestamps. */
  now?: () => Date;
}

/** States from which a User may submit sub-merchant onboarding. */
const SUBMITTABLE: ReadonlySet<MerchantStatus> = new Set<MerchantStatus>(['NONE', 'REJECTED']);

/**
 * Derive the application-facing status from the provider's compliance state.
 *
 * APPROVED requires settlements to be enabled - that is the only flag that means
 * money can actually reach the User. A declined/rejected provider status is
 * REJECTED; anything else is still PENDING.
 */
export function deriveMerchantStatus(merchant: {
  complianceStatus?: string;
  settlementsEnabled: boolean;
  /**
   * True when the provider reports the merchant account itself as active. The
   * documented `compliance-updated` payload carries `SubmissionStatus` +
   * `MerchantStatus` and NOT the enable flags, so this is the only approval
   * signal available on that path.
   */
  merchantActive?: boolean;
}): MerchantStatus {
  const status = merchant.complianceStatus?.toLowerCase() ?? '';

  if (status.includes('declin') || status.includes('reject') || status.includes('fail')) {
    return 'REJECTED';
  }
  // Either signal is sufficient: `settlementsEnabled` from a merchant record read,
  // or approved-and-active from a compliance webhook.
  if (merchant.settlementsEnabled) return 'APPROVED';
  if (merchant.merchantActive && status.includes('approv')) return 'APPROVED';
  return 'PENDING';
}

/**
 * Whether a User can currently be paid. Used by the Cash_Sale gate: a seller
 * whose settlements are not enabled cannot receive funds, so the sale must not
 * be initiated (there is no way to hold the money for them).
 */
export function canReceiveFunds(merchant: MerchantRecord | null): boolean {
  return Boolean(
    merchant && merchant.merchantRef && merchant.merchantStatus === 'APPROVED' && merchant.settlementsEnabled,
  );
}

/**
 * Submit sub-merchant onboarding for a Profile.
 *
 * 1. Load the Profile. Missing -> `PROFILE_NOT_FOUND`.
 * 2. Guard the current state: only NONE or REJECTED may submit; an existing
 *    PENDING/APPROVED sub-merchant -> `ALREADY_ONBOARDED`, no mutation.
 * 3. Guard provider capability -> `NOT_SUPPORTED`.
 * 4. Create the sub-merchant. A provider failure leaves the stored state
 *    untouched and returns `SUBMISSION_FAILED` (mirrors the Req 2.6 pattern).
 * 5. Persist the returned reference, compliance status and flags. A freshly
 *    created merchant has every flag false, so this lands on PENDING.
 */
export async function submitMerchantOnboarding(
  deps: MerchantOnboardingDeps,
  params: {
    profileId: string;
    details: ManagedMerchantDetails;
    buyerDisclosureConsent: boolean;
  },
): Promise<MerchantOnboardingResult> {
  const { repository, payments } = deps;
  const now = deps.now ?? (() => new Date());

  const existing = await repository.loadMerchant(params.profileId);
  if (!existing) {
    return { ok: false, error: 'PROFILE_NOT_FOUND' };
  }
  if (!SUBMITTABLE.has(existing.merchantStatus) || existing.merchantRef) {
    return { ok: false, error: 'ALREADY_ONBOARDED' };
  }
  if (!params.buyerDisclosureConsent) {
    return { ok: false, error: 'DISCLOSURE_CONSENT_REQUIRED' };
  }
  if (!payments.createManagedMerchant) {
    return { ok: false, error: 'NOT_SUPPORTED' };
  }

  let merchant: ManagedMerchant;
  try {
    merchant = await payments.createManagedMerchant(params.details);
  } catch (err) {
    return {
      ok: false,
      error: 'SUBMISSION_FAILED',
      detail: err instanceof Error ? err.message : undefined,
    };
  }

  const merchantStatus = deriveMerchantStatus(merchant);
  const submittedAt = now().toISOString();
  const identityVersion = `${merchant.merchantRef}:${submittedAt}`;
  const identity = {
    legalEntityName: params.details.legalEntityName,
    tradingName: params.details.tradingName ?? null,
    registrationNumber: params.details.businessRegistrationNumber,
    organisationType: params.details.organisationType ?? null,
    identityVersion,
    identityDisclosureConsentedAt: submittedAt,
  };

  await repository.updateMerchant({
    profileId: params.profileId,
    merchantRef: merchant.merchantRef,
    merchantStatus,
    complianceStatus: merchant.complianceStatus,
    liveEnabled: merchant.liveEnabled,
    transactionsEnabled: merchant.transactionsEnabled,
    settlementsEnabled: merchant.settlementsEnabled,
    notes: merchant.notes ?? null,
    submittedAt,
    ...identity,
  });

  return {
    ok: true,
    merchant: {
      profileId: params.profileId,
      merchantRef: merchant.merchantRef,
      merchantStatus,
      complianceStatus: merchant.complianceStatus,
      liveEnabled: merchant.liveEnabled,
      transactionsEnabled: merchant.transactionsEnabled,
      settlementsEnabled: merchant.settlementsEnabled,
      notes: merchant.notes ?? null,
      identityVerifiedAt: null,
      ...identity,
    },
  };
}

/**
 * Apply a provider compliance decision to the owning Profile - the webhook path.
 *
 * The Profile is identified by `merchantRef`. An unknown reference yields
 * `PROFILE_NOT_FOUND`, which the handler records as a failure rather than
 * inventing state. `decisionAt` is stamped whenever the derived status leaves
 * PENDING.
 */
export async function applyComplianceUpdate(
  deps: MerchantOnboardingDeps,
  params: {
    merchantRef: string;
    complianceStatus?: string;
    liveEnabled?: boolean;
    transactionsEnabled?: boolean;
    settlementsEnabled?: boolean;
    /** Provider `MerchantStatus === 'active'` from the compliance event. */
    merchantActive?: boolean;
    notes?: string;
  },
): Promise<MerchantOnboardingResult> {
  const { repository } = deps;
  const now = deps.now ?? (() => new Date());

  const profileId = await repository.findProfileIdByMerchantRef(params.merchantRef);
  if (!profileId) {
    return { ok: false, error: 'PROFILE_NOT_FOUND' };
  }
  const existing = await repository.loadMerchant(profileId);
  if (!existing) {
    return { ok: false, error: 'PROFILE_NOT_FOUND' };
  }

  // Absent flags mean "unchanged", not "false" - a compliance event may report
  // only the fields that moved.
  const liveEnabled = params.liveEnabled ?? existing.liveEnabled;
  const transactionsEnabled = params.transactionsEnabled ?? existing.transactionsEnabled;
  const settlementsEnabled = params.settlementsEnabled ?? existing.settlementsEnabled;
  const complianceStatus = params.complianceStatus ?? existing.complianceStatus ?? undefined;

  const merchantStatus = deriveMerchantStatus({
    complianceStatus,
    settlementsEnabled,
    merchantActive: params.merchantActive,
  });

  const decisionAt = merchantStatus === 'PENDING' ? undefined : now().toISOString();
  const identityVerifiedAt =
    merchantStatus === 'APPROVED'
      ? existing.identityVerifiedAt ?? decisionAt
      : existing.identityVerifiedAt ?? null;

  await repository.updateMerchant({
    profileId,
    merchantStatus,
    complianceStatus: complianceStatus ?? null,
    liveEnabled,
    transactionsEnabled,
    settlementsEnabled,
    notes: params.notes ?? existing.notes ?? null,
    identityVerifiedAt,
    ...(decisionAt ? { decisionAt } : {}),
  });

  return {
    ok: true,
    merchant: {
      ...existing,
      merchantStatus,
      complianceStatus: complianceStatus ?? null,
      liveEnabled,
      transactionsEnabled,
      settlementsEnabled,
      identityVerifiedAt,
    },
  };
}

/** A bound onboarding orchestrator with dependencies pre-wired. */
export interface MerchantOnboardingOrchestrator {
  submitMerchantOnboarding(params: {
    profileId: string;
    details: ManagedMerchantDetails;
    buyerDisclosureConsent: boolean;
  }): Promise<MerchantOnboardingResult>;
  applyComplianceUpdate(params: {
    merchantRef: string;
    complianceStatus?: string;
    liveEnabled?: boolean;
    transactionsEnabled?: boolean;
    settlementsEnabled?: boolean;
    merchantActive?: boolean;
    notes?: string;
  }): Promise<MerchantOnboardingResult>;
}

/** Bind the onboarding core to its dependencies. */
export function createMerchantOnboardingOrchestrator(
  deps: MerchantOnboardingDeps,
): MerchantOnboardingOrchestrator {
  return {
    submitMerchantOnboarding: (params) => submitMerchantOnboarding(deps, params),
    applyComplianceUpdate: (params) => applyComplianceUpdate(deps, params),
  };
}
