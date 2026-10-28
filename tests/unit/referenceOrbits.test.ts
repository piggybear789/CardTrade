// tests/unit/referenceOrbits.test.ts
//
// The Trust Network's solar-system layout.
//
// SIZE IS THE CLAIM. A planet's size says how many people vouch for that person, so
// a regression that sized planets by anything else would misstate reputation
// without any error. These pin that, the perspective that keeps every body on an
// orbit and inside the frame, the drag that keeps the grabbed half under the
// pointer, the connections a selected planet opens, the labels that show whole or
// not at all, and the blend that makes walking from one person to the next readable.

import { describe, expect, it } from 'vitest';

import {
  COMPACT_FRAME,
  DEFAULT_VIEW,
  ISSUE_CAP,
  MAX_TILT,
  MIN_TILT,
  PLANET_CAP,
  STAR_LIMIT,
  SUN_Y,
  WIDE_FRAME,
  blendOrbitItems,
  buildOrbitScene,
  dragView,
  orbitKey,
  perspectiveScale,
  pickDrawn,
  planetRadius,
  projectPoint,
  splitConnections,
  yawToBack,
  yawToFront,
  yawToSelectedRest,
  type DrawCandidate,
  type OrbitItem,
  type OrbitPersonInput,
  type OrbitScene,
  type OrbitSceneInput,
} from '@/domain/references/orbits';

const SUN = 'sun';

function person(key: string, refs = 10, extra: Partial<OrbitPersonInput> = {}): OrbitPersonInput {
  return { key, refs, issue: false, stars: [], ...extra };
}

function withStars(key: string, count: number, refs = 10): OrbitPersonInput {
  return person(key, refs, { stars: Array.from({ length: count }, (_, i) => ({ key: `${key}-s${i}` })) });
}

function sceneInput(people: OrbitPersonInput[], extra: Partial<OrbitSceneInput> = {}): OrbitSceneInput {
  return {
    centreKey: SUN,
    people,
    links: [],
    focus: null,
    closing: null,
    frame: WIDE_FRAME,
    view: DEFAULT_VIEW,
    ...extra,
  };
}

function opened(key: string, open = 1): Partial<OrbitSceneInput> {
  return { focus: { key, open } };
}

function starsOf(items: ReadonlyMap<string, OrbitItem>, planetKey: string): OrbitItem[] {
  return [...items.values()].filter((item) => item.parentKey === planetKey);
}

/** A full system: every planet and issue the cap allows, each with a full set of stars. */
function fullSystem(): OrbitPersonInput[] {
  const planets = Array.from({ length: PLANET_CAP }, (_, i) => withStars(`p${i}`, STAR_LIMIT, 60 - i));
  const issues = Array.from({ length: ISSUE_CAP }, (_, i) => person(`x${i}`, 1, { issue: true }));
  return [...planets, ...issues];
}

/** Which orbit a planet sits on, found by projecting each orbit at the planet's angle. */
function orbitOf(scene: OrbitScene, key: string, yaw: number): number {
  const item = scene.items.get(key)!;
  const turned = scene.angles.get(key)! + yaw;
  return scene.rings.findIndex((ring) => {
    const at = projectPoint(scene.camera, Math.cos(turned) * ring.radius, Math.sin(turned) * ring.radius);
    return Math.abs(at.x - item.x) < 0.02 && Math.abs(at.y - item.y) < 0.02;
  });
}

