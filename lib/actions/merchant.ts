'use server';

// lib/actions/merchant.ts
//
// Managed Merchant (sub-merchant) onboarding Server Actions.
//
// WHY: the provider settles funds only into a merchant's own bank account, so a
// User who wants to SELL for cash must exist as a sub-merchant under the
// platform's parent merchant. This is separate from Req 2 KYC, which gates
// paying/listing/trading — a trade-only User never comes here.
//
// ONBOARDING IS PROVIDER-HOSTED. We create the account shell, then redirect the
// Seller to the provider to supply and verify everything sensitive: legal name,
// date of birth, address, identity document, and the disbursement bank account.
// None of it passes through this module. That is why the submission payload is
// now just a consent flag, where it previously carried BSB, account number,
// ABN/ACN, date of birth and residential address — Stripe had no tokenised
// equivalent for a settlement account and demanded all of it in the request body.
//
// Provider-controlled columns (`merchant_*`) are written only by the service-role
// repository — 0005_merchant_onboarding.sql revokes column UPDATE on them from
// `authenticated`, so a User cannot mark themselves settlement-enabled.

import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import type { ManagedMerchantDetails } from '@/domain/services/types';
import { createDefaultMerchantOnboardingOrchestrator } from '@/domain/orchestrator/supabaseMerchantRepository';
import type { MerchantStatus } from '@/domain/orchestrator/merchantOnboarding';
import { findRegion, normalizeRegionCode } from '@/domain/region';
import { isDeliverableEmail } from '@/domain/validation';
import { regionForProfile } from '@/lib/regionBinding';
import { DEFAULT_CONFIG_REGION } from '@/domain/services/stripe/config';
import { type ActionResult, fail, ok } from './result';

/**
 * The signed-in member's platform-account region.
 *
 * Their connected account, its hosted onboarding links and its compliance read-back
 * all belong to one Stripe platform (0068), so every provider call in this module has
 * to use theirs. Falls back to the default region when there is no session; the
 * actions themselves then refuse for want of a user.
 */
async function viewerRegion(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? regionForProfile(user.id) : DEFAULT_CONFIG_REGION;
}

/** Typed failure codes for {@link submitMerchantOnboarding}. */
export type MerchantOnboardingActionError =
  | 'not-authenticated'
  | 'validation-error'
  | 'already-onboarded'
  | 'disclosure-consent-required'
  | 'not-supported'
  | 'submission-failed'
  | 'profile-not-found';

/**
 * The onboarding snapshot surfaced to the UI. Deliberately excludes bank
 * details, contact details and compliance notes — only the seller's own
 * buyer-visible identity plus provider status is returned.
 */
export interface MerchantStateData {
  merchantStatus: MerchantStatus;
  merchantRef: string | null;
  settlementsEnabled: boolean;
  complianceStatus?: string | null;
  legalEntityName?: string | null;
  tradingName?: string | null;
  registrationNumber?: string | null;
  identityVerifiedAt?: string | null;
}

/** Payout setup context for the profile UI. */
export interface PayoutSetupContext {
  state: MerchantStateData;
  /**
   * True when the provider offers a hosted onboarding flow to redirect into.
   * False on the MockService, where the UI shows a simulated approval instead.
   */
  hostedOnboarding: boolean;
}

/**
 * Payout onboarding submission. The legal payee identity and government
 * registration are submitted to Stripe and, after approval, disclosed to buyers
 * at checkout with the seller's explicit consent (Req 4.8-4.12).
 */
const onboardingSchema = z.object({
  /**
   * Optional public shop name. Display only — the authoritative payee identity is
   * the provider-verified legal name, not anything typed here.
   */
  tradingName: z.string().trim().min(1).max(255).optional(),
  buyerDisclosureConsent: z.literal(true, {
    error: 'You must consent to showing your verified seller identity to buyers.',
  }),
});

/** The shape the UI submits. */
export type MerchantOnboardingInput = z.input<typeof onboardingSchema>;

/**
 * Read the caller's current sub-merchant state for the payout UI.
 */
