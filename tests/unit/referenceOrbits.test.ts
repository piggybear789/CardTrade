// tests/unit/referenceOrbits.test.ts
//
// Proof orbits, the Trust Network layout.
//
// THE RING IS THE CLAIM. Where someone sits says how their deal was proven, so a
// regression that drew a vouch on the NoDitto ring, or let an issue drift in among
// the positives, would misstate a member's trust without any error. These pin the
// geometry that carries meaning, the limits that keep a big network legible, and
// the blend that makes walking from one person to the next readable.

import { describe, expect, it } from 'vitest';

import {
  COMPACT_FRAME,
  SATELLITE_LIMIT,
  TIER_CAPS,
  WIDE_FRAME,
  blendOrbitItems,
  buildOrbitScene,
  orbitKey,
  pickDrawn,
  splitConnections,
  type DrawCandidate,
  type OrbitItem,
  type OrbitPersonInput,
  type OrbitSceneInput,
  type OrbitTier,
} from '@/domain/references/orbits';

const CENTRE = 'centre';

function person(key: string, tier: OrbitTier, extra: Partial<OrbitPersonInput> = {}): OrbitPersonInput {
  return { key, tier, order: 0, refs: 10, label: `@${key}`, satellites: [], ...extra };
}

function sceneInput(people: OrbitPersonInput[], extra: Partial<OrbitSceneInput> = {}): OrbitSceneInput {
  return {
    centreKey: CENTRE,
    people,
    links: [],
    selectedKey: null,
    showConnections: true,
    frame: WIDE_FRAME,
    ...extra,
  };
}

function withSatellites(key: string, tier: OrbitTier, count: number): OrbitPersonInput {
  return person(key, tier, {
    satellites: Array.from({ length: count }, (_, i) => ({ key: `${key}-v${i}`, tier: 'vouch' as const })),
  });
}

/** A network at every tier's cap, each person carrying a full set of satellites. */
function fullNetwork(): OrbitPersonInput[] {
  return (['escrow', 'receipt', 'vouch', 'issue'] as const).flatMap((tier) =>
    Array.from({ length: TIER_CAPS[tier] }, (_, i) => withSatellites(`${tier}-${i}`, tier, SATELLITE_LIMIT)),
  );
}

/** 1 on the ellipse, below 1 inside it, above 1 outside it. */
function ellipseLevel(item: OrbitItem, cx: number, cy: number, rx: number, ry: number): number {
  return ((item.x - cx) / rx) ** 2 + ((item.y - cy) / ry) ** 2;
}

function satellitesOf(items: Map<string, OrbitItem>, parentKey: string): OrbitItem[] {
  return [...items.values()].filter((item) => item.parentKey === parentKey);
}

