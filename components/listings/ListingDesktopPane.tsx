import type { ReactNode } from 'react';
import Link from 'next/link';
import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { TrustedSellerBadge } from '@/components/identity/TrustedSellerBadge';
import { WatchButton } from '@/components/listings/WatchButton';
import { StarRating } from '@/components/listings/StarRating';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { ListedPrice } from '@/components/listings/ListedPrice';
import { publicLocationLabel } from '@/lib/location/publicLocation';
import { ListingProtectionLine } from '@/components/listings/ListingTrust';
import { displayLegalName, formatRelativeTime } from '@/lib/format';

/* The fee-inclusive, whole-unit figure and `splitMoney` are in
   `lib/listings/buyerPrice.ts`. */

/**
 * The pre-mobile desktop listing column: title and price first (with the buyer fee
 * note under the price), seller in a card, then the description and the listing's
 * details, with the action stack and the one-line buyer protection strip pinned to
 * the bottom. Phone layout stays in ListingDetailStack.
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
  initialWatching,
  sellerId,
  sellerDisplayName,
  sellerAvatarPath,
  sellerVerified,
  sellerTrusted = false,
  sellerFirstName,
  sellerRating,
  sellerRatingCount,
  sellerIdentity,
  locationLabel,
  createdAt,
  showTrust,
  pricePlaceholder,
  condition = null,
  watchCount = 0,
  children,
}: {
  /**
   * The item's condition, stated in the meta line under the price ("Unopened · Listed
   * 21 Sept · Croydon"), as Depop states it. It used to be a badge above the title.
   */
  condition?: string | null;
  /**
   * How many members have saved it: on the heart when the viewer can save, otherwise
   * in the meta line, so it is shown once either way.
   */
  watchCount?: number;
  /** A buyer who can buy: the fee note under the price and the protection strip. */
  showTrust: boolean;
  /**
   * Shown in place of the price while there is none yet (the listing editor's
   * preview), as `ListingDetailStack` does. The fee note goes with it.
   */
  pricePlaceholder?: string;
  title: string;
  description: string;
  priceCents: number;
  /** `items.currency`, the currency the fee-inclusive headline is shown in. */
  currency: string;
  isShopfront: boolean;
  itemId: string;
  isOwner: boolean;
  showWatch: boolean;
  initialWatching: boolean;
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
  // buyer is actually charged — the same figure as its catalog tile (`ListedPrice`).

  return (
    <div className="hidden h-full flex-col gap-group lg:flex">
      <header className="flex items-center justify-between gap-cozy">
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 break-words text-balance text-head font-semibold tracking-tight">
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
          {pricePlaceholder ? (
            <p className="mt-tight font-display text-display font-semibold tracking-tight text-muted-foreground/60">
              {pricePlaceholder}
            </p>
          ) : (
          <p className="mt-tight font-display font-semibold tabular-nums tracking-tight">
            {isShopfront ? (
              <span className="mr-tight text-body font-medium text-muted-foreground">
                from{' '}
              </span>
            ) : null}
            {/* In the viewer's own currency, approximately, when the listing is priced
                in another one (0179). The Buy dialog shows the real charge. */}
            <ListedPrice
              priceCents={priceCents}
              currency={currency}
              isShopfront={isShopfront}
              classNames={{
                symbol: 'text-lead font-semibold text-muted-foreground',
                major: 'text-display',
                minor: 'text-lead font-semibold text-muted-foreground',
                code: 'text-body font-semibold text-muted-foreground',
              }}
            />
          </p>
          )}
          {/* No "Includes $X buyer protection fee" line under the price (2026-11-23, product
              decision: the buyer just needs the price). The Pay dialog itemises it. */}

          {/* WHAT THE MAP USED TO SAY, IN ONE LINE.
              
              A 224px static map of a suburb answers "where is this, roughly" and costs a
              third of the column plus a Maps request. The line answers the same question
              and adds listing age, which the map never showed and which every resale
              reference puts on the page — a card listed four hours ago and one listed
              four months ago are different propositions at the same price. */}
          {/* `min-h-[1lh]`: the line holds its height when it has nothing to say yet
              (the editor's preview of a new listing with no place), so the kind arriving
              in it does not push the seller card down. */}
          <p
            className="mt-1.5 min-h-[1lh] text-meta text-muted-foreground"
            suppressHydrationWarning
          >
            {[
              // Kept to one short line. That nothing on a binder is held is said by the
              // buy bar, at the moment it applies.
              isShopfront ? 'Multiple items' : null,
              condition,
              listedAgo ? `Listed ${listedAgo}` : null,
              // Suburb and state only, never a street (see publicLocationLabel).
              publicLocationLabel(locationLabel),
              // The save count rides on the heart when there is one to press.
              !showWatch && watchCount > 0
                ? watchCount === 1
                  ? '1 save'
                  : `${watchCount} saves`
                : null,
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
            {/* The count beside the heart, as on the catalog tile, so how many
                members saved it sits on the control that saves it. */}
            <WatchButton
              itemId={itemId}
              initialWatching={initialWatching}
              variant="icon"
              count={watchCount}
              className={watchCount > 0 ? 'gap-1 md:w-auto md:px-2' : undefined}
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
                <TrustedSellerBadge
                  trusted={sellerTrusted}
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
                    className="inline-flex rounded-sm border border-transparent transition-colors hover:opacity-80 focus:outline-none focus-visible:border-ring"
                  >
                    <StarRating
                      rating={sellerRating}
                      count={sellerRatingCount}
                      size={12}
                      className="text-meta"
                    />
                    <span className="sr-only">Read seller reviews</span>
                  </Link>
                )
              ) : (
                // Unrated: the same one-line box, so the seller card and the
                // description below it are one height for every seller.
                <p className="inline-flex border border-transparent text-meta text-muted-foreground">
                  No ratings yet
                </p>
              )}
              {sellerIdentity && !isOwner ? (
                // ONE LINE, clipped, so a trading name cannot wrap the card taller.
                <dl className="flex min-w-0 flex-nowrap gap-x-cozy gap-y-0 overflow-hidden whitespace-nowrap text-meta leading-snug">
                  <div className="flex min-w-0 gap-tight">
                    <dt className="shrink-0 text-muted-foreground">
                      {sellerIdentity.nameIsDocumentVerified
                        ? 'Real name'
                        : 'Stated name'}
                    </dt>
                    <dd className="min-w-0 truncate font-medium">
                      {displayLegalName(sellerIdentity.legalEntityName)}
                    </dd>
                  </div>
                  {sellerIdentity.tradingName ? (
                    <div className="flex min-w-0 gap-tight">
                      <dt className="shrink-0 text-muted-foreground">
                        Trading as
                      </dt>
                      <dd className="min-w-0 truncate font-medium">
                        {sellerIdentity.tradingName}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                // No disclosure, or the owner's own listing: the line stays, neutral.
                <p className="truncate text-meta leading-snug text-muted-foreground">
                  {isOwner ? 'Buyers see your verified name here' : 'Name not verified yet'}
                </p>
              )}
            </div>
          </div>
        </Card>
      </section>

      {/* No multi-item notice between the seller card and the description — see the
          matching note in `ListingDetailStack`. The kind is in the meta line, and the
          action stack says what a request does at the point of doing it. */}

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
      <div className="mt-auto space-y-group pt-group">
        {children}
        {/* The one-line buyer protection strip, directly under the actions it
            reassures. */}
        {showTrust ? (
          <ListingProtectionLine isShopfront={isShopfront} headingId="listing-protection-heading" />
        ) : null}
      </div>
    </div>
  );
}
