'use client';

// components/references/ReferenceProfile.tsx
//
// A person's references page: a card for who they are, then a card for their
// Trust Network. Leaving a reference opens in a compact modal (`ShareExperience`).
// Everything about the person in the middle is read from the graph, so when the
// graph walks to someone else's page both cards go with it, and the page that
// loads behind the walk draws exactly what is already on screen.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeft01Icon,
  StarIcon,
} from '@hugeicons/core-free-icons';

import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { TrustedSellerBadge } from '@/components/identity/TrustedSellerBadge';
import { ClaimHandle } from '@/components/references/ClaimHandle';
import { PlatformChip, plural } from '@/components/references/referenceLabels';
import {
  TrustNetworkBody,
  TrustNetworkHeader,
  arrival,
  averageGraphRating,
  usePageOpener,
} from '@/components/references/ReferenceGraph';
import { ShareExperience } from '@/components/references/ShareExperience';
import { centreKeyOf, useTrustOrbits } from '@/components/references/useTrustOrbits';
import { Avatar } from '@/components/ui/avatar';
import { regionLabel } from '@/domain/region';
import type { MyHandleClaim } from '@/lib/actions/references';
import type { ReferenceGraphData } from '@/lib/references/graph';

export interface ReferenceViewer {
  /** The signed-in member, or null for a visitor. */
  id: string | null;
  identityVerified: boolean;
}

export function ReferenceProfile({
  data,
  viewer,
  autoOpen,
  initialClaim = null,
}: {
  data: ReferenceGraphData;
  viewer: ReferenceViewer;
  /** Open the share composer on arrival (from a reference request link), for this page's person only. */
  autoOpen: boolean;
  /** Initial handle claim state if the page's root handle is unclaimed. */
  initialClaim?: MyHandleClaim | null;
}) {
  const orbits = useTrustOrbits(data, { openPage: usePageOpener(true) });
  const { centre, nodes } = orbits.graph;
  const returnPath = `/references/${encodeURIComponent(centre.handleSlug)}`;
  const isSelf = viewer.id !== null && viewer.id === centre.profileId;
  const avgRating = averageGraphRating(nodes);
  const totalReviews = nodes.length;
  const details = [
    centre.name !== centre.handle.replace(/^@/, '') ? centre.name : null,
    centre.regionCode ? regionLabel(centre.regionCode) : null,
  ].filter(Boolean);
  const altHandles = Array.from(
    new Set(
      centre.linkedHandles
        .map((lh) => lh.handle)
        .filter((h) => h.toLowerCase() !== centre.handle.toLowerCase()),
    ),
  );

  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-2xl border border-border/90 bg-card p-5 shadow-xs sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full bg-iris/[0.06] blur-2xl"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3.5" style={{ opacity: arrival(orbits) }}>
            <Link
              href="/references"
              aria-label="Back to references"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/35 text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
            </Link>

            <Avatar avatarPath={centre.avatarPath} displayName={centre.name} size="lg" />

            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <h1 className="break-all text-subhead font-semibold tracking-tight text-foreground md:text-head">
                  {centre.handle}
                </h1>
                <IdentityBadge
                  verified={centre.identityVerified}
                  firstName={centre.firstName}
                  iconOnly
                  size={18}
                />
                <TrustedSellerBadge trusted={centre.isTrustedSeller} iconOnly size={18} />
                {centre.platforms.length > 0 ? (
                  <span className="ml-0.5 inline-flex flex-wrap items-center gap-1">
                    {centre.platforms.slice(0, 6).map((p) => (
                      <PlatformChip key={p.slug} slug={p.slug} />
                    ))}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-muted-foreground">
                {details.length > 0 ? <span>{details.join(' · ')}</span> : null}
                {details.length > 0 && (avgRating !== null || totalReviews > 0) ? (
                  <span aria-hidden className="text-border">
                    ·
                  </span>
                ) : null}
                {avgRating !== null ? (
                  <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-foreground">
                    <HugeiconsIcon
                      icon={StarIcon}
                      className="size-3.5 fill-iris text-iris-ink"
                      aria-hidden
                    />
                    {avgRating.toFixed(1)}
                  </span>
                ) : null}
                {totalReviews > 0 ? (
                  <span className="tabular-nums text-muted-foreground">
                    ({plural(totalReviews, 'reference', 'references')})
                  </span>
                ) : null}
                {altHandles.length > 0 ? (
                  <>
                    <span aria-hidden className="text-border">
                      ·
                    </span>
                    <span className="text-meta text-muted-foreground">
                      Also known as{' '}
                      <span className="font-medium text-foreground">
                        {altHandles.join(', ')}
                      </span>
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {centre.unclaimed ? (
              <ClaimHandle
                key={`claim-${centre.handleSlug}`}
                handle={centre.handle}
                signedIn={viewer.id !== null}
                initialClaim={orbits.centreKey === centreKeyOf(data) ? initialClaim : null}
                returnPath={returnPath}
              />
            ) : isSelf ? (
              <ClaimHandle
                key={`link-${centre.handleSlug}`}
                handle={centre.handle}
                signedIn
                mode="link"
                returnPath={returnPath}
              />
            ) : null}
            <ShareExperience
              key={orbits.centreKey}
              target={{
                kind: centre.kind,
                id: centre.id,
                profileId: centre.profileId,
                handle: centre.handle,
                handleSlug: centre.handleSlug,
                name: centre.name,
                platform: centre.platforms[0]?.slug ?? 'instagram',
                firstName: centre.firstName,
                identityVerified: centre.identityVerified,
                unclaimed: centre.unclaimed,
              }}
              viewer={{ signedIn: viewer.id !== null, identityVerified: viewer.identityVerified, isSelf }}
              returnPath={returnPath}
              autoOpen={autoOpen && orbits.centreKey === centreKeyOf(data)}
              label="Leave a reference"
            />
          </div>
        </div>
      </header>

      <section
        aria-labelledby="references-heading"
        className="overflow-hidden rounded-2xl border border-border/90 bg-card shadow-xs"
      >
        <TrustNetworkHeader orbits={orbits} />
        <TrustNetworkBody orbits={orbits} />
      </section>
    </div>
  );
}
