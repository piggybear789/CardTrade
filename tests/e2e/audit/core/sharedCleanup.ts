// tests/e2e/audit/core/sharedCleanup.ts
//
// THE DECISIONS behind cleaning up Shared_Resources (Storage objects and Stripe test
// objects) after an audit run. Pure: no I/O, no `node:fs`, no network, no Stripe SDK.
// `scripts/e2e/cleanup-test-data.ts` gathers the facts (ledger files, row paths, which
// owners are sandbox accounts, which paths a surviving row still references, what
// Stripe Search returned) and acts only on what this module answers.
//
// Requirements:
//   2.4, 2.5  every object in a run's upload ledger is deleted, by exact path
//   2.6       a run start heals an interrupted earlier run (recent run ids on disk)
//   2.7       Stripe objects are acted on only when stamped `cardtrade_sandbox=true`
//             AND with the run's own `cardtrade_e2e_run`; fixture objects are kept
//   2.8       nothing outside the sandbox is a target
//
// WHY A SURVIVING REFERENCE KEEPS AN OBJECT. Storage is shared with production, and a
// spec may copy a seed listing's photo paths onto a marked listing
// (`tests/e2e/stripe/bank-rails.stripe.ts` does). Deleting by row path alone would then
// delete the seed photo, and with it the image on every row that shares it. So every
// candidate, ledger entries included, is kept while any row the cleanup did not remove
// still names it, and the seed's own `sandbox/` prefix in `item-images` is never a
// target at all.

import {
  isBucketName,
  isObjectPath,
  isRunId,
  type StorageObjectRef,
  type UploadLedgerEntry,
} from './artifactPaths';

/** Metadata key on Stripe objects the suite keeps across runs (seed bindings, fixtures). */
export const FIXTURE_METADATA_KEY = 'cardtrade_e2e_fixture';

/** The sandbox and run stamp keys (mirrors `domain/services/stripe/metadata.ts`). */
const SANDBOX_KEY = 'cardtrade_sandbox';
const RUN_KEY = 'cardtrade_e2e_run';

/** Prefix the dev seed's photos live under (`scripts/dev/seedImages.mjs`). Never deleted. */
export const SEED_IMAGE_PREFIX = 'sandbox/';

/** A first path segment that names a profile (the per-member bucket layout). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One Storage object as `bucket/path`, the key every set below uses. */
export function objectKey(ref: StorageObjectRef): string {
  return `${ref.bucket}/${ref.path}`;
}

/** True when `ref` names a bucket and path the Storage API would read as one object. */
export function isValidObjectRef(ref: { bucket?: unknown; path?: unknown }): ref is StorageObjectRef {
  return (
    typeof ref.bucket === 'string' &&
    typeof ref.path === 'string' &&
    isBucketName(ref.bucket) &&
    isObjectPath(ref.path)
  );
}

/** The profile id a per-member object path starts with, or null. */
export function ownerOfPath(path: string): string | null {
  const first = path.split('/')[0];
  return UUID.test(first) ? first.toLowerCase() : null;
}

/** True for the dev seed's own photos, which no cleanup ever deletes. */
export function isSeedImage(ref: StorageObjectRef): boolean {
  return ref.bucket === 'item-images' && ref.path.startsWith(SEED_IMAGE_PREFIX);
}

/** The parsed upload ledger of one run. */
export interface ParsedLedger {
  entries: UploadLedgerEntry[];
  /** 1-based line numbers that were not a valid entry for this run. */
  invalidLines: number[];
}

/**
 * Reads `audit-artifacts/.uploads/<runId>.jsonl`. A line is kept only when it is JSON
 * naming a valid bucket and path and THIS run id, so a hand-edited or foreign line can
 * never widen what is deleted. Blank lines are ignored; duplicates are dropped.
 */
export function parseUploadLedger(text: string, runId: string): ParsedLedger {
  const entries: UploadLedgerEntry[] = [];
  const invalidLines: number[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      invalidLines.push(index + 1);
      return;
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      !isValidObjectRef(value as Record<string, unknown>) ||
      (value as Record<string, unknown>).runId !== runId
    ) {
      invalidLines.push(index + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    const entry: UploadLedgerEntry = {
      bucket: record.bucket as string,
      path: record.path as string,
      runId,
      member: typeof record.member === 'string' ? record.member : '',
      pathwayId: typeof record.pathwayId === 'string' ? record.pathwayId : '',
    };
    const key = objectKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  });
  return { entries, invalidLines };
}

