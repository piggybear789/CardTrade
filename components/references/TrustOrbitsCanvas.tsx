'use client';

// components/references/TrustOrbitsCanvas.tsx
//
// Paints one frame of the Trust Network: the sun, planets on orbits seen in
// perspective and sized by reputation, the selected planet's connections, and
// each handle with its star rating locked directly beneath its body so nothing
// jumps or shifts alignment as the system spins.

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

import {
  arcPath,
  spokePath,
  starPath,
  type OrbitArc,
  type OrbitItem,
  type OrbitRing,
  type OrbitSentiment,
  type Point,
} from '@/domain/references/orbits';
import { centreInitials, type OrbitEntry, type TrustOrbits } from '@/components/references/useTrustOrbits';
import { cn } from '@/lib/utils';

const INK = 'hsl(var(--foreground))';
const TRUST = 'hsl(var(--trust))';
const CAUTION_STROKE = 'hsl(var(--action-border))';
const CAUTION_TEXT = 'hsl(var(--action-foreground))';
const DANGER = 'hsl(var(--destructive))';
const CARD = 'hsl(var(--card))';
const QUIET_TEXT = 'hsl(var(--muted-foreground))';
const FOCUS_RING = 'hsl(var(--ring))';
const STAR_FILL = 'hsl(var(--trust) / 0.85)';

/** How faint everything outside the open planet's connections gets. */
const DIM_BODY = 0.28;
const DIM_LINE = 0.16;
/** A generous average glyph width, as a share of the font size, for fitting labels. */
const GLYPH_WIDTH = 0.6;
/** During a walk, the old labels fade over this first share of it and the new ones over the last. */
const LABEL_FADE = 0.35;
const LABEL_MARGIN = 4;
const SOFT_OVERLAP_PX = 12;

interface Who {
  handle: string;
  initials: string;
  refs: number;
  /** Subtitle line shown directly under the handle (e.g. `★★★★★` or `★★★★★ 5.0`). */
  ratingLine: string | null;
}

function defaultRating(sentiment: OrbitSentiment): number {
  if (sentiment === 'NEGATIVE') return 1;
  if (sentiment === 'NEUTRAL') return 3;
  return 5;
}

function starsString(rating: number): string {
  const clamped = Math.max(1, Math.min(5, Math.round(rating)));
  return '★'.repeat(clamped) + '☆'.repeat(5 - clamped);
}

function describe(entry: OrbitEntry | undefined): Who {
  if (!entry) return { handle: 'Member', initials: '?', refs: 0, ratingLine: null };
  if (entry.kind === 'centre') {
    const initials = centreInitials(entry.graph);
    const nodes = entry.graph.nodes;
    const avg =
      nodes.length > 0
        ? nodes.reduce((sum, n) => sum + (n.rating ?? defaultRating(n.sentiment)), 0) / nodes.length
        : null;
    return {
      handle: entry.graph.centre.handle,
      initials,
      refs: entry.graph.centre.peopleCount,
      ratingLine: avg !== null ? `${starsString(avg)} ${avg.toFixed(1)}` : null,
    };
  }
  if (entry.kind === 'node') {
    const rating = entry.node.rating ?? defaultRating(entry.node.sentiment);
    return {
      handle: entry.node.handle,
      initials: entry.node.initials,
      refs: entry.node.refs,
      ratingLine: starsString(rating),
    };
  }
  return {
    handle: entry.child.handle,
    initials: entry.child.initials,
    refs: entry.child.refs,
    ratingLine: null,
  };
}

function itemSentiment(item: OrbitItem): OrbitSentiment {
  if (item.sentiment) return item.sentiment;
  return item.issue ? 'NEGATIVE' : 'POSITIVE';
}

