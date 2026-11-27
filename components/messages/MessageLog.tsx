'use client';

// components/messages/MessageLog.tsx
//
// Shared thread body for the inbox and the contract room. Clusters consecutive
// messages from the same person so a run of replies is one visual group. Attachments
// render in the bubble: photos open the contract lightbox, files download.
//
// THE INSTAGRAM GRAMMAR (2026-11-28, design-system audit; Mobbin, Instagram Direct web
// and iOS). What a production chat does that this one did not:
//
//   - BUBBLES ARE NEAR-PILLS THAT JOIN. 20px corners, and where two bubbles from one
//     person meet, the corners on the sender's side close to 6px, so a run reads as one
//     shape rather than a stack of separate cards (`bubbleCorners`).
//   - YOUR MESSAGES ARE VIOLET. `--iris-ink` with white type (7.7:1), Instagram's own
//     move: the one large area of brand colour in the product is the member's own voice.
//     Theirs stay the slate `--muted`. See WHERE THE VIOLET IS ALLOWED in `globals.css`.
//   - TIME IS A DIVIDER, NOT A CAPTION. A clock under every cluster put a line of grey
//     type between every exchange. Time now heads the conversation where a gap opens
//     (`TIME_BREAK_MS`), merges into the day divider at the top of a day, sits on each
//     bubble as a hover title, and is still read out per cluster to a screen reader.
//   - ONE RECEIPT. "Seen" (or "Sent", "Sending…") under your message while it is the
//     last word, instead of " · Read" on every cluster you sent.
//   - THE AVATAR SITS AT THE FOOT of their run, level with the last bubble's bottom edge,
//     as Instagram, iMessage and Messenger all place it.

import { useMemo, useState } from 'react';
import { Icon, type IconGlyph } from '@/components/ui/icon';
import {
  ArrowSquareOutIcon,
  CheckIcon,
  FileTextIcon,
  LockSimpleIcon,
  PackageIcon,
  ShieldCheckIcon,
  TruckIcon,
  WarningIcon,
  XIcon,
} from '@/components/ui/icons';

