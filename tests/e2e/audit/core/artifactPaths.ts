// tests/e2e/audit/core/artifactPaths.ts
//
// ARTIFACT PATHS AND STORAGE UPLOAD URLS for the e2e UX audit suite. Pure: no I/O, no
// `node:fs`, no `node:path`, no Playwright. The fixtures, the reporter and the report
// script build every artifact path here, and the cleanup step asks this module which
// run directories a newer run has replaced.
//
// Requirements:
//   2.4   a page's write to `/storage/v1/object/<bucket>/<path>` becomes an upload
//         ledger entry (bucket, path) that cleanup can delete; any other URL gives
//         nothing, so the ledger never names an object the run did not upload
//   29.5  every artifact path identifies the run, the Pathway, the viewport, the step
//         index and the member, and parses back to exactly those components
//   29.6  a newer run of the same Pathway and viewport replaces older run directories
//         for that pair, and only those
//
// Path grammar (design, "Artifact path grammar"):
//
//   audit-artifacts/<pathwayId>/<viewport>/<runId>/step-<NN>.<member>.png
//   audit-artifacts/<pathwayId>/<viewport>/<runId>/video.<member>.<n>.webm
//   audit-artifacts/<pathwayId>/<viewport>/<runId>/trace.zip
//   audit-artifacts/<pathwayId>/<viewport>/<runId>/console.<member>.jsonl
//   audit-artifacts/runs/<runId>/manifest.json
//   audit-artifacts/.uploads/<runId>.jsonl
//
// Member labels match `/^[a-z][a-z0-9-]*$/`, so a `.` never appears inside a file-name
// part. A Pathway id always contains a `.` and never starts with one, so it cannot be
// mistaken for `runs` or `.uploads`.

/** The root directory every artifact lives under, relative to the repo. */
export const ARTIFACT_ROOT = 'audit-artifacts';

/** The directory holding one manifest per run. */
export const RUNS_DIR = 'runs';

/** The directory holding one upload ledger per run. */
export const UPLOADS_DIR = '.uploads';

/** Viewport profiles, one Playwright project each. */
export type Viewport = 'desktop' | 'phone';

/** Every viewport, in report order. */
export const VIEWPORTS: readonly Viewport[] = ['desktop', 'phone'];

/** Pathway ids: dotted lowercase segments, e.g. `journeys.cash-sale-lifecycle`. */
export const PATHWAY_ID_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Member labels: one lowercase word, hyphens allowed, never a `.`. */
export const MEMBER_LABEL_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Run ids: a UTC timestamp with `-` for `:`, then a suffix, e.g.
 * `2026-12-01T09-30-00Z-a1b2c3d`. The timestamp is fixed width, so comparing two run
 * ids as strings orders them by start time, which is what "older" means here.
 */
export const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[a-z0-9]+$/;

/** One artifact, as its components. `step` is 1-based; `n` is a non-negative integer. */
export type ArtifactSpec =
  | { kind: 'step-screenshot'; pathwayId: string; viewport: Viewport; runId: string; step: number; member: string }
  | { kind: 'video'; pathwayId: string; viewport: Viewport; runId: string; member: string; n: number }
  | { kind: 'trace'; pathwayId: string; viewport: Viewport; runId: string }
  | { kind: 'console'; pathwayId: string; viewport: Viewport; runId: string; member: string }
  | { kind: 'manifest'; runId: string }
  | { kind: 'uploads'; runId: string };

/** The kinds of artifact the grammar names. */
export type ArtifactKind = ArtifactSpec['kind'];

/** One per-Pathway run directory: `audit-artifacts/<pathwayId>/<viewport>/<runId>`. */
export interface RunDirectory {
  pathwayId: string;
  viewport: Viewport;
  runId: string;
}

/** A Storage object a page wrote, as recorded in the upload ledger. */
export interface StorageObjectRef {
  bucket: string;
  path: string;
}

