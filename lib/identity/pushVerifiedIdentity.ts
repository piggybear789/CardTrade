// lib/identity/pushVerifiedIdentity.ts
//
// Stamp a member's Stripe-Identity-verified outputs onto their Connect account
// (unified-seller-onboarding, Req 4.1, 4.6).
//
// WHY THIS IS NOT A SERVER ACTION (ESC-35). `pushVerifiedIdentityToConnect` used to be
// exported from the `'use server'` module `lib/actions/merchant.ts`, which made it a
// public endpoint taking any `profileId` with no session check. Every export of a
// `'use server'` module is addressable by anyone who learns its id. It does nothing a
// caller can see, but it reads a member's verified DOB and address and writes them to a
// provider account on their behalf — that is not something a stranger may trigger. It
// lives here now, `server-only`, called by the identity and merchant actions (after
// their own session checks) and by the webhook pipeline.
//
// The DOB / address it carries are handed straight to the provider and never
// persisted, logged or returned.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import type { ManagedMerchantDetails } from '@/domain/services/types';
import { regionForProfile } from '@/lib/regionBinding';

/**
 * Build the transient Prefill_Object from the member's own Identity session.
 *
 * Returns `undefined` when there is no session to read or the provider cannot be read —
 * the account is then created without prefill and Stripe collects the fields itself
 * (Req 4.6), which is a valid degrade, not a failure.
 */
export async function buildIdentityPrefill(
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
 * Write the member's verified Identity outputs onto their connected account, if one
 * already exists. Hosted Connect skips fields already on the account. Failures are
 * swallowed: Connect then collects the fields itself (Req 4.6).
 *
 * The CALLER is responsible for having established that `profileId` is the session
 * user, or that the call is a trusted server path (the webhook pipeline).
 */
export async function pushVerifiedIdentityToConnect(profileId: string): Promise<void> {
  const payments = getPaymentService(await regionForProfile(profileId));
  if (!payments.prefillManagedMerchant) return;

  const { data } = await createAdminClient()
    .from('profiles')
    .select('merchant_ref')
    .eq('id', profileId)
    .maybeSingle();
  const merchantRef = (data?.merchant_ref as string | null) ?? null;
  if (!merchantRef) return;

  const prefill = await buildIdentityPrefill(profileId, payments);
  if (!prefill) return;

  try {
    await payments.prefillManagedMerchant(merchantRef, prefill);
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
    console.warn(`[identity] could not stamp Connect identity: ${message}`);
  }
}
