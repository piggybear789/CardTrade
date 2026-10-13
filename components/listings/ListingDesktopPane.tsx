import type { ReactNode } from 'react';
import { ListingOverflowMenu } from '@/components/listings/ListingOverflowMenu';
import { ListingSellerRow } from '@/components/listings/ListingSellerRow';
import { ListingFeeNote, ListingProtectionLine } from '@/components/listings/ListingTrust';
import { WatchButton } from '@/components/listings/WatchButton';
import { Badge } from '@/components/ui/badge';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { listedPriceCents, splitMoney } from '@/lib/listings/buyerPrice';
import { formatMoney, formatRelativeTime } from '@/lib/format';

/* The fee note and its (i) breakdown are `ListingFeeNote` in `ListingTrust.tsx`, shared
   with `ListingDetailStack`; the fee-inclusive figure and `splitMoney` are in
   `lib/listings/buyerPrice.ts`. */

/** Shown above the title only when the listing is NOT open for business. */
export type ListingStatusBadge = { label: string; variant: 'secondary' | 'outline' };

/**
 * The desktop listing column, in the order a buyer decides in: what it is (a status
 * badge only when it is not available, the title, one quiet meta line), what it costs
 * (the fee-inclusive price and one muted fee note), the actions (Buy now, then a row of
 * round chips for Propose trade, Make an offer and Message seller), one line on how the
 * purchase is protected, who is selling, the description and the details. Phone layout
 * stays in ListingDetailStack and carries the same content.
 *
 * THE ACTIONS FOLLOW THE PRICE. They used to be pinned to the bottom of the column
 * so they lined up with the photo's bottom edge, which put roughly 180px of empty
 * column between the price and Buy now and let the seller card and description sit
 * between the two things a buyer reads together. Alignment with the photo was the
 * weaker reason; every reference (Depop, Etsy, Shop) keeps the buttons under the price.
 *
 * ONE LOUD THING. There used to be a chip row (status, game, condition, saves), a green
 * fee-and-hold line, a bordered three-row protection card and a boxed seller card, so
 * the column had five competing weights before the description. The only filled
 * colour now is the primary action; everything else is muted text or a divider.
 */
