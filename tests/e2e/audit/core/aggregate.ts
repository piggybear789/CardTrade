// tests/e2e/audit/core/aggregate.ts
//
// RUN AGGREGATION for the e2e UX audit suite, and the canonical record types the
// reporter writes and the report generator reads. Pure: no I/O, no Playwright, no
// `node:fs`. The Pathway DSL builds its step list with `buildStepRecords`, the reporter
// decides a Pathway's status with `pathwayStatus`, and `scripts/e2e/audit-report.ts`
// hands the newest manifest, the pathway universe and the Coverage_Map to `aggregateRun`.
//
// Requirements:
//   4.7   a simulated step carries its mechanism, and no other step does
//   5.3, 5.6  each Coverage_Map entry has a status per viewport; manual, not-automated
//         and out-of-scope entries keep their kind whatever ran
//   6.2   every Pathway is an ordered list of named steps, indexed 1..n in call order
//   6.4   a failed step fails its Pathway
//   30.8  an unsuppressed blocking observation fails its Pathway
//   33.1  Pathways are grouped by area with a status per viewport, a simulated label and
//         an observation count
//   33.4  the Coverage_Map is shown with each function's status
//   33.6  a universe Pathway with no result in this run is `not-run`
//   34.3  a Pathway that passed only on retry is `flaky`
//
// The input types in `findings.ts` (`FindingPathway`) and `html.ts`
// (`ReportPathwayRecord`, `ReportRun`) are structural subsets of the types here, so the
// records and the aggregated run pass to them unchanged.

import { VIEWPORTS, type Viewport } from './artifactPaths';
import type { Area, CoverageEntry } from './coverageMap';
import { applySuppressions, isFailingObservation, type Observation, type Suppression } from './uxPolicy';

/** How a simulated step stood in for a real event (design: `SimMechanism`). */
export const SIM_MECHANISMS = ['mock-provider', 'signed-fixture', 'moved-timestamp'] as const;

/** How a simulated step stood in for a real event. */
export type SimMechanism = (typeof SIM_MECHANISMS)[number];

/** A Pathway as declared in its spec (design: `PathwayDeclaration`). */
export interface PathwayDeclaration {
  /** `/^[a-z0-9-]+(\.[a-z0-9-]+)+$/`, unique across the suite. */
  id: string;
  title: string;
  area: Area;
  kind: 'happy' | 'refusal';
  provider: 'stripe' | 'mock';
  /** Required when `provider` is `mock`. */
  mockReason?: string;
  /**
   * Member label to seed user, persona spec or `'guest'`. Typed loosely here because the
   * seed and persona types live in the Playwright half; the DSL narrows it.
   */
  members: Record<string, unknown>;
  viewports: 'both' | { only: Viewport; reason: string };
  isolated?: boolean;
  requiresSeed?: string[];
  suppress?: Suppression[];
  /** e.g. `F21`. */
  knownFindings?: string[];
}

/** One step of a Pathway (design: `StepRecord`). */
export interface StepRecord {
  /** 1-based and dense. */
  index: number;
  name: string;
  kind: 'action' | 'assert' | 'arrange' | 'simulated';
  /** Present exactly when `kind` is `simulated` (Req 4.7). */
  simulated?: { mechanism: SimMechanism; reason?: string };
  members: string[];
  status: 'passed' | 'failed' | 'skipped';
  startedAt: string;
  durationMs: number;
  screenshots: Array<{ member: string; path: string }>;
  observations: Observation[];
  /** Scrubbed. */
  error?: string;
}

/** One Pathway's result on one viewport (design: `PathwayRecord`). */
export interface PathwayRecord {
  declaration: PathwayDeclaration;
  viewport: Viewport;
  runId: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped';
  retries: number;
  steps: StepRecord[];
  videos: Array<{ member: string; path: string; masked: boolean }>;
  forced: Array<{ step: number; locator: string; reason: string }>;
  tracePath?: string;
  paymentsMode: 'stripe-test' | 'mock';
  /** True iff any step is simulated. */
  simulated: boolean;
}

/** One run's manifest, written by the reporter (design: `RunManifest`). */
export interface RunManifest {
  /** e.g. `2026-12-01T09-30-00Z-a1b2c3d`. */
  runId: string;
  startedAt: string;
  durationMs: number;
  commit: string;
  schema: 'cardtrade_dev';
  servers: Array<{ name: 'main' | 'aux'; port: number; paymentsMode: string }>;
  results: PathwayRecord[];
  leftInStripe: Array<{ type: string; id: string; reason: string }>;
}

