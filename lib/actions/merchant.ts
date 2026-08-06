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
import { createDefaultMerchantOnboardingOrchestrator } from '@/domain/orchestrator/supabaseMerchantRepository';
import type { MerchantStatus } from '@/domain/orchestrator/merchantOnboarding';
import { type ActionResult, fail, ok } from './result';

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

  const payments = getPaymentService();
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

  const payments = getPaymentService();
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
    const submitted = await submitMerchantOnboarding({ buyerDisclosureConsent: true });
    if (!submitted.ok && submitted.error !== 'already-onboarded') return submitted;
  }

  const link = await createPayoutOnboardingLink(returnPath);
  if (link.ok) return ok({ url: link.data.url });
  if (link.error === 'not-supported') return ok({ url: null });
  return link;
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

  const payments = getPaymentService();
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
    .select('display_name, contact_email')
    .eq('id', user.id)
    .maybeSingle();

  const businessEmail = (profile?.contact_email as string | null) ?? user.email;
  if (!businessEmail) {
    return fail('validation-error', 'Add a contact email to your profile before setting up payouts.');
  }

  const orchestrator = createDefaultMerchantOnboardingOrchestrator({
    payments: getPaymentService(),
  });

  const result = await orchestrator.submitMerchantOnboarding({
    profileId: user.id,
    buyerDisclosureConsent: details.buyerDisclosureConsent,
    details: {
      businessEmail,
      tradingName: details.tradingName,
      legalEntityName: (profile?.display_name as string | null) ?? undefined,
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
      case 'SUBMISSION_FAILED':
        return fail(
          'submission-failed',
          result.detail ?? 'Payout setup could not be submitted. Please try again.',
        );
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
