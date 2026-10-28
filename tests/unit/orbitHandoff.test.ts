// tests/unit/orbitHandoff.test.ts
//
// Moving between references pages remounts the Trust Network, and the handoff is
// what lets the next page carry on the same animation. The contract that matters:
// only a graph still on screen hands over, and once it has gone nothing lingers to
// be picked up by a graph met later.

import { afterEach, describe, expect, it } from 'vitest';

import {
  offerOrbitHandoff,
  receiveOrbitHandoff,
  withdrawOrbitHandoff,
  type OrbitHandoff,
} from '@/components/references/orbitHandoff';

function handoff(centreKey: string): OrbitHandoff {
  return {
    centreKey,
    items: new Map(),
    view: { yaw: 0, tilt: 0.42 },
    transition: null,
    planets: [],
    focusKey: null,
    arcs: [],
    tethers: [],
    rings: [],
    directory: new Map(),
  };
}

const outgoing = {};
const incoming = {};

afterEach(() => {
  withdrawOrbitHandoff(outgoing);
  withdrawOrbitHandoff(incoming);
});

describe('orbitHandoff', () => {
  it('hands the latest snapshot from a graph that is still mounted to the next one', () => {
    offerOrbitHandoff(outgoing, handoff('first'));
    offerOrbitHandoff(outgoing, handoff('second'));
    expect(receiveOrbitHandoff()?.centreKey).toBe('second');
  });

  it('keeps nothing once the graph that offered it has gone', () => {
    offerOrbitHandoff(outgoing, handoff('gone'));
    withdrawOrbitHandoff(incoming);
    expect(receiveOrbitHandoff()?.centreKey).toBe('gone');

    withdrawOrbitHandoff(outgoing);
    expect(receiveOrbitHandoff()).toBeNull();
  });
});
