import type { ReactNode } from 'react';
import { ExpandableDescription } from '@/components/listings/ExpandableDescription';
import {
  listingMetaLine,
  type ListingStatusBadge,
} from '@/components/listings/ListingDesktopPane';
import { ListingSellerRow } from '@/components/listings/ListingSellerRow';
import { ListingFeeNote, ListingProtectionLine } from '@/components/listings/ListingTrust';
import { Badge } from '@/components/ui/badge';
import { formatMoney, formatRelativeTime } from '@/lib/format';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { listedPriceCents, splitMoney } from '@/lib/listings/buyerPrice';
import { cn } from '@/lib/utils';

/**
 * The listing below `lg`, in the order every resale marketplace uses: the photos,
 * then what it is, what it costs, how the purchase is protected, who is selling it,
 * and what they say about it. Same content as `ListingDesktopPane`, stacked.
 *
 * The photos LEAD. On a listing the photo is the goods — a buyer checking a slab
 * label or a corner reads it before anything else — so it is the first thing on the
 * page and the page's Largest Contentful Paint, rather than something reached by
 * scrolling past the seller and the description.
 */
export function ListingDetailStack({
  title,
  description,
  priceCents,
  currency,
  condition,
  category,
  isShopfront,
  locationLabel,
  createdAt,
  watchCount,
  isOwner,
  statusBadge,
  sellerId,
  sellerDisplayName,
  sellerAvatarPath,
  sellerVerified,
  sellerFirstName,
  sellerRating,
  sellerRatingCount,
  sellerIdentity,
  media,
  showTrust = false,
  sellerAction,
  details,
}: {
  /** `ListingDetails`, under the description. */
  details?: ReactNode;
  title: string;
  description: string;
  priceCents: number;
  /** `items.currency`, which selects the fee minimum folded into the headline. */
  currency: string;
  condition: string;
  category: string | null;
  isShopfront: boolean;
  locationLabel: string | null;
  /** `items.created_at`, for the listing-age clause of a binder's meta line. */
  createdAt: string | null;
  /** Members who saved it, for the meta line. */
  watchCount: number;
  isOwner: boolean;
  /** Under contract / Sold / Closed. Null while the listing is available. */
  statusBadge?: ListingStatusBadge | null;
  sellerId: string;
  sellerDisplayName: string | null;
  sellerAvatarPath: string | null;
  sellerVerified: boolean;
  sellerFirstName: string | null;
  sellerRating: number | null;
  sellerRatingCount: number | undefined;
  sellerIdentity: SellerIdentityDisclosure | null;
  /** The photo carousel, which heads the stack. */
  media?: ReactNode;
  /** A buyer who can buy: show the fee note and how the purchase is protected. */
  showTrust?: boolean;
  /** Under the seller row: "Message seller" for a buyer on a phone. */
  sellerAction?: ReactNode;
}) {
  // Relative, and hydration-suppressed where it renders — see the same note in
  // `ListingDesktopPane`.
  const meta = listingMetaLine({
    isShopfront,
    category,
    condition,
    locationLabel,
    listedAgo: formatRelativeTime(createdAt),
    saves: watchCount,
  });
  // A binder shows its own indicative "from" figure; a single listing shows what the
  // buyer is actually charged — the same figure as its catalog tile.
  const headline = splitMoney(
    formatMoney(listedPriceCents(priceCents, currency, isShopfront), currency),
  );
  const name = isOwner ? 'You' : (sellerDisplayName ?? 'Seller');
  // The title is printed above, so a description that opens by restating it would
  // say the same words twice in a row.
  const descriptionBody = descriptionBodyAfterTitle(title, description);

  return (
    <div className="flex flex-col">
      {media}

      {statusBadge ? (
        <Badge
          variant={statusBadge.variant}
          aria-label={`Availability: ${statusBadge.label}`}
          className={cn('self-start', media ? 'mt-group' : null)}
        >
          {statusBadge.label}
        </Badge>
      ) : null}

      <h2
        className={cn(
          'text-balance text-subhead font-semibold tracking-tight md:text-head',
          statusBadge ? 'mt-snug' : media ? 'mt-group' : null,
        )}
      >
        {title}
      </h2>

      {meta ? (
        <p
          // Always two lines tall, at most two: with a location it wraps on a phone
          // and without one it does not, which would move everything below it.
          className="mt-snug line-clamp-2 min-h-[2lh] text-meta text-muted-foreground"
          suppressHydrationWarning
        >
          {meta}
        </p>
      ) : null}

      {/* INK AND FEE-INCLUSIVE, matching the desktop pane. Symbol and cents recede
          so the dollars carry the weight at this size. */}
      <p className="mt-snug min-w-0 font-display font-bold leading-none tracking-tight text-foreground">
        {isShopfront ? (
          <span className="mr-tight text-lead font-medium text-muted-foreground">from </span>
        ) : null}
        <span className="text-lead font-bold text-muted-foreground">{headline.symbol}</span>
        <span className="text-display">{headline.major}</span>
        {headline.minor ? (
          <span className="text-lead font-bold text-muted-foreground">{headline.minor}</span>
        ) : null}
      </p>
      {/* Only for a buyer who can buy, and never on a binder, whose price is an
          indicative "from". */}
      {showTrust && !isShopfront ? (
        <ListingFeeNote priceCents={priceCents} currency={currency} className="mt-tight" />
      ) : null}

      {/* NO BINDER NOTICE HERE. The meta line above carries "Binder or bulk listing ·
          nothing is held", and the buy bar's own copy ("Request", "Nothing is held for
          you yet") says the rest at the moment it applies. */}

      {showTrust ? (
        <ListingProtectionLine
          isShopfront={isShopfront}
          headingId="listing-protection-heading-stack"
          className="mt-group"
        />
      ) : null}

      <ListingSellerRow
        headingId="seller-heading-stack"
        className="mt-group"
        sellerId={sellerId}
        name={name}
        isOwner={isOwner}
        avatarPath={sellerAvatarPath}
        verified={sellerVerified}
        firstName={sellerFirstName}
        rating={sellerRating}
        ratingCount={sellerRatingCount}
        identity={sellerIdentity}
      />

      {/* Phones only (the page wraps it `md:hidden`): below `md` the action stack is
          behind the sticky buyer bar, so Message follows the seller it goes to. */}
      {sellerAction ? <div className="mt-snug">{sellerAction}</div> : null}

      <ExpandableDescription text={descriptionBody} className="mt-group" />

      {details ? <div className="mt-group">{details}</div> : null}
    </div>
  );
}

function descriptionBodyAfterTitle(title: string, description: string): string {
  const heading = title.trim();
  const body = description.trim();
  if (!heading || !body || body === heading) return body === heading ? '' : body;
  if (!body.startsWith(heading)) return body;
  return body.slice(heading.length).replace(/^\s+/, '');
}