function planetPalette(sentiment: OrbitSentiment) {
  if (sentiment === 'NEGATIVE') {
    return {
      fill: 'hsl(var(--destructive) / 0.12)',
      stroke: DANGER,
      selectedRing: DANGER,
      text: DANGER,
      spoke: 'hsl(var(--destructive) / 0.45)',
      spokeHot: DANGER,
    };
  }
  if (sentiment === 'NEUTRAL') {
    return {
      fill: 'hsl(var(--action) / 0.32)',
      stroke: CAUTION_STROKE,
      selectedRing: CAUTION_STROKE,
      text: CAUTION_TEXT,
      spoke: 'hsl(var(--action-border) / 0.32)',
      spokeHot: CAUTION_STROKE,
    };
  }
  return {
    fill: 'hsl(var(--trust) / 0.12)',
    stroke: 'hsl(var(--trust) / 0.72)',
    selectedRing: TRUST,
    text: TRUST,
    spoke: 'hsl(var(--trust) / 0.24)',
    spokeHot: 'hsl(var(--trust) / 0.72)',
  };
}

function SunDisc({ at, r, initials }: { at: Point; r: number; initials: string }) {
  return (
    <>
      <circle cx={at.x} cy={at.y} r={r + 8} fill="hsl(var(--iris) / 0.08)" />
      <circle
        cx={at.x}
        cy={at.y}
        r={r + 3.5}
        fill="none"
        stroke="hsl(var(--iris) / 0.4)"
        strokeWidth={1.4}
      />
      <circle cx={at.x} cy={at.y} r={r} fill={INK} />
      <text
        x={at.x}
        y={at.y + 0.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.min(13, r * 0.45)}
        fontWeight={700}
        fill="hsl(var(--background))"
      >
        {initials}
      </text>
    </>
  );
}

function PlanetDisc({
  item,
  initials,
  selected,
}: {
  item: OrbitItem;
  initials: string;
  selected: boolean;
}) {
  const palette = planetPalette(itemSentiment(item));
  return (
    <>
      {selected ? (
        <circle
          cx={item.x}
          cy={item.y}
          r={item.r + 4}
          fill="none"
          stroke={palette.selectedRing}
          strokeWidth={1.6}
        />
      ) : null}
      <circle cx={item.x} cy={item.y} r={item.r} fill={CARD} />
      <circle
        cx={item.x}
        cy={item.y}
        r={item.r}
        fill={palette.fill}
        stroke={selected ? palette.selectedRing : palette.stroke}
        strokeWidth={item.issue || selected ? 1.8 : 1.4}
      />
      {item.r >= 10 ? (
        <text
          x={item.x}
          y={item.y + 0.5}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={Math.min(12, item.r * 0.6)}
          fontWeight={700}
          fill={palette.text}
        >
          {initials}
        </text>
      ) : null}
    </>
  );
}

interface LabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const round100 = (n: number) => Math.round(n * 100) / 100;

function boxPenetration(a: LabelBox, b: LabelBox, gap: number): number {
  const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left) + gap;
  const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + gap;
  if (ox <= 0 || oy <= 0) return 0;
  return Math.min(ox, oy);
}

/** Everyone a planet's open connections light up: itself, its stars and the planets it has dealt with. */
function litBy(key: string, arcs: readonly OrbitArc[], tethers: readonly [string, string][]): Set<string> {
  const lit = new Set<string>([key]);
  for (const arc of arcs) {
    if (arc.a === key) lit.add(arc.b);
    if (arc.b === key) lit.add(arc.a);
  }
  for (const [planet, star] of tethers) {
    if (planet === key) lit.add(star);
  }
  return lit;
}

