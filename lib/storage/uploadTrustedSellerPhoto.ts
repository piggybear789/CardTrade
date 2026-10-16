// lib/storage/uploadTrustedSellerPhoto.ts
//
// Browser half of a Trusted Seller application photo (0153). Mint a token
// server-side, send the bytes browser → Storage, keep the path for the application.
// The file never travels inside a Server Action body.

import { createClient } from '@/lib/supabase/browser';
import { createTrustedSellerPhotoUpload } from '@/lib/actions/trustedSellers';
import {
  TRUSTED_SELLER_PHOTOS_BUCKET,
  TRUSTED_SELLER_PHOTO_MAX_BYTES,
  isAllowedTrustedSellerPhotoType,
} from '@/lib/storage/trustedSellerPhotosShared';

export type UploadTrustedSellerPhotoResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

export async function uploadTrustedSellerPhoto(file: File): Promise<UploadTrustedSellerPhotoResult> {
  if (file.size > TRUSTED_SELLER_PHOTO_MAX_BYTES) {
    return { ok: false, message: `"${file.name}" is larger than 10 MB.` };
  }
  if (!isAllowedTrustedSellerPhotoType(file.type)) {
    return { ok: false, message: `"${file.name}" isn't a photo we can take (JPG, PNG, WebP or HEIC).` };
  }

  const prepared = await createTrustedSellerPhotoUpload(file.type);
  if (!prepared.ok) return { ok: false, message: prepared.message };

  const supabase = createClient();
  const { error } = await supabase.storage
    .from(TRUSTED_SELLER_PHOTOS_BUCKET)
    .uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: file.type });
  if (error) return { ok: false, message: `"${file.name}" could not be uploaded.` };

  return { ok: true, path: prepared.data.path };
}
