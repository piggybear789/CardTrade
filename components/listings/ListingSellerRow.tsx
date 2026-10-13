// components/listings/ListingSellerRow.tsx
//
// Who is selling, as one borderless row: avatar, name with the verification mark and
// the rating on one line, the provider-verified name muted under it. The ONE seller
// row for both listing layouts — `ListingDetailStack` below `lg` and
// `ListingDesktopPane` from `lg` — because the two had already drifted apart (a
// bordered link card on phones, a `Card` on desktop) when each kept its own copy.
//
// FIXED GEOMETRY. Both lines always render: an unrated seller reads "No ratings yet"
// and an unverified one "Name not verified yet", so the description below sits at the
// same height for every listing. A divider above separates it from the actions; there
// is no box around it. "Message seller" is a chip in the action row (and, on phones,
// its own row under this one), not part of the row.
//
// The whole row is one link to the seller's profile (the owner's own profile for the
// owner). The separate `#reviews` rating link was dropped: an anchor inside the row's
// anchor would be nested interactive content, and the seller page carries the reviews.

import Link from 'next/link';

import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { StarRating } from '@/components/listings/StarRating';
import { Avatar } from '@/components/ui/avatar';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { displayLegalName } from '@/lib/format';

export function ListingSellerRow({
  headingId,
  sellerId,
  name,
  isOwner,
  avatarPath,
  verified,
  firstName,
  rating,
  ratingCount,
  identity,
  className,
}: {
  /** Unique per instance: the phone stack and the desktop pane are both in the DOM. */
  headingId: string;
  sellerId: string;
  /** The display name to print ("You" for the owner). */
  name: string;
  isOwner: boolean;
  avatarPath: string | null;
  verified: boolean;
  firstName: string | null;
  rating: number | null;
  ratingCount: number | undefined;
  identity: SellerIdentityDisclosure | null;
  className?: string;
}) {
  return (
    <section aria-labelledby={headingId} className={className}>
      <h2 id={headingId} className="sr-only">
        Seller
      </h2>
      <div className="flex min-w-0 items-center gap-cozy border-t border-border pt-group">
        <Link
          href={isOwner ? '/profile' : `/sellers/${sellerId}`}
          transitionTypes={['nav-forward']}
          className="flex min-w-0 flex-1 items-center gap-cozy rounded-md border border-transparent focus:outline-none focus-visible:border-iris"
        >
          <Avatar avatarPath={avatarPath} displayName={name} size="md" />
          <span className="flex min-w-0 flex-col gap-tight">
            <span className="flex min-w-0 items-center gap-tight">
              <span className="truncate text-body font-semibold">{name}</span>
              <IdentityBadge
                verified={verified}
                firstName={firstName}
                size={14}
                iconOnly
                hideNameWhen={name}
                className="shrink-0"
              />
              <StarRating
                rating={rating}
                count={ratingCount}
                size={12}
                className="ml-tight shrink-0 text-meta"
              />
            </span>
            {/* ONE LINE, clipped, so a trading name cannot wrap the row taller. */}
            <span className="truncate text-meta text-muted-foreground">
              {identity && !isOwner ? (
                <>
                  {identity.nameIsDocumentVerified ? 'Real name' : 'Stated name'}{' '}
                  <span className="font-medium text-foreground">
                    {displayLegalName(identity.legalEntityName)}
                  </span>
                  {identity.tradingName ? <> · Trading as {identity.tradingName}</> : null}
                </>
              ) : isOwner ? (
                'Buyers see your verified name here'
              ) : (
                'Name not verified yet'
              )}
            </span>
          </span>
        </Link>
      </div>
    </section>
  );
}
