// lib/storage/uploadItemImages.ts
//
// Browser half of the direct-to-Storage upload. Send the files to Supabase
// Storage using signed tokens minted by `createItemImageUploads`, then hand the
// resulting object paths to whichever Server Action persists them.
//
// The bytes go browser → Storage, never through a Server Action body, so a large
// photo cannot trip `serverActions.bodySizeLimit` and the original file — EXIF
// included — is stored exactly as the camera produced it.
//
// Client module: no `'use server'`, no service-role key. The anon-key browser
// client is only the transport here; each write is authorized by its own token.

import { createClient } from '@/lib/supabase/browser';
import { createItemImageUploads } from '@/lib/actions/imageUploads';
import { ITEM_IMAGES_BUCKET } from '@/lib/storage/itemImagesShared';

/** Outcome of an upload batch: every path, or the first failure's message. */
export type UploadItemImagesResult =
  | { ok: true; paths: string[] }
  | { ok: false; message: string };

/**
 * Upload `files` and return their Storage object paths, in the same order.
 *
 * All-or-nothing from the caller's point of view: on the first failure it stops
 * and reports. Files that did land are left in place — they sit under an unused
 * per-upload folder and are never referenced by a row, so they are inert. The
 * caller can simply retry.
 */
export async function uploadItemImages(
  files: File[],
): Promise<UploadItemImagesResult> {
  if (files.length === 0) return { ok: true, paths: [] };

  const prepared = await createItemImageUploads(files.map((file) => file.type));
  if (!prepared.ok) return { ok: false, message: prepared.message };

  const { uploads } = prepared.data;
  if (uploads.length !== files.length) {
    return { ok: false, message: 'Could not prepare the upload. Please try again.' };
  }

  const supabase = createClient();
  const paths: string[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const { path, token } = uploads[i];
    const { error } = await supabase.storage
      .from(ITEM_IMAGES_BUCKET)
      .uploadToSignedUrl(path, token, files[i], {
        contentType: files[i].type,
      });
    if (error) {
      return {
        ok: false,
        message:
          files.length === 1
            ? `That photo could not be uploaded: ${error.message}`
            : `Photo ${i + 1} could not be uploaded: ${error.message}`,
      };
    }
    paths.push(path);
  }

  return { ok: true, paths };
}
