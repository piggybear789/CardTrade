import 'server-only';

// lib/storage/disputeEvidence.ts
//
// Server half of the dispute-evidence upload, and the only place a signed URL for
// the private `dispute-evidence` bucket is minted.
//
// TWO DIFFERENCES FROM ITEM IMAGES, both because this bucket is PRIVATE:
//
//   1. Reads need signing too. `item-images` and `profile-images` are public, so a
//      stored path is a usable URL. Evidence is participant-and-staff only, so a
//      caller that has passed its own authorisation check exchanges a path for a
//      short-lived signed URL here.
//   2. Video is allowed, and the size ceiling is 50 MB rather than 10.
//
// The upload design is otherwise identical and for the same reason: THIS module
// chooses every object path, from the author's id and a fresh UUID, and each token
// authorises a write to exactly one of them. There is no bucket-wide write grant for
// `authenticated`, so without a token there is no way in.

import { randomUUID } from 'node:crypto';

import type { createAdminClient } from '@/lib/supabase/admin';
import {
  DISPUTE_EVIDENCE_BUCKET,
  EVIDENCE_FILES_MAX,
  EVIDENCE_MIME_TYPES,
} from '@/lib/storage/disputeEvidenceShared';

type AdminClient = ReturnType<typeof createAdminClient>;

/** One signed, single-use upload target: where to put the file, and the token. */
export interface SignedEvidenceUpload {
  /** Object path the browser must upload to. Chosen here, never by the client. */
  path: string;
  /** Single-use token authorising a write to that one path. */
  token: string;
}

const ALLOWED = new Set<string>(EVIDENCE_MIME_TYPES);

/** How long a read URL stays valid. Long enough to watch a video, short enough to expire. */
const READ_URL_TTL_SECONDS = 60 * 60;

function extFor(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'video/mp4':
      return 'mp4';
    case 'video/quicktime':
      return 'mov';
    case 'video/webm':
      return 'webm';
    default:
      return 'jpg';
  }
}

/**
 * Mint one signed, single-use upload target per file the caller wants to send.
 *
 * Throws when the count is out of range or a declared type is not on the allowlist,
 * so a bad request never produces a token.
 *
 * @param authorId - The submitting participant. Their id becomes the path prefix, so
 *   one member's tokens can never reach another member's objects.
 */
export async function createSignedEvidenceUploads(
  admin: AdminClient,
  authorId: string,
  contentTypes: string[],
): Promise<SignedEvidenceUpload[]> {
  if (contentTypes.length === 0) return [];
  if (contentTypes.length > EVIDENCE_FILES_MAX) {
    throw new Error(`Up to ${EVIDENCE_FILES_MAX} files are allowed.`);
  }
  for (const contentType of contentTypes) {
    if (!ALLOWED.has(contentType.toLowerCase())) {
      throw new Error('Only JPEG, PNG, WebP, HEIC images or MP4, MOV, WebM video are accepted.');
    }
  }

  const folder = `${authorId}/${randomUUID()}`;
  const uploads: SignedEvidenceUpload[] = [];

  for (let i = 0; i < contentTypes.length; i += 1) {
    const path = `${folder}/${i}.${extFor(contentTypes[i].toLowerCase())}`;
    const { data, error } = await admin.storage
      .from(DISPUTE_EVIDENCE_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(`Could not prepare upload: ${error?.message ?? 'unknown error'}`);
    }
    uploads.push({ path, token: data.token });
  }

  return uploads;
}

/**
 * Verify that every path in `paths` actually exists in the bucket under `authorId`.
 *
 * The client tells us which paths it uploaded to, and a client can lie. Two things are
 * checked: the prefix (so a submission cannot cite another member's objects) and
 * existence (so it cannot cite objects that were never written). A path that fails
 * either is dropped rather than throwing — the statement is the substance and is worth
 * keeping even if an attachment did not land.
 */
export async function verifyEvidencePaths(
  admin: AdminClient,
  authorId: string,
  paths: string[],
): Promise<string[]> {
  const owned = paths.filter((path) => path.startsWith(`${authorId}/`));
  if (owned.length === 0) return [];

  const verified: string[] = [];
  for (const path of owned) {
    const folder = path.slice(0, path.lastIndexOf('/'));
    const name = path.slice(path.lastIndexOf('/') + 1);
    const { data } = await admin.storage
      .from(DISPUTE_EVIDENCE_BUCKET)
      .list(folder, { search: name, limit: 1 });
    if (data && data.length > 0) verified.push(path);
  }
  return verified;
}

/**
 * Exchange stored object paths for short-lived signed read URLs.
 *
 * CALLERS MUST HAVE ALREADY AUTHORISED THE READ. This function does not know who is
 * asking; it signs whatever it is given. Every call site reads through an action that
 * has checked participation or staff capability first.
 *
 * A path that cannot be signed comes back as `null` rather than failing the batch, so
 * one expired or missing object does not blank an entire dispute's evidence.
 */
export async function signEvidenceUrls(
  admin: AdminClient,
  paths: string[],
): Promise<{ path: string; url: string | null }[]> {
  if (paths.length === 0) return [];

  const { data } = await admin.storage
    .from(DISPUTE_EVIDENCE_BUCKET)
    .createSignedUrls(paths, READ_URL_TTL_SECONDS);

  const byPath = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) byPath.set(entry.path, entry.signedUrl);
  }

  return paths.map((path) => ({ path, url: byPath.get(path) ?? null }));
}
