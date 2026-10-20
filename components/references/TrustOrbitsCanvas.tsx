'use client';

// components/references/TrustOrbitsCanvas.tsx
//
// Paints one frame of the Trust Network: dashed rings, curved spokes, arcs between
// people who have dealt with each other, satellites, and the people themselves.
// Every position comes from `domain/references/orbits.ts`; this file only draws
// and forwards taps.

import type { KeyboardEvent } from 'react';

import {
  PILL_HEIGHT,
  TIER_LABEL,
  arcPath,
  centreRadius,
  dotRadius,
  pillWidth,
  satelliteRadius,
  spokePath,
  truncateLabel,
  type OrbitItem,
  type OrbitTier,
  type Point,
} from '@/domain/references/orbits';
import { centreInitials, type OrbitEntry, type TrustOrbits } from '@/components/references/useTrustOrbits';
import { cn } from '@/lib/utils';

const INK = 'hsl(var(--foreground))';
const DANGER = 'hsl(var(--destructive))';
const CARD = 'hsl(var(--card))';
const RULE = 'hsl(var(--border))';
const QUIET_TEXT = 'hsl(var(--muted-foreground))';
const FOCUS = 'hsl(var(--ring))';

interface StrokeStyle {
  stroke: string;
  width: number;
  dash?: string;
}

const SPOKE: Record<OrbitTier, StrokeStyle> = {
  escrow: { stroke: 'hsl(var(--foreground) / 0.5)', width: 1.6 },
  receipt: { stroke: 'hsl(var(--foreground) / 0.3)', width: 1.3 },
  vouch: { stroke: 'hsl(var(--foreground) / 0.16)', width: 1 },
  issue: { stroke: DANGER, width: 1.4, dash: '4 3' },
};

const OUTLINE: Record<OrbitTier, StrokeStyle> = {
  escrow: { stroke: 'hsl(var(--trust))', width: 1.8 },
  receipt: { stroke: 'hsl(var(--trust))', width: 1.3, dash: '2.4 1.8' },
  vouch: { stroke: 'hsl(var(--foreground) / 0.35)', width: 1.2 },
  issue: { stroke: DANGER, width: 1.8 },
};

/** Opacity for anything outside the selected person's connections. */
const DIM_NODE = 0.28;
const DIM_LINE = 0.16;

interface Who {
  handle: string;
  initials: string;
  refs: number;
}

function describe(entry: OrbitEntry | undefined): Who {
  if (!entry) return { handle: 'Member', initials: '?', refs: 0 };
  if (entry.kind === 'centre') {
    return {
      handle: entry.graph.centre.handle,
      initials: centreInitials(entry.graph),
      refs: entry.graph.centre.peopleCount,
    };
  }
  const person = entry.kind === 'node' ? entry.node : entry.child;
  return { handle: person.handle, initials: person.initials, refs: person.refs };
}

function FloatingTag({ at, label, tier, frameWidth }: { at: Point; label: string; tier: OrbitTier | null; frameWidth: number }) {
  const text = truncateLabel(label, 20);
  const width = 18 + text.length * 6.1;
  const x = Math.min(frameWidth - width / 2 - 4, Math.max(width / 2 + 4, at.x));
  const y = Math.max(14, at.y);
  const colour = tier === 'issue' ? DANGER : INK;
  return (
    <g pointerEvents="none">
      <rect x={x - width / 2} y={y - 10} width={width} height={20} rx={10} fill={CARD} stroke={colour} strokeWidth={1.2} />
      <text x={x} y={y + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} fill={colour}>
        {text}
      </text>
    </g>
  );
}

