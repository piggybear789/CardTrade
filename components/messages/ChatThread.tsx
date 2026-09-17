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
import { CASH_SALE_STATUS_MAP } from '@/components/sales/CashSaleStatusBadge';
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

  const status = sale
    ? sale.activeContractCount > 1
      ? `${sale.activeContractCount} active contracts`
      : (CASH_SALE_STATUS_MAP[sale.status]?.label ?? null)
    : item?.status && item.status !== 'AVAILABLE'
      ? item.status.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
      : null;
  const offline = connectionStatus === 'error';
  const meta = [status, subject ? displayName : null].filter(Boolean).join(' · ');

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
          className="-ml-1.5 inline-flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-full border border-transparent text-foreground transition-colors hover:bg-foreground/5 focus:outline-none focus-visible:border-iris md:hidden"
          aria-label="Back to messages"
        >
          <HugeiconsIcon
            icon={ChevronLeftIcon}
            className="size-6"
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
          <h2
            title={title}
            className="line-clamp-2 text-lead font-semibold leading-tight tracking-tight md:truncate"
          >
            {title}
          </h2>
          <p className="min-h-[1.1rem] truncate text-body leading-tight text-muted-foreground">
            {price ? (
              <span className="display-value font-semibold text-foreground">
                {price}
              </span>
            ) : null}
            {meta ? `${price ? ' · ' : ''}${meta}` : null}
            {offline ? (
              <span className="text-destructive" role="status">
                {price || meta ? ' · ' : ''}Offline
              </span>
            ) : null}
          </p>
        </div>

        {dock ? (
          <Button asChild size="sm" className="h-11 shrink-0 px-3 md:h-7 md:px-2">
            <Link href={dock.href} transitionTypes={['nav-forward']}>
              {dock.label}
            </Link>
          </Button>
        ) : null}
      </header>

      <div
        ref={logRef}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 pt-5',
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
          className={cn('shrink-0 py-2', MESSAGE_GUTTER)}
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