/** Where a Storage candidate came from. */
export type StorageSource = 'ledger' | 'row' | 'prefix';

/** A candidate object for deletion and how it was found. */
export interface StorageCandidate extends StorageObjectRef {
  source: StorageSource;
}

/** An object cleanup decided not to delete, with the reason (logged by the caller). */
export interface KeptObject extends StorageObjectRef {
  reason: 'seed-image' | 'still-referenced' | 'owner-not-sandbox' | 'invalid';
}

/** What to delete, per bucket, and what was kept. */
export interface StoragePlan {
  delete: Map<string, string[]>;
  kept: KeptObject[];
}

/**
 * Decides which candidates to delete.
 *
 * - `ledger` and `prefix` candidates are the run's own uploads or a sandbox persona's
 *   own folder, so ownership is already established.
 * - A `row` candidate (a path named by a marked row) is deleted only when its first
 *   segment is a profile in `sandboxOwners`: a path under anyone else's folder, or under
 *   no folder, may be an object the run never made.
 * - Every candidate is kept while `stillReferenced` holds it, and the seed's
 *   `item-images/sandbox/` photos are always kept.
 *
 * A path found by several sources is decided once, with the most trusted source
 * (ledger, then prefix, then row).
 */
export function planStorageDeletion(input: {
  candidates: readonly StorageCandidate[];
  sandboxOwners: ReadonlySet<string>;
  stillReferenced: ReadonlySet<string>;
}): StoragePlan {
  const rank: Record<StorageSource, number> = { ledger: 0, prefix: 1, row: 2 };
  const best = new Map<string, StorageCandidate>();
  const kept: KeptObject[] = [];

  for (const candidate of input.candidates) {
    if (!isValidObjectRef({ bucket: candidate.bucket, path: candidate.path })) {
      kept.push({ bucket: String(candidate.bucket), path: String(candidate.path), reason: 'invalid' });
      continue;
    }
    const key = objectKey(candidate);
    const current = best.get(key);
    if (!current || rank[candidate.source] < rank[current.source]) best.set(key, candidate);
  }

  const toDelete = new Map<string, string[]>();
  for (const [key, candidate] of best) {
    const ref = { bucket: candidate.bucket, path: candidate.path };
    if (isSeedImage(ref)) {
      kept.push({ ...ref, reason: 'seed-image' });
      continue;
    }
    if (candidate.source === 'row') {
      const owner = ownerOfPath(candidate.path);
      if (owner === null || !input.sandboxOwners.has(owner)) {
        kept.push({ ...ref, reason: 'owner-not-sandbox' });
        continue;
      }
    }
    if (input.stillReferenced.has(key)) {
      kept.push({ ...ref, reason: 'still-referenced' });
      continue;
    }
    const list = toDelete.get(candidate.bucket) ?? [];
    list.push(candidate.path);
    toDelete.set(candidate.bucket, list);
  }

  for (const list of toDelete.values()) list.sort();
  return { delete: toDelete, kept };
}

// ---------------------------------------------------------------------------
// Runs to heal
// ---------------------------------------------------------------------------

