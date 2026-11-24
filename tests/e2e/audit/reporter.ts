// tests/e2e/audit/reporter.ts
//
// THE AUDIT REPORTER: a Playwright reporter, added beside `html` and `list`, that turns
// one run into `audit-artifacts/runs/<runId>/manifest.json` for
// `scripts/e2e/audit-report.ts` to aggregate.
//
// For every test it keeps the LAST attempt (Playwright calls `onTestEnd` once per
// retry), reads that attempt's `audit-pathway` attachment (the scrubbed record the
// Pathway DSL attaches), and decides the Pathway's status from the record's steps,
// Playwright's own status and the retry count through `pathwayStatus`. A Pathway that
// passed only on a retry is `flaky`. A test tagged `@id:` that ended without a record
// (it was skipped before its body ran, or crashed before the DSL could attach) still
// gets a step-less record built from its tags, so it shows as skipped or failed rather
// than silently `not-run`. Tests with neither (setup and preflight projects, specs not
// yet on the DSL) are not Pathways and are left out.
//
// The manifest carries the run id, start time, git commit (`git rev-parse HEAD`),
// schema, servers and their payments mode, duration and the results. Every string in
// it passes through `scrubberFor` (secret env values, emails, client secrets, invite
// tokens, the run's legal names) before it is written. `leftInStripe`, which cleanup
// owns, is kept from any manifest already on disk for the run.
//
// After writing, run directories that this run has replaced for the same Pathway and
// viewport are deleted (`supersededRuns`), and only when this run wrote its own
// directory for that pair.
//
// Requirements:
//   29.5  the manifest lives at the run's grammar path and names every result by run,
//         Pathway and viewport
//   29.6  a newer run of a Pathway and viewport replaces older run directories for that
//         pair, and only those
//   32.1  nothing written contains a secret value
//   33.3  the run's date, commit, schema, payments modes and duration are recorded
//   34.3  a Pathway that passed only on retry is `flaky`

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

import { pathwayStatus, type PathwayDeclaration, type PathwayRecord, type RunManifest } from './core/aggregate';
import {
  ARTIFACT_ROOT,
  artifactPath,
  isPathwayId,
  isRunId,
  isViewport,
  parseArtifactPath,
  supersededRuns,
  type Viewport,
} from './core/artifactPaths';
import { AREAS, type Area } from './core/coverageMap';
import { scrubberFor } from './masker';
import { runId as currentRunId } from '../support/marker';

/** The attachment name the Pathway DSL uses for its record. */
export const PATHWAY_ATTACHMENT = 'audit-pathway';

/** The only schema the harness runs against; the config and preflight refuse any other. */
const HARNESS_SCHEMA = 'cardtrade_dev' as const;

/** The servers the config starts (design, "Servers"). Overridable through options. */
export const DEFAULT_SERVERS: RunManifest['servers'] = [
  { name: 'main', port: 3100, paymentsMode: 'stripe-test' },
  { name: 'aux', port: 3101, paymentsMode: 'mock' },
];

/** Options passed as `['./tests/e2e/audit/reporter.ts', { … }]` in the config. */
export interface AuditReporterOptions {
  /** Directory `audit-artifacts/` lives under. Defaults to the config file's directory. */
  outputRoot?: string;
  /** Servers and their payments mode. Defaults to `DEFAULT_SERVERS`. */
  servers?: RunManifest['servers'];
  /** Full legal names of the run's members, masked wherever they appear. */
  legalNames?: readonly string[];
  /** The run id. Defaults to `runId()` (`E2E_RUN_ID`, generated once when unset). */
  runId?: string;
  /** The git commit. Defaults to `git rev-parse HEAD`, or `unknown`. */
  commit?: string;
  /** Environment the scrubber reads secret values from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Delete run directories this run replaced (Req 29.6). Defaults to true. */
  pruneSuperseded?: boolean;
}

