import type { ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { LibraryIcon } from '@hugeicons/core-free-icons';

import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { WatchButton } from '@/components/listings/WatchButton';
import { StarRating } from '@/components/listings/StarRating';
import { PlaceMap } from '@/components/location';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { formatAud } from '@/lib/format';
import type { PlacePrecision } from '@/lib/location/types';

/**
 * The pre-mobile desktop listing column: title and price first, seller in a
 * card, then description and location. Phone layout stays in ListingDetailStack.
 */
export function ListingDesktopPane({
  title,
  description,
  priceCents,
  isShopfront,
  itemId,
  isOwner,
  showWatch,
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
  locationLat,
  locationLng,
  locationPrecision,
  children,
}: {
  title: string;
  description: string;
  priceCents: number;
  isShopfront: boolean;
  itemId: string;
  isOwner: boolean;
  showWatch: boolean;
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
  locationLat: number | null;
  locationLng: number | null;
  locationPrecision: PlacePrecision;
  children: ReactNode;
}) {
  const name = isOwner ? 'You' : (sellerDisplayName ?? 'Unknown seller');

  return (
    <div className="hidden h-full flex-col gap-4 lg:flex">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-balance text-head font-semibold tracking-tight">
            {title}
          </h2>
          <p className="mt-1 text-lead font-semibold tabular-nums tracking-tight">
            {isShopfront ? (
              <span className="mr-1 text-body font-medium text-muted-foreground">
                from{' '}
              </span>
            ) : null}
            {formatAud(priceCents)}
          </p>
        </div>
        {showWatch ? (
          <div
            className="flex shrink-0 items-center"
            role="group"
            aria-label="Listing actions"
          >
            <WatchButton
              itemId={itemId}
              initialWatching={initialWatching}
              variant="icon"
            />
            <ReportDialog
              targetType="item"
              targetId={itemId}
              triggerLabel="Report listing"
              appearance="icon-only"
            />
          </div>
        ) : null}
      </header>

      <section aria-labelledby="seller-heading">
        <h2 id="seller-heading" className="sr-only">
          Seller
        </h2>
        <Card className="p-group">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar
              avatarPath={sellerAvatarPath}
              displayName={name}
              size="md"
            />
            <div className="min-w-0 space-y-tight">
              <div className="flex min-w-0 items-center gap-1">
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
                  <StarRating
                    rating={sellerRating}
                    count={sellerRatingCount}
                    size={12}
                    className="text-meta"
                  />
                ) : (
                  <Link
                    href={`/sellers/${sellerId}#reviews`}
                    className="inline-flex rounded-sm border border-transparent transition-colors hover:opacity-80 focus:outline-none focus-visible:border-iris"
                    aria-label="Read seller reviews"
                  >
                    <StarRating
                      rating={sellerRating}
                      count={sellerRatingCount}
                      size={12}
                      className="text-meta"
                    />
                  </Link>
                )
              ) : null}
              {sellerIdentity && !isOwner ? (
                <dl className="flex min-w-0 flex-wrap gap-x-3 gap-y-0 text-meta leading-snug">
                  <div className="flex min-w-0 gap-tight">
                    <dt className="shrink-0 text-muted-foreground">
                      {sellerIdentity.nameIsDocumentVerified
                        ? 'Real name'
                        : 'Stated name'}
                    </dt>
                    <dd className="min-w-0 break-words font-medium">
                      {sellerIdentity.legalEntityName}
                    </dd>
                  </div>
                  {sellerIdentity.tradingName ? (
                    <div className="flex min-w-0 gap-tight">
                      <dt className="shrink-0 text-muted-foreground">
                        Trading as
                      </dt>
                      <dd className="min-w-0 break-words font-medium">
                        {sellerIdentity.tradingName}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </div>
          </div>
        </Card>
      </section>

      {isShopfront ? (
        <p className="flex gap-2 rounded-md border border-iris/30 bg-iris/10 p-2 text-body text-foreground">
          <HugeiconsIcon icon={LibraryIcon} className="mt-0.5 size-4 shrink-0 text-iris-ink" aria-hidden />
          <span>
            This is a binder listing. Browse the collection and request specific
            items — nothing is held until you agree on terms.
          </span>
        </p>
      ) : null}

      {description.trim() ? (
        <section aria-labelledby="description-heading">
          <h2
            id="description-heading"
            className="mb-tight text-meta font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Description
          </h2>
          <p className="whitespace-pre-line break-words text-body leading-relaxed text-foreground">
            {description}
          </p>
        </section>
      ) : null}

      {locationLabel || (locationLat != null && locationLng != null) ? (
        <section aria-labelledby="location-heading" className="space-y-2">
          <h2
            id="location-heading"
            className="text-meta font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Based near
          </h2>
          <PlaceMap
            lat={locationLat}
            lng={locationLng}
            label={locationLabel}
            precision={locationPrecision}
            presentation="inline"
          />
        </section>
      ) : null}

      <div className="mt-auto space-y-4 pt-4">{children}</div>
    </div>
  );
}