/** One line of `audit-artifacts/.uploads/<runId>.jsonl`. */
export interface UploadLedgerEntry extends StorageObjectRef {
  runId: string;
  member: string;
  pathwayId: string;
}

/** True when `value` is a valid Pathway id. */
export function isPathwayId(value: string): boolean {
  return PATHWAY_ID_PATTERN.test(value);
}

/** True when `value` is a valid member label. */
export function isMemberLabel(value: string): boolean {
  return MEMBER_LABEL_PATTERN.test(value);
}

/** True when `value` is a valid run id. */
export function isRunId(value: string): boolean {
  return RUN_ID_PATTERN.test(value);
}

/** True when `value` is a viewport profile name. */
export function isViewport(value: string): value is Viewport {
  return value === 'desktop' || value === 'phone';
}

function requireComponent(name: string, value: string, valid: boolean): void {
  if (!valid) {
    throw new RangeError(`artifactPaths: invalid ${name} ${JSON.stringify(value)}`);
  }
}

function requireRunDirectory(dir: RunDirectory): void {
  requireComponent('pathway id', dir.pathwayId, isPathwayId(dir.pathwayId));
  requireComponent('viewport', dir.viewport, isViewport(dir.viewport));
  requireComponent('run id', dir.runId, isRunId(dir.runId));
}

/** Step index as written in a file name: at least two digits, zero-padded. */
function formatStep(step: number): string {
  requireComponent('step index', String(step), Number.isSafeInteger(step) && step >= 1);
  return String(step).padStart(2, '0');
}

/** Reads a step index back, refusing any spelling `formatStep` would not write. */
function parseStep(text: string): number | null {
  if (!/^\d{2,}$/.test(text)) return null;
  const step = Number(text);
  if (!Number.isSafeInteger(step) || step < 1 || formatStep(step) !== text) return null;
  return step;
}