export async function getMerchantState(): Promise<
  ActionResult<MerchantStateData, 'not-authenticated' | 'profile-not-found'>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'You must be signed in.');

  // Read through the admin client: the merchant columns are provider-controlled
  // and not part of any client-facing select.
  const { data } = await createAdminClient()
    .from('profiles')
    .select(
      'merchant_ref, merchant_status, merchant_settlements_enabled, merchant_compliance_status, merchant_legal_entity_name, merchant_trading_name, merchant_registration_number, merchant_identity_verified_at',
    )
    .eq('id', user.id)
    .maybeSingle();

  if (!data) return fail('profile-not-found', 'No profile was found for your account.');

  return ok({
    merchantRef: (data.merchant_ref as string | null) ?? null,
    merchantStatus: data.merchant_status as MerchantStatus,
    settlementsEnabled: Boolean(data.merchant_settlements_enabled),
    complianceStatus: (data.merchant_compliance_status as string | null) ?? null,
    legalEntityName: (data.merchant_legal_entity_name as string | null) ?? null,
    tradingName: (data.merchant_trading_name as string | null) ?? null,
    registrationNumber: (data.merchant_registration_number as string | null) ?? null,
    identityVerifiedAt: (data.merchant_identity_verified_at as string | null) ?? null,
  });
}

/**
 * Read the payout setup context for the profile UI.
 */
export async function getPayoutSetupContext(): Promise<
  ActionResult<PayoutSetupContext, 'not-authenticated' | 'profile-not-found'>
> {
  const state = await getMerchantState();
  if (!state.ok) return state;

  // The member's own region's platform account (0068): their connected account and
  // its onboarding links belong to exactly one platform.
  const payments = getPaymentService(await viewerRegion());
  return ok({
    state: state.data,
    hostedOnboarding: Boolean(payments.createMerchantOnboardingLink),
  });
}

/**
 * Create a fresh provider-hosted onboarding link for the signed-in Seller.
 *
 * Links are single-use and short-lived, so this is called every time the Seller
 * starts or resumes onboarding rather than being cached. Returning from the flow
 * does NOT mean the Seller can be paid: approval arrives asynchronously on the
 * provider's account webhook, so the UI must keep gating on `settlementsEnabled`.
 */
export async function createPayoutOnboardingLink(
  returnPath?: string,
): Promise<ActionResult<{ url: string }, MerchantOnboardingActionError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'You must be signed in to set up payouts.');

  const state = await getMerchantState();
  if (!state.ok) return fail('profile-not-found', 'No profile was found for your account.');
  if (!state.data.merchantRef) {
    return fail('submission-failed', 'Start payout setup before opening the onboarding form.');
  }

  // The member's own region's platform account (0068): their connected account and
  // its onboarding links belong to exactly one platform.
  const payments = getPaymentService(await viewerRegion());
  if (!payments.createMerchantOnboardingLink) {
    return fail('not-supported', 'The active payment provider does not support payout accounts.');
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const base = safeReturnPath(returnPath);
  try {
    const link = await payments.createMerchantOnboardingLink({
      merchantRef: state.data.merchantRef,
      returnUrl: `${origin}${base}payouts=complete`,
      // The provider sends the Seller here if the link expired mid-flow; the page
      // requests a new link rather than reusing a dead one.
      refreshUrl: `${origin}${base}payouts=refresh`,
    });
    return ok({ url: link.url });
  } catch (err) {
    return fail(
      'submission-failed',
      err instanceof Error ? err.message : 'Could not open the payout onboarding form.',
    );
  }
}

/**
 * Start verification and hand back the provider-hosted URL in one round trip.
 *
 * WHY THIS EXISTS. Minting a hosted link needs an `acct_...` to build it for, so
 * two provider calls are unavoidable: create the recipient account, then create
 * the account link. Those two calls used to be exposed as two separate member
 * clicks ("Save setup details", then "Continue with Stripe") with an optional shop
 * name hung off the first to make it look like a step. Nothing required that. The
 * member asked to verify; this does both calls and returns the URL to send them to.
 *
 * `url` is null when the active provider has no hosted flow (the MockService), in
 * which case creating the account was the entire flow and the caller should just
 * re-read status.
 *
 * CONSENT (Req 4.8-4.12). Calling this IS the buyer-disclosure consent, so every
 * caller must render the disclosure next to the control that invokes it. The flag
 * is passed as `true` here rather than being collected on a separate screen — the
 * requirement is informed consent, not an extra click.
 */
export async function startIdentityVerification(
  returnPath?: string,
): Promise<ActionResult<{ url: string | null }, MerchantOnboardingActionError>> {
  const state = await getMerchantState();
  if (!state.ok) {
    return state.error === 'not-authenticated'
      ? fail('not-authenticated', 'You must be signed in to verify your account.')
      : fail('profile-not-found', 'No profile was found for your account.');
  }

  // Resume rather than fail when an account shell already exists: a member who
  // abandoned the provider's pages mid-flow presses the same button again.
  if (!state.data.merchantRef) {
    // PREFILLED, exactly as `beginEmbeddedPayout` does it (Req 4.1-4.2). The prefill
    // is written onto the ACCOUNT at creation, not handed to a surface, so the hosted
    // pages show the same name/DOB/address the embedded component would. Omitting it
    // here — which this action did until now — meant the hosted route silently asked a
    // seller to retype what Stripe had already verified off their document.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const prefill = user
      ? await buildIdentityPrefill(user.id, getPaymentService(await viewerRegion()))
      : undefined;

    const submitted = await submitMerchantOnboarding(
      { buyerDisclosureConsent: true },
      prefill,
    );
    if (!submitted.ok && submitted.error !== 'already-onboarded') return submitted;
  }

  const link = await createPayoutOnboardingLink(returnPath);
  if (link.ok) return ok({ url: link.data.url });
  if (link.error === 'not-supported') return ok({ url: null });
  return link;
}