describe('buildOrbitScene', () => {
  it('puts the centre in the middle of the frame', () => {
    const scene = buildOrbitScene(sceneInput([person('a', 'vouch')]));
    expect(scene.items.get(CENTRE)).toMatchObject({ kind: 'centre', x: 380, y: 250, size: 2 });
  });

  it('places each person on the ring for their proof: NoDitto inside receipt checked inside vouched', () => {
    const people = (['escrow', 'receipt', 'vouch'] as const).flatMap((tier) =>
      [0, 1, 2].map((i) => person(`${tier}-${i}`, tier)),
    );
    const scene = buildOrbitScene(sceneInput(people));
    const [escrow, receipt, vouch] = scene.rings;

    expect(escrow.rx).toBeLessThan(receipt.rx);
    expect(receipt.rx).toBeLessThan(vouch.rx);
    expect(escrow.ry).toBeLessThan(receipt.ry);
    expect(receipt.ry).toBeLessThan(vouch.ry);

    for (const ring of scene.rings) {
      for (const key of people.filter((p) => p.tier === ring.tier).map((p) => p.key)) {
        const item = scene.items.get(key);
        expect(item?.kind).toBe('orbit');
        expect(ellipseLevel(item!, scene.cx, scene.cy, ring.rx, ring.ry)).toBeCloseTo(1, 6);
      }
    }
  });

  it('keeps issues outside every ring and below the centre', () => {
    const people = [person('v', 'vouch'), person('x1', 'issue'), person('x2', 'issue'), person('x3', 'issue')];
    for (const frame of [WIDE_FRAME, COMPACT_FRAME]) {
      const scene = buildOrbitScene(sceneInput(people, { frame }));
      const outer = scene.rings[scene.rings.length - 1];
      for (const key of ['x1', 'x2', 'x3']) {
        const item = scene.items.get(key)!;
        expect(item.kind).toBe('issue');
        expect(ellipseLevel(item, scene.cx, scene.cy, outer.rx, outer.ry)).toBeGreaterThan(1);
        expect(item.y).toBeGreaterThan(scene.cy);
      }
    }
  });

  it('keeps everything inside the frame at every cap, wide and compact', () => {
    const people = fullNetwork();
    for (const frame of [WIDE_FRAME, COMPACT_FRAME]) {
      for (const selectedKey of [null, 'vouch-0', 'escrow-3']) {
        const scene = buildOrbitScene(sceneInput(people, { frame, selectedKey }));
        for (const item of scene.items.values()) {
          expect(item.x).toBeGreaterThanOrEqual(0);
          expect(item.x).toBeLessThanOrEqual(frame.width);
          expect(item.y).toBeGreaterThanOrEqual(0);
          expect(item.y).toBeLessThanOrEqual(frame.height);
        }
      }
    }
  });

  it('labels a ring with pills only while they fit, and never on phones or the vouched ring', () => {
    const roomy = buildOrbitScene(sceneInput([0, 1, 2].map((i) => person(`e${i}`, 'escrow'))));
    expect(roomy.items.get('e0')?.pill).toBe(true);

    const crowded = buildOrbitScene(sceneInput(Array.from({ length: 8 }, (_, i) => person(`e${i}`, 'escrow'))));
    expect(crowded.items.get('e0')?.pill).toBe(false);

    const vouched = buildOrbitScene(sceneInput([person('v', 'vouch')]));
    expect(vouched.items.get('v')?.pill).toBe(false);

    const phone = buildOrbitScene(sceneInput([person('e', 'escrow')], { frame: COMPACT_FRAME }));
    expect(phone.items.get('e')?.pill).toBe(false);
  });

  it('gives the selected person a pill on wide screens even on a dot ring', () => {
    const scene = buildOrbitScene(sceneInput([person('v', 'vouch'), person('w', 'vouch')], { selectedKey: 'v' }));
    expect(scene.items.get('v')?.pill).toBe(true);
    expect(scene.items.get('w')?.pill).toBe(false);
  });

  it('shows two satellites each, five for the selected person, and none with connections off', () => {
    const people = [withSatellites('a', 'escrow', 6), withSatellites('b', 'receipt', 6)];

    const resting = buildOrbitScene(sceneInput(people));
    expect(satellitesOf(resting.items, 'a')).toHaveLength(2);
    expect(satellitesOf(resting.items, 'b')).toHaveLength(2);

    const selected = buildOrbitScene(sceneInput(people, { selectedKey: 'a' }));
    expect(satellitesOf(selected.items, 'a')).toHaveLength(SATELLITE_LIMIT);
    expect(satellitesOf(selected.items, 'b')).toHaveLength(2);

    const phone = buildOrbitScene(sceneInput(people, { frame: COMPACT_FRAME }));
    expect(satellitesOf(phone.items, 'a')).toHaveLength(1);

    const off = buildOrbitScene(sceneInput(people, { showConnections: false, links: [['a', 'b']] }));
    expect([...off.items.values()].filter((i) => i.kind === 'satellite')).toHaveLength(0);
    expect(off.crossLinks).toEqual([]);
    expect(off.satelliteLinks).toEqual([]);
  });

  it('drops to one satellite each once the rings get busy', () => {
    const people = Array.from({ length: 24 }, (_, i) => withSatellites(`v${i}`, 'vouch', 3));
    const scene = buildOrbitScene(sceneInput(people, { selectedKey: 'v0' }));
    expect(satellitesOf(scene.items, 'v0')).toHaveLength(3);
    for (let i = 1; i < 24; i += 1) {
      expect(satellitesOf(scene.items, `v${i}`).length).toBeLessThanOrEqual(1);
    }
  });

  it('never shows the centre, someone already drawn, or the same person twice as a satellite', () => {
    const shared = { key: 'shared', tier: 'vouch' as const };
    const people = [
      person('a', 'escrow', { satellites: [{ key: CENTRE, tier: 'vouch' }, { key: 'b', tier: 'vouch' }, shared] }),
      person('b', 'receipt', { satellites: [shared, { key: 'own', tier: 'escrow' }] }),
    ];
    const scene = buildOrbitScene(sceneInput(people));
    const satellites = [...scene.items.values()].filter((i) => i.kind === 'satellite');

    expect(satellites.map((s) => s.key).sort()).toEqual(['own', 'shared']);
    expect(scene.items.get(CENTRE)?.kind).toBe('centre');
    expect(scene.items.get('b')?.kind).toBe('orbit');
    expect(scene.satelliteLinks).toEqual([
      ['a', 'shared'],
      ['b', 'own'],
    ]);
  });

  it('draws one arc per pair, and only between people on the rings', () => {
    const people = [person('a', 'escrow'), person('b', 'vouch'), person('x', 'issue')];
    const scene = buildOrbitScene(
      sceneInput(people, {
        links: [
          ['a', 'b'],
          ['b', 'a'],
          ['a', 'x'],
          ['a', 'ghost'],
          ['a', 'a'],
        ],
      }),
    );
    expect(scene.crossLinks).toEqual([['a', 'b']]);
  });

  it('lists every first-degree person as a spoke, issues last', () => {
    const scene = buildOrbitScene(sceneInput([person('x', 'issue'), person('v', 'vouch'), person('e', 'escrow')]));
    expect(scene.spokes).toEqual(['e', 'v', 'x']);
  });

  it('is deterministic', () => {
    const input = sceneInput(fullNetwork(), { selectedKey: 'receipt-2' });
    expect(buildOrbitScene(input)).toEqual(buildOrbitScene(input));
  });
});