/** A Pathway's status for one viewport in a run (design: `PathwayStatus`). */
export type PathwayStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'not-run';

/** Every Pathway status, in the order the totals list them. */
export const PATHWAY_STATUS_ORDER: readonly PathwayStatus[] = ['passed', 'failed', 'flaky', 'skipped', 'not-run'];

/** A Coverage_Map entry's status for one viewport (design: `CoverageStatus`). */
export type CoverageStatus =
  | 'passing' | 'failing' | 'partly-run' | 'not-run'
  | 'manual' | 'not-automated' | 'out-of-scope';

/** One Pathway in the aggregated run. */
export interface AggregatedPathway {
  id: string;
  area: Area;
  byViewport: Record<Viewport, PathwayStatus>;
  /** True iff at least one recorded step, on any viewport, is simulated. */
  simulated: boolean;
  /** Every observation on every recorded step, suppressed ones included. */
  observationCount: number;
}

/** A run aggregated over the pathway universe (design: `AggregatedRun`). */
export interface AggregatedRun {
  manifest: Omit<RunManifest, 'results'>;
  totals: Record<PathwayStatus, number>;
  pathways: AggregatedPathway[];
  coverage: Array<{ entry: CoverageEntry; byViewport: Record<Viewport, CoverageStatus> }>;
  /**
   * Results whose Pathway is not in the universe. They are left out of the totals so the
   * totals stay universe size times viewport count, and listed here so they are not lost.
   */
  unmatchedResults: Array<{ id: string; viewport: Viewport }>;
}

/** A Pathway the specs define: its id and area. A full declaration satisfies it. */
export interface UniversePathway {
  id: string;
  area: Area;
}

// ---------------------------------------------------------------------------------------
// Step records
// ---------------------------------------------------------------------------------------

/** A step as the DSL captured it, before it is numbered. */
export type StepDraft = Omit<StepRecord, 'index'>;

/**
 * Numbers a Pathway's steps 1..n in call order (Req 6.2) and keeps `simulated` on
 * simulated steps only (Req 4.7): a `simulated` step must carry a known mechanism, and
 * the field is removed from every other kind. Inputs are not mutated.
 *
 * @throws when a `simulated` step has no mechanism or an unknown one: the DSL's
 *   `simulated()` primitive always supplies one, so its absence is a recorder bug.
 */
export function buildStepRecords(drafts: readonly StepDraft[]): StepRecord[] {
  return drafts.map((draft, position) => {
    const { simulated, ...rest } = draft;
    const record: StepRecord = { ...rest, index: position + 1 };
    if (draft.kind === 'simulated') {
      if (!simulated || !(SIM_MECHANISMS as readonly string[]).includes(simulated.mechanism)) {
        throw new Error(`buildStepRecords: simulated step "${draft.name}" has no valid mechanism.`);
      }
      record.simulated = simulated.reason === undefined
        ? { mechanism: simulated.mechanism }
        : { mechanism: simulated.mechanism, reason: simulated.reason };
    }
    return record;
  });
}

// ---------------------------------------------------------------------------------------
// Pathway status
// ---------------------------------------------------------------------------------------

/** What decides one Pathway's status on one viewport. */
export interface PathwayStatusInput {
  steps: readonly Pick<StepRecord, 'status' | 'observations'>[];
  /** How many times Playwright retried the test before this result. */
  retries: number;
  /** The Pathway's declared suppressions, applied before observations are judged. */
  suppressions?: readonly Suppression[];
  /** True when Playwright skipped the test (e.g. a viewport the Pathway does not run on). */
  skipped?: boolean;
}

/**
 * A Pathway's status on one viewport. `failed` when any step failed or any blocking
 * observation is left unsuppressed (Req 6.4, 30.8); otherwise `skipped` when Playwright
 * skipped it; otherwise `flaky` when it passed after one or more retries (Req 34.3) and
 * `passed` when it passed first time.
 */
export function pathwayStatus(input: PathwayStatusInput): Exclude<PathwayStatus, 'not-run'> {
  const failed = input.steps.some(
    (step) =>
      step.status === 'failed' ||
      applySuppressions(step.observations, input.suppressions).some(isFailingObservation),
  );
  if (failed) return 'failed';
  if (input.skipped) return 'skipped';
  return input.retries > 0 ? 'flaky' : 'passed';
}

// ---------------------------------------------------------------------------------------
// Coverage status
// ---------------------------------------------------------------------------------------

