'use client';

// components/references/TrustNetworkPanel.tsx
//
// The small card that floats over the bottom of the Trust Network while someone is
// selected: who they are, their review of the person in the middle (or, on the
// Given side, the middle person's review of them), any attached proof images, and
// who else they are connected to here.

import { useState, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Cancel01Icon, ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { IssueBadge, PlatformChip, StarRating, plural } from '@/components/references/referenceLabels';
import { nodeKey, type OrbitEntry, type TrustOrbits } from '@/components/references/useTrustOrbits';
import type { ReferenceGraphChild, ReferenceGraphNode } from '@/lib/references/graph';
import { cn } from '@/lib/utils';

/** How far the card travels as it slides in, in pixels. */
const SLIDE_PX = 16;
/** Avatars shown in a row before the rest are counted. */
const STACK_LIMIT = 4;

interface Person {
  key: string;
  handle: string;
  name: string;
  avatarPath: string | null;
}

function personOf(entry: OrbitEntry | undefined): Person | null {
  if (!entry) return null;
  if (entry.kind === 'centre') {
    const { centre } = entry.graph;
    return { key: entry.key, handle: centre.handle, name: centre.name, avatarPath: centre.avatarPath };
  }
  if (entry.kind === 'node') {
    const { node } = entry;
    return { key: entry.key, handle: node.handle, name: node.name, avatarPath: node.avatarPath };
  }
  return { key: entry.key, handle: entry.child.handle, name: entry.child.handle.replace(/^@/, ''), avatarPath: null };
}

function AvatarStack({ label, people, onPick }: { label: string; people: Person[]; onPick: (key: string) => void }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, STACK_LIMIT);
  const more = people.length - shown.length;
  return (
    <div className="flex items-center gap-1.5">
      <ul className="flex gap-0.5">
        {shown.map((person) => (
          <li key={person.key}>
            <button
              type="button"
              title={person.handle}
              aria-label={person.handle}
              onClick={() => onPick(person.key)}
              className="block rounded-full transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar avatarPath={person.avatarPath} displayName={person.name} size="xs" />
            </button>
          </li>
        ))}
        {more > 0 ? (
          <li className="grid size-6 place-items-center rounded-full bg-muted text-meta font-semibold text-muted-foreground">
            +{more}
          </li>
        ) : null}
      </ul>
      <span className="text-meta text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * One section of the panel card. The card holds two: who the person is, then what
 * the review says, split by a hairline like a card header and its content.
 */
function PanelCard({
  children,
  divided = false,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  /** Draws the hairline above, for every section after the first. */
  divided?: boolean;
  'aria-label'?: string;
}) {
  return (
    <div
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
      className={cn('space-y-1.5 px-3.5 py-3', divided && 'border-t border-border/80')}
    >
      {children}
    </div>
  );
}

/** Opens the person's own network. It acts on the person, so it sits in their header row. */
function OpenNetwork({ orbits, personKey }: { orbits: TrustOrbits; personKey: string }) {
  const pending = orbits.pendingKey === personKey;
  return (
    <Button
      size="xs"
      variant="outline"
      className="shrink-0"
      disabled={pending}
      aria-label={pending ? 'Opening…' : 'Open their network'}
      onClick={() => orbits.centreOn(personKey)}
    >
      {pending ? (
        'Opening…'
      ) : (
        <>
          {/* Phones share the header row with a long handle, so the label shortens there. */}
          Open<span className="hidden sm:inline"> their network</span>
        </>
      )}
      <HugeiconsIcon icon={ArrowRight01Icon} className="size-3" aria-hidden />
    </Button>
  );
}

function Header({
  prefix,
  person,
  verified,
  meta,
  orbits,
  onClose,
}: {
  prefix?: string;
  person: Person;
  verified: boolean;
  meta: string;
  orbits: TrustOrbits;
  onClose: () => void;
}) {
  return (
    <header className="flex items-center gap-snug">
      <Avatar avatarPath={person.avatarPath} displayName={person.name} size="sm" />
      <div className="min-w-0 flex-1">
        <h4 className="flex flex-wrap items-center gap-x-1.5 text-body font-semibold leading-snug text-foreground">
          {prefix ? (
            <span className="font-normal text-muted-foreground">{prefix}</span>
          ) : null}
          <span className="break-all">{person.handle}</span>
          {verified ? (
            <HugeiconsIcon
              icon={ShieldCheckIcon}
              className="size-3.5 shrink-0 text-trust"
              aria-label="ID verified"
            />
          ) : null}
        </h4>
        <p className="text-meta text-muted-foreground">{meta}</p>
      </div>
      <OpenNetwork orbits={orbits} personKey={person.key} />
      <Button variant="ghost" size="icon" className="-mr-1.5 shrink-0 max-sm:size-10" aria-label="Close" onClick={onClose}>
        <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
      </Button>
    </header>
  );
}

function PlanetDetails({ orbits, node, onClose }: { orbits: TrustOrbits; node: ReferenceGraphNode; onClose: () => void }) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const key = nodeKey(node);
  const negative = node.sentiment === 'NEGATIVE';
  const peopleFor = (keys: readonly string[]) =>
    keys.flatMap((other) => {
      const person = personOf(orbits.directory.get(other));
      return person ? [person] : [];
    });
  const given = orbits.view.direction === 'given';
  const dealtWith = peopleFor(orbits.view.links.flatMap(([a, b]) => (a === key ? [b] : b === key ? [a] : [])));
  const vouchers = peopleFor(orbits.scene.tethers.filter(([planet]) => planet === key).map(([, star]) => star));
  const images = node.images ?? [];
  // WHO goes on the person card; WHEN and HOW MUCH belong to the reference itself.
  // "Of their own" because this sits beside a review of someone ELSE: a bare
  // "0 refs" read as a count about the person in the middle.
  const personMeta = [
    node.name !== node.handle.replace(/^@/, '') ? node.name : null,
    node.refs === 0 ? 'No references of their own yet' : `${plural(node.refs, 'reference', 'references')} of their own`,
  ]
    .filter(Boolean)
    .join(' · ');
  // A repeat deal raises `deal_count` and OVERWRITES the stored month, rating, platform
  // and comment (`giveReference`), so with more than one deal everything shown here is
  // the latest one's. Say so rather than implying every deal happened that month.
  const referenceMeta =
    node.deals > 1
      ? `${plural(node.deals, 'deal', 'deals')}${node.dateLabel ? `, latest ${node.dateLabel}` : ''}`
      : (node.dateLabel ?? '');

  return (
    <>
      <PanelCard>
        <Header
          prefix={given ? `${orbits.graph.centre.handle} reviewed` : 'Reviewed by'}
          person={{ key, handle: node.handle, name: node.name, avatarPath: node.avatarPath }}
          verified={node.identityVerified}
          meta={personMeta}
          orbits={orbits}
          onClose={onClose}
        />
        {!negative && (dealtWith.length > 0 || vouchers.length > 0) ? (
          <div className="flex flex-wrap items-center gap-x-cozy gap-y-tight">
            <AvatarStack label="Also reviewed" people={dealtWith} onPick={orbits.select} />
            <AvatarStack label="Reviewed by" people={vouchers} onPick={orbits.select} />
          </div>
        ) : null}
      </PanelCard>

      <PanelCard divided aria-label={given ? `Review of ${node.handle}` : `Review from ${node.handle}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5">
            <StarRating sentiment={node.sentiment} rating={node.rating} />
            {negative && node.categoryLabel ? <IssueBadge category={node.categoryLabel} /> : null}
          </span>
          {node.platforms.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              {node.platforms.map((slug) => (
                <PlatformChip key={slug} slug={slug} className="size-5" />
              ))}
            </span>
          ) : null}
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            {node.comment ? (
              <p className="line-clamp-2 text-body text-foreground">{node.comment}</p>
            ) : null}
            {referenceMeta ? <p className="text-meta text-muted-foreground">{referenceMeta}</p> : null}
          </div>
          {images.length > 0 ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {images.map((url, idx) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setLightboxUrl(url)}
                  aria-label={`View reference image ${idx + 1} from ${node.handle}`}
                  className="overflow-hidden rounded-lg border border-border/80 bg-muted/40 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Reference attachment ${idx + 1}`}
                    className="size-11 object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </PanelCard>

      <Dialog open={lightboxUrl !== null} onOpenChange={(open) => !open && setLightboxUrl(null)}>
        {/* `center`, the documented media-viewer presentation: as the default phone
            sheet the image docked to the bottom, and `p-2` overrode the sheet's
            safe-area bottom padding, so the photo ran under the home indicator. */}
        <DialogContent mobile="center" className="p-2 sm:p-2">
          <DialogTitle className="sr-only">Reference attachment from {node.handle}</DialogTitle>
          {lightboxUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightboxUrl}
              alt={`Attachment from ${node.handle}`}
              className="max-h-[75vh] w-full rounded-lg object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StarDetails({
  orbits,
  starKey,
  child,
  parent,
  onClose,
}: {
  orbits: TrustOrbits;
  starKey: string;
  child: ReferenceGraphChild;
  parent: Person | null;
  onClose: () => void;
}) {
  return (
    <PanelCard>
      <Header
        prefix="Reviewed by"
        person={{ key: starKey, handle: child.handle, name: child.handle.replace(/^@/, ''), avatarPath: null }}
        verified={false}
        meta={`${plural(child.refs, 'ref', 'refs')} of their own`}
        orbits={orbits}
        onClose={onClose}
      />
      <p className="text-meta text-muted-foreground">
          Reviewed{' '}
          {parent ? (
            <button
              type="button"
              onClick={() => orbits.select(parent.key)}
              className="break-all font-semibold text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {parent.handle}
            </button>
          ) : (
            'someone here'
          )}
          , not {orbits.graph.centre.handle} directly.
      </p>
    </PanelCard>
  );
}

export function TrustNetworkPanel({ orbits }: { orbits: TrustOrbits }) {
  const { panel, directory, scene } = orbits;
  if (!panel.key) return null;
  const entry = directory.get(panel.key);
  if (!entry || entry.kind === 'centre') return null;

  const close = () => orbits.select(null);
  let content: ReactNode;
  if (entry.kind === 'node') {
    content = <PlanetDetails orbits={orbits} node={entry.node} onClose={close} />;
  } else {
    const parentKey = scene.items.get(entry.key)?.parentKey ?? nodeKey(entry.parent);
    content = (
      <StarDetails
        orbits={orbits}
        starKey={entry.key}
        child={entry.child}
        parent={personOf(directory.get(parentKey))}
        onClose={close}
      />
    );
  }

  return (
    <section
      aria-label={`About ${entry.kind === 'node' ? entry.node.handle : entry.child.handle}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
      style={{ opacity: panel.open, transform: `translateY(${(1 - panel.open) * SLIDE_PX}px)` }}
      className={cn(
        // One card, two sections (`PanelCard`): who the person is, then what they said.
        'absolute inset-x-2 bottom-2 z-10 mx-auto max-w-[520px] overflow-hidden rounded-2xl border border-border/85 bg-card/95 shadow-xl backdrop-blur-md sm:inset-x-3 sm:bottom-3',
        panel.open < 0.5 && 'pointer-events-none',
      )}
    >
      {content}
    </section>
  );
}
