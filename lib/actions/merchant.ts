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
// The action layer exists (rather than a pure domain call) because the provider
// requires the real `ipAddress` and `userAgent` of the person completing
// onboarding for AML purposes; both are read from the incoming request headers
// and never accepted from the client payload.
//
// Provider-controlled columns (`merchant_*`) are written only by the service-role
// repository — 0005_merchant_onboarding.sql revokes column UPDATE on them from
// `authenticated`, so a User cannot mark themselves settlement-enabled.

import { headers } from 'next/headers';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import {
  isPinchConfigured,
  readPinchConfig,
  simulateComplianceDecision,
} from '@/domain/services/pinch';
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
  /** True when the test-mode compliance simulator can be invoked. */
  canSimulateCompliance: boolean;
  /** True when real Pinch is the active provider. */
  providerIsPinch: boolean;
}

/**
 * Payout onboarding submission. The legal payee identity and government
 * registration are submitted to Pinch and, after approval, disclosed to buyers
 * at checkout with the seller's explicit consent (Req 4.8-4.12).
 */
const onboardingSchema = z.object({
  legalEntityName: z.string().trim().min(1).max(255),
  tradingName: z.string().trim().min(1).max(255).optional(),
  businessEmail: z.string().trim().email(),
  bankAccountBsb: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .refine((value) => /^\d{6}$/.test(value), 'BSB must be 6 digits.'),
  bankAccountNumber: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .refine((value) => /^\d{3,9}$/.test(value), 'Account number must be 3-9 digits.'),
  bankAccountName: z.string().trim().min(1).max(255),
  businessRegistrationNumber: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .refine(
      (value) => /^\d{9}$|^\d{11}$/.test(value),
      'Enter a 9-digit ACN or 11-digit ABN.',
    ),
  organisationType: z.enum(['individual', 'company']).default('individual'),
  buyerDisclosureConsent: z.literal(true, {
    error: 'You must consent to showing your verified seller identity to buyers.',
  }),
  contactFirstName: z.string().trim().max(100).optional(),
  contactLastName: z.string().trim().max(100).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  /** ISO `yyyy-mm-dd`; required by the provider's identity checks in practice. */
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be yyyy-mm-dd.')
    .optional(),
  streetAddress: z.string().trim().max(255).optional(),
  suburb: z.string().trim().max(120).optional(),
  state: z.string().trim().max(10).optional(),
  postcode: z.string().trim().max(10).optional(),
});

/** The shape the UI submits. */
export type MerchantOnboardingInput = z.input<typeof onboardingSchema>;

/** Best-effort client IP from proxy headers, falling back to a placeholder. */
function clientIp(headerList: Headers): string {
  const forwarded = headerList.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headerList.get('x-real-ip') ?? '0.0.0.0';
}

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
 * Read the payout setup context for the profile UI: current state plus whether
 * the test-mode compliance simulator is available. The simulator flag is derived
 * on the server so the client never inspects provider env vars.
 */
export async function getPayoutSetupContext(): Promise<
  ActionResult<PayoutSetupContext, 'not-authenticated' | 'profile-not-found'>
> {
  const state = await getMerchantState();
  if (!state.ok) return state;

  const providerIsPinch = process.env.PAYMENTS_PROVIDER === 'pinch' && isPinchConfigured();
  let canSimulateCompliance = false;
  if (providerIsPinch) {
    const config = readPinchConfig();
    canSimulateCompliance =
      config.environment === 'test' &&
      config.simulateCompliance &&
      Boolean(config.webhookSecret) &&
      Boolean(state.data.merchantRef);
  }

  return ok({ state: state.data, canSimulateCompliance, providerIsPinch });
}