/** A Pathway's status on a viewport in this run; `not-run` when it has no result. */
export type PathwayStatusLookup = (pathwayId: string, viewport: Viewport) => PathwayStatus;

/**
 * A Coverage_Map entry's status on one viewport (Req 5.3, 5.6, 33.4). A manual,
 * not-automated or out-of-scope entry has that status whatever ran. An automated entry,
 * over its happy and refusal Pathways together, is `failing` when any failed, `passing`
 * when every one passed or was flaky, `partly-run` when some passed or were flaky and
 * none failed, and `not-run` when none passed, failed or was flaky (a skipped Pathway did
 * not run).
 */
export function coverageStatus(
  entry: CoverageEntry,
  viewport: Viewport,
  statusOf: PathwayStatusLookup,
): CoverageStatus {
  if (entry.kind !== 'automated') return entry.kind;
  const ids = [...new Set([...entry.happy, ...entry.refusal])];
  const statuses = ids.map((id) => statusOf(id, viewport));
  if (statuses.some((status) => status === 'failed')) return 'failing';
  const ran = statuses.filter((status) => status === 'passed' || status === 'flaky').length;
  if (ran === 0) return 'not-run';
  return ran === statuses.length ? 'passing' : 'partly-run';
}

// ---------------------------------------------------------------------------------------
// Run aggregation
// ---------------------------------------------------------------------------------------

function emptyTotals(): Record<PathwayStatus, number> {
  return { passed: 0, failed: 0, flaky: 0, skipped: 0, 'not-run': 0 };
}

function viewportRecord<T>(value: (viewport: Viewport) => T): Record<Viewport, T> {
  return Object.fromEntries(VIEWPORTS.map((viewport) => [viewport, value(viewport)])) as Record<Viewport, T>;
}

/**
 * Aggregates one run over the pathway universe (Req 33.1, 33.4, 33.6). Every universe
 * Pathway appears exactly once, in universe order (a repeated id is listed at its first
 * occurrence, under that occurrence's area), with a status per viewport taken from its
 * result, or `not-run` when it has none. When a Pathway has two results for one viewport
 * the later one wins. Totals count each Pathway and viewport once, so they sum to the
 * universe size times the viewport count. A Pathway is simulated iff any of its recorded
 * steps is simulated, and its observation count includes suppressed observations.
 */
export function aggregateRun(
  manifest: RunManifest,
  universe: readonly UniversePathway[],
  coverageMap: readonly CoverageEntry[] = [],
): AggregatedRun {
  const { results, ...header } = manifest;

  const pathwaysById = new Map<string, UniversePathway>();
  for (const pathway of universe) {
    if (!pathwaysById.has(pathway.id)) pathwaysById.set(pathway.id, pathway);
  }

  const resultFor = new Map<string, Partial<Record<Viewport, PathwayRecord>>>();
  const unmatchedResults: AggregatedRun['unmatchedResults'] = [];
  for (const record of results) {
    const id = record.declaration.id;
    if (!pathwaysById.has(id)) {
      unmatchedResults.push({ id, viewport: record.viewport });
      continue;
    }
    const byViewport = resultFor.get(id) ?? {};
    byViewport[record.viewport] = record;
    resultFor.set(id, byViewport);
  }

  const totals = emptyTotals();
  const pathways: AggregatedPathway[] = [];
  for (const { id, area } of pathwaysById.values()) {
    const recorded = resultFor.get(id) ?? {};
    const byViewport = viewportRecord<PathwayStatus>((viewport) => recorded[viewport]?.status ?? 'not-run');
    for (const viewport of VIEWPORTS) totals[byViewport[viewport]] += 1;
    const steps = VIEWPORTS.flatMap((viewport) => recorded[viewport]?.steps ?? []);
    pathways.push({
      id,
      area,
      byViewport,
      simulated: steps.some((step) => step.kind === 'simulated' || step.simulated !== undefined),
      observationCount: steps.reduce((sum, step) => sum + step.observations.length, 0),
    });
  }

  const statusById = new Map(pathways.map((pathway) => [pathway.id, pathway.byViewport]));
  const statusOf: PathwayStatusLookup = (pathwayId, viewport) =>
    statusById.get(pathwayId)?.[viewport] ?? 'not-run';

  const coverage = coverageMap.map((entry) => ({
    entry,
    byViewport: viewportRecord<CoverageStatus>((viewport) => coverageStatus(entry, viewport, statusOf)),
  }));

  return { manifest: header, totals, pathways, coverage, unmatchedResults };
}
