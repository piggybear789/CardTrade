import type { CSSProperties } from 'react';
import { memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { HugeiconsIcon } from '@hugeicons/react';
import { HeartIcon, LibraryIcon, StarIcon } from '@hugeicons/core-free-icons';
import { ListingPhotoEmpty } from '@/components/listings/ListingPhotoEmpty';
import { NewListingPill } from '@/components/listings/NewListingPill';
import { TrustedSellerBadge } from '@/components/identity/TrustedSellerBadge';

import { Card } from '@/components/ui/card';
import { WatchButton } from '@/components/listings/WatchButton';
import { Avatar } from '@/components/ui/avatar';
import { itemImageUrl } from '@/lib/format';
import { ListedPrice } from '@/components/listings/ListedPrice';
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
  /**
   * The cover as a ready URL, in place of `item.image_paths[0]`. For the listing
   * editor's live preview, whose photos are local files not yet uploaded (object
   * URLs the image optimizer cannot fetch), so it is drawn as a plain `<img>`.
   */
  coverSrc?: string | null;
  /** Shown in place of the price while the editor's price field is empty. */
  pricePlaceholder?: string;
}

/** Human-readable label for a non-AVAILABLE item, shown as an overlay badge. */
const UNAVAILABLE_LABEL: Record<string, string> = {
  RESERVED: 'Under contract',
  SOLD: 'Sold',
};

/**
 * Painted width of a catalog cover: two columns on a phone, three at `md`, four
 * from `lg`. Matches `CATALOG_TILE_GRID`.
 */
