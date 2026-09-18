'use client';

// components/messages/ChatThread.tsx
//
// Full-page participant conversation. The server supplies the first history and
// contract context; Realtime appends messages and refreshes that context whenever
// a new contract event arrives. Contract threads read as an ordered ledger above
// the human chat, while listing enquiries keep the familiar bottom-anchored flow.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChevronLeftIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import { useConversationRealtime } from '@/lib/realtime/useConversationRealtime';
import {
  markConversationRead,
  type ConversationItemSummary,
  type ConversationSaleSummary,
  type ConversationShipment,
  type MessageRow,
} from '@/lib/actions/messages';
import { CURRENCY_CODE, formatMoney, itemImageUrl } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { CashSaleStatusBadge } from '@/components/sales/CashSaleStatusBadge';
import { MessageComposer } from '@/components/messages/MessageComposer';
import {
  MESSAGE_COLUMN,
  MESSAGE_PROSE,
  MessageLog,
} from '@/components/messages/MessageLog';
import {
  MESSAGE_GUTTER,
  PANE_BAR_MIN_H,
} from '@/components/messages/threadGeometry';
import { cn } from '@/lib/utils';

export interface ChatThreadProps {
  conversationId: string;
  currentUserId: string;
  otherName: string | null;
  otherAvatarPath?: string | null;
  item: ConversationItemSummary | null;
  trade?: { id: string } | null;
  sale?: ConversationSaleSummary | null;
  shipment?: ConversationShipment | null;
  /** Server-rendered history used for the first paint and live-log baseline. */
  initialMessages: MessageRow[];
}

