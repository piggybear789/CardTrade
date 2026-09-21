import type { ReactNode } from 'react';
import Link from 'next/link';
import { ExpandableDescription } from '@/components/listings/ExpandableDescription';
import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { StarRating } from '@/components/listings/StarRating';
import { Avatar } from '@/components/ui/avatar';
import { formatAud, formatRelativeTime } from '@/lib/format';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import {
  buyerPaysCents,
  PLATFORM_FEE_LABEL,
  splitMoney,
} from '@/lib/listings/buyerPrice';

export function ListingDetailStack({
  title,
  description,
  priceCents,
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
  afterDescription,
}: {
  title: string;
  description: string;
  priceCents: number;
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
  /** Photos (or anything else) that should sit immediately under the copy. */
  afterDescription?: ReactNode;
}) {
  // "Multiple items", matching the listing form's own choice. It was "Binder listing",
  // a hobby word for a ring binder of trade stock that described stationery to
  // anyone else and was wrong for a lot of slabs or sealed product anyway.
  const kindLabel = isShopfront ? 'Multiple items' : 'Single item';
  const savesLabel = watchCount === 1 ? '1 save' : `${watchCount} saves`;
  // Relative, and hydration-suppressed where it renders — see the same note in
  // `ListingDesktopPane`. Listing age is what the meta line gained when the inline map
  // went: every resale reference carries it, and a card listed four hours ago is a
  // different proposition from one listed four months ago at the same price.
  const listedAgo = formatRelativeTime(createdAt);
  // A binder shows its own indicative "from" figure; a single listing shows what the
  // buyer is actually charged. See `buyerPaysCents`.
  const headline = splitMoney(
    formatAud(isShopfront ? priceCents : buyerPaysCents(priceCents)),
  );
  const desktopMeta = [savesLabel, category, kindLabel].filter(Boolean).join(' · ');
  const mobileMeta = [
    watchCount > 0 ? savesLabel : null,
    category,
    kindLabel,
    listedAgo ? `Listed ${listedAgo}` : null,
    locationLabel ? `Based in ${locationLabel}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const name = isOwner ? 'You' : (sellerDisplayName ?? 'Seller');

  return (
    <div className="flex flex-col">
      <Link
        href={isOwner ? '/profile' : `/sellers/${sellerId}`}
        transitionTypes={['nav-forward']}
        className="flex min-h-11 items-center gap-snug rounded-md border border-transparent py-tight focus:outline-none focus-visible:border-iris"
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
          <span className="ml-auto hidden truncate pl-snug text-meta text-muted-foreground lg:inline">
            {locationLabel}
          </span>
        ) : null}
      </Link>

      {sellerIdentity && !isOwner ? (
        <p className="mt-tight text-meta text-muted-foreground">
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
            className="mt-tight text-meta"
          />
        ) : (
          <Link
            href={`/sellers/${sellerId}#reviews`}
            className="mt-tight inline-flex w-fit rounded-sm border border-transparent focus:outline-none focus-visible:border-iris"
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

      <div className="mt-cozy flex items-center gap-cozy md:mt-group">
        {/* Price and its fee note share the flexible cell, so the condition pill keeps
            its own place at the end of the row rather than being pushed by the note.
            `items-baseline` inside, so the note annotates the figure. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-snug">
          {/* INK AND FEE-INCLUSIVE, matching the desktop pane. This was `text-iris-ink`,
              which the pastel retune moved money away from, and it showed the asking
              price while the real charge sat in muted 12px below. Symbol and cents
              recede so the dollars carry the weight at this size. */}
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
          {/* Four words, same as desktop. The escrow promise it used to carry is made at
              the buy bar, which is where it is the actual reassurance. */}
          {!isShopfront ? (
            <p className="text-meta text-muted-foreground">
              Including {PLATFORM_FEE_LABEL} NoDitto fee
            </p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-full bg-mist px-snug py-0.5 text-meta font-semibold text-muted-foreground">
          {condition}
        </span>
      </div>

      {/* The fee note moved onto the price row above. It matters most on a phone: the
          contract room's Payment tab is behind a bottom sheet, so without it the only
          figure a buyer sees before committing would be one that is 5% under the
          charge. Suppressed for a binder, whose price is an indicative "from". */}

      {mobileMeta ? (
        <p
          className="mt-snug text-meta text-muted-foreground md:hidden"
          suppressHydrationWarning
        >
          {mobileMeta}
        </p>
      ) : null}
      {desktopMeta ? (
        <p className="mt-snug hidden text-meta text-muted-foreground md:block">{desktopMeta}</p>
      ) : null}

      {/* NO MULTI-ITEM NOTICE HERE. A tinted card used to sit between the meta line and
          the description explaining that a multi-item listing is browsed and requested
          from. The kind is already in the meta line above, and the buy bar's own copy
          ("Request", "Nothing is held for you yet") says the rest at the moment it
          applies — so this was a third statement of the same fact, in a box. */}

      <h2 className="sr-only md:hidden">{title}</h2>
      <h2 className="mt-group hidden line-clamp-2 text-balance text-subhead font-semibold tracking-tight md:block">
        {title}
      </h2>
      <ExpandableDescription text={description} className="mt-cozy md:hidden" />
      <ExpandableDescription
        text={descriptionBodyAfterTitle(title, description)}
        className="mt-snug hidden md:block"
      />

      {afterDescription}

      <dl className="mt-group hidden space-y-tight lg:block">
        <DetailRow label="Condition" value={condition} />
        {category ? <DetailRow label="Game" value={category} /> : null}
        <DetailRow label="Listing type" value={kindLabel} />
        {locationLabel ? <DetailRow label="Location" value={locationLabel} /> : null}
      </dl>
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-cozy text-meta">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium text-foreground">{value}</dd>
    </div>
  );
}
