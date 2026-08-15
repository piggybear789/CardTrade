// domain/orchestrator/merchantOnboarding.ts
//
// The Managed Merchant (sub-merchant) onboarding core.
//
// WHY IT EXISTS. Stripe settles funds only into a merchant's own bank account, so
// a User who RECEIVES money — a Cash_Sale seller (Req 4.2) or a fraud victim
// being paid captured collateral (Req 8.3) — must exist as a sub-merchant under
// the platform's parent merchant. Provider identity verification happens as part
// of that onboarding.
//
// `merchant_status` together with `merchant_settlements_enabled` IS the
// Identity_Gate — the sole verification signal in the app. See
// `domain/identity/identityGate.ts`, which is the one place that evaluates it;
// `public_profiles.is_verified` is the same expression in SQL.
//
// The standalone payer check that used to gate paying/listing/trading separately
// has been retired. Note that a trade-only User DOES now need this onboarding: an
// Objective_Fraud resolution pays captured collateral to whichever trader was the
// victim, so either side of a trade can receive money.
//
// Pure and injectable like the other orchestrators: it depends on a repository
// interface plus the payment-service seam, never on `server-only`/Supabase, so
// it is testable against fakes. The Supabase binding lives in
// `supabaseMerchantRepository.ts`.

import {
  satisfiesIdentityGate,
  type IdentityCheckStatus,
} from '../identity/identityGate';
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
  /**
   * Stripe Identity check state (0069). THIS is the Identity_Gate; the
   * `merchant_*` fields above are the payout side.
   *
   * Optional so a caller that only needs payout facts need not fetch it, and
   * absent is read as `'NONE'` — the safe default, since a missing value must
   * never read as verified.
   */
  identityCheckStatus?: IdentityCheckStatus | null;
  /** Name Stripe Identity read off the document, when it accepted one. */
  identityCheckName?: string | null;
  identityCheckVerifiedAt?: string | null;
  /**
   * Non-null when the member is permanently banned for confirmed fraud (0059).
   * A banned seller must never be paid, regardless of whether their settlements
   * are active — the money belongs to the victim or the platform, not them.
   */
  fraudBannedAt?: string | null;
}

/**
 * The narrow provider-approved seller identity that may be shown to buyers.
 *
 * Carries no government registration number. That was a former-provider
 * requirement: Stripe does not return tax IDs, sellers here are individuals, and
 * `0028_stripe_migration.sql` records `merchant_registration_number` as
 * deprecated and null for every Stripe-onboarded seller.
 */
export interface SellerIdentityDisclosure {
  sellerId: string;
  version: string;
  legalEntityName: string;
  /**
   * Whether `legalEntityName` came off a government document.
   *
   * THE TWO SOURCES ARE NOT INTERCHANGEABLE AND CALLERS MUST NOT GUESS.
   * `legalEntityName` is `identityCheckName ?? legalEntityName`: the first is
   * Stripe Identity's `verified_outputs`, the second is whatever Connect held,
   * which for a member grandfathered by 0069 is the name they typed — and
   * `submitMerchantOnboarding` seeds that from `profiles.display_name`. So the
   * field can legitimately hold a self-chosen handle.
   *
   * This flag exists because the disclosure previously collapsed both into one
   * string and discarded which was used, leaving the UI unable to tell them
   * apart — so a label reading "verified name" asserted a document check over a
   * value the seller had typed themselves. Gate any copy claiming a real,
   * document-checked identity on this being `true`; `false` may only be
   * described as self-stated.
   */
  nameIsDocumentVerified: boolean;
  tradingName: string | null;
  organisationType: string | null;
  verifiedAt: string;
}

/**
 * Return a buyer-safe disclosure only when provider compliance approved it.
 *
 * The gate is the Identity_Gate plus a provider-verified legal name and the
 * timestamp it was verified at. It deliberately does NOT require a registration
 * number: that condition made this function return `null` for every
 * Stripe-onboarded seller, which in turn made `agreeCashSale` fail with
 * `SELLER_IDENTITY_UNVERIFIED` and blocked buying and offers outright. Only
 * seeded demo sellers, which hardcode a fake ABN, ever passed it.
 *
 * `settlementsEnabled` is required as well as APPROVED, because a seller who cannot
 * receive funds has nothing to disclose an identity for — the buyer is being told who
 * their money is going to, so it must be someone it can actually go to. This condition
 * was stated in this docstring but MISSING from the code between 0060 and 0061, which
 * is how a shell account could front a cash sale.
 */
