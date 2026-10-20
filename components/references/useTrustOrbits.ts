'use client';

// components/references/useTrustOrbits.ts
//
// State behind the Trust Network graph: who is centred (and the trail walked to
// get there), who is selected, and the blend from one scene to the next. Walking
// loads the next person's graph from `/api/references/graph`; selecting someone
// starts that load early, so a double-click usually lands on a warm cache.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import {
  COMPACT_FRAME,
  WIDE_FRAME,
  blendOrbitItems,
  buildOrbitScene,
  easeInOut,
  orbitKey,
  type OrbitItem,
  type OrbitPersonInput,
} from '@/domain/references/orbits';
import type {
  ReferenceGraphChild,
  ReferenceGraphData,
  ReferenceGraphNode,
} from '@/lib/references/graph';

/** A second tap on the same person inside this window centres on them. */
const DOUBLE_TAP_MS = 450;
const WALK_MS = 820;
const SELECT_MS = 260;

const WIDE_QUERY = '(min-width: 640px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Ring order: similar deals sit together, NoDitto first. */
const PLATFORM_ORDER = ['noditto', 'instagram', 'facebook', 'discord', 'ebay', 'whatnot', 'in-person', 'other'];

function listen(query: string, onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

// Module-level so each identity is stable across renders, as `useSyncExternalStore` requires.
const subscribeWide = (onChange: () => void) => listen(WIDE_QUERY, onChange);
const getWide = () => window.matchMedia(WIDE_QUERY).matches;
const subscribeReducedMotion = (onChange: () => void) => listen(REDUCED_MOTION_QUERY, onChange);
const getReducedMotion = () => window.matchMedia(REDUCED_MOTION_QUERY).matches;
const serverTrue = () => true;
const serverFalse = () => false;

function useAnimationClock(active: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    let frame = requestAnimationFrame(function tick(time) {
      setNow(time);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return now;
}

export function nodeKey(node: ReferenceGraphNode): string {
  return orbitKey(node.profileId, node.sentiment);
}

export function centreKeyOf(graph: ReferenceGraphData): string {
  return graph.centre.profileId ?? `${graph.centre.kind}:${graph.centre.id}`;
}

export function centreInitials(graph: ReferenceGraphData): string {
  return graph.centre.name.replace(/^@/, '').slice(0, 2).toUpperCase();
}

/**
 * Anyone the graph can draw, from any graph on the trail, by orbit key. The
 * newest graph wins, because a comment or role only means something relative to
 * the person currently in the centre.
 */
export type OrbitEntry =
  | { kind: 'centre'; key: string; graph: ReferenceGraphData }
  | { kind: 'node'; key: string; node: ReferenceGraphNode }
  | { kind: 'child'; key: string; child: ReferenceGraphChild; parent: ReferenceGraphNode };

export function entryHandle(entry: OrbitEntry): string {
  if (entry.kind === 'centre') return entry.graph.centre.handle;
  return entry.kind === 'node' ? entry.node.handle : entry.child.handle;
}

export function entryProfileId(entry: OrbitEntry): string | null {
  if (entry.kind === 'centre') return entry.graph.centre.profileId;
  return entry.kind === 'node' ? entry.node.profileId : entry.child.profileId;
}

function directoryOf(trail: readonly ReferenceGraphData[]): Map<string, OrbitEntry> {
  const entries = new Map<string, OrbitEntry>();
  for (const graph of [...trail].reverse()) {
    const centreKey = centreKeyOf(graph);
    if (!entries.has(centreKey)) entries.set(centreKey, { kind: 'centre', key: centreKey, graph });
    for (const node of graph.nodes) {
      const key = nodeKey(node);
      if (!entries.has(key)) entries.set(key, { kind: 'node', key, node });
    }
    for (const node of graph.nodes) {
      for (const child of node.children) {
        if (!entries.has(child.profileId)) {
          entries.set(child.profileId, { kind: 'child', key: child.profileId, child, parent: node });
        }
      }
    }
  }
  return entries;
}

function orbitPeople(graph: ReferenceGraphData): OrbitPersonInput[] {
  return graph.nodes.map((node) => {
    const rank = PLATFORM_ORDER.indexOf(node.platform);
    return {
      key: nodeKey(node),
      tier: node.sentiment === 'NEGATIVE' ? 'issue' : node.kind,
      order: rank === -1 ? PLATFORM_ORDER.length : rank,
      refs: node.refs,
      label: node.handle,
      satellites: node.children.map((child) => ({ key: child.profileId, tier: child.kind })),
    };
  });
}

export interface OrbitTransition {
  from: ReadonlyMap<string, OrbitItem>;
  start: number;
  duration: number;
  previousCentre: string;
  previousSpokes: readonly string[];
  previousCrossLinks: readonly [string, string][];
  previousSatelliteLinks: readonly [string, string][];
}

export function useTrustOrbits(root: ReferenceGraphData) {
  const [rootGraph, setRootGraph] = useState(root);
  const [trail, setTrail] = useState<ReferenceGraphData[]>([root]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showConnections, setShowConnections] = useState(true);
  const [transition, setTransition] = useState<OrbitTransition | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // A different person's page: start their graph fresh rather than carry a walk over.
  if (root !== rootGraph) {
    setRootGraph(root);
    setTrail([root]);
    setSelectedKey(null);
    setTransition(null);
    setPendingKey(null);
  }

  const wide = useSyncExternalStore(subscribeWide, getWide, serverTrue);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, serverFalse);
  const frame = wide ? WIDE_FRAME : COMPACT_FRAME;

  const graph = trail[trail.length - 1];
  const centreKey = centreKeyOf(graph);
  const people = useMemo(() => orbitPeople(graph), [graph]);
  const directory = useMemo(() => directoryOf(trail), [trail]);
  const scene = useMemo(
    () =>
      buildOrbitScene({ centreKey, people, links: graph.links, selectedKey, showConnections, frame }),
    [centreKey, people, graph.links, selectedKey, showConnections, frame],
  );

  const now = useAnimationClock(transition !== null);
  const progress =
    transition === null
      ? 1
      : easeInOut(Math.min(1, Math.max(0, (now - transition.start) / transition.duration)));
  useEffect(() => {
    if (transition && progress >= 1) setTransition(null);
  }, [transition, progress]);

  const items = blendOrbitItems(transition ? transition.from : null, scene.items, progress, centreKey);

  // What is on screen right now, read by the next transition as its starting point.
  const latest = useRef({ items, scene, centreKey, trail, reducedMotion });
  useEffect(() => {
    latest.current = { items, scene, centreKey, trail, reducedMotion };
  });

  const graphs = useRef(new Map<string, Promise<ReferenceGraphData>>());
  const walkToken = useRef(0);
  const lastTap = useRef<{ key: string; at: number } | null>(null);

  const begin = (duration: number) => {
    const current = latest.current;
    if (current.reducedMotion) return;
    setTransition({
      from: current.items,
      start: performance.now(),
      duration,
      previousCentre: current.centreKey,
      previousSpokes: current.scene.spokes,
      previousCrossLinks: current.scene.crossLinks,
      previousSatelliteLinks: current.scene.satelliteLinks,
    });
  };

  const loadGraph = (profileId: string): Promise<ReferenceGraphData> => {
    const cached = graphs.current.get(profileId);
    if (cached) return cached;
    const request = fetch(`/api/references/graph?profile=${encodeURIComponent(profileId)}`).then(
      async (response) => {
        if (!response.ok) throw new Error(`Reference graph request failed (${response.status})`);
        return (await response.json()) as ReferenceGraphData;
      },
    );
    graphs.current.set(profileId, request);
    request.catch(() => graphs.current.delete(profileId));
    return request;
  };

  const walkable = (key: string): string | null => {
    if (key === centreKey) return null;
    const entry = directory.get(key);
    return entry ? entryProfileId(entry) : null;
  };

  const go = (next: ReferenceGraphData[]) => {
    walkToken.current += 1;
    setPendingKey(null);
    begin(WALK_MS);
    setTrail(next);
    setSelectedKey(null);
  };

  const select = (key: string | null) => {
    if (key === selectedKey) return;
    begin(SELECT_MS);
    setSelectedKey(key);
    const profileId = key ? walkable(key) : null;
    if (profileId && !trail.some((g) => g.centre.profileId === profileId)) {
      loadGraph(profileId).catch(() => {});
    }
  };

  const centreOn = (key: string) => {
    const profileId = walkable(key);
    const entry = directory.get(key);
    if (!profileId || !entry) return;

    const visited = trail.findIndex((g) => g.centre.profileId === profileId);
    if (visited >= 0) {
      go(trail.slice(0, visited + 1));
      return;
    }

    walkToken.current += 1;
    const token = walkToken.current;
    setPendingKey(key);
    loadGraph(profileId)
      .then((next) => {
        if (token !== walkToken.current) return;
        go([...latest.current.trail, next]);
      })
      .catch(() => {
        if (token !== walkToken.current) return;
        setPendingKey(null);
        toast.error(`Couldn't open ${entryHandle(entry)}'s network. Try again.`);
      });
  };

  const tap = (key: string) => {
    const at = performance.now();
    const previous = lastTap.current;
    if (previous && previous.key === key && at - previous.at < DOUBLE_TAP_MS) {
      lastTap.current = null;
      centreOn(key);
      return;
    }
    lastTap.current = { key, at };
    select(key);
  };

  const back = () => {
    if (trail.length > 1) go(trail.slice(0, -1));
  };

  const jumpTo = (index: number) => {
    if (index >= 0 && index < trail.length - 1) go(trail.slice(0, index + 1));
  };

  const toggleConnections = () => {
    begin(SELECT_MS);
    setShowConnections((on) => !on);
  };

  return {
    graph,
    trail,
    frame,
    scene,
    items,
    transition,
    progress,
    centreKey,
    selectedKey,
    pendingKey,
    showConnections,
    directory,
    select,
    tap,
    centreOn,
    back,
    jumpTo,
    toggleConnections,
  };
}

export type TrustOrbits = ReturnType<typeof useTrustOrbits>;
