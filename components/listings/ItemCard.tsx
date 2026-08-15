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
  /** `catalog` is the compact, browse-first treatment used in the large grid. */
  variant?: 'default' | 'catalog';
  /**
   * Server-computed save state for the current user. When provided (and the
   * viewer is not the owner), a heart overlay is shown on the artwork. Omit to
   * hide the affordance (e.g. unauthenticated viewers or the item's owner).
   */
  initialWatching?: boolean;
}

/** Human-readable label for a non-AVAILABLE item, shown as an overlay badge. */
const UNAVAILABLE_LABEL: Record<string, string> = {
  RESERVED: 'Under Contract',
  SOLD: 'Sold',
};

/**
 * Linked marketplace tile for an AVAILABLE item (Req 3.8). The catalog variant
 * prioritizes scan speed; the default retains the richer auction-card treatment
 * used by carousels, watchlists, and seller profiles.
 */
export function ItemCard({ item, variant = 'default', initialWatching }: ItemCardProps) {
  const imageUrl = itemImageUrl(item.image_paths?.[0] ?? null);
  const seller = item.seller;
  // A shopfront is never RESERVED or SOLD (0064), so the unavailable overlay can
  // never apply to one — and its price is an indicative "from", not an asking
  // price, so showing a bare figure would read as a purchase price for the lot.
  const isShopfront = item.listing_kind === 'SHOPFRONT';
  const unavailableLabel = isShopfront ? undefined : UNAVAILABLE_LABEL[item.status];
  const showWatch = initialWatching !== undefined;

  if (variant === 'catalog') {
    return (
      <Card
        className={cn(
          'group relative flex h-full min-w-0 flex-col border-0 bg-transparent shadow-none',
          unavailableLabel && 'opacity-70',
        )}
      >
        <Link
          href={`/listings/${item.id}`}
          className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="sr-only">View {item.title}</span>
        </Link>

        <div className="auction-stage pointer-events-none relative aspect-[5/6] overflow-hidden rounded-xl border border-white/10 p-[7%] shadow-market transition-[shadow,transform] duration-150 group-hover:shadow-auction group-active:scale-[0.98]">
          {/* Blurred background — same image scaled to fill, behind the contained
              sharp version. Gives a Facebook Marketplace-style mosaic fill instead
              of dead space around non-square images. */}
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
          <div
            className="absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_50%_-12%,rgba(255,255,255,0.09),transparent_52%)]"
            aria-hidden="true"
          />
          {imageUrl ? (
            <div className={cn(
              'relative z-10 h-full w-full',
              unavailableLabel && 'grayscale-[35%]',
            )}>
              <Image
                src={imageUrl}
                alt={item.title}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                className="object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.5)]"
                loading="lazy"
              />
            </div>
          ) : (
            <div className="relative z-10 flex h-full w-full items-center justify-center text-parchment/45">
              <ImageOff className="size-9" aria-hidden="true" />
              <span className="sr-only">No image available</span>
            </div>
          )}
          {unavailableLabel ? (
            <span className="absolute inset-0 z-20 flex items-center justify-center bg-black/45">
              <Badge
                variant="secondary"
                className="gap-1 border-white/20 bg-black/75 px-snug py-1 text-meta text-parchment shadow-sm backdrop-blur hover:bg-black/75"
              >
                <Lock className="size-3" aria-hidden="true" />
                {unavailableLabel}
              </Badge>
            </span>
          ) : null}
          {showWatch ? (
            <WatchButton
              itemId={item.id}
              initialWatching={initialWatching}
              variant="icon"
              className="pointer-events-auto absolute right-snug top-snug z-30 border border-white/15 bg-black/55 text-parchment hover:bg-black/75"
            />
          ) : null}
        </div>

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
          <h3 className="line-clamp-2 min-h-[2lh] text-body font-normal leading-snug text-foreground">
            {item.description}
          </h3>

          {/* PRICE AND DEMAND ON ONE LINE. The want-count belongs beside the figure
              it qualifies: "$1,200 — 12 people watching" is one thought, and a buyer
              reads the number as evidence about the price. `items-baseline` so the
              small grey count sits on the price's baseline rather than its box, which
              is what stops it looking dropped. */}
          <div className="mt-tight flex min-w-0 items-baseline gap-snug">
            <p className="min-w-0 text-subhead font-semibold leading-tight text-foreground">
              {isShopfront ? (
                <span className="mr-1 text-meta font-normal text-muted-foreground">
                  from
                </span>
              ) : null}
              {formatAud(item.fmv_cents)}
            </p>
            {/* Hidden at zero rather than shown as "0 watching", which reads as a
                verdict on the listing. `watch_count` is denormalised by 0097 because
                `watchlist` is owner-scoped by RLS — see the note on the column. */}
            {item.watch_count > 0 ? (
              <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                {item.watch_count} watching
              </span>
            ) : null}
          </div>

          {/* SELLER: identity on the left, assurance pushed to the far right.
              `justify-between` rather than a trailing margin, so the verified mark
              lands on the tile's right edge on every card regardless of how long the
              display name is — a ragged trust signal is one a buyer stops trusting.

              The title slot above is height-reserved (`min-h-[2lh]`) because
              `line-clamp-2` renders one line or two. Without it, and with this row
              pinned by `mt-auto`, that variance collected into a single gap: measured
              across one row it ran 33px, 57px and 81px between the price and this
              line on adjacent tiles, for what reads as the same join. */}
          {seller ? (
            <div className="mt-auto flex min-w-0 items-center justify-between gap-snug pt-snug">
              <Link
                href={`/sellers/${seller.id}`}
                className="pointer-events-auto relative z-10 flex min-w-0 items-center gap-tight"
              >
                {/* `xs` because this is the densest grid in the app — big enough to
                    recognise a familiar seller, small enough not to compete with the
                    card's own photo, which is the thing being sold. */}
                <Avatar
                  avatarPath={seller.avatarPath}
                  displayName={seller.displayName}
                  size="xs"
                />
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
                {/* ONE MARK, not two. This rendered a payee tick and an identity
                    shield side by side on the claim that they meant different things
                    — "can be paid" versus "a provider checked their ID". Since the
                    payer gate was retired both read the same column, so the card was
                    making the same statement twice in two glyphs. */}
                <IdentityBadge
                  verified={seller.isVerified}
                  firstName={seller.identityFirstName}
                  size={13}
                  iconOnly
                />
                {/* An unverified owner cannot publish a listing, so this should never
                    render on the catalog. Kept as a visible tell rather than nothing:
                    if it ever appears, the Identity_Gate has been bypassed somewhere. */}
                {!seller.isVerified ? (
                  <BadgeX
                    className="size-3.5 shrink-0 text-destructive"
                    // lucide renders a bare <svg>, which carries no role, so an
                    // `aria-label` on it alone was not reliably announced.
                    role="img"
                    aria-label="Unverified seller"
                  />
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        'group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border-border/70 p-0 transition-[border-color,box-shadow] duration-150 hover:border-gold/65 hover:shadow-auction',
        unavailableLabel && 'opacity-70',
      )}
    >
      <Link
        href={`/listings/${item.id}`}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="sr-only">{item.title}</span>
      </Link>

      <div className="auction-stage pointer-events-none relative aspect-[4/5] w-full overflow-hidden p-[7%]">
        {/* Blurred background — same image scaled to fill for a mosaic effect. */}
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
        <div
          className="absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_50%_-12%,rgba(255,255,255,0.08),transparent_52%)]"
          aria-hidden="true"
        />
        {imageUrl ? (
          <div className={cn(
            'relative z-10 h-full w-full',
            unavailableLabel && 'grayscale-[35%]',
          )}>
            <Image
              src={imageUrl}
              alt={item.title}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-contain drop-shadow-[0_14px_28px_rgba(0,0,0,0.58)]"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="relative z-10 flex h-full w-full items-center justify-center text-parchment/45">
            <ImageOff className="size-10" aria-hidden="true" />
            <span className="sr-only">No image available</span>
          </div>
        )}
        {unavailableLabel ? (
          <span className="absolute inset-0 z-20 flex items-center justify-center bg-black/45">
            <Badge
              variant="secondary"
              className="gap-1 border-white/20 bg-black/75 text-parchment shadow-sm backdrop-blur hover:bg-black/75"
            >
              <Lock className="size-3" aria-hidden="true" />
              {unavailableLabel}
            </Badge>
          </span>
        ) : null}
        {showWatch ? (
          <WatchButton
            itemId={item.id}
            initialWatching={initialWatching}
            variant="icon"
            className="pointer-events-auto absolute right-cozy top-cozy z-30 border border-white/15 bg-black/55 text-parchment hover:bg-black/75"
          />
        ) : null}
      </div>

      <div className="pointer-events-none relative flex flex-1 flex-col px-group pb-group pt-cozy">
        <h3 className="line-clamp-2 min-h-[2lh] text-body font-normal leading-snug text-foreground">
          {item.description}
        </h3>
        <div className="mt-tight flex min-w-0 items-baseline gap-snug">
          <p className="min-w-0 text-subhead font-semibold leading-tight text-foreground">
            {isShopfront ? (
              <span className="mr-1 text-meta font-normal text-muted-foreground">from</span>
            ) : null}
            {formatAud(item.fmv_cents)}
          </p>
          {item.watch_count > 0 ? (
            <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
              {item.watch_count} watching
            </span>
          ) : null}
        </div>
        {/* Same structure as the catalog variant — see the fuller notes there. Price
            and want-count on one line, seller identity left and assurance far right,
            no location. The two treatments stay in step deliberately: they are the
            same tile at two densities, and they had already drifted once. */}
        {seller ? (
          <div className="mt-auto flex min-w-0 items-center justify-between gap-snug pt-snug">
            <Link
              href={`/sellers/${seller.id}`}
              className="pointer-events-auto relative z-10 flex min-w-0 items-center gap-tight"
            >
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
              {/* One mark — see the note on the compact layout above. */}
              <IdentityBadge
                verified={seller.isVerified}
                firstName={seller.identityFirstName}
                size={13}
                iconOnly
              />
              {!seller.isVerified ? (
                <BadgeX
                  className="size-3.5 shrink-0 text-destructive"
                  // See the note on the catalog variant: lucide's <svg> has no role.
                  role="img"
                  aria-label="Unverified seller"
                />
              ) : null}
            </span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
