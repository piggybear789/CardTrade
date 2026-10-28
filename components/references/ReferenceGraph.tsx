'use client';

// components/references/ReferenceGraph.tsx
//
// The Trust Network (0155): everyone who has vouched for a person, drawn as a
// small solar system (`domain/references/orbits.ts`). Selecting someone opens a
// card over the drawing with who they know; double-clicking (or double-tapping)
// goes to their page, the graph walking there as it loads. A segmented control in
// the header switches between references left FOR the person and ones they LEFT.
//
// `ReferenceGraph` is the network as a section of another page (a storefront),
// with the experiences listed as text under it; `ReferenceProfile` is a person's
// references page, built from the same body with a modal trigger to leave a reference.

import { memo, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  ShieldCheckIcon,
} from '@hugeicons/core-free-icons';

import { SocialPlatformIcon } from '@/components/profile/SocialPlatformIcon';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  PlatformChip,
  SentimentBadge,
  platformTint,
  plural,
  proofLabel,
} from '@/components/references/referenceLabels';
import { ReferenceOwnerActions } from '@/components/references/ReferenceOwnerActions';
import { ReferenceStaffRemove } from '@/components/references/ReferenceStaffRemove';
import { REFERENCE_LIST_HEADING_ID } from '@/components/references/referenceListFocus';
import { TrustNetworkPanel } from '@/components/references/TrustNetworkPanel';
import { TrustOrbitsCanvas } from '@/components/references/TrustOrbitsCanvas';
import {
  nodeKey,
  useTrustOrbits,
  viewOf,
  viewTotal,
  type ReferenceDirection,
  type ReferenceView,
  type TrustOrbits,
} from '@/components/references/useTrustOrbits';
import { referenceHref, type ReferenceAddress } from '@/domain/references/address';
import type {
  ReferenceGraphCentre,
  ReferenceGraphData,
  ReferenceGraphNode,
} from '@/lib/references/graph';
import { cn } from '@/lib/utils';

/** Goes to someone's references page. `keepScroll` holds the page where it is, for a page laid out the same. */
export function usePageOpener(keepScroll: boolean): (address: ReferenceAddress) => void {
  const router = useRouter();
  return (address) => router.push(referenceHref(address), { scroll: !keepScroll });
}

/**
 * How settled text about the person in the middle is: it fades up from faint as
 * the graph walks to someone new, so the change of name reads as part of the move.
 */
export function arrival(orbits: TrustOrbits): number {
  return orbits.transition ? Math.min(1, 0.3 + orbits.progress * 1.4) : 1;
}

export function averageGraphRating(nodes: readonly ReferenceGraphNode[]): number | null {
  if (nodes.length === 0) return null;
  const total = nodes.reduce((sum, n) => {
    const fallback = n.sentiment === 'NEGATIVE' ? 1 : n.sentiment === 'NEUTRAL' ? 3 : 5;
    return sum + (n.rating ?? fallback);
  }, 0);
  return total / nodes.length;
}