/** The fields of a test's final attempt the reporter needs, in plain data. */
export interface TestOutcome {
  title: string;
  projectName: string;
  tags: readonly string[];
  /** Playwright's status of the final attempt. */
  status: TestResult['status'];
  /** Playwright's retry index of the final attempt (0 = first run). */
  retry: number;
  /** The text of the final attempt's `audit-pathway` attachment, if any. */
  attachment?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** The viewport a project runs at: `phone` and `phone-aux` are phone, the rest desktop. */
export function viewportForProject(projectName: string): Viewport {
  return projectName === 'phone' || projectName.startsWith('phone-') ? 'phone' : 'desktop';
}

/** The value of the first `@<name>:<value>` tag, or undefined. */
function tagValue(tags: readonly string[], name: string): string | undefined {
  const prefix = `@${name}:`;
  const tag = tags.find((candidate) => candidate.startsWith(prefix));
  return tag === undefined ? undefined : tag.slice(prefix.length);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArea(value: unknown): value is Area {
  return typeof value === 'string' && (AREAS as readonly string[]).includes(value);
}

/**
 * Reads an `audit-pathway` attachment back into a record, or null when it is not one.
 * Strict on the fields the report keys on (id, area, viewport, steps), so a malformed
 * record is reported and replaced by a tag-built one rather than written as is.
 */
export function parsePathwayRecord(text: string): PathwayRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(value) || !isObject(value.declaration)) return null;
  const declaration = value.declaration;
  if (typeof declaration.id !== 'string' || !isPathwayId(declaration.id)) return null;
  if (!isArea(declaration.area) || typeof declaration.title !== 'string') return null;
  if (typeof value.viewport !== 'string' || !isViewport(value.viewport)) return null;
  if (!Array.isArray(value.steps) || !value.steps.every(isObject)) return null;
  const record = value as unknown as PathwayRecord;
  return {
    ...record,
    videos: Array.isArray(record.videos) ? record.videos : [],
    forced: Array.isArray(record.forced) ? record.forced : [],
    paymentsMode: record.paymentsMode === 'mock' ? 'mock' : 'stripe-test',
    simulated: record.steps.some((step) => step.kind === 'simulated' || step.simulated !== undefined),
  };
}

/** A step-less declaration built from the DSL's generated tags, or null without `@id:`/`@area:`. */
function declarationFromTags(outcome: TestOutcome): PathwayDeclaration | null {
  const id = tagValue(outcome.tags, 'id');
  const area = tagValue(outcome.tags, 'area');
  if (id === undefined || !isPathwayId(id) || !isArea(area)) return null;
  const aux = outcome.tags.includes('@aux');
  return {
    id,
    title: outcome.title,
    area,
    kind: tagValue(outcome.tags, 'kind') === 'refusal' ? 'refusal' : 'happy',
    provider: aux ? 'mock' : 'stripe',
    members: {},
    viewports: 'both',
    ...(outcome.tags.includes('@isolated') ? { isolated: true } : {}),
  };
}

/**
 * The Pathway record for one test's final attempt, or null when the test is not a
 * Pathway. The status combines the record's steps (a failed step or an unsuppressed
 * blocking observation fails it), Playwright's status (a failed, timed-out or
 * interrupted attempt fails it whatever the steps say, since the throw may have come
 * after the last step) and the retry count (a pass on retry is `flaky`).
 */
export function recordForOutcome(outcome: TestOutcome, runId: string): PathwayRecord | null {
  const attached = outcome.attachment === undefined ? null : parsePathwayRecord(outcome.attachment);
  let record: PathwayRecord;
  if (attached) {
    record = { ...attached, runId: isRunId(attached.runId) ? attached.runId : runId };
  } else {
    const declaration = declarationFromTags(outcome);
    if (declaration === null) return null;
    record = {
      declaration,
      viewport: viewportForProject(outcome.projectName),
      runId,
      status: 'failed',
      retries: 0,
      steps: [],
      videos: [],
      forced: [],
      paymentsMode: declaration.provider === 'mock' ? 'mock' : 'stripe-test',
      simulated: false,
    };
  }

  const playwrightFailed =
    outcome.status === 'failed' || outcome.status === 'timedOut' || outcome.status === 'interrupted';
  const status = playwrightFailed
    ? 'failed'
    : pathwayStatus({
      steps: record.steps,
      retries: outcome.retry,
      suppressions: record.declaration.suppress,
      skipped: outcome.status === 'skipped',
    });
  return { ...record, status, retries: outcome.retry };
}

