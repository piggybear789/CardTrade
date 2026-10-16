'use client';

// components/trustedSellers/TrustedSellerDirectory.tsx
//
// The public list of Trusted Sellers on `/trusted-sellers` (0152).
//
// THE HANDLE LEADS. A seller's public identity in this market is where they already
// sell: their Instagram (or X, website, ...), so the row's headline is that handle with
// its platform mark, linking out. The NoDitto display name, verified first name and
// tenure follow on the line under it. The row itself ("View profile") opens their
// NoDitto profile, which is the vetting record: ID check, tenure and reviews.
//
// ONE ROW PER SELLER, AND THE ROW SHOWS THE CARDS. Each row carries a small fanned hand
// of the seller's newest listing photos, card-shaped (5:7). That hand is the page's one
// decorative move; everything else stays quiet.
//
// ONLY FACTS THAT EXIST. A missing rating or an empty inventory renders nothing rather
// than "No ratings yet" / "0 listings" on every row. The verified first name is shown
// only when the display name does not already contain it.
//
// NO RANK NUMBERS. Numbering sellers reads as NoDitto ranking one above another, which
// is a stronger endorsement than the badge makes. The sort is the buyer's choice.
//
// ONE GENERAL LIST, NO REGION FILTER. Location is a column (the member's trading
// country), and search matches it, so a buyer narrows by place themselves. Whether a
// purchase can go ahead is still decided by `checkRegionCompatibility` at Buy.
//
// LINKS. "View profile" is stretched over the whole row (`after:inset-0`). The
// handle and the card photos sit above it (`relative z-10`), so each is its own anchor
// rather than a link nested inside a link.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { Location01Icon, Search01Icon, ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { TrustedSellerBadge } from '@/components/identity/TrustedSellerBadge';
import { StarRating } from '@/components/listings/StarRating';
import { SocialPlatformIcon } from '@/components/profile/SocialPlatformIcon';
import { Avatar } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StorageImage } from '@/components/ui/storage-image';
import { regionLabel } from '@/domain/region';
import { displayLegalName, formatMonthYear } from '@/lib/format';
import type { TrustedSellerDirectoryEntry } from '@/lib/trustedSellers/directory';
import { cn } from '@/lib/utils';

type SortKey = 'reviews' | 'rating' | 'listings' | 'newest';

const SORT_LABEL: Record<SortKey, string> = {
  reviews: 'Most reviewed',
  rating: 'Top rated',
  listings: 'Most listings',
  newest: 'Newest members',
};

/** The fanned hand: each card's tilt, so the strip reads as cards held, not tiles. */
const FAN = ['-rotate-6', '-rotate-2', 'rotate-2', 'rotate-6'] as const;

function sortSellers(sellers: TrustedSellerDirectoryEntry[], key: SortKey) {
  const byName = (a: TrustedSellerDirectoryEntry, b: TrustedSellerDirectoryEntry) =>
    a.displayName.localeCompare(b.displayName);
  return [...sellers].sort((a, b) => {
    switch (key) {
      case 'rating':
        return (b.rating ?? -1) - (a.rating ?? -1) || b.ratingCount - a.ratingCount || byName(a, b);
      case 'listings':
        return b.liveListings - a.liveListings || byName(a, b);
      case 'newest':
        return (b.memberSince ?? '').localeCompare(a.memberSince ?? '') || byName(a, b);
      default:
        return b.ratingCount - a.ratingCount || (b.rating ?? -1) - (a.rating ?? -1) || byName(a, b);
    }
  });
}

/** "ID verified · Alice", or just "ID verified" when the name already says it. */
function identityFact(seller: TrustedSellerDirectoryEntry): string | null {
  if (!seller.identityVerified) return null;
  const first = displayLegalName(seller.firstName);
  if (!first) return 'ID verified';
  return seller.displayName.toLowerCase().includes(first.toLowerCase())
    ? 'ID verified'
    : `ID verified · ${first}`;
}

