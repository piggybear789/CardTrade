import 'server-only';

// lib/storage/messageAttachments.ts
//
// Server half of chat attachments. Same design as dispute evidence: THIS module
// chooses every object path, from the author's id and a fresh UUID, and each
// token authorises a write to exactly one of them. Reads are signed too because
// the bucket is private.

import { randomUUID } from 'node:crypto';

import type { createAdminClient } from '@/lib/supabase/admin';
import {
  MESSAGE_ATTACHMENTS_BUCKET,
  isAllowedMessageAttachmentType,
} from '@/lib/storage/messageAttachmentsShared';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface SignedMessageAttachmentUpload {
  path: string;
  token: string;
}

const READ_URL_TTL_SECONDS = 60 * 60;

function extFor(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/heic':
      return 'heic';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'jpg';
  }
}

export async function createSignedMessageAttachmentUpload(
  admin: AdminClient,
  authorId: string,
  contentType: string,
): Promise<SignedMessageAttachmentUpload> {
  const type = contentType.toLowerCase();
  if (!isAllowedMessageAttachmentType(type)) {
    throw new Error('Only images or a PDF can be attached.');
  }

  const path = `${authorId}/${randomUUID()}.${extFor(type)}`;
  const { data, error } = await admin.storage
    .from(MESSAGE_ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`Could not prepare upload: ${error?.message ?? 'unknown error'}`);
  }
  return { path, token: data.token };
}

export async function verifyMessageAttachmentPath(
  admin: AdminClient,
  authorId: string,
  path: string,
): Promise<boolean> {
  if (!path.startsWith(`${authorId}/`)) return false;
  const slash = path.lastIndexOf('/');
  if (slash <= 0) return false;
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data } = await admin.storage
    .from(MESSAGE_ATTACHMENTS_BUCKET)
    .list(folder, { search: name, limit: 1 });
  return Boolean(data && data.length > 0);
}

export async function signMessageAttachmentUrls(
  admin: AdminClient,
  paths: string[],
): Promise<{ path: string; url: string | null }[]> {
  if (paths.length === 0) return [];

  const { data } = await admin.storage
    .from(MESSAGE_ATTACHMENTS_BUCKET)
    .createSignedUrls(paths, READ_URL_TTL_SECONDS);

  const byPath = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) byPath.set(entry.path, entry.signedUrl);
  }

  return paths.map((path) => ({ path, url: byPath.get(path) ?? null }));
}
