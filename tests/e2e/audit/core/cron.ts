// tests/e2e/audit/core/cron.ts
//
// THE CRON_FUNCTION ALLOW-LIST for the e2e UX audit suite. Pure: no I/O, no Supabase,
// no network. `audit/backend/cron.ts` sends the SQL this module builds through the
// Supabase management query transport; this module is the only place that SQL text
// comes from, so a Pathway can never run an arbitrary statement or reach production.
//
// Requirements:
//   26.3  a Pathway that depends on a Cron_Function invokes it in the Sandbox schema
//   1.1   the suite only ever targets `cardtrade_dev` (reuses the preflight constant)
//
// The sandbox clone does not copy pg_cron jobs (`scripts/dev/resetDevSchema.mjs`), so
// the suite runs a job's body by hand, exactly as the steering docs describe
// (`select cardtrade_dev.auto_complete_due_cash_sales()`).

import { SANDBOX_SCHEMA, assertSandboxSchema } from './preflight';

/**
 * Every Cron_Function the suite may invoke, with the pg_cron job that runs it in
 * production. Each name was checked against the `cron.schedule(...)` call that
 * registers it, and none of those jobs has since been unscheduled:
 *
 * - `auto_complete_due_cash_sales` — `cardtrade_auto_complete_cash_sales`, `:07` (0011)
 * - `warn_expiring_holds` — `cardtrade_warn_expiring_holds`, `:17` (0035)
 * - `expire_lapsed_holds` — `cardtrade_expire_lapsed_holds`, `:27` (0035)
 * - `enforce_trade_shipping_deadlines` — `cardtrade_enforce_trade_shipping_deadlines`, `:37` (0039)
 *
 * Add a name only after confirming it against `cron.job` with a read-only query.
 */
export const CRON_ALLOW_LIST = [
  'auto_complete_due_cash_sales',
  'warn_expiring_holds',
  'expire_lapsed_holds',
  'enforce_trade_shipping_deadlines',
] as const;

/** A Cron_Function name on the allow-list. */
export type CronFunctionName = (typeof CRON_ALLOW_LIST)[number];

/** pg_cron job name for each Cron_Function, for reports and the `cron.job` check. */
export const CRON_JOB_NAMES: Readonly<Record<CronFunctionName, string>> = {
  auto_complete_due_cash_sales: 'cardtrade_auto_complete_cash_sales',
  warn_expiring_holds: 'cardtrade_warn_expiring_holds',
  expire_lapsed_holds: 'cardtrade_expire_lapsed_holds',
  enforce_trade_shipping_deadlines: 'cardtrade_enforce_trade_shipping_deadlines',
};

/**
 * True only when `name` is EXACTLY an allow-listed name. No trimming, case folding or
 * prefix stripping: `' expire_lapsed_holds'`, `'cardtrade.expire_lapsed_holds'` and
 * `'expire_lapsed_holds();'` are all refused.
 */
export function isCronFunctionName(name: unknown): name is CronFunctionName {
  return typeof name === 'string' && (CRON_ALLOW_LIST as readonly string[]).includes(name);
}

/**
 * Builds the statement that runs one Cron_Function in the sandbox:
 * `select cardtrade_dev.<name>()`. Throws for anything that is not exactly an
 * allow-listed name, so the returned text never contains caller-supplied input
 * beyond a fixed identifier (Req 26.3).
 */
export function cronInvocationSql(name: string): string {
  if (!isCronFunctionName(name)) {
    throw new Error(
      `Refusing to invoke cron function ${JSON.stringify(name)}: allowed names are ${CRON_ALLOW_LIST.join(', ')}.`,
    );
  }
  assertSandboxSchema(SANDBOX_SCHEMA);
  return `select ${SANDBOX_SCHEMA}.${name}()`;
}
