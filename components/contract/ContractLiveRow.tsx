'use client';

// components/contract/ContractLiveRow.tsx
//
// The active contract area: the details inspector beside the chat panel. The
// chat panel carries the current-step action bar internally (see
// ContractConversationPanel); the progress rail lives up in ContractHeader.
// This row is pure layout.
//
// Below the split the room IS the conversation — a full-height thread, the way
// the inbox renders one — and the details open over it in a sheet from the
// subject line in `ContractChatBar`. It used to be a Chat / Details tab pair,
// which spent 52px of a phone viewport permanently to offer a mode the reader
// was in 90% of the time, and stacked the room's own summary card above it
// saying the same title, price and counterparty the chat bar already said.
//
// Children and conversation mount ONCE (F36). `useContractSplit` selects the
// layout so DOM ids stay unique and realtime subscriptions aren't doubled; in
// the thread the details additionally mount only while the sheet is open.

import type { ReactNode } from 'react';

import { useContractFocus } from '@/components/contract/ContractFocus';
import { useContractSplit } from '@/components/contract/useContractSplit';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface ContractLiveRowProps {
  /** The chat panel, usually `<ContractConversationPanel/>` with header actions. */
  conversation: ReactNode;
  /** The contract's fixed-height `ContractDetailList` inspector. */
  children: ReactNode;
  /** Sheet heading below `md` — the contract's own title. */
  detailsTitle?: string;
  /** Status and money for the sheet heading, beside the title. */
  detailsMeta?: ReactNode;
  className?: string;
}

/** Equal-height details/chat workspace; the chat panel carries the live step. */
export function ContractLiveRow({
  conversation,
  children,
  detailsTitle = 'Contract details',
  detailsMeta,
  className,
}: ContractLiveRowProps) {
  const { detailsOpen, closeDetails } = useContractFocus();
  const split = useContractSplit();

  if (split) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col gap-group', className)}>
        {/* Persistent split inspector + chat. The panes are bounded so they
            scroll internally rather than growing the page (F37).

            The height budget is declared ONCE, by the room root (CashSaleView /
            TradeContract), and this row takes what is left via `flex-1`. It must
            NOT re-declare `100dvh - chrome` here: the contract header is a
            sibling ABOVE this row, so claiming the whole content box would
            overflow the viewport by its height. */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)] gap-group">
          <div className="min-h-0 min-w-0 overflow-y-auto [&>*]:h-full">
            {children}
          </div>
          <div className="flex min-h-0 min-w-0 flex-col [&>*]:h-full">
            {conversation}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-group', className)}>
      {/* The thread fills the room; details arrive over it. */}
      <div className="flex min-h-0 flex-1 flex-col [&>*]:h-full">
        {conversation}
      </div>

      <Sheet
        open={detailsOpen}
        onOpenChange={(open) => {
          if (!open) closeDetails();
        }}
      >
        {/* Docked above the hub bar rather than over it, matching
            MobileBottomNav's own sheets — the bar stays reachable, so
            leaving the contract never needs the sheet dismissed first. */}
        {/* A definite height, not a `max-h`: this is a seven-tab inspector, and
            sizing it to the shortest panel opened a 178px sliver whose tab
            strip then jumped as the reader moved between tabs. Fixed height,
            panel scrolls inside. */}
        {/* NO ✕. It sat on top of a title that already truncates, so a long
            contract name ran under it — and the backdrop above the sheet is
            tappable, which is how a docked sheet is dismissed anyway.

            WHERE IT MEETS THE HUB BAR. Two white surfaces stack here, so exactly
            one line has to separate them and it has to be crisp. Both previous
            attempts failed in opposite directions: the sheet's all-round
            `shadow-lg` bled down over the bar and smeared the bar's own 1px
            border into a soft grey band, and removing the 1px offset so the
            sheet covered that border left no boundary at all — the tab content
            simply ran into the navigation.

            So: sit one pixel clear of the bar and let ITS border do the
            separating. The downward shadow is gone at the source — see the
            `bottom` variant in `ui/sheet`. */}
        <SheetContent
          side="bottom"
          hideClose
          overlayClassName="inset-x-0 top-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))]"
          className="bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] flex h-[min(80dvh,calc(100dvh-env(safe-area-inset-top)-7rem))] max-h-none flex-col gap-0 rounded-t-2xl border-border bg-card p-0 pb-0"
        >
          {/* `pr-group`, overriding SheetHeader's `pr-12`: that inset exists to
              keep the title clear of the ✕, which this sheet does not have. */}
          <SheetHeader className="shrink-0 border-b border-border px-group py-cozy pr-group">
            <SheetTitle className="truncate text-lead">{detailsTitle}</SheetTitle>
            {detailsMeta ? (
              <div className="flex flex-wrap items-center gap-cozy text-body text-muted-foreground">
                {detailsMeta}
              </div>
            ) : null}
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
