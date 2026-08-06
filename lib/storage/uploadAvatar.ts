// lib/storage/uploadAvatar.ts
//
// Browser half of the avatar upload: get a signed token from the server, PUT the
// file straight to Supabase Storage, hand the resulting object path back so a
// Server Action can persist it.
//
// The bytes go browser -> Storage and never through a Server Action body, so a
// phone photo cannot trip `serverActions.bodySizeLimit`.
//
// Client module: no `'use server'`, no service-role key. The anon-key browser
// client is only the transport; the write is authorized by the single-use token.

import { createClient } from '@/lib/supabase/browser';
import { prepareAvatarUpload, setMyAvatar } from '@/lib/actions/profile';
import {
  MAX_AVATAR_BYTES,
  PROFILE_IMAGES_BUCKET,
  isAllowedAvatarType,
} from '@/lib/storage/profileImagesShared';

/** Outcome of setting a new avatar: the stored path, or a message to show. */
export type UploadAvatarResult =
  | { ok: true; avatarPath: string }
  | { ok: false; message: string };

/**
 * Upload `file` as the caller's avatar and persist it, returning the stored path.
 *
 * Checks format and size BEFORE asking for a token. The bucket enforces both
 * anyway (migration 0066) and so does the server, but a local check turns a failed
 * round trip into an instant, specific message — and a 3 MB photo would otherwise
 * upload in full before Storage rejected it.
 */
export async function uploadAvatar(file: File): Promise<UploadAvatarResult> {
  if (!isAllowedAvatarType(file.type)) {
    return { ok: false, message: 'Choose a PNG, JPEG, or WebP image.' };
  }
  if (file.size === 0) {
    return { ok: false, message: 'That file appears to be empty.' };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { ok: false, message: 'Pick a picture under 2 MB.' };
  }

  const prepared = await prepareAvatarUpload(file.type);
  if (!prepared.ok) return { ok: false, message: prepared.message };

  const { path, token } = prepared.data;
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(PROFILE_IMAGES_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });

  if (error) {
    return { ok: false, message: `That picture could not be uploaded: ${error.message}` };
  }

  // Persist only after the bytes have landed. If this fails the object is left in
  // place, unreferenced and inert, and the member can simply retry.
  const saved = await setMyAvatar(path);
  if (!saved.ok) return { ok: false, message: saved.message };

  return { ok: true, avatarPath: saved.data.avatarPath ?? path };
}

/** Remove the caller's avatar, falling back to initials everywhere. */
export async function clearAvatar(): Promise<{ ok: true } | { ok: false; message: string }> {
  const cleared = await setMyAvatar(null);
  return cleared.ok ? { ok: true } : { ok: false, message: cleared.message };
}