function NetworkStats({ stats }: { stats: ReferenceView['stats'] }) {
  const { positive, neutral: neutralCount, negative } = stats;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        title={plural(positive, 'positive reference', 'positive references')}
        aria-label={plural(positive, 'positive reference', 'positive references')}
        className="inline-flex items-center gap-1 rounded-full bg-trust/10 px-2.5 py-0.5 text-meta font-semibold tabular-nums text-trust"
      >
        <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5" aria-hidden />
        <span>{positive} positive</span>
      </span>
      {neutralCount > 0 ? (
        <span
          title={plural(neutralCount, 'neutral reference', 'neutral references')}
          aria-label={plural(neutralCount, 'neutral reference', 'neutral references')}
          // NO BORDER, matching the positive and negative pills. `border-action-border/40`
          // is not a class here (the token is `action-edge`), so it drew a grey hairline.
          className="inline-flex items-center gap-1 rounded-full bg-action/35 px-2.5 py-0.5 text-meta font-semibold tabular-nums text-action-foreground"
        >
          <span>{neutralCount} neutral</span>
        </span>
      ) : null}
      {negative > 0 ? (
        <span
          title={plural(negative, 'negative reference', 'negative references')}
          aria-label={plural(negative, 'negative reference', 'negative references')}
          className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-meta font-semibold tabular-nums text-destructive"
        >
          <HugeiconsIcon icon={AlertCircleIcon} className="size-3.5" aria-hidden />
          <span>{negative} negative</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * One filter pill. PHONE: 36px tall in a single row that swipes sideways (the Depop
 * filter row), instead of 28px pills wrapping onto three rows above the drawing.
 * From `sm` the compact wrapping pills come back.
 */
const FILTER_PILL =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-cozy text-meta font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 sm:px-2.5';

interface NetworkToolbarProps {
  platforms: ReferenceView['platforms'];
  /** Every reference in the current direction, the "All" count. */
  total: number;
  platformFilter: string | null;
  filterByPlatform: (slug: string | null) => void;
  opacity: number;
  tilted: boolean;
  resetView: () => void;
}

/**
 * MEMOISED, like the header and the cards: the drawing re-renders on every drag and walk
 * frame, and nothing here changes with it. The props are the values this reads, never the
 * whole `orbits`, which is a new object every frame.
 */
const NetworkToolbar = memo(function NetworkToolbar({
  platforms,
  total,
  platformFilter,
  filterByPlatform,
  opacity,
  tilted,
  resetView,
}: NetworkToolbarProps) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/70 bg-muted/25 px-group py-2 sm:px-5">
      <div
        className="-mx-group flex w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto px-group [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Filter references by platform"
        style={{ opacity }}
      >
        <button
          type="button"
          aria-pressed={platformFilter === null}
          onClick={() => filterByPlatform(null)}
          className={cn(
            FILTER_PILL,
            platformFilter === null
              ? 'border-foreground bg-foreground text-background'
              : 'border-border/80 bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
          )}
        >
          <span>All</span>
          <span className="tabular-nums opacity-75">{total}</span>
        </button>

        {platforms.map((p) => {
          const active = platformFilter === p.slug;
          return (
            <button
              key={p.slug}
              type="button"
              aria-pressed={active}
              onClick={() => filterByPlatform(p.slug)}
              className={cn(
                FILTER_PILL,
                active
                  ? 'border-iris bg-iris/12 text-foreground ring-1 ring-iris/35'
                  : 'border-border/80 bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
              )}
            >
              <SocialPlatformIcon
                slug={p.slug}
                className={cn(
                  p.slug === 'ebay' || p.slug === 'noditto' || p.slug === 'whatnot'
                    ? 'size-3.5'
                    : 'size-3',
                  platformTint(p.slug),
                )}
              />
              <span>{p.label}</span>
              <span className="tabular-nums text-muted-foreground">{p.count}</span>
            </button>
          );
        })}
      </div>

      {/* Pointer only. Hidden on phones: a vertical drag there scrolls the page, so tilt
          (and so "Reset view") cannot be reached. Rendered only once the system is
          tilted, so the bar keeps its height either way (`min-h-11`). */}
      {tilted ? (
        <div className="hidden items-center sm:flex">
          <Button variant="ghost" size="xs" onClick={resetView}>
            Reset view
          </Button>
        </div>
      ) : null}
    </div>
  );
});

/**
 * Every reference as a readable card, under the drawing at every width: the review list
 * Fiverr, eBay and Depop use, and the one place a review is always shown in full. On
 * the storefront and on the reference profile alike.
 */
export function ExperienceList({
  orbits,
  selectable = true,
  viewerId = null,
  canModerate = false,
}: {
  orbits: TrustOrbits;
  /**
   * Whether a card selects its person in the drawing. Off where the list sits below a
   * drawing scrolled out of view (the phone profile): the card already says everything
   * the panel would, and a panel opening off-screen reads as a tap that did nothing.
   */
  selectable?: boolean;
  /** The signed-in member, who can edit or withdraw the references they wrote. */
  viewerId?: string | null;
  /** An admin, who can take a reference down. The server checks again. */
  canModerate?: boolean;
}) {
  return (
    <ExperienceCards
      view={orbits.view}
      centre={orbits.graph.centre}
      selectedKey={orbits.selectedKey}
      select={orbits.select}
      opacity={arrival(orbits)}
      selectable={selectable}
      viewerId={viewerId}
      canModerate={canModerate}
    />
  );
}

const ExperienceCards = memo(function ExperienceCards({
  view,
  centre,
  selectedKey,
  select,
  opacity,
  selectable,
  viewerId,
  canModerate,
}: {
  view: ReferenceView;
  centre: ReferenceGraphCentre;
  selectedKey: string | null;
  select: (key: string | null) => void;
  opacity: number;
  selectable: boolean;
  viewerId: string | null;
  canModerate: boolean;
}) {
  const given = view.direction === 'given';
  // Given: every card is the person in the middle's own words. Received: each card's
  // author is the person on it.
  const authorOf = (node: ReferenceGraphNode) => (given ? centre.profileId : node.profileId);
  return (
    <div className="border-t border-border/80 bg-card px-group py-4 sm:px-5" style={{ opacity }}>
      <h4
        id={REFERENCE_LIST_HEADING_ID}
        tabIndex={-1}
        className="mb-3 text-meta font-semibold uppercase tracking-wider text-muted-foreground focus:outline-none"
      >
        {given ? 'References given' : 'References received'} ({view.nodes.length})
      </h4>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {view.nodes.map((node) => {
          const key = nodeKey(node);
          const isSelected = key === selectedKey;
          const negative = node.sentiment === 'NEGATIVE';
          const mine = viewerId !== null && node.referenceId !== null && authorOf(node) === viewerId;
          const meta = [proofLabel(node.kind), node.dateLabel, node.edited ? 'Edited' : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={node.id}>
              <div
                {...(selectable
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-pressed': isSelected,
                      onClick: () => select(key),
                      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          select(key);
                        }
                      },
                    }
                  : {})}
                className={cn(
                  'group flex h-full flex-col justify-between rounded-xl border p-3.5 transition-all',
                  selectable
                    ? cn(
                        'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isSelected
                          ? 'border-foreground/40 bg-muted/30 shadow-2xs'
                          : 'border-border/80 bg-card hover:border-foreground/25 hover:bg-muted/15',
                      )
                    : 'border-border/80 bg-card',
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar avatarPath={node.avatarPath} displayName={node.name} size="sm" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <Link
                            href={referenceHref(node.address)}
                            onClick={(event) => event.stopPropagation()}
                            className="break-all text-body font-semibold text-foreground hover:underline"
                          >
                            {node.handle}
                          </Link>
                          {node.identityVerified ? (
                            <HugeiconsIcon icon={ShieldCheckIcon} className="size-3.5 shrink-0 text-trust" aria-hidden />
                          ) : null}
                        </div>
                        <p className="text-meta text-muted-foreground">
                          {node.refs} {node.refs === 1 ? 'ref' : 'refs'} · {node.roleLabel}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {node.platforms.map((slug) => (
                        <PlatformChip key={slug} slug={slug} />
                      ))}
                      <SentimentBadge sentiment={node.sentiment} rating={node.rating} />
                    </div>
                  </div>

                  {node.comment ? (
                    <p className="mt-2.5 text-body text-foreground/90">{node.comment}</p>
                  ) : null}
                </div>

                <div className="mt-2.5 flex items-center justify-between text-meta text-muted-foreground">
                  <span>{negative ? (node.categoryLabel ?? 'Issue') : plural(node.deals, 'deal', 'deals')}</span>
                  {meta ? <span>{meta}</span> : null}
                </div>

                {mine ? (
                  <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
                    <span className="text-meta text-muted-foreground">Your reference</span>
                    <ReferenceOwnerActions node={node} subject={given ? node.handle : centre.handle} />
                  </div>
                ) : canModerate && node.referenceId ? (
                  <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
                    <span className="text-meta text-muted-foreground">Staff</span>
                    <ReferenceStaffRemove
                      referenceId={node.referenceId}
                      subject={given ? node.handle : centre.handle}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

function EmptyNetwork({
  centre,
  direction,
}: {
  centre: ReferenceGraphCentre;
  direction: ReferenceDirection;
}) {
  return (
    <div className="relative flex min-h-[340px] flex-1 flex-col items-center justify-center bg-muted/15 px-6 py-14 text-center">
      <div className="mx-auto mb-3 grid size-14 place-items-center rounded-lg border border-border bg-card shadow-market">
        <span className="text-lead font-semibold text-foreground">
          {centre.name.replace(/^@/, '').slice(0, 2).toUpperCase()}
        </span>
      </div>
      <p className="text-body font-semibold text-foreground">{centre.handle}</p>
      <p className="mt-1 max-w-md text-body text-muted-foreground">
        {direction === 'given'
          ? `${centre.handle} hasn't left a reference for anyone yet.`
          : `No references yet for ${centre.handle}. Done a deal with them? Be the first to leave a reference.`}
      </p>
    </div>
  );
}

/** The network under its header: controls, and the drawing with its card. */
export function TrustNetworkBody({ orbits }: { orbits: TrustOrbits }) {
  const { centre } = orbits.graph;
  const { view } = orbits;
  if (view.nodes.length === 0) return <EmptyNetwork centre={centre} direction={view.direction} />;
  return (
    <>
      <NetworkToolbar
        platforms={view.platforms}
        total={view.nodes.length}
        platformFilter={orbits.platformFilter}
        filterByPlatform={orbits.filterByPlatform}
        opacity={arrival(orbits)}
        tilted={orbits.tilted}
        resetView={orbits.resetView}
      />
      <div
        className="relative flex-1 px-2 py-3 sm:px-4"
        style={{
          backgroundImage:
            'radial-gradient(ellipse at 50% 44%, hsl(var(--iris) / 0.05) 0%, transparent 65%), radial-gradient(hsl(var(--foreground) / 0.08) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 22px 22px',
        }}
      >
        <TrustOrbitsCanvas
          orbits={orbits}
          label={
            view.direction === 'given'
              ? `References for ${centre.handle}: references they have left for ${plural(view.nodes.length, 'person', 'people')}`
              : `References for ${centre.handle}: ${plural(centre.peopleCount, 'person vouches', 'people vouch')} for them`
          }
        >
          <TrustNetworkPanel orbits={orbits} />
        </TrustOrbitsCanvas>
      </div>
    </>
  );
}

/** The network's title and how well vouched for the person in the middle is, with an optional action. */
export function TrustNetworkHeader({ orbits, action }: { orbits: TrustOrbits; action?: ReactNode }) {
  const { graph } = orbits;
  return (
    <NetworkHeader
      stats={orbits.view.stats}
      opacity={arrival(orbits)}
      centre={graph.centre}
      centreKey={orbits.centreKey}
      direction={orbits.direction}
      setDirection={orbits.setDirection}
      receivedTotal={viewTotal(viewOf(graph, 'received'))}
      givenTotal={viewTotal(viewOf(graph, 'given'))}
      action={action}
    />
  );
}

const NetworkHeader = memo(function NetworkHeader({
  stats,
  opacity,
  centre,
  centreKey,
  direction,
  setDirection,
  receivedTotal,
  givenTotal,
  action,
}: {
  stats: ReferenceView['stats'];
  opacity: number;
  centre: ReferenceGraphCentre;
  centreKey: string;
  direction: ReferenceDirection;
  setDirection: (next: ReferenceDirection) => void;
  receivedTotal: number;
  givenTotal: number;
  action?: ReactNode;
}) {
  // Received (left FOR them) or Given (left BY them). Only a member can have left a
  // reference, so an unclaimed handle has nothing to switch to and gets no control.
  const member = centre.profileId !== null;
  return (
    <div className="flex flex-col gap-3 border-b border-border/80 px-group py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5" style={{ opacity }}>
        <h3 id="references-heading" className="text-[1.0625rem] font-semibold tracking-tight text-foreground">
          References
        </h3>
        <NetworkStats stats={stats} />
      </div>
      {member || action ? (
        <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row sm:items-center">
          {member ? (
            <SegmentedControl<ReferenceDirection>
              name={`reference-direction-${centreKey}`}
              label={`Which references to show for ${centre.handle}`}
              options={[
                { value: 'received', label: 'Received', count: receivedTotal },
                { value: 'given', label: 'Given', count: givenTotal },
              ]}
              value={direction}
              onChange={setDirection}
              // PHONE: COMPACT. Full width at 44px, the switch was the largest thing in
              // the header, heavier than the title above it. Below `sm` it is 36px tall
              // (32px segments, the `xs` button height), `meta` labels, and only as wide
              // as its labels. From `sm` it sits beside the title at its usual size.
              className="w-fit max-sm:gap-0.5 max-sm:p-0.5 sm:w-60"
              segmentClassName="max-sm:min-h-8 max-sm:px-cozy max-sm:text-meta"
            />
          ) : null}
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
    </div>
  );
});

export function ReferenceGraph({
  data,
  action,
  viewerId = null,
}: {
  data: ReferenceGraphData;
  /** The ShareExperience control (or the owner's share link control) for this page's person. */
  action?: ReactNode;
  /** The signed-in member, who can edit or withdraw the references they wrote. */
  viewerId?: string | null;
}) {
  const orbits = useTrustOrbits(data, { openPage: usePageOpener(false) });
  return (
    <section
      aria-labelledby="references-heading"
      className="overflow-hidden rounded-2xl border border-border/90 bg-card shadow-xs"
    >
      <TrustNetworkHeader orbits={orbits} action={orbits.away ? null : action} />
      <TrustNetworkBody orbits={orbits} />
      {orbits.view.nodes.length > 0 ? <ExperienceList orbits={orbits} viewerId={viewerId} /> : null}
    </section>
  );
}
