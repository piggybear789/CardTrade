import type { ReactNode } from 'react';
import Link from 'next/link';
import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { ListingOverflowMenu } from '@/components/listings/ListingOverflowMenu';
import { ListingFeeLine, ListingTrustRows } from '@/components/listings/ListingTrust';
import { WatchButton } from '@/components/listings/WatchButton';
import { StarRating } from '@/components/listings/StarRating';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { buyerPaysCents, listedPriceCents, splitMoney } from '@/lib/listings/buyerPrice';
import { platformFeeRateLabel } from '@/lib/fees/feeLabels';
import { platformFeeCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import { FeeInfoPopover } from '@/components/listings/FeeInfoPopover';
import { displayLegalName, formatMoney, formatRelativeTime } from '@/lib/format';

/* The fee label is `platformFeeRateLabel` in `lib/fees/feeLabels.ts`, shared with
   `ListingDetailStack`; the fee-inclusive figure and `splitMoney` are in
   `lib/listings/buyerPrice.ts`. */

/**
 * The desktop listing column, in the order a buyer decides in: what it is, what it
 * costs and what protects them, then the actions, then who is selling and the
 * description. Phone layout stays in ListingDetailStack.
 *
 * THE ACTIONS FOLLOW THE PRICE. They used to be pinned to the bottom of the column
 * so they lined up with the photo's bottom edge, which put roughly 180px of empty
 * column between the price and Buy now and let the seller card and description sit
 * between the two things a buyer reads together. Alignment with the photo was the
 * weaker reason; every reference (Depop, Etsy, Shop) keeps the buttons under the price.
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
  chips,
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
  /** Status, game and condition badges, left-aligned above the title. */
  chips?: ReactNode;
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
  /** `items.created_at`, for the listing-age clause of the meta line. */
  createdAt: string | null;
  children: ReactNode;
}) {
  const name = isOwner ? 'You' : (sellerDisplayName ?? 'Unknown seller');
  // Relative, so it reads as freshness rather than as a date to decode. Rendered under
  // `suppressHydrationWarning` because the server and the browser compute it a moment
  // apart — the same reason `InspectionCountdown` does.
  const listedAgo = formatRelativeTime(createdAt);
  // A binder shows its own indicative "from" figure; a single listing shows what the
  // buyer is actually charged — the same figure as its catalog tile.
  const headline = splitMoney(
    formatMoney(listedPriceCents(priceCents, currency, isShopfront), currency),
  );

  return (
    <div className="hidden flex-col gap-group lg:flex">
      <header className="space-y-snug">
        {chips ? <div className="flex flex-wrap items-center gap-snug">{chips}</div> : null}

        <div className="flex items-start justify-between gap-cozy">
          <h2 className="min-w-0 text-balance text-head font-semibold tracking-tight">
            {title}
          </h2>
          {/* Save and "⋯" at 20px, beside the title they act on. They were 14px flags
              floating at the column's edge; Report now lives in the menu, which is
              the weight a rare action deserves. */}
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

        <div>
          {/* THE PRICE IS WHAT THE BUYER PAYS, at `text-display` with symbol and cents
              receding. A shopfront keeps its indicative "from" figure: adding a precise
              fee to an imprecise number would be worse than saying nothing. */}
          <div className="flex flex-wrap items-baseline gap-x-snug">
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
            {!isShopfront ? (
              <FeeInfoPopover
                priceText={formatMoney(priceCents, currency)}
                feeText={formatMoney(platformFeeCentsFor(priceCents, currency), currency)}
                totalText={formatMoney(buyerPaysCents(priceCents, currency), currency)}
                rateLabel={platformFeeRateLabel(currency)}
              />
            ) : null}
          </div>
          {!isShopfront && !isOwner ? (
            <ListingFeeLine priceCents={priceCents} currency={currency} className="mt-tight" />
          ) : null}
          <p className="mt-1.5 text-meta text-muted-foreground" suppressHydrationWarning>
            {[
              isShopfront ? 'Multiple items' : 'Single item',
              listedAgo ? `Listed ${listedAgo}` : null,
              locationLabel ? `Based in ${locationLabel}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </header>

      <div className="space-y-group">{children}</div>

      {showTrust ? <ListingTrustRows /> : null}

      <section aria-labelledby="seller-heading">
        <h2 id="seller-heading" className="sr-only">
          Seller
        </h2>
        <Card className="p-group">
          <div className="flex min-w-0 items-center gap-cozy">
            <Avatar avatarPath={sellerAvatarPath} displayName={name} size="md" />
            <div className="min-w-0 space-y-tight">
              <div className="flex min-w-0 items-center gap-tight">
                {isOwner ? (
                  <p className="truncate text-lead font-semibold">{name}</p>
                ) : (
                  <Link
                    href={`/sellers/${sellerId}`}
                    transitionTypes={['nav-forward']}
                    className="truncate text-lead font-semibold underline-offset-2 hover:underline"
                  >
                    {name}
                  </Link>
                )}
                <IdentityBadge
                  verified={sellerVerified}
                  firstName={sellerFirstName}
                  size={14}
                  iconOnly
                  className="shrink-0"
                />
              </div>
              {sellerRating != null ? (
                isOwner ? (
                  <StarRating rating={sellerRating} count={sellerRatingCount} size={12} className="text-meta" />
                ) : (
                  <Link
                    href={`/sellers/${sellerId}#reviews`}
                    className="inline-flex rounded-sm border border-transparent transition-colors hover:opacity-80 focus:outline-none focus-visible:border-iris"
                    aria-label="Read seller reviews"
                  >
                    <StarRating rating={sellerRating} count={sellerRatingCount} size={12} className="text-meta" />
                  </Link>
                )
              ) : (
                // Unrated: the same one-line box, so the card is one height for every seller.
                <p className="inline-flex border border-transparent text-meta text-muted-foreground">
                  No ratings yet
                </p>
              )}
              {sellerIdentity && !isOwner ? (
                // ONE LINE, clipped, so a trading name cannot wrap the card taller.
                <dl className="flex min-w-0 flex-nowrap gap-x-cozy gap-y-0 overflow-hidden whitespace-nowrap text-meta leading-snug">
                  <div className="flex min-w-0 gap-tight">
                    <dt className="shrink-0 text-muted-foreground">
                      {sellerIdentity.nameIsDocumentVerified ? 'Real name' : 'Stated name'}
                    </dt>
                    <dd className="min-w-0 truncate font-medium">
                      {displayLegalName(sellerIdentity.legalEntityName)}
                    </dd>
                  </div>
                  {sellerIdentity.tradingName ? (
                    <div className="flex min-w-0 gap-tight">
                      <dt className="shrink-0 text-muted-foreground">Trading as</dt>
                      <dd className="min-w-0 truncate font-medium">{sellerIdentity.tradingName}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="truncate text-meta leading-snug text-muted-foreground">
                  {isOwner ? 'Buyers see your verified name here' : 'Name not verified yet'}
                </p>
              )}
            </div>
          </div>
        </Card>
      </section>

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
