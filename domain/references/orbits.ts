// domain/references/orbits.ts
//
// The Trust Network as a small solar system. The person in the centre is the sun.
// Everyone who has vouched for them is a planet on an orbit seen in perspective,
// and a planet is bigger the more people vouch for it in turn. Selecting a planet
// opens its connections: arcs to the planets it has dealt with, and its own
// vouchers as stars fanned out on its far side from the sun. Two scenes blend so
// re-centring on someone animates.
//
// Pure: no Supabase, React or service imports.

export type OrbitSentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';

/** Planets drawn around one person. Everyone past a cap is counted, not drawn. */
export const PLANET_CAP = 30;
export const ISSUE_CAP = 6;
/** Stars fanned out from a selected planet: its strongest own vouchers. */
export const STAR_LIMIT = 5;

export interface OrbitFrame {
  width: number;
  height: number;
  compact: boolean;
}

export const WIDE_FRAME: OrbitFrame = { width: 760, height: 480, compact: false };
export const COMPACT_FRAME: OrbitFrame = { width: 340, height: 400, compact: true };

/** How the system is turned: `yaw` spins it, `tilt` is how far, in radians, the viewer looks down on it. */
export interface OrbitView {
  yaw: number;
  tilt: number;
}

export const DEFAULT_VIEW: OrbitView = { yaw: 0.35, tilt: 0.42 };
export const MIN_TILT = 0.2;
export const MAX_TILT = 0.85;

/** How far down the frame the sun sits. Everything drawn below it is the near half of the system. */
export const SUN_Y = 0.45;

const TAU = Math.PI * 2;
/** The viewer's distance from the sun, in outer-orbit radii. Closer exaggerates perspective. */
const CAMERA_DISTANCE = 4;
/** Perspective swells the near side of an orbit a little past its radius; this is the furthest it reaches. */
const WIDEST_REACH = 1.035;
const FRAME_MARGIN = 10;
const SIDE_MARGIN = 4;
/** Phones stretch the system vertically so it uses the screen's height. */
const COMPACT_STRETCH = 1.25;
/**
 * Space kept above the back of the system for a selected planet's fan (a selected
 * planet turns to the back-left, clear of the details card along the bottom), below
 * the front, and beside the widest point.
 */
const ROOM = {
  wide: { above: 90, below: 40, side: 26 },
  compact: { above: 64, below: 30, side: 17 },
} as const;
const RING_SEGMENTS = 48;
/** Radians between neighbouring stars in a fan. */
const FAN_STEP = 0.6;
/** Radians turned or tilted per frame width dragged: about the rate that keeps the grabbed planet under the pointer. */
const DRAG_YAW_PER_WIDTH = 2.2;
const DRAG_TILT_PER_WIDTH = 3;
/** Labels keep this far inside the frame's sides and apart from each other. */
const LABEL_MARGIN = 4;
const LABEL_GAP = 4;

/** Orbit radii as a fraction of frame width, by how many orbits are needed. */
const ORBIT_FRACTIONS = {
  wide: [[0.31], [0.22, 0.38], [0.2, 0.31, 0.42]],
  compact: [[0.32], [0.22, 0.38], [0.18, 0.3, 0.41]],
} as const;

export interface OrbitStarInput {
  key: string;
}

export interface OrbitPersonInput {
  key: string;
  /** How many people vouch for them; sizes the planet. */
  refs: number;
  issue: boolean;
  sentiment?: OrbitSentiment;
  /** Their own vouchers, strongest first. */
  stars: readonly OrbitStarInput[];
}

/** A planet whose connections are showing, and how far open they are, from 0 (closed) to 1. */
export interface OrbitFocus {
  key: string;
  open: number;
}

/** The area labels are fitted into. */
export interface OrbitBounds {
  width: number;
  height: number;
}

export interface OrbitSceneInput {
  centreKey: string;
  people: readonly OrbitPersonInput[];
  /** Pairs of people in the system who have dealt with each other. */
  links: readonly (readonly [string, string])[];
  /** The planet whose connections are open or opening. */
  focus: OrbitFocus | null;
  /** A planet whose connections are closing while another's open. */
  closing: OrbitFocus | null;
  frame: OrbitFrame;
  view: OrbitView;
}