describe('buildOrbitScene', () => {
  it('puts the sun in the middle, a little above centre', () => {
    const scene = buildOrbitScene(sceneInput([person('a')]));
    const sun = scene.items.get(SUN)!;
    expect(sun).toMatchObject({ kind: 'sun', x: WIDE_FRAME.width / 2, depth: 0 });
    expect(sun.y).toBeCloseTo(WIDE_FRAME.height * SUN_Y, 2);
  });

  it('sizes a planet by how many people vouch for it, up to a cap, in perspective', () => {
    expect(planetRadius(41, false)).toBeGreaterThan(planetRadius(9, false));
    expect(planetRadius(9, false)).toBeGreaterThan(planetRadius(1, false));
    expect(planetRadius(10_000, false)).toBe(planetRadius(1_000_000, false));
    expect(planetRadius(41, true)).toBeLessThan(planetRadius(41, false));

    const scene = buildOrbitScene(sceneInput([person('big', 41), person('small', 2)]));
    for (const [key, refs] of [['big', 41], ['small', 2]] as const) {
      const item = scene.items.get(key)!;
      const scale = perspectiveScale(item.depth, DEFAULT_VIEW.tilt) * scene.camera.zoom;
      expect(item.r).toBeCloseTo(planetRadius(refs, false) * scale, 1);
    }
  });

  it('draws a planet larger, lower and stronger at the front of its orbit than at the back', () => {
    const people = [person('a', 20), person('b', 5)];
    const angle = buildOrbitScene(sceneInput(people)).angles.get('a')!;
    const turnedTo = (yaw: number) => buildOrbitScene(sceneInput(people, { view: { ...DEFAULT_VIEW, yaw } }));
    const frontScene = turnedTo(yawToFront(angle));
    const front = frontScene.items.get('a')!;
    const back = turnedTo(yawToFront(angle) + Math.PI).items.get('a')!;

    expect(front.r).toBeGreaterThan(back.r * 1.3);
    expect(front.y - frontScene.cy).toBeGreaterThan(frontScene.cy - back.y);
    expect(front.opacity).toBeGreaterThan(back.opacity);
  });

  it('keeps every planet on one of the orbits', () => {
    const people = Array.from({ length: 20 }, (_, i) => person(`p${i}`, i));
    const scene = buildOrbitScene(sceneInput(people));
    for (const key of scene.planets) expect(orbitOf(scene, key, DEFAULT_VIEW.yaw)).toBeGreaterThanOrEqual(0);
  });

  it('adds orbits as the system grows and spreads the biggest planets across them', () => {
    expect(buildOrbitScene(sceneInput(Array.from({ length: 5 }, (_, i) => person(`p${i}`)))).rings).toHaveLength(1);
    expect(buildOrbitScene(sceneInput(Array.from({ length: 12 }, (_, i) => person(`p${i}`)))).rings).toHaveLength(2);

    const people = Array.from({ length: 24 }, (_, i) => person(`p${i}`, 100 - i));
    const scene = buildOrbitScene(sceneInput(people));
    expect(scene.rings).toHaveLength(3);
    expect(scene.planets.slice(0, 3)).toEqual(['p0', 'p1', 'p2']);
    expect(new Set(['p0', 'p1', 'p2'].map((key) => orbitOf(scene, key, DEFAULT_VIEW.yaw))).size).toBeGreaterThan(1);
  });

  it('turns with yaw, and yawToFront brings a planet to the front', () => {
    const people = Array.from({ length: 8 }, (_, i) => person(`p${i}`));
    const angle = buildOrbitScene(sceneInput(people)).angles.get('p5')!;
    const yaw = yawToFront(angle);
    const turned = buildOrbitScene(sceneInput(people, { view: { ...DEFAULT_VIEW, yaw } }));
    const front = turned.items.get('p5')!;
    const ring = turned.rings[orbitOf(turned, 'p5', yaw)];

    expect(front.depth).toBeCloseTo(ring.radius / turned.camera.outer, 3);
    expect(front.x).toBeCloseTo(turned.cx, 1);
    expect(front.y).toBeGreaterThan(turned.cy);
  });

  it('opens the orbits as the viewer tilts to look down, within limits', () => {
    const people = [person('a')];
    const frontDrop = (tilt: number) => {
      const scene = buildOrbitScene(sceneInput(people, { view: { yaw: yawToFront(0), tilt } }));
      return scene.items.get('a')!.y - scene.cy;
    };
    expect(frontDrop(0.5)).toBeGreaterThan(frontDrop(0.25));
    expect(buildOrbitScene(sceneInput(people, { view: { yaw: 0, tilt: 5 } })).camera.tilt).toBe(MAX_TILT);
    expect(buildOrbitScene(sceneInput(people, { view: { yaw: 0, tilt: -1 } })).camera.tilt).toBe(MIN_TILT);
  });

  it('pulls back to fit the frame only when tilted far over', () => {
    expect(buildOrbitScene(sceneInput(fullSystem())).camera.zoom).toBe(1);
    expect(buildOrbitScene(sceneInput(fullSystem(), { frame: COMPACT_FRAME })).camera.zoom).toBe(1);
    expect(buildOrbitScene(sceneInput(fullSystem(), { view: { yaw: 0, tilt: MAX_TILT } })).camera.zoom).toBeLessThan(1);
  });

  it('turns a planet to the back with yawToBack, where it draws at full strength once open', () => {
    const people = Array.from({ length: 8 }, (_, i) => withStars(`p${i}`, 3));
    const angle = buildOrbitScene(sceneInput(people)).angles.get('p5')!;
    const view = { ...DEFAULT_VIEW, yaw: yawToBack(angle) };

    const resting = buildOrbitScene(sceneInput(people, { view }));
    const back = resting.items.get('p5')!;
    expect(back.y).toBeLessThan(resting.cy);
    expect(back.x).toBeCloseTo(resting.cx, 1);
    expect(back.opacity).toBeLessThan(1);

    const open = buildOrbitScene(sceneInput(people, { view, ...opened('p5') }));
    const planet = open.items.get('p5')!;
    expect(planet.opacity).toBe(1);
    for (const star of starsOf(open.items, 'p5')) expect(star.y).toBeLessThan(planet.y);
  });

  it('rests a selected planet on the back-left diagonal, its fan inside the frame', () => {
    const people = Array.from({ length: 8 }, (_, i) => withStars(`p${i}`, 3));
    for (const frame of [WIDE_FRAME, COMPACT_FRAME]) {
      const angle = buildOrbitScene(sceneInput(people, { frame })).angles.get('p5')!;
      const view = { ...DEFAULT_VIEW, yaw: yawToSelectedRest(angle) };
      const open = buildOrbitScene(sceneInput(people, { frame, view, ...opened('p5') }));
      const planet = open.items.get('p5')!;

      // Up and to the left of the sun: behind it, and off its vertical so the planet's
      // label and fan do not stack on the sun's.
      expect(planet.x).toBeLessThan(open.cx - 1);
      expect(planet.y).toBeLessThan(open.cy);
      for (const star of starsOf(open.items, 'p5')) {
        expect(star.x - star.r).toBeGreaterThanOrEqual(-1);
        expect(star.y - star.r).toBeGreaterThanOrEqual(-1);
      }
    }
  });

  it('keeps every body inside the frame however the system is turned', () => {
    const people = fullSystem();
    for (const frame of [WIDE_FRAME, COMPACT_FRAME]) {
      for (const tilt of [MIN_TILT, DEFAULT_VIEW.tilt, MAX_TILT]) {
        for (const yaw of [0, 0.7, 2.1, 4.4]) {
          for (const focus of [null, { key: 'p0', open: 1 }, { key: 'p17', open: 0.5 }]) {
            const scene = buildOrbitScene(sceneInput(people, { frame, view: { yaw, tilt }, focus }));
            for (const item of scene.items.values()) {
              expect(item.x - item.r).toBeGreaterThanOrEqual(-1);
              expect(item.x + item.r).toBeLessThanOrEqual(frame.width + 1);
              expect(item.y - item.r).toBeGreaterThanOrEqual(-1);
              expect(item.y + item.r).toBeLessThanOrEqual(frame.height + 1);
            }
          }
        }
      }
    }
  });

  it('shows connections only for the planet that is open', () => {
    const people = [
      withStars('a', 6),
      withStars('b', 6),
      person('c'),
      person('x', 1, { issue: true, stars: [{ key: 'x-s0' }] }),
    ];
    const links: [string, string][] = [
      ['a', 'b'],
      ['b', 'c'],
      ['a', 'x'],
    ];

    const resting = buildOrbitScene(sceneInput(people, { links }));
    expect([...resting.items.values()].filter((item) => item.kind === 'star')).toHaveLength(0);
    expect(resting.arcs).toEqual([]);
    expect(resting.tethers).toEqual([]);

    const open = buildOrbitScene(sceneInput(people, { links, ...opened('a') }));
    expect(starsOf(open.items, 'a')).toHaveLength(STAR_LIMIT);
    expect(starsOf(open.items, 'b')).toHaveLength(0);
    expect(open.tethers).toHaveLength(STAR_LIMIT);
    expect(open.arcs.map(({ a, b }) => [a, b])).toEqual([
      ['a', 'b'],
      ['a', 'x'],
    ]);

    expect(starsOf(buildOrbitScene(sceneInput(people, { frame: COMPACT_FRAME, ...opened('a') })).items, 'a')).toHaveLength(4);
    expect(starsOf(buildOrbitScene(sceneInput(people, opened('x'))).items, 'x')).toHaveLength(0);
  });

  it('fans a planet’s stars out on its far side from the sun, wherever it is', () => {
    const people = [withStars('a', STAR_LIMIT), person('b'), person('c')];
    for (const yaw of [0, 1.3, 2.6, 4.2]) {
      const scene = buildOrbitScene(sceneInput(people, { view: { ...DEFAULT_VIEW, yaw }, ...opened('a') }));
      const planet = scene.items.get('a')!;
      const outX = planet.x - scene.cx;
      const outY = planet.y - scene.cy;
      for (const star of starsOf(scene.items, 'a')) {
        expect(Math.hypot(star.x - scene.cx, star.y - scene.cy)).toBeGreaterThan(Math.hypot(outX, outY));
        expect((star.x - planet.x) * outX + (star.y - planet.y) * outY).toBeGreaterThan(0);
      }
    }
  });

  it('grows the stars out of their planet as it opens, and folds them back as it closes', () => {
    const people = [withStars('a', 3), withStars('b', 3)];
    const shut = buildOrbitScene(sceneInput(people, opened('a', 0)));
    const half = buildOrbitScene(sceneInput(people, opened('a', 0.5)));
    const full = buildOrbitScene(sceneInput(people, opened('a', 1)));
    const planet = full.items.get('a')!;
    const reach = (scene: OrbitScene) => {
      const star = scene.items.get('a-s1')!;
      return Math.hypot(star.x - planet.x, star.y - planet.y);
    };

    expect(shut.items.get('a-s1')).toMatchObject({ x: planet.x, y: planet.y, opacity: 0 });
    expect(reach(half)).toBeCloseTo(reach(full) / 2, 1);

    const switching = buildOrbitScene(
      sceneInput(people, { focus: { key: 'b', open: 0.3 }, closing: { key: 'a', open: 0.7 } }),
    );
    expect(starsOf(switching.items, 'a')).toHaveLength(3);
    expect(starsOf(switching.items, 'b')).toHaveLength(3);
    expect(switching.items.get('a-s0')!.opacity).toBeCloseTo(0.7 * switching.items.get('a')!.opacity, 2);
  });

  it('hands a star that two open planets share to the more open one', () => {
    const shared = { key: 'shared' };
    const people = [person('a', 20, { stars: [shared] }), person('b', 10, { stars: [shared] })];
    const early = buildOrbitScene(sceneInput(people, { focus: { key: 'b', open: 0.2 }, closing: { key: 'a', open: 0.8 } }));
    const late = buildOrbitScene(sceneInput(people, { focus: { key: 'b', open: 0.8 }, closing: { key: 'a', open: 0.2 } }));
    expect(early.items.get('shared')?.parentKey).toBe('a');
    expect(late.items.get('shared')?.parentKey).toBe('b');
  });

  it('never shows the sun or a planet as a star', () => {
    const people = [person('a', 20, { stars: [{ key: SUN }, { key: 'b' }, { key: 'own' }] }), person('b', 10)];
    const scene = buildOrbitScene(sceneInput(people, opened('a')));
    expect(starsOf(scene.items, 'a').map((star) => star.key)).toEqual(['own']);
    expect(scene.items.get('b')?.kind).toBe('planet');
    expect(scene.items.get(SUN)?.kind).toBe('sun');
  });

  it('draws one arc per pair, only between planets, as open as the planet showing it', () => {
    const scene = buildOrbitScene(
      sceneInput([person('a'), person('b'), person('c')], {
        links: [
          ['a', 'b'],
          ['b', 'a'],
          ['a', 'ghost'],
          ['a', 'a'],
          ['a', SUN],
          ['b', 'c'],
        ],
        focus: { key: 'a', open: 0.4 },
        closing: { key: 'b', open: 0.6 },
      }),
    );
    expect(scene.arcs).toEqual([
      { a: 'a', b: 'b', open: 0.6 },
      { a: 'b', b: 'c', open: 0.6 },
    ]);
  });

  it('rounds what it draws, so the server’s render and the browser’s agree', () => {
    const scene = buildOrbitScene(
      sceneInput(fullSystem(), { view: { yaw: 1.234567, tilt: 0.4321 }, ...opened('p3', 0.37) }),
    );
    const onGrid = (value: number, factor: number) => Math.abs(value * factor - Math.round(value * factor)) < 1e-6;
    for (const item of scene.items.values()) {
      expect(onGrid(item.x, 100) && onGrid(item.y, 100) && onGrid(item.r, 100) && onGrid(item.opacity, 1000)).toBe(true);
    }
  });

  it('is deterministic', () => {
    const input = sceneInput(fullSystem(), { view: { yaw: 1.1, tilt: 0.4 }, ...opened('p4', 0.6) });
    expect(buildOrbitScene(input)).toEqual(buildOrbitScene(input));
  });
});

