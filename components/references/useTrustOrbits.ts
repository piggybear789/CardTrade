'use client';

// components/references/useTrustOrbits.ts
//
// State behind the Trust Network graph: who is the sun, who is selected and whose
// connections are open, how the system is turned, and the animations between those
// states. The system spins on its own and can be dragged. Selecting a planet pauses
// it, eases that planet round to the back-left diagonal (clear of the sun and of the
// details card along the bottom) and opens its connections.
//
// Opening someone's network goes to their page. The graph starts walking toward them
// at once, from `/api/references/graph` (selecting someone loads it early), while
// Next loads the page; that page's graph takes over mid-walk through `orbitHandoff`,
// so the whole move reads as one animation.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type RefObject,
} from 'react';

import {
  COMPACT_FRAME,
  DEFAULT_VIEW,
  SUN_Y,
  WIDE_FRAME,
  blendOrbitItems,
  buildOrbitScene,
  dragView,
  easeInOut,
  easeOut,
  orbitKey,
  wrapAngle,
  yawToSelectedRest,
  type OrbitArc,
  type OrbitItem,
  type OrbitPersonInput,
  type OrbitRing,
  type OrbitView,
  type Point,
} from '@/domain/references/orbits';
import {
  offerOrbitHandoff,
  receiveOrbitHandoff,
  withdrawOrbitHandoff,
  type OrbitHandoff,
} from '@/components/references/orbitHandoff';
import {
  referenceAddressKey,
  referenceGraphApiHref,
  type ReferenceAddress,
} from '@/domain/references/address';
import type {
  ReferenceGraphCentre,
  ReferenceGraphChild,
  ReferenceGraphData,
  ReferenceGraphNode,
} from '@/lib/references/graph';

/** A second tap this soon after the first, on the same body or the same spot, opens whoever the first selected. */
const DOUBLE_TAP_MS = 450;
const DOUBLE_TAP_SLOP_PX = 24;
const WALK_MS = 900;
const OPEN_MS = 480;
/** A turn takes longer the further it has to go. */
const TURN_MS = 420;
const TURN_PER_RADIAN_MS = 240;
const RESET_MS = 450;
/** About one turn every two minutes. */
const SPIN_PER_MS = 0.00005;
/** Drags shorter than this are taps. */
const DRAG_THRESHOLD_PX = 4;

const WIDE_QUERY = '(min-width: 640px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

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

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * One function identity for the life of the component that always runs the latest
 * version of `callback`. The system re-renders on every spin frame; handlers that kept
 * changing identity would re-render every memoised part of the page with it. For event
 * handlers only: the latest version is swapped in after render.
 */
function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}

