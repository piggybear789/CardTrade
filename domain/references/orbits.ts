// domain/references/orbits.ts
//
// Proof orbits: the layout behind the Trust Network graph. How a deal was
// proven decides the ring (NoDitto escrow innermost, then receipt checked, then
// vouched) and issues sit outside every ring. Arcs join first-degree people who
// have dealt with each other, satellites hang each person's own vouchers off
// them, and two scenes blend so re-centring on someone animates.
//
// Pure: no Supabase, React or service imports.

export type ProofTier = 'escrow' | 'receipt' | 'vouch';
export type OrbitTier = ProofTier | 'issue';
export type OrbitSentiment = 'POSITIVE' | 'NEGATIVE';

export const PROOF_TIERS: readonly ProofTier[] = ['escrow', 'receipt', 'vouch'];

export const TIER_LABEL: Record<OrbitTier, string> = {
  escrow: 'NoDitto',
  receipt: 'Receipt checked',
  vouch: 'Vouched',
  issue: 'Issue',
};

/** People drawn per tier. Everyone past a cap is counted, not drawn. */
export const TIER_CAPS: Record<OrbitTier, number> = { escrow: 8, receipt: 12, vouch: 16, issue: 6 };

/** Vouchers carried per person; the scene shows fewer until that person is selected. */
export const SATELLITE_LIMIT = 5;

export interface OrbitFrame {
  width: number;
  height: number;
  compact: boolean;
}

export const WIDE_FRAME: OrbitFrame = { width: 760, height: 500, compact: false };
export const COMPACT_FRAME: OrbitFrame = { width: 340, height: 420, compact: true };

export const PILL_HEIGHT = 24;
const PILL_LABEL_MAX = 16;
/** Arc length one pill needs on its ring before the ring falls back to dots. */
const PILL_SLOT = 118;
/** Above this many people on the rings, unselected people carry one satellite. */
const BUSY_ORBIT_COUNT = 22;

const RING_FRACTIONS = {
  wide: [
    [0.18, 0.18],
    [0.29, 0.29],
    [0.4, 0.39],
  ],
  compact: [
    [0.17, 0.16],
    [0.27, 0.26],
    [0.37, 0.36],
  ],
} as const;

const RING_START_DEG: Record<ProofTier, number> = { escrow: -90, receipt: -60, vouch: -75 };
const ISSUE_START_DEG = 60;
const ISSUE_STEP_DEG = 20;
const ISSUE_RADIUS_FACTOR = 1.12;
const FRAME_MARGIN = 10;

export interface OrbitSatelliteInput {
  key: string;
  tier: ProofTier;
}

export interface OrbitPersonInput {
  key: string;
  tier: OrbitTier;
  /** Position within the ring, lowest first. */
  order: number;
  refs: number;
  /** Handle shown on the pill; also sizes it. */
  label: string;
  /** Their own vouchers, strongest first. */
  satellites: readonly OrbitSatelliteInput[];
}

export interface OrbitSceneInput {
  centreKey: string;
  people: readonly OrbitPersonInput[];
  /** First-degree pairs who have dealt with each other. */
  links: readonly (readonly [string, string])[];
  selectedKey: string | null;
  showConnections: boolean;
  frame: OrbitFrame;
}

export type OrbitItemKind = 'centre' | 'orbit' | 'issue' | 'satellite';

export interface OrbitItem {
  key: string;
  kind: OrbitItemKind;
  /** Null for the centre. */
  tier: OrbitTier | null;
  x: number;
  y: number;
  /** 0 satellite, 1 orbit, 2 centre; fractional while two scenes blend. */
  size: number;
  opacity: number;
  pill: boolean;
  parentKey: string | null;
}

export interface OrbitRing {
  tier: ProofTier;
  rx: number;
  ry: number;
}

export interface OrbitScene {
  frame: OrbitFrame;
  cx: number;
  cy: number;
  rings: OrbitRing[];
  items: Map<string, OrbitItem>;
  /** First-degree keys, rings first and issues last. */
  spokes: string[];
  crossLinks: [string, string][];
  /** [parent, satellite] pairs. */
  satelliteLinks: [string, string][];
}

export interface Point {
  x: number;
  y: number;
}

export function orbitKey(profileId: string, sentiment: OrbitSentiment): string {
  return sentiment === 'NEGATIVE' ? `${profileId}:issue` : profileId;
}

export function truncateLabel(label: string, max = PILL_LABEL_MAX): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function pillWidth(label: string): number {
  return 38 + truncateLabel(label).length * 6.2;
}

export function dotRadius(tier: OrbitTier, refs: number, compact: boolean): number {
  if (compact) return tier === 'vouch' ? 8.5 : 10.5;
  return 8.5 + Math.min(3.5, Math.sqrt(Math.max(0, refs)) * 0.8);
}

