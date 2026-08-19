'use client';

// components/messages/useConversationAttachments.ts
//
// Batch-sign private attachment paths for the open thread. New paths from
// realtime inserts are signed on the next pass; a path that cannot be signed
// stays null so the bubble can show "unavailable" instead of a broken image.

import { useEffect, useMemo, useState } from 'react';

import { signConversationAttachments } from '@/lib/actions/messageAttachments';
import type { ChatMessage } from '@/components/messages/groupMessages';

export function useConversationAttachments(
  conversationId: string,
  messages: ChatMessage[],
): Record<string, string | null> {
  const paths = useMemo(
    () =>
      Array.from(
        new Set(
          messages
            .map((message) => message.attachment_path)
            .filter((path): path is string => Boolean(path)),
        ),
      ),
    [messages],
  );
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const pathKey = paths.join('|');

  useEffect(() => {
    setUrls({});
  }, [conversationId]);

  useEffect(() => {
    if (paths.length === 0) return;
    const missing = paths.filter((path) => !(path in urls));
    if (missing.length === 0) return;
    let cancelled = false;
    void signConversationAttachments(conversationId, missing).then((result) => {
      if (cancelled || !result.ok) return;
      setUrls((prev) => ({ ...prev, ...result.data }));
    });
    return () => {
      cancelled = true;
    };
    // `urls` is read to skip already-signed paths; listing it would retrigger
    // after every successful sign.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, pathKey]);

  return urls;
}
