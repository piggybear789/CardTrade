// lib/references/ranking.ts
//
// How the `/references` landing ranks people (0155). Read by the list under the search
// (`ReferenceSearch`, a client component) and by the faces around it (`ReferenceOrbit`,
// rendered on the server), so the two always agree on who the top rows are and the faces
// never repeat them. Keep this module free of server imports: the client reads it too.

/** Rows the "Most referenced" list shows under the search, and the most a search shows. */
export const MOST_REFERENCED_ROWS = 3;

/**
 * Most people vouching first; ties by handle.
 *
 * The tie-break compares code units rather than using `localeCompare`, because the server
 * and the browser can have different default locales, and the faces (ranked on the
 * server) have to skip exactly the rows the list (ranked in the browser) shows.
 */
export function byMostReferenced(
  a: { referenceCount: number; handle: string },
  b: { referenceCount: number; handle: string },
): number {
  if (a.referenceCount !== b.referenceCount) return b.referenceCount - a.referenceCount;
  return a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0;
}
