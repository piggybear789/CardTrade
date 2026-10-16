// lib/storage/scamReportEvidenceShared.ts
//
// Facts both halves of a scam-report evidence upload must agree on (0154). Split out
// because the server module is `server-only` while the browser uploader still needs
// the bucket name and the client-side limits. The same bucket holds a matched member's
// response photos, under their own id.

/** Private bucket. Reads are signed for staff only. */
export const SCAM_REPORT_EVIDENCE_BUCKET = 'scam-report-evidence';

export const SCAM_REPORT_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

export const SCAM_REPORT_EVIDENCE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
] as const;

export const SCAM_REPORT_EVIDENCE_ACCEPT = SCAM_REPORT_EVIDENCE_MIME_TYPES.join(',');

export function isAllowedScamEvidenceType(contentType: string): boolean {
  return (SCAM_REPORT_EVIDENCE_MIME_TYPES as readonly string[]).includes(contentType.toLowerCase());
}
