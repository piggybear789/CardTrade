/**
 * Coverage_Map types and the pure checks over them (e2e-ux-audit-suite).
 *
 * `tests/e2e/audit/coverage.ts` is the map itself: typed data listing every function
 * product.md describes and what tests it. This module supplies the types, reads the
 * list of product functions out of product.md's text, and checks the map against that
 * list and against the pathway ids the specs actually define.
 *
 * Pure: no file system, no Playwright, no environment. Callers read the files and pass
 * text and id lists in, so the `preflight` project, the unit guard over the real files
 * and the property tests all run the same functions.
 *
 * Requirements:
 * - Req 5.1: every function under "Features and functionality" and "Transaction models"
 *   is listed (`extractProductFunctions` + the `uncovered-function` problem).
 * - Req 5.2: each entry maps to happy and refusal Pathways, a written reason, or an
 *   Out_Of_Scope_Entry (`CoverageEntry`).
 * - Req 5.4: an entry with no pathway, no reason and no scope exclusion fails the run
 *   with a message naming it (`no-mapping`).
 * - Req 5.5: a function that cannot be automated describes its manual check
 *   (`manual-without-check`).
 * - Req 5.6: Google OAuth is an Out_Of_Scope_Entry (`kind: 'out-of-scope'`).
 */

/** Every functional area a Pathway or Coverage_Map entry belongs to. */
export const AREAS = [
  'auth',
  'onboarding',
  'catalog',
  'listings',
  'watchlist-sellers',
  'offers',
  'cash-sale',
  'cash-sale-disputes',
  'trades',
  'trade-disputes',
  'private-deals',
  'messaging',
  'notifications',
  'reviews-reports',
  'scam-reports',
  'trusted-sellers',
  'references',
  'profile-payouts',
  'admin',
  'jobs-webhooks',
  'marketing-errors',
  'guards',
  'surfaces',
  'journeys',
] as const;

/** A functional area of the audit suite. */
export type Area = (typeof AREAS)[number];

/** The fields every Coverage_Map entry carries, whatever its kind. */
export type CoverageEntryBase = {
  /** Stable dotted id, e.g. `cash-sale.pay`. Unique across the map. */
  id: string;
  area: Area;
  /** Member-facing name of the function. */
  function: string;
  /** The product.md heading (or numbered model name) this entry covers. */
  productSection: string;
  /** `tests/e2e/debug` probes this entry replaces (Req 3.3). */
  supersededProbes?: string[];
  /** Set when the function exists on one viewport only. */
  viewportOnly?: { viewport: 'desktop' | 'phone'; reason: string };
};

/** How an entry is tested, or why it is not (Req 5.2, 5.5, 5.6). */
export type CoverageMapping =
  | { kind: 'automated'; happy: string[]; refusal: string[] }
  | { kind: 'manual'; reason: string; manualCheck: string }
  | { kind: 'not-automated'; reason: string }
  | { kind: 'out-of-scope'; reason: string };

/** One Coverage_Map entry. */
export type CoverageEntry = CoverageEntryBase & CoverageMapping;

/** The kinds of defect `checkCoverageMap` reports. */
export type CoverageProblemCode =
  | 'uncovered-function'
  | 'no-mapping'
  | 'empty-happy'
  | 'empty-refusal'
  | 'manual-without-check'
  | 'unknown-pathway'
  | 'duplicate-id';

/** One defect in the Coverage_Map. `message` names the entry or function. */
export type CoverageProblem = {
  code: CoverageProblemCode;
  message: string;
  /** The entry at fault. Absent only for `uncovered-function`. */
  entryId?: string;
  /** The product function no entry names (`uncovered-function`). */
  productFunction?: string;
  /** The pathway id no spec defines (`unknown-pathway`). */
  pathwayId?: string;
};

const FEATURES_SECTION = 'Features and functionality';
const MODELS_SECTION = 'Transaction models';

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const NUMBERED_MODEL = /^\d+\.[ \t]+\*\*(.+?)\*\*/;
const FENCE = /^[ \t]{0,3}(```|~~~)/;

/**
 * Returns the product functions product.md describes, in document order (Req 5.1):
 * every `###` heading under "## Features and functionality", and every `###` heading
 * and numbered model (`1. **Cash Sale** — …`, unindented) under "## Transaction models".
 *
 * A section ends at the next `#` or `##` heading. Lines inside fenced code blocks are
 * ignored, so a heading quoted in an example is not read as a function. Repeated names
 * are returned once, at their first position.
 */
export function extractProductFunctions(productMd: string): string[] {
  const lines = productMd.split(/\r?\n/);
  const found: string[] = [];
  const seen = new Set<string>();
  let section: 'features' | 'models' | null = null;
  let inFence = false;

  const add = (name: string): void => {
    const trimmed = name.trim();
    if (trimmed === '' || seen.has(trimmed)) return;
    seen.add(trimmed);
    found.push(trimmed);
  };

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level <= 2) {
        section =
          level === 2 && text === FEATURES_SECTION
            ? 'features'
            : level === 2 && text === MODELS_SECTION
              ? 'models'
              : null;
        continue;
      }
      if (level === 3 && section !== null) add(text);
      continue;
    }

    if (section === 'models') {
      const model = NUMBERED_MODEL.exec(line);
      if (model) add(model[1]);
    }
  }

  return found;
}

