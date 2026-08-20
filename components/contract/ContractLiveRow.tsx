'use client';

// components/contract/ContractLiveRow.tsx
//
// The active contract area: the details inspector beside the chat panel. The
// chat panel carries the current-step action bar internally (see
// ContractConversationPanel); the progress rail lives up in ContractHeader.
// This row is pure layout.
//
// Below `lg`, Details / Chat are tabs so the room is not a 48rem stacked
// scroll of two fixed panes. Chat is the default tab because it carries the
// action bar.
//
// Children and conversation mount ONCE (F36). The Breakpoint utility selects
// the layout so DOM ids stay unique and realtime subscriptions aren't doubled.

import { useState, type ReactNode } from 'react';
import { MessageCircle, ScrollText } from 'lucide-react';

import { MobileOnly, DesktopOnly } from '@/components/layout/Breakpoint';
import { cn } from '@/lib/utils';

export interface ContractLiveRowProps {
  /** The chat panel, usually `<ContractConversationPanel/>` with header actions. */
  conversation: ReactNode;
  /** The contract's fixed-height `ContractDetailList` inspector. */
  children: ReactNode;
  className?: string;
}

type MobilePane = 'details' | 'chat';

/** Equal-height details/chat workspace; the chat panel carries the live step. */
export function ContractLiveRow({
  conversation,
  children,
  className,
}: ContractLiveRowProps) {
  const [pane, setPane] = useState<MobilePane>('chat');

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-group', className)}>
      {/* Mobile: one pane at a time, thumb-friendly tab switch. */}
      <MobileOnly>
        <div className="flex min-h-0 flex-1 flex-col gap-cozy">
          <div
            role="tablist"
            aria-label="Contract workspace"
            className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1"
          >
            <button
              type="button"
              role="tab"
              id="contract-tab-chat"
              aria-controls="contract-panel-chat"
              aria-selected={pane === 'chat'}
              onClick={() => setPane('chat')}
              className={cn(
                'flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-md px-3 text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                pane === 'chat'
                  ? 'bg-card font-semibold text-foreground shadow-sm'
                  : 'font-medium text-muted-foreground',
              )}
            >
              <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
              Chat
            </button>
            <button
              type="button"
              role="tab"
              id="contract-tab-details"
              aria-controls="contract-panel-details"
              aria-selected={pane === 'details'}
              onClick={() => setPane('details')}
              className={cn(
                'flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-md px-3 text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                pane === 'details'
                  ? 'bg-card font-semibold text-foreground shadow-sm'
                  : 'font-medium text-muted-foreground',
              )}
            >
              <ScrollText className="size-4 shrink-0" aria-hidden="true" />
              Details
            </button>
          </div>

          <div
            id="contract-panel-chat"
            role="tabpanel"
            aria-labelledby="contract-tab-chat"
            hidden={pane !== 'chat'}
            className={cn(
              'min-h-[min(32rem,70dvh)] min-w-0 flex-col [&>*]:h-full',
              pane === 'chat' ? 'flex' : 'hidden',
            )}
          >
            {conversation}
          </div>
          <div
            id="contract-panel-details"
            role="tabpanel"
            aria-labelledby="contract-tab-details"
            hidden={pane !== 'details'}
            className={cn(
              'min-w-0',
              pane === 'details' ? 'block' : 'hidden',
            )}
          >
            {children}
          </div>
        </div>
      </MobileOnly>

      {/* Desktop: persistent split inspector + chat. The panes are bounded so
          they scroll internally rather than growing the page (F37).

          The height budget is declared ONCE, by the room root (CashSaleView /
          TradeContract), and this row takes what is left via `flex-1`. It must
          NOT re-declare `100dvh - chrome` here: the contract header is a
          sibling ABOVE this row, so claiming the whole content box would
          overflow the viewport by its height. */}
      <DesktopOnly>
        <div className="min-h-0 flex-1 gap-group lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)]">
          <div className="min-h-0 min-w-0 overflow-y-auto [&>*]:h-full">{children}</div>
          <div className="flex min-h-0 min-w-0 flex-col [&>*]:h-full">
            {conversation}
          </div>
        </div>
      </DesktopOnly>
    </div>
  );
}