export function ChatThread({
  conversationId,
  currentUserId,
  otherName,
  otherAvatarPath = null,
  item,
  trade = null,
  sale = null,
  shipment = null,
  initialMessages,
}: ChatThreadProps) {
  const router = useRouter();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Contract status, amount, fulfillment, and destination are Server Component
  // props. Debounce event bursts into one RSC refresh; Next merges the payload
  // without discarding the draft or this component's scroll state.
  const refreshContractContext = useCallback(
    (_message: MessageRow) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, 100);
    },
    [router],
  );

  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  const {
    messages,
    historyReady,
    connectionStatus,
    addOptimistic,
    settleOptimistic,
  } = useConversationRealtime(conversationId, {
    initialMessages,
    onSystemMessage: refreshContractContext,
  });

  const logRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const didPositionRef = useRef(false);
  const displayName = otherName?.trim() || 'NoDitto member';
  const itemThumb = item ? itemImageUrl(item.imagePath) : null;
  const underContract = Boolean(trade || sale);
  const subject = Boolean(item || underContract);
  const title = item ? item.title : trade ? 'Trade' : displayName;

  // Contract money always wins over listing FMV. A trade has no honest price to
  // show here without its Trade_Side_Value, and several simultaneous binder
  // contracts have no single amount, so both deliberately omit the figure.
  const price = sale
    ? sale.activeContractCount > 1
      ? null
      : formatMoney(sale.agreedPriceCents, sale.currency)
    : trade
      ? null
      : item?.priceCents != null
        ? formatMoney(item.priceCents, item.currency ?? CURRENCY_CODE)
        : null;

  // THE CONTRACT'S STATUS IS A BADGE, not a word in a muted sentence. A single live
  // sale renders `CashSaleStatusBadge` — the same one the inbox rows and the room
  // use, so the three cannot disagree about the same sale. Several active contracts
  // and a listing's own state (Reserved, Sold) stay as text: neither is a contract
  // status the badge knows.
  const saleBadge = sale && sale.activeContractCount === 1 ? sale.status : null;
  const statusText = sale
    ? sale.activeContractCount > 1
      ? `${sale.activeContractCount} active contracts`
      : null
    : item?.status && item.status !== 'AVAILABLE'
      ? item.status.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
      : null;
  const offline = connectionStatus === 'error';
  const meta = [statusText, subject ? displayName : null].filter(Boolean).join(' · ');

  const dock: {
    href: string;
    label: string;
    underContract: boolean;
  } | null = trade
    ? { href: `/trades/${trade.id}`, label: 'Open contract', underContract: true }
    : sale
      ? sale.activeContractCount > 1
        ? {
            href: sale.viewerRole === 'BUYER' ? '/purchases' : '/sales',
            label: 'View contracts',
            underContract: true,
          }
        : { href: `/sales/${sale.id}`, label: 'Open contract', underContract: true }
      : item
        ? {
            href: `/listings/${item.id}`,
            label: 'View listing',
            underContract: false,
          }
        : null;

  // Keep scrolling scoped to the log. A short contract ledger remains top-aligned
  // because it has no overflow; a long thread still opens at its newest message.
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (!didPositionRef.current || isNearBottomRef.current) {
      log.scrollTop = log.scrollHeight;
    }
    didPositionRef.current = true;
  }, [messages.length]);

  // Signed attachment URLs resolve after their rows mount. Preserve the bottom
  // pin through those intrinsic-content changes only while following the latest.
  useEffect(() => {
    const log = logRef.current;
    const content = contentRef.current;
    if (!log || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) log.scrollTop = log.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const inboundCount = useMemo(
    () =>
      messages.filter(
        (message) =>
          message.kind === 'USER' && message.sender_id !== currentUserId,
      ).length,
    [messages, currentUserId],
  );
  useEffect(() => {
    void markConversationRead(conversationId);
  }, [conversationId, inboundCount]);

  return (
    <section
      aria-label="Conversation"
      // ONE SURFACE FOR THE WHOLE COLUMN, at every width.
      //
      // This was `max-md:bg-card`, so on a desktop viewport the bar and the composer
      // were `--card` and the log between them fell through to the tinted page
      // background — three bands in one column, beside an inbox pane that is `--card`
      // throughout. Nothing was using the tint to separate anything: the bars already
      // carry borders, and `MessageLog`'s timeline markers are explicitly `bg-card` so
      // they can punch a hole in the rail behind them, which only lands on a card
      // surface. The phone was already correct; this is the desktop catching up.
      className="flex min-h-0 w-full flex-1 flex-col bg-card"
    >
      <header
        className={cn(
          'sticky top-0 z-10 flex shrink-0 items-center gap-cozy border-b bg-card py-2.5',
          // Shared with the inbox pane's bar so the two bottom borders are one line —
          // see the constant's own note. A phone has no seam and no inbox pane beside
          // it; there the back chevron (44px) simply makes the bar taller than this.
          PANE_BAR_MIN_H,
          MESSAGE_GUTTER,
        )}
      >
        <Link
          href="/messages"
          transitionTypes={['nav-back']}
          // `size-9 -ml-2.5`, down from `size-11 -ml-1.5`. On a 414px phone the bar
          // holds this, a thumbnail, a title block and an "Open contract" button;
          // a 44px chevron with 12px of gap after it was a fifth of the row for a
          // glyph 20px wide. 36px is the phone control height everywhere else in the
          // app and the negative margin pulls the hit area into the gutter, so the
          // title gains 14px and the chevron stays a comfortable target.
          className="-ml-2.5 inline-flex size-9 shrink-0 touch-manipulation items-center justify-center rounded-full border border-transparent text-foreground transition-colors hover:bg-foreground/5 focus:outline-none focus-visible:border-iris md:hidden"
          aria-label="Back to messages"
        >
          <HugeiconsIcon
            icon={ChevronLeftIcon}
            className="size-5"
            strokeWidth={1.75}
            aria-hidden
          />
        </Link>

        {itemThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={itemThumb}
            alt=""
            width={80}
            height={80}
            className="size-9 shrink-0 rounded-md border object-cover"
          />
        ) : (
          <Avatar avatarPath={otherAvatarPath} displayName={displayName} size="md" />
        )}

        <div className="min-w-0 flex-1">
          {/* ONE LINE AT EVERY WIDTH. A two-line title on a phone made the bar a
              stack of three lines in which the third — price, status, counterparty —
              was the smallest and the most useful. Truncated, the title is still
              identifiable (the thumbnail beside it does half the work) and the
              status line gets read. The full title is one tap away in the room. */}
          <h2
            title={title}
            className="truncate text-lead font-semibold leading-tight tracking-tight"
          >
            {title}
          </h2>
          {/* A ROW, NOT A SENTENCE. Price as a figure, status as a badge, then the
              counterparty; the badge cannot live inside a truncating `<p>`, so this is
              flex with the text parts each truncating on their own. */}
          <div className="mt-0.5 flex min-w-0 items-center gap-snug text-body text-muted-foreground">
            {price ? (
              <span className="display-value shrink-0 font-semibold text-foreground">{price}</span>
            ) : null}
            {saleBadge ? <CashSaleStatusBadge status={saleBadge} className="shrink-0" /> : null}
            {meta ? <span className="min-w-0 truncate">{meta}</span> : null}
            {offline ? (
              <span className="shrink-0 text-destructive" role="status">
                Offline
              </span>
            ) : null}
          </div>
        </div>

        {dock ? (
          <Button asChild size="sm" className="shrink-0">
            <Link href={dock.href} transitionTypes={['nav-forward']}>
              {dock.label}
            </Link>
          </Button>
        ) : null}
      </header>

      <div
        ref={logRef}
        className={cn(
          // `pb-6` for the same reason as the contract room's log: clusters are `gap-6`
          // apart, and at `pb-cozy` the newest one sat closer to the composer than to its
          // own neighbour above.
          'min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6 pt-5',
          MESSAGE_GUTTER,
        )}
        role="log"
        aria-label={`Conversation with ${displayName}`}
        aria-live={historyReady ? 'polite' : 'off'}
        aria-busy={!historyReady}
        onScroll={(event) => {
          const log = event.currentTarget;
          isNearBottomRef.current =
            log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        }}
      >
        <div
          ref={contentRef}
          className={cn(
            MESSAGE_COLUMN,
            'flex min-h-full flex-col',
            messages.length === 0
              ? 'justify-center'
              : underContract
                ? 'justify-start'
                : 'justify-end',
          )}
        >
          <MessageLog
            conversationId={conversationId}
            messages={messages}
            currentUserId={currentUserId}
            counterpartyName={displayName}
            counterpartyAvatarPath={otherAvatarPath}
            emptyHint="No messages yet. Say hello to start the conversation."
            shipment={shipment}
            saleContext={
              sale
                ? {
                    id: sale.id,
                    allowUnscopedLegacy: sale.contractCount === 1,
                    fromShopfront: sale.fromShopfront,
                    fulfillmentMethod: sale.fulfillmentMethod,
                  }
                : null
            }
            showAvatars
            showReadReceipt
          />
        </div>
      </div>

      {dock && !dock.underContract ? (
        <div
          className={cn('shrink-0 py-snug', MESSAGE_GUTTER)}
        >
          {/* Prose, so it keeps a measure even though the column no longer has one. */}
          <p className={cn(MESSAGE_COLUMN, MESSAGE_PROSE, 'text-meta text-muted-foreground')}>
            No contract yet — messages alone do not reserve goods or hold payment.
          </p>
        </div>
      ) : null}

      <MessageComposer
        conversationId={conversationId}
        inputId="message-composer"
        contentClassName={MESSAGE_COLUMN}
        optimistic={{
          currentUserId,
          add: addOptimistic,
          settle: settleOptimistic,
        }}
      />
    </section>
  );
}