/** What the browser needs to render Connect embedded onboarding inline. */
export interface StartedEmbeddedPayout {
  /** Single-use Connect account-session client secret. Re-minted on retry. */
  clientSecret: string;
  /** Browser-safe publishable key for `@stripe/connect-js`. */
  publishableKey: string;
}

/**
 * Ensure the seller's payout account exists (prefilled from their verified identity)
 * and mint a Connect account-session secret for the EMBEDDED onboarding component
 * (unified-seller-onboarding, Req 4.1-4.2, 5.1).
 *
 * Order of operations (silent prefill): a fresh server-only `readIdentityCheck`
 * yields the Prefill_Object (name/DOB/address from `verified_outputs`); that is passed
 * to `submitMerchantOnboarding`, which creates the recipient account with
 * `identity.individual` prefilled so Connect never re-asks for it; then the account
 * session is minted. The Prefill_Object never leaves this function's scope and is
 * never returned to the client — the result carries only the secret + publishable key
 * (Req 4.5).
 *
 * Returns `not-supported` when the active provider has no embedded binding (the Mock),
 * so the surface falls back. Region rules are unchanged: `submitMerchantOnboarding`
 * refuses an absent/non-tradeable region (Req 12.2), and `setTradingRegion` refuses a
 * move once a `merchant_ref` exists (Req 12.4).
 */
export async function beginEmbeddedPayout(): Promise<
  ActionResult<StartedEmbeddedPayout, MerchantOnboardingActionError>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'You must be signed in to set up payouts.');

  const region = await viewerRegion();
  const payments = getPaymentService(region);
  if (!payments.createConnectAccountSession) {
    return fail('not-supported', 'The active payment provider does not support embedded payouts.');
  }

  const state = await getMerchantState();
  if (!state.ok) return fail('profile-not-found', 'No profile was found for your account.');

  // Create the account shell if it does not exist yet, prefilling from the seller's
  // verified identity so Connect does not re-collect name/DOB/address.
  if (!state.data.merchantRef) {
    const prefill = await buildIdentityPrefill(user.id, payments);
    const submitted = await submitMerchantOnboarding({ buyerDisclosureConsent: true }, prefill);
    if (!submitted.ok && submitted.error !== 'already-onboarded') return submitted;
  }

  // Re-read to get the reference the account was (now) created under.
  const refreshed = await getMerchantState();
  const merchantRef = refreshed.ok ? refreshed.data.merchantRef : null;
  if (!merchantRef) {
    return fail('submission-failed', 'Could not open payout setup. Please try again.');
  }

  try {
    const secret = await payments.createConnectAccountSession(merchantRef);
    return ok({ clientSecret: secret.clientSecret, publishableKey: secret.publishableKey });
  } catch (err) {
    return fail(
      'submission-failed',
      err instanceof Error ? err.message : 'Could not open embedded payout onboarding.',
    );
  }
}

/**
 * Build the transient Prefill_Object from the seller's own Identity session
 * (unified-seller-onboarding, Req 4.1). Server-only: the DOB/address it carries are
 * handed straight to account creation and never persisted, logged, or returned.
 *
 * Returns `undefined` when there is no session to read or the provider cannot be read
 * — the account is then created without prefill and Stripe collects the fields itself
 * (Req 4.6), which is a valid degrade, not a failure.
 */
async function buildIdentityPrefill(
  profileId: string,
  payments: ReturnType<typeof getPaymentService>,
): Promise<ManagedMerchantDetails['prefill'] | undefined> {
  if (!payments.readIdentityCheck) return undefined;

  const { data } = await createAdminClient()
    .from('profiles')
    .select('identity_check_session_id')
    .eq('id', profileId)
    .maybeSingle();

  const sessionId = (data?.identity_check_session_id as string | null) ?? null;
  if (!sessionId) return undefined;

  try {
    const check = await payments.readIdentityCheck(sessionId);
    if (check.outcome !== 'VERIFIED') return undefined;
    return {
      firstName: check.verifiedFirstName ?? null,
      lastName: check.verifiedLastName ?? null,
      dob: check.verifiedDob ?? null,
      address: check.verifiedAddress ?? null,
    };
  } catch {
    // A read failure must not block onboarding — Stripe collects the fields instead.
    return undefined;
  }
}