const COVER_SIZES = '(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw';

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
  coverSrc,
  pricePlaceholder,
}: ItemCardProps) {
  const unavailableLabel = unavailableLabelFor(item);
  const isShopfront = item.listing_kind === 'SHOPFRONT';
  const showWatch = initialWatching !== undefined;
  const imageUrl =
    coverSrc !== undefined ? coverSrc : itemImageUrl(item.image_paths?.[0] ?? null);
  // `undefined` means "not in a mosaic" and leaves every class untouched; see
  // the prop doc. `null` is an opted-in tile with an unknown photo.
  const inMosaic = coverDim !== undefined;

  return (
    <Card
      className={cn(
        // `contain-intrinsic-size` is the height a tile skipped by
        // `content-visibility: auto` is assumed to have until it first renders.
        // 26rem: a 3:4 cover plus the ~142px text block measures ~23rem in a
        // two-column phone grid and ~29rem at desktop widths. Under-reserving made
        // the page grow — and the scrollbar jump — each time a row came into range.
        // The mosaic replaces this per tile below md (`.catalog-tile`).
        //
        // `surface` (globals.css): the card and the page are both white, so the
        // hairline shadow edge is what separates them.
        //
        // NO MOTION ON THE TILE (2026-11-23). It rose 2px under a stronger shadow on
        // hover and shrank to 97% on press. A marketplace grid is scanned, not played
        // with, and eBay's tiles do neither: the hover is the title underlining, below.
        'surface group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-card p-0 [content-visibility:auto] [contain-intrinsic-size:auto_26rem]',
        // `cursor-pointer` ON THE CARD, not left to the anchor. The hit area is
        // `absolute inset-0 z-0` and the cover paints above it without
        // `pointer-events-none`, so hovering the photo — most of the tile —
        // never reached the link and showed the default arrow. Setting it here
        // covers every child regardless of which one is under the pointer.
        'cursor-pointer',
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
        className="rounded-xl"
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
          // SQUARE from md, so a row of tiles is short enough to see several rows at
          // once. The image is anchored to the top (`object-top`), which keeps a
          // slab's grade label in frame; the crop falls on the bottom of the card. In
          // the phone mosaic the cover takes the photo's own shape; `.catalog-cover`
          // (globals.css) is square from md, and the flat grid matches it, so the
          // server's mosaic and the hydrated grid agree and nothing shifts.
          inMosaic ? 'catalog-cover' : 'aspect-square',
        )}
      >
        {imageUrl && coverSrc !== undefined ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={item.title}
            className="absolute inset-0 size-full object-cover object-top"
          />
        ) : imageUrl ? (
          // NO MORPH INTO THE LISTING PAGE. This was a `<ViewTransition>` that flew the
          // cover from the tile into the page's gallery on every open; the page now
          // simply replaces the catalog, as it does on eBay.
          <div className="absolute inset-0">
            <Image
              src={imageUrl}
              alt={item.title}
              fill
              sizes={COVER_SIZES}
              // Anchored to the TOP: a slab's grade label is at the top of the photo,
              // and a centred crop of anything taller than 3:4 cut it off.
              className={cn('object-cover object-top', unavailableLabel && 'grayscale-[35%]')}
              loading={eager ? 'eager' : 'lazy'}
              fetchPriority={eager ? 'high' : undefined}
            />
          </div>
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
        {/* THE TOP-LEFT STACK: what kind of listing, then how fresh. One column so
            the two never overlap and the heart keeps the top-right corner. */}
        <div className="absolute left-1.5 top-1.5 z-[1] flex flex-col items-start gap-1">
          {isShopfront ? (
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-obsidian/75 px-1.5 py-0.5 text-meta font-medium text-mist">
              <HugeiconsIcon icon={LibraryIcon} className="size-3" aria-hidden />
              Multiple items
            </span>
          ) : null}
          {/* Not on a sold or reserved tile: "New" there would advertise something
              nobody can buy. */}
          <NewListingPill listedAt={unavailableLabel ? null : item.created_at} />
        </div>
        {showWatch || item.watch_count > 0 ? (
          // ONE CHIP AT EVERY WIDTH: 32px around an 18px heart. From `md` it was
          // 40px around 16px, and since the heart only spans 20 of its 24 viewBox
          // units the glyph filled about a third of the disc — a white blob with a
          // speck in it. This is the board's `.tile .heart`, a little larger.
          //
          // A hairline, not `shadow-sm`: the border-wins rule in
          // `tailwind.config.ts`, and the shadow alone left the chip edgeless over
          // a white photo. OPAQUE, and the edge at `foreground/10` rather than
          // `border-border`: at `bg-card/90` the photo tinted the disc, and the
          // grey hairline around a tinted disc read as a halo on dark covers.
          //
          // `translate-y-px` is OPTICAL centring. The heart's bounding box is
          // centred exactly, but its mass sits in the two lobes and it tapers to a
          // thin tip, so box-centred it reads as riding high in the circle.
          //
          // `after:-inset-1.5` is a 44px hit box at every width. The base only
          // extends it from `md`, so on a phone the target was the bare 32px disc
          // over the tile's full-bleed link — a near miss opened the listing
          // instead of saving it (F28). The 6px inset, shared with the flag, puts
          // that box flush with the photo's edge.
          //
          // THE SAVE COUNT RIDES IN THE PILL. It sat beside the price, where "3 saved"
          // competed with the figure that decides the purchase and was dropped on
          // phones for lack of room. Beside the heart it says what it counts without
          // a word, at every width. A viewer who cannot save (a guest, the owner)
          // still sees the count, as the same pill without the button.
          showWatch ? (
            <WatchButton
              itemId={item.id}
              initialWatching={initialWatching ?? false}
              variant="icon"
              count={item.watch_count}
              className={cn(
                'pointer-events-auto absolute right-1.5 top-1.5 z-10 h-8 min-w-8 gap-0.5 rounded-md border-foreground/10 bg-card text-foreground after:-inset-1.5 hover:bg-card hover:text-foreground md:size-auto md:h-8 [&_svg]:size-[18px] [&_svg]:translate-y-px',
                item.watch_count > 0 ? 'w-auto px-2' : 'size-8 md:size-8',
              )}
            />
          ) : (
            <span className="absolute right-1.5 top-1.5 z-10 inline-flex h-8 items-center gap-0.5 rounded-md border border-foreground/10 bg-card px-2 text-meta font-medium tabular-nums text-foreground">
              <HugeiconsIcon icon={HeartIcon} className="size-[18px] translate-y-px" strokeWidth={1.75} aria-hidden />
              {item.watch_count}
              <span className="sr-only"> saves</span>
            </span>
          )
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
        {/* `min-h-[2lh]`: always TWO lines tall. A one-line title made its tile 22px
            shorter than the next, so a grid row's height (and the mosaic column's)
            depended on how long sellers' titles happened to be. */}
        {/* The tile's hover: the title underlines, on a pointer that can hover. */}
        <h3 className="line-clamp-2 min-h-[2lh] text-body font-medium text-foreground underline-offset-2 [@media(hover:hover)]:group-hover:underline">
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
        {/* THE GAME ONLY, again (2026-11-23, product decision). Condition and grade
            are off the tile: a graded card's grade is already in its title, and the
            listing page states condition in full. */}
        <p className="min-w-0 truncate text-body leading-tight text-muted-foreground">
          {item.category}
        </p>
        {/* THE PRICE. No "incl. fees" note on the tile (2026-11-23, product
            decision); the listing page states the fee. */}
        <div className="flex min-w-0 items-center gap-snug">
          {/* INK, NOT VIOLET, and this is the change the pastel retune specified and
              never delivered here.

              A catalog page is mostly prices — one per tile, twelve to a screen — so
              setting them in the brand hue made violet the most repeated colour on the
              busiest surface, and left nothing for the hue to MEAN. It is the marker
              colour for state and focus; spending it on every number cost it that job.
              The decision was applied to the design board and missed this file, so the
              board and the app disagreed about the single most repeated element in the
              product.

              THE PRICE IS THE LOUDEST THING ON THE TILE. It was 16px dollars beside
              a 14px muted symbol, smaller than the title above it. Every
              collectibles marketplace measured (Alt, Fanatics Collect, StockX,
              TCGplayer) sets the figure at 20-24px bold in full ink, symbol and all,
              because it is what a buyer scans a grid for. So the symbol and dollars
              are one run at `text-subhead` (17px) on a phone tile and `text-head`
              (21px) from `md`; only the cents and the currency code recede.
              `CatalogTileSkeleton` reserves the same line. */}
          {pricePlaceholder ? (
            <p className="shrink-0 font-display text-subhead font-bold leading-none text-muted-foreground/60 md:text-head">
              {pricePlaceholder}
            </p>
          ) : (
          <p className="shrink-0 font-display font-bold leading-none tracking-[-0.01em] text-foreground">
            {isShopfront ? (
              <span className="text-meta font-semibold text-muted-foreground">From </span>
            ) : null}
            {/* No cents on the tile. In the viewer's own currency, approximately,
                when the listing is priced in another one (0179). */}
            <ListedPrice
              priceCents={item.fmv_cents}
              currency={item.currency}
              isShopfront={isShopfront}
              showMinor={false}
              classNames={{
                symbol: 'text-subhead md:text-head',
                major: 'text-subhead md:text-head',
                code: 'text-meta font-semibold text-muted-foreground',
              }}
            />
          </p>
          )}
        </div>
        {item.seller ? (
          <Link
            href={`/sellers/${item.seller.id}`}
            className="pointer-events-auto relative z-10 flex min-h-6 w-full min-w-0 items-center gap-1.5"
          >
            {/* `min-h-6`: WCAG 2.2 target size. This link sits inside the tile's
                own hit area, and at the avatar's 20px it was the one target on the
                card under the 24px floor. */}
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
                
                Within the type scale's rules: `meta` is the CHROME register and a
                grid cell's supporting metadata is exactly that. It is floored at
                12px precisely so this kind of reach-for-smaller stops here. */}
            {/* The name truncates and the seal does not: `min-w-0` on the name, the
                seal after it as its own flex item, so a long name cannot push the mark
                out. Icon-only because this row has about 125px; the label is the
                badge's accessible name. Renders nothing for most sellers. */}
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <span className="min-w-0 truncate text-meta text-muted-foreground">
                {item.seller.displayName ?? 'Seller'}
              </span>
              <TrustedSellerBadge
                trusted={item.seller.isTrustedSeller}
                iconOnly
                size={12}
                className="shrink-0"
              />
            </span>
            <SellerReputation seller={item.seller} />
          </Link>
        ) : (
          // THE ROW IS KEPT when the seller did not resolve. Every tile in a grid row
          // is meant to be one height, and the skeleton reserves this row; a tile
          // whose seller lookup came back empty was 28px short of its neighbours.
          <div className="min-h-6" aria-hidden="true" />
        )}
      </div>
    </Card>
  );
});

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
        'absolute inset-0 z-0 rounded-xl border border-transparent focus:outline-none focus-visible:border-ring',
        className,
      )}
    >
      <span className="sr-only">{label}</span>
    </Link>
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
 *
 * NO REVIEW COUNT: `(12)` is another ~22px off the seller's name on a grid card that
 * has none to give. The count is in the aria-label.
 *
 * `rating` and `ratingCount` already arrive on `CatalogSeller`, so this costs no
 * extra query.
 */
function SellerReputation({ seller }: { seller: NonNullable<CatalogItem['seller']> }) {
  // NOTHING AT ALL when there is no rating, and that is a space decision, not an
  // editorial one. A grid card gives this row about 125px after the avatar, so any
  // second element comes straight out of the seller's name: a "New seller" marker
  // here truncated `piggybear7890` to `piggy…`. A name a buyer can read is worth
  // more than a label that says nothing they can act on, and since every seller
  // starts unrated the label would have been on nearly every card.
  if (seller.rating == null) return null;

  return (
    <span
      // `text-meta`, matching the seller name beside it.
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
    </span>
  );
}