import { Avatar } from '@/components/ui/avatar';
import { ContractImageLightbox } from '@/components/contract/ContractImageLightbox';
import {
  classifyContractEvent,
  type ContractEventTone,
} from '@/components/contract/contractEventTone';
import { isOptimisticMessage } from '@/lib/realtime/useConversationRealtime';
import { cn } from '@/lib/utils';
import {
  formatAttachmentBytes,
  isImageAttachmentMime,
} from '@/lib/storage/messageAttachmentsShared';
import {
  groupMessages,
  messageTimeLabel,
  type ChatMessage,
  type MessageCluster,
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
 * How wide one bubble may get: 78% of the column, and never more than 34rem.
 *
 * The percentage is what keeps a short line from looking stranded on a phone; the rem
 * cap is what keeps a long one readable when the pane is 1300px. Both are needed —
 * either alone breaks at one end of the range.
 */
export const MESSAGE_MEASURE = 'max-w-[min(78%,34rem)]';

/** Prose measure for the contract-activity block, which is sentences rather than chat. */
export const MESSAGE_PROSE = 'max-w-[44rem]';

// The horizontal inset every band in the thread shares is NOT re-exported from here.
// It lives in `threadGeometry` with the pane-bar height, and each band imports it from
// there — a re-export through this `'use client'` module would put a client reference in
// the server trees that also need it.

/**
 * A gap this long between two entries puts the time back above the next one, as
 * Instagram does. Shorter, the exchange is one conversation and the hover title on each
 * bubble carries the exact minute.
 */
const TIME_BREAK_MS = 30 * 60 * 1000;

/**
 * The bubble's corners. 20px everywhere except where it touches its neighbour in the same
 * run, on the sender's side, which closes to 6px (`rounded-*-md`). A single bubble is a
 * whole capsule; a run of three is a first, a middle and a last.
 */
export const MESSAGE_BUBBLE_RADIUS = 'rounded-[1.25rem]';

type RunPosition = 'single' | 'first' | 'middle' | 'last';

function runPosition(index: number, count: number): RunPosition {
  if (count === 1) return 'single';
  if (index === 0) return 'first';
  if (index === count - 1) return 'last';
  return 'middle';
}

function bubbleCorners(mine: boolean, position: RunPosition): string {
  const top = mine ? 'rounded-tr-md' : 'rounded-tl-md';
  const bottom = mine ? 'rounded-br-md' : 'rounded-bl-md';
  switch (position) {
    case 'first':
      return bottom;
    case 'middle':
      return cn(top, bottom);
    case 'last':
      return top;
    default:
      return '';
  }
}

/**
 * The event codes that mean "the seller handed it to a carrier".
 * `SHIPMENT_RECORDED` is what the orchestrator logs; `SHIPPED` is the older
 * code still present in seeded and pre-0012 rooms.
 */
const SHIPMENT_EVENTS = new Set(['SHIPMENT_RECORDED', 'SHIPPED']);

/**
 * The milestones that get a card rather than a one-line notice: the handful a member
 * scrolls back to find — money held, goods sent, goods arrived, a problem raised, the
 * end. Everything else (terms edits, confirmations) stays a centred line. Keyed by
 * event code; an unknown code is never a milestone.
 *
 * Each names its own glyph, so the card says WHAT happened in its mark (a shield for
 * money held, a truck for a parcel) while the disc's colour says how it went.
 */
const MILESTONES: Record<string, { title: string; glyph: IconGlyph }> = {
  PAYMENT_CLEARED: { title: 'Payment held', glyph: ShieldCheckIcon },
  ESCROW_LOCKED: { title: 'Payment held', glyph: ShieldCheckIcon },
  HOLDS_CONFIRMED: { title: 'Holds placed', glyph: LockSimpleIcon },
  SHIPMENT_RECORDED: { title: 'Shipped', glyph: TruckIcon },
  SHIPPED: { title: 'Shipped', glyph: TruckIcon },
  BOTH_SHIPPED: { title: 'Both items shipped', glyph: TruckIcon },
  CARRIER_DELIVERED: { title: 'Delivered', glyph: PackageIcon },
  RECEIPT_RECORDED: { title: 'Received', glyph: PackageIcon },
  BOTH_RECEIVED: { title: 'Both items received', glyph: PackageIcon },
  DISPUTE_RAISED: { title: 'Dispute raised', glyph: WarningIcon },
  CONDITION_DISPUTE: { title: 'Dispute raised', glyph: WarningIcon },
  INSPECTION_ACCEPTED: { title: 'Completed', glyph: CheckIcon },
  AUTO_COMPLETED: { title: 'Completed', glyph: CheckIcon },
  BOTH_ACCEPTED: { title: 'Completed', glyph: CheckIcon },
  COMPLETED: { title: 'Completed', glyph: CheckIcon },
  DEAL_COMPLETED: { title: 'Completed', glyph: CheckIcon },
  CANCELLED: { title: 'Cancelled', glyph: XIcon },
  DEAL_CANCELLED: { title: 'Cancelled', glyph: XIcon },
};

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
  /** Incoming avatar at the foot of a run. Inbox on, contract off. */
  showAvatars?: boolean;
  /** "You" / their name above the first bubble of a run. */
  showNames?: boolean;
  /** "Seen" / "Sent" under your message while it is the last thing either of you said. */
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
  /**
   * `false` leaves attachments in their same-size "still signing" placeholder instead
   * of signing them. Only for a thread drawn as a preview of itself; the real thread
   * that replaces it signs them. Defaults to `true`.
   */
  signAttachments?: boolean;
}