export type OrbitItemKind = 'sun' | 'planet' | 'star';

export interface OrbitItem {
  key: string;
  kind: OrbitItemKind;
  issue: boolean;
  sentiment?: OrbitSentiment;
  x: number;
  y: number;
  /** Drawn radius, already scaled for perspective. */
  r: number;
  /** Front to back: 1 at the front of the outer orbit, -1 at its back, 0 level with the sun. */
  depth: number;
  opacity: number;
  parentKey: string | null;
}

export interface OrbitRing {
  radius: number;
  /** SVG paths for the half of the orbit behind the sun and the half in front of it. */
  back: string;
  front: string;
}

/** How the orbit plane is projected into the frame. */
export interface OrbitCamera {
  cx: number;
  cy: number;
  tilt: number;
  /** Below 1 when the system is tilted too far over to fit the frame at full size. */
  zoom: number;
  /** Outer orbit radius at full size; depth is measured against it. */
  outer: number;
  stretch: number;
}

/** An arc between two planets who have dealt with each other, as open as the planet showing it. */
export interface OrbitArc {
  a: string;
  b: string;
  open: number;
}

export interface OrbitScene {
  frame: OrbitFrame;
  camera: OrbitCamera;
  cx: number;
  cy: number;
  rings: OrbitRing[];
  items: Map<string, OrbitItem>;
  /** Planet keys, biggest first. */
  planets: string[];
  arcs: OrbitArc[];
  /** [planet, star] pairs: the line from each open planet out to each of its stars. */
  tethers: [string, string][];
  /** Each planet's resting angle on its orbit, to turn it to the front. */
  angles: Map<string, number>;
  focus: OrbitFocus | null;
  closing: OrbitFocus | null;
}

export interface Point {
  x: number;
  y: number;
}

export function orbitKey(profileId: string, sentiment: OrbitSentiment): string {
  if (sentiment === 'NEGATIVE') return `${profileId}:issue`;
  if (sentiment === 'NEUTRAL') return `${profileId}:neutral`;
  return profileId;
}

export function planetRadius(refs: number, compact: boolean): number {
  const growth = Math.sqrt(Math.max(0, refs));
  return compact ? 6 + Math.min(10, growth * 1.6) : 8 + Math.min(16, growth * 2.4);
}

export function sunRadius(compact: boolean): number {
  return compact ? 22 : 30;
}

