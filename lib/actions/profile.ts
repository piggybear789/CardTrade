'use server';

// lib/actions/profile.ts
//
// Profile Server Action — a thin wrapper over the pure profile validator plus a
// user-scoped persist (Req 1.4, 1.5). It runs against the cookie-bound server
// client so the write is authorized by RLS: the `profiles_owner_update` policy
// (`auth.uid() = id`) guarantees a User can only update their own Profile, and
// on a validation failure the previously stored values are left untouched
// (Req 1.5).

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ensureProfile } from '@/lib/auth/ensureProfile';
import { friendlyWriteFailure } from '@/lib/actions/writeFailure';
import {
  createSignedAvatarUpload,
  removeAvatarObject,
  verifyStoredAvatar,
  type SignedAvatarUpload,
} from '@/lib/storage/profileImages';
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
    return fail('UPDATE_FAILED', friendlyWriteFailure(error, 'Profile update was rejected.'));
  }

  // 4. Revalidate every surface that renders the display name.
  //
  // Without this the write persisted but nothing on screen changed until a hard
  // reload — the editor closed with "Profile updated" while the page and the nav
  // rail both still showed the old name, which reads as the save having failed.
  // Caught by tests/e2e/specs/profile-and-payouts.spec.ts.
  //
  // `'layout'` and not `'page'`: the name is rendered by MarketplaceShell's rail,
  // which is layout-level chrome present on every authenticated route, so
  // revalidating the page alone would leave the rail stale on all of them.
  revalidatePath('/', 'layout');
  // The public seller profile is a separate route segment and is not covered by
  // the root layout revalidation above.
  revalidatePath(`/sellers/${user.id}`);

  return ok({
    id: data.id,
    displayName: data.display_name,
    contactEmail: data.contact_email,
  });
}

/** Persisted result of the one-time member onboarding flow. */
export interface OnboardingCompletionData {
  displayName: string;
  onboardingCompletedAt: string;
}

/**
 * Complete member onboarding after the user has chosen their public alias and path.
 *
 * The contact email remains server-owned: it is read from the existing Profile so a
 * client cannot blank or replace it just to complete onboarding. The authenticated
 * owner may update only `display_name` and `onboarding_completed_at`; provider and
 * role columns remain protected by both column grants and RLS.
 *
 * A MISSING PROFILE IS REPAIRED HERE RATHER THAN TREATED AS FATAL. `ensureProfile`
 * runs at the two points a member is BORN — password sign-up and the OAuth callback —
 * so nothing repaired a session whose row went missing afterwards. That state is
 * reachable and was reached: an already-signed-in member never passes through the
 * callback again, so they were redirected here to onboard, the update matched zero
 * rows, and `.single()` failed with PostgREST's "Cannot coerce the result to a single
 * JSON object" — shown to them verbatim, with no way to browse or sign out. The
 * account was bricked by a message about JSON coercion.
 *
 * Onboarding is the one screen every such member is already being sent to, which
 * makes it the right place to heal: it needs the row anyway, and it now creates one
 * instead of reporting an impossible-looking error.
 */
export async function completeOnboarding(
  displayName: string,
): Promise<ActionResult<OnboardingCompletionData, UpdateProfileError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail('NOT_AUTHENTICATED', 'You must be signed in to finish onboarding.');
  }

  // `maybeSingle`, not `single`: "this member has no profile yet" is a state to
  // handle, not an error to render.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('contact_email')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return fail('UPDATE_FAILED', friendlyWriteFailure(profileError));
  }

  // Repair before validating: the contact email below is read from the row.
  if (!profile) {
    const repaired = await ensureProfile(
      user.id,
      user.email ?? '',
      (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        null,
    );
    if (!repaired.ok) {
      return fail('UPDATE_FAILED', repaired.message);
    }
  }

  // The contact email stays server-owned. A repaired profile may not carry one yet,
  // and the validator wants a string, so fall back to the address Auth holds.
  const contactEmail = profile?.contact_email ?? user.email ?? '';

  const validation = validateProfileUpdate({
    displayName,
    contactEmail,
  });
  if (!validation.ok) {
    return fail('VALIDATION', validation.message, validation.field);
  }

  const onboardingCompletedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('profiles')
    .update({
      display_name: validation.value.displayName,
      onboarding_completed_at: onboardingCompletedAt,
    })
    .eq('id', user.id)
    .select('display_name, onboarding_completed_at')
    .maybeSingle();

  if (error) {
    return fail('UPDATE_FAILED', friendlyWriteFailure(error));
  }
  if (!data?.onboarding_completed_at) {
    return fail(
      'UPDATE_FAILED',
      'We could not save your details. Please reload the page and try again.',
    );
  }

  return ok({
    displayName: data.display_name,
    onboardingCompletedAt: data.onboarding_completed_at,
  });
}

