// lib/storage/trustedSellerPhotosShared.ts
//
// Facts both halves of a Trusted Seller photo upload must agree on (0153). Split out
// because the server module is `server-only` while the browser uploader still needs
// the bucket name and the client-side limits.

/** Private bucket. Reads are signed after an owner or staff check. */
export const TRUSTED_SELLER_PHOTOS_BUCKET = 'trusted-seller-photos';

export const TRUSTED_SELLER_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export const TRUSTED_SELLER_PHOTO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
] as const;

export const TRUSTED_SELLER_PHOTO_ACCEPT = TRUSTED_SELLER_PHOTO_MIME_TYPES.join(',');

export function isAllowedTrustedSellerPhotoType(contentType: string): boolean {
  return (TRUSTED_SELLER_PHOTO_MIME_TYPES as readonly string[]).includes(contentType.toLowerCase());
}
