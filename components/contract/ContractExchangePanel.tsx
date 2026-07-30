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
//
// Pass `compact` for denser summary surfaces (tighter padding, truncated notes,
// fewer thumbs, no footnote).

import type { ReactNode } from 'react';
import { ArrowLeftRight } from 'lucide-react';

import { formatAud } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ContractPartyStats } from './ContractPartyLine';
import { ContractThumbnails } from './ContractImageLightbox';
import type { ContractParty } from './types';

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
  /** Trust stats (feedback, sales, collateral) shown under the party name. */
  party?: ContractParty | null;
}

function SideColumn({
  side,
  compact,
}: {
  side: ContractExchangeSide;
  compact: boolean;
}) {
  const total = side.items.reduce((sum, item) => sum + (item.valueCents ?? 0), 0);
  const showTotal = !compact && side.items.length > 1 && total > 0;

  return (
    <article
      className={cn(
        'flex h-full min-w-0 flex-col rounded-xl border border-border bg-background',
        compact ? 'gap-2 p-2.5' : 'gap-3 p-3',
      )}
    >
      <header className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 truncate">
          <p className="truncate text-sm font-medium">
            {side.partyName ?? side.heading}
          </p>
        </div>
        {side.badge ? <div className="shrink-0">{side.badge}</div> : null}
        {!compact && side.party ? (
          <ContractPartyStats party={side.party} framed className="shrink-0" />
        ) : null}
      </header>

      {side.items.length === 0 && !side.note ? (
        <p className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          {side.emptyLabel ?? 'Nothing recorded.'}
        </p>
      ) : null}

      {side.items.length > 0 ? (
        <ul className={cn(compact ? 'space-y-1.5' : 'space-y-2')}>
          {side.items.map((item) => (
            <li key={item.id} className="flex items-center gap-2.5">
              <ContractThumbnails
                images={item.images ?? []}
                label={item.title}
                size="sm"
                max={compact ? 1 : 2}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.title}</p>
                {!compact && item.subtitle ? (
                  <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
                    {item.subtitle}
                  </p>
                ) : null}
              </div>
              {!compact && item.valueCents != null ? (
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
        <p
          className={cn(
            'break-words text-sm',
            compact ? 'line-clamp-2' : 'whitespace-pre-wrap',
          )}
        >
          {side.note}
        </p>
      ) : null}

      {side.images && side.images.length > 0 ? (
        <ContractThumbnails
          images={side.images}
          label={`${side.partyName ?? side.heading} evidence`}
          max={compact ? 3 : undefined}
          size={compact ? 'sm' : undefined}
        />
      ) : null}

      {!compact && side.cashCents != null && side.cashCents > 0 ? (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm font-medium tabular-nums">
          {side.cashLabel ?? `Plus ${formatAud(side.cashCents)} cash`}
        </p>
      ) : null}

      {!compact && side.action ? (
        <div className="mt-auto pt-1">{side.action}</div>
      ) : null}
    </article>
  );
}

export interface ContractExchangePanelProps {
  /** One side for a sale, two for a trade or deal. */
  sides: ContractExchangeSide[];
  /** Footnote, e.g. that photos are a snapshot taken when the contract opened. */
  footnote?: ReactNode;
  /** Denser layout for summary surfaces. */
  compact?: boolean;
  className?: string;
}

/** What each party is putting into the contract. */
export function ContractExchangePanel({
  sides,
  footnote,
  compact = false,
  className,
}: ContractExchangePanelProps) {
  const twoSided = sides.length === 2;

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col',
        compact ? 'gap-2' : 'gap-3',
        className,
      )}
    >
      <div
        className={cn(
          'min-h-0 flex-1',
          twoSided
            ? cn(
                'grid items-stretch md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
                compact ? 'gap-2' : 'gap-3',
              )
            : cn('grid', compact ? 'gap-2' : 'gap-3'),
        )}
      >
        <SideColumn side={sides[0]} compact={compact} />
        {twoSided ? (
          <>
            <div className="flex items-center justify-center" aria-hidden>
              <span
                className={cn(
                  'grid place-items-center rounded-full border bg-background text-primary shadow-sm',
                  compact ? 'size-7' : 'size-8',
                )}
              >
                <ArrowLeftRight
                  className={cn(
                    'rotate-90 md:rotate-0',
                    compact ? 'size-3.5' : 'size-4',
                  )}
                />
              </span>
            </div>
            <SideColumn side={sides[1]} compact={compact} />
          </>
        ) : null}
      </div>

      {!compact && footnote ? (
        <p className="text-xs text-muted-foreground">{footnote}</p>
      ) : null}
    </div>
  );
}
