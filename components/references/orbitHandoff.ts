// components/references/orbitHandoff.ts
//
// Carries the Trust Network across a page change. Opening someone's page is a new
// `[handle]`, and Next remounts the page for that, so on its own the graph would
// restart from rest. Instead the graph on screen keeps offering a snapshot of what
// it shows, and the next page's graph takes it on its first render: carrying on a
// walk already under way, or animating from wherever the last page left off.
//
// Only a graph that is still mounted can hand over. That is exactly the moment of
// a navigation, because Next renders the incoming page while the outgoing one is
// still on screen, and it means a graph met later, after other pages, starts fresh.

import type { OrbitArc, OrbitItem, OrbitRing, OrbitView } from '@/domain/references/orbits';
import type { OrbitEntry, OrbitTransition } from '@/components/references/useTrustOrbits';

export interface OrbitHandoff {
  centreKey: string;
  /** What is drawn right now, mid-animation included. */
  items: ReadonlyMap<string, OrbitItem>;
  view: OrbitView;
  autoSpin: boolean;
  /** A walk under way, toward `centreKey`. */
  transition: OrbitTransition | null;
  planets: readonly string[];
  focusKey: string | null;
  arcs: readonly OrbitArc[];
  tethers: readonly [string, string][];
  rings: readonly OrbitRing[];
  directory: ReadonlyMap<string, OrbitEntry>;
}

let offered: { owner: object; handoff: OrbitHandoff } | null = null;

export function offerOrbitHandoff(owner: object, handoff: OrbitHandoff): void {
  offered = { owner, handoff };
}

export function withdrawOrbitHandoff(owner: object): void {
  if (offered?.owner === owner) offered = null;
}

export function receiveOrbitHandoff(): OrbitHandoff | null {
  return offered?.handoff ?? null;
}
