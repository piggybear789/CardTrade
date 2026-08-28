'use client';

// components/messages/MessageLog.tsx
//
// Shared thread body for the inbox and the contract room. Clusters consecutive
// messages from the same person so a run of replies is one visual group with a
// single timestamp. Attachments render in the bubble: photos open the contract
// lightbox, files download.

import { useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ExternalLinkIcon, FileTextIcon } from '@hugeicons/core-free-icons';

import { Avatar } from '@/components/ui/avatar';
import { ContractImageLightbox } from '@/components/contract/ContractImageLightbox';
import { classifyContractEvent } from '@/components/contract/contractEventTone';
import { cn } from '@/lib/utils';
import {
  formatAttachmentBytes,
  isImageAttachmentMime,
} from '@/lib/storage/messageAttachmentsShared';
import {
  groupMessages,
  messageDateTimeLabel,
  messageTimeLabel,
  type ChatMessage,
} from '@/components/messages/groupMessages';
import { useConversationAttachments } from '@/components/messages/useConversationAttachments';

/**
 * The event codes that mean "the seller handed it to a carrier".
 * `SHIPMENT_RECORDED` is what the orchestrator logs; `SHIPPED` is the older
 * code still present in seeded and pre-0012 rooms.
 */
const SHIPMENT_EVENTS = new Set(['SHIPMENT_RECORDED', 'SHIPPED']);

/** Carrier details for the shipped milestone, when the thread has a shipment. */
export interface MessageLogShipment {
  carrier: string | null;
  trackingNumber: string | null;
  /** Carrier deep link. Null when the provider is manual and gave us none. */
  trackingUrl: string | null;
}

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
  /**
   * The shipment this thread's contract is carrying, if any. Supplied rather
   * than parsed out of the event sentence: the carrier and number are only
   * prose inside `body` (SQL builds the line), and reading a tracking number
   * back out of generated copy would break the first time the wording changed.
   */
  shipment?: MessageLogShipment | null;
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
  shipment = null,
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
      {/* Matched to the gap between contract notices. Left at 16 it would have
          been SMALLER than the spacing inside a single run, so the last notice
          in a run would have looked attached to the bubble after it. */}
      <div className="flex flex-col gap-6">
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
              <ContractMilestones
                key={cluster.key}
                messages={cluster.messages}
                shipment={shipment}
              />
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
                      // `items-center`, not `items-end`. Bottom-aligning a 24px
                      // avatar against a ~34px single-line bubble drops it about
                      // five pixels under the bubble's optical centre, which is
                      // the misalignment you see on every short incoming line.
                      'flex max-w-[82%] items-center gap-1.5',
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

/**
 * A run of contract events, as in-chat system notices.
 *
 * These are the room talking, not a person, so they stay centred in the flow
 * with no author, no side, and no surface of their own. A previous pass gave
 * each one a tinted full-width row with a right-aligned time and it read as a
 * table dropped into a conversation — correct information, wrong register. The
 * centring survives that finding.
 *
 * They are also uniformly muted, and that is a decision rather than an
 * oversight. An intermediate pass inked the milestones — paid, shipped,
 * delivered, complete — to give the eye somewhere to land, and it read as
 * uneven emphasis instead: two greys down a centred column with no obvious rule,
 * especially on a trade, whose event vocabulary the milestone list did not
 * cover. What separates these lines from the conversation is that they are
 * centred and authorless; they do not need to outrank each other as well.
 *
 * Colour escalates in exactly one case, and it is not hierarchy: a failed
 * payment or a dispute must never look like routine progress.
 */
function ContractMilestones({
  messages,
  shipment,
}: {
  messages: ChatMessage[];
  shipment: MessageLogShipment | null;
}) {
  return (
    // 24px between notices against 4px inside one, so a stamp always belongs to
    // the sentence under it rather than floating between two. The ratio is what
    // matters: each notice is a two-line block now, and anything under about 20
    // here let consecutive blocks read as one four-line paragraph.
    <ol className="space-y-6" aria-label="Contract activity">
      {messages.map((message) => {
        const tone = classifyContractEvent(message.system_event);
        const alarming = tone === 'destructive' || tone === 'warning';
        const tracked =
          shipment?.trackingUrl &&
          message.system_event &&
          SHIPMENT_EVENTS.has(message.system_event)
            ? shipment
            : null;

        return (
          <li
            key={message.id}
            className="mx-auto max-w-[44rem] text-center"
          >
            {/* STAMPED ABOVE, like any other message in the thread. It used to
                trail the sentence after a middot, which kept each event to one
                line but made the clock read as the last few words of the copy —
                and the copy is the part that has to be quotable in a dispute. */}
            <time
              dateTime={message.created_at}
              suppressHydrationWarning
              className="block text-meta text-muted-foreground"
            >
              {messageDateTimeLabel(message.created_at)}
            </time>
            <p
              className={cn(
                // `44rem` so the sentence clears one line at desktop; below that
                // the container caps it and `text-balance` keeps the wrap from
                // leaving a two-word orphan.
                // Uniformly muted. An earlier pass inked milestones to give the
                // eye somewhere to land, but a system notice is the room
                // talking and none of them outrank each other as reading
                // material — the two-tone split just made the log look
                // unevenly emphasised. Destructive is the one exception below:
                // that is escalation, not hierarchy.
                'mt-1 text-balance text-body leading-5',
                alarming ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {message.body}
              {tracked ? (
                <>
                  {' '}
                  {/* Rides the same line as the event it belongs to. The label
                      is bare "Track" because the sentence in front of it already
                      names the carrier and the consignment — repeating them here
                      is what pushed this onto a row of its own. The carrier
                      stays in the accessible name, which still contains the
                      visible word (SC 2.5.3). */}
                  <a
                    href={tracked.trackingUrl as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Track parcel${tracked.carrier ? ` with ${tracked.carrier}` : ''} (opens in a new tab)`}
                    className="ml-1 inline-flex items-center gap-tight rounded-md border px-1.5 py-0.5 align-[-0.15em] text-meta font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:border-iris"
                  >
                    Track
                    <HugeiconsIcon icon={ExternalLinkIcon} className="size-3 shrink-0" aria-hidden />
                  </a>
                </>
              ) : null}
            </p>
          </li>
        );
      })}
    </ol>
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
            className="block w-full max-w-56 overflow-hidden border border-transparent focus:outline-none focus-visible:border-iris"
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
            <HugeiconsIcon icon={FileTextIcon} className="size-4 shrink-0" aria-hidden />
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