export function ListingDesktopPane({
  title,
  description,
  priceCents,
  currency,
  isShopfront,
  itemId,
  isOwner,
  showWatch,
  canReport,
  showTrust,
  statusBadge,
  category,
  condition,
  watchCount,
  initialWatching,
  sellerId,
  sellerDisplayName,
  sellerAvatarPath,
  sellerVerified,
  sellerFirstName,
  sellerRating,
  sellerRatingCount,
  sellerIdentity,
  locationLabel,
  createdAt,
  details,
  children,
}: {
  /** `ListingDetails`, under the description. */
  details?: ReactNode;
  title: string;
  description: string;
  priceCents: number;
  /** `items.currency`, which selects the fee minimum folded into the headline. */
  currency: string;
  isShopfront: boolean;
  itemId: string;
  isOwner: boolean;
  showWatch: boolean;
  /** Signed in and not the owner: Report joins Share in the "⋯" menu. */
  canReport: boolean;
  /** Show how a purchase is protected under the actions (a buyer who can buy). */
  showTrust: boolean;
  /** Under contract / Sold / Closed. Null while the listing is available. */
  statusBadge?: ListingStatusBadge | null;
  /** The card game, for the meta line. */
  category: string | null;
  condition: string;
  /** Members who saved it, for the meta line. */
  watchCount: number;
  initialWatching: boolean;
  sellerId: string;
  sellerDisplayName: string | null;
  sellerAvatarPath: string | null;
  sellerVerified: boolean;
  sellerFirstName: string | null;
  sellerRating: number | null;
  sellerRatingCount: number | undefined;
  sellerIdentity: SellerIdentityDisclosure | null;
  locationLabel: string | null;
  /** `items.created_at`, for the listing-age clause of a binder's meta line. */
  createdAt: string | null;
  children: ReactNode;
}) {
  const name = isOwner ? 'You' : (sellerDisplayName ?? 'Seller');
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

  return (
    <div className="hidden flex-col gap-group lg:flex">
      <header className="space-y-snug">
        {statusBadge ? (
          <Badge variant={statusBadge.variant} aria-label={`Availability: ${statusBadge.label}`}>
            {statusBadge.label}
          </Badge>
        ) : null}

        <div className="flex items-start justify-between gap-cozy">
          <h2 className="min-w-0 text-balance text-head font-semibold tracking-tight">
            {title}
          </h2>
          {/* Save and "⋯" at 20px, beside the title they act on. The save count is
              the last clause of the meta line below, so every viewer sees it, not
              only the members who get a heart. */}
          <div className="-mr-snug -mt-tight flex shrink-0 items-center" role="group" aria-label="Listing actions">
            {showWatch ? (
              <WatchButton
                itemId={itemId}
                initialWatching={initialWatching}
                variant="icon"
                className="size-9 md:size-9"
                glyphClassName="size-5"
              />
            ) : null}
            <ListingOverflowMenu itemId={itemId} canReport={canReport} triggerClassName="size-9 md:size-9" />
          </div>
        </div>

        {/* Relative listing age is part of a binder's line, so hydration-suppressed:
            the server and the browser compute it a moment apart. */}
        <p className="text-meta text-muted-foreground" suppressHydrationWarning>
          {meta}
        </p>

        <div>
          {/* THE PRICE IS WHAT THE BUYER PAYS, at `text-display` with symbol and cents
              receding. A shopfront keeps its indicative "from" figure: adding a precise
              fee to an imprecise number would be worse than saying nothing. */}
          <p className="font-display font-semibold tabular-nums tracking-tight">
            {isShopfront ? (
              <span className="mr-tight text-body font-medium text-muted-foreground">
                from{' '}
              </span>
            ) : null}
            <span className="text-lead font-semibold text-muted-foreground">
              {headline.symbol}
            </span>
            <span className="text-display">{headline.major}</span>
            {headline.minor ? (
              <span className="text-lead font-semibold text-muted-foreground">
                {headline.minor}
              </span>
            ) : null}
          </p>
          {/* Buyers only: the owner reads "Buyers pay / You receive" in their tools. */}
          {!isShopfront && !isOwner ? (
            <ListingFeeNote priceCents={priceCents} currency={currency} className="mt-tight" />
          ) : null}
        </div>
      </header>

      <div className="space-y-group">{children}</div>

      {showTrust ? (
        <ListingProtectionLine isShopfront={isShopfront} headingId="listing-protection-heading" />
      ) : null}

      <ListingSellerRow
        headingId="seller-heading"
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

      {description.trim() ? (
        <section aria-labelledby="description-heading" className="pb-group">
          <h2
            id="description-heading"
            className="mb-tight text-meta font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Description
          </h2>
          <p className="whitespace-pre-line break-words text-body text-foreground">{description}</p>
        </section>
      ) : null}
      {details ? <div className="pb-group">{details}</div> : null}
    </div>
  );
}

/**
 * The one quiet line under the title, shared by both layouts so they read the same.
 *
 * A single listing: `Pokémon · Graded · Croydon, NSW, Australia · 3 saved` — the full
 * facts, listed date included, are in Details. A binder or bulk listing has no Details,
 * so its line keeps the listing age, and it always says that nothing is held: on every
 * other listing opening a contract reserves the goods.
 *
 * The save count is the last clause for both kinds, for every viewer, and only when
 * someone has saved it (the catalog tile's rule).
 */
export function listingMetaLine({
  isShopfront,
  category,
  condition,
  locationLabel,
  listedAgo,
  saves,
}: {
  isShopfront: boolean;
  category: string | null;
  condition: string;
  locationLabel: string | null;
  listedAgo: string | null;
  /** Members who saved the listing. */
  saves: number;
}): string {
  const parts = isShopfront
    ? [
        'Binder or bulk listing · nothing is held',
        category,
        listedAgo ? `Listed ${listedAgo}` : null,
        locationLabel,
      ]
    : [category, condition, locationLabel];
  parts.push(saves > 0 ? `${saves} saved` : null);
  return parts.filter(Boolean).join(' · ');
}
