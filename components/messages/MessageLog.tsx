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
import {
  classifyContractEvent,
  ContractEventIcon,
} from '@/components/contract/contractEventTone';
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

/**
 * The column the log and the composer share, so the field lines up with the bubbles.
 *
 * IT NO LONGER CAPS ITSELF, and the reasoning it used to carry was half right. The cap
 * existed because an uncapped BUBBLE on a wide viewport ran past 1000px, which is not a
 * readable measure. But capping the whole COLUMN at 44rem to fix that also capped the
 * composer and the timeline, so on a wide screen the pane held a 704px strip of content
 * floating in the middle of it with a few hundred pixels of empty card either side —
 * and it did that on top of the two-pane layout, which had already narrowed the reading
 * pane for the same reason. Two caps for one problem.
 *
 * The measure now lives where the measure is: {@link MESSAGE_MEASURE} on the bubble, and
 * {@link MESSAGE_PROSE} on the system-notice block. The column fills its pane, the way
 * every chat client does — the composer spans the surface it sits on, and the bubbles
 * stay readable.
 */
export const MESSAGE_COLUMN = 'w-full';

/**
 * How wide one bubble may get: 82% of the column, and never more than 36rem.
 *
 * The percentage is what keeps a short line from looking stranded on a phone; the rem
 * cap is what keeps a long one readable when the pane is 1300px. Both are needed —
 * either alone breaks at one end of the range.
 */
export const MESSAGE_MEASURE = 'max-w-[min(82%,36rem)]';

/** Prose measure for the contract-activity block, which is sentences rather than chat. */
export const MESSAGE_PROSE = 'max-w-[44rem]';

// The horizontal inset every band in the thread shares is NOT re-exported from here.
// It lives in `threadGeometry` with the pane-bar height, and each band imports it from
// there — a re-export through this `'use client'` module would put a client reference in
// the server trees that also need it (`loading.tsx`, `WorkspaceSkeletons`).

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

export interface MessageLogSaleContext {
  id: string;
  /** Safe only when this conversation has exactly one historical Cash_Sale. */
  allowUnscopedLegacy: boolean;
  fromShopfront: boolean;
  fulfillmentMethod: 'DELIVERY' | 'IN_PERSON' | null;
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
  /** Selected Cash_Sale context for legacy payment copy and contract boundaries. */
  saleContext?: MessageLogSaleContext | null;
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
  saleContext = null,
}: MessageLogProps) {
  const clusters = useMemo(
    () => groupMessages(messages, currentUserId),
    [messages, currentUserId],
  );
  const latestSystemId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].kind === 'SYSTEM') return messages[index].id;
    }
    return null;
  }, [messages]);
  const firstSystemKey =
    clusters.find((cluster) => cluster.type === 'system')?.key ?? null;
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
        <p className="max-w-56 text-body text-muted-foreground">{emptyHint}</p>
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
                <time
                  dateTime={cluster.dateTime}
                  suppressHydrationWarning
                  className="text-meta font-medium text-muted-foreground"
                >
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
                saleContext={saleContext}
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
                <span className="mb-0.5 px-tight text-meta font-medium text-muted-foreground">
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
                      `flex ${MESSAGE_MEASURE} items-center gap-1.5`,
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
                className="px-tight text-meta text-muted-foreground"
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
 * Resolve payment-cleared copy for rows created before fulfillment-specific
 * wording was persisted. Only a uniquely associated contract is rewritten;
 * ambiguous legacy rows in a reused conversation keep their stored sentence.
 */
function belongsToSelectedSale(
  message: ChatMessage,
  saleContext: MessageLogSaleContext | null,
): boolean {
  if (!saleContext) return false;
  return (
    message.cash_sale_id === saleContext.id ||
    ((message.cash_sale_id === null ||
      typeof message.cash_sale_id === 'undefined') &&
      saleContext.allowUnscopedLegacy)
  );
}

function contractEventBody(
  message: ChatMessage,
  saleContext: MessageLogSaleContext | null,
): string {
  // The null check is stated HERE as well as inside `belongsToSelectedSale`, which
  // already returns false for a null context. That is not redundancy for its own sake:
  // TypeScript cannot narrow a parameter through another function's boolean return, so
  // without it every `saleContext.` below is an error — four of them, and `tsc` was
  // failing on exactly those.
  if (!saleContext || !belongsToSelectedSale(message, saleContext)) return message.body;

  // The same sentences `describe_cash_sale_event` writes (0119), for rows written by
  // an earlier version of it: the pre-0113 single-listing wording, and the 0113–0116
  // "binder or bulk listing" wording that 0119 retired from the transcript.
  if (message.system_event === 'AGREEMENT_CREATED' && saleContext.fromShopfront) {
    return message.body
      .replace(
        'started this purchase contract and reserved the item. No money has moved yet.',
        'started this purchase contract for a multi-item listing. Nothing in the listing is held, and no money has moved yet.',
      )
      .replace('for a binder or bulk listing.', 'for a multi-item listing.');
  }
  if (message.system_event === 'PAYMENT_FAILED' && saleContext.fromShopfront) {
    return 'The payment failed. This contract did not proceed. The multi-item listing remains open, and nothing from it was held.';
  }
  if (message.system_event !== 'PAYMENT_CLEARED') return message.body;

  if (saleContext.fulfillmentMethod === 'DELIVERY') {
    return 'Payment confirmed. The seller can now ship the item.';
  }
  if (saleContext.fulfillmentMethod === 'IN_PERSON') {
    return 'Payment confirmed. The seller can now complete the agreed in-person handover.';
  }
  return 'Payment confirmed. The seller can now continue with the agreed fulfillment method.';
}