export function sellerIdentityDisclosure(
  merchant: MerchantRecord | null,
): SellerIdentityDisclosure | null {
  if (!merchant) return null;

  // THE GATE, not the payout state (0069). A disclosure asserts "a provider checked
  // who this is", which is exactly what the Identity check answers and what Connect
  // never did.
  if (!satisfiesIdentityGate({ identityCheckStatus: merchant.identityCheckStatus ?? 'NONE' })) {
    return null;
  }

  // PREFER THE DOCUMENT-BACKED NAME. `identityCheckName` came off a government
  // document; `legalEntityName` is whatever Connect held, which for a member
  // verified before 0069 may still be their own stated name. The fallback is
  // load-bearing rather than sloppy: a null disclosure blocks the entire buy path
  // (migration 0041 records that shipping), so a grandfathered seller must keep the
  // name they were already disclosed under.
  const legalEntityName = merchant.identityCheckName ?? merchant.legalEntityName;
  const verifiedAt = merchant.identityCheckVerifiedAt ?? merchant.identityVerifiedAt;

  if (!merchant.identityDisclosureConsentedAt || !verifiedAt || !legalEntityName) {
    return null;
  }

  // Which of the two the line above actually took. Reported rather than inferred,
  // because it is the difference between a document-checked name and one the
  // seller typed, and only this function can still see it.
  const nameIsDocumentVerified = merchant.identityCheckName != null;

  return {
    sellerId: merchant.profileId,
    // Derived when absent rather than required. The version is OUR bookkeeping —
    // `agreeCashSale` compares it to the snapshot on the sale to detect the
    // seller's identity changing mid-contract — not a provider fact, so a missing
    // value must not withhold a disclosure the provider has already verified.
    // Deriving it from the account reference and the verification timestamp keeps
    // it stable per verification and changes it if the provider re-verifies.
    version: identityVersionFor(merchant),
    legalEntityName,
    nameIsDocumentVerified,
    tradingName: merchant.tradingName ?? null,
    organisationType: merchant.organisationType ?? null,
    verifiedAt,
  };
}

/**
 * The disclosure version for a merchant, using the stored value when present and
 * otherwise deriving a stable one from the provider account reference and the
 * verification timestamp.
 */