function CardHand({ seller }: { seller: TrustedSellerDirectoryEntry }) {
  if (seller.previews.length === 0) return null;
  const more = seller.liveListings - seller.previews.length;
  return (
    <div className="relative z-10 hidden shrink-0 items-center md:flex" aria-label={`${seller.liveListings} listings`}>
      <div className="flex items-center pl-snug">
        {seller.previews.map((preview, index) => (
          <Link
            key={preview.id}
            href={`/listings/${preview.id}`}
            transitionTypes={['nav-forward']}
            title={preview.title}
            className={cn(
              '-ml-snug block h-14 w-10 overflow-hidden rounded-[3px] border border-border bg-muted shadow-sm ring-2 ring-card transition-transform duration-150',
              'hover:z-10 hover:-translate-y-1 hover:rotate-0 focus-visible:z-10 focus-visible:-translate-y-1 focus-visible:rotate-0 focus:outline-none focus-visible:ring-ring',
              'motion-reduce:transition-none',
              FAN[index % FAN.length],
            )}
          >
            <span className="sr-only">{preview.title}</span>
            <StorageImage
              src={preview.imageUrl}
              alt=""
              aria-hidden
              width={40}
              height={56}
              className="size-full object-cover"
            />
          </Link>
        ))}
      </div>
      {more > 0 ? (
        <span className="ml-snug text-meta tabular-nums text-muted-foreground">+{more}</span>
      ) : null}
    </div>
  );
}

