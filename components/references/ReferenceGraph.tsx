'use client';

// components/references/ReferenceGraph.tsx
//
// The Trust Network (0155): everyone who has vouched for a person, drawn as proof
// orbits (`domain/references/orbits.ts`). Selecting someone lights up who they
// know; double-clicking (or double-tapping) centres the graph on them, and Back or
// the trail returns. The experiences list holds the same people as text, for
// scanning and for assistive tech.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  ShieldCheckIcon,
} from '@hugeicons/core-free-icons';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { TrustOrbitsCanvas } from '@/components/references/TrustOrbitsCanvas';
import { nodeKey, useTrustOrbits, type TrustOrbits } from '@/components/references/useTrustOrbits';
import { TIER_LABEL, type OrbitTier } from '@/domain/references/orbits';
import { platformLabel } from '@/domain/references/reference';
import type { ReferenceGraphData, ReferenceGraphNode } from '@/lib/references/graph';
import { cn } from '@/lib/utils';

const PLATFORM_DOT_COLOR: Record<string, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  discord: '#5865F2',
  ebay: '#E53238',
  whatnot: '#F59E0B',
  'in-person': '#10B981',
  noditto: '#6366F1',
  other: '#71717A',
};

function platformColor(slug: string): string {
  return PLATFORM_DOT_COLOR[slug] ?? '#6366F1';
}

function tierOf(node: ReferenceGraphNode): OrbitTier {
  return node.sentiment === 'NEGATIVE' ? 'issue' : node.kind;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function TierBadge({ tier, category }: { tier: OrbitTier; category?: string | null }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold',
        tier === 'issue' && 'bg-destructive/10 text-destructive',
        tier === 'vouch' && 'bg-muted text-muted-foreground',
        (tier === 'escrow' || tier === 'receipt') && 'bg-trust/10 text-trust',
      )}
    >
      {tier === 'issue' ? <HugeiconsIcon icon={AlertCircleIcon} className="size-3" aria-hidden /> : null}
      {tier === 'issue' ? (category ?? TIER_LABEL.issue) : TIER_LABEL[tier]}
    </span>
  );
}

function PlatformChip({ slug }: { slug: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-meta font-medium text-foreground">
      <span className="size-1.5 rounded-full" style={{ backgroundColor: platformColor(slug) }} aria-hidden />
      {platformLabel(slug)}
    </span>
  );
}

function NetworkHeader({
  graph,
  action,
  walkedFrom,
}: {
  graph: ReferenceGraphData;
  action?: ReactNode;
  walkedFrom: string | null;
}) {
  const { centre } = graph;
  const totalEdges = centre.referenceCount + centre.negativeCount;
  const positivePct = totalEdges > 0 ? Math.round((centre.referenceCount / totalEdges) * 100) : 100;

  return (
    <div className="flex flex-col gap-3 border-b border-border/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 id="references-heading" className="text-[1.0625rem] font-semibold tracking-tight text-foreground">
            Trust Network
          </h3>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/50 px-2.5 py-0.5 text-meta font-medium tabular-nums text-foreground">
            <span>{centre.referenceCount}</span>
            <span className="text-muted-foreground">{centre.referenceCount === 1 ? 'reference' : 'references'}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/50 px-2.5 py-0.5 text-meta font-medium tabular-nums text-foreground">
            <span>{centre.peopleCount}</span>
            <span className="text-muted-foreground">{centre.peopleCount === 1 ? 'person' : 'people'}</span>
          </span>
          {totalEdges > 0 ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-meta font-semibold tabular-nums',
                centre.negativeCount === 0 ? 'bg-trust/10 text-trust' : 'bg-amber-500/10 text-amber-700',
              )}
            >
              {positivePct}% positive
            </span>
          ) : null}
          {centre.negativeCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-meta font-semibold tabular-nums text-destructive">
              {centre.negativeCount} negative
            </span>
          ) : null}
        </div>
        <p className="text-meta text-muted-foreground">
          {walkedFrom
            ? `${centre.handle}'s network, opened from ${walkedFrom}.`
            : 'Closest in are deals done through NoDitto, then receipt-checked deals, then vouches.'}
        </p>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

