import type { ReactNode } from 'react';
import { ViewTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BadgeX, ImageOff, Lock, Star } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WatchButton } from '@/components/listings/WatchButton';
import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { Avatar } from '@/components/ui/avatar';
import { formatAud, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CatalogItem } from '@/lib/actions/listings';

export interface ItemCardProps {
  item: CatalogItem;
  /**
   * Server-computed save state for the current user. When provided (and the
   * viewer is not the owner), a save glyph sits on the price row. Omit to
   * hide the affordance (e.g. unauthenticated viewers or the item's owner).
   */
  initialWatching?: boolean;
}

/** Human-readable label for a non-AVAILABLE item, shown as an overlay badge. */
const UNAVAILABLE_LABEL: Record<string, string> = {
  RESERVED: 'Under Contract',
  SOLD: 'Sold',
};

function unavailableLabelFor(item: CatalogItem): string | undefined {
  // A shopfront is never RESERVED or SOLD (0064), so the overlay can never
  // apply — and its price is an indicative "from", not an asking price.
  if (item.listing_kind === 'SHOPFRONT') return undefined;
  return UNAVAILABLE_LABEL[item.status];
}

/**
 * Compact browse tile for the marketplace grid and My Listings.
 * Scan-first: mosaic photo, two-line description, price as the loudest mark.
 */
export function CatalogItemCard({ item, initialWatching }: ItemCardProps) {
  const unavailableLabel = unavailableLabelFor(item);

  return (
    <Card
      className={cn(
        'group relative flex h-full min-w-0 flex-col border-0 bg-transparent shadow-none [content-visibility:auto] [contain-intrinsic-size:auto_22rem]',
        unavailableLabel && 'opacity-70',
      )}
    >
      <ItemCardHitArea item={item} label={`View ${item.title}`} />
      <ItemCardStage
        item={item}
        unavailableLabel={unavailableLabel}
        className="aspect-[5/6] overflow-hidden rounded-xl border border-white/10 shadow-market transition-[shadow,transform] duration-150 group-hover:shadow-auction group-active:scale-[0.98]"
        washClassName="bg-[radial-gradient(ellipse_at_50%_-12%,rgba(255,255,255,0.09),transparent_52%)]"
        imageClassName="drop-shadow-[0_12px_24px_rgba(0,0,0,0.5)]"
        emptyIconClassName="size-9"
        badgeClassName="px-snug py-1 text-meta"
      />
      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col pt-snug">
        {/* Sizes come off the scale (`text-body` / `text-subhead` / `text-meta`)
            rather than one-off bracket values. Metadata was 10px here, rising to
            11px at `sm` — under the ~12px floor where text stops being comfortable,
            on the densest grid in the app, for the seller name a buyer scans before
            clicking. Contrast was never the problem; size was.

            The proportions follow the reference marketplace: an unemphasised
            two-line description, then the PRICE as the loudest thing in the tile,
            then quiet grey chrome. The title is deliberately `font-normal` — when
            the title and the price are both bold, the tile has no focal point. */}
        <ItemCardTitle item={item} />
        <ItemCardPriceRow item={item} initialWatching={initialWatching} />
        <ItemCardSellerRow
          seller={item.seller}
          leading={
            item.seller ? (
              <Avatar
                avatarPath={item.seller.avatarPath}
                displayName={item.seller.displayName}
                size="xs"
              />
            ) : null
          }
        />
      </div>
    </Card>
  );
}

/**
 * Richer auction-card treatment for carousels, watchlists, and seller profiles.
 */
export function ItemCard({ item, initialWatching }: ItemCardProps) {
  const unavailableLabel = unavailableLabelFor(item);

  return (
    <Card
      className={cn(
        'group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border-border p-0 transition-[border-color,box-shadow] duration-150 hover:border-gold/50 hover:shadow-auction',
        unavailableLabel && 'opacity-70',
      )}
    >
      <ItemCardHitArea item={item} label={item.title} />
      <ItemCardStage
        item={item}
        unavailableLabel={unavailableLabel}
        className="aspect-[4/5] w-full overflow-hidden"
        washClassName="bg-[radial-gradient(ellipse_at_50%_-12%,rgba(255,255,255,0.08),transparent_52%)]"
        imageClassName="drop-shadow-[0_14px_28px_rgba(0,0,0,0.58)]"
        emptyIconClassName="size-10"
      />
      <div className="pointer-events-none relative flex flex-1 flex-col px-group pb-group pt-cozy">
        <ItemCardTitle item={item} />
        <ItemCardPriceRow item={item} initialWatching={initialWatching} />
        <ItemCardSellerRow seller={item.seller} />
      </div>
    </Card>
  );
}

function ItemCardHitArea({ item, label }: { item: CatalogItem; label: string }) {
  return (
    <Link
      href={`/listings/${item.id}`}
      transitionTypes={['nav-forward']}
      className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="sr-only">{label}</span>
    </Link>
  );
}

