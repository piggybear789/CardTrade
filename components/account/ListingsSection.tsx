// components/account/ListingsSection.tsx
//
// The "My Listings" section: the caller's items across all statuses.
//
// A MANAGEMENT TABLE, NOT A SHOPPER'S GRID. This used to render the same
// `CatalogItemCard` tiles as the marketplace, which is the wrong instrument for the
// job. A tile spends most of its area on a photo its own owner already recognises, and
// has nowhere to put the facts a seller actually comes here for — is it live, is
// anyone watching it, what is the best offer, and what do I do about it.
//
// COLUMNS ARE DECLARED ONCE, ON `ROW_GRID`, and every row plus the header reads that
// same constant. This is the whole reason the table lines up: with a per-row flex
// layout each row sizes its own cells from its own content, so the price in row 1 lands
// at a different x than the price in row 2 and the eye has nothing to run down.
//
// A FILTER, NOT A SCOREBOARD. The top of this page was four stat cards ("Live 0,
// Under contract 0, People watching 0, Sold 0") that counted the list without letting
// you act on the count — and read 0 across the board above three hidden rows. The
// counts now live on URL tabs that filter the table, the same strip every other hub
// uses, so "Hidden 3" is a place you can go.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { PackagePlusIcon } from '@hugeicons/core-free-icons';

import { EmptyState } from '@/components/account/EmptyState';
import { ListingRowMenu } from '@/components/account/ListingRowMenu';
import { SectionTabs } from '@/components/layout/SectionFilter';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState as SharedEmptyState } from '@/components/ui/empty-state';
import type { Enums } from '@/lib/supabase/database.types';
import type { ItemRow } from '@/lib/actions/account';
import { StorageImage } from '@/components/ui/storage-image';
import { formatMoney, formatRelativeTime, itemImageUrl } from '@/lib/format';
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
 * Three columns on a phone — thumbnail, everything, actions — because seven will not
 * fit in 390px without truncating the title to uselessness. The middle cell absorbs
 * price, status and watch count as a sub-line at that width, and the desktop-only
 * cells are `hidden`, which removes them from grid flow so the template still matches
 * the number of visible cells.
 *
 * THE ACTIONS COLUMN IS FIXED, because each `li` is its own grid container: an `auto`
 * track sizes to THAT ROW's content, so rows carrying "Edit" and "View" put every
 * column between at a different x. It holds one `sm` button and the 32px "⋯".
 */
export const ROW_GRID =
  'grid grid-cols-[3rem_minmax(0,1fr)_5.75rem] items-center gap-cozy ' +
  'md:grid-cols-[3rem_minmax(0,1fr)_7rem_7rem_5rem_9rem_5.75rem]';

/** The tab a row belongs to. `all` is every row. */
export type ListingScope = 'all' | 'live' | 'contract' | 'sold' | 'hidden' | 'closed';

const SCOPES: readonly ListingScope[] = ['all', 'live', 'contract', 'sold', 'hidden', 'closed'];

/** Read `?show=` into a scope, falling back to every listing. */
export function resolveListingScope(value: string | string[] | undefined): ListingScope {
  const raw = Array.isArray(value) ? value[0] : value;
  return SCOPES.includes(raw as ListingScope) ? (raw as ListingScope) : 'all';
}

function scopeOf(item: ItemRow): Exclude<ListingScope, 'all'> {
  if (item.hidden) return 'hidden';
  if (item.closed_at) return 'closed';
  if (item.status === 'SOLD') return 'sold';
  if (item.status === 'RESERVED') return 'contract';
  return 'live';
}

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

