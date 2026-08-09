// lib/storage/uploadDisputeEvidence.ts
//
// Browser half of the dispute-evidence upload. Mirrors `uploadItemImages.ts`: mint
// signed tokens server-side, send the bytes browser → Storage, hand the resulting
// object paths to the action that persists them.
//
// The bytes never travel inside a Server Action body. That matters more here than for
// item photos: a 40 MB unboxing video would exceed `serverActions.bodySizeLimit` by an
// order of magnitude.
//
// Client module: no `'use server'`, no service-role key. The anon-key browser client is
// only the transport; each write is authorised by its own single-use token.

import { createClient } from '@/lib/supabase/browser';
import { createDisputeEvidenceUploads } from '@/lib/actions/disputeEvidence';
import {
  DISPUTE_EVIDENCE_BUCKET,
  EVIDENCE_FILE_MAX_BYTES,
} from '@/lib/storage/disputeEvidenceShared';

/** Outcome of an upload batch: every path, or the first failure's message. */
export type UploadEvidenceResult =
  | { ok: true; paths: string[] }
  | { ok: false; message: string };

/**
 * Upload `files` and return their Storage object paths, in the same order.
 *
 * All-or-nothing from the caller's point of view: on the first failure it stops and
 * reports. Files that did land sit under an unused per-upload folder and are never
 * referenced by a row, so they are inert — the caller can simply retry.
 */
export async function uploadDisputeEvidence(
  files: File[],
): Promise<UploadEvidenceResult> {
  if (files.length === 0) return { ok: true, paths: [] };

  // Checked before asking for tokens so an oversized file fails instantly rather than
  // after a long upload that Storage will reject at the end.
  const tooBig = files.find((file) => file.size > EVIDENCE_FILE_MAX_BYTES);
  if (tooBig) {
    const mb = Math.round(EVIDENCE_FILE_MAX_BYTES / (1024 * 1024));
    return { ok: false, message: `"${tooBig.name}" is larger than ${mb} MB.` };
  }

  const prepared = await createDisputeEvidenceUploads(files.map((file) => file.type));
  if (!prepared.ok) return { ok: false, message: prepared.message ?? 'Could not prepare the upload.' };

  const { uploads } = prepared.data;
  if (uploads.length !== files.length) {
    return { ok: false, message: 'Could not prepare the upload. Please try again.' };
  }

  const supabase = createClient();
  const paths: string[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const { path, token } = uploads[i];
    const { error } = await supabase.storage
      .from(DISPUTE_EVIDENCE_BUCKET)
      .uploadToSignedUrl(path, token, files[i], { contentType: files[i].type });
    if (error) {
      return {
        ok: false,
        message: `"${files[i].name}" could not be uploaded: ${error.message}`,
      };
    }
    paths.push(path);
  }

  return { ok: true, paths };
}
