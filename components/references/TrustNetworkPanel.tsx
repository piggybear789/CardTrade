'use client';

// components/references/TrustNetworkPanel.tsx
//
// The small card that floats over the bottom of the Trust Network while someone is
// selected: who they are, their review of the person in the middle, any attached
// proof images, and who else they are connected to here.

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
import { IssueBadge, PlatformChip, SentimentBadge, plural } from '@/components/references/referenceLabels';
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

function Header({
  prefix,
  person,
  verified,
  badge,
  meta,
  onClose,
}: {
  prefix?: string;
  person: Person;
  verified: boolean;
  badge?: ReactNode;
  meta: string;
  onClose: () => void;
}) {
  return (
    <header className="flex items-start gap-snug">
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
          {badge}
        </h4>
        <p className="text-meta text-muted-foreground">{meta}</p>
      </div>
      <Button variant="ghost" size="icon" className="-mr-1.5 -mt-1.5 size-7 shrink-0 rounded-full" aria-label="Close" onClick={onClose}>
        <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
      </Button>
    </header>
  );
}

/** Whatever sits on the left of the bottom row, with the compact action pill on the right. */
function Footer({
  orbits,
  personKey,
  children,
}: {
  orbits: TrustOrbits;
  personKey: string;
  children?: ReactNode;
}) {
  const pending = orbits.pendingKey === personKey;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-0.5">
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        size="xs"
        className="ml-auto shrink-0 rounded-full px-3"
        disabled={pending}
        onClick={() => orbits.centreOn(personKey)}
      >
        {pending ? 'Opening…' : 'Open their network'}
        <HugeiconsIcon icon={ArrowRight01Icon} className="size-3" aria-hidden />
      </Button>
    </div>
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
  const dealtWith = peopleFor(orbits.graph.links.flatMap(([a, b]) => (a === key ? [b] : b === key ? [a] : [])));
  const vouchers = peopleFor(orbits.scene.tethers.filter(([planet]) => planet === key).map(([, star]) => star));
  const images = node.images ?? [];
  const meta = [
    node.name !== node.handle.replace(/^@/, '') ? node.name : null,
    `${node.refs} ${node.refs === 1 ? 'ref' : 'refs'}`,
    node.dateLabel,
    node.deals > 1 ? `${node.deals} deals` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-2">
      <Header
        prefix="Reviewed by"
        person={{ key, handle: node.handle, name: node.name, avatarPath: node.avatarPath }}
        verified={node.identityVerified}
        badge={
          <span className="inline-flex items-center gap-1">
            <SentimentBadge sentiment={node.sentiment} rating={node.rating} />
            {negative && node.categoryLabel ? (
              <IssueBadge category={node.categoryLabel} />
            ) : null}
            {node.platforms.map((slug) => (
              <PlatformChip key={slug} slug={slug} className="size-5" />
            ))}
          </span>
        }
        meta={meta}
        onClose={onClose}
      />

      {node.comment || images.length > 0 ? (
        <div className="flex items-start justify-between gap-3">
          {node.comment ? (
            <p className="line-clamp-2 flex-1 text-body text-foreground">{node.comment}</p>
          ) : null}
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
      ) : null}

      <Footer orbits={orbits} personKey={key}>
        {!negative && (dealtWith.length > 0 || vouchers.length > 0) ? (
          <div className="flex flex-wrap items-center gap-x-cozy gap-y-tight">
            <AvatarStack label="Also reviewed" people={dealtWith} onPick={orbits.select} />
            <AvatarStack label="Reviewed by" people={vouchers} onPick={orbits.select} />
          </div>
        ) : null}
      </Footer>

      <Dialog open={lightboxUrl !== null} onOpenChange={(open) => !open && setLightboxUrl(null)}>
        <DialogContent className="sm:max-w-xl p-2">
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
    </div>
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
    <div className="space-y-2">
      <Header
        prefix="Reviewed by"
        person={{ key: starKey, handle: child.handle, name: child.handle.replace(/^@/, ''), avatarPath: null }}
        verified={false}
        meta={`${plural(child.refs, 'ref', 'refs')} of their own`}
        onClose={onClose}
      />
      <Footer orbits={orbits} personKey={starKey}>
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
      </Footer>
    </div>
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
        'absolute inset-x-2 bottom-2 z-10 mx-auto max-w-[520px] rounded-2xl border border-border/85 bg-card/95 p-3.5 shadow-xl backdrop-blur-md sm:inset-x-3 sm:bottom-3',
        panel.open < 0.5 && 'pointer-events-none',
      )}
    >
      {content}
    </section>
  );
}
