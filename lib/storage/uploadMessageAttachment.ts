// lib/storage/uploadMessageAttachment.ts
//
// Browser half of a chat attachment. Mint a token server-side, send the bytes
// browser → Storage, hand the path to `sendMessage`. The file never travels
// inside a Server Action body.

import { createClient } from '@/lib/supabase/browser';
import { createMessageAttachmentUpload } from '@/lib/actions/messageAttachments';
import {
  MESSAGE_ATTACHMENTS_BUCKET,
  MESSAGE_ATTACHMENT_MAX_BYTES,
  isAllowedMessageAttachmentType,
} from '@/lib/storage/messageAttachmentsShared';

export type UploadMessageAttachmentResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

export async function uploadMessageAttachment(
  file: File,
): Promise<UploadMessageAttachmentResult> {
  if (file.size > MESSAGE_ATTACHMENT_MAX_BYTES) {
    return { ok: false, message: 'That file is larger than 10 MB.' };
  }
  if (!isAllowedMessageAttachmentType(file.type)) {
    return { ok: false, message: 'Attach a photo or a PDF.' };
  }

  const prepared = await createMessageAttachmentUpload(file.type);
  if (!prepared.ok) {
    return { ok: false, message: prepared.message };
  }

  const supabase = createClient();
  const { error } = await supabase.storage
    .from(MESSAGE_ATTACHMENTS_BUCKET)
    .uploadToSignedUrl(prepared.data.path, prepared.data.token, file, {
      contentType: file.type,
    });
  if (error) {
    return { ok: false, message: `"${file.name}" could not be uploaded.` };
  }

  return { ok: true, path: prepared.data.path };
}
