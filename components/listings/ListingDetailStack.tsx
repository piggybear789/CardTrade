import type { ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { ExpandableDescription } from '@/components/listings/ExpandableDescription';
import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { TrustedSellerBadge } from '@/components/identity/TrustedSellerBadge';
import { StarRating } from '@/components/listings/StarRating';
import { Avatar } from '@/components/ui/avatar';
import { displayLegalName, formatMoney, formatRelativeTime } from '@/lib/format';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { listedPriceCents, splitMoney } from '@/lib/listings/buyerPrice';
import { ListingFeeNote, ListingProtectionLine } from '@/components/listings/ListingTrust';
import { cn } from '@/lib/utils';

/**
 * The listing below `lg`, in the order every resale marketplace uses: the photos,
 * then what it is, what it costs (with the buyer fee note and, on a phone, the
 * one-line buyer protection strip), who is selling it, what they say about it, and
 * the listing's details.
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
  sellerTrusted = false,
  sellerFirstName,
  sellerRating,
  sellerRatingCount,
  sellerIdentity,
  media,
  details,
  showTrust = false,
}: {
  /** `ListingDetails`, under the description. */
  details?: ReactNode;
  /** A buyer who can buy: the fee note under the price and the protection strip. */
  showTrust?: boolean;
  title: string;
  description: string;
  priceCents: number;
  /** `items.currency`, the currency the fee-inclusive headline is shown in. */
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
  /** `public_profiles.is_trusted_seller` (0152). */
  sellerTrusted?: boolean;
  sellerFirstName: string | null;
  sellerRating: number | null;
  sellerRatingCount: number | undefined;
  sellerIdentity: SellerIdentityDisclosure | null;
  /** The photo carousel, which heads the stack. */
  media?: ReactNode;
}) {
  // Kept to one short line. That nothing on a binder is held is said by the buy bar,
  // at the moment it applies.
  const kindLabel = isShopfront ? 'Binder' : null;
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
    locationLabel,
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
          'line-clamp-2 break-words text-balance text-subhead font-semibold tracking-tight md:text-head',
          media ? 'mt-group' : null,
        )}
      >
        {title}
      </h2>

      <div className="mt-snug flex items-center gap-cozy">
        {/* INK AND FEE-INCLUSIVE, matching the desktop pane. Symbol and cents recede
            so the dollars carry the weight at this size. */}
        <p className="min-w-0 flex-1 font-display font-bold leading-none tracking-tight text-foreground">
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
          {headline.code ? (
            <span className="text-body font-semibold text-muted-foreground">
              {headline.code}
            </span>
          ) : null}
        </p>
        <span className="shrink-0 rounded-full bg-mist px-snug py-0.5 text-meta font-semibold text-muted-foreground">
          {condition}
        </span>
      </div>
      {/* "Includes $X buyer fee" and the (i) breakdown, directly under the price, as
          on desktop. Buyers who can buy only, and never on a binder, whose price is
          an indicative "from". */}
      {showTrust && !isShopfront ? (
        <ListingFeeNote priceCents={priceCents} currency={currency} className="mt-tight" />
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

      {/* Phones only. Below `md` the actions are the sticky buyer bar, so there is no
          "under the actions" to put the strip in; it sits with the price instead. From
          `md` the page renders it under the in-flow action stack. */}
      {showTrust ? (
        <ListingProtectionLine
          isShopfront={isShopfront}
          headingId="listing-protection-heading-stack"
          className="mt-snug md:hidden"
        />
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
        className="mt-group flex min-w-0 items-center gap-cozy rounded-lg border border-border bg-card p-cozy transition-colors hover:bg-muted/60 focus:outline-none focus-visible:border-ring"
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
            <TrustedSellerBadge
              trusted={sellerTrusted}
              size={13}
              iconOnly
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
