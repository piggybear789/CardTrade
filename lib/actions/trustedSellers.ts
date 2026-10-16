'use server';

// lib/actions/trustedSellers.ts
//
// The member's half of Trusted Seller reviews (0152, 0153): sending an application.
//
// Staff decide in `lib/actions/admin.ts`. This module only records what the member
// told us; nothing is granted here, and nothing a member submits can approve them.
//
// An application is one free-text answer plus optional photos. The photos are uploaded
// straight to the private `trusted-seller-photos` bucket under the member's own id
// (`createTrustedSellerPhotoUpload` mints a one-object token), and only their paths
// come through here, checked against that prefix and against what is really in the
// bucket. The review row is written with the service role, because
// `trusted_seller_reviews` has no member write grant.

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import { withActionLog } from '@/lib/errors/withActionLog';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { viewerTradingRegion } from '@/lib/location/resolveRegion';
import { refreshMemberMatchKeys } from '@/lib/risk/scamMatching';
import {
  createSignedTrustedSellerPhotoUpload,
  existingTrustedSellerPhotos,
} from '@/lib/storage/trustedSellerPhotos';
import { isTradingRegion } from '@/domain/region';
import {
  validateTrustedSellerApplication,
  type TrustedSellerApplicationInput,
} from '@/domain/trustedSellers/application';
import { type ActionResult, fail, ok } from './result';

export type RequestTrustedSellerReviewError =
  | 'not-authenticated'
  /** A field failed validation; `field` is `details` or `photos`. */
  | 'invalid-application'
  /** The member has no open trading region, so they cannot sell at all yet. */
  | 'not-trading-region'
  /** A decision has already been made on this member's review. */
  | 'already-decided'
  | 'persistence-error';

const SAVE_FAILED = "We couldn't save your application. Please try again.";

/** Mint a write token for one application photo, under the caller's own folder. */
export const createTrustedSellerPhotoUpload = withActionLog('trustedSellers.createTrustedSellerPhotoUpload', async function createTrustedSellerPhotoUpload(
  contentType: string,
): Promise<ActionResult<{ path: string; token: string }, 'not-authenticated' | 'upload-prepare-failed'>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to add photos.');

  try {
    return ok(await createSignedTrustedSellerPhotoUpload(createAdminClient(), user.id, contentType));
  } catch (error) {
    return fail(
      'upload-prepare-failed',
      error instanceof Error ? error.message : 'Could not prepare the upload.',
    );
  }
});

/**
 * Send a Trusted Seller application, or update one that is still pending.
 *
 * Idempotent while PENDING: a second submission replaces the answer and photos rather
 * than opening a second review. Once decided, it refuses, so a declined member cannot
 * put themselves back at the top of the queue by resubmitting.
 */
export const requestTrustedSellerReview = withActionLog('trustedSellers.requestTrustedSellerReview', async function requestTrustedSellerReview(
  input: TrustedSellerApplicationInput,
): Promise<ActionResult<{ status: 'PENDING' }, RequestTrustedSellerReviewError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to apply.');

  const validation = validateTrustedSellerApplication(input, `${user.id}/`);
  if (!validation.ok) return fail('invalid-application', validation.message, validation.field);

  const region = await viewerTradingRegion();
  if (!region || !isTradingRegion(region)) {
    return fail(
      'not-trading-region',
      "NoDitto isn't open for selling in your country yet, so we can't review you yet.",
    );
  }

  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from('trusted_seller_reviews')
    .select('id, status')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (readError) return fail('persistence-error', SAVE_FAILED);
  if (existing && existing.status !== 'PENDING') {
    return fail('already-decided', "We've already reviewed your application, so it can't be sent again.");
  }

  // Only photos that really were uploaded to this member's folder.
  let photoPaths: string[];
  try {
    photoPaths = await existingTrustedSellerPhotos(admin, user.id, validation.value.photoPaths);
  } catch {
    return fail('persistence-error', SAVE_FAILED);
  }

  const answers = { details: validation.value.details, photo_paths: photoPaths };
  const { error: writeError } = existing
    ? await admin
        .from('trusted_seller_reviews')
        .update(answers)
        .eq('id', existing.id)
        .eq('status', 'PENDING')
    : await admin
        .from('trusted_seller_reviews')
        .upsert({ profile_id: user.id, ...answers }, { onConflict: 'profile_id', ignoreDuplicates: true });
  if (writeError) return fail('persistence-error', SAVE_FAILED);

  // Fresh scam-report match keys (0154) before staff read the application, so the
  // Trusted Seller card's warning line is current. After the response; never throws.
  const userId = user.id;
  after(() => refreshMemberMatchKeys(userId));

  revalidatePath('/trusted-sellers/apply');
  revalidatePath('/profile');
  return ok({ status: 'PENDING' });
});
