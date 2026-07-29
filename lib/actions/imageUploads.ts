'use server';

// lib/actions/imageUploads.ts
//
// Hands the browser signed, single-use permission to upload item photos straight
// to Supabase Storage, so the bytes never travel inside a Server Action body.
//
// WHY: photos passed to an action are buffered in full by the Next server, which
// caps the body (`serverActions.bodySizeLimit`). One phone photo can exceed the
// default. Uploading direct also keeps the original file and its EXIF intact,
// which matters because these photos are the evidence base for a Condition_
// Dispute or an Objective_Fraud claim (Req 7, Req 8).
//
// WHAT THIS DOES NOT DO: it does not widen Storage permissions. There is no
// bucket-wide write grant for `authenticated`; every write is authorized by a
// token bound to one server-chosen object path under the caller's own prefix.
// The paths that come back are still re-verified in `uploadImages` before any
// row references them, so a client that invents a path gets nowhere.

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  createSignedImageUploads,
  type SignedImageUpload,
} from '@/lib/storage/itemImages';
import { fail, ok, type ActionResult } from '@/lib/actions/result';

/**
 * Mint one upload target per photo the caller wants to send.
 *
 * `contentTypes` is what the browser reports for each file, in order; a type
 * outside the image allowlist is refused here rather than at upload time, so the
 * user finds out before the bytes move. The response order matches the request
 * order, and index `i` is the path for file `i`.
 *
 * Requires an authenticated caller: the owner prefix comes from the session, not
 * from anything the client sends.
 */
export async function createItemImageUploads(
  contentTypes: string[],
): Promise<
  ActionResult<
    { uploads: SignedImageUpload[] },
    'unauthenticated' | 'upload-prepare-failed'
  >
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('unauthenticated', 'Sign in to upload photos.');

  try {
    const uploads = await createSignedImageUploads(
      createAdminClient(),
      user.id,
      contentTypes,
    );
    return ok({ uploads });
  } catch (error) {
    return fail(
      'upload-prepare-failed',
      error instanceof Error ? error.message : 'Could not prepare the upload.',
    );
  }
}
