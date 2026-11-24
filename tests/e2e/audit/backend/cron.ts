// tests/e2e/audit/backend/cron.ts
//
// CRON_FUNCTION CALLS for the e2e UX audit suite: runs one pg_cron job body in the
// sandbox schema on demand.
//
// Requirements:
//   26.3  a Pathway that depends on a Cron_Function invokes it in the Sandbox schema
//         and verifies the outcome
//   1.1   the suite only ever targets `cardtrade_dev`
//
// The sandbox clone does not copy pg_cron jobs (`scripts/dev/resetDevSchema.mjs`), so
// the work a job does in production has to be started by hand. The statement comes
// ONLY from `cronInvocationSql` in `core/cron.ts`, which accepts an allow-listed name
// and always qualifies it with `cardtrade_dev`; this module adds no SQL of its own.
//
// TRANSPORT. The functions are SECURITY DEFINER bodies with no member or service-role
// grant, so PostgREST cannot reach them. They run through the Supabase Management API
// query endpoint (as `postgres`), the same transport `scripts/dev/applyToDev.mjs`
// uses, via `query()` in `scripts/dev/lib.mjs`. `SUPABASE_PAT` is read with `envValue`
// and handed to that function only; it is never returned or logged.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { envValue, e2eSchema } from '../../support/db';
import { cronInvocationSql, type CronFunctionName } from '../core/cron';

/** The shape of `scripts/dev/lib.mjs` this module uses. */
interface DevLib {
  query(env: Record<string, string | undefined>, sql: string): Promise<unknown>;
}

/**
 * A NATIVE dynamic import. Playwright compiles specs to CommonJS, which rewrites a
 * plain `import()` into `require()`, and Node 20 cannot `require` an ES module such
 * as `lib.mjs`. Building the call from a string keeps it out of the transform.
 */
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

let devLib: Promise<DevLib> | null = null;

function loadDevLib(): Promise<DevLib> {
  devLib ??= nativeImport(
    pathToFileURL(path.join(process.cwd(), 'scripts', 'dev', 'lib.mjs')).href,
  ) as Promise<DevLib>;
  return devLib;
}

/**
 * Run one allow-listed Cron_Function in `cardtrade_dev` and return the rows the
 * Management API reports (usually one row holding the function's return value).
 *
 * Throws, before any request, when the harness is not pointed at the sandbox, when
 * `name` is not on the allow-list, or when `SUPABASE_PAT` / the project URL is
 * missing. A failed statement throws with the database's message.
 */
export async function runCron(name: CronFunctionName): Promise<unknown[]> {
  e2eSchema();
  const sql = cronInvocationSql(name);
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: envValue('NEXT_PUBLIC_SUPABASE_URL'),
    SUPABASE_PAT: envValue('SUPABASE_PAT'),
  };
  if (!env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('refusing cron call: NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!env.SUPABASE_PAT) throw new Error('refusing cron call: SUPABASE_PAT is not set');

  const { query } = await loadDevLib();
  const rows = await query(env, sql);
  return Array.isArray(rows) ? rows : [];
}