/**
 * Whether a provider submission failure was about the email address.
 *
 * Matches Stripe's own error identifiers (`email_invalid`,
 * `email_domain_invalid_for_recipient`) and the prose it returns for them. This reads a
 * message string, which is not a contract — so it only ever UPGRADES the wording of a
 * failure that already happened, never gates anything. The up-front
 * `isUsableContactEmail` check is the real defence; this catches what only the provider
 * can know.
 */
function isProviderEmailRejection(detail: string | undefined): boolean {
  if (!detail) return false;
  const text = detail.toLowerCase();
  return (
    text.includes('email_invalid') ||
    text.includes('email_domain_invalid') ||
    text.includes('unsupported domain') ||
    (text.includes('email') && text.includes('invalid'))
  );
}

/**
 * Normalise a caller-supplied return path into a same-origin prefix ending in
 * `?` or `&`, ready for the `payouts=` marker to be appended.
 *
 * The path reaches the provider as an absolute URL it will redirect a browser to,
 * so it is an open-redirect surface: anything that is not an unambiguous
 * same-origin path is discarded in favour of `/profile`. `//evil.example` is a
 * protocol-relative URL and a backslash is normalised to `/` by browsers, so both
 * are rejected alongside absolute URLs.
 */
function safeReturnPath(path: string | undefined): string {
  const candidate = path?.trim();
  const usable =
    candidate &&
    candidate.startsWith('/') &&
    !candidate.startsWith('//') &&
    !candidate.includes('\\')
      ? candidate
      : '/profile';
  const [pathname, query] = usable.split('#')[0].split('?');
  return query ? `${pathname}?${query}&` : `${pathname}?`;
}

/**
 * Re-read the Seller's payout state from the provider and persist it.
 *
 * Used when the Seller returns from hosted onboarding: it makes the UI correct
 * immediately instead of waiting on webhook delivery. The provider remains the
 * source of truth — this never writes a status the provider did not report.
 */
export async function refreshPayoutStatus(): Promise<
  ActionResult<MerchantStateData, MerchantOnboardingActionError>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'You must be signed in.');

  const state = await getMerchantState();
  if (!state.ok) return fail('profile-not-found', 'No profile was found for your account.');
  if (!state.data.merchantRef) return ok(state.data);

  // The member's own region's platform account (0068): their connected account and
  // its onboarding links belong to exactly one platform.
  const payments = getPaymentService(await viewerRegion());
  if (!payments.getManagedMerchant) return ok(state.data);

  const merchant = await payments.getManagedMerchant(state.data.merchantRef);
  if (!merchant) return ok(state.data);

  const orchestrator = createDefaultMerchantOnboardingOrchestrator({ payments });
  const applied = await orchestrator.applyComplianceUpdate({
    merchantRef: merchant.merchantRef,
    complianceStatus: merchant.complianceStatus,
    liveEnabled: merchant.liveEnabled,
    transactionsEnabled: merchant.transactionsEnabled,
    settlementsEnabled: merchant.settlementsEnabled,
    notes: merchant.notes,
    legalName: merchant.legalName ?? undefined,
  });

  if (!applied.ok) return getMerchantState();
  return getMerchantState();
}

/**
 * Start sub-merchant onboarding for the signed-in User so they can be paid.
 *
 * Creates the provider account shell only. Everything sensitive is collected by
 * the provider afterwards via {@link createPayoutOnboardingLink}, and approval
 * arrives asynchronously on the provider's account webhook, which moves
 * `merchant_status` to APPROVED or REJECTED. Until then the User stays PENDING
 * and cannot receive funds.
 */
