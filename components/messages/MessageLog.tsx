'use client';

// components/messages/MessageLog.tsx
//
// Shared thread body for the inbox and the contract room. Clusters consecutive
// messages from the same person so a run of replies is one visual group with a
// single timestamp. Attachments render in the bubble: photos open the contract
// lightbox, files download.

import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { ContractImageLightbox } from '@/components/contract/ContractImageLightbox';
import { cn } from '@/lib/utils';
import {
  formatAttachmentBytes,
  isImageAttachmentMime,
} from '@/lib/storage/messageAttachmentsShared';
import {
  groupMessages,
  messageTimeLabel,
  type ChatMessage,
} from '@/components/messages/groupMessages';
import { useConversationAttachments } from '@/components/messages/useConversationAttachments';

export interface MessageLogProps {
  conversationId: string;
  messages: ChatMessage[];
  currentUserId: string;
  counterpartyName: string;
  counterpartyAvatarPath?: string | null;
  emptyHint: string;
  /** Incoming avatar on the last bubble of a cluster. Inbox on, contract off. */
  showAvatars?: boolean;
  /** "You" / their name on the first bubble of a cluster. */
  showNames?: boolean;
  /** Read receipt on the last outgoing bubble of a cluster. */
  showReadReceipt?: boolean;
}

export function MessageLog({
  conversationId,
  messages,
  currentUserId,
  counterpartyName,
  counterpartyAvatarPath = null,
  emptyHint,
  showAvatars = false,
  showNames = false,
  showReadReceipt = false,
}: MessageLogProps) {
  const clusters = useMemo(
    () => groupMessages(messages, currentUserId),
    [messages, currentUserId],
  );
  const urls = useConversationAttachments(conversationId, messages);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const gallery = useMemo(() => {
    const images: { url: string; label: string }[] = [];
    for (const message of messages) {
      if (!isImageAttachmentMime(message.attachment_mime) || !message.attachment_path) {
        continue;
      }
      const url = urls[message.attachment_path];
      if (url) images.push({ url, label: message.attachment_name ?? 'Photo' });
    }
    return images;
  }, [messages, urls]);

  if (messages.length === 0) {
    return (
      <div className="grid h-full place-items-center text-center">
        <p className="max-w-56 text-body leading-5 text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {clusters.map((cluster) => {
          if (cluster.type === 'day') {
            return (
              <div key={cluster.key} className="flex justify-center">
                <time className="text-meta font-medium text-muted-foreground">
                  {cluster.label}
                </time>
              </div>
            );
          }
          if (cluster.type === 'system') {
            return (
              <div key={cluster.message.id} className="flex justify-center">
                <p className="max-w-[20rem] text-center text-body leading-5 text-muted-foreground">
                  {cluster.message.body}
                </p>
              </div>
            );
          }

          const last = cluster.messages[cluster.messages.length - 1];
          const stamp = messageTimeLabel(last.created_at);
          const read =
            showReadReceipt && cluster.mine && Boolean(last.read_at) ? ' · Read' : '';

          return (
            <div
              key={cluster.key}
              className={cn('flex flex-col gap-0.5', cluster.mine ? 'items-end' : 'items-start')}
            >
              {showNames ? (
                <span className="mb-0.5 px-1 text-meta font-medium text-muted-foreground">
                  {cluster.mine ? 'You' : counterpartyName}
                </span>
              ) : null}
              {cluster.messages.map((message, index) => {
                const lastInCluster = index === cluster.messages.length - 1;
                return (
                  <div
                    key={message.id}
                    className={cn(
                      'flex max-w-[82%] items-end gap-1.5',
                      cluster.mine ? 'flex-row-reverse' : 'flex-row',
                    )}
                  >
                    {showAvatars && !cluster.mine ? (
                      lastInCluster ? (
                        <Avatar
                          avatarPath={counterpartyAvatarPath}
                          displayName={counterpartyName}
                          size="xs"
                        />
                      ) : (
                        <span className="size-6 shrink-0" aria-hidden />
                      )
                    ) : null}
                    <MessageBubble
                      message={message}
                      mine={cluster.mine}
                      last={lastInCluster}
                      url={
                        message.attachment_path
                          ? (urls[message.attachment_path] ?? null)
                          : null
                      }
                      onOpenImage={() => {
                        if (!message.attachment_path) return;
                        const url = urls[message.attachment_path];
                        if (!url) return;
                        const at = gallery.findIndex((image) => image.url === url);
                        setLightbox(at === -1 ? 0 : at);
                      }}
                    />
                  </div>
                );
              })}
              <time
                dateTime={last.created_at}
                suppressHydrationWarning
                className="px-1 text-meta text-muted-foreground"
              >
                {stamp}
                {read}
              </time>
            </div>
          );
        })}
      </div>
      <ContractImageLightbox
        images={gallery.map((image) => image.url)}
        openIndex={lightbox}
        onOpenChange={setLightbox}
        label="Chat photo"
      />
    </>
  );
}

function MessageBubble({
  message,
  mine,
  last,
  url,
  onOpenImage,
}: {
  message: ChatMessage;
  mine: boolean;
  last: boolean;
  url: string | null;
  onOpenImage: () => void;
}) {
  const image = isImageAttachmentMime(message.attachment_mime);
  const file = Boolean(message.attachment_path) && !image;
  const text = message.body.trim();

  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden text-body',
        mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        mine
          ? last
            ? 'rounded-2xl rounded-br-md'
            : 'rounded-2xl rounded-br-sm'
          : last
            ? 'rounded-2xl rounded-bl-md'
            : 'rounded-2xl rounded-bl-sm',
      )}
    >
      {image ? (
        url ? (
          <button
            type="button"
            onClick={onOpenImage}
            className="block w-full max-w-56 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* Signed URLs are private and short-lived; next/image cannot cache them. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={message.attachment_name ?? 'Photo'}
              className="max-h-56 w-full object-cover"
            />
          </button>
        ) : (
          <div className="grid h-32 w-40 place-items-center text-meta opacity-70">
            Photo
          </div>
        )
      ) : null}
      {file ? (
        url ? (
          <a
            href={url}
            download={message.attachment_name ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex items-center gap-2 px-3 py-2',
              mine ? 'text-primary-foreground' : 'text-foreground',
            )}
          >
            <FileText className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium">
                {message.attachment_name ?? 'File'}
              </span>
              {message.attachment_bytes != null ? (
                <span className={cn('block text-meta', mine ? 'opacity-70' : 'text-muted-foreground')}>
                  {formatAttachmentBytes(message.attachment_bytes)}
                </span>
              ) : null}
            </span>
          </a>
        ) : (
          <p className="px-3 py-2 opacity-70">Attachment unavailable</p>
        )
      ) : null}
      {text ? (
        <p className={cn('whitespace-pre-wrap break-words px-3', image || file ? 'pb-2 pt-1.5' : 'py-2')}>
          {text}
        </p>
      ) : null}
    </div>
  );
}
