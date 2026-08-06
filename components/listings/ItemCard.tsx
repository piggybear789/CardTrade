import Link from 'next/link';
import { BadgeX, ImageOff, Library, Lock, MapPin, Star } from 'lucide-react';

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
          <div
            className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_50%_-12%,rgba(255,255,255,0.09),transparent_52%)]"
            aria-hidden="true"
          />
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={item.title}
              width={512}
              height={512}
              className={cn(
                'relative z-10 h-full w-full object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.5)]',
                unavailableLabel && 'grayscale-[35%]',
              )}
              loading="lazy"
            />
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
                className="gap-1 border-white/20 bg-black/75 px-2.5 py-1 text-[0.6875rem] text-parchment shadow-sm backdrop-blur hover:bg-black/75"
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
              className="pointer-events-auto absolute right-2.5 top-2.5 z-30 border border-white/15 bg-black/55 text-parchment hover:bg-black/75"
            />
          ) : null}
        </div>

        <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col pt-2.5">
          {/* Sizes come off the scale (`text-sm` / `text-base` / `text-xs`) rather
              than one-off bracket values. Metadata was 10px here, rising to 11px at
              `sm` — under the ~12px floor where text stops being comfortable, on the
              densest grid in the app, for the seller name and rating a buyer scans
              before clicking. Contrast was never the problem; size was. */}
          <h3 className="line-clamp-2 text-sm font-normal leading-snug text-foreground">
            {item.title}
          </h3>
          <p className="mt-1 text-base font-semibold leading-tight text-foreground">
            {isShopfront ? (
              <span className="mr-1 text-xs font-normal text-muted-foreground">
                from
              </span>
            ) : null}
            {formatAud(item.fmv_cents)}
          </p>
          {/* A shopfront must not read as one purchasable object (0064). */}
          {isShopfront ? (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <Library className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">Binder or bulk — pick what you want</span>
            </p>
          ) : null}
          {item.location_label ? (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.location_label}</span>
            </p>
          ) : null}

          {seller ? (
            <div className="mt-auto flex min-w-0 items-center gap-1.5 pt-1.5">
              <Link
                href={`/sellers/${seller.id}`}
                className="pointer-events-auto relative z-10 flex min-w-0 items-center gap-1.5"
              >
                {/* `xs` because this is the densest grid in the app — big enough to
                    recognise a familiar seller, small enough not to compete with the
                    card's own photo, which is the thing being sold. */}
                <Avatar
                  avatarPath={seller.avatarPath}
                  displayName={seller.displayName}
                  size="xs"
                />
                <span className="truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  {seller.displayName ?? 'Unknown seller'}
                </span>
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
              </Link>
              {seller.rating != null ? (
                <span className="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
                  <Star className="size-3 fill-gold text-gold" aria-hidden="true" />
                  {seller.rating.toFixed(1)}
                </span>
              ) : null}
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
        <div
          className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_50%_-12%,rgba(255,255,255,0.08),transparent_52%)]"
          aria-hidden="true"
        />
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={item.title}
            width={512}
            height={640}
            className={cn(
              'relative z-10 h-full w-full object-contain drop-shadow-[0_14px_28px_rgba(0,0,0,0.58)]',
              unavailableLabel && 'grayscale-[35%]',
            )}
            loading="lazy"
          />
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
            className="pointer-events-auto absolute right-3 top-3 z-30 border border-white/15 bg-black/55 text-parchment hover:bg-black/75"
          />
        ) : null}
      </div>

      <div className="pointer-events-none relative flex flex-1 flex-col px-4 pb-4 pt-3.5">
        <h3 className="line-clamp-2 text-sm font-normal leading-snug text-foreground">
          {item.title}
        </h3>
        <p className="mt-1.5 text-lg font-semibold leading-tight text-foreground">
          {isShopfront ? (
            <span className="mr-1 text-xs font-normal text-muted-foreground">from</span>
          ) : null}
          {formatAud(item.fmv_cents)}
        </p>
        {/* A shopfront must not read as one purchasable object (0064). */}
        {isShopfront ? (
          <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <Library className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">Binder or bulk — pick what you want</span>
          </p>
        ) : null}
        {item.location_label ? (
          <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.location_label}</span>
          </p>
        ) : null}

        {seller ? (
          <div className="mt-auto flex items-center gap-1.5 pt-2.5">
            <Link
              href={`/sellers/${seller.id}`}
              className="pointer-events-auto relative z-10 flex min-w-0 items-center gap-1.5"
            >
              <span className="truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                {seller.displayName ?? 'Unknown seller'}
              </span>
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
            </Link>
            {seller.rating != null ? (
              <span className="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
                <Star className="size-3 fill-gold text-gold" aria-hidden="true" />
                {seller.rating.toFixed(1)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
