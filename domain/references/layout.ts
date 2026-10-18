// domain/references/layout.ts
//
// Deterministic radial layout for the reference graph. Ring 1 sits on a
// circle around the centre node, ring 2 around each ring-1 node. Positions
// are a pure function of the (already ranked) input, so server and client
// agree and the graph never jumps between renders. No force simulation:
// at this scale a calm, stable layout reads better than physics.
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
  return Math.round(Math.min(38, Math.max(14, 14 + Math.sqrt(w) * 4.2)));
}

const TAU = Math.PI * 2;

/**
 * Place ring-1 nodes around (`cx`, `cy`). The first (strongest) node starts
 * at the upper-left and the rest proceed clockwise, alternating sides so the
 * two strongest do not sit next to each other.
 */
export function layoutRing(
  nodes: GraphLayoutNodeInput[],
  cx: number,
  cy: number,
  ringRadius: number,
): PlacedNode[] {
  const count = nodes.length;
  if (count === 0) return [];
  const start = Math.PI * 0.78; // upper-left
  return nodes.map((node, i) => {
    // Spread evenly, but nudge alternating nodes a little further out so
    // labels on neighbours do not collide at small counts.
    const angle = start + (i / count) * TAU;
    const radius = ringRadius * (i % 2 === 1 ? 1.1 : 0.96);
    return {
      id: node.id,
      x: Math.round(cx + Math.cos(angle) * radius),
      y: Math.round(cy + Math.sin(angle) * radius * 0.82),
      r: nodeRadius(node.weight),
    };
  });
}

/** Place ring-2 nodes on a small arc behind their parent, away from centre. */
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
      const spread = (i - (kids.length - 1) / 2) * 0.62;
      const angle = away + spread;
      const dist = parent.r + 52;
      placed.push({
        id: kid.id,
        x: Math.round(parent.x + Math.cos(angle) * dist),
        y: Math.round(parent.y + Math.sin(angle) * dist),
        r: Math.round(nodeRadius(kid.weight) * 0.62),
      });
    });
  }
  return placed;
}