describe('dragView', () => {
  const people = [person('a')];
  const planetAt = (yaw: number, tilt = DEFAULT_VIEW.tilt) =>
    buildOrbitScene(sceneInput(people, { view: { yaw, tilt } })).items.get('a')!;
  const front = yawToFront(0);
  const back = front + Math.PI;

  it('moves whichever half is grabbed along with the pointer', () => {
    const frontRight = dragView({ yaw: front, tilt: DEFAULT_VIEW.tilt }, 0.05, 0, true);
    expect(planetAt(frontRight.yaw).x).toBeGreaterThan(planetAt(front).x);

    const backRight = dragView({ yaw: back, tilt: DEFAULT_VIEW.tilt }, 0.05, 0, false);
    expect(planetAt(backRight.yaw).x).toBeGreaterThan(planetAt(back).x);
  });

  it('tilts so whichever half is grabbed follows the pointer up and down, within limits', () => {
    const frontDown = dragView({ yaw: front, tilt: DEFAULT_VIEW.tilt }, 0, 0.05, true);
    expect(planetAt(front, frontDown.tilt).y).toBeGreaterThan(planetAt(front).y);

    const backDown = dragView({ yaw: back, tilt: DEFAULT_VIEW.tilt }, 0, 0.05, false);
    expect(planetAt(back, backDown.tilt).y).toBeGreaterThan(planetAt(back).y);

    expect(dragView(DEFAULT_VIEW, 0, 10, true).tilt).toBe(MAX_TILT);
    expect(dragView(DEFAULT_VIEW, 0, -10, true).tilt).toBe(MIN_TILT);
  });
});

