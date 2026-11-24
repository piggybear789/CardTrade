// tests/e2e/audit/preflightMessages.ts
//
// One sentence per preflight problem, shared by the static preflight in
// `playwright.config.ts` and the `preflight` project, so a refusal reads the same
// wherever it is raised. Problems carry variable names and masked emails only, so
// nothing here can print a secret value (Req 1.3, 2.3).

import type { PreflightProblem } from './core/preflight';

/** A one-line description of a preflight problem, naming what to fix. */
export function describePreflightProblem(problem: PreflightProblem): string {
  switch (problem.code) {
    case 'SCHEMA_NOT_SANDBOX':
      return `NEXT_PUBLIC_SUPABASE_SCHEMA resolves to "${problem.resolved}"; only "cardtrade_dev" is allowed.`;
    case 'LIVE_KEY':
      return `${problem.variable} holds a live Stripe key; the suite runs on test keys only.`;
    case 'SERVER_MISMATCH':
      return `Server ${problem.server} reports "${problem.reported}", the run expects "${problem.harness}".`;
    case 'ACCOUNT_NOT_SANDBOX':
      return `Account ${problem.maskedEmail} is not flagged as a sandbox account (app_metadata.sandbox = true).`;
    case 'STALE_BUILD':
      return 'The e2e build was made with a different client environment; rebuild it with `node scripts/e2e/build-for-e2e.mjs`.';
    case 'MISSING_SECRET':
      return `${problem.variable} is not set.`;
  }
}
