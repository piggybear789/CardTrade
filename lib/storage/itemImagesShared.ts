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
