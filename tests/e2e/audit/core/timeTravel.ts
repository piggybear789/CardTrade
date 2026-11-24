// tests/e2e/audit/core/timeTravel.ts
//
// TIMESTAMP REWIND PLANNER for the e2e UX audit suite. Pure: no I/O, no Supabase. A
// Pathway that depends on elapsed time (an inspection deadline, a 30-minute unfinished
// payment, a hold near expiry) moves the relevant sandbox timestamps back instead of
// waiting. This module decides WHAT changes; `audit/backend/timeTravel.ts` `rewind(...)`
// applies the patch with the service role, always inside a `simulated(...)` step.
//
// Requirements:
//   26.4  elapsed time is simulated by moving sandbox timestamps back, as a
//         Simulated_Step
//   1.1   the suite only ever writes to `cardtrade_dev` (reuses the preflight guard)

import { SANDBOX_SCHEMA, assertSandboxSchema } from './preflight';

/** A plain SQL identifier: what a `cardtrade_dev` table or column name looks like. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * An ISO 8601 / Postgres timestamp (`2026-12-01T10:00:00.123456+00:00`,
 * `2026-12-01 10:00:00+00`). Checked before `Date.parse`, whose V8 fallback parser
 * reads strings like `sale-1` as dates. The zone is required: a zone-less value would
 * be read in the machine's local time and written back shifted.
 */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** Column name → the new ISO 8601 timestamp to write. */
export type RewindPatch = Record<string, string>;

/** Everything `rewind(...)` needs to issue one service-role update. */
export interface RewindPlan {
  schema: typeof SANDBOX_SCHEMA;
  table: string;
  id: string;
  patch: RewindPatch;
}

/** Reads a row value as an instant, or `null` when it is not a timestamp. */
function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return null;
  // Postgres may send `+00` and a space separator; normalise to what Date.parse reads.
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Builds the patch that moves each named timestamp column of `row` back by
 * `durationMs`. The patch holds exactly the named columns (a repeated name appears
 * once) and nothing else, each earlier than its current value by exactly the
 * duration (Req 26.4).
 *
 * Throws when the duration is negative, not a safe integer, or when no column is
 * named; and when a named column is not an identifier, is not on the row, or does
 * not hold a timestamp (a null deadline cannot be "moved back").
 */
export function rewindPatch(
  row: Readonly<Record<string, unknown>>,
  columns: readonly string[],
  durationMs: number,
): RewindPatch {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new Error(`Refusing to rewind by ${String(durationMs)} ms: the duration must be a non-negative integer.`);
  }
  if (columns.length === 0) {
    throw new Error('Refusing to rewind: no column was named.');
  }

  const patch: RewindPatch = {};
  for (const column of columns) {
    if (!IDENTIFIER.test(column) || !Object.prototype.hasOwnProperty.call(row, column)) {
      throw new Error(`Refusing to rewind ${JSON.stringify(column)}: the row has no such column.`);
    }
    const current = toEpochMs(row[column]);
    if (current === null) {
      throw new Error(`Refusing to rewind ${JSON.stringify(column)}: it does not hold a timestamp.`);
    }
    patch[column] = new Date(current - durationMs).toISOString();
  }
  return patch;
}

/**
 * Builds a full rewind plan for one row, pinned to the sandbox schema. `schema`
 * defaults to `cardtrade_dev` and anything else throws, so a plan can never name a
 * production table (Req 1.1, 26.4).
 */
export function planRewind(input: {
  schema?: string;
  table: string;
  id: string;
  row: Readonly<Record<string, unknown>>;
  columns: readonly string[];
  durationMs: number;
}): RewindPlan {
  const schema = input.schema ?? SANDBOX_SCHEMA;
  assertSandboxSchema(schema);
  if (!IDENTIFIER.test(input.table)) {
    throw new Error(`Refusing to rewind table ${JSON.stringify(input.table)}: not a plain table name.`);
  }
  if (input.id.trim() === '') {
    throw new Error('Refusing to rewind: the row id is blank.');
  }
  return {
    schema,
    table: input.table,
    id: input.id,
    patch: rewindPatch(input.row, input.columns, input.durationMs),
  };
}