/**
 * Submit sub-merchant onboarding for the signed-in User so they can be paid.
 *
 * The provider creates the account immediately but enables nothing: compliance
 * review happens afterwards and the decision arrives via the
 * `compliance-updated` webhook, which moves `merchant_status` to APPROVED or
 * REJECTED. Until then the User stays PENDING and cannot receive funds.
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

  // AML-required request provenance, taken from the request rather than the client.
  const headerList = await headers();

  const orchestrator = createDefaultMerchantOnboardingOrchestrator({
    payments: getPaymentService(),
  });

  const result = await orchestrator.submitMerchantOnboarding({
    profileId: user.id,
    buyerDisclosureConsent: details.buyerDisclosureConsent,
    details: {
      legalEntityName: details.legalEntityName,
      tradingName: details.tradingName,
      businessEmail: details.businessEmail,
      bankAccountBsb: details.bankAccountBsb,
      bankAccountNumber: details.bankAccountNumber,
      bankAccountName: details.bankAccountName,
      businessRegistrationNumber: details.businessRegistrationNumber,
      organisationType: details.organisationType,
      contact: {
        firstName: details.contactFirstName,
        lastName: details.contactLastName,
        email: details.businessEmail,
        phone: details.contactPhone,
        dateOfBirth: details.dateOfBirth,
        streetAddress: details.streetAddress,
        suburb: details.suburb,
        state: details.state,
        postcode: details.postcode,
        country: 'AU',
      },
      ipAddress: clientIp(headerList),
      userAgent: headerList.get('user-agent') ?? 'unknown',
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

/** Outcomes the test-mode compliance simulator can deliver. */
export type SimulateComplianceInput = 'approved' | 'rejected' | 'in-review';

/**
 * TEST-MODE ONLY: drive a Pinch compliance decision for the caller's own
 * sub-merchant (Req 4.8 demo path).
 *
 * Pinch's test environment simulates payments, settlement timing and dishonours,
 * but compliance approval is a human step delivered as a `compliance-updated`
 * webhook. This action does NOT write `merchant_status` directly. It asks the
 * Pinch integration to deliver a correctly signed `compliance-updated` event to
 * our own Webhook_Handler, so the real verification -> translation -> orchestrator
 * path decides the outcome.
 *
 * Guards: authenticated caller, they must own the `mch_...` being decided, real
 * Pinch must be the active provider, and the environment must be `test`.
 */
export async function simulateMerchantCompliance(
  outcome: SimulateComplianceInput = 'approved',
): Promise<
  ActionResult<
    MerchantStateData,
    | 'not-authenticated'
    | 'profile-not-found'
    | 'not-onboarded'
    | 'not-supported'
    | 'simulation-failed'
  >
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'You must be signed in.');

  if (process.env.PAYMENTS_PROVIDER !== 'pinch' || !isPinchConfigured()) {
    return fail(
      'not-supported',
      'Compliance simulation requires the real Pinch integration (PAYMENTS_PROVIDER=pinch).',
    );
  }

  const config = readPinchConfig();
  if (config.environment !== 'test' || !config.simulateCompliance) {
    return fail('not-supported', 'Compliance simulation is only available in Pinch test mode.');
  }
  if (!config.webhookSecret) {
    return fail(
      'not-supported',
      'Set PINCH_WEBHOOK_SECRET so the simulated webhook can be signed and verified.',
    );
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('merchant_ref')
    .eq('id', user.id)
    .maybeSingle();
  if (!data) return fail('profile-not-found', 'No profile was found for your account.');

  // Ownership guard: a caller may only decide their OWN merchant, so this cannot
  // be used to approve or reject another seller.
  const merchantRef = (data.merchant_ref as string | null) ?? null;
  if (!merchantRef) {
    return fail('not-onboarded', 'Submit payout onboarding before simulating a decision.');
  }

  const result = await simulateComplianceDecision({
    config,
    merchantRef,
    outcome,
    webhookUrl: process.env.WEBHOOK_URL ?? 'http://localhost:3000/api/webhooks/pinch',
    webhookSecret: config.webhookSecret,
  });
  if (!result.ok) {
    return fail(
      'simulation-failed',
      result.error === 'DELIVERY_FAILED'
        ? `The simulated webhook could not be delivered: ${result.detail ?? 'unknown error'}`
        : 'Compliance simulation is not available in this configuration.',
    );
  }

  // Read the state back through the same projection the UI uses, so the response
  // reflects what the webhook pipeline actually persisted.
  return getMerchantState();
}
