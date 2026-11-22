'use client';

// components/references/ReferenceProfile.tsx
//
// A person's references page: a card for who they are, then a card for their
// Trust Network. Leaving a reference opens in a compact modal (`ShareExperience`).
// Everything about the person in the middle is read from the graph, so when the
// graph walks to someone else's page both cards go with it, and the page that
// loads behind the walk draws exactly what is already on screen.

import { memo, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';

import { IdentityBadge } from '@/components/identity/IdentityBadge';
import { TrustedSellerBadge } from '@/components/identity/TrustedSellerBadge';
import { BackgroundCheckPanel } from '@/components/references/BackgroundCheckPanel';
import { ClaimHandle } from '@/components/references/ClaimHandle';
import { PlatformChip } from '@/components/references/referenceLabels';
import {
  ExperienceList,
  TrustNetworkBody,
  TrustNetworkHeader,
  arrival,
  usePageOpener,
} from '@/components/references/ReferenceGraph';
import { ShareExperience } from '@/components/references/ShareExperience';
import { TrackRecordCard } from '@/components/references/TrackRecordCard';
import { centreKeyOf, useTrustOrbits } from '@/components/references/useTrustOrbits';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { referenceAddressKey, referenceHref } from '@/domain/references/address';
import type { BackgroundCheckDossier, EbaySellerSummary } from '@/domain/references/enrichment';
import { regionLabel } from '@/domain/region';
import { ebayReferenceSignature, withEbayReferences } from '@/lib/references/ebayReferences';
import type { ReferenceGraphCentre, ReferenceGraphData } from '@/lib/references/graph';
import { cn } from '@/lib/utils';

export interface ReferenceViewer {
  /** The signed-in member, or null for a visitor. */
  id: string | null;
  identityVerified: boolean;
  /** May moderate: shows "Remove" on each reference. The action checks again. */
  isAdmin?: boolean;
}

export function ReferenceProfile({
  data,
  viewer,
  autoOpen,
  autoCheck = false,
  refreshStoredCheck = false,
  initialDossier = null,
}: {
  data: ReferenceGraphData;
  viewer: ReferenceViewer;
  /** Open the share composer on arrival (from a reference request link), for this page's person only. */
  autoOpen: boolean;
  /** Auto-run the OSINT/forensics scour on arrival (e.g. from pasting a profile URL). */
  autoCheck?: boolean;
  /** The page person's stored check lacks fields the page draws, so the auto-run skips the cache. */
  refreshStoredCheck?: boolean;
  initialDossier?: BackgroundCheckDossier | null;
}) {
  const pageKey = centreKeyOf(data);
  // eBay lookups the footprint panel has reported, by the person each is about. The panel
  // follows the graph when it walks, so a lookup can arrive for the next person before
  // their page does; kept by person, it neither redraws this one nor is lost.
  const [liveEbay, setLiveEbay] = useState<ReadonlyMap<string, EbaySellerSummary | null>>(() => new Map());
  const ebay = liveEbay.has(pageKey) ? liveEbay.get(pageKey) : initialDossier?.ebay;
  // eBay feedback is drawn and counted as references (`lib/references/ebayReferences.ts`).
  // Same graph object until the feedback itself changes, so the network is not reset by
  // a re-read that found nothing new.
  const graph = useMemo(() => withEbayReferences(data, ebay), [data, ebay]);
  // The two figures the header quotes from a check, kept by person for the same reason.
  const [liveFacts, setLiveFacts] = useState<ReadonlyMap<string, CheckFacts>>(() => new Map());
  const noteDossier = (personKey: string, dossier: BackgroundCheckDossier) => {
    const facts = checkFactsOf(dossier);
    setLiveFacts((known) => {
      const had = known.get(personKey);
      if (had && had.followers === facts.followers && had.scamMatches === facts.scamMatches) return known;
      return new Map(known).set(personKey, facts);
    });
    const next = dossier.ebay ?? null;
    setLiveEbay((known) => {
      if (known.has(personKey) && ebayReferenceSignature(known.get(personKey)) === ebayReferenceSignature(next)) {
        return known;
      }
      return new Map(known).set(personKey, next);
    });
  };

  const orbits = useTrustOrbits(graph, { openPage: usePageOpener(true) });
  // The graph can be walking toward someone else; arriving with the composer open is only
  // for the person the page was opened for.
  const atPagePerson = orbits.centreKey === pageKey;

  // FILLS THE PAGE. The column is a flex chain down to the Trust Network card, which
  // takes whatever height is left, so a person with no references yet does not leave a
  // short card floating above a screen of empty background. Card surfaces are the
  // references surface (`rounded-xl bg-card ref-surface`, globals.css): a hairline
  // shadow edge under a soft cool bloom, in place of a 1px border.
  const hasReferences = orbits.view.nodes.length > 0;
  const facts =
    liveFacts.get(orbits.centreKey) ?? (atPagePerson && initialDossier ? checkFactsOf(initialDossier) : null);
  const { centre } = orbits.graph;
  const referenceTotal = centre.peopleCount + centre.neutralCount + centre.negativeCount;

  // FIRST LOAD ONLY. The cards rise into place in order (`.ref-enter`, globals.css), and
  // the class comes off once the last one has landed (320ms delay + 720ms). Left on, the
  // footprint card, which remounts for each person the graph walks to, would rise again
  // on every walk; without the class it fades in with the walk like everything else.
  // Server-rendered with the class, so the entrance plays before hydration.
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const done = window.setTimeout(() => setEntering(false), 1200);
    return () => window.clearTimeout(done);
  }, []);

  return (
    <div className={cn('flex flex-1 flex-col gap-group', entering && 'ref-enter')}>
      <ProfileHeader
        centre={orbits.graph.centre}
        opacity={arrival(orbits)}
        viewer={viewer}
        autoOpen={autoOpen && atPagePerson}
        composerKey={orbits.centreKey}
        bio={orbits.graph.bio?.text ?? null}
        referenceTotal={referenceTotal}
        positiveCount={centre.peopleCount}
        followers={facts?.followers ?? null}
        scamMatches={facts?.scamMatches ?? null}
      />

      {/* Another site's public record, when one is linked (0170). */}
      <TrackRecordCard records={orbits.graph.trackRecord ?? []} opacity={arrival(orbits)} />

      {/* Public cross-platform footprint (eBay, Instagram, open web, scam DB) right under
          the profile header so it's immediately visible instead of buried below reviews. */}
      <BackgroundCheckPanel
        key={`check-${orbits.centreKey}`}
        mode="profile"
        compact={hasReferences}
        opacity={arrival(orbits)}
        initialQuery={orbits.graph.centre.handle.replace(/^@/, '')}
        initialPlatform={orbits.graph.centre.address.on}
        instagramAvatarPath={
          orbits.graph.centre.address.on === 'instagram' ? orbits.graph.centre.avatarPath : null
        }
        initialLocation={orbits.graph.centre.regionCode ?? ''}
        initialDossier={atPagePerson ? initialDossier : null}
        autoRun={!atPagePerson || autoCheck || !initialDossier}
        autoRunRefresh={atPagePerson && refreshStoredCheck}
        onDossier={(dossier) => noteDossier(orbits.centreKey, dossier)}
      />

      <section
        aria-labelledby="references-heading"
        className="ref-surface flex flex-1 flex-col overflow-hidden rounded-xl bg-card"
      >
        <TrustNetworkHeader orbits={orbits} />
        <TrustNetworkBody orbits={orbits} />
        {/* EVERY REFERENCE AS A CARD, UNDER THE DRAWING, AT EVERY WIDTH: the review list
            every marketplace app uses. The drawing shows who vouches for whom; the list
            is where each review is read in full (on a phone the drawing's labels are
            ~9px and its dots small targets). Two columns from `sm`. Cards do not select
            in the drawing here: once you have scrolled down to read them it is often off
            screen, and a selection you cannot see reads as a tap that did nothing. */}
        {hasReferences ? (
          <ExperienceList
            orbits={orbits}
            selectable={false}
            viewerId={viewer.id}
            canModerate={viewer.isAdmin ?? false}
          />
        ) : null}
      </section>
    </div>
  );
}