const isBlank = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '';

/**
 * Checks the Coverage_Map and returns every defect, or an empty list (Req 5.1, 5.2,
 * 5.4, 5.5). Reported, in this order:
 *
 * - `duplicate-id`: an id used by more than one entry (once per id).
 * - per entry, in map order:
 *   - `no-mapping`: an automated entry with no happy and no refusal pathway, or any
 *     other kind with no written reason (Req 5.4);
 *   - `empty-happy` / `empty-refusal`: an automated entry with exactly one list empty;
 *   - `manual-without-check`: a manual entry with no manual check (Req 5.5);
 *   - `unknown-pathway`: a mapped pathway id not in `definedPathwayIds` (once per id
 *     per entry).
 * - `uncovered-function`: a product function no entry names as its `productSection`.
 *   An out-of-scope entry names its function as fully as any other.
 */
export function checkCoverageMap(
  entries: readonly CoverageEntry[],
  productFunctions: readonly string[],
  definedPathwayIds: readonly string[],
): CoverageProblem[] {
  const problems: CoverageProblem[] = [];
  const defined = new Set(definedPathwayIds);

  const idCounts = new Map<string, number>();
  for (const entry of entries) {
    idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      problems.push({
        code: 'duplicate-id',
        entryId: id,
        message: `Coverage_Map entry id "${id}" is used by ${count} entries.`,
      });
    }
  }

  for (const entry of entries) {
    problems.push(...checkEntry(entry, defined));
  }

  const named = new Set(entries.map((entry) => entry.productSection.trim()));
  const reported = new Set<string>();
  for (const fn of productFunctions) {
    const name = fn.trim();
    if (named.has(name) || reported.has(name)) continue;
    reported.add(name);
    problems.push({
      code: 'uncovered-function',
      productFunction: name,
      message: `Product function "${name}" has no Coverage_Map entry.`,
    });
  }

  return problems;
}

function checkEntry(entry: CoverageEntry, defined: ReadonlySet<string>): CoverageProblem[] {
  const id = entry.id;
  const noMapping: CoverageProblem = {
    code: 'no-mapping',
    entryId: id,
    message: `Coverage_Map entry "${id}" has no pathway, no written reason and no scope exclusion.`,
  };

  switch (entry.kind) {
    case 'automated': {
      const happy = Array.isArray(entry.happy) ? entry.happy : [];
      const refusal = Array.isArray(entry.refusal) ? entry.refusal : [];
      if (happy.length === 0 && refusal.length === 0) return [noMapping];

      const problems: CoverageProblem[] = [];
      if (happy.length === 0) {
        problems.push({
          code: 'empty-happy',
          entryId: id,
          message: `Coverage_Map entry "${id}" is automated but lists no happy-path pathway.`,
        });
      }
      if (refusal.length === 0) {
        problems.push({
          code: 'empty-refusal',
          entryId: id,
          message: `Coverage_Map entry "${id}" is automated but lists no refusal-path pathway.`,
        });
      }
      const unknown = new Set<string>();
      for (const pathwayId of [...happy, ...refusal]) {
        if (defined.has(pathwayId) || unknown.has(pathwayId)) continue;
        unknown.add(pathwayId);
        problems.push({
          code: 'unknown-pathway',
          entryId: id,
          pathwayId,
          message: `Coverage_Map entry "${id}" maps pathway "${pathwayId}", which no spec defines.`,
        });
      }
      return problems;
    }
    case 'manual': {
      const problems: CoverageProblem[] = [];
      if (isBlank(entry.reason)) problems.push(noMapping);
      if (isBlank(entry.manualCheck)) {
        problems.push({
          code: 'manual-without-check',
          entryId: id,
          message: `Coverage_Map entry "${id}" is manual but does not describe the manual check.`,
        });
      }
      return problems;
    }
    case 'not-automated':
    case 'out-of-scope':
      return isBlank(entry.reason) ? [noMapping] : [];
    default:
      // A kind outside the union (untyped data) maps the entry to nothing.
      return [noMapping];
  }
}
