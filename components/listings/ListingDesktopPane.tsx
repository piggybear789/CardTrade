import type { ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { LibraryIcon } from '@hugeicons/core-free-icons';

import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { WatchButton } from '@/components/listings/WatchButton';
import { StarRating } from '@/components/listings/StarRating';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import {
  buyerPaysCents,
  PLATFORM_FEE_LABEL,
  splitMoney,
} from '@/lib/listings/buyerPrice';
import { formatAud, formatRelativeTime } from '@/lib/format';

/* `feePercentLabel` moved to `lib/listings/buyerPrice.ts` as `PLATFORM_FEE_LABEL`, with
   the fee-inclusive figure and `splitMoney`. It was declared identically here and in
   `ListingDetailStack`. */

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
  createdAt,
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
  /** `items.created_at`, for the listing-age clause of the meta line. */
  createdAt: string | null;
  children: ReactNode;
}) {
  const name = isOwner ? 'You' : (sellerDisplayName ?? 'Unknown seller');
  // Relative, so it reads as freshness rather than as a date to decode. Rendered under
  // `suppressHydrationWarning` because the server and the browser compute it a moment
  // apart — the same reason `InspectionCountdown` does. An absolute date is the wrong
  // answer here: "4h ago" is the whole point, and "12 Sep" is not.
  const listedAgo = formatRelativeTime(createdAt);
  // A binder shows its own indicative "from" figure; a single listing shows what the
  // buyer is actually charged. See `buyerPaysCents`.
  const headline = splitMoney(
    formatAud(isShopfront ? priceCents : buyerPaysCents(priceCents)),
  );

  return (
    <div className="hidden h-full flex-col gap-group lg:flex">
      <header className="flex items-center justify-between gap-cozy">
        <div className="min-w-0 flex-1">
          <h2 className="text-balance text-head font-semibold tracking-tight">
            {title}
          </h2>
          {/* THE PRICE LEADS THE PAGE, AND IT IS WHAT THE BUYER PAYS.
              
              Two problems, one fix. It was set at `text-lead` under a `text-head` title,
              so the single most important figure on a buy page was SMALLER than the
              heading above it — and it showed the seller's asking price while the real
              charge sat in muted 12px underneath. The prominent number was the one that
              would never be charged.
              
              Now the fee-inclusive figure at `text-display`, in the same three-part
              treatment the catalog tiles use — symbol and cents recede, the dollars that
              decide the purchase carry the weight. See `buyerPaysCents` for why
              inclusive, and for why this is not called a total.
              
              A SHOPFRONT KEEPS ITS ASKING PRICE. `priceCents` there is a whole binder's
              indicative "from" figure, so adding a precise fee to an imprecise number
              would be worse than saying nothing. */}
          {/* THE FEE NOTE RIDES THE PRICE'S BASELINE, rather than sitting on its own
              line beneath it. `items-baseline` is what makes that read as an annotation
              on the figure instead of a second statement about it — the note's text
              baseline lines up with the dollars, so the eye takes the two as one thing.
              `flex-wrap` so a narrow column drops it below instead of squeezing the
              price. */}
          <div className="mt-tight flex flex-wrap items-baseline gap-x-snug">
            <p className="font-semibold tabular-nums tracking-tight">
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
            {/* FOUR WORDS. This was a two-sentence paragraph that also promised escrow
                ("held until you accept the card") and hedged about postage. Both are
                true and neither belongs on a price: the escrow promise is made again at
                the buy button where it is the actual reassurance, and postage cannot be
                stated before terms anyway. What has to be here is the one fact that
                makes the figure above it honest — that it already contains the fee. */}
            {!isShopfront ? (
              <p className="text-meta text-muted-foreground">
                Including {PLATFORM_FEE_LABEL} NoDitto fee
              </p>
            ) : null}
          </div>

          {/* The fee note is on the price's own line above — see the comment there for
              why it is four words and why disclosure has to happen here at all: the 5%
              otherwise first appears in the contract room's Payment tab, which is the
              third tab of an inspector that sits behind a bottom sheet on a phone, so a
              buyer could reach the pay confirmation having only ever seen a figure that
              was 5% under what they are charged. */}

          {/* WHAT THE MAP USED TO SAY, IN ONE LINE.
              
              A 224px static map of a suburb answers "where is this, roughly" and costs a
              third of the column plus a Maps request. The line answers the same question
              and adds listing age, which the map never showed and which every resale
              reference puts on the page — a card listed four hours ago and one listed
              four months ago are different propositions at the same price. */}
          <p
            className="mt-1.5 text-meta text-muted-foreground"
            suppressHydrationWarning
          >
            {[
              isShopfront ? 'Binder listing' : 'Single item',
              listedAgo ? `Listed ${listedAgo}` : null,
              locationLabel ? `Based in ${locationLabel}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
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
          <div className="flex min-w-0 items-center gap-cozy">
            <Avatar
              avatarPath={sellerAvatarPath}
              displayName={name}
              size="md"
            />
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
                <dl className="flex min-w-0 flex-wrap gap-x-cozy gap-y-0 text-meta leading-snug">
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
        <p className="flex gap-snug rounded-md border border-border bg-iris/[0.07] p-snug text-body text-foreground">
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
          <p className="whitespace-pre-line break-words text-body text-foreground">
            {description}
          </p>
        </section>
      ) : null}

      {/* The "Based near" map section was here. It is now the location clause of the
          meta line under the price — same fact, one line instead of a 224px image, and
          the space goes to the description and the action stack. The suburb is all the
          precision a listing ever had (`precision="suburb"` on the form), so nothing was
          lost by not plotting it. */}

      {/* `mt-auto` pins the action stack to the bottom of the pane, which is what puts
          it inline with the bottom of the photo beside it — the two columns are
          equal-height siblings of one flex row.
          
          NO BOTTOM PADDING, and that is the point rather than an oversight. The column
          holding this pane used to carry `lg:pb-7`, which lifted the stack 28px above
          the image's bottom edge on every listing to protect the one case where a long
          description makes the column scroll. A `pb-group` here would be the same mistake at
          16px: padding inside this box still sits between the buttons and the edge they
          are supposed to line up with.
          
          So the overflow case is accepted instead: when a description is long enough to
          scroll, the buttons end flush with the cut. That is cosmetic and rare, and it
          only shows once someone has scrolled to the very bottom — whereas the
          misalignment it was guarding against was visible on every listing at rest. */}
      <div className="mt-auto space-y-group pt-group">{children}</div>
    </div>
  );
}