/** What the header quotes from a digital footprint check. */
interface CheckFacts {
  /** Instagram followers, when the check read them. */
  followers: number | null;
  scamMatches: number;
}

function checkFactsOf(dossier: BackgroundCheckDossier): CheckFacts {
  return {
    followers: dossier.forensics?.visibleProfile?.followersCount ?? null,
    scamMatches: dossier.scamRisk.matchedReportCount,
  };
}

const FIGURE_FORMAT = new Intl.NumberFormat('en-AU');

/**
 * THE HEADLINE FIGURES, in one row under the name: how many references, what share were
 * good, how big the Instagram account is, and whether anyone has reported them. Large
 * ink figures over small labels, cells split by hairlines (the stat strip Shopify,
 * n8n and Plausible put at the top of a record). Before this the page's numbers were
 * all in 12px tinted pills, three cards down.
 *
 * A cell is shown only for a figure that is known. Nobody with no references gets a
 * "0%"; a check that has not answered yet shows no scam cell rather than a guess.
 */
function HeadlineFigures({
  referenceTotal,
  positiveCount,
  followers,
  scamMatches,
}: {
  referenceTotal: number;
  positiveCount: number;
  followers: number | null;
  scamMatches: number | null;
}) {
  const figures: { label: string; value: string; tone?: 'trust' | 'destructive' }[] = [
    { label: referenceTotal === 1 ? 'Reference' : 'References', value: FIGURE_FORMAT.format(referenceTotal) },
  ];
  if (referenceTotal > 0) {
    figures.push({ label: 'Positive', value: `${Math.round((positiveCount / referenceTotal) * 100)}%`, tone: 'trust' });
  }
  if (followers !== null) {
    figures.push({ label: 'Instagram followers', value: FIGURE_FORMAT.format(followers) });
  }
  if (scamMatches !== null) {
    figures.push(
      scamMatches > 0
        ? { label: scamMatches === 1 ? 'Scam report' : 'Scam reports', value: FIGURE_FORMAT.format(scamMatches), tone: 'destructive' }
        : { label: 'Scam reports', value: 'None', tone: 'trust' },
    );
  }
  return (
    <dl className="relative mt-group grid grid-cols-2 gap-y-cozy border-t border-border pt-group sm:flex sm:gap-0">
      {figures.map((figure) => (
        <div
          key={figure.label}
          className="flex flex-col-reverse sm:min-w-36 sm:border-l sm:border-border sm:px-6 sm:first:border-l-0 sm:first:pl-0"
        >
          <dt className="text-meta text-muted-foreground">{figure.label}</dt>
          <dd
            className={cn(
              'text-head font-medium tabular-nums tracking-[-0.025em] sm:text-display',
              figure.tone === 'trust'
                ? 'text-trust'
                : figure.tone === 'destructive'
                  ? 'text-destructive'
                  : 'text-foreground',
            )}
          >
            {figure.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Who the page is about, and what the viewer can do here. MEMOISED: the network below
 * re-renders on every drag and walk frame, and nothing in this card moves with it.
 */
const ProfileHeader = memo(function ProfileHeader({
  centre,
  opacity,
  viewer,
  autoOpen,
  composerKey,
  bio,
  referenceTotal,
  positiveCount,
  followers,
  scamMatches,
}: {
  centre: ReferenceGraphCentre;
  opacity: number;
  viewer: ReferenceViewer;
  autoOpen: boolean;
  /** Remounts the composer for each person the graph shows. */
  composerKey: string;
  /** A short model-written line, published by staff (0171), or null. */
  bio: string | null;
  referenceTotal: number;
  positiveCount: number;
  followers: number | null;
  scamMatches: number | null;
}) {
  const returnPath = referenceHref(centre.address);
  const centreAddressKey = referenceAddressKey(centre.address);
  const isSelf = viewer.id !== null && viewer.id === centre.profileId;
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
    <header className="ref-surface relative overflow-hidden rounded-xl bg-card p-group sm:p-6">
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* PHONE: a 40px back button (a touch target, not the 36px pointer one), a 48px
            avatar and a tighter gap, which hands the handle ~20px more of a ~311px row. */}
        <div className="flex min-w-0 items-center gap-cozy sm:gap-3.5" style={{ opacity }}>
          {/* A borderless round button with a 20px chevron, nudged into the card's
              margin, at every width. The outlined square with a 16px arrow, beside
              the round avatar, read as an empty form control rather than "back". */}
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="-ml-2 size-10 shrink-0 rounded-md md:size-9 [&_svg]:size-5"
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
              {/* Medium weight with tracking pulled in, the references display register
                  (see the landing heading). One step larger from `md`, where the card
                  has the width for it. */}
              <h1 className="break-all text-subhead font-medium tracking-[-0.02em] text-foreground md:text-display md:tracking-[-0.03em]">
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
                    <PlatformChip key={p.slug} slug={p.slug} bare className="size-5" />
                  ))}
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-muted-foreground">
              {details.length > 0 ? <span>{details.join(' · ')}</span> : null}
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
              key={`claim-${centreAddressKey}`}
              handle={centre.handle}
              platform={centre.address.on}
              signedIn={viewer.id !== null}
              identityVerified={viewer.identityVerified}
              returnPath={returnPath}
            />
          ) : isSelf ? (
            <ClaimHandle
              key={`link-${centreAddressKey}`}
              handle={centre.handle}
              signedIn
              identityVerified={viewer.identityVerified}
              mode="link"
              returnPath={returnPath}
            />
          ) : null}
          <ShareExperience
            key={composerKey}
            target={{
              kind: centre.kind,
              id: centre.id,
              handle: centre.handle,
              platform: centre.kind === 'handle' ? centre.address.on : null,
            }}
            viewer={{ signedIn: viewer.id !== null, identityVerified: viewer.identityVerified, isSelf }}
            returnPath={returnPath}
            autoOpen={autoOpen}
            label="Leave a reference"
          />
        </div>
      </div>

      {/* A short line written by a model from a few checked facts and published by staff
          (0171). On its own row under the whole header, not beside the avatar: squeezed
          into that column on a phone it wrapped to five lines and clipped its label. It
          describes and never vouches, and it says what wrote it. */}
      {bio ? (
        <div className="relative mt-cozy border-t border-border pt-cozy" style={{ opacity }}>
          <p className="text-body text-foreground">{bio}</p>
          <p className="mt-tight text-meta text-muted-foreground">AI-written from public information</p>
        </div>
      ) : null}

      <div style={{ opacity }}>
        <HeadlineFigures
          referenceTotal={referenceTotal}
          positiveCount={positiveCount}
          followers={followers}
          scamMatches={scamMatches}
        />
      </div>
    </header>
  );
});
