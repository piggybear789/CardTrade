import type { CSSProperties, ReactNode } from 'react';
import { memo, ViewTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { HugeiconsIcon } from '@hugeicons/react';
import { BadgeXIcon, ImageOffIcon, LibraryIcon, LockIcon, StarIcon } from '@hugeicons/core-free-icons';
import { ListingPhotoEmpty } from '@/components/listings/ListingPhotoEmpty';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StorageImage } from '@/components/ui/storage-image';
import { WatchButton } from '@/components/listings/WatchButton';
import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { Avatar } from '@/components/ui/avatar';
import { formatAud, itemImageUrl } from '@/lib/format';
import { splitMoney } from '@/lib/listings/buyerPrice';
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
  /**
   * Fetch this tile's cover immediately, at high priority, instead of lazily.
   *
   * FOR THE FIRST ROW AND NOTHING ELSE. Every tile in the catalog was
   * `loading="lazy"`, which meant the grid deliberately deferred the largest
   * image above the fold — the page's own Largest Contentful Paint element — and
   * then waited for an intersection observer to discover what was already on
   * screen. Lazy is right for tile forty; it is a self-inflicted delay on tile
   * one.
   *
   * Deliberately NOT a preload. Which tile is the LCP depends on the viewport
   * (two columns on a phone, four from `lg`), and Next's guidance is that
   * `preload` is the wrong tool whenever that is true. `loading="eager"` with
   * `fetchPriority="high"` says the same thing without committing the `<head>`
   * to a guess.
   */
  eager?: boolean;
}

/** Human-readable label for a non-AVAILABLE item, shown as an overlay badge. */
const UNAVAILABLE_LABEL: Record<string, string> = {
  RESERVED: 'Under Contract',
  SOLD: 'Sold',
};

/**
 * Painted width of a catalog cover: two columns on a phone, three at `md`, four
 * from `lg`. Matches `CATALOG_TILE_GRID`.
 */
const COVER_SIZES = '(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw';

/**
 * What the blurred backdrop behind {@link ItemCardStage} asks for.
 *
 * IT IS THE SAME URL AS THE SHARP COVER IN FRONT OF IT, and it used to be a plain
 * `<img>` while that cover went through the optimizer — which is two fetches of
 * two different resources, one of them the full original, for one tile. The two
 * do not share a cache entry (`/_next/image?url=…` is not the Storage URL), so
 * the decoration was the most expensive thing on the card. At `blur-lg` behind a
 * `scale-110` there is nothing a larger source could contribute.
 */
const BACKDROP_SIZES = '128px';

/**
 * Split a formatted money string into currency symbol, major units, and minor
 * units, so each can be sized independently — the digits that decide the
 * purchase get the weight, and the symbol and cents recede.
 *
 * Operates on the formatted output rather than the raw cents because both the
 * symbol and the decimal separator are locale-dependent. `Intl` has already
 * decided them, and re-deciding here would drift from it.
 */
/* `splitMoney` moved to `lib/listings/buyerPrice.ts`. It was private here while the
   Flutter listing card carried a hand-port of it referring to "the same regex the web's
   `splitMoney` uses" — a cross-client rule hidden inside one component — and the listing
   detail panes wanted it too. */

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
 *
 * Memoised because the marketplace grid re-renders on every browse-state change
 * (a pill tap, a filter keystroke, the pending flag) and a phone may have a
 * hundred of these mounted. Props are the row object from state plus
 * primitives, so an unchanged tile bails out.
 */
