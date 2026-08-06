import 'server-only';

// lib/storage/profileImages.ts
//
// Storage glue for profile avatars. Deliberately a sibling of
// `lib/storage/itemImages.ts` rather than a generalisation of it: the two have
// different limits (2 MB vs 10 MB), different formats (no GIF for avatars), and
// different lifecycles (one avatar replaces the last; item photos accumulate as
// dispute evidence). A shared helper parameterised by bucket would let a caller
// pass the wrong rules, and the failure mode is a silent 404.
//
// ONE WAY IN: a single-use SIGNED UPLOAD URL minted here against a path THIS
// module chooses from the caller's own id. The bytes go browser -> Storage and
// never enter a Server Action body. There is no bucket-wide write grant for
// `authenticated` (see migration 0066), so without a token there is no way in, and
// the browser can neither pick a path nor reach another member's prefix.
//
// Paths, never URLs, are what `profiles.avatar_path` holds; `avatarUrl()` in
// `lib/format.ts` resolves them for display.

import { randomUUID } from 'node:crypto';
import type { createAdminClient } from '@/lib/supabase/admin';
import {
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_BYTES,
  PROFILE_IMAGES_BUCKET,
  isAllowedAvatarType,
} from '@/lib/storage/profileImagesShared';

export { PROFILE_IMAGES_BUCKET };

/** The service-role client these helpers write through. */
type AdminClient = ReturnType<typeof createAdminClient>;

/** One signed, single-use upload target: where to put the file, and the token. */
export interface SignedAvatarUpload {
  /** Object path the browser must upload to. Chosen here, never by the client. */
  path: string;
  /** Single-use token authorizing a write to exactly that path. */
  token: string;
}

/** Map an accepted MIME type to the stored object's extension. */
function extFor(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      // Unreachable: callers validate the type first. Present so the function is
      // total rather than returning undefined if that ever stops being true.
      return 'bin';
  }
}

/**
 * Ensure the avatar bucket exists with the right constraints (idempotent).
 *
 * Migration 0066 creates it, so in a migrated environment this is a no-op read.
 * It stays for the same reason the item-images equivalent does: the size cap and
 * MIME allowlist must hold on the BUCKET, because a signed-URL upload never passes
 * through this server and Storage is the only thing in that path able to refuse an
 * oversized file or a non-image.
 */
async function ensureAvatarBucket(admin: AdminClient): Promise<void> {
  const constraints = {
    public: true,
    fileSizeLimit: MAX_AVATAR_BYTES,
    allowedMimeTypes: Array.from(ALLOWED_AVATAR_TYPES),
  };

  const { data } = await admin.storage.getBucket(PROFILE_IMAGES_BUCKET);
  if (!data) {
    await admin.storage.createBucket(PROFILE_IMAGES_BUCKET, constraints);
    return;
  }
  if (data.file_size_limit == null || data.allowed_mime_types == null) {
    await admin.storage.updateBucket(PROFILE_IMAGES_BUCKET, constraints);
  }
}

/**
 * Mint one signed, single-use upload target for a new avatar.
 *
 * A FRESH UUID FOLDER EVERY TIME, never a stable `<owner>/avatar.jpg`. Overwriting
 * one path would mean every cached copy of the old picture — CDN, browser, an open
 * tab — keeps serving it, so a member who replaces an unflattering photo, or an
 * admin who clears an abusive one, would not reliably see the change. A new path
 * per upload makes replacement immediate and cache-busting unnecessary.
 *
 * Throws when the declared type is not an accepted image, so a bad request never
 * produces a token.
 */
export async function createSignedAvatarUpload(
  admin: AdminClient,
  ownerId: string,
  contentType: string,
): Promise<SignedAvatarUpload> {
  if (!isAllowedAvatarType(contentType)) {
    throw new Error('Choose a PNG, JPEG, or WebP image.');
  }

  await ensureAvatarBucket(admin);

  const path = `${ownerId}/${randomUUID()}.${extFor(contentType)}`;
  const { data, error } = await admin.storage
    .from(PROFILE_IMAGES_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`Could not prepare the upload: ${error?.message ?? 'unknown error'}`);
  }

  return { path, token: data.token };
}

/**
 * Verify an avatar path the client claims to have uploaded, before it is persisted.
 *
 * A path from the client is a claim, not a fact: it could name another member's
 * object, one that was never uploaded, or a file that somehow slipped past the
 * bucket rules. Three cheap checks — owner prefix, existence, and recorded
 * type/size. Throws with a message safe to show the user.
 */
export async function verifyStoredAvatar(
  admin: AdminClient,
  ownerId: string,
  path: string,
): Promise<void> {
  // Reject traversal and cross-owner paths before spending a round trip. An
  // absolute URL is not an object in our bucket and cannot be verified, so unlike
  // item images it is refused outright — nothing in the avatar flow produces one.
  if (/^https?:\/\//i.test(path)) {
    throw new Error('That is not an uploaded image.');
  }
  if (!path.startsWith(`${ownerId}/`) || path.includes('..')) {
    throw new Error('That image does not belong to you.');
  }

  const { data, error } = await admin.storage.from(PROFILE_IMAGES_BUCKET).info(path);
  if (error || !data) {
    throw new Error('Your picture finished uploading but could not be found.');
  }
  if (!isAllowedAvatarType(data.contentType ?? '')) {
    throw new Error('Choose a PNG, JPEG, or WebP image.');
  }
  const size = data.size ?? 0;
  if (size === 0 || size > MAX_AVATAR_BYTES) {
    throw new Error('Your picture must be under 2 MB.');
  }
}

/**
 * Best-effort deletion of a superseded or cleared avatar object.
 *
 * Never allowed to throw. A failure here must not fail the surrounding write: the
 * row no longer references the object, so the worst case is an orphaned file, and
 * reporting a storage hiccup as "your picture could not be removed" when it has in
 * fact been removed from the profile would be worse.
 */
export async function removeAvatarObject(
  admin: AdminClient,
  path: string | null | undefined,
): Promise<void> {
  if (!path || /^https?:\/\//i.test(path)) return;
  try {
    await admin.storage.from(PROFILE_IMAGES_BUCKET).remove([path]);
  } catch {
    // Orphaned object; the profile no longer points at it.
  }
}
