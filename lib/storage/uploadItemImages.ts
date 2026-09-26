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
// ONE EXCEPTION, AND ONLY FOR LISTING PHOTOS: a photo the image optimizer cannot
// serve. Past 8192px on a side (or over the bucket's size cap) Vercel hands the
// original to every visitor untouched, so a single 84-megapixel listing made the
// marketplace download 10 MB and spend a second decoding it on each page view.
// With `fitOversizedForDisplay` those photos are re-encoded to a size every
// browser can draw, which drops their EXIF. Trade and deal photos never opt in:
// they are dispute evidence (see `lib/actions/imageUploads.ts`), are not shown
// in the catalog, and keep their original bytes whatever their size.
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
import {
  ITEM_IMAGE_MAX_BYTES,
  ITEM_IMAGE_OPTIMIZER_MAX_EDGE,
  ITEM_IMAGES_BUCKET,
} from '@/lib/storage/itemImagesShared';
import { sanitizeImageDim, type ImageDim } from '@/lib/images/dimensions';

/**
 * Longest edge of a re-encoded photo. 4096 keeps the canvas inside iOS Safari's
 * 16.7-megapixel limit at any aspect ratio, and is still twice the largest width
 * the site ever displays.
 */
const RESIZED_MAX_EDGE = 4096;
const RESIZED_JPEG_QUALITY = 0.9;

/**
 * Outcome of an upload batch: every path plus its measured size, or the first
 * failure's message. `dims[i]` describes `paths[i]`, and is `null` when the
 * browser could not decode that file.
 */
export type UploadItemImagesResult =
  | { ok: true; paths: string[]; dims: (ImageDim | null)[] }
  | { ok: false; message: string };

interface PreparedImage {
  file: File;
  dim: ImageDim | null;
}

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

/** Whether the optimizer would refuse this photo or the bucket would reject it. */
function needsResize(file: File, dim: ImageDim | null): dim is ImageDim {
  // A GIF may be animated, and a canvas keeps one frame of it.
  if (file.type === 'image/gif' || dim === null) return false;
  return (
    Math.max(dim.w, dim.h) > ITEM_IMAGE_OPTIMIZER_MAX_EDGE ||
    file.size > ITEM_IMAGE_MAX_BYTES
  );
}

async function encodeJpeg(bitmap: ImageBitmap, w: number, h: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // JPEG has no alpha. Without a fill, a PNG's transparent corners turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: RESIZED_JPEG_QUALITY });
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', RESIZED_JPEG_QUALITY),
  );
}

/**
 * The photo scaled to fit {@link RESIZED_MAX_EDGE} as a JPEG, or `null` when the
 * browser cannot produce one. A `null` uploads the original, which the bucket
 * and the optimizer then handle exactly as they did before.
 */
async function resize(file: File, dim: ImageDim): Promise<PreparedImage | null> {
  const scale = Math.min(1, RESIZED_MAX_EDGE / Math.max(dim.w, dim.h));
  const w = Math.max(1, Math.round(dim.w * scale));
  const h = Math.max(1, Math.round(dim.h * scale));
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'high',
    });
    const blob = await encodeJpeg(bitmap, w, h).finally(() => bitmap.close());
    if (!blob || blob.size > ITEM_IMAGE_MAX_BYTES) return null;
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`;
    return {
      file: new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified }),
      dim: { w, h },
    };
  } catch {
    return null;
  }
}

async function prepare(file: File): Promise<PreparedImage> {
  const dim = await measure(file);
  if (!needsResize(file, dim)) return { file, dim };
  return (await resize(file, dim)) ?? { file, dim };
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
  options: {
    /** Re-encode photos the image optimizer would refuse. Listing photos only. */
    fitOversizedForDisplay?: boolean;
  } = {},
): Promise<UploadItemImagesResult> {
  if (files.length === 0) return { ok: true, paths: [], dims: [] };

  // Before the tokens, because a re-encoded photo changes MIME type and the
  // signed path's extension is chosen from it. Decoding is off the main thread
  // for `createImageBitmap`.
  const images = await Promise.all(
    files.map(async (file): Promise<PreparedImage> => {
      if (options.fitOversizedForDisplay) return prepare(file);
      return { file, dim: await measure(file) };
    }),
  );

  const prepared = await createItemImageUploads(images.map(({ file }) => file.type));
  if (!prepared.ok) return { ok: false, message: prepared.message };

  const { uploads } = prepared.data;
  if (uploads.length !== images.length) {
    return { ok: false, message: 'Could not prepare the upload. Please try again.' };
  }

  const supabase = createClient();
  const paths: string[] = [];

  for (let i = 0; i < images.length; i += 1) {
    const { path, token } = uploads[i];
    const { file } = images[i];
    const { error } = await supabase.storage
      .from(ITEM_IMAGES_BUCKET)
      .uploadToSignedUrl(path, token, file, {
        contentType: file.type,
      });
    if (error) {
      return {
        ok: false,
        message:
          images.length === 1
            ? `That photo could not be uploaded: ${error.message}`
            : `Photo ${i + 1} could not be uploaded: ${error.message}`,
      };
    }
    paths.push(path);
  }

  return { ok: true, paths, dims: images.map(({ dim }) => dim) };
}