/** Applies `scrub` to every string in a JSON value, keys included. */
export function scrubDeep<T>(value: T, scrub: (text: string) => string): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return scrub(node);
    if (Array.isArray(node)) return node.map(walk);
    if (isObject(node)) {
      return Object.fromEntries(Object.entries(node).map(([key, child]) => [scrub(key), walk(child)]));
    }
    return node;
  };
  return walk(value) as T;
}

/** Results in a stable order: Pathway id, then viewport. */
function byPathwayAndViewport(a: PathwayRecord, b: PathwayRecord): number {
  const id = a.declaration.id.localeCompare(b.declaration.id);
  return id !== 0 ? id : a.viewport.localeCompare(b.viewport);
}

/** What `buildManifest` needs besides the outcomes. */
export interface ManifestInput {
  runId: string;
  startedAt: Date;
  durationMs: number;
  commit: string;
  servers: RunManifest['servers'];
  leftInStripe?: RunManifest['leftInStripe'];
}

/**
 * The run manifest for a set of final attempts. When two tests report the same
 * Pathway and viewport, the later one in `outcomes` wins, matching `aggregateRun`.
 * Not scrubbed; `AuditReporter` scrubs before writing.
 */
export function buildManifest(outcomes: readonly TestOutcome[], input: ManifestInput): RunManifest {
  const byKey = new Map<string, PathwayRecord>();
  for (const outcome of outcomes) {
    const record = recordForOutcome(outcome, input.runId);
    if (record) byKey.set(`${record.declaration.id}\u0000${record.viewport}`, record);
  }
  return {
    runId: input.runId,
    startedAt: input.startedAt.toISOString(),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    commit: input.commit,
    schema: HARNESS_SCHEMA,
    servers: input.servers.map((server) => ({ ...server })),
    results: [...byKey.values()].sort(byPathwayAndViewport),
    leftInStripe: [...(input.leftInStripe ?? [])],
  };
}

// ---------------------------------------------------------------------------
// The reporter
// ---------------------------------------------------------------------------