export function TrustOrbitsCanvas({
  orbits,
  label,
  children,
}: {
  orbits: TrustOrbits;
  label: string;
  children?: ReactNode;
}) {
  const { scene, items, transition, progress, centreKey, selectedKey, pendingKey, directory } = orbits;
  const { frame } = scene;
  const fade = transition ? 1 - progress : 0;
  const focusKey = scene.focus?.key ?? null;
  const selectedParent = selectedKey ? (scene.items.get(selectedKey)?.parentKey ?? null) : null;
  const who = (key: string) => describe(directory.get(key) ?? transition?.previousDirectory.get(key));

  // Dimming follows how open each planet is, so it eases in and out with its connections.
  const lighting: { amount: number; lit: Set<string> }[] = [];
  for (const opened of [scene.focus, scene.closing]) {
    if (!opened) continue;
    const lit = litBy(opened.key, scene.arcs, scene.tethers);
    lit.add(centreKey);
    lighting.push({ amount: opened.open, lit });
  }
  if (transition?.previousFocus) {
    const lit = litBy(transition.previousFocus, transition.previousArcs, transition.previousTethers);
    lit.add(transition.previousCentre);
    lighting.push({ amount: fade, lit });
  }
  const dimOf = (key: string) =>
    Math.min(1, lighting.reduce((sum, light) => sum + (light.lit.has(key) ? 0 : light.amount), 0));

  const hub = items.get(centreKey);
  const hubPoint: Point = hub ?? { x: scene.cx, y: scene.cy };

  /** 1 for the sun, 0 for a planet, and part-way for whoever is swapping roles during a walk. */
  const sunness = (key: string): number => {
    const will = scene.items.get(key)?.kind === 'sun' ? 1 : 0;
    const was = transition?.from.get(key);
    if (!was) return will;
    const before = was.kind === 'sun' ? 1 : 0;
    return scene.items.has(key) ? before + (will - before) * progress : before;
  };

  const pointOf = (event: MouseEvent) => ({ x: event.clientX, y: event.clientY });

  const interactive = (key: string, ariaLabel: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': ariaLabel,
    'aria-pressed': key === selectedKey,
    className: cn('group cursor-pointer outline-none', pendingKey === key && 'animate-pulse'),
    onClick: (event: MouseEvent<SVGGElement>) => orbits.tap(key, pointOf(event)),
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
    if (!item || item.kind !== 'planet') return null;
    const hot = key === focusKey || key === selectedParent;
    const depthFade = hot ? 1 : 0.45 + 0.55 * ((item.depth + 1) / 2);
    const emphasis = hot ? 1 : 1 - (1 - DIM_LINE) * dimOf(key);
    const palette = planetPalette(itemSentiment(item));
    return (
      <path
        key={`${prefix}-${key}`}
        d={spokePath(from.x, from.y, item.x, item.y)}
        fill="none"
        stroke={hot ? palette.spokeHot : palette.spoke}
        strokeWidth={hot ? 2 : 1.1}
        strokeDasharray={item.issue ? '4 3' : undefined}
        opacity={item.opacity * alpha * emphasis * depthFade}
      />
    );
  };

  const arc = (link: OrbitArc, alpha: number, prefix: string) => {
    const p = items.get(link.a);
    const q = items.get(link.b);
    if (!p || !q) return null;
    return (
      <path
        key={`${prefix}-${link.a}-${link.b}`}
        d={arcPath(p, q, hubPoint)}
        fill="none"
        stroke="hsl(var(--trust) / 0.3)"
        strokeWidth={1.1}
        strokeDasharray="3 4"
        strokeLinecap="round"
        opacity={Math.min(p.opacity, q.opacity) * link.open * alpha}
      />
    );
  };

  const tether = (planet: string, star: string, alpha: number, prefix: string) => {
    const p = items.get(planet);
    const s = items.get(star);
    if (!p || !s) return null;
    return (
      <line
        key={`${prefix}-${star}`}
        x1={p.x}
        y1={p.y}
        x2={s.x}
        y2={s.y}
        stroke="hsl(var(--trust) / 0.32)"
        strokeWidth={1.1}
        strokeDasharray="2 3.5"
        strokeLinecap="round"
        opacity={Math.min(p.opacity, s.opacity) * alpha}
      />
    );
  };

  // The back half of each orbit passes behind the sun and the front half in front of it.
  const ringHalf = (rings: readonly OrbitRing[], half: 'back' | 'front', alpha: number, prefix: string) =>
    rings.map((ring, index) => (
      <path
        key={`${prefix}-${half}-${index}`}
        d={ring[half]}
        fill="none"
        stroke={index === 0 ? 'hsl(var(--foreground) / 0.16)' : 'hsl(var(--border))'}
        strokeWidth={half === 'front' ? 1.2 : 1}
        strokeDasharray="3 5"
        opacity={(half === 'front' ? 1 : 0.6) * alpha}
        pointerEvents="none"
      />
    ));
  const previousRings =
    transition && transition.previousRings.length !== scene.rings.length ? transition.previousRings : null;
  const ringAlpha = previousRings ? progress : 1;

  const renderBody = (item: OrbitItem) => {
    const { key } = item;
    const person = who(key);
    const opacity = item.opacity * (1 - (1 - DIM_BODY) * dimOf(key));
    const sun = sunness(key);

    if (sun > 0) {
      return (
        <g key={key} opacity={opacity} pointerEvents="none">
          {sun < 1 ? (
            <g opacity={1 - sun}>
              <PlanetDisc item={item} initials={person.initials} selected={false} />
            </g>
          ) : null}
          <g opacity={sun}>
            <SunDisc at={item} r={item.r} initials={person.initials} />
          </g>
        </g>
      );
    }

    const selected = key === selectedKey;
    if (item.kind === 'star') {
      const shape = (
        <>
          {selected ? <circle cx={item.x} cy={item.y} r={item.r + 6} fill="none" stroke={TRUST} strokeWidth={1.4} /> : null}
          <path d={starPath(item.x, item.y, item.r * 1.6)} fill={selected ? TRUST : STAR_FILL} />
        </>
      );
      // Stars still growing in, or folding away, are not yet anything to click.
      if (item.parentKey !== focusKey || item.opacity < 0.4) {
        return (
          <g key={key} opacity={opacity} pointerEvents="none" aria-hidden>
            {shape}
          </g>
        );
      }
      const parentHandle = item.parentKey ? who(item.parentKey).handle : 'them';
      return (
        <g
          key={key}
          opacity={opacity}
          {...interactive(key, `${person.handle}, vouches for ${parentHandle}, ${person.refs} references`)}
        >
          <circle
            className="opacity-0 group-focus-visible:opacity-100"
            cx={item.x}
            cy={item.y}
            r={item.r + 9}
            fill="none"
            stroke={FOCUS_RING}
            strokeWidth={2}
          />
          <circle cx={item.x} cy={item.y} r={Math.max(item.r + 6, 12)} fill="transparent" />
          {shape}
        </g>
      );
    }

    const sentiment = itemSentiment(item);
    const ariaSummary =
      sentiment === 'NEGATIVE'
        ? `${person.handle}, issue`
        : sentiment === 'NEUTRAL'
          ? `${person.handle}, mixed experience, ${person.refs} references`
          : `${person.handle}, ${person.refs} references`;

    return (
      <g
        key={key}
        opacity={opacity}
        {...interactive(key, ariaSummary)}
      >
        <circle cx={item.x} cy={item.y} r={Math.max(item.r + 4, 14)} fill="transparent" />
        <circle
          className="opacity-0 group-focus-visible:opacity-100"
          cx={item.x}
          cy={item.y}
          r={item.r + 7}
          fill="none"
          stroke={FOCUS_RING}
          strokeWidth={2}
        />
        <PlanetDisc item={item} initials={person.initials} selected={selected} />
      </g>
    );
  };

  const renderHub = () => {
    if (!hub) return null;
    if (sunness(centreKey) < 1) return renderBody(hub);
    const centre = who(centreKey);
    return (
      <g className="cursor-pointer" onClick={(event) => orbits.tap(null, pointOf(event))}>
        <title>{centre.handle}</title>
        <SunDisc at={hub} r={hub.r} initials={centre.initials} />
      </g>
    );
  };

  // Every label sits at a fixed offset directly beneath its disc (`anchor="middle"`) so
  // nothing ever jumps sides or flips alignment while the system turns. When two labels
  // pass across each other, the lower-priority one smoothly cross-fades by penetration.
  const visibleBodies = [...items.values()].filter((item) => item.opacity > 0.05);
  const fontSize = (kind: OrbitItem['kind']) =>
    frame.compact ? (kind === 'sun' ? 10.5 : 9.5) : kind === 'sun' ? 11.5 : kind === 'star' ? 10 : 10.5;

  const labelLayer = (
    sunKey: string,
    keys: readonly string[],
    alpha: number,
    prefix: string,
  ) => {
    if (alpha <= 0) return null;
    const orderedKeys = [sunKey, ...new Set(keys).values()].filter((k, idx, arr) => arr.indexOf(k) === idx);
    const bodyBoxes = visibleBodies.map((b) => ({
      key: b.key,
      depth: b.depth,
      box: { left: b.x - b.r, right: b.x + b.r, top: b.y - b.r, bottom: b.y + b.r },
    }));
    const placedBoxes: { box: LabelBox; weight: number }[] = [];

    return orderedKeys.map((key) => {
      const item = items.get(key);
      if (!item || item.opacity < 0.05) return null;
      const isSun = key === sunKey;
      const star = item.kind === 'star';
      const person = who(key);
      const size = fontSize(isSun ? 'sun' : item.kind);
      const height = person.ratingLine ? size * 2 + 4 : size + 4;
      const width =
        Math.max(person.handle.length, person.ratingLine?.length ?? 0) * size * GLYPH_WIDTH +
        (isSun ? 8 : 2);
      const gap = isSun ? item.r + 7 : item.r + 5;

      const minX = LABEL_MARGIN + width / 2;
      const maxX = Math.max(minX, frame.width - LABEL_MARGIN - width / 2);
      const x = round100(Math.min(maxX, Math.max(minX, item.x)));
      const y = round100(
        Math.min(frame.height - height / 2 - 2, Math.max(height / 2 + 2, item.y + gap + height / 2)),
      );
      const box: LabelBox = {
        left: x - width / 2,
        right: x + width / 2,
        top: y - height / 2,
        bottom: y + height / 2,
      };

      const required = isSun || key === selectedKey;
      let fadeFactor = 1;
      if (!required) {
        for (const other of bodyBoxes) {
          if (other.key === key) continue;
          const pen = boxPenetration(box, other.box, 2);
          if (pen > 0) {
            fadeFactor = Math.min(fadeFactor, Math.max(0, 1 - pen / SOFT_OVERLAP_PX));
          }
        }
        for (const prev of placedBoxes) {
          const pen = boxPenetration(box, prev.box, 3);
          if (pen > 0) {
            fadeFactor = Math.min(fadeFactor, Math.max(0, 1 - (pen * prev.weight) / SOFT_OVERLAP_PX));
          }
        }
      }

      if (fadeFactor <= 0.02) return null;
      placedBoxes.push({ box, weight: fadeFactor });

      const sentiment = itemSentiment(item);
      const handleFill = isSun
        ? INK
        : sentiment === 'NEGATIVE'
          ? DANGER
          : sentiment === 'NEUTRAL'
            ? CAUTION_TEXT
            : star
              ? QUIET_TEXT
              : INK;
      const ratingFill = isSun
        ? TRUST
        : sentiment === 'NEGATIVE'
          ? DANGER
          : sentiment === 'NEUTRAL'
            ? CAUTION_TEXT
            : TRUST;
      const groupOpacity =
        round100(item.opacity * (1 - (1 - DIM_BODY) * dimOf(key)) * alpha * fadeFactor);

      if (!person.ratingLine) {
        return (
          <text
            key={`${prefix}-${key}`}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={size}
            fontWeight={isSun || key === selectedKey ? 700 : star ? 500 : 600}
            fill={handleFill}
            stroke={CARD}
            strokeWidth={isSun ? 4 : 3}
            strokeLinejoin="round"
            paintOrder="stroke"
            opacity={groupOpacity}
          >
            {person.handle}
          </text>
        );
      }

      const lineOffset = round100(size * 0.56);
      return (
        <g key={`${prefix}-${key}`} opacity={groupOpacity}>
          <text
            x={x}
            y={round100(y - lineOffset)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={size}
            fontWeight={isSun || key === selectedKey ? 700 : 600}
            fill={handleFill}
            stroke={CARD}
            strokeWidth={isSun ? 4 : 3}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {person.handle}
          </text>
          <text
            x={x}
            y={round100(y + lineOffset)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={Math.max(8.5, size - 1)}
            fontWeight={600}
            letterSpacing="0.5"
            fill={ratingFill}
            stroke={CARD}
            strokeWidth={3}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {person.ratingLine}
          </text>
        </g>
      );
    });
  };

  const openStars = scene.tethers.filter(([planet]) => planet === focusKey).map(([, star]) => star);
  const partners = new Set(
    scene.arcs.flatMap((link) => (link.a === focusKey ? [link.b] : link.b === focusKey ? [link.a] : [])),
  );
  const labelOrder = [
    ...(selectedKey ? [selectedKey] : []),
    ...(focusKey ? [focusKey] : []),
    ...openStars,
    ...scene.planets.filter((key) => partners.has(key)),
    ...scene.planets,
  ];
  const labels = transition
    ? [
        labelLayer(
          transition.previousCentre,
          transition.previousPlanets,
          (LABEL_FADE - progress) / LABEL_FADE,
          'was-label',
        ),
        labelLayer(
          centreKey,
          scene.planets,
          (progress - (1 - LABEL_FADE)) / LABEL_FADE,
          'label',
        ),
      ]
    : labelLayer(centreKey, labelOrder, 1, 'label');

  const previousHub = transition && transition.previousCentre !== centreKey ? items.get(transition.previousCentre) : undefined;
  const bodies = [...items.values()].filter((item) => item.key !== centreKey).sort((a, b) => a.depth - b.depth);
  const arcIds = new Set(scene.arcs.map((link) => `${link.a}|${link.b}`));
  const tetherStars = new Set(scene.tethers.map(([, star]) => star));

  return (
    <div className="relative mx-auto w-full max-w-[860px]">
      <svg
        ref={orbits.attach}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="block h-auto w-full cursor-grab touch-pan-y select-none active:cursor-grabbing"
        role="group"
        aria-label={label}
        {...orbits.dragHandlers}
      >
        <rect
          width={frame.width}
          height={frame.height}
          fill="transparent"
          onClick={(event) => orbits.tap(null, pointOf(event))}
        />

        {previousRings ? ringHalf(previousRings, 'back', fade, 'was') : null}
        {ringHalf(scene.rings, 'back', ringAlpha, 'orbit')}

        {transition && previousHub
          ? transition.previousPlanets
              .filter((key) => key !== centreKey)
              .map((key) => spoke(key, previousHub, fade * 0.6, 'was'))
          : null}
        {scene.planets.map((key) => spoke(key, hubPoint, 1, 'spoke'))}
        {transition?.previousArcs
          .filter((link) => !arcIds.has(`${link.a}|${link.b}`))
          .map((link) => arc(link, fade, 'was'))}
        {scene.arcs.map((link) => arc(link, 1, 'arc'))}
        {transition?.previousTethers
          .filter(([, star]) => !tetherStars.has(star))
          .map(([p, s]) => tether(p, s, fade, 'was'))}
        {scene.tethers.map(([p, s]) => tether(p, s, 1, 'tether'))}

        {bodies.filter((item) => item.depth < 0).map(renderBody)}
        {renderHub()}
        {previousRings ? ringHalf(previousRings, 'front', fade, 'was') : null}
        {ringHalf(scene.rings, 'front', ringAlpha, 'orbit')}
        {bodies.filter((item) => item.depth >= 0).map(renderBody)}

        <g pointerEvents="none">{labels}</g>
      </svg>
      {children}
    </div>
  );
}
