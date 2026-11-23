import 'server-only';

// lib/identity/nameDisclosureConsent.ts
//
// The seller's agreement that their verified name is shown to a buyer before they pay
// (Req 4.8-4.12): `merchant_identity_disclosure_consented_at`, the one field
// `sellerIdentityDisclosure` needs beyond Stripe Identity.
//
// RECORDED WHERE THE SELLER ALREADY ACTS, NOT AS A STEP OF ITS OWN. It used to be
// written only when payout setup started, which made a verified seller unpayable
// until they opened a Connect account. It is now written when a seller makes or
// saves a private sale (`createDealInvite`, `updateDealInvite`), whose screen states
// beside the button that the buyer sees the name on their ID before paying. That
// stated disclosure, at the control that acts on it, is the consent; the payout
// screen records it the same way.
//
// Written once, absent to present, like the names it governs. It discloses nothing by
// itself: `sellerIdentityDisclosure` also needs Stripe Identity passed. Service role,
// because the column has no member update grant.

import { createAdminClient } from '@/lib/supabase/admin';

export type NameDisclosureOutcome =
  | { ok: true; consentedAt: string | null }
  | { ok: false; reason: 'NOT_VERIFIED' | 'PERSIST_FAILED' };

/**
 * Record the consent if it has not been given yet, and return when it was. With
 * `requireVerified`, refuses a member who has not passed Stripe Identity.
 */
export async function recordNameDisclosureConsent(
  profileId: string,
  { requireVerified }: { requireVerified: boolean },
): Promise<NameDisclosureOutcome> {
  const admin = createAdminClient();
  const { data: profile, error: readError } = await admin
    .from('profiles')
    .select('identity_check_status, merchant_identity_disclosure_consented_at')
    .eq('id', profileId)
    .maybeSingle();
  if (readError) return { ok: false, reason: 'PERSIST_FAILED' };
  // A seller who makes a sale before verifying has still agreed, on that screen, to
  // the name on their ID being shown once there is one; asking again after Stripe
  // Identity would be the extra step this exists to remove. Nothing is disclosed
  // until the gate is satisfied (`sellerIdentityDisclosure`).
  if (requireVerified && profile?.identity_check_status !== 'VERIFIED') {
    return { ok: false, reason: 'NOT_VERIFIED' };
  }
  if (!profile) return { ok: false, reason: 'PERSIST_FAILED' };
  const existing = profile.merchant_identity_disclosure_consented_at as string | null;
  if (existing) return { ok: true, consentedAt: existing };
  const consentedAt = new Date().toISOString();
  const { error } = await admin
    .from('profiles')
    .update({ merchant_identity_disclosure_consented_at: consentedAt })
    .eq('id', profileId)
    .is('merchant_identity_disclosure_consented_at', null);
  if (error) return { ok: false, reason: 'PERSIST_FAILED' };
  return { ok: true, consentedAt };
}
