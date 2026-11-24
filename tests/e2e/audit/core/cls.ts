// tests/e2e/audit/core/cls.ts
//
// THE LAYOUT SHIFT RULES for the e2e UX audit suite. Pure: no Playwright, no DOM, no I/O.
// The in-page collector (`audit/ux/cls.ts`, a `PerformanceObserver('layout-shift')` reset
// per step) records each shift's value and `hadRecentInput`, the nodes it moved, and the
// block containers of the nodes mutated in the 500 ms before it. This module sums the
// shifts and decides which moved nodes lay outside the arriving data's own region.
//
// The rule comes from structure.md: "Arriving data must not move anything outside its
// own region." A region that grows may move itself and its ancestors (they contain it);
// a sibling pushed down by it, a header nudged by a late badge, or a footer shoved by a
// list that arrived above it has been moved by data that was not its own.
//
// Requirements:
//   30.1  a step's cumulative layout shift is recorded, with a UX_Observation when it
//         exceeds 0.1, or when an element outside the arriving data's region moves
//
// Severity and suppressions are the caller's business (`uxPolicy.ts`); both checks
// default to advisory.

/** The cumulative layout shift above which a step is reported (Web Vitals' "good" bound). */
export const CLS_THRESHOLD = 0.1;

/** How far before a shift the collector looks for the mutation that caused it, in ms. */
export const MUTATION_WINDOW_MS = 500;

/**
 * A node in the page, located by its child-index path from `document.documentElement`
 * (`[1, 0, 3]` is the fourth child of the first child of `<body>`). Paths make "inside"
 * and "ancestor of" a prefix test, so this module needs no DOM.
 */
export interface NodeRef {
  path: readonly number[];
  /** A short human description (`main > section.listing-grid`) for the report. */
  label: string;
}

/** One `layout-shift` entry, as the collector reports it. */
export interface LayoutShiftEntry {
  /** The entry's `value`: finite and not negative. */
  value: number;
  /** True when the shift followed user input; such shifts are excluded (Req 30.1). */
  hadRecentInput: boolean;
  /** `startTime`, in ms; informational. */
  startTime?: number;
  /** The nodes the shift moved (`entry.sources[].node`). */
  sources?: readonly NodeRef[];
  /** Block containers of the nodes mutated in the `MUTATION_WINDOW_MS` before the shift. */
  mutatedRegions?: readonly NodeRef[];
}

/** One layout-shift problem. The caller adds member, URL and severity. */
export interface ClsObservation {
  check: 'cls' | 'shift-outside-region';
  message: string;
  detail?: Record<string, string | number>;
}

/** The result of `summariseShifts`. */
export interface ShiftSummary {
  /** Sum of the values of the entries without recent input. */
  total: number;
  /** How many entries counted toward `total`. */
  counted: number;
  /** An observation when `total` exceeds the threshold, else null. */
  observation: ClsObservation | null;
}

function assertValue(entry: LayoutShiftEntry): void {
  if (!Number.isFinite(entry.value) || entry.value < 0) {
    throw new RangeError(`layout-shift value must be finite and not negative, got ${entry.value}`);
  }
}

/**
 * Sums a step's layout shifts (Req 30.1). Entries with `hadRecentInput` are skipped, so
 * adding them anywhere never changes the result; the rest are summed in input order. An
 * observation is produced exactly when the sum exceeds `threshold` (default 0.1).
 * Throws on a non-finite or negative value, which no real observer reports.
 */
export function summariseShifts(
  entries: readonly LayoutShiftEntry[],
  threshold: number = CLS_THRESHOLD,
): ShiftSummary {
  let total = 0;
  let counted = 0;
  for (const entry of entries) {
    assertValue(entry);
    if (entry.hadRecentInput) continue;
    total += entry.value;
    counted += 1;
  }
  const observation: ClsObservation | null =
    total > threshold
      ? {
          check: 'cls',
          message:
            `Cumulative layout shift ${total.toFixed(3)} exceeds ${threshold} ` +
            `(${counted} shift${counted === 1 ? '' : 's'} without recent input).`,
          detail: { cls: Number(total.toFixed(4)), threshold, shifts: counted },
        }
      : null;
  return { total, counted, observation };
}

/** True when `prefix` is a (not necessarily proper) prefix of `path`. */
function isPrefix(prefix: readonly number[], path: readonly number[]): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix[i] !== path[i]) return false;
  }
  return true;
}

/**
 * True when `node` is inside `region` or is `region` itself, or is an ancestor of it.
 * Either way the node's movement is the region's own growth.
 */
export function withinRegion(node: NodeRef, region: NodeRef): boolean {
  return isPrefix(region.path, node.path) || isPrefix(node.path, region.path);
}

/**
 * The nodes one shift moved that lay outside every mutated region (Req 30.1): each is
 * neither inside nor an ancestor of any mutated node's block container. With no mutated
 * region at all, nothing arrived that could own the shift, so every moved node is
 * returned. An entry with `hadRecentInput` returns nothing: the member caused it.
 * Order follows `entry.sources`; duplicates (same path) are reported once.
 */
export function shiftOutsideRegion(entry: LayoutShiftEntry): NodeRef[] {
  if (entry.hadRecentInput) return [];
  const regions = entry.mutatedRegions ?? [];
  const seen = new Set<string>();
  const outside: NodeRef[] = [];
  for (const node of entry.sources ?? []) {
    const key = node.path.join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    if (!regions.some((region) => withinRegion(node, region))) outside.push(node);
  }
  return outside;
}

/**
 * One `shift-outside-region` observation per shift that moved a node outside the
 * arriving data's region, in input order. An empty array means the step passes.
 */
export function shiftOutsideRegionFindings(entries: readonly LayoutShiftEntry[]): ClsObservation[] {
  const findings: ClsObservation[] = [];
  for (const entry of entries) {
    assertValue(entry);
    const outside = shiftOutsideRegion(entry);
    if (outside.length === 0) continue;
    const regions = (entry.mutatedRegions ?? []).map((region) => region.label);
    const moved = outside.map((node) => node.label);
    findings.push({
      check: 'shift-outside-region',
      message:
        regions.length === 0
          ? `Layout shifted ${moved.join(', ')} with no data arriving in the ` +
            `${MUTATION_WINDOW_MS} ms before it.`
          : `Data arriving in ${regions.join(', ')} moved ${moved.join(', ')}, outside its own region.`,
      detail: {
        value: Number(entry.value.toFixed(4)),
        moved: moved.join(' | '),
        regions: regions.join(' | '),
      },
    });
  }
  return findings;
}