/** When the entry a cluster follows happened, for the time-break rule. */
function lastAt(cluster: MessageCluster | undefined): number | null {
  if (!cluster || cluster.type === 'day') return null;
  const last = cluster.messages[cluster.messages.length - 1];
  return new Date(last.created_at).getTime();
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
  signAttachments = true,
}: MessageLogProps) {
  const clusters = useMemo(
    () => groupMessages(messages, currentUserId),
    [messages, currentUserId],
  );
  const urls = useConversationAttachments(conversationId, messages, signAttachments);
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

  // The one message the receipt sits under: yours, when it is the last thing a PERSON
  // said. Once they have replied, the reply is the receipt (Instagram drops "Seen"
  // the same way); a contract notice after it does not count as a reply.
  const latestMine = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.kind !== 'USER') continue;
      return message.sender_id === currentUserId ? message : null;
    }
    return null;
  }, [messages, currentUserId]);

  if (messages.length === 0) {
    return (
      <div className="grid h-full place-items-center text-center">
        <p className="max-w-56 text-body text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }

  return (
    <>
      {/* `gap-group` between runs; a run's own bubbles are 2px apart, so a change of
          speaker reads at a glance. A time break travels INSIDE the run it heads, so
          it sits nearer the messages it dates than the ones before them. */}
      <div className="flex flex-col gap-group">
        {clusters.map((cluster, index) => {
          if (cluster.type === 'day') {
            // THE FIRST TIME OF THE DAY JOINS THE DAY: "Today 2:46 am", one line,
            // when a person's message opens it. A contract notice carries its own
            // time, so before one the divider is the day alone.
            const next = clusters[index + 1];
            const opening =
              next?.type === 'user' ? messageTimeLabel(next.messages[0].created_at) : null;
            return (
              <div key={cluster.key} className="flex justify-center pt-tight">
                <time
                  dateTime={cluster.dateTime}
                  suppressHydrationWarning
                  className="text-meta text-muted-foreground"
                >
                  <span className="font-semibold">{cluster.label}</span>
                  {opening ? ` ${opening}` : null}
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

          const previous = clusters[index - 1];
          const first = cluster.messages[0];
          const last = cluster.messages[cluster.messages.length - 1];
          const previousAt = lastAt(previous);
          const timeBreak =
            previous?.type !== 'day' &&
            (previousAt === null ||
              new Date(first.created_at).getTime() - previousAt >= TIME_BREAK_MS);
          const receiptHere =
            showReadReceipt && cluster.mine && latestMine !== null && last.id === latestMine.id;

          return (
            <div key={cluster.key} className="flex flex-col gap-snug">
              {timeBreak ? (
                <time
                  dateTime={first.created_at}
                  suppressHydrationWarning
                  className="self-center text-meta text-muted-foreground"
                >
                  {messageTimeLabel(first.created_at)}
                </time>
              ) : null}
              <div
                className={cn(
                  'flex flex-col gap-0.5',
                  cluster.mine ? 'items-end' : 'items-start',
                )}
              >
                {showNames ? (
                  <span className="mb-0.5 px-cozy text-meta font-medium text-muted-foreground">
                    {cluster.mine ? 'You' : counterpartyName}
                  </span>
                ) : null}
                {cluster.messages.map((message, messageIndex) => {
                  const position = runPosition(messageIndex, cluster.messages.length);
                  const footOfRun = position === 'single' || position === 'last';
                  return (
                    <div
                      key={message.id}
                      className={cn(
                        // `items-end`: the avatar stands at the foot of the run, its
                        // bottom edge on the last bubble's, the way every chat client
                        // places it. Centred, it floated halfway up a long bubble.
                        `flex ${MESSAGE_MEASURE} items-end gap-snug`,
                        cluster.mine ? 'flex-row-reverse' : 'flex-row',
                      )}
                    >
                      {showAvatars && !cluster.mine ? (
                        footOfRun ? (
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
                        position={position}
                        url={
                          // `undefined` while the path is still being signed, `null`
                          // once signing has answered without a URL. The bubble needs
                          // the difference — see `MessageBubble`.
                          message.attachment_path
                            ? urls[message.attachment_path]
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
                {/* The run's time for a screen reader, which cannot hover a bubble. */}
                <time dateTime={last.created_at} suppressHydrationWarning className="sr-only">
                  {messageTimeLabel(last.created_at)}
                </time>
                {receiptHere ? (
                  <span className="px-tight pt-0.5 text-meta text-muted-foreground">
                    {isOptimisticMessage(last) ? 'Sending…' : last.read_at ? 'Seen' : 'Sent'}
                  </span>
                ) : null}
              </div>
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

  // The same sentences `describe_cash_sale_event` writes (0175), for STORED rows
  // written by an earlier version of it: the pre-0113 single-listing wording, 0119's
  // "multi-item listing" and 0133's "binder or bulk listing". The transcript is
  // persisted in `messages.body`, so these rewrites keep any row a backfill did not
  // reach reading the current copy: "a listing with multiple items".
  if (message.system_event === 'AGREEMENT_CREATED' && saleContext.fromShopfront) {
    return message.body
      .replace(
        'started this purchase contract and reserved the item. No money has moved yet.',
        'started this purchase contract for a listing with multiple items. Nothing in the listing is held, and no money has moved yet.',
      )
      .replace('for a multi-item listing.', 'for a listing with multiple items.')
      .replace('for a binder or bulk listing.', 'for a listing with multiple items.');
  }
  if (message.system_event === 'PAYMENT_FAILED' && saleContext.fromShopfront) {
    return 'The payment failed. This contract did not proceed. The listing remains open, and nothing from it was held.';
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
 * A milestone's mark: a solid disc in the outcome's colour with the event's own glyph
 * knocked out in white, the `StatusGlyph` rule (an icon that states a fact is a filled
 * shape, never a hairline). Green went well, violet is in progress (the badge's "live"
 * hue), red needs attention.
 */
function MilestoneDisc({ glyph, tone }: { glyph: IconGlyph; tone: ContractEventTone }) {
  const alarming = tone === 'destructive' || tone === 'warning';
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full text-white',
        alarming ? 'bg-destructive' : tone === 'success' ? 'bg-trust' : 'bg-iris-ink',
      )}
    >
      <Icon icon={glyph} className="size-4" />
    </span>
  );
}

/**
 * Contract events as CENTRED SYSTEM NOTICES — the 闲鱼 and Instagram treatment.
 *
 * WHY THIS IS NOT A LEDGER ANY MORE. It was: a "Contract activity" heading, a vertical
 * rail, a tone icon per row, a timestamp on its own line, and the newest event set in
 * `foreground` while the rest were muted. Every one of those was doing a job the room
 * did not have anywhere else to do. `ContractStatusPanel` in the Status tab now holds the
 * rail, the live step and whose move it is, and the chat dock repeats the step above the
 * composer, so a system notice in a chat only has to say what happened, at a weight that
 * lets the eye skip it once it has.
 *
 * SO: centred, `text-meta`, muted, one line per event. THE EXCEPTION is the handful of
 * milestones in `MILESTONES` — money held, goods sent and arrived, a dispute, the end —
 * which render as cards, because those are what a member scrolls back to find.
 *
 * THE CARD (2026-11-28, design-system audit). It was a tinted box with a tinted border
 * and a hairline outline icon, and on a dispute the whole box went pink with a violet
 * glyph in it: the alert-box recipe, and three colours saying one thing. Now the box is
 * one quiet slate tile with no edge, the outcome is carried by the solid disc, and only
 * a problem's title turns red. Title and sentence are the same size in two weights, the
 * time is the one 12px figure.
 *
 * WHAT IS KEPT AND WHY. The timestamp stays: these lines are the audit trail an
 * arbitrator reads, and "when" is half of what they are for. Destructive events keep
 * their colour — a cancellation or a dispute is not something to let the eye skip. And
 * the Track link stays, because a shipment notice whose number you cannot open is the
 * problem `ShipmentSummary` exists to fix.
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
    // `ol` for the reading order and `aria-label` so the run announces as what it is.
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

        const milestone = message.system_event ? MILESTONES[message.system_event] : undefined;
        if (milestone) {
          return (
            <li key={message.id} className="flex justify-center">
              <div className="flex w-full max-w-[24rem] items-start gap-cozy rounded-2xl bg-muted/80 p-cozy">
                <MilestoneDisc glyph={milestone.glyph} tone={tone} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-snug">
                    <p
                      className={cn(
                        'min-w-0 flex-1 truncate text-body font-semibold',
                        alarming ? 'text-destructive' : 'text-foreground',
                      )}
                    >
                      {milestone.title}
                    </p>
                    <time
                      dateTime={message.created_at}
                      suppressHydrationWarning
                      className="shrink-0 text-meta tabular-nums text-muted-foreground"
                    >
                      {messageTimeLabel(message.created_at)}
                    </time>
                  </div>
                  <p className="text-pretty text-body text-muted-foreground">
                    {contractEventBody(message, saleContext)}
                  </p>
                  {tracked ? (
                    <a
                      href={tracked.trackingUrl as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Track parcel${tracked.carrier ? ` with ${tracked.carrier}` : ''} (opens in a new tab)`}
                      className="mt-snug inline-flex items-center gap-tight text-body font-medium text-foreground underline decoration-iris/55 underline-offset-4 transition-colors hover:decoration-iris focus:outline-none focus-visible:decoration-iris"
                    >
                      Track parcel
                      <Icon icon={ArrowSquareOutIcon} className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
            </li>
          );
        }

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
            {/* A centred line that runs the width of a wide pane stops reading as an
                aside and starts reading as a paragraph, so it wraps at 85% or 30rem. */}
            <p
              className={cn(
                'max-w-[min(85%,30rem)] text-balance text-center text-meta',
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
                    <Icon icon={ArrowSquareOutIcon} className="size-3" />
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
  position,
  url,
  onOpenImage,
}: {
  message: ChatMessage;
  mine: boolean;
  position: RunPosition;
  /** Signed URL; `undefined` while signing is in flight, `null` when it failed. */
  url: string | null | undefined;
  onOpenImage: () => void;
}) {
  const image = isImageAttachmentMime(message.attachment_mime);
  const file = Boolean(message.attachment_path) && !image;
  const text = message.body.trim();

  return (
    <div
      // The exact minute on hover; the log shows time only where a gap opens.
      title={messageTimeLabel(message.created_at)}
      suppressHydrationWarning
      className={cn(
        'min-w-0 overflow-hidden text-body',
        // YOUR OWN MESSAGES IN `--iris-ink`, theirs in the slate `--muted`. White on
        // iris-ink is 7.7:1. See the module note and WHERE THE VIOLET IS ALLOWED.
        mine ? 'bg-iris-ink text-white' : 'bg-muted text-foreground',
        MESSAGE_BUBBLE_RADIUS,
        bubbleCorners(mine, position),
        // A message still on its way is drawn at full strength: it is swapped for the
        // server's row within a round trip, and dimming it made every send flicker.
        // The receipt under it says "Sending…" instead.
      )}
    >
      {image ? (
        <button
          type="button"
          onClick={url ? onOpenImage : undefined}
          disabled={!url}
          className="relative block aspect-[4/3] w-60 max-w-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default"
        >
          {url ? (
            // Signed URLs are private and short-lived; next/image cannot cache them.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={message.attachment_name ?? 'Photo'}
              width={240}
              height={180}
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
              mine ? 'text-white' : 'text-foreground',
            )}
          >
            <FileAttachmentLabel message={message} mine={mine} />
          </a>
        ) : url === undefined ? (
          // STILL SIGNING: the same two-line row the link will be, inert and dimmed.
          // This used to fall through to "Attachment unavailable" — one line of the
          // wrong claim — and then grow into the two-line link when the URL arrived,
          // so every file in a thread both lied for a moment and pushed the log down.
          <div
            className={cn(
              'flex items-center gap-snug px-cozy py-snug opacity-70',
              mine ? 'text-white' : 'text-foreground',
            )}
          >
            <FileAttachmentLabel message={message} mine={mine} />
          </div>
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

/** Glyph, name and size of a file attachment — shared by the link and its pending row. */
function FileAttachmentLabel({
  message,
  mine,
}: {
  message: ChatMessage;
  mine: boolean;
}) {
  return (
    <>
      {/* The file's own tile inside the bubble: a tint of whatever colour it sits on. */}
      <span
        aria-hidden
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-xl',
          mine ? 'bg-white/15' : 'bg-foreground/[0.06]',
        )}
      >
        <Icon icon={FileTextIcon} className="size-[1.125rem]" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {message.attachment_name ?? 'File'}
        </span>
        {message.attachment_bytes != null ? (
          <span className={cn('block text-meta', mine ? 'text-white/75' : 'text-muted-foreground')}>
            {formatAttachmentBytes(message.attachment_bytes)}
          </span>
        ) : null}
      </span>
    </>
  );
}
