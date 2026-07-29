import 'server-only';

// lib/storage/itemImages.ts
//
// Storage glue for user-supplied photos of collectibles. Extracted from
// `lib/actions/listings.ts` so both listing images (Req 3.3) and private-deal
// photos (evidence for arbitration) share one upload path, one bucket, and one
// decode/cleanup implementation.
//
// Two ways in, both ending at the same object paths:
//
//  1. Bytes through a Server Action (`ImageUpload`), uploaded here with the
//     SERVICE-ROLE client. Simple, but the whole file rides in the action body,
//     which Next caps (see `serverActions.bodySizeLimit` in next.config.ts).
//  2. Straight from the browser to Storage using a SIGNED UPLOAD URL minted by
//     `createSignedImageUploads` (`lib/actions/imageUploads.ts` is the action
//     that hands them out). The caller then passes the resulting object paths as
//     plain strings, which `uploadImages` verifies and passes through. Original
//     bytes and EXIF survive untouched, and large photos never enter an action
//     body. Preferred for anything user-supplied.
//
// The bucket is created on demand with PUBLIC read so the UI can render images by
// public URL, plus a size cap and a MIME allowlist so Storage itself rejects a
// bad direct upload — for path (2) our server never sees the bytes, so bucket
// constraints and `verifyStoredImage` are the enforcement, not `assertValidImage`.
//
// Object paths (never URLs) are what callers persist; `itemImageUrl()` in
// `lib/format.ts` resolves them for display.

import { randomUUID } from 'node:crypto';
import type { createAdminClient } from '@/lib/supabase/admin';
import { ITEM_IMAGES_BUCKET } from '@/lib/storage/itemImagesShared';

// The bucket name lives in `itemImagesShared` so the browser uploader can import
// it without pulling in this server-only module. Re-exported for existing callers.
export { ITEM_IMAGES_BUCKET };

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

/**
 * What an image can be on the way in: bytes to upload, or the object path of a
 * file the browser already uploaded through a signed URL. A `string` is always a
 * path in {@link ITEM_IMAGES_BUCKET}, never a URL, and is re-verified server-side
 * before it is trusted.
 */
export type ImageInput = string | ImageUpload;

/** One signed, single-use upload target: where to put the file, and the token. */
export interface SignedImageUpload {
  /** Object path the browser must upload to. Chosen here, never by the client. */
  path: string;
  /** Single-use token authorizing a write to exactly that path. */
  token: string;
}

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

/** Accepted evidence formats; client `accept` is advisory, server is authoritative. */
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);
/** Per-image upload cap to keep server actions and Storage usage bounded. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Most images an Item may carry (Req 3.3), and so the most tokens per request. */
const MAX_IMAGES_PER_REQUEST = 10;

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

/** Reject disguised/non-image or unreasonably large payloads on the server. */
function assertValidImage(image: DecodedImage): void {
  if (!ALLOWED_IMAGE_TYPES.has(image.contentType.toLowerCase())) {
    throw new Error('Only JPEG, PNG, WebP, or GIF images are accepted.');
  }
  if (image.bytes.length === 0 || image.bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('Each image must be between 1 byte and 10 MB.');
  }
}

/**
 * Ensure the item-images bucket exists with the right constraints (idempotent).
 *
 * The size cap and MIME allowlist are set ON THE BUCKET, not just checked in
 * application code, because a signed-URL upload goes browser → Storage without
 * passing through this server. Storage is the only thing in that path able to
 * refuse an oversized file or a non-image, so it has to know the rules.
 */
async function ensureItemImagesBucket(admin: AdminClient): Promise<void> {
  const constraints = {
    // Public so the catalog UI can render images by public URL.
    public: true,
    fileSizeLimit: MAX_IMAGE_BYTES,
    allowedMimeTypes: Array.from(ALLOWED_IMAGE_TYPES),
  };

  const { data } = await admin.storage.getBucket(ITEM_IMAGES_BUCKET);
  if (!data) {
    await admin.storage.createBucket(ITEM_IMAGES_BUCKET, constraints);
    return;
  }
  // An existing bucket predates these constraints (it was created with public
  // read alone), so bring it up to date once.
  if (data.file_size_limit == null || data.allowed_mime_types == null) {
    await admin.storage.updateBucket(ITEM_IMAGES_BUCKET, constraints);
  }
}

