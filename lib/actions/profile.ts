'use server';

// lib/actions/profile.ts
//
// Profile Server Action — a thin wrapper over the pure profile validator plus a
// user-scoped persist (Req 1.4, 1.5). It runs against the cookie-bound server
// client so the write is authorized by RLS: the `profiles_owner_update` policy
// (`auth.uid() = id`) guarantees a User can only update their own Profile, and
// on a validation failure the previously stored values are left untouched
// (Req 1.5).

import { createClient } from '@/lib/supabase/server';
import { validateProfileUpdate } from '@/domain/validation';
import { type ActionResult, fail, ok } from './result';

/** Typed failure codes for {@link updateProfile}. */
export type UpdateProfileError =
  | 'NOT_AUTHENTICATED' // no signed-in User (Req 1.7)
  | 'VALIDATION' // a field was empty or too long (Req 1.5)
  | 'UPDATE_FAILED'; // the persist was rejected (RLS or DB error)

/** The profile fields a User may edit. */
export interface ProfileUpdateFields {
  displayName: string;
  contactEmail: string;
}

/** The persisted profile shape returned on success. */
export interface ProfileData {
  id: string;
  displayName: string;
  contactEmail: string;
}

/**
 * Update the caller's own Profile (Req 1.4, 1.5).
 *
 * 1. Require an authenticated User (Req 1.7).
 * 2. Validate the submitted fields; on failure return the offending field and
 *    persist nothing, so prior values are retained (Req 1.5).
 * 3. Persist via the cookie-bound client. RLS confines the update to the
 *    caller's own row (`auth.uid() = id`), so ownership is enforced at the DB.
 */
export async function updateProfile(
  fields: ProfileUpdateFields,
): Promise<ActionResult<ProfileData, UpdateProfileError>> {
  const supabase = await createClient();

  // 1. Require an authenticated User.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return fail('NOT_AUTHENTICATED', 'You must be signed in to update your profile.');
  }

  // 2. Validate; a failure leaves the stored Profile untouched (Req 1.5).
  const validation = validateProfileUpdate(fields);
  if (!validation.ok) {
    return fail('VALIDATION', validation.message, validation.field);
  }
  const { displayName, contactEmail } = validation.value;

  // 3. Persist to the caller's own Profile — RLS enforces ownership (Req 1.6).
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: displayName, contact_email: contactEmail })
    .eq('id', user.id)
    .select('id, display_name, contact_email')
    .single();

  if (error || !data) {
    return fail('UPDATE_FAILED', error?.message ?? 'Profile update was rejected.');
  }

  return ok({
    id: data.id,
    displayName: data.display_name,
    contactEmail: data.contact_email,
  });
}
