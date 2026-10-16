// lib/storage/uploadScamReportEvidence.ts
//
// Browser half of scam-report evidence (0154). Mint a token server-side, send the
// bytes browser → Storage, keep the path for the report or the response. The file
// never travels inside a Server Action body.

import { createClient } from '@/lib/supabase/browser';
import { createScamEvidenceUpload } from '@/lib/actions/scamReports';
import {
  SCAM_REPORT_EVIDENCE_BUCKET,
  SCAM_REPORT_EVIDENCE_MAX_BYTES,
  isAllowedScamEvidenceType,
} from '@/lib/storage/scamReportEvidenceShared';

export type UploadScamEvidenceResult = { ok: true; path: string } | { ok: false; message: string };

export async function uploadScamReportEvidence(file: File): Promise<UploadScamEvidenceResult> {
  if (file.size > SCAM_REPORT_EVIDENCE_MAX_BYTES) {
    return { ok: false, message: `"${file.name}" is larger than 10 MB.` };
  }
  if (!isAllowedScamEvidenceType(file.type)) {
    return { ok: false, message: `"${file.name}" isn't a photo we can take (JPG, PNG, WebP or HEIC).` };
  }

  const prepared = await createScamEvidenceUpload(file.type);
  if (!prepared.ok) return { ok: false, message: prepared.message };

  const supabase = createClient();
  const { error } = await supabase.storage
    .from(SCAM_REPORT_EVIDENCE_BUCKET)
    .uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: file.type });
  if (error) return { ok: false, message: `"${file.name}" could not be uploaded.` };

  return { ok: true, path: prepared.data.path };
}