function ItemCardStage({
  item,
  unavailableLabel,
  className,
  washClassName,
  imageClassName,
  emptyIconClassName,
  badgeClassName,
}: {
  item: CatalogItem;
  unavailableLabel?: string;
  className: string;
  washClassName: string;
  imageClassName: string;
  emptyIconClassName: string;
  badgeClassName?: string;
}) {
  const imageUrl = itemImageUrl(item.image_paths?.[0] ?? null);

  return (
    <div className={cn('auction-stage pointer-events-none relative p-[7%]', className)}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 z-0 h-full w-full scale-110 object-cover blur-lg opacity-90"
          loading="lazy"
        />
      ) : null}
      <div className={cn('absolute inset-0 z-[1]', washClassName)} aria-hidden="true" />
      {imageUrl ? (
        <ViewTransition
          name={`listing-image-${item.id}`}
          share="morph"
          default="none"
        >
          <div className={cn(
            'relative z-10 h-full w-full',
            unavailableLabel && 'grayscale-[35%]',
          )}>
            <Image
              src={imageUrl}
              alt={item.title}
              fill
              sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw"
              className={cn('object-contain', imageClassName)}
              loading="lazy"
            />
          </div>
        </ViewTransition>
      ) : (
        <div className="relative z-10 flex h-full w-full items-center justify-center text-parchment/45">
          <ImageOff className={emptyIconClassName} aria-hidden="true" />
          <span className="sr-only">No image available</span>
        </div>
      )}
      {unavailableLabel ? (
        <span className="absolute inset-0 z-20 flex items-center justify-center bg-obsidian/45">
          <Badge
            variant="secondary"
            className={cn(
              'gap-1 border-white/20 bg-obsidian/75 text-parchment shadow-sm backdrop-blur hover:bg-obsidian/75',
              badgeClassName,
            )}
          >
            <Lock className="size-3" aria-hidden="true" />
            {unavailableLabel}
          </Badge>
        </span>
      ) : null}
    </div>
  );
}

function ItemCardTitle({ item }: { item: CatalogItem }) {
  return (
    <h3 className="line-clamp-2 min-h-[2lh] text-body font-normal leading-snug text-foreground">
      {item.description}
    </h3>
  );
}

function ItemCardPriceRow({
  item,
  initialWatching,
}: {
  item: CatalogItem;
  initialWatching?: boolean;
}) {
  const isShopfront = item.listing_kind === 'SHOPFRONT';
  const showWatch = initialWatching !== undefined;

  return (
    <div className="mt-tight flex min-w-0 items-center gap-snug">
      <p className="min-w-0 truncate text-subhead font-semibold leading-tight text-foreground">
        {isShopfront ? (
          <span className="mr-1 text-meta font-normal text-muted-foreground">
            from
          </span>
        ) : null}
        {formatAud(item.fmv_cents)}
      </p>
      {/* Hidden at zero rather than shown as "0 watching", which reads as a
          verdict on the listing. `watch_count` is denormalised by 0097 because
          `watchlist` is owner-scoped by RLS — see the note on the column.
          Hidden on the 2-col phone grid so price + heart stay on one line. */}
      {item.watch_count > 0 ? (
        <span className="hidden shrink-0 text-meta tabular-nums text-muted-foreground sm:inline">
          {item.watch_count} watching
        </span>
      ) : null}
      {showWatch ? (
        <WatchButton
          itemId={item.id}
          initialWatching={initialWatching}
          variant="icon"
          className="pointer-events-auto relative z-10 ml-auto -mr-tight"
        />
      ) : null}
    </div>
  );
}

function ItemCardSellerRow({
  seller,
  leading,
}: {
  seller: CatalogItem['seller'];
  leading?: ReactNode;
}) {
  if (!seller) return null;

  return (
    <div className="mt-auto flex min-w-0 items-center justify-between gap-snug pt-snug">
      <Link
        href={`/sellers/${seller.id}`}
        className="pointer-events-auto relative z-10 flex min-w-0 items-center gap-tight"
      >
        {leading}
        <span className="truncate text-meta text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {seller.displayName ?? 'Unknown seller'}
        </span>
      </Link>

      <span className="flex shrink-0 items-center gap-tight">
        {seller.rating != null ? (
          <span className="flex items-center gap-tight text-meta tabular-nums text-muted-foreground">
            <Star className="size-3 fill-gold text-gold" aria-hidden="true" />
            {seller.rating.toFixed(1)}
          </span>
        ) : null}
        <IdentityBadge
          verified={seller.isVerified}
          firstName={seller.identityFirstName}
          size={13}
          iconOnly
        />
        {!seller.isVerified ? (
          <BadgeX
            className="size-3.5 shrink-0 text-destructive"
            role="img"
            aria-label="Unverified seller"
          />
        ) : null}
      </span>
    </div>
  );
}
