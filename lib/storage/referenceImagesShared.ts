// lib/storage/referenceImagesShared.ts
//
// Facts both halves of a reference image upload must agree on (0155): proof
// screenshots for references and bio-code screenshots for handle claims.
// Split out because the server module is `server-only` while the browser
// uploader still needs the bucket names and the client-side limits.

/** Private bucket for reference proof screenshots. Reads are signed for staff. */
export const REFERENCE_PROOF_BUCKET = 'reference-proof';

/** Private bucket for handle-claim bio screenshots. Reads are signed for staff. */
export const HANDLE_CLAIM_EVIDENCE_BUCKET = 'handle-claim-evidence';

export type ReferenceImageKind = 'proof' | 'claim';

export function bucketForKind(kind: ReferenceImageKind): string {
  return kind === 'proof' ? REFERENCE_PROOF_BUCKET : HANDLE_CLAIM_EVIDENCE_BUCKET;
}

export const REFERENCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const REFERENCE_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
] as const;

export const REFERENCE_IMAGE_ACCEPT = REFERENCE_IMAGE_MIME_TYPES.join(',');

export function isAllowedReferenceImageType(contentType: string): boolean {
  return (REFERENCE_IMAGE_MIME_TYPES as readonly string[]).includes(contentType.toLowerCase());
}