function NetworkToolbar({ orbits }: { orbits: TrustOrbits }) {
  const { trail, graph, showConnections } = orbits;
  const last = trail.length - 1;
  const crumbs = trail.length <= 3 ? trail.map((_, index) => index) : [0, -1, last - 1, last];
  const hiddenTotal = Object.values(graph.hidden).reduce((sum, count) => sum + count, 0);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/70 bg-muted/25 px-5 py-2">
      {trail.length > 1 ? (
        <nav aria-label="Networks you opened" className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="xs" onClick={orbits.back}>
            <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden />
            Back
          </Button>
          <ol className="flex min-w-0 flex-wrap items-center gap-1 text-meta">
            {crumbs.map((index, position) => (
              <li key={index < 0 ? 'gap' : trail[index].centre.id} className="flex items-center gap-1">
                {position > 0 ? (
                  <span className="text-muted-foreground" aria-hidden>
                    ›
                  </span>
                ) : null}
                {index < 0 ? (
                  <span className="text-muted-foreground">…</span>
                ) : index === last ? (
                  <span aria-current="page" className="font-semibold text-foreground">
                    {trail[index].centre.handle}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => orbits.jumpTo(index)}
                    className="rounded font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {trail[index].centre.handle}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : (
        <p className="text-meta text-muted-foreground">
          {hiddenTotal > 0
            ? `Showing the strongest ${graph.nodes.length} of ${graph.nodes.length + hiddenTotal} people.`
            : `Showing ${graph.nodes.length === 1 ? 'the one person' : `all ${graph.nodes.length} people`} with references.`}
        </p>
      )}
      {graph.nodes.length > 0 ? (
        <label className="flex cursor-pointer items-center gap-2 text-meta font-medium text-muted-foreground">
          <Switch checked={showConnections} onCheckedChange={orbits.toggleConnections} />
          Connections
        </label>
      ) : null}
    </div>
  );
}

function NetworkInspector({ orbits }: { orbits: TrustOrbits }) {
  const { graph, trail, selectedKey, directory, scene, pendingKey, frame } = orbits;
  const { centre } = graph;
  const entry = selectedKey ? directory.get(selectedKey) : undefined;
  const item = selectedKey ? scene.items.get(selectedKey) : undefined;
  const gesture = frame.compact ? 'Double-tap' : 'Double-click';

  if (!selectedKey || !entry || !item || entry.kind === 'centre') {
    const previous = trail.length > 1 ? trail[trail.length - 2].centre.handle : null;
    return (
      <div className="border-t border-border/80 px-5 py-4">
        <p className="text-body text-foreground">
          <span className="font-semibold">{centre.handle}</span>
          {` · ${plural(centre.peopleCount, 'person vouches', 'people vouch')} for them`}
          {centre.negativeCount > 0 ? ` · ${plural(centre.negativeCount, 'issue', 'issues')}` : ''}
        </p>
        <p className="mt-1 text-meta text-muted-foreground">
          {previous ? `You walked here from ${previous}. ` : ''}
          Select someone to see who they know. {gesture} anyone to explore their network.
        </p>
      </div>
    );
  }

  const pending = pendingKey === selectedKey;
  const actions = (handleSlug: string) => (
    <div className="flex shrink-0 items-center gap-3">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => orbits.centreOn(selectedKey)}>
        {pending ? 'Opening…' : 'Centre on them'}
      </Button>
      <Link
        href={`/references/${encodeURIComponent(handleSlug)}`}
        className="text-meta font-semibold text-iris-ink hover:underline"
      >
        Profile
      </Link>
    </div>
  );

  if (entry.kind === 'child') {
    const { child } = entry;
    const parent = item.parentKey ? directory.get(item.parentKey) : undefined;
    const parentHandle = parent?.kind === 'node' ? parent.node.handle : entry.parent.handle;
    return (
      <div className="flex flex-col gap-3 border-t border-border/80 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar displayName={child.handle.replace(/^@/, '')} size="md" />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-body font-semibold text-foreground">{child.handle}</span>
              <TierBadge tier={child.kind} />
            </div>
            <p className="text-meta text-muted-foreground">
              Vouches for {parentHandle}, not {centre.handle} directly ·{' '}
              {plural(child.refs, 'reference', 'references')} of their own.
            </p>
          </div>
        </div>
        {actions(child.handleSlug)}
      </div>
    );
  }

  const { node } = entry;
  const tier = tierOf(node);
  const linked = scene.crossLinks
    .flatMap(([a, b]) => (a === selectedKey ? [b] : b === selectedKey ? [a] : []))
    .flatMap((key) => {
      const other = directory.get(key);
      return other?.kind === 'node' ? [other.node.handle] : [];
    });
  const ownShown = scene.satelliteLinks.filter(([parent]) => parent === selectedKey).length;
  const meta = [
    node.name !== node.handle.replace(/^@/, '') ? node.name : null,
    plural(node.refs, 'reference', 'references'),
    node.roleLabel,
    node.deals > 1 ? `${node.deals} deals` : null,
    node.dateLabel,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3 border-t border-border/80 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar avatarPath={node.avatarPath} displayName={node.name} size="md" />
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-body font-semibold text-foreground">{node.handle}</span>
            {node.identityVerified ? (
              <HugeiconsIcon icon={ShieldCheckIcon} className="size-3.5 shrink-0 text-trust" aria-label="ID verified" />
            ) : null}
            <TierBadge tier={tier} category={node.categoryLabel} />
            {node.platforms.map((slug) => (
              <PlatformChip key={slug} slug={slug} />
            ))}
          </div>
          <p className="text-meta text-muted-foreground">{meta.join(' · ')}</p>
          {node.comment ? (
            <blockquote className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-body text-foreground">
              &ldquo;{node.comment}&rdquo;
            </blockquote>
          ) : null}
          <p className="text-meta text-muted-foreground">
            {tier === 'issue'
              ? 'Issues are always shown apart from everyone else and never averaged away.'
              : [
                  linked.length > 0 ? `Has also dealt with ${linked.join(', ')}.` : null,
                  ownShown > 0 ? `${plural(ownShown, 'of their own vouchers is', 'of their own vouchers are')} shown around them.` : null,
                ]
                  .filter(Boolean)
                  .join(' ') || 'No one else here has dealt with them yet.'}
          </p>
        </div>
      </div>
      {actions(node.handleSlug)}
    </div>
  );
}

function ExperienceList({ orbits }: { orbits: TrustOrbits }) {
  const { graph, selectedKey } = orbits;
  return (
    <div className="border-t border-border/80 bg-card px-5 py-4">
      <h4 className="mb-3 text-meta font-semibold uppercase tracking-wider text-muted-foreground">
        Experiences ({graph.nodes.length})
      </h4>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {graph.nodes.map((node) => {
          const key = nodeKey(node);
          const isSelected = key === selectedKey;
          const negative = node.sentiment === 'NEGATIVE';
          return (
            <li key={node.id}>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => orbits.select(key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    orbits.select(key);
                  }
                }}
                className={cn(
                  'group flex h-full cursor-pointer flex-col justify-between rounded-xl border p-3.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isSelected
                    ? 'border-foreground/40 bg-muted/30 shadow-2xs'
                    : 'border-border/80 bg-card hover:border-foreground/25 hover:bg-muted/15',
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
                            className="truncate text-body font-semibold text-foreground hover:underline"
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
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold',
                          negative ? 'bg-destructive/10 text-destructive' : 'bg-trust/10 text-trust',
                        )}
                      >
                        <HugeiconsIcon icon={negative ? AlertCircleIcon : CheckmarkCircle02Icon} className="size-3" aria-hidden />
                        {negative ? 'Negative' : 'Positive'}
                      </span>
                    </div>
                  </div>

                  {node.comment ? (
                    <p className="mt-2.5 text-body text-foreground/90">&ldquo;{node.comment}&rdquo;</p>
                  ) : null}
                </div>

                <div className="mt-2.5 flex items-center justify-between text-meta text-muted-foreground">
                  <span>
                    {negative ? (node.categoryLabel ?? TIER_LABEL.issue) : TIER_LABEL[node.kind]}
                    {node.deals > 1 ? ` · ${node.deals} deals` : ''}
                  </span>
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

function EmptyNetwork({ graph }: { graph: ReferenceGraphData }) {
  const { centre } = graph;
  return (
    <div className="relative flex min-h-[340px] flex-col items-center justify-center bg-muted/15 px-6 py-14 text-center">
      <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl border border-border bg-card shadow-xs">
        <span className="text-lead font-semibold text-foreground">
          {centre.name.replace(/^@/, '').slice(0, 2).toUpperCase()}
        </span>
      </div>
      <p className="text-body font-semibold text-foreground">{centre.handle}</p>
      <p className="mt-1 max-w-md text-body text-muted-foreground">
        No experiences recorded yet across Instagram, Facebook, Discord, or NoDitto. If you have done a deal with{' '}
        {centre.handle}, add the first node to their graph.
      </p>
    </div>
  );
}

export function ReferenceGraph({
  data,
  action,
}: {
  data: ReferenceGraphData;
  /** The ShareExperience control (or the owner's share link control). */
  action?: ReactNode;
}) {
  const orbits = useTrustOrbits(data);
  const { graph, trail } = orbits;
  const walkedFrom = trail.length > 1 ? trail[0].centre.handle : null;
  const { centre } = graph;
  const hasPeople = graph.nodes.length > 0;

  return (
    <section
      aria-labelledby="references-heading"
      className="overflow-hidden rounded-2xl border border-border/90 bg-card shadow-xs"
    >
      <NetworkHeader graph={graph} action={walkedFrom ? null : action} walkedFrom={walkedFrom} />
      {hasPeople || walkedFrom ? <NetworkToolbar orbits={orbits} /> : null}
      {hasPeople ? (
        <>
          <div className="bg-muted/15 px-2 py-3 sm:px-4">
            <TrustOrbitsCanvas
              orbits={orbits}
              label={`Trust Network for ${centre.handle}: ${plural(centre.peopleCount, 'person vouches', 'people vouch')} for them`}
            />
          </div>
          <NetworkInspector orbits={orbits} />
          <ExperienceList orbits={orbits} />
        </>
      ) : (
        <EmptyNetwork graph={graph} />
      )}
    </section>
  );
}