export const CatalogItemCard = memo(function CatalogItemCard({
  item,
  initialWatching,
  coverDim,
  eager = false,
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
        // The LIFT is the hover, not a colour change. A grid of these fills the
        // catalog, so a violet edge under the pointer made the accent the most
        // frequent thing in the product — and it was competing with the focus edge
        // on the same element. `--foreground/20` firms the hairline; the shadow and
        // the scale do the rest. See the border rule in globals.css.
        'hover:border-foreground/20 hover:shadow-lift active:scale-[0.97]',
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
          // `pointer-events-none` SO THE PHOTO IS ACTUALLY PART OF THE LINK.
          //
          // The hit area is `absolute inset-0 z-0`. This container is a LATER,
          // POSITIONED sibling, so it paints above the anchor and — without this —
          // swallowed every click that landed on it. The photo is most of the tile, so
          // most of the tile did nothing: only the text block below was clickable, and
          // that block works precisely because it already carries this class.
          //
          // Worse than a plain dead zone, the card sets `cursor-pointer` on itself to
          // cover exactly this case, so the pointer promised a link over the photo and
          // nothing happened on click. Half the bug had been found and only the cursor
          // was fixed.
          //
          // `WatchButton` below restores `pointer-events-auto` on itself, which is the
          // same arrangement the text block uses for the seller link.
          'pointer-events-none',
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
                sizes={COVER_SIZES}
                className={cn('object-cover', unavailableLabel && 'grayscale-[35%]')}
                loading={eager ? 'eager' : 'lazy'}
                fetchPriority={eager ? 'high' : undefined}
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
            Multiple items
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
      <div className="pointer-events-none relative flex min-w-0 flex-col gap-tight px-cozy pb-2.5 pt-snug">
        {/* TWO LINES AT EVERY WIDTH. This used to add `md:truncate`, so the
            WIDER screen showed less of the string — and for a graded card the
            set, year and grade all live in the tail that got cut. */}
        <h3 className="line-clamp-2 text-body font-medium text-foreground">
          {item.title}
        </h3>
        {/* THE GAME ONLY. Condition used to follow it behind a hairline — the
            reasoning was that condition is the largest block in the filter rail
            and the grid never confirmed it, so filtering to "Graded" showed
            nothing that said graded.
            
            Dropped because the title already carries it where it matters. A
            graded card is titled "BGS 10 Black Label Mimikyu": the grader, the
            grade and the label are right there, and "| Graded" underneath added a
            coarser restatement of a fact the buyer had already read. For the
            ungraded conditions it was competing for a row that has about 125px
            to spend, against a category that is the more useful sort key.
            
            The filter-confirmation argument is real but belongs to a surface with
            room — the listing page states condition in full. */}
        <p className="min-w-0 truncate text-body leading-tight text-muted-foreground">
          {item.category}
        </p>
        {/* THE PRICE LEADS, AND THE SAVE COUNT SITS WITH IT. Not right-aligned
            across the tile: pushing the count to the far edge reads as a second
            column and makes the eye travel for a fact that is context on the
            price. Grouped immediately after it, the two read as one statement —
            what it costs, and how many people are watching it. */}
        <div className="flex min-w-0 items-baseline gap-1.5">
          {/* INK, NOT VIOLET, and this is the change the pastel retune specified and
              never delivered here.

              A catalog page is mostly prices — one per tile, twelve to a screen — so
              setting them in the brand hue made violet the most repeated colour on the
              busiest surface, and left nothing for the hue to MEAN. It is the marker
              colour for state and focus; spending it on every number cost it that job.
              The decision was applied to the design board and missed this file, so the
              board and the app disagreed about the single most repeated element in the
              product.

              The symbol and the cents stay muted: the dollars are what decides a
              purchase, and the rest is scaffolding around them. */}
          <p className="shrink-0 font-bold leading-none text-foreground">
            {isShopfront ? (
              <span className="text-meta font-semibold text-muted-foreground">From </span>
            ) : null}
            {/* Three sizes: symbol smallest, digits largest, cents between.
                Only the digits decide the purchase. */}
            <span className="text-body font-semibold text-muted-foreground">
              {price.symbol}
            </span>
            <span className="text-head">{price.major}</span>
            {price.minor ? (
              <span className="text-body font-semibold text-muted-foreground">
                {price.minor}
              </span>
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
            {/* `text-meta`, not `text-body`. The seller line is the last thing on
                the tile and the least of what a buyer is scanning — title, then
                price, then who. At 12px `piggybear7890` fits the row it was being
                truncated out of, which is worth more than two points of size on a
                name nobody reads letter by letter.
                
                It also puts this variant in step with `ItemCardSellerRow`, which
                has always drawn the name at `meta`. The two disagreed for no
                stated reason.
                
                Within the type scale's rules: `meta` is the CHROME register and a
                grid cell's supporting metadata is exactly that. It is floored at
                12px precisely so this kind of reach-for-smaller stops here. */}
            <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
              {item.seller.displayName ?? 'Seller'}
            </span>
            <SellerReputation seller={item.seller} />
          </Link>
        ) : null}
      </div>
    </Card>
  );
});

