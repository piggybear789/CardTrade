import 'server-only';

// lib/auth/ensureProfile.ts
//
// Idempotent Profile provisioning for a Supabase Auth user (Req 1.1).
//
// Password sign-up creates the `profiles` row inline (see lib/actions/auth.ts),
// but an OAuth user first appears at the callback Route Handler, so the row has
// to be created there instead. Both paths funnel through this helper so a
// Profile always exists with KYC_Status UNVERIFIED before the User reaches a
// protected page.
//
// Client choice: the admin client. Immediately after an OAuth exchange the
// cookie-bound session may not yet be visible to a fresh client, and the RLS
// `profiles_owner_insert` policy (`auth.uid() = id`) would reject the insert.
// This is a trusted server-side provisioning step keyed to the id Supabase Auth
// just returned, so the RLS-bypassing client is the right binding.

import { createAdminClient } from '@/lib/supabase/admin';

/** Outcome of {@link ensureProfile}. */
export type EnsureProfileResult =
  | { ok: true; created: boolean }
  | { ok: false; message: string };

/**
 * Derive a non-empty display name, capped at the 255-char check constraint on
 * `profiles.display_name`. Prefers an OAuth-provided name, then the email
 * local-part, then the raw email.
 */
export function defaultDisplayName(email: string, providerName?: string | null): string {
  const fromProvider = providerName?.trim();
  if (fromProvider) {
    return fromProvider.slice(0, 255);
  }
  const localPart = email.split('@')[0]?.trim();
  const candidate = localPart && localPart.length > 0 ? localPart : email;
  return candidate.slice(0, 255);
}

/**
 * Create the `profiles` row for `userId` if it does not already exist.
 *
 * Safe to call on every sign-in: an existing row short-circuits, and a
 * concurrent insert that loses the unique-key race is treated as success.
 *
 * @param userId - The Supabase Auth user id, used as the Profile primary key.
 * @param email - Contact email seeded onto the Profile.
 * @param providerName - Optional display name supplied by the OAuth provider.
 */
export async function ensureProfile(
  userId: string,
  email: string,
  providerName?: string | null,
): Promise<EnsureProfileResult> {
  const admin = createAdminClient();

  const { data: existing, error: readError } = await admin
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (readError) {
    return { ok: false, message: readError.message };
  }
  if (existing) {
    return { ok: true, created: false };
  }

  const { error: insertError } = await admin.from('profiles').insert({
    id: userId,
    display_name: defaultDisplayName(email, providerName),
    contact_email: email,
    kyc_status: 'UNVERIFIED',
  });

  if (insertError) {
    // Lost a concurrent-insert race: the row now exists, which is what we want.
    if (/duplicate key|already exists|unique/i.test(insertError.message)) {
      return { ok: true, created: false };
    }
    return { ok: false, message: insertError.message };
  }

  return { ok: true, created: true };
}