export function ListingsSection({
  items,
  scope = 'all',
  topOfferByItem = {},
}: {
  items: ItemRow[];
  scope?: ListingScope;
  /** The best pending offer per listing, in the listing's own minor units. */
  topOfferByItem?: Record<string, number>;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<HugeiconsIcon icon={PackagePlusIcon} className="size-6" aria-hidden />}
        title="You haven't listed anything yet"
        description="List a collectible to start selling or trading on NoDitto."
        ctaLabel="Sell an item"
        ctaHref="/listings/new"
      />
    );
  }

  const counts: Record<ListingScope, number> = {
    all: items.length,
    live: 0,
    contract: 0,
    sold: 0,
    hidden: 0,
    closed: 0,
  };
  for (const item of items) counts[scopeOf(item)] += 1;

  // Under-contract/sold items sink below still-available ones (Req 3.8 UX);
  // `items` arrives newest-first, and the sort is stable, so recency ordering
  // is preserved within each status group.
  const visible = [...items]
    .filter((item) => scope === 'all' || scopeOf(item) === scope)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const href = (key: ListingScope) => (key === 'all' ? '/listings/mine' : `/listings/mine?show=${key}`);
  // Hidden and Closed are exceptions, so their tabs appear only when there is
  // something in them; the everyday four are always there.
  const tabs = (
    [
      { key: 'all', label: 'All' },
      { key: 'live', label: 'Live' },
      { key: 'contract', label: 'Under contract', shortLabel: 'Contract' },
      { key: 'sold', label: 'Sold' },
      { key: 'hidden', label: 'Hidden' },
      { key: 'closed', label: 'Closed' },
    ] as const
  )
    .filter((tab) => (tab.key === 'hidden' || tab.key === 'closed' ? counts[tab.key] > 0 : true))
    .map((tab) => ({ ...tab, count: counts[tab.key], href: href(tab.key) }));

  return (
    <div>
      <SectionTabs label="Filter listings" currentKey={scope} tabs={tabs} />

      {visible.length === 0 ? (
        <SharedEmptyState
          icon={<HugeiconsIcon icon={PackagePlusIcon} className="size-6" aria-hidden />}
          title="Nothing here"
          description="No listings are in this state right now."
          action={{ label: 'Show all listings', href: '/listings/mine', variant: 'outline' }}
          compact
          fill
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {/* Column headings, desktop only. On a phone the cells they label are folded
              into the middle cell's sub-line, so a header row would name columns that
              are not there. */}
          <div
            className={cn(ROW_GRID, 'hidden border-b border-border bg-muted px-group py-snug md:grid')}
            aria-hidden="true"
          >
            <span />
            <span className="market-label text-muted-foreground">Listing</span>
            <span className="market-label text-right text-muted-foreground">Price</span>
            <span className="market-label text-right text-muted-foreground">Top offer</span>
            <span className="market-label text-center text-muted-foreground">Watching</span>
            <span className="market-label text-center text-muted-foreground">Status</span>
            <span />
          </div>

          <ul role="list" className="divide-y divide-border">
            {visible.map((item) => {
              const status = statusOf(item);
              const isShopfront = item.listing_kind === 'SHOPFRONT';
              const listedAgo = formatRelativeTime(item.created_at);
              const money = (cents: number) => formatMoney(cents, item.currency);
              const topOffer = topOfferByItem[item.id];
              const editable = !(item.status === 'SOLD' || item.closed_at);

              return (
                <li
                  key={item.id}
                  className={cn(
                    ROW_GRID,
                    'px-group py-cozy',
                    // ONE SIGNAL FOR A HIDDEN ROW: its badge. It also carried a pink
                    // tint and red helper text, so three hidden rows turned the table
                    // into an alarm; the reason now reads as plain muted text.
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
                    <p className="mt-0.5 truncate text-meta text-muted-foreground" suppressHydrationWarning>
                      {item.hidden
                        ? 'Hidden by NoDitto staff, so buyers cannot see it.'
                        : [
                            item.category,
                            isShopfront ? 'Multiple items' : item.condition,
                            listedAgo ? `listed ${listedAgo}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </p>
                    {/* The desktop columns, folded in below `md`. A `div`, NOT a `p`:
                        `Badge` renders a `<div>`, which is invalid inside a `<p>`. One
                        line, never wrapped, so rows are one height. */}
                    <div className="mt-tight flex flex-nowrap items-center gap-x-cozy overflow-hidden text-meta md:hidden">
                      <span className="shrink-0 font-semibold tabular-nums">
                        {isShopfront ? 'from ' : ''}
                        {money(item.fmv_cents)}
                      </span>
                      <Badge variant={status.tone} className="shrink-0">
                        {status.live ? <LiveDot /> : null}
                        {status.label}
                      </Badge>
                      {topOffer != null ? (
                        <span className="min-w-0 truncate tabular-nums text-foreground">
                          Offer {money(topOffer)}
                        </span>
                      ) : item.watch_count > 0 ? (
                        <span className="min-w-0 truncate tabular-nums text-muted-foreground">
                          {item.watch_count} watching
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <span className="hidden text-right text-body font-semibold tabular-nums md:block">
                    {isShopfront ? (
                      <span className="mr-0.5 text-meta font-medium text-muted-foreground">from</span>
                    ) : null}
                    {money(item.fmv_cents)}
                  </span>

                  <span className="hidden text-right text-body tabular-nums md:block">
                    {topOffer != null ? (
                      <Link href="/offers" className="font-medium underline-offset-4 hover:underline">
                        {money(topOffer)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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

                  <div className="flex shrink-0 items-center justify-end gap-tight">
                    {/* One visible verb, chosen by what the row can do; the rest are in
                        the "⋯". A sold or closed listing is a record, not a thing to edit. */}
                    {editable ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/listings/${item.id}/edit`}>Edit</Link>
                      </Button>
                    ) : (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/listings/${item.id}`}>View</Link>
                      </Button>
                    )}
                    <ListingRowMenu itemId={item.id} itemTitle={item.title} editable={editable} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