function identityVersionFor(merchant: MerchantRecord): string {
  if (merchant.identityVersion) return merchant.identityVersion;
  return `${merchant.merchantRef ?? merchant.profileId}:${merchant.identityVerifiedAt ?? ''}`;
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
 * - `PROFILE_NOT_FOUND`   — no Profile for the id.
 * - `ALREADY_ONBOARDED`   — a sub-merchant already exists (PENDING or APPROVED),
 *                           so a second submission is rejected.
 * - `NOT_SUPPORTED`       — the active provider has no sub-merchant capability.
 * - `SUBMISSION_FAILED`   — the provider rejected the submission; state unchanged.
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
 * APPROVED requires settlements to be enabled — that is the only flag that means
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
 *
 * A FRAUD BAN IS A PAYABILITY FACT, so it is checked HERE rather than at each
 * call site. `settleTradeCash` (the trade cash leg) and the dispute-resolution
 * victim payout both consulted only the Connect columns, so a permanently banned
 * account with settlements still enabled could be paid through either — the
 * Cash_Sale path was the only one carrying its own explicit ban guard.
 *
 * EVERY REPOSITORY BUILDING A `MerchantRecord` FOR A PAYOUT DECISION MUST SELECT
 * `fraud_banned_at`. An omitted column reads as `undefined`, which passes this
 * check silently — the failure mode is a guard that looks present and does
 * nothing. All three production readers select it: the Cash_Sale payee, the
 * merchant repository, and the dispute-resolution trader payee.
 *
 * The Cash_Sale orchestrator still keeps its own earlier ban check, because it
 * returns the distinct `SELLER_FRAUD_BANNED` error and records a FAILED payout;
 * this predicate only answers yes/no.
 */
export function canReceiveFunds(merchant: MerchantRecord | null): boolean {
  return Boolean(
    merchant &&
      merchant.merchantRef &&
      merchant.merchantStatus === 'APPROVED' &&
      merchant.settlementsEnabled &&
      !merchant.fraudBannedAt,
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

  // A freshly created account has every capability inactive, so this lands on
  // PENDING. It must: creating the shell is the START of onboarding, not the end.
  // 0060 overrode this with `merchant.merchantRef ? 'APPROVED' : ...`, which made a
  // shell read as a finished, verified, sellable account; 0061 restored the derivation.
  const merchantStatus: MerchantStatus = deriveMerchantStatus(merchant);
  const submittedAt = now().toISOString();
  const identityVersion = `${merchant.merchantRef}:${submittedAt}`;
  // The buyer-safe disclosure snapshot. At submission time the provider has
  // verified nothing yet, so `legalEntityName` holds only what the Seller stated
  // (or the verified name, if the provider returned one immediately) and
  // `registrationNumber` is null.
  //
  // Under Stripe this snapshot was populated from a form the Seller filled in,
  // including a government registration number. With provider-hosted onboarding
  // the authoritative payee name arrives later, on the compliance webhook, as a
  // name checked against a government document — so the disclosure is written
  // once verification actually completes rather than trusted up front.
  //
  // `legalEntityName` KEEPS its fallback to the Seller's stated name, and that is
  // load-bearing, not laziness. `sellerIdentityDisclosure` returns null without a
  // name, a null disclosure makes `initiateCashSale` fail with
  // SELLER_IDENTITY_UNVERIFIED, and 0041 records that combination taking the entire
  // buy path dark. Stripe reports no verified name at account creation, so without
  // the fallback every seller would be unsellable for the window between finishing
  // onboarding and Stripe returning a name. `applyComplianceUpdate` upgrades it in
  // place, absent→present only, the moment the provider reports a real one. Nothing
  // may describe this value as document-verified until that happens.
  const identity = {
    legalEntityName: merchant.legalName ?? params.details.legalEntityName ?? null,
    tradingName: params.details.tradingName ?? null,
    registrationNumber: null,
    organisationType: 'individual',
    identityVersion,
    // A real record: the Member pressed the control the disclosure is stated on.
    identityDisclosureConsentedAt: submittedAt,
    // NOT stamped at submission. 0060 set this to `submittedAt` unconditionally,
    // which dated "identity verified" to the moment an empty shell was created.
    // `applyComplianceUpdate` stamps it when the status actually reaches APPROVED,
    // which now requires settlements — i.e. when Stripe has finished.
    identityVerifiedAt: merchantStatus === 'APPROVED' ? submittedAt : null,
  };

  // The account now EXISTS at the provider, so a failure to persist its reference
  // orphans it: nothing can reach it again and nothing can legitimately replace
  // it. Report that as a failure carrying the reference rather than returning
  // `ok` over a row that never recorded it.
  try {
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
  } catch (err) {
    return {
      ok: false,
      error: 'SUBMISSION_FAILED',
      detail:
        `Created provider account ${merchant.merchantRef} but could not record it: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    };
  }

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
      // `identity` carries `identityVerifiedAt`, which is null unless the provider
      // already reported the account active. There used to be an explicit `null`
      // here as well, which the spread silently overwrote (TS2783).
      ...identity,
    },
  };
}

/**
 * Apply a provider compliance decision to the owning Profile — the webhook path.
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
    /**
     * The payee's provider-verified legal name, once identity verification has
     * completed. This is the buyer-safe disclosure (Req 4.8-4.12) and is written
     * only from the provider's own report — never from Seller-supplied input.
     * Absent means "unchanged", so a later event cannot blank an existing name.
     */
    legalName?: string;
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

  // Absent flags mean "unchanged", not "false" — a compliance event may report
  // only the fields that moved.
  const liveEnabled = params.liveEnabled ?? existing.liveEnabled;
  const transactionsEnabled = params.transactionsEnabled ?? existing.transactionsEnabled;
  const settlementsEnabled = params.settlementsEnabled ?? existing.settlementsEnabled;
  const complianceStatus = params.complianceStatus ?? existing.complianceStatus ?? undefined;

  // Always re-derived from what the provider just reported. 0060 pinned this to
  // APPROVED for any row with a `merchantRef`, which made the status a one-way latch:
  // once set it could never fall back, so an account Stripe later restricted went on
  // reading as verified. The provider is the source of truth in both directions.
  const merchantStatus: MerchantStatus = deriveMerchantStatus({
    complianceStatus,
    settlementsEnabled,
    merchantActive: params.merchantActive,
  });

  const decisionAt = merchantStatus === 'PENDING' ? undefined : now().toISOString();
  const identityVerifiedAt =
    merchantStatus === 'APPROVED'
      ? existing.identityVerifiedAt ?? decisionAt
      : existing.identityVerifiedAt ?? null;

  // The verified legal name only ever moves from absent to present: a provider
  // report without it must not erase a name already disclosed to Buyers.
  const legalEntityName = params.legalName ?? existing.legalEntityName ?? null;

  await repository.updateMerchant({
    profileId,
    merchantStatus,
    complianceStatus: complianceStatus ?? null,
    liveEnabled,
    transactionsEnabled,
    settlementsEnabled,
    notes: params.notes ?? existing.notes ?? null,
    identityVerifiedAt,
    legalEntityName,
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
      legalEntityName,
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
    /** Provider-verified payee legal name; see the core function's docs. */
    legalName?: string;
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