/**
 * Mint one signed, single-use upload target per image the caller wants to send
 * straight from the browser.
 *
 * The security of the whole direct-upload path rests here: THIS function chooses
 * every object path, from the caller's own id and a fresh UUID, and each token
 * authorizes a write to exactly one of those paths. The browser cannot pick a
 * path, cannot reach another owner's prefix, and cannot overwrite an existing
 * object (`upsert` stays off). No bucket-wide write grant is handed to
 * `authenticated` — without a token there is still no way in.
 *
 * Throws when the count is out of range or a declared type is not an image, so a
 * bad request never produces a token.
 */
export async function createSignedImageUploads(
  admin: AdminClient,
  ownerId: string,
  contentTypes: string[],
): Promise<SignedImageUpload[]> {
  if (contentTypes.length === 0 || contentTypes.length > MAX_IMAGES_PER_REQUEST) {
    throw new Error(`Between 1 and ${MAX_IMAGES_PER_REQUEST} images are allowed.`);
  }
  for (const contentType of contentTypes) {
    if (!ALLOWED_IMAGE_TYPES.has(contentType.toLowerCase())) {
      throw new Error('Only JPEG, PNG, WebP, or GIF images are accepted.');
    }
  }

  await ensureItemImagesBucket(admin);
  const folder = `${ownerId}/${randomUUID()}`;

  const uploads: SignedImageUpload[] = [];
  for (let i = 0; i < contentTypes.length; i += 1) {
    const path = `${folder}/${i}.${extFor(contentTypes[i].toLowerCase())}`;
    const { data, error } = await admin.storage
      .from(ITEM_IMAGES_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(`Could not prepare upload: ${error?.message ?? 'unknown error'}`);
    }
    uploads.push({ path, token: data.token });
  }
  return uploads;
}

/**
 * Verify an object path the client claims to have uploaded, before anything is
 * persisted against it.
 *
 * A path arriving from the client is a claim, not a fact: it could name someone
 * else's object, an object that was never uploaded, or a file that slipped past
 * the bucket rules. Three checks, all cheap:
 *  - it sits under the caller's own `<ownerId>/` prefix;
 *  - the object actually exists;
 *  - its recorded MIME type and size are within our limits.
 *
 * Throws with a caller-safe message, matching `assertValidImage`.
 */
async function verifyStoredImage(
  admin: AdminClient,
  ownerId: string,
  path: string,
): Promise<void> {
  // Absolute URLs are external references, not objects in our bucket — seeded
  // catalog data points at remote card scans, and `itemImageUrl()` passes them
  // through for display. There is nothing here to verify.
  if (/^https?:\/\//i.test(path)) return;

  // Reject traversal and cross-owner paths before spending a round trip.
  if (!path.startsWith(`${ownerId}/`) || path.includes('..')) {
    throw new Error('That image does not belong to you.');
  }

  const { data, error } = await admin.storage.from(ITEM_IMAGES_BUCKET).info(path);
  if (error || !data) {
    throw new Error('One of your images finished uploading but could not be found.');
  }
  if (!ALLOWED_IMAGE_TYPES.has((data.contentType ?? '').toLowerCase())) {
    throw new Error('Only JPEG, PNG, WebP, or GIF images are accepted.');
  }
  const size = data.size ?? 0;
  if (size === 0 || size > MAX_IMAGE_BYTES) {
    throw new Error('Each image must be between 1 byte and 10 MB.');
  }
}

/**
 * Verify a batch of object paths supplied by a client, e.g. the images an edit
 * says it is keeping. Throws on the first path that fails, with a message safe to
 * show the user.
 */
export async function verifyStoredImages(
  admin: AdminClient,
  ownerId: string,
  paths: string[],
): Promise<void> {
  for (const path of paths) {
    await verifyStoredImage(admin, ownerId, path);
  }
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
  images: ImageInput[],
): Promise<string[]> {
  await ensureItemImagesBucket(admin);
  const folder = `${ownerId}/${randomUUID()}`;
  const paths: string[] = [];
  /** Only files uploaded by THIS call are cleaned up if a later one fails. */
  const uploadedHere: string[] = [];

  try {
    for (let i = 0; i < images.length; i += 1) {
      const image = images[i];

      // Already in Storage, put there by the browser through a signed URL.
      // Verify the claim and keep the path as-is: re-uploading would mean
      // pulling the bytes back through this server for no benefit.
      if (typeof image === 'string') {
        await verifyStoredImage(admin, ownerId, image);
        paths.push(image);
        continue;
      }

      const decoded = await decodeImage(image);
      assertValidImage(decoded);
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
      uploadedHere.push(path);
    }
  } catch (error) {
    // Avoid orphaning the files uploaded before a later file failed. Paths that
    // arrived already-stored are left alone: on an edit they may still be
    // attached to the existing Item, so deleting them would destroy live data.
    await removeImages(admin, uploadedHere);
    throw error;
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
