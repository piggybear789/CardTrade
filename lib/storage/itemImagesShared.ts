// lib/storage/itemImagesShared.ts
//
// The handful of item-image facts both halves of the upload need to agree on.
//
// Split out of `lib/storage/itemImages.ts` because that module is `server-only`
// (it holds the service-role upload path), while the browser uploader in
// `uploadItemImages.ts` needs the bucket name too. Keeping the name in one place
// stops the two sides from drifting apart.

/** The Storage bucket that holds item images (public read, server-side writes). */
export const ITEM_IMAGES_BUCKET = 'item-images';

/** Per-image cap, enforced on the bucket and by both upload paths. */
export const ITEM_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Longest edge the image optimizer will transform.
 *
 * Vercel serves any source wider or taller than 8192px untouched, with a
 * one-minute cache. A 9196×9180 listing photo went to every visitor as the full
 * 10 MB original and cost a second of main-thread decode on each page view.
 */
export const ITEM_IMAGE_OPTIMIZER_MAX_EDGE = 8192;
