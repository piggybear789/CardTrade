import Link from 'next/link';
import { ImageOff, Lock } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StarRating } from '@/components/listings/StarRating';
import { VerifiedBadge } from '@/components/listings/VerifiedBadge';
import { formatAud, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CatalogItem } from '@/lib/actions/listings';

export interface ItemCardProps {
  item: CatalogItem;
  /** `catalog` is the compact, browse-first treatment used in the large grid. */
  variant?: 'default' | 'catalog';
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
export function ItemCard({ item, variant = 'default' }: ItemCardProps) {
  const imageUrl = itemImageUrl(item.image_paths?.[0] ?? null);
  const seller = item.seller;
  const unavailableLabel = UNAVAILABLE_LABEL[item.status];

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

        <div className="auction-stage pointer-events-none relative aspect-[5/6] overflow-hidden rounded-xl border border-white/10 p-[7%] shadow-market transition-[transform,box-shadow] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-auction motion-reduce:transform-none">
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
                'relative z-10 h-full w-full object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.5)] transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none',
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
          ) : (
            <Badge
              variant="secondary"
              className="absolute left-2.5 top-2.5 z-20 max-w-[calc(100%-1.25rem)] truncate border-white/15 bg-black/65 px-2 py-0.5 text-[0.6875rem] text-parchment shadow-sm backdrop-blur hover:bg-black/65"
            >
              {item.condition}
            </Badge>
          )}
        </div>

        <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col pt-2.5">
          <p className="display-value text-[0.9375rem] leading-tight text-foreground sm:text-base">
            {formatAud(item.fmv_cents)}
          </p>
          <h3 className="mt-0.5 line-clamp-2 text-[0.75rem] font-medium leading-[1.35] text-foreground sm:text-[0.8125rem]">
            {item.title}
          </h3>
          <p className="mt-0.5 truncate text-[0.625rem] text-muted-foreground sm:text-[0.6875rem]">
            {item.category}
          </p>

          <div className="mt-auto flex min-w-0 items-center justify-between gap-1.5 pt-1.5">
            <span className="flex min-w-0 items-center gap-1">
              {seller ? (
                <Link
                  href={`/sellers/${seller.id}`}
                  className="pointer-events-auto relative z-10 truncate text-[0.625rem] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline sm:text-[0.6875rem]"
                >
                  {seller.displayName ?? 'Unknown seller'}
                </Link>
              ) : (
                <span className="truncate text-[0.625rem] text-muted-foreground sm:text-[0.6875rem]">
                  Unknown seller
                </span>
              )}
              {seller?.isVerified ? <VerifiedBadge iconOnly size={12} /> : null}
            </span>
            {seller?.rating ? (
              <span className="shrink-0">
                <StarRating rating={seller.rating} count={seller.ratingCount} hideLabel />
              </span>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-lg border-border/70 p-0 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-gold/65 hover:shadow-auction motion-reduce:transform-none',
        unavailableLabel && 'opacity-70',
      )}
    >
      <Link
        href={`/listings/${item.id}`}
        className="absolute inset-0 z-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
              'relative z-10 h-full w-full object-contain drop-shadow-[0_14px_28px_rgba(0,0,0,0.58)] transition-transform duration-500 group-hover:scale-[1.035] motion-reduce:transform-none',
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
        ) : (
          <span className="absolute left-3 top-3 z-20">
            <Badge
              variant="secondary"
              className="border-white/15 bg-black/65 text-parchment shadow-sm backdrop-blur hover:bg-black/65"
            >
              {item.condition}
            </Badge>
          </span>
        )}
      </div>

      <div className="pointer-events-none relative flex flex-1 flex-col px-4 pb-3 pt-3.5">
        <p className="market-label text-muted-foreground">{item.category}</p>
        <h3 className="mt-1 line-clamp-2 text-[0.9375rem] font-semibold leading-snug text-foreground">
          {item.title}
        </h3>

        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <span className="flex min-w-0 items-center gap-1">
            {seller ? (
              <Link
                href={`/sellers/${seller.id}`}
                className="pointer-events-auto relative z-10 truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {seller.displayName ?? 'Unknown seller'}
              </Link>
            ) : (
              <span className="truncate text-xs text-muted-foreground">Unknown seller</span>
            )}
            {seller?.isVerified ? <VerifiedBadge iconOnly size={13} /> : null}
          </span>
          <StarRating rating={seller?.rating} count={seller?.ratingCount} hideLabel />

        </div>
      </div>

      <div className="ledger-strip pointer-events-none relative border-t border-gold/25 px-4 py-3">
        <p className="market-label mb-1 text-obsidian/55">Price</p>
        <p className="display-value text-[1.45rem] leading-none">
          {formatAud(item.fmv_cents)}
        </p>
      </div>
    </Card>
  );
}