export function starRadius(compact: boolean): number {
  return compact ? 5 : 6;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function clampTilt(tilt: number): number {
  return clamp(tilt, MIN_TILT, MAX_TILT);
}

/** How much larger a body draws at `depth` than level with the sun. */
export function perspectiveScale(depth: number, tilt: number): number {
  return CAMERA_DISTANCE / (CAMERA_DISTANCE - depth * Math.cos(tilt));
}

/** Where a point on the orbit plane lands in the frame. `toward` runs from the sun toward the viewer. */
export function projectPoint(
  camera: OrbitCamera,
  across: number,
  toward: number,
): { x: number; y: number; scale: number; depth: number } {
  const depth = toward / camera.outer;
  const scale = perspectiveScale(depth, camera.tilt) * camera.zoom;
  return {
    x: camera.cx + across * scale,
    y: camera.cy + toward * Math.sin(camera.tilt) * camera.stretch * scale,
    scale,
    depth,
  };
}

/** The yaw that brings a planet resting at `angle` to the front of the system. */
export function yawToFront(angle: number): number {
  return Math.PI / 2 - angle;
}

/** The yaw that brings a planet resting at `angle` to the back of the system, the top of the frame. */
export function yawToBack(angle: number): number {
  return -Math.PI / 2 - angle;
}

/**
 * Where a SELECTED planet comes to rest: the back-left diagonal, 45 degrees round from
 * straight behind the sun. Straight behind put the planet directly above the sun, so
 * its label and its fan of stars stacked on the sun's own; on the diagonal they open
 * out to the upper left, clear of the sun and of the details card along the bottom.
 */
export const SELECTED_REST_ANGLE = (-3 * Math.PI) / 4;

/** The yaw that brings a planet resting at `angle` to {@link SELECTED_REST_ANGLE}. */
export function yawToSelectedRest(angle: number): number {
  return SELECTED_REST_ANGLE - angle;
}

/** The same angle, between -π and π. */
export function wrapAngle(angle: number): number {
  return ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/**
 * Turns the system under a drag so that whichever half was grabbed follows the
 * pointer: drag the front to the right and the front moves right; drag the back
 * down and the back comes down. `dx` and `dy` are fractions of the frame's width.
 */
export function dragView(from: OrbitView, dx: number, dy: number, grabbedFront: boolean): OrbitView {
  const side = grabbedFront ? 1 : -1;
  return {
    yaw: from.yaw - side * dx * DRAG_YAW_PER_WIDTH,
    tilt: clampTilt(from.tilt + side * dy * DRAG_TILT_PER_WIDTH),
  };
}

function orbitCount(planets: number): 1 | 2 | 3 {
  if (planets <= 6) return 1;
  return planets <= 16 ? 2 : 3;
}

function bySize(a: OrbitPersonInput, b: OrbitPersonInput): number {
  return b.refs - a.refs || a.key.localeCompare(b.key);
}

const fixed = (n: number) => n.toFixed(1);
const round = (value: number, factor: number) => Math.round(value * factor) / factor;

/** Rounded, so a server render and the browser's first render agree to the digit. */
function settled(item: OrbitItem): OrbitItem {
  return {
    ...item,
    x: round(item.x, 100),
    y: round(item.y, 100),
    r: round(item.r, 100),
    depth: round(item.depth, 10_000),
    opacity: round(item.opacity, 1000),
  };
}

/**
 * How high the sun sits and how far the camera pulls back. The sun keeps its usual
 * height while the system fits around it, slides when one end would run out of the
 * frame, and the system only shrinks once there is no room left to slide, as when
 * it is tilted far over.
 */
function fitCamera(frame: OrbitFrame, outer: number, tilt: number, stretch: number): { cy: number; zoom: number } {
  const room = ROOM[frame.compact ? 'compact' : 'wide'];
  const rise = outer * Math.sin(tilt) * stretch;
  const above = rise * perspectiveScale(-1, tilt) + room.above;
  const below = rise * perspectiveScale(1, tilt) + room.below;
  const across = outer * WIDEST_REACH + room.side;
  const zoom = Math.min(1, (frame.width / 2 - SIDE_MARGIN) / across);
  const highest = FRAME_MARGIN + zoom * above;
  const lowest = frame.height - FRAME_MARGIN - zoom * below;
  if (highest <= lowest) return { cy: clamp(frame.height * SUN_Y, highest, lowest), zoom };
  const fitted = (frame.height - 2 * FRAME_MARGIN) / (above + below);
  return { cy: FRAME_MARGIN + fitted * above, zoom: fitted };
}

/** Half an orbit as a path: from `start` through π more radians. */
function ringPath(camera: OrbitCamera, radius: number, start: number): string {
  const points: string[] = [];
  for (let i = 0; i <= RING_SEGMENTS; i += 1) {
    const t = start + (Math.PI * i) / RING_SEGMENTS;
    const point = projectPoint(camera, Math.cos(t) * radius, Math.sin(t) * radius);
    points.push(`${fixed(point.x)} ${fixed(point.y)}`);
  }
  return `M ${points.join(' L ')}`;
}

export function buildOrbitScene(input: OrbitSceneInput): OrbitScene {
  const { frame, centreKey, view } = input;
  const tilt = clampTilt(view.tilt);
  const stretch = frame.compact ? COMPACT_STRETCH : 1;
  const cx = frame.width / 2;

  const people = input.people.filter((p) => p.key !== centreKey).sort(bySize);
  const personByKey = new Map(people.map((p) => [p.key, p]));
  const fractions = ORBIT_FRACTIONS[frame.compact ? 'compact' : 'wide'][orbitCount(people.length) - 1];
  const radii = fractions.map((fraction) => fraction * frame.width);
  const outer = radii[radii.length - 1];
  const { cy, zoom } = fitCamera(frame, outer, tilt, stretch);
  const camera: OrbitCamera = { cx, cy, tilt, zoom, outer, stretch };
  // The front half starts at angle 0 and passes nearest the viewer; the back half starts at π.
  const rings = radii.map((radius) => ({
    radius,
    back: ringPath(camera, radius, Math.PI),
    front: ringPath(camera, radius, 0),
  }));

  // Biggest first, each into the orbit with the most room left, so large planets
  // spread across orbits instead of crowding one.
  const orbits: OrbitPersonInput[][] = radii.map(() => []);
  for (const person of people) {
    let best = 0;
    let bestLoad = Number.POSITIVE_INFINITY;
    radii.forEach((radius, k) => {
      const load = (orbits[k].length + 1) / radius;
      if (load < bestLoad) {
        bestLoad = load;
        best = k;
      }
    });
    orbits[best].push(person);
  }

  const items = new Map<string, OrbitItem>();
  const angles = new Map<string, number>();
  const scales = new Map<string, number>();
  items.set(centreKey, {
    key: centreKey,
    kind: 'sun',
    issue: false,
    x: cx,
    y: cy,
    r: sunRadius(frame.compact) * camera.zoom,
    depth: 0,
    opacity: 1,
    parentKey: null,
  });

  orbits.forEach((members, k) => {
    members.forEach((person, i) => {
      const angle = k * 0.9 + (TAU / members.length) * i;
      const turned = angle + view.yaw;
      const at = projectPoint(camera, Math.cos(turned) * radii[k], Math.sin(turned) * radii[k]);
      angles.set(person.key, angle);
      scales.set(person.key, at.scale);
      items.set(person.key, {
        key: person.key,
        kind: 'planet',
        issue: person.issue,
        sentiment: person.sentiment ?? (person.issue ? 'NEGATIVE' : 'POSITIVE'),
        x: at.x,
        y: at.y,
        r: planetRadius(person.refs, frame.compact) * at.scale,
        depth: at.depth,
        opacity: at.depth < 0 ? 0.45 + 0.55 * ((at.depth + 1) / 2) : 1,
        parentKey: null,
      });
    });
  });

  const planets = people.map((p) => p.key);
  const inSystem = new Set(planets);
  // The more open of two planets claims anything they share, so a switch hands it over half-way.
  const opened = [input.focus, input.closing]
    .filter((focus): focus is OrbitFocus => focus !== null && inSystem.has(focus.key))
    .sort((a, b) => b.open - a.open);

  // An open planet sits at full strength, however far back it is, so it never reads as faded out.
  for (const focus of opened) {
    const planet = items.get(focus.key);
    if (planet) items.set(focus.key, { ...planet, opacity: planet.opacity + (1 - planet.opacity) * focus.open });
  }

  const arcsById = new Map<string, OrbitArc>();
  for (const focus of opened) {
    for (const [a, b] of input.links) {
      if (a === b || (a !== focus.key && b !== focus.key) || !inSystem.has(a) || !inSystem.has(b)) continue;
      const [first, second] = a < b ? [a, b] : [b, a];
      const id = `${first}|${second}`;
      const existing = arcsById.get(id);
      if (existing) existing.open = Math.max(existing.open, focus.open);
      else arcsById.set(id, { a: first, b: second, open: focus.open });
    }
  }

  const tethers: [string, string][] = [];
  const inView = new Set<string>([centreKey, ...planets]);
  const taken = new Set<string>();
  for (const focus of opened) {
    const planet = items.get(focus.key);
    const person = personByKey.get(focus.key);
    if (!planet || !person || person.issue) continue;
    const picks = person.stars
      .filter((star) => !inView.has(star.key) && !taken.has(star.key))
      .slice(0, frame.compact ? 4 : STAR_LIMIT);
    if (picks.length === 0) continue;

    // Fanned out on the planet's far side from the sun, growing out of it as it opens.
    const scale = scales.get(focus.key) ?? 1;
    const away = Math.hypot(planet.x - cx, planet.y - cy);
    const ux = away > 0 ? (planet.x - cx) / away : 0;
    const uy = away > 0 ? (planet.y - cy) / away : 1;
    const radius = starRadius(frame.compact) * scale;
    const reach = (planet.r + (frame.compact ? 26 : 36) * scale + radius) * focus.open;
    picks.forEach((star, j) => {
      taken.add(star.key);
      tethers.push([focus.key, star.key]);
      const phi = (j - (picks.length - 1) / 2) * FAN_STEP;
      const vx = ux * Math.cos(phi) - uy * Math.sin(phi);
      const vy = ux * Math.sin(phi) + uy * Math.cos(phi);
      items.set(star.key, {
        key: star.key,
        kind: 'star',
        issue: false,
        x: clamp(planet.x + vx * reach, FRAME_MARGIN, frame.width - FRAME_MARGIN),
        y: clamp(planet.y + vy * reach, FRAME_MARGIN, frame.height - FRAME_MARGIN),
        r: radius * (0.4 + 0.6 * focus.open),
        depth: planet.depth + 0.001,
        opacity: planet.opacity * focus.open,
        parentKey: focus.key,
      });
    });
  }

  const settledItems = new Map<string, OrbitItem>();
  for (const [key, item] of items) settledItems.set(key, settled(item));

  return {
    frame,
    camera,
    cx,
    cy,
    rings,
    items: settledItems,
    planets,
    arcs: [...arcsById.values()],
    tethers,
    angles,
    focus: input.focus,
    closing: input.closing,
  };
}

function lerpItem(from: OrbitItem, to: OrbitItem, t: number): OrbitItem {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    ...to,
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    r: mix(from.r, to.r),
    depth: mix(from.depth, to.depth),
    opacity: mix(from.opacity, to.opacity),
  };
}

/**
 * Items part-way from one scene to the next. Bodies in both glide; newcomers grow
 * out of their planet, or out of wherever the new sun used to be; bodies leaving
 * fade, folding back into their planet when it stays.
 */
export function blendOrbitItems(
  from: ReadonlyMap<string, OrbitItem> | null,
  to: ReadonlyMap<string, OrbitItem>,
  progress: number,
  centreKey: string,
): ReadonlyMap<string, OrbitItem> {
  if (!from || progress >= 1) return to;
  const t = Math.max(0, progress);
  const origin = from.get(centreKey);
  const out = new Map<string, OrbitItem>();

  for (const [key, target] of to) {
    const previous = from.get(key);
    if (previous) {
      out.set(key, lerpItem(previous, target, t));
      continue;
    }
    const anchor = (target.parentKey ? from.get(target.parentKey) : undefined) ?? origin;
    const start: OrbitItem = {
      ...target,
      x: anchor ? anchor.x : target.x,
      y: anchor ? anchor.y : target.y,
      r: target.r * 0.4,
      opacity: 0,
    };
    out.set(key, lerpItem(start, target, t));
  }

  for (const [key, previous] of from) {
    if (to.has(key)) continue;
    const home = previous.parentKey ? to.get(previous.parentKey) : undefined;
    const end: OrbitItem = home
      ? { ...previous, x: home.x, y: home.y, r: previous.r * 0.4, opacity: 0 }
      : { ...previous, r: previous.r * 0.4, opacity: 0 };
    out.set(key, lerpItem(previous, end, t));
  }

  return out;
}

/** Slow out, fast through the middle, slow in: for moves between two resting states. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Fast out, slow in: for things opening from where they already are. */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** The curved spoke from the sun out to a planet. */
export function spokePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return `M ${fixed(x1)} ${fixed(y1)} C ${fixed(x1 + dx * 0.42)} ${fixed(y1 + dy * 0.12)}, ${fixed(x1 + dx * 0.68)} ${fixed(y1 + dy * 0.88)}, ${fixed(x2)} ${fixed(y2)}`;
}

