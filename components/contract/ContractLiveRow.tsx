'use client';

// components/contract/ContractLiveRow.tsx
//
// The active contract area in reading order: current action and lifecycle first,
// then details beside chat on desktop. Below `lg`, Details / Chat are tabs so
// the room is not a 48rem stacked scroll of two fixed panes.
//
// Children and conversation mount ONCE (F36). The Breakpoint utility selects
// the layout so DOM ids stay unique and realtime subscriptions aren't doubled.

import { useState, type ReactNode } from 'react';
import { MessageCircle, ScrollText } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { MobileOnly, DesktopOnly } from '@/components/layout/Breakpoint';
import { cn } from '@/lib/utils';

export interface ContractLiveRowProps {
  action: ReactNode;
  conversation: ReactNode;
  progress?: ReactNode;
  /** The contract's fixed-height `ContractDetailList` inspector. */
  children: ReactNode;
  className?: string;
}

type MobilePane = 'details' | 'chat';

/** Action and progress above the equal-height details/chat workspace. */
export function ContractLiveRow({
  action,
  conversation,
  progress,
  children,
  className,
}: ContractLiveRowProps) {
  const [pane, setPane] = useState<MobilePane>('details');

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-4', className)}>
      <Card className="shrink-0 overflow-hidden border-border/90 shadow-sm">
        <div className="[&>*]:rounded-none [&>*]:border-0 [&>*]:shadow-none">{action}</div>
        {progress ? (
          <div className="border-t border-border/80 bg-card px-4 py-3 sm:px-5">
            {progress}
          </div>
        ) : null}
      </Card>

      {/* Mobile: one pane at a time, thumb-friendly tab switch. */}
      <MobileOnly>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div
            role="tablist"
            aria-label="Contract workspace"
            className="grid grid-cols-2 gap-1 rounded-lg border border-border/80 bg-muted/40 p-1"
          >
            <button
              type="button"
              role="tab"
              id="contract-tab-details"
              aria-controls="contract-panel-details"
              aria-selected={pane === 'details'}
              onClick={() => setPane('details')}
              className={cn(
                'flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-md px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                pane === 'details'
                  ? 'bg-card font-semibold text-foreground shadow-sm'
                  : 'font-medium text-muted-foreground',
              )}
            >
              <ScrollText className="size-4 shrink-0" aria-hidden="true" />
              Details
            </button>
            <button
              type="button"
              role="tab"
              id="contract-tab-chat"
              aria-controls="contract-panel-chat"
              aria-selected={pane === 'chat'}
              onClick={() => setPane('chat')}
              className={cn(
                'flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-md px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                pane === 'chat'
                  ? 'bg-card font-semibold text-foreground shadow-sm'
                  : 'font-medium text-muted-foreground',
              )}
            >
              <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
              Chat
            </button>
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
          <div
            id="contract-panel-chat"
            role="tabpanel"
            aria-labelledby="contract-tab-chat"
            hidden={pane !== 'chat'}
            className={cn(
              'min-h-[min(28rem,60dvh)] min-w-0 flex-col [&>*]:h-full',
              pane === 'chat' ? 'flex' : 'hidden',
            )}
          >
            {conversation}
          </div>
        </div>
      </MobileOnly>

      {/* Desktop: persistent split inspector + conversation. The panes are
          bounded so they scroll internally rather than growing the page (F37).

          The height budget is declared ONCE, by the room root (CashSaleView /
          TradeContract), and this row takes what is left via `flex-1`. It must
          NOT re-declare `100dvh - chrome` here: the action card, the progress
          rail and the contract header are all siblings ABOVE this row, so
          claiming the whole content box would overflow the viewport by their
          combined height — which is exactly the bug that made the page scroll
          and left `h-full` children (the item image) resolving against an
          over-tall box. */}
      <DesktopOnly>
        <div className="min-h-0 flex-1 gap-4 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
          <div className="min-h-0 min-w-0 overflow-y-auto [&>*]:h-full">{children}</div>
          <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto [&>*]:h-full">
            {conversation}
          </div>
        </div>
      </DesktopOnly>
    </div>
  );
}
