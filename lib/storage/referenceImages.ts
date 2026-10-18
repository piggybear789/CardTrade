import 'server-only';

// lib/storage/referenceImages.ts
//
// Server half of reference image uploads (0155). Same design as Trusted
// Seller photos and scam-report evidence: THIS module chooses every object
// path, from the uploader's id and a fresh UUID, and each token authorises a
// write to exactly one of them. Reads are signed for staff.

import { randomUUID } from 'node:crypto';

import type { createAdminClient } from '@/lib/supabase/admin';
import { isAllowedReferenceImageType } from '@/lib/storage/referenceImagesShared';

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

export async function createSignedReferenceUpload(
  admin: AdminClient,
  bucket: string,
  uploaderId: string,
  contentType: string,
): Promise<{ path: string; token: string }> {
  const type = contentType.toLowerCase();
  if (!isAllowedReferenceImageType(type)) {
    throw new Error('Add a screenshot or photo (JPG, PNG, WebP or HEIC).');
  }
  const path = `${uploaderId}/${randomUUID()}.${extFor(type)}`;
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`Could not prepare upload: ${error?.message ?? 'unknown error'}`);
  }
  return { path, token: data.token };
}

/** Which of `paths` exist under the uploader's folder. Anything else is dropped. */
export async function existingReferenceImages(
  admin: AdminClient,
  bucket: string,
  uploaderId: string,
  paths: string[],
): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await admin.storage.from(bucket).list(uploaderId, { limit: 1000 });
  if (error) throw new Error(`Could not check uploads: ${error.message}`);
  const names = new Set((data ?? []).map((entry) => `${uploaderId}/${entry.name}`));
  return paths.filter((path) => names.has(path));
}

export async function signReferenceImageUrls(
  admin: AdminClient,
  bucket: string,
  paths: string[],
): Promise<{ path: string; url: string | null }[]> {
  if (paths.length === 0) return [];
  const { data } = await admin.storage.from(bucket).createSignedUrls(paths, READ_URL_TTL_SECONDS);
  const byPath = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) byPath.set(entry.path, entry.signedUrl);
  }
  return paths.map((path) => ({ path, url: byPath.get(path) ?? null }));
}
