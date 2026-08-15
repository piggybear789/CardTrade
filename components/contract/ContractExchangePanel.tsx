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
  /**
   * Platform fee this party owes, in integer AUD cents.
   *
   * Rendered BELOW the total, not inside it: the fee is not part of what is being
   * swapped, so folding it into the total would misstate the value of the side.
   */
  feeCents?: number | null;
  /** Override the fee line's copy. */
  feeLabel?: string;
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
  showcase = false,
  showTotal = false,
}: {
  side: ContractExchangeSide;
  compact: boolean;
  /**
   * Render the Total row.
   *
   * Decided by the PANEL, not by this column, so both ledgers gain or lose the row
   * together. Per-side it went ragged: a three-line side would total while a
   * one-line side opposite it did not, and the two columns of figures stopped
   * lining up — which is the one thing an accounting layout has to get right.
   */
  showTotal?: boolean;
  /**
   * Give the single item an image-left / details-right layout instead of a list
   * row. Set only for a one-sided, non-compact contract with exactly one item —
   * i.e. a cash sale in the full inspector, where the item IS the subject of the
   * panel and there is height to spend on it.
   */
  showcase?: boolean;
}) {
  // Cash is part of what this side GIVES, so it is a line in the ledger and it
  // counts towards the total — not a note floating beside it. Summing goods and
  // cash together is also what makes the swap legible: $1,110 of card plus $150 of
  // cash against $1,260 of card is only obviously fair when both columns add up.
  const goodsCents = side.items.reduce((sum, item) => sum + (item.valueCents ?? 0), 0);
  const cashCents = side.cashCents ?? 0;
  const total = goodsCents + cashCents;

  return (
    <div
      className={cn(
        'flex h-full w-full min-w-0 flex-col !rounded-none !border-0 !bg-transparent',
        compact ? 'gap-snug p-snug' : 'gap-cozy p-cozy',
      )}
    >
      <header className="flex min-w-0 items-center gap-snug">
        <div className="min-w-0 flex-1 truncate">
          <p className="truncate text-body font-medium">
            {side.partyName ?? side.heading}
          </p>
        </div>
        {side.badge ? <div className="shrink-0">{side.badge}</div> : null}
        {/* Unframed. The trust line used to be a bordered, shadowed, width-capped
            chip, which made it read as a second panel competing with the item rows
            beneath it — two nested containers where the section already provides
            one. Plain text beside the name sits in the same visual layer as
            everything else in the panel. */}
        {!compact && side.party ? (
          <ContractPartyStats party={side.party} className="shrink-0 text-right" />
        ) : null}
      </header>

      {/* Total leads, above the lines that make it up. What a reader wants from this
          column first is "what is this side worth" — the breakdown is the support
          for that answer, not the route to it. */}
      {showTotal && !compact && total > 0 ? (
        <div className="flex items-center gap-snug border-b pb-snug">
          <span className="size-10 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-body font-medium">Total</p>
          <span className="shrink-0 text-body font-semibold tabular-nums">
            {formatAud(total)}
          </span>
        </div>
      ) : null}

      {side.items.length === 0 && !side.note ? (
        <p className={cn('text-muted-foreground', compact ? 'text-meta' : 'text-body')}>
          {side.emptyLabel ?? 'Nothing recorded.'}
        </p>
      ) : null}

      {side.items.length > 0 ? (
        showcase ? (
          /* SHOWCASE LAYOUT — one side, one item, full inspector height available.
             Mirrors the listing detail page: artwork left, facts right. The row
             layout below is right for a trade (two sides, possibly several items
             each) but wrong here, because it rendered the item under contract as a
             list row with the smallest element on the panel given to the photo,
             while the card stretched to full height and left most of itself empty. */
          <div className="flex min-h-0 flex-1 items-center">
            <div className="mx-auto grid w-full max-w-2xl gap-group sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-center">
              <ContractThumbnails
                images={side.items[0].images ?? []}
                label={side.items[0].title}
                layout="stacked"
              />
              <div className="min-w-0 space-y-1">
                <p className="text-balance text-lead font-semibold leading-snug">
                  {side.items[0].title}
                </p>
                {side.items[0].subtitle ? (
                  <p className="text-meta uppercase tracking-wide text-muted-foreground">
                    {side.items[0].subtitle}
                  </p>
                ) : null}
                {side.items[0].valueCents != null ? (
                  <p className="pt-1 text-subhead font-semibold tabular-nums">
                    {formatAud(side.items[0].valueCents)}
                  </p>
                ) : null}
                {/* The description belongs in THIS column, beside the artwork, not in
                    a full-width band under it. Rendered here rather than by the shared
                    note block below — a two-column layout whose second column stops
                    after the price, with the prose spanning underneath, is not a
                    two-column layout; it just makes the image look stranded. */}
                {side.note?.trim() ? (
                  <p className="whitespace-pre-wrap break-words pt-snug text-body">
                    {side.note}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <ul className={cn(compact ? 'space-y-tight' : 'space-y-snug')}>
            {side.items.map((item) => (
              <li key={item.id} className="flex items-center gap-snug">
                <ContractThumbnails
                  images={item.images ?? []}
                  label={item.title}
                  size="sm"
                  max={compact ? 1 : 2}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">{item.title}</p>
                  {!compact && item.subtitle ? (
                    <p className="truncate text-meta uppercase tracking-wide text-muted-foreground">
                      {item.subtitle}
                    </p>
                  ) : null}
                </div>
                {!compact && item.valueCents != null ? (
                  <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                    {formatAud(item.valueCents)}
                  </span>
                ) : null}
              </li>
            ))}

            {/* Cash as a ledger line, aligned to the item rows above it. The
                thumbnail column is held open with a spacer so the titles and the
                amounts stay on the same two axes — an amount that does not line up
                with the amounts above it reads as a different kind of fact. */}
            {!compact && cashCents > 0 ? (
              <li className="flex items-center gap-snug">
                <span className="size-10 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">
                    {side.cashLabel ?? 'Cash'}
                  </p>
                </div>
                <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                  {formatAud(cashCents)}
                </span>
              </li>
            ) : null}
          </ul>
        )
      ) : null}



      {/* `!showcase`: the showcase layout renders the note inside its details
          column instead, so rendering it here too would duplicate it. */}
      {!showcase && side.note?.trim() ? (
        <p
          className={cn(
            'break-words text-body',
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

      {/* The cash line lives up in the ledger with the items and is not repeated
          here: a side that gives goods and cash has one column of figures that adds
          up, not a list plus a detached banner.

          The FEE is different, and sits outside the ledger on purpose. It is not
          part of the exchange — it is what the platform charges for running it — so
          including it in the total would overstate what this side is worth. */}
      {!compact && (side.feeCents ?? 0) > 0 ? (
        <div className="flex items-center gap-snug text-meta text-muted-foreground">
          <span className="size-10 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{side.feeLabel ?? 'NoDitto fee'}</p>
          <span className="shrink-0 tabular-nums">{formatAud(side.feeCents!)}</span>
        </div>
      ) : null}

      {!compact && side.action ? (
        <div className="mt-auto pt-1">{side.action}</div>
      ) : null}
    </div>
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
  // Narrow on purpose. A trade needs the `1fr auto 1fr` swap layout, and a deal's
  // items are prose plus evidence photos rather than one catalog Item, so neither
  // wants the showcase treatment.
  const showcase = !compact && !twoSided && sides[0]?.items.length === 1;

  // The Total row appears only when there is something to add up — i.e. when some
  // side contributes more than one line (goods, or goods plus cash). A single item
  // against a single item needs no total: the figure would just restate the row
  // above it. Evaluated across BOTH sides so the two ledgers stay symmetric.
  const showTotals = sides.some(
    (side) => side.items.length + ((side.cashCents ?? 0) > 0 ? 1 : 0) > 1,
  );

  return (
    <div
      className={cn(
        'flex w-full flex-col',
        // The inspector owns the full available height. The content fills it without
        // manufacturing a second card surface inside the selected tab.
        compact ? 'gap-cozy' : 'h-full min-h-0 flex-1 gap-cozy',
        compact && 'gap-snug',
        className,
      )}
    >
      <div
        className={cn(
          compact ? null : 'min-h-0 flex-1',
          twoSided
            ? cn(
                'grid items-stretch md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
                compact ? 'gap-snug' : 'gap-cozy',
              )
            : cn('grid', compact ? 'gap-snug' : 'gap-cozy'),
        )}
      >
        <SideColumn
          side={sides[0]}
          compact={compact}
          showcase={showcase}
          showTotal={showTotals}
        />
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
            <SideColumn side={sides[1]} compact={compact} showTotal={showTotals} />
          </>
        ) : null}
      </div>

      {!compact && footnote ? (
        <p className="text-meta text-muted-foreground">{footnote}</p>
      ) : null}
    </div>
  );
}
