'use server';

// lib/actions/messageAttachments.ts
//
// Mint a write token, and exchange stored paths for signed read URLs.
// Participation is checked on the read path; the write token is bound to a
// server-chosen object under the caller's own prefix.

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import {
  createSignedMessageAttachmentUpload,
  signMessageAttachmentUrls,
  type SignedMessageAttachmentUpload,
} from '@/lib/storage/messageAttachments';

export async function createMessageAttachmentUpload(
  contentType: string,
): Promise<
  ActionResult<SignedMessageAttachmentUpload, 'unauthenticated' | 'upload-prepare-failed'>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('unauthenticated', 'Sign in to attach a file.');

  try {
    const upload = await createSignedMessageAttachmentUpload(
      createAdminClient(),
      user.id,
      contentType,
    );
    return ok(upload);
  } catch (error) {
    return fail(
      'upload-prepare-failed',
      error instanceof Error ? error.message : 'Could not prepare the upload.',
    );
  }
}

/**
 * Sign attachment paths that already belong to this conversation.
 *
 * CALLERS pass the conversation they are looking at. A path that is not on a
 * message in that thread is dropped rather than signed.
 */
export async function signConversationAttachments(
  conversationId: string,
  paths: string[],
): Promise<ActionResult<Record<string, string | null>, 'unauthenticated' | 'not-participant'>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('unauthenticated', 'Sign in to view attachments.');

  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return ok({});

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, participant_a, participant_b')
    .eq('id', conversationId)
    .maybeSingle();
  if (
    !conversation ||
    (conversation.participant_a !== user.id && conversation.participant_b !== user.id)
  ) {
    return fail('not-participant', 'You are not part of this conversation.');
  }

  const { data: rows } = await supabase
    .from('messages')
    .select('attachment_path')
    .eq('conversation_id', conversationId)
    .in('attachment_path', unique);

  const allowed = new Set(
    (rows ?? [])
      .map((row) => row.attachment_path)
      .filter((path): path is string => Boolean(path)),
  );
  const toSign = unique.filter((path) => allowed.has(path));
  const signed = await signMessageAttachmentUrls(createAdminClient(), toSign);
  const urls: Record<string, string | null> = {};
  for (const path of unique) urls[path] = null;
  for (const entry of signed) urls[entry.path] = entry.url;
  return ok(urls);
}
