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
// That is also why this file measures the images. Because the server never sees
// these bytes, it cannot read their dimensions the way it does for the
// action-body path, and the catalog mosaic needs them (`items.image_dims`,
// migration 0106). The measurements travel back alongside the paths as an
// index-aligned array and are treated as an untrusted claim on arrival —
// `sanitizeImageDimList` in `lib/images/dimensions.ts` is the gate.
//
// Client module: no `'use server'`, no service-role key. The anon-key browser
// client is only the transport here; each write is authorized by its own token.

import { createClient } from '@/lib/supabase/browser';
import { createItemImageUploads } from '@/lib/actions/imageUploads';
import { ITEM_IMAGES_BUCKET } from '@/lib/storage/itemImagesShared';
import { sanitizeImageDim, type ImageDim } from '@/lib/images/dimensions';

/**
 * Outcome of an upload batch: every path plus its measured size, or the first
 * failure's message. `dims[i]` describes `paths[i]`, and is `null` when the
 * browser could not decode that file.
 */
export type UploadItemImagesResult =
  | { ok: true; paths: string[]; dims: (ImageDim | null)[] }
  | { ok: false; message: string };

/**
 * Intrinsic size of a file as the browser would render it, or `null`.
 *
 * `imageOrientation: 'from-image'` matters: a phone photo shot in portrait is
 * usually stored landscape with an EXIF tag asking the viewer to rotate it, and
 * the catalog needs the size the user will actually see. It is also what the
 * server does for the other upload path (see `lib/images/decode.ts`), so the
 * same photo records the same shape whichever route it took.
 *
 * Never throws. A file the browser cannot decode is still a file Storage may
 * accept, and losing the layout hint must not lose the upload.
 */
async function measure(file: File): Promise<ImageDim | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      });
      const dim = sanitizeImageDim({ w: bitmap.width, h: bitmap.height });
      bitmap.close();
      return dim;
    }
  } catch {
    // Fall through to the <img> decode below.
  }

  // Older Safari has no `createImageBitmap` options support. An <img> element
  // applies EXIF orientation by default, so `naturalWidth` agrees with the
  // bitmap path above.
  return new Promise<ImageDim | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (dim: ImageDim | null) => {
      URL.revokeObjectURL(url);
      resolve(dim);
    };
    img.onload = () =>
      done(sanitizeImageDim({ w: img.naturalWidth, h: img.naturalHeight }));
    img.onerror = () => done(null);
    img.src = url;
  });
}

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
  if (files.length === 0) return { ok: true, paths: [], dims: [] };

  const prepared = await createItemImageUploads(files.map((file) => file.type));
  if (!prepared.ok) return { ok: false, message: prepared.message };

  const { uploads } = prepared.data;
  if (uploads.length !== files.length) {
    return { ok: false, message: 'Could not prepare the upload. Please try again.' };
  }

  // Measured up front and in parallel: decoding is off the main thread for
  // `createImageBitmap`, and doing it while the network is idle keeps it off
  // the critical path of the uploads that follow.
  const dims = await Promise.all(files.map(measure));

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

  return { ok: true, paths, dims };
}