export function TrustOrbitsCanvas({ orbits, label }: { orbits: TrustOrbits; label: string }) {
  const {
    scene,
    items,
    transition,
    progress,
    centreKey,
    selectedKey,
    pendingKey,
    showConnections,
    directory,
    graph,
  } = orbits;
  const { frame } = scene;
  const compact = frame.compact;

  const neighbours = new Set<string>();
  if (selectedKey) {
    for (const [a, b] of scene.crossLinks) {
      if (a === selectedKey) neighbours.add(b);
      if (b === selectedKey) neighbours.add(a);
    }
    for (const [parent, satellite] of scene.satelliteLinks) {
      if (parent === selectedKey) neighbours.add(satellite);
      if (satellite === selectedKey) neighbours.add(parent);
    }
  }
  const dimmed = (key: string) => selectedKey !== null && key !== selectedKey && !neighbours.has(key);
  const selectedParent = selectedKey ? (scene.items.get(selectedKey)?.parentKey ?? null) : null;

  const hub = items.get(centreKey);
  const hubPoint: Point = hub ?? { x: scene.cx, y: scene.cy };
  const fade = transition ? 1 - progress : 0;

  const interactive = (key: string, ariaLabel: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': ariaLabel,
    'aria-pressed': key === selectedKey,
    className: cn('group cursor-pointer outline-none', pendingKey === key && 'animate-pulse'),
    onClick: () => orbits.tap(key),
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (key === selectedKey) orbits.centreOn(key);
        else orbits.select(key);
      } else if (event.key === 'Escape') {
        orbits.select(null);
      }
    },
  });

  const spoke = (key: string, from: Point, alpha: number, prefix: string) => {
    const item = items.get(key);
    if (!item?.tier) return null;
    const style = SPOKE[item.tier];
    const hot = key === selectedKey || key === selectedParent;
    const emphasis = dimmed(key) && !hot ? DIM_LINE : hot || !showConnections ? 1 : 0.6;
    return (
      <path
        key={`${prefix}-${key}`}
        d={spokePath(from.x, from.y, item.x, item.y)}
        fill="none"
        stroke={style.stroke}
        strokeWidth={hot ? style.width + 0.6 : style.width}
        strokeDasharray={style.dash}
        opacity={item.opacity * alpha * emphasis}
      />
    );
  };

  const arc = (a: string, b: string, alpha: number, prefix: string) => {
    const p = items.get(a);
    const q = items.get(b);
    if (!p || !q) return null;
    const hot = a === selectedKey || b === selectedKey;
    return (
      <path
        key={`${prefix}-${a}-${b}`}
        d={arcPath(p, q, hubPoint)}
        fill="none"
        stroke={hot ? 'hsl(var(--foreground) / 0.7)' : 'hsl(var(--foreground) / 0.2)'}
        strokeWidth={hot ? 1.8 : 1.1}
        opacity={Math.min(p.opacity, q.opacity) * alpha * (selectedKey && !hot ? DIM_LINE : 1)}
      />
    );
  };

  const tether = (parent: string, satellite: string, alpha: number, prefix: string) => {
    const p = items.get(parent);
    const s = items.get(satellite);
    if (!p || !s) return null;
    const hot = parent === selectedKey || satellite === selectedKey;
    return (
      <line
        key={`${prefix}-${satellite}`}
        x1={p.x}
        y1={p.y}
        x2={s.x}
        y2={s.y}
        stroke={hot ? 'hsl(var(--foreground) / 0.4)' : RULE}
        strokeWidth={hot ? 1.3 : 1}
        opacity={Math.min(p.opacity, s.opacity) * alpha * (selectedKey && !hot ? 0.3 : 1)}
      />
    );
  };

  const previousHub = transition && transition.previousCentre !== centreKey ? items.get(transition.previousCentre) : undefined;
  const crossKeys = new Set(scene.crossLinks.map(([a, b]) => `${a}|${b}`));
  const satelliteKeys = new Set(scene.satelliteLinks.map(([, s]) => s));

  const renderItem = (item: OrbitItem) => {
    const { key } = item;
    const entry = directory.get(key);
    const who = describe(entry);
    const tier = item.tier ?? 'vouch';
    const selected = key === selectedKey;
    const opacity = item.opacity * (dimmed(key) ? DIM_NODE : 1);
    const orbitR = dotRadius(tier, who.refs, compact);

    if (item.size > 1.5) {
      const r = orbitR + (centreRadius(compact) - orbitR) * Math.min(1, item.size - 1);
      return (
        <g key={key} opacity={item.opacity} pointerEvents="none">
          <circle cx={item.x} cy={item.y} r={r} fill={INK} />
          <text x={item.x} y={item.y + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} fill="hsl(var(--background))">
            {who.initials}
          </text>
        </g>
      );
    }

    const outline = OUTLINE[tier];
    const fanned = item.parentKey !== null && item.parentKey === selectedKey;
    const settled = !transition || transition.from.get(key)?.kind === item.kind;

    if (item.pill && settled) {
      const width = pillWidth(who.handle);
      const avatarX = -width / 2 + 13;
      return (
        <g
          key={key}
          transform={`translate(${item.x} ${item.y})`}
          opacity={opacity}
          {...interactive(key, `${who.handle}, ${TIER_LABEL[tier]}, ${who.refs} references`)}
        >
          <rect
            className="opacity-0 group-focus-visible:opacity-100"
            x={-width / 2 - 3}
            y={-PILL_HEIGHT / 2 - 3}
            width={width + 6}
            height={PILL_HEIGHT + 6}
            rx={PILL_HEIGHT / 2 + 3}
            fill="none"
            stroke={FOCUS}
            strokeWidth={2}
          />
          <rect
            x={-width / 2}
            y={-PILL_HEIGHT / 2}
            width={width}
            height={PILL_HEIGHT}
            rx={PILL_HEIGHT / 2}
            fill={CARD}
            stroke={selected ? INK : tier === 'issue' ? DANGER : RULE}
            strokeWidth={selected ? 1.6 : 1}
          />
          <circle
            cx={avatarX}
            cy={0}
            r={8.5}
            fill="hsl(var(--muted))"
            stroke={tier === 'vouch' ? 'none' : outline.stroke}
            strokeWidth={outline.width}
            strokeDasharray={outline.dash}
          />
          <text x={avatarX} y={0.5} textAnchor="middle" dominantBaseline="central" fontSize={7.5} fontWeight={700} fill={tier === 'issue' ? DANGER : QUIET_TEXT}>
            {who.initials}
          </text>
          <text x={avatarX + 13} y={0.5} dominantBaseline="central" fontSize={11} fontWeight={selected ? 700 : 600} fill={tier === 'issue' ? DANGER : INK}>
            {truncateLabel(who.handle)}
          </text>
        </g>
      );
    }

    const satR = satelliteRadius(fanned, compact);
    const r = satR + (orbitR - satR) * Math.min(1, Math.max(0, item.size));
    const parent = item.parentKey ? items.get(item.parentKey) : undefined;
    const labelRight = !parent || item.x >= parent.x;
    const parentHandle = item.parentKey ? describe(directory.get(item.parentKey)).handle : null;
    const ariaLabel =
      item.kind === 'satellite' && parentHandle
        ? `${who.handle}, vouches for ${parentHandle}, ${who.refs} references`
        : `${who.handle}, ${TIER_LABEL[tier]}, ${who.refs} references`;

    return (
      <g key={key} opacity={opacity} {...interactive(key, ariaLabel)}>
        <circle cx={item.x} cy={item.y} r={item.kind === 'satellite' ? Math.max(r + 3, fanned ? 12 : 9) : Math.max(r + 2, 16)} fill="transparent" />
        <circle
          className="opacity-0 group-focus-visible:opacity-100"
          cx={item.x}
          cy={item.y}
          r={r + 6}
          fill="none"
          stroke={FOCUS}
          strokeWidth={2}
        />
        {selected ? <circle cx={item.x} cy={item.y} r={r + 4} fill="none" stroke={INK} strokeWidth={1.4} /> : null}
        <circle
          cx={item.x}
          cy={item.y}
          r={r}
          fill={CARD}
          stroke={outline.stroke}
          strokeWidth={outline.width}
          strokeDasharray={outline.dash}
        />
        {r >= 9.5 ? (
          <text x={item.x} y={item.y + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(10, r * 0.78)} fontWeight={700} fill={tier === 'issue' ? DANGER : QUIET_TEXT}>
            {who.initials}
          </text>
        ) : null}
        {fanned && !compact ? (
          <text
            x={labelRight ? item.x + r + 5 : item.x - r - 5}
            y={item.y}
            textAnchor={labelRight ? 'start' : 'end'}
            dominantBaseline="central"
            fontSize={10}
            fontWeight={500}
            fill={QUIET_TEXT}
          >
            {truncateLabel(who.handle, 15)}
          </text>
        ) : null}
      </g>
    );
  };

  const people = [...items.values()]
    .filter((item) => item.key !== centreKey)
    .sort((a, b) => {
      const rank = (item: OrbitItem) => (item.key === selectedKey || item.parentKey === selectedKey ? 1 : 0);
      return rank(a) - rank(b);
    });

  const selectedItem = selectedKey ? items.get(selectedKey) : undefined;
  const showTag = selectedItem && selectedItem.kind !== 'centre' && (compact || selectedItem.kind === 'satellite');
  const centreEntry = directory.get(centreKey);
  const centreWho = describe(centreEntry);
  const hubR = centreRadius(compact);

  return (
    <svg
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      className="mx-auto block h-auto w-full max-w-[860px] touch-manipulation select-none"
      role="group"
      aria-label={label}
    >
      <rect width={frame.width} height={frame.height} fill="transparent" onClick={() => orbits.select(null)} />

      {scene.rings.map((ring, index) => (
        <ellipse
          key={ring.tier}
          cx={scene.cx}
          cy={scene.cy}
          rx={ring.rx}
          ry={ring.ry}
          fill="none"
          stroke={index === 0 ? 'hsl(var(--foreground) / 0.18)' : RULE}
          strokeDasharray="3 5"
        />
      ))}
      {compact
        ? null
        : scene.rings.map((ring) => {
            const more = graph.hidden[ring.tier];
            return (
              <text key={`label-${ring.tier}`} x={scene.cx} y={scene.cy + ring.ry + 14} textAnchor="middle" fontSize={10} fill={QUIET_TEXT}>
                {more > 0 ? `${TIER_LABEL[ring.tier]} · ${more} more` : TIER_LABEL[ring.tier]}
              </text>
            );
          })}

      {previousHub ? transition?.previousSpokes.filter((key) => key !== centreKey).map((key) => spoke(key, previousHub, fade * 0.6, 'was')) : null}
      {scene.spokes.map((key) => spoke(key, hubPoint, 1, 'spoke'))}
      {transition?.previousCrossLinks.filter(([a, b]) => !crossKeys.has(`${a}|${b}`)).map(([a, b]) => arc(a, b, fade, 'was'))}
      {scene.crossLinks.map(([a, b]) => arc(a, b, 1, 'arc'))}
      {transition?.previousSatelliteLinks.filter(([, s]) => !satelliteKeys.has(s)).map(([p, s]) => tether(p, s, fade, 'was'))}
      {scene.satelliteLinks.map(([p, s]) => tether(p, s, 1, 'tether'))}

      {hub ? (
        <g opacity={hub.opacity} className="cursor-pointer" onClick={() => orbits.select(null)}>
          <title>{centreWho.handle}</title>
          <circle
            cx={hub.x}
            cy={hub.y}
            r={dotRadius('escrow', centreWho.refs, compact) + (hubR - dotRadius('escrow', centreWho.refs, compact)) * Math.min(1, Math.max(0, hub.size - 1))}
            fill={INK}
          />
          <text x={hub.x} y={hub.y + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={compact ? 11 : 12} fontWeight={700} fill="hsl(var(--background))">
            {centreWho.initials}
          </text>
        </g>
      ) : null}

      {people.map(renderItem)}

      {showTag && selectedItem ? (
        <FloatingTag
          at={{ x: selectedItem.x, y: selectedItem.y - (selectedItem.kind === 'satellite' ? 18 : 26) }}
          label={describe(directory.get(selectedItem.key)).handle}
          tier={selectedItem.tier}
          frameWidth={frame.width}
        />
      ) : null}
    </svg>
  );
}
