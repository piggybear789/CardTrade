// lib/storage/disputeEvidenceShared.ts
//
// The dispute-evidence facts both halves of the upload need to agree on.
//
// Split from `disputeEvidence.ts` for the same reason `itemImagesShared.ts` exists:
// that module is `server-only` (it holds the service-role path), while the browser
// uploader needs the bucket name and the client-side limits.

/** The Storage bucket that holds dispute evidence. PRIVATE — reads are signed. */
export const DISPUTE_EVIDENCE_BUCKET = 'dispute-evidence';

/** Most files one submission may carry. */
export const EVIDENCE_FILES_MAX = 6;

/**
 * Per-file ceiling, in bytes.
 *
 * 50 MB rather than the 10 MB item-image cap because video is the point: a phone
 * clip of an unboxing is the single most useful artefact in a condition dispute,
 * and an image-sized limit would exclude exactly that.
 */
export const EVIDENCE_FILE_MAX_BYTES = 50 * 1024 * 1024;

/** Statement length bounds. Mirrors the CHECK constraint in migration 0082. */
export const EVIDENCE_STATEMENT_MIN = 10;
export const EVIDENCE_STATEMENT_MAX = 4000;

/** Accepted evidence formats. The server re-checks; the client `accept` is advisory. */
export const EVIDENCE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'video/mp4',
  'video/quicktime',
  'video/webm',
] as const;

/** `accept` attribute value for the file input. */
export const EVIDENCE_ACCEPT = EVIDENCE_MIME_TYPES.join(',');

/** Whether a path points at a video, for choosing a `<video>` over an `<img>`. */
export function isVideoPath(path: string): boolean {
  return /\.(mp4|mov|webm)$/i.test(path);
}