describe('blendOrbitItems', () => {
  const before = buildOrbitScene(
    sceneInput([withSatellites('kai', 'escrow', 2), person('gems', 'receipt')], { links: [['kai', 'gems']] }),
  );
  // Re-centred on kai: the old centre and gems stay, kai's satellites join the rings.
  const after = buildOrbitScene({
    ...sceneInput([person(CENTRE, 'escrow'), person('gems', 'receipt'), person('kai-v0', 'vouch'), person('new', 'vouch')]),
    centreKey: 'kai',
  });

  it('starts where the last scene ended and lands exactly on the next', () => {
    const start = blendOrbitItems(before.items, after.items, 0, 'kai');
    expect(start.get('gems')).toMatchObject({ x: before.items.get('gems')!.x, y: before.items.get('gems')!.y });
    expect(start.get('kai')).toMatchObject({ x: before.items.get('kai')!.x, size: 1 });
    expect(blendOrbitItems(before.items, after.items, 1, 'kai')).toBe(after.items);
    expect(blendOrbitItems(null, after.items, 0.3, 'kai')).toBe(after.items);
  });

  it('moves people who stay part of the way', () => {
    const mid = blendOrbitItems(before.items, after.items, 0.5, 'kai');
    const from = before.items.get('gems')!;
    const to = after.items.get('gems')!;
    expect(mid.get('gems')?.x).toBeCloseTo((from.x + to.x) / 2, 6);
    expect(mid.get('kai')?.size).toBeCloseTo(1.5, 6);
  });

  it('grows newcomers out of where the new centre was', () => {
    const start = blendOrbitItems(before.items, after.items, 0, 'kai');
    const kaiBefore = before.items.get('kai')!;
    expect(start.get('new')).toMatchObject({ x: kaiBefore.x, y: kaiBefore.y, opacity: 0 });
    // kai's own satellite was already on screen, so it glides rather than appearing.
    expect(start.get('kai-v0')).toMatchObject({ x: before.items.get('kai-v0')!.x, opacity: 1 });
  });

  it('fades people who leave, folding satellites back into a parent that stays', () => {
    const resting = buildOrbitScene(sceneInput([withSatellites('a', 'escrow', 5)], { selectedKey: 'a' }));
    const collapsed = buildOrbitScene(sceneInput([withSatellites('a', 'escrow', 5)]));
    const leaving = [...resting.items.keys()].filter((key) => !collapsed.items.has(key));
    expect(leaving.length).toBe(3);

    const end = blendOrbitItems(resting.items, collapsed.items, 0.999999, CENTRE);
    for (const key of leaving) {
      expect(end.get(key)?.opacity).toBeCloseTo(0, 4);
      expect(end.get(key)?.x).toBeCloseTo(collapsed.items.get('a')!.x, 2);
    }
  });
});

describe('pickDrawn', () => {
  it('draws the strongest people per tier up to its cap and counts the rest', () => {
    const candidates: DrawCandidate[] = Array.from({ length: TIER_CAPS.escrow + 3 }, (_, i) => ({
      key: `e${i}`,
      tier: 'escrow',
      standing: i,
      deals: 1,
    }));
    candidates.push({ key: 'x', tier: 'issue', standing: 0, deals: 1 });

    const { drawn, hidden } = pickDrawn(candidates);
    const escrow = drawn.filter((c) => c.tier === 'escrow');

    expect(escrow).toHaveLength(TIER_CAPS.escrow);
    expect(escrow[0].key).toBe(`e${TIER_CAPS.escrow + 2}`);
    expect(drawn.some((c) => c.key === 'e0')).toBe(false);
    expect(hidden).toEqual({ escrow: 3, receipt: 0, vouch: 0, issue: 0 });
    expect(drawn.some((c) => c.key === 'x')).toBe(true);
  });
});

describe('splitConnections', () => {
  it('turns drawn vouchers into arcs and the rest into satellites, never the centre', () => {
    const vouchers = new Map<string, string[]>([
      ['kai', ['gems', CENTRE, 'v1', 'v2', 'v3', 'v4', 'v5', 'v6']],
      ['gems', ['kai', 'v1']],
    ]);
    const { links, satellites } = splitConnections(['kai', 'gems'], vouchers, CENTRE);

    expect(links).toEqual([['gems', 'kai']]);
    expect(satellites.get('kai')).toEqual(['v1', 'v2', 'v3', 'v4', 'v5']);
    expect(satellites.get('gems')).toEqual(['v1']);
  });
});

describe('orbitKey', () => {
  it('keeps an issue apart from a positive reference by the same person', () => {
    expect(orbitKey('p1', 'POSITIVE')).toBe('p1');
    expect(orbitKey('p1', 'NEGATIVE')).toBe('p1:issue');
  });
});
