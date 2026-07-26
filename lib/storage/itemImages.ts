import 'server-only';

// lib/storage/itemImages.ts
//
// Storage glue for user-supplied photos of collectibles. Extracted from
// `lib/actions/listings.ts` so both listing images (Req 3.3) and private-deal
// photos (evidence for arbitration) share one upload path, one bucket, and one
// decode/cleanup implementation.
//
// Uploads run through the SERVICE-ROLE admin client — the bucket is created on
// demand with PUBLIC read so the UI can render images by public URL, while
// writes stay server-side only. Object paths (never URLs) are what callers
// persist; `itemImageUrl()` in `lib/format.ts` resolves them for display.

import { randomUUID } from 'node:crypto';
import type { createAdminClient } from '@/lib/supabase/admin';

/** The Storage bucket that holds item images. Created on demand (public read). */
export const ITEM_IMAGES_BUCKET = 'item-images';

/** The service-role client these helpers write through. */
type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * An image supplied to a create/update action. Either raw binary (`Blob`/`File`)
 * or a base64 payload (optionally a `data:` URL). Callers that also accept
 * already-stored objects pass a plain `string` path alongside these.
 */
export type ImageUpload =
  | Blob
  | { data: string; contentType?: string; name?: string };

/** A pre-decoded image ready to upload. */
interface DecodedImage {
  bytes: Buffer;
  contentType: string;
  ext: string;
}

/** Map a MIME type to a file extension for the stored object name. */
function extFor(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'bin';
  }
}

/** Decode a single {@link ImageUpload} to bytes + content type. */
async function decodeImage(image: ImageUpload): Promise<DecodedImage> {
  if (image instanceof Blob) {
    const bytes = Buffer.from(await image.arrayBuffer());
    const contentType = image.type || 'application/octet-stream';
    return { bytes, contentType, ext: extFor(contentType) };
  }

  // base64 or data: URL
  let base64 = image.data;
  let contentType = image.contentType ?? 'application/octet-stream';
  const dataUrlMatch = /^data:([^;]+);base64,(.*)$/s.exec(base64);
  if (dataUrlMatch) {
    contentType = image.contentType ?? dataUrlMatch[1];
    base64 = dataUrlMatch[2];
  }
  const bytes = Buffer.from(base64, 'base64');
  return { bytes, contentType, ext: extFor(contentType) };
}

/** Ensure the item-images bucket exists (idempotent, public read). */
async function ensureItemImagesBucket(admin: AdminClient): Promise<void> {
  const { data } = await admin.storage.getBucket(ITEM_IMAGES_BUCKET);
  if (data) return;
  // Create as public so the catalog UI can render images by public URL.
  await admin.storage.createBucket(ITEM_IMAGES_BUCKET, { public: true });
}

/**
 * Upload decoded images under a per-owner, per-upload folder and return the
 * stored object paths (which are what callers persist, e.g. in `image_paths` or
 * `creator_photo_paths`). Throws on the first failed upload so the caller can
 * surface `upload-failed`.
 */
export async function uploadImages(
  admin: AdminClient,
  ownerId: string,
  images: ImageUpload[],
): Promise<string[]> {
  await ensureItemImagesBucket(admin);
  const folder = `${ownerId}/${randomUUID()}`;
  const paths: string[] = [];

  for (let i = 0; i < images.length; i += 1) {
    const decoded = await decodeImage(images[i]);
    const path = `${folder}/${i}.${decoded.ext}`;
    const { error } = await admin.storage
      .from(ITEM_IMAGES_BUCKET)
      .upload(path, decoded.bytes, {
        contentType: decoded.contentType,
        upsert: false,
      });
    if (error) {
      throw new Error(`Image upload failed: ${error.message}`);
    }
    paths.push(path);
  }

  return paths;
}

/** Best-effort cleanup of uploaded objects when a later step fails. */
export async function removeImages(
  admin: AdminClient,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  try {
    await admin.storage.from(ITEM_IMAGES_BUCKET).remove(paths);
  } catch {
    // Cleanup is best-effort; a failure here must not mask the original error.
  }
}
