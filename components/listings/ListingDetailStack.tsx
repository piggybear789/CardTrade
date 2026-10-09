import type { ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { ExpandableDescription } from '@/components/listings/ExpandableDescription';
import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { StarRating } from '@/components/listings/StarRating';
import { Avatar } from '@/components/ui/avatar';
import { displayLegalName, formatMoney, formatRelativeTime } from '@/lib/format';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { buyerPaysCents, listedPriceCents, splitMoney } from '@/lib/listings/buyerPrice';
import { platformFeeRateLabel } from '@/lib/fees/feeLabels';
import { platformFeeCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import { FeeInfoPopover } from '@/components/listings/FeeInfoPopover';
import { ListingFeeLine, ListingTrustRows } from '@/components/listings/ListingTrust';
import { cn } from '@/lib/utils';

/**
 * The listing below `lg`, in the order every resale marketplace uses: the photos,
 * then what it is, what it costs, who is selling it, and what they say about it.
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
}: {
  title: string;
  description: string;
  priceCents: number;
  /** `items.currency`, which selects the fee minimum folded into the headline. */
  currency: string;
  condition: string;
  category: string | null;
  isShopfront: boolean;
  locationLabel: string | null;
  /** `items.created_at`, for the listing-age clause of the meta line. */
  createdAt: string | null;
  watchCount: number;
  isOwner: boolean;
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
  /** A buyer who can buy: show the fee line and how the purchase is protected. */
  showTrust?: boolean;
  /** Under the seller card: "Message seller" for a buyer. */
  sellerAction?: ReactNode;
}) {
  // "Multiple items", matching the listing form's own choice. It was "Binder listing",
  // a hobby word for a ring binder of trade stock that described stationery to
  // anyone else and was wrong for a lot of slabs or sealed product anyway.
  const kindLabel = isShopfront ? 'Multiple items' : 'Single item';
  const savesLabel = watchCount === 1 ? '1 save' : `${watchCount} saves`;
  // Relative, and hydration-suppressed where it renders — see the same note in
  // `ListingDesktopPane`. Every resale reference carries listing age: a card listed
  // four hours ago is a different proposition from one listed four months ago at
  // the same price.
  const listedAgo = formatRelativeTime(createdAt);
  // A binder shows its own indicative "from" figure; a single listing shows what the
  // buyer is actually charged — the same figure as its catalog tile.
  const headline = splitMoney(
    formatMoney(listedPriceCents(priceCents, currency, isShopfront), currency),
  );
  const meta = [
    watchCount > 0 ? savesLabel : null,
    category,
    kindLabel,
    listedAgo ? `Listed ${listedAgo}` : null,
    locationLabel ? `Based in ${locationLabel}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const name = isOwner ? 'You' : (sellerDisplayName ?? 'Seller');
  // The title is printed above, so a description that opens by restating it would
  // say the same words twice in a row.
  const descriptionBody = descriptionBodyAfterTitle(title, description);

  return (
    <div className="flex flex-col">
      {media}

      <h2
        className={cn(
          'text-balance text-subhead font-semibold tracking-tight md:text-head',
          media ? 'mt-group' : null,
        )}
      >
        {title}
      </h2>

      <div className="mt-snug flex items-center gap-cozy">
        {/* Price and its fee note share the flexible cell, so the condition pill keeps
            its own place at the end of the row rather than being pushed by the note.
            `items-baseline` inside, so the note annotates the figure. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-snug">
          {/* INK AND FEE-INCLUSIVE, matching the desktop pane. Symbol and cents recede
              so the dollars carry the weight at this size. */}
          <p className="min-w-0 font-display font-bold leading-none tracking-tight text-foreground">
            {isShopfront ? (
              <span className="mr-tight text-lead font-medium text-muted-foreground">from </span>
            ) : null}
            <span className="text-lead font-bold text-muted-foreground">
              {headline.symbol}
            </span>
            <span className="text-display">{headline.major}</span>
            {headline.minor ? (
              <span className="text-lead font-bold text-muted-foreground">
                {headline.minor}
              </span>
            ) : null}
          </p>
          {/* The fee note sits behind an (i), same as desktop. The headline above is
              already fee-inclusive, so the figure is honest without the note; the
              popover explains it. Suppressed for a binder, whose price is an
              indicative "from". */}
          {!isShopfront ? (
            <FeeInfoPopover
              priceText={formatMoney(priceCents, currency)}
              feeText={formatMoney(platformFeeCentsFor(priceCents, currency), currency)}
              totalText={formatMoney(buyerPaysCents(priceCents, currency), currency)}
              rateLabel={platformFeeRateLabel(currency)}
            />
          ) : null}
        </div>
        <span className="shrink-0 rounded-full bg-mist px-snug py-0.5 text-meta font-semibold text-muted-foreground">
          {condition}
        </span>
      </div>

      {showTrust && !isShopfront ? (
        <ListingFeeLine priceCents={priceCents} currency={currency} className="mt-snug" />
      ) : null}

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

      {/* NO MULTI-ITEM NOTICE HERE. The kind is already in the meta line above, and the
          buy bar's own copy ("Request", "Nothing is held for you yet") says the rest at
          the moment it applies. */}

      {/* THE SELLER IS ONE TAP TARGET. A card the whole width of the column, so a
          phone gets a 60px target to the profile rather than a name-sized link, and
          the rating, the verification mark and the verified name read as one claim
          about one person. Every line always renders — absence reads as a neutral
          fact in the same box, so the description below sits at the same height for
          every listing. */}
      <Link
        href={isOwner ? '/profile' : `/sellers/${sellerId}`}
        transitionTypes={['nav-forward']}
        className="mt-group flex min-w-0 items-center gap-cozy rounded-lg border border-border bg-card p-cozy transition-colors hover:bg-muted/60 focus:outline-none focus-visible:border-iris"
      >
        <Avatar avatarPath={sellerAvatarPath} displayName={name} size="md" />
        <span className="flex min-w-0 flex-1 flex-col gap-tight">
          <span className="flex min-w-0 items-center gap-tight">
            <span className="truncate text-body font-semibold">{name}</span>
            <IdentityBadge
              verified={sellerVerified}
              firstName={sellerFirstName}
              size={13}
              iconOnly
              hideNameWhen={name}
              className="shrink-0"
            />
          </span>
          <StarRating
            rating={sellerRating}
            count={sellerRatingCount}
            size={12}
            className="text-meta"
          />
          <span className="truncate text-meta text-muted-foreground">
            {sellerIdentity && !isOwner ? (
              <>
                {sellerIdentity.nameIsDocumentVerified ? 'Real name' : 'Stated name'}{' '}
                <span className="font-medium text-foreground">
                  {displayLegalName(sellerIdentity.legalEntityName)}
                </span>
                {sellerIdentity.tradingName ? (
                  <>
                    {' · '}
                    Trading as {sellerIdentity.tradingName}
                  </>
                ) : null}
              </>
            ) : isOwner ? (
              'Buyers see your verified name here'
            ) : (
              'Name not verified yet'
            )}
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </Link>

      {/* Message lives with the seller it goes to. It was a fourth unlabelled glyph in
          the bottom bar, competing with Offer, Trade and Buy. */}
      {sellerAction ? <div className="mt-snug">{sellerAction}</div> : null}

      <ExpandableDescription text={descriptionBody} className="mt-group" />

      {showTrust ? <ListingTrustRows className="mt-group" /> : null}
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