// ---------------------------------------------------------------------------
// Avatars (0066)
// ---------------------------------------------------------------------------
//
// Two steps, because the bytes must not travel inside a Server Action body:
//   1. `prepareAvatarUpload` mints a single-use signed URL for a server-chosen
//      path under the caller's own prefix.
//   2. The browser PUTs the file straight to Storage
//      (`lib/storage/uploadAvatar.ts`).
//   3. `setMyAvatar` verifies the resulting path and persists it.
//
// An avatar is NEVER identity. It is self-chosen and unverified, so nothing here
// touches merchant/identity columns, and no surface may read it as assurance — that
// is the Identity_Gate plus `merchant_legal_entity_name`.

/** Typed failure codes for the avatar actions. */
export type AvatarError =
  | 'NOT_AUTHENTICATED'
  | 'INVALID_IMAGE' // wrong format, too large, or not the caller's object
  | 'UPDATE_FAILED';

/**
 * Mint a single-use signed upload target for the caller's new avatar.
 *
 * `contentType` is what the browser reports for the file; an unaccepted type is
 * refused here rather than at upload time, so the member finds out before the bytes
 * move.
 */
export async function prepareAvatarUpload(
  contentType: string,
): Promise<ActionResult<SignedAvatarUpload, AvatarError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('NOT_AUTHENTICATED', 'Sign in to change your picture.');

  try {
    return ok(await createSignedAvatarUpload(createAdminClient(), user.id, contentType));
  } catch (error) {
    return fail(
      'INVALID_IMAGE',
      error instanceof Error ? error.message : 'Could not prepare the upload.',
    );
  }
}

/**
 * Persist an avatar the browser has already uploaded, or clear it with `null`.
 *
 * The path is verified against the caller's own prefix, existence, type and size
 * before anything is written — a path from a client is a claim, not a fact.
 *
 * The PREVIOUS object is deleted after a successful write, so replacing a picture
 * does not accumulate files forever. Deletion is best-effort and deliberately after
 * the row update: an orphaned object is harmless, whereas deleting first and then
 * failing to save would leave a profile pointing at nothing.
 */
export async function setMyAvatar(
  avatarPath: string | null,
): Promise<ActionResult<{ avatarPath: string | null }, AvatarError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('NOT_AUTHENTICATED', 'Sign in to change your picture.');

  const admin = createAdminClient();

  if (avatarPath !== null) {
    try {
      await verifyStoredAvatar(admin, user.id, avatarPath);
    } catch (error) {
      return fail(
        'INVALID_IMAGE',
        error instanceof Error ? error.message : 'That image could not be used.',
      );
    }
  }

  // Read the outgoing path first so it can be cleaned up after the swap.
  const { data: before } = await supabase
    .from('profiles')
    .select('avatar_path')
    .eq('id', user.id)
    .maybeSingle();

  // Cookie-bound client: the `profiles_owner_update` policy (`auth.uid() = id`)
  // confines this to the caller's own row, and 0066 grants UPDATE on this column
  // specifically — `authenticated` holds no table-wide update grant.
  const { data, error } = await supabase
    .from('profiles')
    .update({ avatar_path: avatarPath })
    .eq('id', user.id)
    .select('avatar_path')
    .single();

  if (error || !data) {
    return fail('UPDATE_FAILED', friendlyWriteFailure(error, 'Your picture could not be saved.'));
  }

  const previous = (before?.avatar_path as string | null) ?? null;
  if (previous && previous !== data.avatar_path) {
    await removeAvatarObject(admin, previous);
  }

  return ok({ avatarPath: (data.avatar_path as string | null) ?? null });
}

