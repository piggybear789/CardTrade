import type { CSSProperties, ReactNode } from 'react';
import { ViewTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { HugeiconsIcon } from '@hugeicons/react';
import { BadgeXIcon, ImageOffIcon, LibraryIcon, LockIcon, StarIcon } from '@hugeicons/core-free-icons';
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

/**
 * Split a formatted money string into currency symbol, major units, and minor
 * units, so each can be sized independently — the digits that decide the
 * purchase get the weight, and the symbol and cents recede.
 *
 * Operates on the formatted output rather than the raw cents because both the
 * symbol and the decimal separator are locale-dependent. `Intl` has already
 * decided them, and re-deciding here would drift from it.
 */
function splitMoney(formatted: string): {
  symbol: string;
  major: string;
  minor: string;
} {
  const match = /^(\D*)(.*?)([.,]\d{2})?$/.exec(formatted);
  if (!match) return { symbol: '', major: formatted, minor: '' };
  return { symbol: match[1] ?? '', major: match[2] ?? '', minor: match[3] ?? '' };
}

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
 * mosaic. Title, iris price, seller. Location stays off the phone tile.
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
  const price = splitMoney(formatAud(item.fmv_cents));

  return (
    <Card
      className={cn(
        // A border, not `border-0`: the card and the page are both white now,
        // so the edge is the only thing separating them.
        'group relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border p-0 shadow-sm [content-visibility:auto] [contain-intrinsic-size:auto_15rem]',
        // `cursor-pointer` ON THE CARD, not left to the anchor. The hit area is
        // `absolute inset-0 z-0` and the cover paints above it without
        // `pointer-events-none`, so hovering the photo — most of the tile —
        // never reached the link and showed the default arrow. Setting it here
        // covers every child regardless of which one is under the pointer.
        'cursor-pointer transition-[box-shadow,border-color,transform] duration-150',
        'hover:border-iris/40 hover:shadow-lift active:scale-[0.97]',
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
          // Square at every width. The desktop cover used to be 3:4, which made
          // the tile tall enough that a row of them dominated the grid.
          inMosaic ? 'catalog-cover' : 'aspect-square',
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
          // ONE EMPTY-PHOTO TREATMENT AT EVERY WIDTH. Desktop used to branch to
          // a bare `ImageOff` — the universal "this image failed to load" glyph
          // — while the phone got `ListingPhotoEmpty`, whose own doc comment
          // says it exists to be "a card-shaped absence, not a broken-image
          // slash". On a marketplace where the photo IS the goods, "broken" and
          // "no photo" are opposite signals and the cheaper inference is that
          // the site is broken. The wider tile also has room for the caption,
          // so only the mosaic runs compact.
          <ListingPhotoEmpty title={item.title} compact={inMosaic} />
        )}
        {unavailableLabel ? (
          <span className="absolute inset-0 z-[1] flex items-center justify-center bg-obsidian/45">
            <span className="text-meta font-semibold tracking-wide text-mist">
              {unavailableLabel === 'Sold' ? 'SOLD' : 'RESERVED'}
            </span>
          </span>
        ) : null}
        {isShopfront ? (
          <span className="absolute left-1 top-1 z-[1] inline-flex items-center gap-0.5 rounded-sm bg-obsidian/75 px-1.5 py-0.5 text-meta font-medium text-mist">
            <HugeiconsIcon icon={LibraryIcon} className="size-3" aria-hidden />
            Binder
          </span>
        ) : null}
        {showWatch ? (
          <WatchButton
            itemId={item.id}
            initialWatching={initialWatching}
            variant="icon"
            className="pointer-events-auto absolute right-1 top-1 z-10 size-8 rounded-full bg-card/90 text-foreground shadow-sm hover:bg-card hover:text-foreground md:size-10 [&_svg]:size-3.5 md:[&_svg]:size-4"
          />
        ) : null}
      </div>
      {/* `gap` on the column, not a margin per row. The rows used to be spaced
          with `mt-px` and `mt-0.5` — one and two pixels — against 6px of side
          padding, so the whole block read as one crushed paragraph rather than
          four distinct facts. */}
      <div className="pointer-events-none relative flex min-w-0 flex-col gap-1 px-3 pb-2.5 pt-2">
        {/* TWO LINES AT EVERY WIDTH. This used to add `md:truncate`, so the
            WIDER screen showed less of the string — and for a graded card the
            set, year and grade all live in the tail that got cut. */}
        <h3 className="line-clamp-2 text-body font-medium leading-normal text-foreground">
          {item.title}
        </h3>
        {/* Game and condition as plain muted text with a hairline between,
            rather than a filled chip. Condition is the largest block in the
            filter rail and was the one fact the grid never confirmed — filter
            to "Graded" and nothing said graded. A binder holds mixed stock, so
            it states no single condition. */}
        <p className="flex min-w-0 items-center gap-1.5 text-body leading-tight text-muted-foreground">
          <span className="truncate">{item.category}</span>
          {!isShopfront && item.condition ? (
            <>
              <span
                aria-hidden="true"
                className="h-3 w-px shrink-0 bg-border"
              />
              <span className="shrink-0">{item.condition}</span>
            </>
          ) : null}
        </p>
        {/* THE PRICE LEADS, AND THE SAVE COUNT SITS WITH IT. Not right-aligned
            across the tile: pushing the count to the far edge reads as a second
            column and makes the eye travel for a fact that is context on the
            price. Grouped immediately after it, the two read as one statement —
            what it costs, and how many people are watching it. */}
        <div className="flex min-w-0 items-baseline gap-1.5">
          <p className="shrink-0 font-bold leading-none text-iris-ink">
            {isShopfront ? (
              <span className="text-meta font-semibold">From </span>
            ) : null}
            {/* Three sizes: symbol smallest, digits largest, cents between.
                Only the digits decide the purchase. */}
            <span className="text-body">{price.symbol}</span>
            <span className="text-head">{price.major}</span>
            {price.minor ? (
              <span className="text-body">{price.minor}</span>
            ) : null}
          </p>
          {item.watch_count > 0 ? (
            <span className="min-w-0 truncate text-body leading-tight text-muted-foreground">
              {item.watch_count} saved
            </span>
          ) : null}
        </div>
        {item.seller ? (
          <Link
            href={`/sellers/${item.seller.id}`}
            className="pointer-events-auto relative z-10 flex w-full min-w-0 items-center gap-1.5"
          >
            {/* 20px, overriding the `xs` 24px — the seller line is supporting
                information and the avatar should not outweigh the name. */}
            <Avatar
              avatarPath={item.seller.avatarPath}
              displayName={item.seller.displayName}
              size="xs"
              className="size-5 border-0"
            />
            <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">
              {item.seller.displayName ?? 'Seller'}
            </span>
            {item.seller.isVerified ? (
              <span className="shrink-0">
                <IdentityBadge verified size={12} />
              </span>
            ) : null}
          </Link>
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
        'group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border-border p-0 transition-[border-color,box-shadow] duration-150 hover:border-iris/50 hover:shadow-auction',
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
        'absolute inset-0 z-0 rounded-xl border border-transparent focus:outline-none focus-visible:border-iris',
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
        <div className="relative z-10 flex h-full w-full items-center justify-center text-mist/45">
          <HugeiconsIcon icon={ImageOffIcon} className={emptyIconClassName} aria-hidden="true" />
          <span className="sr-only">No image available</span>
        </div>
      )}
      {unavailableLabel ? (
        <span className="absolute inset-0 z-20 flex items-center justify-center bg-obsidian/45">
          <Badge
            variant="secondary"
            className={cn(
              'gap-1 border-white/15 bg-obsidian/75 text-mist shadow-sm backdrop-blur hover:bg-obsidian/75',
              badgeClassName,
            )}
          >
            <HugeiconsIcon icon={LockIcon} className="size-3" aria-hidden="true" />
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
          <HugeiconsIcon icon={BadgeXIcon}
            className="size-3.5 shrink-0 text-destructive"
            role="img"
            aria-label="Unverified seller"
          />
        ) : null}
      </Link>

      {seller.rating != null ? (
        <span className="flex shrink-0 items-center gap-tight text-meta tabular-nums text-muted-foreground">
          <HugeiconsIcon icon={StarIcon} className="size-3 fill-iris text-iris-ink" aria-hidden="true" />
          {seller.rating.toFixed(1)}
        </span>
      ) : null}
    </div>
  );
}
