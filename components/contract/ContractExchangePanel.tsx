'use client';

// components/contract/ContractExchangePanel.tsx
//
// WHAT IS BEING EXCHANGED — one component for all three shapes a contract takes:
//
//   * Cash sale: one side (the item), money on the other.
//   * 2-way trade: goods ⇄ goods, either side possibly several items, plus a cash
//     leg in one direction.
//   * Private deal: prose + evidence photos per side, since deal items are not
//     catalog Items and carry no Fair_Market_Value.
//
// Each side owns its own edit control (`action`), which is the shape the trade room
// needs once composition becomes editable: the person who brings the goods is the
// person who can change them.

import type { ReactNode } from 'react';
import { ArrowLeftRight } from 'lucide-react';

import { formatAud } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ContractThumbnails } from './ContractImageLightbox';

/** One thing on a side of the exchange. */
export interface ContractExchangeItem {
  id: string;
  title: string;
  /** Condition, grade, or any short qualifier. */
  subtitle?: string | null;
  /** Fair_Market_Value or agreed price, in integer AUD cents. */
  valueCents?: number | null;
  /** Resolved image URLs for this item. */
  images?: string[];
}

/** One party's contribution to the exchange. */
export interface ContractExchangeSide {
  /** Relational heading, e.g. `You give` / `You receive` / `Being sold`. */
  heading: string;
  partyName?: string;
  items: ContractExchangeItem[];
  /** Prose contribution, for deals whose items are text rather than Items. */
  note?: string | null;
  /** Evidence photos not attached to a single item. */
  images?: string[];
  /** Cash this side pays, in integer AUD cents. */
  cashCents?: number | null;
  /** Override the cash line's copy. */
  cashLabel?: string;
  /** Edit control — only rendered for the side the viewer owns. */
  action?: ReactNode;
  /** Emphasise the viewer's own side. */
  isMine?: boolean;
  /** Copy shown when this side has nothing recorded. */
  emptyLabel?: string;
  /** Right-aligned status badge, e.g. "Needs evidence". */
  badge?: ReactNode;
}

function SideColumn({ side }: { side: ContractExchangeSide }) {
  const total = side.items.reduce((sum, item) => sum + (item.valueCents ?? 0), 0);
  const showTotal = side.items.length > 1 && total > 0;

  return (
    <article
      className={cn(
        'flex h-full min-w-0 flex-col gap-3 rounded-xl border bg-background p-3',
        side.isMine ? 'border-primary/35' : 'border-border',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            {side.heading}
          </p>
          {side.partyName ? (
            <p className="truncate text-sm font-medium">{side.partyName}</p>
          ) : null}
        </div>
        {side.badge ? <div className="shrink-0">{side.badge}</div> : null}
      </header>

      {side.items.length === 0 && !side.note ? (
        <p className="text-sm text-muted-foreground">
          {side.emptyLabel ?? 'Nothing recorded.'}
        </p>
      ) : null}

      {side.items.length > 0 ? (
        <ul className="space-y-2">
          {side.items.map((item) => (
            <li key={item.id} className="flex items-center gap-2.5">
              <ContractThumbnails
                images={item.images ?? []}
                label={item.title}
                size="sm"
                max={2}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.title}</p>
                {item.subtitle ? (
                  <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
                    {item.subtitle}
                  </p>
                ) : null}
              </div>
              {item.valueCents != null ? (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatAud(item.valueCents)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {showTotal ? (
        <p className="border-t pt-2 text-xs tabular-nums text-muted-foreground">
          {side.items.length} items · {formatAud(total)} total
        </p>
      ) : null}

      {side.note?.trim() ? (
        <p className="whitespace-pre-wrap break-words text-sm">{side.note}</p>
      ) : null}

      {side.images && side.images.length > 0 ? (
        <ContractThumbnails
          images={side.images}
          label={`${side.partyName ?? side.heading} evidence`}
        />
      ) : null}

      {side.cashCents != null && side.cashCents > 0 ? (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm font-medium tabular-nums">
          {side.cashLabel ?? `Plus ${formatAud(side.cashCents)} cash`}
        </p>
      ) : null}

      {side.action ? <div className="mt-auto pt-1">{side.action}</div> : null}
    </article>
  );
}

export interface ContractExchangePanelProps {
  /** One side for a sale, two for a trade or deal. */
  sides: ContractExchangeSide[];
  /** Footnote, e.g. that photos are a snapshot taken when the contract opened. */
  footnote?: ReactNode;
  className?: string;
}

/** What each party is putting into the contract. */
export function ContractExchangePanel({
  sides,
  footnote,
  className,
}: ContractExchangePanelProps) {
  const twoSided = sides.length === 2;

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col gap-3', className)}>
      <div
        className={cn(
          'min-h-0 flex-1',
          twoSided
            ? 'grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'
            : 'grid gap-3',
        )}
      >
        <SideColumn side={sides[0]} />
        {twoSided ? (
          <>
            <div className="flex items-center justify-center" aria-hidden>
              <span className="grid size-8 place-items-center rounded-full border bg-background text-primary shadow-sm">
                <ArrowLeftRight className="size-4 rotate-90 md:rotate-0" />
              </span>
            </div>
            <SideColumn side={sides[1]} />
          </>
        ) : null}
      </div>

      {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
    </div>
  );
}
