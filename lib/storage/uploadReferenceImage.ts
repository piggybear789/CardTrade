// lib/storage/uploadReferenceImage.ts
//
// Browser half of a reference image upload (0155). Mint a token server-side,
// send the bytes browser → Storage, keep the path for the form. The file
// never travels inside a Server Action body.

import { createClient } from '@/lib/supabase/browser';
import { createHandleClaimUpload, createReferenceProofUpload } from '@/lib/actions/references';
import {
  REFERENCE_IMAGE_MAX_BYTES,
  bucketForKind,
  isAllowedReferenceImageType,
  type ReferenceImageKind,
} from '@/lib/storage/referenceImagesShared';

export type UploadReferenceImageResult = { ok: true; path: string } | { ok: false; message: string };

export async function uploadReferenceImage(
  kind: ReferenceImageKind,
  file: File,
): Promise<UploadReferenceImageResult> {
  if (file.size > REFERENCE_IMAGE_MAX_BYTES) {
    return { ok: false, message: `"${file.name}" is larger than 10 MB.` };
  }
  if (!isAllowedReferenceImageType(file.type)) {
    return { ok: false, message: `"${file.name}" isn't a photo we can take (JPG, PNG, WebP or HEIC).` };
  }

  const prepared = await (kind === 'proof'
    ? createReferenceProofUpload(file.type)
    : createHandleClaimUpload(file.type));
  if (!prepared.ok) return { ok: false, message: prepared.message };

  const supabase = createClient();
  const { error } = await supabase.storage
    .from(bucketForKind(kind))
    .uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: file.type });
  if (error) return { ok: false, message: `"${file.name}" could not be uploaded.` };

  return { ok: true, path: prepared.data.path };
}