export function satelliteRadius(fanned: boolean, compact: boolean): number {
  if (fanned) return compact ? 4.5 : 5.5;
  return compact ? 2.8 : 3.4;
}

export function centreRadius(compact: boolean): number {
  return compact ? 22 : 28;
}

/** Ramanujan's approximation; exact enough to decide whether pills fit. */
function ellipsePerimeter(rx: number, ry: number): number {
  return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
}

const toRadians = (deg: number) => (deg * Math.PI) / 180;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function byRingOrder(a: OrbitPersonInput, b: OrbitPersonInput): number {
  return a.order - b.order || b.refs - a.refs || a.key.localeCompare(b.key);
}

export function buildOrbitScene(input: OrbitSceneInput): OrbitScene {
  const { frame, centreKey, selectedKey, showConnections } = input;
  const cx = frame.width / 2;
  const cy = frame.height / 2;
  const fractions = frame.compact ? RING_FRACTIONS.compact : RING_FRACTIONS.wide;
  const rings: OrbitRing[] = PROOF_TIERS.map((tier, k) => ({
    tier,
    rx: frame.width * fractions[k][0],
    ry: frame.height * fractions[k][1],
  }));

  const items = new Map<string, OrbitItem>();
  items.set(centreKey, {
    key: centreKey,
    kind: 'centre',
    tier: null,
    x: cx,
    y: cy,
    size: 2,
    opacity: 1,
    pill: false,
    parentKey: null,
  });

  const people = input.people.filter((p) => p.key !== centreKey);
  const personByKey = new Map(people.map((p) => [p.key, p]));
  const spokes: string[] = [];
  const orbitKeys: string[] = [];

  PROOF_TIERS.forEach((tier, k) => {
    const ring = rings[k];
    const members = people.filter((p) => p.tier === tier).sort(byRingOrder);
    if (members.length === 0) return;
    const ringPills =
      !frame.compact && tier !== 'vouch' && ellipsePerimeter(ring.rx, ring.ry) / members.length >= PILL_SLOT;
    members.forEach((person, i) => {
      const angle = toRadians(RING_START_DEG[tier] + (360 / members.length) * i);
      items.set(person.key, {
        key: person.key,
        kind: 'orbit',
        tier,
        x: cx + Math.cos(angle) * ring.rx,
        y: cy + Math.sin(angle) * ring.ry,
        size: 1,
        opacity: 1,
        pill: ringPills || (!frame.compact && person.key === selectedKey),
        parentKey: null,
      });
      spokes.push(person.key);
      orbitKeys.push(person.key);
    });
  });

  const outer = rings[rings.length - 1];
  const issues = people.filter((p) => p.tier === 'issue').sort(byRingOrder);
  issues.forEach((person, i) => {
    const angle = toRadians(ISSUE_START_DEG + ISSUE_STEP_DEG * i);
    items.set(person.key, {
      key: person.key,
      kind: 'issue',
      tier: 'issue',
      x: clamp(cx + Math.cos(angle) * outer.rx * ISSUE_RADIUS_FACTOR, FRAME_MARGIN, frame.width - FRAME_MARGIN),
      y: clamp(cy + Math.sin(angle) * outer.ry * ISSUE_RADIUS_FACTOR, FRAME_MARGIN, frame.height - FRAME_MARGIN),
      size: 1,
      opacity: 1,
      pill: !frame.compact && issues.length <= 3,
      parentKey: null,
    });
    spokes.push(person.key);
  });

  const crossLinks: [string, string][] = [];
  const satelliteLinks: [string, string][] = [];

  if (showConnections) {
    const inOrbit = new Set(orbitKeys);
    const seenPairs = new Set<string>();
    for (const [a, b] of input.links) {
      if (a === b || !inOrbit.has(a) || !inOrbit.has(b)) continue;
      const pair: [string, string] = a < b ? [a, b] : [b, a];
      const id = `${pair[0]}|${pair[1]}`;
      if (seenPairs.has(id)) continue;
      seenPairs.add(id);
      crossLinks.push(pair);
    }

    const inView = new Set<string>([centreKey, ...spokes]);
    const taken = new Set<string>();
    const busy = orbitKeys.length > BUSY_ORBIT_COUNT;
    const parents =
      selectedKey && inOrbit.has(selectedKey)
        ? [selectedKey, ...orbitKeys.filter((key) => key !== selectedKey)]
        : orbitKeys;

    for (const parentKey of parents) {
      const node = items.get(parentKey);
      const person = personByKey.get(parentKey);
      if (!node || !person) continue;
      const selected = parentKey === selectedKey;
      const want = selected ? (frame.compact ? 4 : SATELLITE_LIMIT) : frame.compact || busy ? 1 : 2;
      const picks = person.satellites
        .filter((s) => s.key !== centreKey && !inView.has(s.key) && !taken.has(s.key))
        .slice(0, want);
      if (picks.length === 0) continue;

      const dx = node.x - cx;
      const dy = node.y - cy;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const extent = node.pill
        ? (pillWidth(person.label) / 2) * Math.abs(ux) + (PILL_HEIGHT / 2) * Math.abs(uy)
        : dotRadius(person.tier, person.refs, frame.compact);
      const distance = extent + (selected ? (frame.compact ? 28 : 38) : frame.compact ? 11 : 15);
      const step = selected ? 0.46 : 0.62;

      picks.forEach((satellite, j) => {
        const phi = (j - (picks.length - 1) / 2) * step;
        const vx = ux * Math.cos(phi) - uy * Math.sin(phi);
        const vy = ux * Math.sin(phi) + uy * Math.cos(phi);
        taken.add(satellite.key);
        satelliteLinks.push([parentKey, satellite.key]);
        items.set(satellite.key, {
          key: satellite.key,
          kind: 'satellite',
          tier: satellite.tier,
          x: clamp(node.x + vx * distance, FRAME_MARGIN, frame.width - FRAME_MARGIN),
          y: clamp(node.y + vy * distance, FRAME_MARGIN, frame.height - FRAME_MARGIN),
          size: 0,
          opacity: 1,
          pill: false,
          parentKey,
        });
      });
    }
  }

  return { frame, cx, cy, rings, items, spokes, crossLinks, satelliteLinks };
}