/** Animation time. It starts at now, so a graph taking over mid-walk draws the right frame first. */
function useAnimationClock(active: boolean): number {
  const [now, setNow] = useState(() => (typeof performance === 'undefined' ? 0 : performance.now()));
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

interface Tween {
  from: OrbitView;
  to: OrbitView;
  start: number;
  duration: number;
}

interface Drag {
  pointerId: number;
  x: number;
  y: number;
  from: OrbitView;
  moved: boolean;
  grabbedFront: boolean;
  /** The drawing's width on screen, so a drag feels the same at any size. */
  widthPx: number;
}

/**
 * Spin, drag and eased turns for the system, starting from how the last page left
 * it when there is one. `sunAt` is how far down the drawing the sun currently sits,
 * which splits a grab into the near half or the far half.
 */
function useOrbitMotion(
  paused: boolean,
  reducedMotion: boolean,
  sunAt: RefObject<number>,
  inherited: OrbitHandoff | null,
) {
  const [view, setView] = useState<OrbitView>(inherited?.view ?? DEFAULT_VIEW);
  const [autoSpin, setAutoSpin] = useState(inherited ? inherited.autoSpin : !reducedMotion);
  const [dragging, setDragging] = useState(false);
  const [tweening, setTweening] = useState(false);
  const [element, setElement] = useState<Element | null>(null);
  const [visible, setVisible] = useState(true);
  const live = useRef(view);
  const tween = useRef<Tween | null>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    if (reducedMotion) setAutoSpin(false);
  }, [reducedMotion]);

  useEffect(() => {
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const commit = (next: OrbitView) => {
    live.current = next;
    setView(next);
  };

  const spinning = autoSpin && !paused && visible && !dragging;

  useEffect(() => {
    if (!spinning && !tweening) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const dt = Math.min(48, Math.max(0, now - last));
      last = now;
      const active = tween.current;
      let next: OrbitView | null = null;
      if (active) {
        const t = clamp01((now - active.start) / active.duration);
        const k = easeInOut(t);
        next = {
          yaw: active.from.yaw + (active.to.yaw - active.from.yaw) * k,
          tilt: active.from.tilt + (active.to.tilt - active.from.tilt) * k,
        };
        if (t >= 1) {
          tween.current = null;
          setTweening(false);
        }
      } else if (spinning) {
        next = { ...live.current, yaw: live.current.yaw + SPIN_PER_MS * dt };
      }
      if (next) {
        live.current = next;
        setView(next);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [spinning, tweening]);

  const animateTo = (to: OrbitView, duration: number) => {
    if (reducedMotion) {
      tween.current = null;
      setTweening(false);
      commit(to);
      return;
    }
    tween.current = { from: live.current, to, start: performance.now(), duration };
    setTweening(true);
  };

  /** Eases round to `yaw` the short way. */
  const turnTo = (yaw: number) => {
    const from = live.current;
    const delta = wrapAngle(yaw - from.yaw);
    if (Math.abs(delta) < 0.002) return;
    animateTo({ yaw: from.yaw + delta, tilt: from.tilt }, TURN_MS + TURN_PER_RADIAN_MS * Math.abs(delta));
  };

  const reset = () => animateTo({ yaw: live.current.yaw, tilt: DEFAULT_VIEW.tilt }, RESET_MS);

  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (current.moved) setDragging(false);
  };

  const handlers = {
    onPointerDown: (event: PointerEvent<SVGSVGElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      if (event.button !== 0 || box.width === 0 || box.height === 0) return;
      drag.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        from: live.current,
        moved: false,
        grabbedFront: (event.clientY - box.top) / box.height >= sunAt.current,
        widthPx: box.width,
      };
    },
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.moved) {
        if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_THRESHOLD_PX) return;
        // The drag starts here, from wherever an eased turn had got to.
        current.moved = true;
        current.x = event.clientX;
        current.y = event.clientY;
        current.from = live.current;
        tween.current = null;
        setTweening(false);
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      commit(
        dragView(
          current.from,
          (event.clientX - current.x) / current.widthPx,
          (event.clientY - current.y) / current.widthPx,
          current.grabbedFront,
        ),
      );
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  return {
    view,
    autoSpin,
    toggleSpin: () => setAutoSpin((on) => !on),
    tilted: Math.abs(view.tilt - DEFAULT_VIEW.tilt) > 0.01,
    turnTo,
    reset,
    attach: setElement,
    handlers,
  };
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

/** Anyone the graph can draw, from any graph it has shown, by orbit key. */
export type OrbitEntry =
  | { kind: 'centre'; key: string; graph: ReferenceGraphData }
  | { kind: 'node'; key: string; node: ReferenceGraphNode }
  | { kind: 'child'; key: string; child: ReferenceGraphChild; parent: ReferenceGraphNode };

/** Someone's page. */
export function entryAddress(entry: OrbitEntry): ReferenceAddress {
  if (entry.kind === 'centre') return entry.graph.centre.address;
  return entry.kind === 'node' ? entry.node.address : entry.child.address;
}

/**
 * The newest graph wins, because a comment or role only means something relative
 * to the person currently at the centre.
 */
function directoryOf(
  trail: readonly ReferenceGraphData[],
  /** What the newest graph is drawing: its received or its given references. */
  currentNodes: readonly ReferenceGraphNode[],
): Map<string, OrbitEntry> {
  const entries = new Map<string, OrbitEntry>();
  const newest = trail[trail.length - 1];
  for (const graph of [...trail].reverse()) {
    const centreKey = centreKeyOf(graph);
    // The centre entry keeps the whole graph: the sun shows their RECEIVED rating either way.
    if (!entries.has(centreKey)) entries.set(centreKey, { kind: 'centre', key: centreKey, graph });
    const nodes = graph === newest ? currentNodes : graph.nodes;
    for (const node of nodes) {
      const key = nodeKey(node);
      if (!entries.has(key)) entries.set(key, { kind: 'node', key, node });
    }
    for (const node of nodes) {
      for (const child of node.children) {
        if (!entries.has(child.profileId)) {
          entries.set(child.profileId, { kind: 'child', key: child.profileId, child, parent: node });
        }
      }
    }
  }
  return entries;
}

function orbitPeople(nodes: readonly ReferenceGraphNode[]): OrbitPersonInput[] {
  return nodes.map((node) => ({
    key: nodeKey(node),
    refs: node.refs,
    issue: node.sentiment === 'NEGATIVE',
    sentiment: node.sentiment,
    stars: node.children.map((child) => ({ key: child.profileId })),
  }));
}

interface FocusChange {
  /** The planet whose connections are closing, and how open they were when it began. */
  from: string | null;
  fromOpen: number;
  start: number;
}

/** A walk from one person's system to the next, and what is needed to fade the old one out. */
export interface OrbitTransition {
  from: ReadonlyMap<string, OrbitItem>;
  start: number;
  duration: number;
  previousCentre: string;
  previousPlanets: readonly string[];
  previousFocus: string | null;
  previousArcs: readonly OrbitArc[];
  previousTethers: readonly [string, string][];
  previousRings: readonly OrbitRing[];
  previousDirectory: ReadonlyMap<string, OrbitEntry>;
}

interface Tap {
  key: string | null;
  at: number;
  x: number;
  y: number;
}

/** Carries on a walk the last page started toward this person, or walks from wherever it left off. */
function walkFrom(handoff: OrbitHandoff | null, centreKey: string): OrbitTransition | null {
  if (!handoff || window.matchMedia(REDUCED_MOTION_QUERY).matches) return null;
  if (handoff.centreKey === centreKey) return handoff.transition;
  return {
    from: handoff.items,
    start: performance.now(),
    duration: WALK_MS,
    previousCentre: handoff.centreKey,
    previousPlanets: handoff.planets,
    previousFocus: handoff.focusKey,
    previousArcs: handoff.arcs,
    previousTethers: handoff.tethers,
    previousRings: handoff.rings,
    previousDirectory: handoff.directory,
  };
}

/** Which references the network draws: the ones left FOR the person, or the ones they LEFT. */
export type ReferenceDirection = 'received' | 'given';

/** One direction of a graph, in the shape everything below the toolbar draws from. */
export interface ReferenceView {
  direction: ReferenceDirection;
  nodes: readonly ReferenceGraphNode[];
  links: readonly [string, string][];
  platforms: ReferenceGraphCentre['platforms'];
  hidden: { people: number; issues: number };
  stats: { positive: number; neutral: number; negative: number };
}

const NO_LINKS: readonly [string, string][] = [];
const NO_NODES: readonly ReferenceGraphNode[] = [];

export function viewOf(graph: ReferenceGraphData, direction: ReferenceDirection): ReferenceView {
  if (direction === 'given') {
    const given = graph.given;
    return {
      direction,
      nodes: given?.nodes ?? NO_NODES,
      links: NO_LINKS,
      platforms: given?.platforms ?? [],
      hidden: given?.hidden ?? { people: 0, issues: 0 },
      stats: {
        positive: given?.positiveCount ?? 0,
        neutral: given?.neutralCount ?? 0,
        negative: given?.negativeCount ?? 0,
      },
    };
  }
  return {
    direction,
    nodes: graph.nodes,
    links: graph.links,
    platforms: graph.centre.platforms,
    hidden: graph.hidden,
    stats: {
      positive: graph.centre.peopleCount,
      neutral: graph.nodes.filter((n) => n.sentiment === 'NEUTRAL').length,
      negative: graph.centre.negativeCount,
    },
  };
}

/** How many references a direction holds, drawn or not. */
export function viewTotal(view: ReferenceView): number {
  return view.stats.positive + view.stats.neutral + view.stats.negative;
}

export interface TrustOrbitsOptions {
  /** Goes to someone's page; the graph is already walking toward them. */
  openPage: (address: ReferenceAddress) => void;
}

export function useTrustOrbits(root: ReferenceGraphData, { openPage }: TrustOrbitsOptions) {
  const [owner] = useState(() => ({}));
  const [inherited] = useState(() => (typeof window === 'undefined' ? null : receiveOrbitHandoff()));
  const [rootGraph, setRootGraph] = useState(root);
  // The page's own graph, then the one being walked to while that page loads.
  const [trail, setTrail] = useState<ReferenceGraphData[]>([root]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Who the details panel shows. It outlives the selection so the panel can close on them.
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [focusChange, setFocusChange] = useState<FocusChange | null>(null);
  const [transition, setTransition] = useState<OrbitTransition | null>(() => walkFrom(inherited, centreKeyOf(root)));
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);
  const [direction, setDirectionState] = useState<ReferenceDirection>('received');

  // The page refreshed its graph (after an experience is shared, say): start from it.
  // Still the same person, so a reader on the Given side stays there.
  if (root !== rootGraph) {
    const samePerson = centreKeyOf(root) === centreKeyOf(rootGraph);
    setRootGraph(root);
    setTrail([root]);
    setSelectedKey(null);
    setShownKey(null);
    setFocusKey(null);
    setFocusChange(null);
    setPendingKey(null);
    setPlatformFilter(null);
    if (!samePerson) setDirectionState('received');
  }

  const wide = useSyncExternalStore(subscribeWide, getWide, serverTrue);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, serverFalse);
  const frame = wide ? WIDE_FRAME : COMPACT_FRAME;
  const sunAt = useRef(SUN_Y);
  const motion = useOrbitMotion(selectedKey !== null || transition !== null, reducedMotion, sunAt, inherited);

  const graph = trail[trail.length - 1];
  const centreKey = centreKeyOf(graph);
  const view = useMemo(() => viewOf(graph, direction), [graph, direction]);
  const visibleNodes = useMemo(
    () =>
      platformFilter
        ? view.nodes.filter(
            (n) => n.platform === platformFilter || n.platforms.includes(platformFilter),
          )
        : view.nodes,
    [view.nodes, platformFilter],
  );
  const people = useMemo(() => orbitPeople(visibleNodes), [visibleNodes]);
  const directory = useMemo(() => directoryOf(trail, view.nodes), [trail, view.nodes]);

  const now = useAnimationClock(transition !== null || focusChange !== null);
  const progress = transition === null ? 1 : easeInOut(clamp01((now - transition.start) / transition.duration));
  const opening = focusChange === null ? 1 : easeOut(clamp01((now - focusChange.start) / OPEN_MS));
  const closingKey = focusChange && focusChange.from !== focusKey && opening < 1 ? focusChange.from : null;
  const closingOpen = focusChange ? focusChange.fromOpen * (1 - opening) : 0;
  // The panel opens with the first planet selected and closes with the last; moving
  // from one planet to the next keeps it open.
  const panelOpen = focusKey ? (closingKey ? 1 : opening) : closingKey ? closingOpen : 0;

  const scene = useMemo(
    () =>
      buildOrbitScene({
        centreKey,
        people,
        links: view.links,
        focus: focusKey ? { key: focusKey, open: opening } : null,
        closing: closingKey ? { key: closingKey, open: closingOpen } : null,
        frame,
        view: motion.view,
      }),
    [centreKey, people, view.links, focusKey, opening, closingKey, closingOpen, frame, motion.view],
  );

  useEffect(() => {
    if (transition && progress >= 1) setTransition(null);
  }, [transition, progress]);
  useEffect(() => {
    if (focusChange && opening >= 1) setFocusChange(null);
  }, [focusChange, opening]);

  const items = blendOrbitItems(transition ? transition.from : null, scene.items, progress, centreKey);

  // What is on screen right now: the starting point for the next walk, here or on the next page.
  const latest = useRef({ items, scene, centreKey, trail, directory, focusKey, reducedMotion });
  useEffect(() => {
    latest.current = { items, scene, centreKey, trail, directory, focusKey, reducedMotion };
    sunAt.current = scene.cy / frame.height;
    offerOrbitHandoff(owner, {
      centreKey,
      items,
      view: motion.view,
      autoSpin: motion.autoSpin,
      transition,
      planets: scene.planets,
      focusKey,
      arcs: scene.arcs,
      tethers: scene.tethers,
      rings: scene.rings,
      directory,
    });
  });
  useEffect(() => () => withdrawOrbitHandoff(owner), [owner]);

  const graphs = useRef(new Map<string, Promise<ReferenceGraphData>>());
  const walkToken = useRef(0);
  const lastTap = useRef<Tap | null>(null);

  const loadGraph = (address: ReferenceAddress): Promise<ReferenceGraphData> => {
    const cacheKey = referenceAddressKey(address);
    const cached = graphs.current.get(cacheKey);
    if (cached) return cached;
    const request = fetch(referenceGraphApiHref(address)).then(async (response) => {
      if (!response.ok) throw new Error(`Reference graph request failed (${response.status})`);
      return (await response.json()) as ReferenceGraphData;
    });
    graphs.current.set(cacheKey, request);
    request.catch(() => graphs.current.delete(cacheKey));
    return request;
  };

  /** The page of anyone drawn here but the person in the middle. */
  const pageOf = (key: string): ReferenceAddress | null => {
    if (key === centreKey) return null;
    const entry = directory.get(key);
    return entry ? entryAddress(entry) : null;
  };

  const changeFocus = (next: string | null) => {
    if (next === focusKey) return;
    setFocusKey(next);
    setFocusChange(
      reducedMotion ? null : { from: focusKey, fromOpen: focusKey ? opening : 0, start: performance.now() },
    );
  };

  const go = (next: ReferenceGraphData[]) => {
    walkToken.current += 1;
    setPendingKey(null);
    const current = latest.current;
    if (!current.reducedMotion) {
      setTransition({
        from: current.items,
        start: performance.now(),
        duration: WALK_MS,
        previousCentre: current.centreKey,
        previousPlanets: current.scene.planets,
        previousFocus: current.focusKey,
        previousArcs: current.scene.arcs,
        previousTethers: current.scene.tethers,
        previousRings: current.scene.rings,
        previousDirectory: current.directory,
      });
    }
    setTrail(next);
    setSelectedKey(null);
    setShownKey(null);
    setFocusKey(null);
    setFocusChange(null);
    setPlatformFilter(null);
    // A new person is met by what others say about them.
    setDirectionState('received');
  };

  const select = (key: string | null) => {
    if (key === selectedKey) return;
    setSelectedKey(key);
    if (key === null) {
      changeFocus(null);
      return;
    }
    setShownKey(key);

    // A planet opens and swings round to the back-left diagonal (`yawToSelectedRest`);
    // one of its stars keeps it open where it is.
    if (scene.items.get(key)?.kind === 'planet') {
      changeFocus(key);
      const angle = scene.angles.get(key);
      if (angle !== undefined) motion.turnTo(yawToSelectedRest(angle));
    }

    const page = pageOf(key);
    if (page) loadGraph(page).catch(() => {});
  };

  /** Opens someone's page, walking the graph toward them while it loads. */
  const centreOn = (key: string) => {
    const page = pageOf(key);
    if (!page) return;
    walkToken.current += 1;
    const token = walkToken.current;
    setPendingKey(key);
    openPage(page);
    loadGraph(page)
      .then((next) => {
        if (token === walkToken.current) go([...latest.current.trail, next]);
      })
      .catch(() => {
        if (token === walkToken.current) setPendingKey(null);
      });
  };

  /**
   * A tap on a body, or on empty space when `key` is null. The selected planet
   * starts turning at once, so a second tap counts as a double-click whether it
   * lands on the same body or on the same spot the first one did.
   */
  const tap = (key: string | null, point: Point) => {
    const at = performance.now();
    const previous = lastTap.current;
    if (
      previous?.key &&
      at - previous.at < DOUBLE_TAP_MS &&
      (key === previous.key || Math.hypot(point.x - previous.x, point.y - previous.y) <= DOUBLE_TAP_SLOP_PX)
    ) {
      lastTap.current = null;
      centreOn(previous.key);
      return;
    }
    lastTap.current = { key, at, x: point.x, y: point.y };
    select(key);
  };

  const filterByPlatform = (slug: string | null) => {
    setPlatformFilter((prev) => (prev === slug ? null : slug));
    setSelectedKey(null);
    changeFocus(null);
  };

  /** Switches between references left for the person and references they left. */
  const setDirection = (next: ReferenceDirection) => {
    if (next === direction) return;
    setDirectionState(next);
    // A platform picked on one side may not exist on the other.
    setPlatformFilter(null);
    setSelectedKey(null);
    changeFocus(null);
  };

  const stableSelect = useStableCallback(select);
  const stableTap = useStableCallback(tap);
  const stableCentreOn = useStableCallback(centreOn);
  const stableFilterByPlatform = useStableCallback(filterByPlatform);
  const stableSetDirection = useStableCallback(setDirection);
  const stableToggleSpin = useStableCallback(motion.toggleSpin);
  const stableResetView = useStableCallback(motion.reset);

  return {
    graph,
    /** The direction being drawn, and its nodes, links, platforms and counts. */
    view,
    direction,
    setDirection: stableSetDirection,
    visibleNodes,
    platformFilter,
    filterByPlatform: stableFilterByPlatform,
    frame,
    scene,
    items,
    transition,
    progress,
    centreKey,
    /** True while the graph walks toward someone else's page, before it arrives. */
    away: centreKey !== centreKeyOf(root),
    selectedKey,
    pendingKey,
    directory,
    /** Who the details panel shows, and how far it has slid in, from 0 to 1. */
    panel: { key: panelOpen > 0 ? shownKey : null, open: panelOpen },
    autoSpin: motion.autoSpin,
    tilted: motion.tilted,
    attach: motion.attach,
    dragHandlers: motion.handlers,
    select: stableSelect,
    tap: stableTap,
    centreOn: stableCentreOn,
    toggleSpin: stableToggleSpin,
    resetView: stableResetView,
  };
}

export type TrustOrbits = ReturnType<typeof useTrustOrbits>;
