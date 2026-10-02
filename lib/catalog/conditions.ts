// The condition scale every listing, trade card and catalog filter shares.
//
// TCGplayer's scale for singles — Near Mint, Lightly Played, Moderately Played, Heavily
// Played, Damaged — because it is the one collectors already price against. Near Mint is
// the top of it: there is no Mint grade. Graded and Unopened sit outside the scale as
// their own buckets, since a slab's grade is on its label and sealed product has no wear
// to grade.
export const ITEM_CONDITIONS = [
  'Graded',
  'Unopened',
  'Near Mint',
  'Lightly Played',
  'Moderately Played',
  'Heavily Played',
  'Damaged',
] as const;

export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export function isItemCondition(value: unknown): value is ItemCondition {
  return typeof value === 'string' && (ITEM_CONDITIONS as readonly string[]).includes(value);
}

/**
 * Grades that have left the scale, and the grade that replaced each. Migration 0125
 * rewrote stored listings the same way; this carries the mapping to old links and to
 * app builds that still send the retired value.
 */
const RETIRED_CONDITIONS = new Map<string, ItemCondition>([['Mint', 'Near Mint']]);

/**
 * Clean a condition filter that arrived from a URL or an API caller.
 *
 * Unknown values are DROPPED rather than passed through. A value the rail does not offer
 * still filters the catalog, but no control on screen represents it, so nothing can be
 * unticked and the grid reads as empty for a reason the member cannot see.
 */
export function normalizeConditionFilter(values: readonly string[]): ItemCondition[] {
  const conditions = new Set<ItemCondition>();
  for (const raw of values) {
    const value = raw.trim();
    const condition = isItemCondition(value) ? value : RETIRED_CONDITIONS.get(value);
    if (condition) conditions.add(condition);
  }
  return [...conditions];
}