export async function submitMerchantOnboarding(
  input: MerchantOnboardingInput,
  /**
   * TRANSIENT provider-sourced prefill (unified-seller-onboarding, Req 4.2). Passed
   * ONLY by `beginEmbeddedPayout`, built from the seller's own Identity read-back, and
   * forwarded straight to `createManagedMerchant`. It is NOT part of the zod input —
   * it never comes from the client — and it is never persisted or logged here.
   */
  prefill?: ManagedMerchantDetails['prefill'],
): Promise<ActionResult<MerchantStateData, MerchantOnboardingActionError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'You must be signed in to set up payouts.');

  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      'validation-error',
      issue?.message ?? 'Please check the details you entered.',
      issue?.path?.join('.'),
    );
  }
  const details = parsed.data;

  // The signed-in User's own account email is used as the provider contact,
  // rather than a value from the client payload.
  const { data: profile } = await createAdminClient()
    .from('profiles')
    .select('display_name, contact_email, region_code')
    .eq('id', user.id)
    .maybeSingle();

  const businessEmail = (profile?.contact_email as string | null) ?? user.email;
  if (!businessEmail) {
    return fail(
      'validation-error',
      'Add a contact email to your profile before setting up payouts.',
      'contactEmail',
    );
  }

  // A BACKSTOP, NOT THE PRIMARY GUARD. Sign-up and the profile form both enforce
  // `isDeliverableEmail` now, so a new member cannot reach here with a bad address.
  // This still earns its place: accounts created BEFORE that rule hold whatever they
  // were given (`phil@gm` passed sign-up, and the profile field was validated as
  // generic text), and Stripe refuses such an address with `email_invalid` — which left
  // no `merchant_ref`, so the member retried forever against the same stored value.
  // Failing here names the field and points at the screen that can change it.
  if (!isDeliverableEmail(businessEmail)) {
    return fail(
      'validation-error',
      `Your contact email (${businessEmail}) is not a valid address, so Stripe will not accept ` +
        'it for payouts. Update it in your profile, then start payout setup again.',
      'contactEmail',
    );
  }

  // The connected account's country is fixed at creation and cannot be changed
  // afterwards, so a Member must have declared a region BEFORE the account exists —
  // otherwise the fallback silently registers them in the default jurisdiction and
  // they are stuck there. Onboarding sets `region_code` before it offers the seller
  // path, so a null here means a Profile that predates 0065.
  const regionCode = normalizeRegionCode(profile?.region_code);
  if (!regionCode) {
    return fail(
      'validation-error',
      'Set your region before setting up payouts — your payout account is registered in it and cannot be moved later.',
      'regionCode',
    );
  }
  const accountCountry = findRegion(regionCode)?.stripeCountry ?? null;

  const orchestrator = createDefaultMerchantOnboardingOrchestrator({
    // Opened on the region the member declared, which is also the country passed as
    // identity.country below. Stripe fixes an account's country at creation.
    payments: getPaymentService(regionCode),
  });

  const result = await orchestrator.submitMerchantOnboarding({
    profileId: user.id,
    buyerDisclosureConsent: details.buyerDisclosureConsent,
    details: {
      profileId: user.id,
      businessEmail,
      tradingName: details.tradingName,
      legalEntityName: (profile?.display_name as string | null) ?? undefined,
      country: accountCountry,
      ...(prefill ? { prefill } : {}),
    },
  });

  if (!result.ok) {
    switch (result.error) {
      case 'ALREADY_ONBOARDED':
        return fail('already-onboarded', 'Payout setup has already been submitted.');
      case 'DISCLOSURE_CONSENT_REQUIRED':
        return fail(
          'disclosure-consent-required',
          'Confirm that buyers may see your approved legal seller identity.',
        );
      case 'NOT_SUPPORTED':
        return fail(
          'not-supported',
          'The active payment provider does not support payout accounts.',
        );
      case 'SUBMISSION_FAILED': {
        // An email the provider refuses for a reason only IT can know — an
        // unsupported or disposable domain (`email_domain_invalid_for_recipient`),
        // which no local regex can predict. Reported against the field so the UI
        // offers the same "fix your profile email" route as the up-front check,
        // rather than passing Stripe's wording straight through.
        if (isProviderEmailRejection(result.detail)) {
          return fail(
            'validation-error',
            `Stripe will not accept ${businessEmail} for payouts — some email domains are ` +
              'not supported. Try a different address in your profile, then start payout ' +
              'setup again.',
            'contactEmail',
          );
        }
        return fail(
          'submission-failed',
          result.detail ?? 'Payout setup could not be submitted. Please try again.',
        );
      }
      case 'PROFILE_NOT_FOUND':
      default:
        return fail('profile-not-found', 'No profile was found for your account.');
    }
  }

  return ok({
    merchantRef: result.merchant.merchantRef,
    merchantStatus: result.merchant.merchantStatus,
    settlementsEnabled: result.merchant.settlementsEnabled,
    complianceStatus: result.merchant.complianceStatus,
    legalEntityName: result.merchant.legalEntityName ?? null,
    tradingName: result.merchant.tradingName ?? null,
    registrationNumber: result.merchant.registrationNumber ?? null,
    identityVerifiedAt: result.merchant.identityVerifiedAt ?? null,
  });
}