export function TrustedSellerDirectory({ sellers }: { sellers: TrustedSellerDirectoryEntry[] }) {
  const [sort, setSort] = useState<SortKey>('reviews');
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^@/, '');
    const matched = needle
      ? sellers.filter((seller) =>
          [
            seller.displayName,
            seller.firstName ?? '',
            seller.contact?.handle ?? '',
            seller.regionCode ? regionLabel(seller.regionCode) : '',
          ]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : sellers;
    return sortSellers(matched, sort);
  }, [sellers, query, sort]);

  if (sellers.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-section text-center text-body text-muted-foreground">
        No Trusted Sellers yet.
      </p>
    );
  }

  return (
    <div className="space-y-group">
      {/* TOOLBAR: count, search, sort. One row from `sm`, stacked below it. */}
      <div className="flex flex-col gap-snug sm:flex-row sm:items-center">
        <p className="shrink-0 text-body text-muted-foreground sm:mr-snug">
          <span className="font-medium tabular-nums text-foreground">{shown.length}</span>{' '}
          {shown.length === 1 ? 'seller' : 'sellers'}
        </p>

        <div className="relative min-w-0 flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute left-cozy top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by handle, name or country"
            aria-label="Search Trusted Sellers by handle, name or country"
            className="h-10 rounded-full pl-9"
          />
        </div>

        <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
          <SelectTrigger className="h-10 w-full rounded-full sm:w-44" aria-label="Sort sellers">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
              <SelectItem key={key} value={key}>
                {SORT_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="sr-only" aria-live="polite">
        {shown.length} {shown.length === 1 ? 'seller' : 'sellers'} shown
      </p>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-section text-center text-body text-muted-foreground">
          No Trusted Sellers match that search.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {shown.map((seller) => {
            const since = formatMonthYear(seller.memberSince);
            const identity = identityFact(seller);
            const location = seller.regionCode ? regionLabel(seller.regionCode) : null;
            const facts = [since ? `Since ${since}` : null].filter(
              (fact): fact is string => Boolean(fact),
            );
            const rated = seller.ratingCount > 0 && seller.rating != null;

            const contact = seller.contact;
            // A username reads with an @; a website hostname or a Discord tag does not.
            const handle = contact
              ? contact.slug === 'website' || contact.slug === 'discord'
                ? contact.handle
                : `@${contact.handle}`
              : null;

            return (
              <li
                key={seller.id}
                className="relative flex items-center gap-group px-group py-cozy transition-colors hover:bg-muted/40"
              >
                <Avatar avatarPath={seller.avatarPath} displayName={seller.displayName} size="md" />

                <div className="min-w-0 flex-1 space-y-0.5">
                  {/* HEADLINE: where they already sell. Falls back to the display name
                      only for a seller who has removed every link. */}
                  <div className="flex min-w-0 items-center gap-tight">
                    {contact && handle ? (
                      contact.url ? (
                        <a
                          href={contact.url}
                          target="_blank"
                          // `nofollow ugc`: a member-supplied link on a page NoDitto
                          // vouches for should not pass that standing on.
                          rel="noopener noreferrer nofollow ugc"
                          aria-label={`${handle} on ${contact.label} (opens in a new tab)`}
                          className="relative z-10 inline-flex min-w-0 items-center gap-tight text-lead font-semibold tracking-tight text-foreground underline-offset-4 hover:underline focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <SocialPlatformIcon slug={contact.slug} className="size-4 text-muted-foreground" />
                          <span className="truncate">{handle}</span>
                        </a>
                      ) : (
                        <span className="relative z-10 inline-flex min-w-0 items-center gap-tight text-lead font-semibold tracking-tight text-foreground">
                          <SocialPlatformIcon slug={contact.slug} className="size-4 text-muted-foreground" />
                          <span className="truncate">{handle}</span>
                          <span className="sr-only">on {contact.label}</span>
                        </span>
                      )
                    ) : (
                      <span className="truncate text-lead font-semibold tracking-tight text-foreground">
                        {seller.displayName}
                      </span>
                    )}
                    <TrustedSellerBadge trusted size={16} iconOnly className="shrink-0" />
                  </div>

                  {/* THE NAME AS A SIDE NOTE: NoDitto display name first, then what
                      Stripe checked, then where and since when. */}
                  <p className="flex min-w-0 flex-wrap items-center gap-x-snug gap-y-0.5 text-body text-muted-foreground">
                    {contact ? (
                      <span className="font-medium text-foreground/80">{seller.displayName}</span>
                    ) : null}
                    {identity ? (
                      <span className="inline-flex items-center gap-x-snug">
                        {contact ? <span aria-hidden>·</span> : null}
                        <span className="inline-flex items-center gap-tight font-medium text-trust">
                          <HugeiconsIcon icon={ShieldCheckIcon} className="size-3.5" aria-hidden />
                          {identity}
                        </span>
                      </span>
                    ) : null}
                    {facts.map((fact, index) => (
                      <span key={index} className="inline-flex items-center gap-x-snug">
                        {contact || identity || index > 0 ? <span aria-hidden>·</span> : null}
                        {fact}
                      </span>
                    ))}
                    {/* Phone only: the location column below has no room. */}
                    {location ? (
                      <span className="inline-flex items-center gap-x-snug sm:hidden">
                        <span aria-hidden>·</span>
                        <HugeiconsIcon icon={Location01Icon} className="size-3.5" aria-hidden />
                        {location}
                      </span>
                    ) : null}
                  </p>

                  {rated || seller.liveListings > 0 ? (
                    <p className="flex items-center gap-x-snug text-meta text-muted-foreground">
                      {rated ? (
                        <StarRating rating={seller.rating} count={seller.ratingCount} size={12} />
                      ) : null}
                      {rated && seller.liveListings > 0 ? <span aria-hidden>·</span> : null}
                      {seller.liveListings > 0 ? (
                        <span className="tabular-nums">
                          {seller.liveListings === 1 ? '1 listing' : `${seller.liveListings} listings`}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </div>

                {/* LOCATION, its own column from `sm`: a fixed width so it lines up
                    down the list. The member's trading country, never the suburb. */}
                <p className="hidden w-32 shrink-0 items-center gap-tight text-body text-muted-foreground sm:flex">
                  <HugeiconsIcon icon={Location01Icon} className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{location ?? '—'}</span>
                </p>

                <CardHand seller={seller} />

                {/* THEIR PROFILE: the vetting record (ID check, tenure, reviews).
                    Stretched over the whole row, so anywhere that is not the handle or
                    a card photo opens it. */}
                <Link
                  href={`/sellers/${seller.id}`}
                  transitionTypes={['nav-forward']}
                  aria-label={`View ${seller.displayName}'s profile`}
                  className="inline-flex h-9 shrink-0 items-center rounded-full border border-border px-cozy text-body font-medium text-foreground transition-colors after:absolute after:inset-0 after:content-[''] hover:border-foreground/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="hidden sm:inline">View profile</span>
                  <span className="sm:hidden">View</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