function lerpItem(from: OrbitItem, to: OrbitItem, t: number): OrbitItem {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    ...to,
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    size: mix(from.size, to.size),
    opacity: mix(from.opacity, to.opacity),
  };
}

/**
 * Items part-way from one scene to the next. People in both glide; newcomers
 * grow out of their parent, or out of wherever the new centre used to be;
 * people leaving fade, folding back into their parent when it stays.
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
      size: Math.min(target.size, 0.5),
      opacity: 0,
    };
    out.set(key, lerpItem(start, target, t));
  }

  for (const [key, previous] of from) {
    if (to.has(key)) continue;
    const home = previous.parentKey ? to.get(previous.parentKey) : undefined;
    const end: OrbitItem = home
      ? { ...previous, x: home.x, y: home.y, opacity: 0 }
      : { ...previous, opacity: 0 };
    out.set(key, lerpItem(previous, end, t));
  }

  return out;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

const fixed = (n: number) => n.toFixed(1);

/** The curved spoke from the centre out to a person. */
export function spokePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return `M ${fixed(x1)} ${fixed(y1)} C ${fixed(x1 + dx * 0.42)} ${fixed(y1 + dy * 0.12)}, ${fixed(x1 + dx * 0.68)} ${fixed(y1 + dy * 0.88)}, ${fixed(x2)} ${fixed(y2)}`;
}

/** An arc between two people, bowed away from the centre so it skirts the hub. */
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

export interface DrawCandidate {
  key: string;
  tier: OrbitTier;
  /** Their own standing: how many people vouch for them. */
  standing: number;
  deals: number;
}

/** The strongest people per tier, up to its cap, and how many were left out. */
export function pickDrawn<T extends DrawCandidate>(
  candidates: readonly T[],
): { drawn: T[]; hidden: Record<OrbitTier, number> } {
  const hidden: Record<OrbitTier, number> = { escrow: 0, receipt: 0, vouch: 0, issue: 0 };
  const drawn: T[] = [];
  for (const tier of [...PROOF_TIERS, 'issue'] as const) {
    const ranked = candidates
      .filter((c) => c.tier === tier)
      .sort((a, b) => b.standing - a.standing || b.deals - a.deals || a.key.localeCompare(b.key));
    drawn.push(...ranked.slice(0, TIER_CAPS[tier]));
    hidden[tier] = Math.max(0, ranked.length - TIER_CAPS[tier]);
  }
  return { drawn, hidden };
}

/**
 * Splits each drawn person's vouchers into arcs (the voucher is drawn too) and
 * satellites (they are not). The centre never appears as anyone's satellite.
 */
export function splitConnections(
  drawnKeys: readonly string[],
  vouchersOf: ReadonlyMap<string, readonly string[]>,
  centreKey: string | null,
  limit = SATELLITE_LIMIT,
): { links: [string, string][]; satellites: Map<string, string[]> } {
  const drawn = new Set(drawnKeys);
  const seenPairs = new Set<string>();
  const links: [string, string][] = [];
  const satellites = new Map<string, string[]>();

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
    satellites.set(key, own);
  }

  return { links, satellites };
}