/** An arc between two planets, bowed away from the sun so it skirts the middle. */
export function arcPath(a: Point, b: Point, centre: Point): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  let nx = mx - centre.x;
  let ny = my - centre.y;
  let length = Math.hypot(nx, ny);
  if (length < 24) {
    nx = a.y - b.y;
    ny = b.x - a.x;
    length = Math.hypot(nx, ny) || 1;
  }
  const bow = Math.hypot(b.x - a.x, b.y - a.y) * 0.22;
  return `M ${fixed(a.x)} ${fixed(a.y)} Q ${fixed(mx + (nx / length) * bow)} ${fixed(my + (ny / length) * bow)} ${fixed(b.x)} ${fixed(b.y)}`;
}

/** A four-pointed star centred on (x, y), `r` from the centre to each point. */
export function starPath(x: number, y: number, r: number): string {
  const waist = r * 0.3;
  return [
    `M ${fixed(x)} ${fixed(y - r)}`,
    `L ${fixed(x + waist)} ${fixed(y - waist)}`,
    `L ${fixed(x + r)} ${fixed(y)}`,
    `L ${fixed(x + waist)} ${fixed(y + waist)}`,
    `L ${fixed(x)} ${fixed(y + r)}`,
    `L ${fixed(x - waist)} ${fixed(y + waist)}`,
    `L ${fixed(x - r)} ${fixed(y)}`,
    `L ${fixed(x - waist)} ${fixed(y - waist)}`,
    'Z',
  ].join(' ');
}

