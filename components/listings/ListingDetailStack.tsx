import Link from 'next/link';
import { Library } from 'lucide-react';

import { ExpandableDescription } from '@/components/listings/ExpandableDescription';
import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { StarRating } from '@/components/listings/StarRating';
import { Avatar } from '@/components/ui/avatar';
import { formatAud } from '@/lib/format';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';

export function ListingDetailStack({
  title,
  description,
  priceCents,
  condition,
  category,
  isShopfront,
  locationLabel,
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
}: {
  title: string;
  description: string;
  priceCents: number;
  condition: string;
  category: string | null;
  isShopfront: boolean;
  locationLabel: string | null;
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
}) {
  const kindLabel = isShopfront ? 'Binder listing' : 'Single item';
  const savesLabel =
    watchCount === 1 ? '1 save' : `${watchCount} saves`;
  const meta = [savesLabel, category, kindLabel].filter(Boolean).join(' · ');
  const name = isOwner ? 'You' : (sellerDisplayName ?? 'Seller');

  return (
    <div className="flex flex-col">
      <Link
        href={isOwner ? '/profile' : `/sellers/${sellerId}`}
        transitionTypes={['nav-forward']}
        className="flex min-h-11 items-center gap-2 rounded-md border border-transparent py-1 focus:outline-none focus-visible:border-gold/40"
      >
        <Avatar
          avatarPath={sellerAvatarPath}
          displayName={name}
          size="xs"
          className="size-7"
        />
        <span className="truncate text-body font-semibold">{name}</span>
        <IdentityBadge
          verified={sellerVerified}
          firstName={sellerFirstName}
          size={12}
          iconOnly
          hideNameWhen={name}
          className="shrink-0"
        />
        {locationLabel ? (
          <span className="ml-auto truncate pl-2 text-meta text-muted-foreground">
            {locationLabel}
          </span>
        ) : null}
      </Link>

      {sellerIdentity && !isOwner ? (
        <p className="mt-1 text-meta text-muted-foreground">
          {sellerIdentity.nameIsDocumentVerified ? 'Real name' : 'Stated name'}{' '}
          <span className="font-medium text-foreground">
            {sellerIdentity.legalEntityName}
          </span>
          {sellerIdentity.tradingName ? (
            <>
              {' · '}
              Trading as {sellerIdentity.tradingName}
            </>
          ) : null}
        </p>
      ) : null}

      {sellerRating != null ? (
        isOwner ? (
          <StarRating
            rating={sellerRating}
            count={sellerRatingCount}
            size={12}
            className="mt-1 text-meta"
          />
        ) : (
          <Link
            href={`/sellers/${sellerId}#reviews`}
            className="mt-1 inline-flex w-fit rounded-sm border border-transparent focus:outline-none focus-visible:border-gold/40"
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

      <div className="mt-4 flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate font-display text-head font-bold leading-none tracking-[-0.03em] text-gold">
          {isShopfront ? (
            <span className="mr-1 text-body font-medium">from </span>
          ) : null}
          {formatAud(priceCents)}
        </p>
        <span className="shrink-0 rounded-full bg-parchment px-2 py-0.5 text-meta font-semibold text-muted-foreground">
          {condition}
        </span>
      </div>

      <p className="mt-2 text-meta text-muted-foreground">{meta}</p>

      {isShopfront ? (
        <p className="mt-4 flex gap-2 rounded-md border border-gold/30 bg-gold/10 p-2 text-body text-foreground">
          <Library className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
          <span>
            This is a binder listing. Browse the collection and request specific
            items — nothing is held until you agree on terms.
          </span>
        </p>
      ) : null}

      <h2 className="mt-4 line-clamp-2 text-balance text-subhead font-semibold tracking-tight">
        {title}
      </h2>

      <ExpandableDescription text={description} className="mt-2" />

      <dl className="mt-4 space-y-1">
        <DetailRow label="Condition" value={condition} />
        {category ? <DetailRow label="Game" value={category} /> : null}
        <DetailRow label="Listing type" value={kindLabel} />
        {locationLabel ? <DetailRow label="Location" value={locationLabel} /> : null}
      </dl>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-meta">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium text-foreground">{value}</dd>
    </div>
  );
}