function gitCommit(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function attachmentText(result: TestResult): string | undefined {
  const attachment = [...result.attachments].reverse().find((candidate) => candidate.name === PATHWAY_ATTACHMENT);
  if (!attachment) return undefined;
  if (attachment.body) return attachment.body.toString('utf8');
  if (attachment.path && existsSync(attachment.path)) return readFileSync(attachment.path, 'utf8');
  return undefined;
}

async function readLeftInStripe(file: string): Promise<RunManifest['leftInStripe']> {
  try {
    const existing: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    return isObject(existing) && Array.isArray(existing.leftInStripe)
      ? (existing.leftInStripe as RunManifest['leftInStripe'])
      : [];
  } catch {
    return [];
  }
}

async function listDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** The Playwright reporter. Default export, as Playwright loads reporters by path. */
export default class AuditReporter implements Reporter {
  private readonly options: AuditReporterOptions;
  private readonly runId: string;
  private readonly scrub: (text: string) => string;
  private root = process.cwd();
  private startedAt = new Date();
  /** Final attempt per test id, in the order tests first finished. */
  private readonly outcomes = new Map<string, TestOutcome>();

  constructor(options: AuditReporterOptions = {}) {
    this.options = options;
    this.runId = options.runId ?? currentRunId();
    if (!isRunId(this.runId)) throw new Error('audit reporter: the run id is not a valid run id.');
    this.scrub = scrubberFor(options.env ?? process.env, { legalNames: options.legalNames ?? [] });
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, _suite: Suite): void {
    this.root = this.options.outputRoot
      ?? (config.configFile ? path.dirname(config.configFile) : config.rootDir);
    this.startedAt = new Date();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const previous = this.outcomes.get(test.id);
    if (previous && previous.retry > result.retry) return;
    const attachment = attachmentText(result);
    this.outcomes.set(test.id, {
      title: test.title,
      projectName: test.parent.project()?.name ?? '',
      tags: test.tags,
      status: result.status,
      retry: result.retry,
      attachment,
    });
    if (attachment !== undefined) this.copyTrace(test.title, attachment, result);
  }

  /**
   * Copies Playwright's own trace to the record's `tracePath` (Req 6.4). The DSL names
   * the path when a step failed, but the runner only writes the trace after the test
   * ends, so the copy happens here. Only a path the grammar names as a trace is written.
   */
  private copyTrace(title: string, attachment: string, result: TestResult): void {
    const record = parsePathwayRecord(attachment);
    const target = record?.tracePath;
    if (!target || parseArtifactPath(target)?.kind !== 'trace') return;
    const trace = result.attachments.find((candidate) => candidate.name === 'trace' && candidate.path);
    if (!trace?.path || !existsSync(trace.path)) return;
    try {
      const file = path.join(this.root, ...target.split('/'));
      mkdirSync(path.dirname(file), { recursive: true });
      copyFileSync(trace.path, file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(this.scrub(`audit reporter: could not copy the trace for "${title}" to ${target}: ${message}`));
    }
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    try {
      const file = path.join(this.root, ...artifactPath({ kind: 'manifest', runId: this.runId }).split('/'));
      const outcomes = [...this.outcomes.values()];
      for (const outcome of outcomes) {
        if (outcome.attachment !== undefined && parsePathwayRecord(outcome.attachment) === null) {
          console.warn(this.scrub(`audit reporter: unreadable ${PATHWAY_ATTACHMENT} record for "${outcome.title}" (${outcome.projectName}).`));
        }
      }
      const manifest = scrubDeep(
        buildManifest(outcomes, {
          runId: this.runId,
          startedAt: result.startTime ?? this.startedAt,
          durationMs: result.duration,
          commit: this.options.commit ?? gitCommit(this.root),
          servers: this.options.servers ?? DEFAULT_SERVERS,
          leftInStripe: await readLeftInStripe(file),
        }),
        this.scrub,
      );

      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await fs.rename(temp, file);

      if (this.options.pruneSuperseded !== false) await this.pruneSuperseded(manifest.results);

      console.log(`audit reporter: ${manifest.results.length} Pathway result(s) in ${path.relative(process.cwd(), file) || file}`);
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(this.scrub(`audit reporter: could not write the run manifest: ${message}`));
      return { status: 'failed' };
    }
  }

  /** Deletes run directories this run replaced (Req 29.6), and nothing else. */
  private async pruneSuperseded(results: readonly PathwayRecord[]): Promise<void> {
    const pairs = new Map<string, { pathwayId: string; viewport: Viewport }>();
    for (const record of results) {
      pairs.set(`${record.declaration.id}/${record.viewport}`, { pathwayId: record.declaration.id, viewport: record.viewport });
    }
    for (const { pathwayId, viewport } of pairs.values()) {
      const parent = [ARTIFACT_ROOT, pathwayId, viewport].join('/');
      const runs = await listDirectories(path.join(this.root, ARTIFACT_ROOT, pathwayId, viewport));
      if (!runs.includes(this.runId)) continue;
      for (const stale of supersededRuns(runs.map((run) => `${parent}/${run}`), pathwayId, viewport)) {
        await fs.rm(path.join(this.root, ...stale.split('/')), { recursive: true, force: true });
      }
    }
  }
}