/** Reads a video number back, refusing leading zeros so every path has one spelling. */
function parseCount(text: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * The relative path of a per-Pathway run directory,
 * `audit-artifacts/<pathwayId>/<viewport>/<runId>`.
 *
 * @throws RangeError when a component does not match its pattern
 */
export function runDirectory(dir: RunDirectory): string {
  requireRunDirectory(dir);
  return [ARTIFACT_ROOT, dir.pathwayId, dir.viewport, dir.runId].join('/');
}

/**
 * The relative, `/`-separated path of one artifact (Req 29.5).
 *
 * @throws RangeError when a component does not match its pattern. A bad component is
 *   a harness bug, and a path that silently dropped it would no longer parse back.
 */
export function artifactPath(spec: ArtifactSpec): string {
  switch (spec.kind) {
    case 'manifest':
      requireComponent('run id', spec.runId, isRunId(spec.runId));
      return [ARTIFACT_ROOT, RUNS_DIR, spec.runId, 'manifest.json'].join('/');
    case 'uploads':
      requireComponent('run id', spec.runId, isRunId(spec.runId));
      return [ARTIFACT_ROOT, UPLOADS_DIR, `${spec.runId}.jsonl`].join('/');
    case 'trace':
      return `${runDirectory(spec)}/trace.zip`;
    case 'console':
      requireComponent('member label', spec.member, isMemberLabel(spec.member));
      return `${runDirectory(spec)}/console.${spec.member}.jsonl`;
    case 'video':
      requireComponent('member label', spec.member, isMemberLabel(spec.member));
      requireComponent('video number', String(spec.n), Number.isSafeInteger(spec.n) && spec.n >= 0);
      return `${runDirectory(spec)}/video.${spec.member}.${spec.n}.webm`;
    case 'step-screenshot':
      requireComponent('member label', spec.member, isMemberLabel(spec.member));
      return `${runDirectory(spec)}/step-${formatStep(spec.step)}.${spec.member}.png`;
  }
}

/**
 * Splits a path into segments, accepting `/` or `\` and any prefix before the
 * `audit-artifacts` root (an absolute path from the file system, for example).
 * Returns the segments after the LAST root segment, or null without one.
 */
function segmentsUnderRoot(path: string): string[] | null {
  const segments = path.split(/[\\/]+/).filter((segment) => segment !== '');
  const root = segments.lastIndexOf(ARTIFACT_ROOT);
  return root === -1 ? null : segments.slice(root + 1);
}

function parseRunSegments(segments: readonly string[]): RunDirectory | null {
  const [pathwayId, viewport, runId] = segments;
  if (!isPathwayId(pathwayId) || !isViewport(viewport) || !isRunId(runId)) return null;
  return { pathwayId, viewport, runId };
}

/** Reads a file name inside a run directory back into its kind and parts. */
function parseRunFile(dir: RunDirectory, file: string): ArtifactSpec | null {
  if (file === 'trace.zip') return { kind: 'trace', ...dir };

  let match = /^step-([^.]+)\.([^.]+)\.png$/.exec(file);
  if (match) {
    const step = parseStep(match[1]);
    if (step === null || !isMemberLabel(match[2])) return null;
    return { kind: 'step-screenshot', ...dir, step, member: match[2] };
  }

  match = /^video\.([^.]+)\.([^.]+)\.webm$/.exec(file);
  if (match) {
    const n = parseCount(match[2]);
    if (n === null || !isMemberLabel(match[1])) return null;
    return { kind: 'video', ...dir, member: match[1], n };
  }

  match = /^console\.([^.]+)\.jsonl$/.exec(file);
  if (match) {
    if (!isMemberLabel(match[1])) return null;
    return { kind: 'console', ...dir, member: match[1] };
  }

  return null;
}

/**
 * Reads an artifact path back into its components, the inverse of `artifactPath`
 * (Req 29.5). Accepts `/` or `\` separators and any prefix before `audit-artifacts`.
 * Returns null for anything the grammar does not name, including a non-canonical
 * spelling such as `step-005` or `video.seller.01.webm`.
 */
export function parseArtifactPath(path: string): ArtifactSpec | null {
  const segments = segmentsUnderRoot(path);
  if (segments === null) return null;

  if (segments.length === 3 && segments[0] === RUNS_DIR && segments[2] === 'manifest.json') {
    return isRunId(segments[1]) ? { kind: 'manifest', runId: segments[1] } : null;
  }

  if (segments.length === 2 && segments[0] === UPLOADS_DIR) {
    const match = /^(.+)\.jsonl$/.exec(segments[1]);
    return match && isRunId(match[1]) ? { kind: 'uploads', runId: match[1] } : null;
  }

  if (segments.length === 4) {
    const dir = parseRunSegments(segments);
    return dir === null ? null : parseRunFile(dir, segments[3]);
  }

  return null;
}

/**
 * Reads a per-Pathway run directory path back into its components. Accepts `/` or
 * `\` and any prefix before `audit-artifacts`; returns null for anything else,
 * including the `runs/` and `.uploads/` directories.
 */
export function parseRunDirectory(path: string): RunDirectory | null {
  const segments = segmentsUnderRoot(path);
  if (segments === null || segments.length !== 3) return null;
  return parseRunSegments(segments);
}

/**
 * The run directories a newer run of the same Pathway and viewport has replaced
 * (Req 29.6). Given every run directory found on disk, returns those for
 * (`pathwayId`, `viewport`) whose run id is older than the newest run id for that
 * pair, oldest first, in the caller's own spelling so they can be deleted as given.
 *
 * Never returns the pair's newest run, a run of another pair, or a path that does not
 * parse as a run directory: an unrecognised directory is the owner's, not ours.
 */
export function supersededRuns(
  directories: readonly string[],
  pathwayId: string,
  viewport: Viewport,
): string[] {
  const pairRuns = directories
    .map((path) => ({ path, dir: parseRunDirectory(path) }))
    .filter((entry): entry is { path: string; dir: RunDirectory } =>
      entry.dir !== null && entry.dir.pathwayId === pathwayId && entry.dir.viewport === viewport);

  if (pairRuns.length === 0) return [];

  const newest = pairRuns.reduce((latest, entry) => (entry.dir.runId > latest ? entry.dir.runId : latest), '');

  return pairRuns
    .filter((entry) => entry.dir.runId < newest)
    .sort((a, b) => (a.dir.runId < b.dir.runId ? -1 : a.dir.runId > b.dir.runId ? 1 : 0))
    .map((entry) => entry.path);
}

// ---------------------------------------------------------------------------
// Storage upload URLs (Req 2.4)
// ---------------------------------------------------------------------------

/** The Storage object API prefix. */
const STORAGE_OBJECT_PREFIX = '/storage/v1/object/';

/** The signed-upload form, `/storage/v1/object/upload/sign/<bucket>/<path>?token=…`. */
const SIGNED_UPLOAD_SEGMENTS = ['upload', 'sign'] as const;

/**
 * Storage bucket names the suite records. Lowercase, digits, `-` and `_`, e.g.
 * `item-images`, `scam-report-evidence`.
 */
export const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * First segments after `/storage/v1/object/` that are API routes rather than buckets:
 * reads (`public`, `authenticated`, `sign`, `info`), listings and the move/copy
 * operations. None of them is an object write, so none becomes a ledger entry.
 */
const NON_BUCKET_SEGMENTS: ReadonlySet<string> = new Set([
  'public', 'authenticated', 'sign', 'info', 'list', 'move', 'copy', 'upload',
]);

/** HTTP methods Storage accepts for an object write. */
const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT']);

/** True when `bucket` can be recorded in the ledger. */
export function isBucketName(bucket: string): boolean {
  return BUCKET_NAME_PATTERN.test(bucket) && !NON_BUCKET_SEGMENTS.has(bucket);
}

/** True when `segment` is one non-empty object path segment (no `/`, not `.` or `..`). */
function isPathSegment(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('/');
}

/** True when `path` is a `/`-separated object path of valid segments. */
export function isObjectPath(path: string): boolean {
  return path.split('/').every(isPathSegment);
}

/**
 * The Storage object-write URL for (`bucket`, `path`) under `storageBaseUrl` (the
 * Supabase project URL), with every path segment percent-encoded.
 *
 * @throws RangeError when the bucket or path is not one `parseStorageUploadUrl` reads
 */
export function storageUploadUrl(storageBaseUrl: string, bucket: string, path: string): string {
  requireComponent('bucket', bucket, isBucketName(bucket));
  requireComponent('object path', path, isObjectPath(path));
  const base = storageBaseUrl.replace(/\/+$/, '');
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${base}${STORAGE_OBJECT_PREFIX}${bucket}/${encoded}`;
}

/**
 * The ledger entry for a Storage object write, or null for any other request
 * (Req 2.4). Reads `/storage/v1/object/<bucket>/<path>` and the signed-upload form
 * `/storage/v1/object/upload/sign/<bucket>/<path>`, ignoring the query and hash.
 *
 * When `method` is given, anything but POST or PUT is null: a GET of the same URL
 * downloads the object, and recording it would make cleanup delete an object the run
 * did not create.
 */
export function parseStorageUploadUrl(url: string, method?: string): StorageObjectRef | null {
  if (method !== undefined && !WRITE_METHODS.has(method.toUpperCase())) return null;

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  if (!pathname.startsWith(STORAGE_OBJECT_PREFIX)) return null;
  let raw = pathname.slice(STORAGE_OBJECT_PREFIX.length).split('/');

  if (raw[0] === SIGNED_UPLOAD_SEGMENTS[0] && raw[1] === SIGNED_UPLOAD_SEGMENTS[1]) {
    raw = raw.slice(2);
  }

  if (raw.length < 2) return null;

  let segments: string[];
  try {
    segments = raw.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }

  const [bucket, ...pathSegments] = segments;
  if (!isBucketName(bucket) || !pathSegments.every(isPathSegment)) return null;

  return { bucket, path: pathSegments.join('/') };
}
