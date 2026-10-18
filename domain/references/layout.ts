// domain/references/layout.ts
//
// Deterministic radial vector layout for the reference graph.
// Ring 1 sits on an elliptical orbit around the centre hub; when more than 6
// nodes are present, alternating nodes step onto a staggered outer/inner
// ellipse so horizontal node cards never collide. Ring 2 satellites sit on an
// outer arc behind their parent away from the hub.
//
// Pure: no Supabase, React or service imports.

export interface GraphLayoutNodeInput {
  id: string;
  /** Referee strength: their own incoming reference count. Drives node size. */
  weight: number;
}

export interface GraphLayoutChildInput extends GraphLayoutNodeInput {
  parentId: string;
}

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  r: number;
}

/** Node radius for a referee with `weight` incoming references. Capped both ways. */
export function nodeRadius(weight: number): number {
  const w = Math.max(0, weight);
  return Math.round(Math.min(36, Math.max(18, 18 + Math.sqrt(w) * 3.6)));
}

const TAU = Math.PI * 2;

/**
 * Place ring-1 nodes around (`cx`, `cy`) on an elliptical orbit.
 * Starting angle is upper-left (-140 deg) and proceeds clockwise.
 */
export function layoutRing(
  nodes: GraphLayoutNodeInput[],
  cx: number,
  cy: number,
  ringRadius: number,
): PlacedNode[] {
  const count = nodes.length;
  if (count === 0) return [];
  const start = -Math.PI * 0.72;
  return nodes.map((node, i) => {
    const angle = start + (i / count) * TAU;
    const stagger = count > 6 ? (i % 2 === 0 ? 0.92 : 1.14) : i % 2 === 0 ? 0.98 : 1.06;
    const rx = ringRadius * 1.12 * stagger;
    const ry = ringRadius * 0.76 * stagger;
    return {
      id: node.id,
      x: Math.round(cx + Math.cos(angle) * rx),
      y: Math.round(cy + Math.sin(angle) * ry),
      r: nodeRadius(node.weight),
    };
  });
}

/** Place ring-2 satellite nodes on an outer arc behind their parent, away from centre. */
export function layoutChildren(
  children: GraphLayoutChildInput[],
  placedParents: Map<string, PlacedNode>,
  cx: number,
  cy: number,
): PlacedNode[] {
  const byParent = new Map<string, GraphLayoutChildInput[]>();
  for (const child of children) {
    const list = byParent.get(child.parentId) ?? [];
    list.push(child);
    byParent.set(child.parentId, list);
  }

  const placed: PlacedNode[] = [];
  for (const [parentId, kids] of byParent) {
    const parent = placedParents.get(parentId);
    if (!parent) continue;
    const away = Math.atan2(parent.y - cy, parent.x - cx);
    kids.forEach((kid, i) => {
      const spread = (i - (kids.length - 1) / 2) * 0.52;
      const angle = away + spread;
      const dist = parent.r + 68;
      const rawX = parent.x + Math.cos(angle) * dist;
      const rawY = parent.y + Math.sin(angle) * dist;
      placed.push({
        id: kid.id,
        x: Math.round(Math.max(58, Math.min(cx * 2 - 58, rawX))),
        y: Math.round(Math.max(44, Math.min(cy * 2 - 44, rawY))),
        r: Math.round(nodeRadius(kid.weight) * 0.65),
      });
    });
  }
  return placed;
}
