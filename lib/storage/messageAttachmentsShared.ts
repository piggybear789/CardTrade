// lib/storage/messageAttachmentsShared.ts
//
// Facts both halves of a chat attachment upload must agree on.
// Split out because the server module is `server-only` (it holds the
// service-role path) while the browser uploader still needs the bucket name
// and the client-side limits.

/** Private bucket. Reads are signed after a participation check. */
export const MESSAGE_ATTACHMENTS_BUCKET = 'message-attachments';

/** One file per message. A second file is a second message. */
export const MESSAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const MESSAGE_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/pdf',
] as const;

export const MESSAGE_ATTACHMENT_ACCEPT = MESSAGE_ATTACHMENT_MIME_TYPES.join(',');

export function isAllowedMessageAttachmentType(contentType: string): boolean {
  return (MESSAGE_ATTACHMENT_MIME_TYPES as readonly string[]).includes(
    contentType.toLowerCase(),
  );
}

export function isImageAttachmentMime(mime: string | null | undefined): boolean {
  return Boolean(mime?.toLowerCase().startsWith('image/'));
}

export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentPreviewLabel(params: {
  body: string;
  attachmentMime?: string | null;
  attachmentName?: string | null;
}): string {
  const text = params.body.trim();
  if (text) return text;
  if (isImageAttachmentMime(params.attachmentMime)) return 'Photo';
  if (params.attachmentName) return params.attachmentName;
  return 'Attachment';
}