/**
 * Richer auction-card treatment for carousels, watchlists, and seller profiles.
 */
export function ItemCard({ item, initialWatching }: ItemCardProps) {
  const unavailableLabel = unavailableLabelFor(item);

  return (
    <Card
      className={cn(
        'group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border-border p-0 transition-[border-color,box-shadow] duration-150 hover:border-foreground/20 hover:shadow-auction',
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
        <StorageImage
          src={imageUrl}
          alt=""
          aria-hidden="true"
          sizes={BACKDROP_SIZES}
          className="z-0 scale-110 object-cover blur-lg opacity-90"
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
              sizes={COVER_SIZES}
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
              'gap-tight border-white/15 bg-obsidian/75 text-mist shadow-sm backdrop-blur hover:bg-obsidian/75',
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
          <span className="mr-tight text-meta font-normal text-muted-foreground">
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

      <SellerReputation seller={seller} showCount />
    </div>
  );
}

/**
 * A seller's standing, as one compact marker: stars-and-score, or "New seller".
 *
 * THIS REPLACED AN "ID verified" BADGE ON THE CATALOG CARD, and the swap is about
 * information rather than taste. Publishing a listing requires the Identity_Gate, so
 * a verified seller is a PRECONDITION of the card existing — the badge was true of
 * every card in the grid and so discriminated between none of them. Reputation is
 * what actually varies from seller to seller, and it is what a buyer scans this row
 * for.
 *
 * Nothing was lost on the unverified side: `IdentityBadge` renders null when
 * unverified, so the compact card never showed a negative signal to begin with.
 * `ItemCardSellerRow` still shows its explicit unverified marker.
 *
 * ONE DEFINITION FOR BOTH CARD VARIANTS. The compact grid card and the richer
 * carousel card had separately written rating spans that already disagreed — the
 * richer one omitted the review count — which is how "4.9" from one review and "4.9"
 * from two hundred came to look identical on one surface and not the other.
 *
 * `rating` and `ratingCount` already arrive on `CatalogSeller`, so this costs no
 * extra query.
 */
function SellerReputation({
  seller,
  showCount = false,
}: {
  seller: NonNullable<CatalogItem['seller']>;
  /** Append the review count. Off by default — only the wider card has room. */
  showCount?: boolean;
}) {
  // NOTHING AT ALL when there is no rating, and that is a space decision, not an
  // editorial one. A grid card gives this row about 125px after the avatar, so any
  // second element comes straight out of the seller's name: a "New seller" marker
  // here truncated `piggybear7890` to `piggy…`. A name a buyer can read is worth
  // more than a label that says nothing they can act on, and since every seller
  // starts unrated the label would have been on nearly every card.
  if (seller.rating == null) return null;

  return (
    <span
      // `text-meta` on both card variants, matching the seller name beside it.
      className="flex shrink-0 items-center gap-tight text-meta tabular-nums text-muted-foreground"
      // `role="img"` plus a label, because the star is `aria-hidden` and the bare
      // digits would otherwise be announced as a loose number with nothing saying
      // what it measures. That is the F1 mistake, in the densest grid in the app.
      role="img"
      aria-label={`Seller rated ${seller.rating.toFixed(1)} out of 5${
        seller.ratingCount > 0 ? ` from ${seller.ratingCount} reviews` : ''
      }`}
    >
      <HugeiconsIcon
        icon={StarIcon}
        className="size-3 fill-iris text-iris-ink"
        aria-hidden="true"
      />
      {seller.rating.toFixed(1)}
      {/* THE COUNT IS THE RICHER CARD'S ONLY, and the asymmetry is deliberate this
          time. `(12)` is another ~22px off the seller's name on a grid card that
          has none to give. The richer card is wider and its name is already on its
          own line, so it can afford the precision — and the precision matters
          there, because 4.9 from one review and 4.9 from two hundred are not the
          same claim. */}
      {showCount && seller.ratingCount > 0 ? (
        <span className="text-muted-foreground/70">({seller.ratingCount})</span>
      ) : null}
    </span>
  );
}