/** The start instant encoded in a run id, or null for anything that is not one. */
export function runStartedAt(runId: string): Date | null {
  if (!isRunId(runId)) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-/.exec(runId);
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The runs whose Stripe objects cleanup searches for: the current run, plus recent runs
 * this machine recorded (manifests and ledgers on disk), so an interrupted run is healed
 * by the next one (Req 2.6). Bounded by age and count, newest first, because every run
 * id is a Search per object type per platform.
 */
export function runsToHeal(input: {
  current?: string;
  onDisk: readonly string[];
  now: Date;
  maxAgeDays?: number;
  max?: number;
}): string[] {
  const maxAgeMs = (input.maxAgeDays ?? 7) * 24 * 60 * 60 * 1000;
  const max = input.max ?? 20;
  const recent = new Set<string>();
  for (const runId of input.onDisk) {
    const started = runStartedAt(runId);
    if (started === null) continue;
    const age = input.now.getTime() - started.getTime();
    if (age >= -60_000 && age <= maxAgeMs) recent.add(runId);
  }
  const current = input.current && isRunId(input.current) ? input.current : undefined;
  if (current) recent.delete(current);
  const older = [...recent].sort().reverse();
  const ordered = current ? [current, ...older] : older;
  return ordered.slice(0, max);
}

// ---------------------------------------------------------------------------
// Stripe test objects
// ---------------------------------------------------------------------------

/** The Stripe object kinds cleanup handles. */
export type StripeObjectType = 'payment_intent' | 'customer' | 'account' | 'identity.verification_session';

/** What to do with one Stripe object. */
export type StripeDecision =
  | { action: 'cancel' }
  | { action: 'delete' }
  /** Not this run's sandbox object, or a fixture: never touched. */
  | { action: 'skip'; reason: 'not-stamped' | 'other-run' | 'fixture' }
  /** Already as removed as Stripe allows; nothing to report. */
  | { action: 'done' }
  /** Stripe will not remove it: listed in the manifest's `leftInStripe`. */
  | { action: 'leave'; reason: string };

/** PaymentIntent statuses Stripe accepts a cancel from. */
const CANCELLABLE_INTENT = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'requires_capture',
]);

/** True when `metadata` carries the sandbox stamp of `runId`. */
export function isStampedForRun(metadata: Record<string, string> | null | undefined, runId: string): boolean {
  return metadata?.[SANDBOX_KEY] === 'true' && metadata?.[RUN_KEY] === runId;
}

/**
 * Decides what cleanup does with one Stripe object found for `runId`. Search results
 * are re-checked here rather than trusted, so an object reaches `cancel` or `delete`
 * only when it carries BOTH stamps for this exact run and no fixture tag.
 */
export function decideStripeObject(input: {
  type: StripeObjectType;
  runId: string;
  metadata: Record<string, string> | null | undefined;
  status?: string | null;
  deleted?: boolean;
}): StripeDecision {
  const metadata = input.metadata ?? {};
  if (metadata[SANDBOX_KEY] !== 'true') return { action: 'skip', reason: 'not-stamped' };
  if (metadata[RUN_KEY] !== input.runId) return { action: 'skip', reason: 'other-run' };
  if (metadata[FIXTURE_METADATA_KEY] !== undefined) return { action: 'skip', reason: 'fixture' };
  if (input.deleted) return { action: 'done' };

  switch (input.type) {
    case 'payment_intent': {
      const status = input.status ?? '';
      if (CANCELLABLE_INTENT.has(status)) return { action: 'cancel' };
      if (status === 'canceled') return { action: 'done' };
      return { action: 'leave', reason: `PaymentIntent is ${status || 'in an unknown state'}; Stripe keeps it` };
    }
    case 'identity.verification_session': {
      const status = input.status ?? '';
      if (status === 'requires_input') return { action: 'cancel' };
      if (status === 'canceled') return { action: 'done' };
      return { action: 'leave', reason: `verification session is ${status || 'in an unknown state'}; Stripe keeps it` };
    }
    case 'customer':
    case 'account':
      return { action: 'delete' };
  }
}

/** One `leftInStripe` entry of the run manifest. */
export interface LeftInStripe {
  type: string;
  id: string;
  reason: string;
}

/**
 * The run's new `leftInStripe`. When every search for the run succeeded the new list
 * replaces the old one (an object since removed drops off); otherwise the two are
 * merged, so a failed search never erases what an earlier pass recorded. Sorted and
 * de-duplicated by type and id, the newer reason winning.
 */
export function mergeLeftInStripe(
  existing: readonly LeftInStripe[],
  found: readonly LeftInStripe[],
  complete: boolean,
): LeftInStripe[] {
  const byKey = new Map<string, LeftInStripe>();
  if (!complete) for (const entry of existing) byKey.set(`${entry.type}:${entry.id}`, { ...entry });
  for (const entry of found) byKey.set(`${entry.type}:${entry.id}`, { ...entry });
  return [...byKey.values()].sort((a, b) =>
    a.type === b.type ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.type < b.type ? -1 : 1,
  );
}