describe('blendOrbitItems', () => {
  const before = buildOrbitScene(
    sceneInput([withStars('kai', 2, 41), person('gems', 34)], { links: [['kai', 'gems']], ...opened('kai') }),
  );
  // Re-centred on kai: the old sun and gems stay, one of kai's stars becomes a planet.
  const after = buildOrbitScene({
    ...sceneInput([person(SUN, 23), person('gems', 34), person('kai-s0', 8), person('new', 5)]),
    centreKey: 'kai',
  });

  it('starts where the last scene ended and lands exactly on the next', () => {
    const start = blendOrbitItems(before.items, after.items, 0, 'kai');
    expect(start.get('gems')).toMatchObject({ x: before.items.get('gems')!.x, y: before.items.get('gems')!.y });
    expect(start.get('kai')).toMatchObject({ x: before.items.get('kai')!.x, r: before.items.get('kai')!.r });
    expect(blendOrbitItems(before.items, after.items, 1, 'kai')).toBe(after.items);
    expect(blendOrbitItems(null, after.items, 0.3, 'kai')).toBe(after.items);
  });

  it('moves bodies that stay part of the way', () => {
    const mid = blendOrbitItems(before.items, after.items, 0.5, 'kai');
    const from = before.items.get('gems')!;
    const to = after.items.get('gems')!;
    expect(mid.get('gems')?.x).toBeCloseTo((from.x + to.x) / 2, 6);
    expect(mid.get('kai')?.r).toBeCloseTo((before.items.get('kai')!.r + after.items.get('kai')!.r) / 2, 6);
  });

  it('grows newcomers out of where the new sun was, and lets a star glide into its orbit', () => {
    const start = blendOrbitItems(before.items, after.items, 0, 'kai');
    const kaiBefore = before.items.get('kai')!;
    expect(start.get('new')).toMatchObject({ x: kaiBefore.x, y: kaiBefore.y, opacity: 0 });
    expect(start.get('kai-s0')).toMatchObject({ x: before.items.get('kai-s0')!.x, y: before.items.get('kai-s0')!.y });
  });

  it('fades stars that leave, folding them back into a planet that stays', () => {
    const open = buildOrbitScene(sceneInput([withStars('a', 5)], opened('a')));
    const resting = buildOrbitScene(sceneInput([withStars('a', 5)]));
    const leaving = [...open.items.keys()].filter((key) => !resting.items.has(key));
    expect(leaving).toHaveLength(5);

    const end = blendOrbitItems(open.items, resting.items, 0.999999, SUN);
    for (const key of leaving) {
      expect(end.get(key)?.opacity).toBeCloseTo(0, 4);
      expect(end.get(key)?.x).toBeCloseTo(resting.items.get('a')!.x, 2);
    }
  });
});

