import 'server-only';

// lib/storage/trustedSellerPhotos.ts
//
// Server half of Trusted Seller application photos (0153). Same design as chat
// attachments: THIS module chooses every object path, from the applicant's id and a
// fresh UUID, and each token authorises a write to exactly one of them. Reads are
// signed because the bucket is private.

import { randomUUID } from 'node:crypto';

import type { createAdminClient } from '@/lib/supabase/admin';
import {
  TRUSTED_SELLER_PHOTOS_BUCKET,
  isAllowedTrustedSellerPhotoType,
} from '@/lib/storage/trustedSellerPhotosShared';

type AdminClient = ReturnType<typeof createAdminClient>;

const READ_URL_TTL_SECONDS = 60 * 60;

function extFor(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    default:
      return 'jpg';
  }
}

export async function createSignedTrustedSellerPhotoUpload(
  admin: AdminClient,
  profileId: string,
  contentType: string,
): Promise<{ path: string; token: string }> {
  const type = contentType.toLowerCase();
  if (!isAllowedTrustedSellerPhotoType(type)) {
    throw new Error('Add a photo or screenshot (JPG, PNG, WebP or HEIC).');
  }
  const path = `${profileId}/${randomUUID()}.${extFor(type)}`;
  const { data, error } = await admin.storage
    .from(TRUSTED_SELLER_PHOTOS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`Could not prepare upload: ${error?.message ?? 'unknown error'}`);
  }
  return { path, token: data.token };
}

/** Which of `paths` exist in the bucket. A path that was never uploaded is dropped. */
export async function existingTrustedSellerPhotos(
  admin: AdminClient,
  profileId: string,
  paths: string[],
): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await admin.storage
    .from(TRUSTED_SELLER_PHOTOS_BUCKET)
    .list(profileId, { limit: 1000 });
  if (error) throw new Error(`Could not check photos: ${error.message}`);
  const names = new Set((data ?? []).map((entry) => `${profileId}/${entry.name}`));
  return paths.filter((path) => names.has(path));
}

/** Signed read URLs, in the order given; null for a path that could not be signed. */
export async function signTrustedSellerPhotoUrls(
  admin: AdminClient,
  paths: string[],
): Promise<{ path: string; url: string | null }[]> {
  if (paths.length === 0) return [];
  const { data } = await admin.storage
    .from(TRUSTED_SELLER_PHOTOS_BUCKET)
    .createSignedUrls(paths, READ_URL_TTL_SECONDS);
  const byPath = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) byPath.set(entry.path, entry.signedUrl);
  }
  return paths.map((path) => ({ path, url: byPath.get(path) ?? null }));
}
