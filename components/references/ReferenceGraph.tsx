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

import type { KeyboardEvent, ReactNode } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { PlatformChip, SentimentBadge, plural } from '@/components/references/referenceLabels';
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
import type {
  ReferenceGraphCentre,
  ReferenceGraphData,
  ReferenceGraphNode,
} from '@/lib/references/graph';
import { cn } from '@/lib/utils';

/** Goes to someone's references page. `keepScroll` holds the page where it is, for a page laid out the same. */
export function usePageOpener(keepScroll: boolean): (handleSlug: string) => void {
  const router = useRouter();
  return (handleSlug) => router.push(`/references/${encodeURIComponent(handleSlug)}`, { scroll: !keepScroll });
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

const PLATFORM_TINT: Record<string, string> = {
  instagram: 'text-[#E1306C]',
  facebook: 'text-[#1877F2]',
  discord: 'text-[#5865F2]',
  ebay: 'text-[#E53238]',
  whatnot: 'text-foreground',
  noditto: 'text-foreground',
  x: 'text-foreground',
  youtube: 'text-[#FF0000]',
  tiktok: 'text-foreground',
};

export function NetworkStats({ stats }: { stats: ReferenceView['stats'] }) {
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

function NetworkToolbar({ orbits }: { orbits: TrustOrbits }) {
  const { view, platformFilter, filterByPlatform } = orbits;
  const platforms = view.platforms;

  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/70 bg-muted/25 px-group py-2 sm:px-5">
      <div
        className="-mx-group flex w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto px-group [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Filter references by platform"
        style={{ opacity: arrival(orbits) }}
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
          <span className="tabular-nums opacity-75">{view.nodes.length}</span>
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
                  PLATFORM_TINT[p.slug] ?? 'text-muted-foreground',
                )}
              />
              <span>{p.label}</span>
              <span className="tabular-nums text-muted-foreground">{p.count}</span>
            </button>
          );
        })}
      </div>

      {/* Pointer controls. Hidden on phones: a vertical drag there scrolls the page, so
          tilt (and so "Reset view") cannot be reached, and the spin switch is the
          drawing's decoration rather than anything a reader needs. */}
      <div className="hidden items-center gap-4 sm:flex">
        {orbits.tilted ? (
          <Button variant="ghost" size="xs" onClick={orbits.resetView}>
            Reset view
          </Button>
        ) : null}
        <label className="flex cursor-pointer items-center gap-2 text-meta font-medium text-muted-foreground">
          <Switch checked={orbits.autoSpin} onCheckedChange={orbits.toggleSpin} />
          Spin
        </label>
      </div>
    </div>
  );
}

/**
 * Every reference as a readable card, under the drawing at every width: the review list
 * Fiverr, eBay and Depop use, and the one place a review is always shown in full. On
 * the storefront and on the reference profile alike.
 */
export function ExperienceList({
  orbits,
  selectable = true,
}: {
  orbits: TrustOrbits;
  /**
   * Whether a card selects its person in the drawing. Off where the list sits below a
   * drawing scrolled out of view (the phone profile): the card already says everything
   * the panel would, and a panel opening off-screen reads as a tap that did nothing.
   */
  selectable?: boolean;
}) {
  const { view, selectedKey } = orbits;
  return (
    <div className="border-t border-border/80 bg-card px-group py-4 sm:px-5" style={{ opacity: arrival(orbits) }}>
      <h4 className="mb-3 text-meta font-semibold uppercase tracking-wider text-muted-foreground">
        {view.direction === 'given' ? 'References given' : 'References received'} ({view.nodes.length})
      </h4>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {view.nodes.map((node) => {
          const key = nodeKey(node);
          const isSelected = key === selectedKey;
          const negative = node.sentiment === 'NEGATIVE';
          return (
            <li key={node.id}>
              <div
                {...(selectable
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-pressed': isSelected,
                      onClick: () => orbits.select(key),
                      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          orbits.select(key);
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
                            href={`/references/${encodeURIComponent(node.handleSlug)}`}
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
                  {node.dateLabel ? <span>{node.dateLabel}</span> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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
      <NetworkToolbar orbits={orbits} />
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

/**
 * Received (left FOR them) or Given (left BY them). Only a member can have left a
 * reference, so an unclaimed handle has nothing to switch to and gets no control.
 */
function DirectionSwitch({ orbits }: { orbits: TrustOrbits }) {
  const { graph } = orbits;
  if (graph.centre.profileId === null) return null;
  const received = viewTotal(viewOf(graph, 'received'));
  const given = viewTotal(viewOf(graph, 'given'));
  return (
    <SegmentedControl<ReferenceDirection>
      name={`reference-direction-${orbits.centreKey}`}
      label={`Which references to show for ${graph.centre.handle}`}
      options={[
        { value: 'received', label: 'Received', count: received },
        { value: 'given', label: 'Given', count: given },
      ]}
      value={orbits.direction}
      onChange={orbits.setDirection}
      className="w-full sm:w-60"
    />
  );
}

/** The network's title and how well vouched for the person in the middle is, with an optional action. */
export function TrustNetworkHeader({ orbits, action }: { orbits: TrustOrbits; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/80 px-group py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5" style={{ opacity: arrival(orbits) }}>
        <h3 id="references-heading" className="text-[1.0625rem] font-semibold tracking-tight text-foreground">
          References
        </h3>
        <NetworkStats stats={orbits.view.stats} />
      </div>
      {orbits.graph.centre.profileId !== null || action ? (
        <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row sm:items-center">
          <DirectionSwitch orbits={orbits} />
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReferenceGraph({
  data,
  action,
}: {
  data: ReferenceGraphData;
  /** The ShareExperience control (or the owner's share link control) for this page's person. */
  action?: ReactNode;
}) {
  const orbits = useTrustOrbits(data, { openPage: usePageOpener(false) });
  return (
    <section
      aria-labelledby="references-heading"
      className="overflow-hidden rounded-2xl border border-border/90 bg-card shadow-xs"
    >
      <TrustNetworkHeader orbits={orbits} action={orbits.away ? null : action} />
      <TrustNetworkBody orbits={orbits} />
      {orbits.view.nodes.length > 0 ? <ExperienceList orbits={orbits} /> : null}
    </section>
  );
}