export type LabelAnchor = 'start' | 'middle' | 'end';

export interface LabelSpot {
  x: number;
  /** The text's vertical centre. */
  y: number;
  anchor: LabelAnchor;
}

export interface LabelRequest {
  key: string;
  width: number;
  height: number;
  /** Where the label may go, best first. */
  spots: readonly LabelSpot[];
  /** Shown even where it has to be nudged or overlap, as the selected person's is. */
  required?: boolean;
}

export interface PlacedLabel extends LabelSpot {
  key: string;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function boxAt(spot: LabelSpot, width: number, height: number): Box {
  const left = spot.anchor === 'start' ? spot.x : spot.anchor === 'end' ? spot.x - width : spot.x - width / 2;
  return { left, right: left + width, top: spot.y - height / 2, bottom: spot.y + height / 2 };
}

function overlaps(a: Box, b: Box, gap: number): boolean {
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Places labels in the order given, each at the first of its spots that sits
 * inside the bounds, off every other body, and clear of the labels already placed.
 * A label with nowhere to go is left out rather than cut short or drawn over another.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  bounds: OrbitBounds,
  bodies: readonly { key: string; x: number; y: number; r: number }[] = [],
): PlacedLabel[] {
  const blocked = bodies.map((body) => ({
    key: body.key,
    box: { left: body.x - body.r, right: body.x + body.r, top: body.y - body.r, bottom: body.y + body.r },
  }));
  const labels: Box[] = [];
  const placed: PlacedLabel[] = [];
  const inside = (box: Box) =>
    box.left >= LABEL_MARGIN && box.right <= bounds.width - LABEL_MARGIN && box.top >= 0 && box.bottom <= bounds.height;

  for (const request of requests) {
    let chosen: { spot: LabelSpot; box: Box } | null = null;
    for (const spot of request.spots) {
      let at = spot;
      let box = boxAt(spot, request.width, request.height);
      // A centred label can slide sideways to stay in bounds and still sit under or over its body.
      if (spot.anchor === 'middle') {
        const dx = Math.max(LABEL_MARGIN - box.left, 0) + Math.min(bounds.width - LABEL_MARGIN - box.right, 0);
        at = { ...spot, x: spot.x + dx };
        box = { ...box, left: box.left + dx, right: box.right + dx };
      }
      const clear =
        inside(box) &&
        !blocked.some((body) => body.key !== request.key && overlaps(box, body.box, 0)) &&
        !labels.some((other) => overlaps(box, other, LABEL_GAP));
      if (clear) {
        chosen = { spot: at, box };
        break;
      }
    }
    if (!chosen && request.required && request.spots.length > 0) {
      const spot = request.spots[0];
      const box = boxAt(spot, request.width, request.height);
      const dx = Math.max(LABEL_MARGIN - box.left, 0) + Math.min(bounds.width - LABEL_MARGIN - box.right, 0);
      const dy = Math.max(-box.top, 0) + Math.min(bounds.height - box.bottom, 0);
      chosen = {
        spot: { ...spot, x: spot.x + dx, y: spot.y + dy },
        box: { left: box.left + dx, right: box.right + dx, top: box.top + dy, bottom: box.bottom + dy },
      };
    }
    if (!chosen) continue;
    labels.push(chosen.box);
    placed.push({ key: request.key, anchor: chosen.spot.anchor, x: round(chosen.spot.x, 100), y: round(chosen.spot.y, 100) });
  }
  return placed;
}

export interface DrawCandidate {
  key: string;
  issue: boolean;
  /** Their own standing: how many people vouch for them. */
  standing: number;
  deals: number;
}

/** The biggest planets up to the cap, the issues up to theirs, and how many were left out. */
export function pickDrawn<T extends DrawCandidate>(
  candidates: readonly T[],
): { drawn: T[]; hidden: { people: number; issues: number } } {
  const rank = (a: T, b: T) => b.standing - a.standing || b.deals - a.deals || a.key.localeCompare(b.key);
  const positives = candidates.filter((c) => !c.issue).sort(rank);
  const issues = candidates.filter((c) => c.issue).sort(rank);
  return {
    drawn: [...positives.slice(0, PLANET_CAP), ...issues.slice(0, ISSUE_CAP)],
    hidden: {
      people: Math.max(0, positives.length - PLANET_CAP),
      issues: Math.max(0, issues.length - ISSUE_CAP),
    },
  };
}

/**
 * Splits each drawn person's vouchers into arcs (the voucher is a planet too) and
 * stars (they are not). The sun never appears as anyone's star.
 */
export function splitConnections(
  drawnKeys: readonly string[],
  vouchersOf: ReadonlyMap<string, readonly string[]>,
  centreKey: string | null,
  limit = STAR_LIMIT,
): { links: [string, string][]; stars: Map<string, string[]> } {
  const drawn = new Set(drawnKeys);
  const seenPairs = new Set<string>();
  const links: [string, string][] = [];
  const stars = new Map<string, string[]>();

  for (const key of drawnKeys) {
    const own: string[] = [];
    for (const voucher of vouchersOf.get(key) ?? []) {
      if (voucher === key || voucher === centreKey) continue;
      if (drawn.has(voucher)) {
        const pair: [string, string] = key < voucher ? [key, voucher] : [voucher, key];
        const id = `${pair[0]}|${pair[1]}`;
        if (!seenPairs.has(id)) {
          seenPairs.add(id);
          links.push(pair);
        }
      } else if (own.length < limit && !own.includes(voucher)) {
        own.push(voucher);
      }
    }
    stars.set(key, own);
  }

  return { links, stars };
}

/**
 * The vertical band the system can occupy, in frame units, whatever way it is turned:
 * from the room kept above the back of the outer orbit (where a selected planet's fan
 * of stars opens) down to the room kept under its front (the labels).
 *
 * Depends only on the camera, never on yaw, so a layout keyed on it holds still while
 * the system spins. The details card uses it on phones to lift the drawing clear of
 * itself: fitting the whole FRAME instead shrank the system by the frame's empty
 * margins too, and left it tiny.
 */
export function systemExtent(scene: Pick<OrbitScene, 'frame' | 'camera'>): { top: number; bottom: number } {
  const { frame, camera } = scene;
  const room = ROOM[frame.compact ? 'compact' : 'wide'];
  const rise = camera.outer * Math.sin(camera.tilt) * camera.stretch;
  const above = rise * perspectiveScale(-1, camera.tilt) + room.above;
  const below = rise * perspectiveScale(1, camera.tilt) + room.below;
  return {
    top: Math.max(0, camera.cy - camera.zoom * above),
    bottom: Math.min(frame.height, camera.cy + camera.zoom * below),
  };
}