describe('pickDrawn', () => {
  it('draws the best-vouched planets and the issues up to their caps, and counts the rest', () => {
    const candidates: DrawCandidate[] = [
      ...Array.from({ length: PLANET_CAP + 4 }, (_, i) => ({ key: `p${i}`, issue: false, standing: i, deals: 1 })),
      ...Array.from({ length: ISSUE_CAP + 1 }, (_, i) => ({ key: `x${i}`, issue: true, standing: 0, deals: 1 })),
    ];
    const { drawn, hidden } = pickDrawn(candidates);
    const planets = drawn.filter((c) => !c.issue);

    expect(planets).toHaveLength(PLANET_CAP);
    expect(planets[0].key).toBe(`p${PLANET_CAP + 3}`);
    expect(planets.some((c) => c.key === 'p0')).toBe(false);
    expect(drawn.filter((c) => c.issue)).toHaveLength(ISSUE_CAP);
    expect(hidden).toEqual({ people: 4, issues: 1 });
  });
});

describe('splitConnections', () => {
  it('turns drawn vouchers into arcs and the rest into stars, never the sun', () => {
    const vouchers = new Map<string, string[]>([
      ['kai', ['gems', SUN, 'v1', 'v2', 'v3', 'v4', 'v5', 'v6']],
      ['gems', ['kai', 'v1']],
    ]);
    const { links, stars } = splitConnections(['kai', 'gems'], vouchers, SUN);

    expect(links).toEqual([['gems', 'kai']]);
    expect(stars.get('kai')).toEqual(['v1', 'v2', 'v3', 'v4', 'v5']);
    expect(stars.get('gems')).toEqual(['v1']);
  });
});

describe('orbitKey', () => {
  it('keeps an issue or neutral reference apart from a positive reference by the same person', () => {
    expect(orbitKey('p1', 'POSITIVE')).toBe('p1');
    expect(orbitKey('p1', 'NEUTRAL')).toBe('p1:neutral');
    expect(orbitKey('p1', 'NEGATIVE')).toBe('p1:issue');
  });
});
