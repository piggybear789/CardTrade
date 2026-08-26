import type { CSSProperties, ReactNode } from 'react';
import { ViewTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BadgeX, ImageOff, Library, Lock, Star } from 'lucide-react';
import { ListingPhotoEmpty } from '@/components/listings/ListingPhotoEmpty';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WatchButton } from '@/components/listings/WatchButton';
import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { Avatar } from '@/components/ui/avatar';
import { formatAud, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { coverAspectCss, type ImageDim } from '@/lib/images/dimensions';
import { tileIntrinsicHeight } from '@/components/listings/catalogGrid';
import type { CatalogItem } from '@/lib/actions/listings';

export { CATALOG_TILE_GRID } from '@/components/listings/catalogGrid';

export interface ItemCardProps {
  item: CatalogItem;
  /**
   * Server-computed save state for the current user. When provided (and the
   * viewer is not the owner), a heart sits on the catalog photo. Omit to
   * hide the affordance (e.g. unauthenticated viewers or the item's owner).
   */
  initialWatching?: boolean;
  /**
   * Intrinsic size of the cover photo, which opts this tile into the phone
   * mosaic: below md the cover is drawn at the photo's own shape instead of
   * square, so tiles vary in height and the two columns stagger.
   *
   * Three states, all meaningful. `undefined` — the default — means the caller
   * is not laying out a mosaic, and the tile stays square at every breakpoint,
   * which is what My Listings, Saved, and seller shops want. `null` means the
   * caller IS laying out a mosaic but this photo's size is unknown, so the tile
   * falls back to square rather than collapsing. A value draws that shape,
   * clamped by `coverAspectRatio` so one panorama cannot wreck a column.
   *
   * Never affects md and up.
   */
  coverDim?: ImageDim | null;
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
 * Compact browse tile. 3:4 cover at md and up, unchanged; below md it is square
 * by default, or the photo's own shape when the caller passes
 * {@link ItemCardProps.coverDim}, which is what staggers the phone
 * mosaic. Title, gold price, seller. Location stays off the phone tile.
 * Marketplace grid, My Listings, Saved, and seller shops.
 */
export function CatalogItemCard({
  item,
  initialWatching,
  coverDim,
}: ItemCardProps) {
  const unavailableLabel = unavailableLabelFor(item);
  const isShopfront = item.listing_kind === 'SHOPFRONT';
  const showWatch = initialWatching !== undefined;
  const imageUrl = itemImageUrl(item.image_paths?.[0] ?? null);
  // `undefined` means "not in a mosaic" and leaves every class untouched; see
  // the prop doc. `null` is an opted-in tile with an unknown photo.
  const inMosaic = coverDim !== undefined;

  return (
    <Card
      className={cn(
        'group relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border-0 p-0 shadow-sm [content-visibility:auto] [contain-intrinsic-size:auto_18rem]',
        'transition-transform duration-100 active:scale-[0.97]',
        inMosaic && 'catalog-tile',
        unavailableLabel && 'opacity-70',
      )}
      style={
        inMosaic
          ? ({
              '--catalog-cover-aspect': coverAspectCss(coverDim),
              '--catalog-tile-height': tileIntrinsicHeight(coverDim),
            } as CSSProperties)
          : undefined
      }
    >
      <ItemCardHitArea
        item={item}
        label={`View ${item.title}`}
        className="rounded-lg"
      />
      <div
        className={cn(
          'relative overflow-hidden bg-muted',
          inMosaic ? 'catalog-cover' : 'aspect-square md:aspect-[3/4]',
        )}
      >
        {imageUrl ? (
          <ViewTransition
            name={`listing-image-${item.id}`}
            share="morph"
            default="none"
          >
            <div className="absolute inset-0">
              <Image
                src={imageUrl}
                alt={item.title}
                fill
                sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw"
                className={cn('object-cover', unavailableLabel && 'grayscale-[35%]')}
                loading="lazy"
              />
            </div>
          </ViewTransition>
        ) : (
          <>
            <div className="h-full w-full md:hidden">
              <ListingPhotoEmpty title={item.title} compact />
            </div>
            <div className="hidden h-full w-full items-center justify-center text-muted-foreground md:flex">
              <ImageOff className="size-8" aria-hidden="true" />
              <span className="sr-only">No image available</span>
            </div>
          </>
        )}
        {unavailableLabel ? (
          <span className="absolute inset-0 z-[1] flex items-center justify-center bg-obsidian/45">
            <span className="text-meta font-semibold tracking-wide text-parchment">
              {unavailableLabel === 'Sold' ? 'SOLD' : 'RESERVED'}
            </span>
          </span>
        ) : null}
        {isShopfront ? (
          <span className="absolute left-1 top-1 z-[1] inline-flex items-center gap-0.5 rounded-sm bg-obsidian/75 px-1.5 py-0.5 text-meta font-medium text-parchment">
            <Library className="size-3" aria-hidden />
            Binder
          </span>
        ) : null}
        {showWatch ? (
          <WatchButton
            itemId={item.id}
            initialWatching={initialWatching}
            variant="icon"
            className="pointer-events-auto absolute right-1 top-1 z-10 size-10 rounded-full bg-card/90 text-foreground shadow-sm hover:bg-card hover:text-foreground md:size-10 [&_svg]:size-4"
          />
        ) : null}
      </div>
      <div className="pointer-events-none relative flex min-w-0 flex-col px-1.5 pb-2 pt-1.5">
        <h3 className="line-clamp-2 text-body font-medium leading-snug text-foreground md:truncate">
          {item.title}
        </h3>
        <p className="mt-px truncate text-lead font-bold leading-tight text-gold">
          {isShopfront
            ? `From ${formatAud(item.fmv_cents)}`
            : formatAud(item.fmv_cents)}
        </p>
        {item.seller ? (
          <Link
            href={`/sellers/${item.seller.id}`}
            className="pointer-events-auto relative z-10 mt-0.5 flex w-full min-w-0 items-center gap-1.5"
          >
            <Avatar
              avatarPath={item.seller.avatarPath}
              displayName={item.seller.displayName}
              size="xs"
              className="border-0"
            />
            <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">
              {item.seller.displayName ?? 'Seller'}
            </span>
            <IdentityBadge
              verified={item.seller.isVerified}
              firstName={item.seller.identityFirstName}
              size={16}
              iconOnly
              className="ml-auto shrink-0"
            />
          </Link>
        ) : null}
        {item.location_label ? (
          <p className="mt-px hidden truncate text-meta text-muted-foreground md:block">
            {item.location_label}
          </p>
        ) : null}
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
        'group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border-border p-0 transition-[border-color,box-shadow] duration-150 hover:border-gold/40 hover:shadow-auction',
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

function ItemCardHitArea({
  item,
  label,
  className,
}: {
  item: CatalogItem;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={`/listings/${item.id}`}
      transitionTypes={['nav-forward']}
      className={cn(
        'absolute inset-0 z-0 rounded-xl border border-transparent focus:outline-none focus-visible:border-gold/40',
        className,
      )}
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
              'gap-1 border-white/15 bg-obsidian/75 text-parchment shadow-sm backdrop-blur hover:bg-obsidian/75',
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
    <h3 className="line-clamp-2 text-body font-normal leading-snug text-foreground">
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
      <p className="min-w-0 truncate text-lead font-semibold leading-tight text-foreground md:text-subhead">
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
    <div className="mt-auto flex min-w-0 items-center justify-between gap-snug pt-tight">
      <Link
        href={`/sellers/${seller.id}`}
        className="pointer-events-auto relative z-10 flex min-w-0 items-center gap-tight"
      >
        {leading}
        <span className="truncate text-meta text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {seller.displayName ?? 'Unknown seller'}
        </span>
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
      </Link>

      {seller.rating != null ? (
        <span className="flex shrink-0 items-center gap-tight text-meta tabular-nums text-muted-foreground">
          <Star className="size-3 fill-gold text-gold" aria-hidden="true" />
          {seller.rating.toFixed(1)}
        </span>
      ) : null}
    </div>
  );
}