/**
 * Contract events as CENTRED SYSTEM NOTICES — the 闲鱼 treatment.
 *
 * WHY THIS IS NOT A LEDGER ANY MORE. It was: a "Contract activity" heading, a vertical
 * rail, a tone icon per row, a timestamp on its own line, and the newest event set in
 * `foreground` while the rest were muted. Every one of those was doing a job the room
 * did not have anywhere else to do — the cash-sale room drew no progress rail and had no
 * Status tab, so the transcript was the only place the contract's shape appeared, and it
 * grew a spine to carry it.
 *
 * That is no longer true. `ContractStatusPanel` in the Status tab now holds the rail, the
 * live step and whose move it is, and the chat dock repeats the step above the composer.
 * With the state stated twice elsewhere, a heading, a rail and an emphasised "latest" in
 * the middle of the conversation are three claims on attention that the conversation
 * itself should be getting. A system notice in a chat only has to say what happened, at
 * a weight that lets the eye skip it once it has.
 *
 * SO: centred, `text-meta`, muted, one line per event, no icon, no heading. The same
 * treatment the day divider above it already uses, which is the point — both are the
 * transcript talking rather than a person.
 *
 * WHAT IS KEPT AND WHY. The timestamp stays, inline as a prefix: these lines are the
 * audit trail an arbitrator reads, and "when" is half of what they are for. Destructive
 * events keep their colour — a cancellation or a dispute is not something to let the eye
 * skip. And the Track link stays, because a shipment notice whose number you cannot open
 * is the problem `ShipmentSummary` exists to fix.
 */
function ContractMilestones({
  messages,
  shipment,
  saleContext,
}: {
  messages: ChatMessage[];
  shipment: MessageLogShipment | null;
  saleContext: MessageLogSaleContext | null;
}) {
  return (
    // `ol` for the reading order and `aria-label` so the run announces as what it is;
    // the heading it replaces was doing that job visually and only visually.
    //
    // `gap-cozy` between notices, against `gap-0.5` inside one. Each notice is now two
    // centred lines, so the gap between them has to be clearly larger than the gap
    // between a notice's own time and body or the run reads as one block of text.
    <ol className="flex flex-col gap-cozy" aria-label="Contract activity">
      {messages.map((message) => {
        const tone = classifyContractEvent(message.system_event);
        const alarming = tone === 'destructive' || tone === 'warning';
        const tracked =
          shipment?.trackingUrl &&
          message.system_event &&
          SHIPMENT_EVENTS.has(message.system_event) &&
          (!saleContext || belongsToSelectedSale(message, saleContext))
            ? shipment
            : null;

        return (
          <li key={message.id} className="flex flex-col items-center gap-0.5">
            {/* THE TIME IS ITS OWN LINE, ABOVE. Inline as a prefix it read as part of
                the sentence — "4:13 pm joys_joys marked the item as shipped" — and on a
                notice that wrapped to two lines the eye had to find where the prose
                actually started. Above and centred, it stamps the notice the way the
                day divider stamps the run. */}
            <time
              dateTime={message.created_at}
              suppressHydrationWarning
              className="text-meta text-muted-foreground"
            >
              {messageTimeLabel(message.created_at)}
            </time>
            {/* `max-w-[85%]`, not the full column. A centred line that runs the width
                of a wide pane stops reading as an aside and starts reading as a
                paragraph — and the wrap point is what makes the difference. */}
            <p
              className={cn(
                'max-w-[85%] text-balance text-center text-meta',
                alarming ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              {contractEventBody(message, saleContext)}
              {tracked ? (
                <>
                  {' '}
                  {/* Inline and underlined rather than a bordered chip: at this weight
                      a chip is heavier than the sentence carrying it. */}
                  <a
                    href={tracked.trackingUrl as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Track parcel${tracked.carrier ? ` with ${tracked.carrier}` : ''} (opens in a new tab)`}
                    className="inline-flex items-center gap-0.5 font-medium text-foreground underline decoration-iris/55 underline-offset-4 transition-colors hover:decoration-iris focus:outline-none focus-visible:decoration-iris"
                  >
                    Track
                    <HugeiconsIcon
                      icon={ExternalLinkIcon}
                      className="size-3 shrink-0"
                      aria-hidden
                    />
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
        <button
          type="button"
          onClick={url ? onOpenImage : undefined}
          disabled={!url}
          className="relative block aspect-[4/3] w-56 max-w-full overflow-hidden border border-transparent focus:outline-none focus-visible:border-iris disabled:cursor-default"
        >
          {url ? (
            // Signed URLs are private and short-lived; next/image cannot cache them.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={message.attachment_name ?? 'Photo'}
              width={224}
              height={168}
              loading="lazy"
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-meta opacity-70">
              Photo
            </span>
          )}
        </button>
      ) : null}
      {file ? (
        url ? (
          <a
            href={url}
            download={message.attachment_name ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex items-center gap-snug px-cozy py-snug',
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
          <p className="px-cozy py-snug opacity-70">Attachment unavailable</p>
        )
      ) : null}
      {text ? (
        <p className={cn('whitespace-pre-wrap break-words px-cozy', image || file ? 'pb-snug pt-1.5' : 'py-snug')}>
          {text}
        </p>
      ) : null}
    </div>
  );
}
