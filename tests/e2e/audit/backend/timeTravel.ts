// tests/e2e/audit/backend/timeTravel.ts
//
// TIMESTAMP REWINDS for the e2e UX audit suite: simulates elapsed time by moving
// sandbox timestamps back, instead of waiting for an inspection window, a 30-minute
// unfinished payment or a hold expiry.
//
// Requirements:
//   26.4  elapsed time is simulated by moving sandbox timestamps back, recorded as a
//         Simulated_Step (`simulated(..., { mechanism: 'moved-timestamp' })`)
//   1.1   the write only ever lands in `cardtrade_dev`
//
// `core/timeTravel.ts` decides WHAT changes (`planRewind` → `rewindPatch`); this
// module reads the row and applies the patch with the service role (`updateRows`,
// which addresses `e2eSchema()`). The patch holds exactly the named columns, so a
// rewind can never touch a status, an amount or anything else on the row.
//
// Call it only inside `simulated()`, and follow it with the Job_Endpoint or
// Cron_Function that reads the moved column.

import { e2eSchema, selectRows, updateRows } from '../../support/db';
import { planRewind, type RewindPatch } from '../core/timeTravel';

/** A plain SQL identifier, for the key column. Table and columns are checked by `planRewind`. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** One hour, one day: the units Pathways rewind by. */
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Move the named timestamp columns of one `cardtrade_dev` row back by `durationMs`
 * and return the patch that was written.
 *
 * `key` names the column `id` is matched on (default `id`), for tables keyed by
 * something else such as `trade_id`. Throws when the row does not exist, when the key
 * matches more than one row, when a column is not a timestamp (null included), when
 * the duration is negative, or when the update changed no row.
 */
export async function rewind(
  table: string,
  id: string,
  columns: readonly string[],
  durationMs: number,
  opts: { key?: string } = {},
): Promise<RewindPatch> {
  const schema = e2eSchema();
  const key = opts.key ?? 'id';
  if (!IDENTIFIER.test(key)) {
    throw new Error(`Refusing to rewind: ${JSON.stringify(key)} is not a plain column name.`);
  }
  if (!IDENTIFIER.test(table)) {
    throw new Error(`Refusing to rewind table ${JSON.stringify(table)}: not a plain table name.`);
  }
  // Column names are validated by `planRewind`; check them before they reach a URL.
  for (const column of columns) {
    if (!IDENTIFIER.test(column)) {
      throw new Error(`Refusing to rewind ${JSON.stringify(column)}: not a plain column name.`);
    }
  }

  const filter = `${key}=eq.${encodeURIComponent(id)}`;
  const select = [...new Set([key, ...columns])].join(',');
  const rows = await selectRows<Record<string, unknown>>(table, `select=${select}&${filter}`);
  if (rows.length === 0) throw new Error(`Refusing to rewind: no ${table} row with ${key} ${id}.`);
  if (rows.length > 1) throw new Error(`Refusing to rewind: ${key} ${id} matches ${rows.length} ${table} rows.`);

  const plan = planRewind({ schema, table, id, row: rows[0], columns, durationMs });
  const updated = await updateRows(table, filter, plan.patch);
  if (updated.length !== 1) {
    throw new Error(`Rewind of ${table} ${id} updated ${updated.length} rows, expected 1.`);
  }
  return plan.patch;
}
