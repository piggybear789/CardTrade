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
import { PlatformChip } from '@/components/references/referenceLabels';
import {
  ExperienceList,
  TrustNetworkBody,
  TrustNetworkHeader,
  arrival,
  averageGraphRating,
  usePageOpener,
} from '@/components/references/ReferenceGraph';
import { ShareExperience } from '@/components/references/ShareExperience';
import { centreKeyOf, useTrustOrbits } from '@/components/references/useTrustOrbits';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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

  // FILLS THE PAGE. The column is a flex chain down to the Trust Network card, which
  // takes whatever height is left, so a person with no references yet does not leave a
  // short card floating above a screen of empty background. Card surfaces use the
  // `Card` tokens (`rounded-lg`, `border-border`, `shadow-market`) like every other page.
  return (
    <div className="flex flex-1 flex-col gap-group">
      <header className="relative overflow-hidden rounded-lg border border-border bg-card p-group shadow-market sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full bg-iris/[0.06] blur-2xl"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* PHONE: a 40px back button (a touch target, not the 36px pointer one), a 48px
              avatar and a tighter gap, which hands the handle ~20px more of a ~311px row. */}
          <div className="flex min-w-0 items-center gap-cozy sm:gap-3.5" style={{ opacity: arrival(orbits) }}>
            {/* A borderless round button with a 20px chevron, nudged into the card's
                margin, at every width. The outlined square with a 16px arrow, beside
                the round avatar, read as an empty form control rather than "back". */}
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="-ml-2 size-10 shrink-0 rounded-full md:size-9 [&_svg]:size-5"
            >
              <Link href="/references" aria-label="Back to references">
                <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden />
              </Link>
            </Button>

            <Avatar
              avatarPath={centre.avatarPath}
              displayName={centre.name}
              size="lg"
              className="max-sm:size-12"
            />

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
                {details.length > 0 && avgRating !== null ? (
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
                {altHandles.length > 0 ? (
                  <>
                    <span aria-hidden className="hidden text-border sm:inline">
                      ·
                    </span>
                    {/* Its own line on a phone, and allowed to break inside a long
                        handle: a single 27-character handle overflowed the column. */}
                    <span className="basis-full text-meta text-muted-foreground [overflow-wrap:anywhere] sm:basis-auto">
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

          {/* PHONE: full-width stacked actions, the primary one last and nearest the
              thumb (Vinted's Follow, Etsy's Message seller). Two buttons used to wrap
              into ragged left-aligned rows of different widths. */}
          <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap sm:items-center [&>button]:w-full sm:[&>button]:w-auto">
            {centre.unclaimed ? (
              <ClaimHandle
                key={`claim-${centre.handleSlug}`}
                handle={centre.handle}
                signedIn={viewer.id !== null}
                identityVerified={viewer.identityVerified}
                initialClaim={orbits.centreKey === centreKeyOf(data) ? initialClaim : null}
                returnPath={returnPath}
              />
            ) : isSelf ? (
              <ClaimHandle
                key={`link-${centre.handleSlug}`}
                handle={centre.handle}
                signedIn
                identityVerified={viewer.identityVerified}
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
        className="flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-market"
      >
        <TrustNetworkHeader orbits={orbits} />
        <TrustNetworkBody orbits={orbits} />
        {/* EVERY REFERENCE AS A CARD, UNDER THE DRAWING, AT EVERY WIDTH: the review list
            every marketplace app uses. The drawing shows who vouches for whom; the list
            is where each review is read in full (on a phone the drawing's labels are
            ~9px and its dots small targets). Two columns from `sm`. Cards do not select
            in the drawing here: once you have scrolled down to read them it is often off
            screen, and a selection you cannot see reads as a tap that did nothing. */}
        {orbits.view.nodes.length > 0 ? <ExperienceList orbits={orbits} selectable={false} /> : null}
      </section>
    </div>
  );
}
