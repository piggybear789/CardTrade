// lib/storage/profileImagesShared.ts
//
// The avatar-storage facts both halves of the upload need to agree on.
//
// Split out for the same reason as `itemImagesShared.ts`: `profileImages.ts` is
// `server-only` (it holds the service-role signing path), while the browser
// uploader needs the bucket name. One definition means the two sides cannot drift.

/** The Storage bucket that holds profile avatars (public read, signed-URL writes). */
export const PROFILE_IMAGES_BUCKET = 'profile-images';

/**
 * Accepted avatar formats. Narrower than item images, which also allow GIF.
 *
 * An animated avatar plays unbidden on every surface the member appears on —
 * catalog cards, chat, the contract room — which is a flashing-image
 * accessibility problem and a nuisance vector, and nobody needs animation to be
 * recognisable. Item photos keep GIF because they are dispute evidence and we do
 * not re-encode what a camera produced.
 *
 * Mirrors the bucket's own `allowed_mime_types` from migration 0066. Both exist:
 * this one fails fast with a readable message, the bucket is the actual gate for a
 * signed upload that never passes through our server.
 */
export const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] as const;

/**
 * Avatar size cap: 2 MB, against 10 MB for item photos.
 *
 * An avatar renders between 24 and 96 pixels, so this is already generous, and a
 * lower ceiling bounds what a hostile upload costs. Mirrors the bucket's
 * `file_size_limit` in 0066.
 */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** True when `contentType` is an accepted avatar format (case-insensitive). */
export function isAllowedAvatarType(contentType: string): boolean {
  return (ALLOWED_AVATAR_TYPES as readonly string[]).includes(contentType.toLowerCase());
}
