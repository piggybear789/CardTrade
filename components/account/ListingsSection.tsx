// components/account/ListingsSection.tsx
//
// The "My Listings" section: the caller's items across all statuses.
//
// A MANAGEMENT TABLE, NOT A SHOPPER'S GRID. This used to render the same
// `CatalogItemCard` tiles as the marketplace, which is the wrong instrument for the
// job. A tile spends most of its area on a photo its own owner already recognises, and
// has nowhere to put the four facts a seller actually comes here for — is it live, is
// anyone watching it, is it under contract, and what do I do about it. Rows carry all
// four, and the row that needs attention can be tinted and given its action inline.
//
// COLUMNS ARE DECLARED ONCE, ON `ROW_GRID`, and every row plus the header reads that
// same constant. This is the whole reason the table lines up: with a per-row flex
// layout each row sizes its own cells from its own content, so the price in row 1 lands
// at a different x than the price in row 2 and the eye has nothing to run down.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { PackagePlusIcon } from '@hugeicons/core-free-icons';

import { EmptyState } from '@/components/account/EmptyState';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Enums } from '@/lib/supabase/database.types';
import type { ItemRow } from '@/lib/actions/account';
import { StorageImage } from '@/components/ui/storage-image';
import { formatAud, formatRelativeTime, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Sort order so live listings surface first, contracted/sold items sink down. */
const STATUS_ORDER: Record<Enums<'item_status'>, number> = {
  AVAILABLE: 0,
  RESERVED: 1,
  SOLD: 2,
};

/**
 * THE ONE COLUMN DEFINITION. Header and rows both apply it, so they cannot drift.
 *
 * Three columns on a phone — thumbnail, everything, actions — because six will not fit
 * in 390px without truncating the title to uselessness. The middle cell absorbs price,
 * status and watch count as a sub-line at that width, and the three desktop-only cells
 * are `hidden`, which removes them from grid flow entirely so the template still
 * matches the number of visible cells.
 *
 * THE ACTIONS COLUMN IS A FIXED 4.5rem AND WAS `auto`, WHICH DEFEATED THE WHOLE POINT.
 * Each `li` is its own grid container, so an `auto` track sizes to THAT ROW's content —
 * and the last cell holds "Edit" on a live listing and "View" on a sold one. The two
 * words are different widths, so `auto` resolved differently per row, the `1fr` title
 * column absorbed the difference, and every column between them landed at a different
 * x depending on which button the row happened to carry. The header row, whose actions
 * cell is empty and therefore zero-wide, lined up with neither.
 *
 * A fixed track is the only thing that makes columns align across separate grids. It
 * fits both labels at `size="sm"`; anything wider belongs in a menu, not a third verb.
 */
const ROW_GRID =
  'grid grid-cols-[3rem_minmax(0,1fr)_4.5rem] items-center gap-cozy ' +
  'md:grid-cols-[3rem_minmax(0,1fr)_7rem_5rem_9rem_4.5rem]';

/** How a listing's state reads to its owner, and which tone carries it. */
function statusOf(item: ItemRow): { label: string; tone: BadgeProps['variant']; live: boolean } {
  // Staff moderation first: it overrides everything else the row could say, and it is
  // the only state the owner cannot fix themselves.
  if (item.hidden) return { label: 'Hidden', tone: 'destructive', live: false };
  if (item.closed_at) return { label: 'Closed', tone: 'secondary', live: false };
  if (item.status === 'SOLD') return { label: 'Sold', tone: 'trust', live: false };
  // Filled violet, matching "money is held" everywhere else: a reserved item has a live
  // contract and a buyer's payment behind it.
  if (item.status === 'RESERVED') return { label: 'Under contract', tone: 'default', live: false };
  // A binder is never reserved and never sold — it is open until it is closed — so it
  // says so rather than borrowing the single-item word.
  return {
    label: item.listing_kind === 'SHOPFRONT' ? 'Open' : 'Live',
    tone: 'outline',
    live: true,
  };
}

export function ListingsSection({ items }: { items: ItemRow[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<HugeiconsIcon icon={PackagePlusIcon} className="size-6" aria-hidden />}
        title="You haven't listed anything yet"
        description="List a collectible to start selling or trading on NoDitto."
        ctaLabel="List an item"
        ctaHref="/listings/new"
      />
    );
  }

  // Under-contract/sold items sink below still-available ones (Req 3.8 UX);
  // `items` arrives newest-first, and the sort is stable, so recency ordering
  // is preserved within each status group.
  const sorted = [...items].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );

  // DERIVED FROM `items` ALONE, deliberately. Offer counts and "waiting on you" would
  // both be more useful and both need another query per listing; these four are free.
  const live = items.filter(
    (i) => i.status === 'AVAILABLE' && !i.closed_at && !i.hidden,
  ).length;
  const underContract = items.filter((i) => i.status === 'RESERVED').length;
  const watching = items.reduce((sum, i) => sum + (i.watch_count ?? 0), 0);
  const sold = items.filter((i) => i.status === 'SOLD').length;

  return (
    <div className="space-y-group">
      <dl className="grid grid-cols-2 gap-snug sm:grid-cols-4 sm:gap-cozy">
        <Stat label="Live" value={live} />
        <Stat label="Under contract" value={underContract} />
        <Stat label="People watching" value={watching} />
        <Stat label="Sold" value={sold} />
      </dl>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* Column headings, desktop only. On a phone the cells they label are folded
            into the middle cell's sub-line, so a header row would name columns that are
            not there. */}
        <div
          className={cn(
            ROW_GRID,
            'hidden border-b border-border bg-muted px-group py-snug md:grid',
          )}
          aria-hidden="true"
        >
          <span />
          <span className="market-label text-muted-foreground">Listing</span>
          <span className="market-label text-right text-muted-foreground">Price</span>
          <span className="market-label text-center text-muted-foreground">Watching</span>
          <span className="market-label text-center text-muted-foreground">Status</span>
          <span />
        </div>

        <ul role="list" className="divide-y divide-border">
          {sorted.map((item) => {
            const status = statusOf(item);
            const isShopfront = item.listing_kind === 'SHOPFRONT';
            const listedAgo = formatRelativeTime(item.created_at);

            return (
              <li
                key={item.id}
                className={cn(
                  ROW_GRID,
                  'px-group py-cozy',
                  // A hidden listing is the one row the owner has to deal with, so it is
                  // the one row that gets a tint. Everything else stays quiet — tinting
                  // several states turns the table into a colour chart.
                  item.hidden && 'bg-destructive/[0.04]',
                  !item.hidden && item.status === 'SOLD' && 'opacity-75',
                )}
              >
                <RowThumb item={item} />

                <div className="min-w-0">
                  <Link
                    href={`/listings/${item.id}`}
                    transitionTypes={['nav-forward']}
                    className="block truncate rounded-sm border border-transparent text-body font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:border-iris"
                  >
                    {item.title}
                  </Link>
                  <p
                    className="mt-0.5 truncate text-meta text-muted-foreground"
                    suppressHydrationWarning
                  >
                    {[
                      item.category,
                      isShopfront ? 'Multiple items' : item.condition,
                      listedAgo ? `listed ${listedAgo}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {/* The three desktop columns, folded in below `md`.
                      A `div`, NOT a `p`. `Badge` renders a `<div>`, and a `<div>`
                      inside a `<p>` is invalid HTML: the parser closes the paragraph
                      early, so the server's tree and the client's disagree and React
                      throws "Hydration failed because the server rendered HTML didn't
                      match the client" and re-renders this whole subtree on the
                      client. It was invisible in a screenshot — the row looked right
                      — and only the console said so. */}
                  <div className="mt-tight flex flex-wrap items-center gap-x-cozy gap-y-tight text-meta md:hidden">
                    <span className="font-semibold tabular-nums">
                      {isShopfront ? 'from ' : ''}
                      {formatAud(item.fmv_cents)}
                    </span>
                    <Badge variant={status.tone}>
                      {status.live ? <LiveDot /> : null}
                      {status.label}
                    </Badge>
                    {item.watch_count > 0 ? (
                      <span className="tabular-nums text-muted-foreground">
                        {item.watch_count} watching
                      </span>
                    ) : null}
                  </div>
                  {item.hidden ? (
                    <p className="mt-tight text-meta text-destructive">
                      Hidden by NoDitto staff, so buyers cannot see it.
                    </p>
                  ) : null}
                </div>

                <span className="hidden text-right text-body font-semibold tabular-nums md:block">
                  {isShopfront ? (
                    <span className="mr-0.5 text-meta font-medium text-muted-foreground">
                      from
                    </span>
                  ) : null}
                  {formatAud(item.fmv_cents)}
                </span>

                <span className="hidden text-center text-body tabular-nums text-muted-foreground md:block">
                  {item.watch_count > 0 ? item.watch_count : '—'}
                </span>

                <span className="hidden justify-center md:flex">
                  <Badge variant={status.tone}>
                    {status.live ? <LiveDot /> : null}
                    {status.label}
                  </Badge>
                </span>

                <div className="flex shrink-0 items-center justify-end">
                  {/* One action per row, chosen by what the row can do. A sold or closed
                      listing is a record, not a thing to edit. */}
                  {item.status === 'SOLD' || item.closed_at ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/listings/${item.id}`}>View</Link>
                    </Button>
                  ) : (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/listings/${item.id}/edit`}>Edit</Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * A 48px cover for the row.
 *
 * Local rather than a shared component: `CatalogItemCard` is a whole clickable tile with
 * a hit area, a watch button and shared-element transitions, and none of that belongs in
 * a table cell whose row already links to the listing. `alt=""` because the title is
 * right beside it — announcing the photo would read the listing name twice.
 */
function RowThumb({ item }: { item: ItemRow }) {
  const url = itemImageUrl(item.image_paths?.[0] ?? null);

  return (
    <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted">
      {url ? (
        <StorageImage
          src={url}
          alt=""
          sizes="48px"
          className="object-cover"
          loading="lazy"
          draggable={false}
        />
      ) : (
        <span className="text-meta text-muted-foreground" aria-hidden="true">
          —
        </span>
      )}
    </span>
  );
}

/** A live listing carries a dot, so "Live" reads as a state rather than a label. */
function LiveDot() {
  return (
    <span
      className="mr-tight inline-block size-1.5 shrink-0 rounded-full bg-iris"
      aria-hidden="true"
    />
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-cozy py-snug">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-head font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
