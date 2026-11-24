// tests/e2e/audit/preflight.setup.ts
//
// THE DYNAMIC PREFLIGHT (design, "Safety preflight"): the `preflight` project, which
// runs after the web servers are up and before `setup`. Every other project depends on
// it, so any failure here reports the rest of the run as "did not run" instead of
// letting a Pathway touch the wrong schema, the wrong payments mode or an unflagged
// account.
//
// The static preflight in `playwright.config.ts` has already refused a non-sandbox
// harness schema and every live Stripe key before any server started. This adds what
// needs a running server or the sandbox:
//
//   1. each App_Server's own `/api/health` `schema` and `paymentsMode` (main `test`,
//      aux `mock`), the client env stamp of the build they serve, and the required
//      secrets (Req 1.4, 1.5, 4.2);
//   2. the seed rows the Pathways rely on (Req 34.5);
//   3. every seeded Sandbox_Account the run signs in as carries
//      `app_metadata.sandbox = true`, reported masked (Req 2.2, 2.3);
//   4. the Coverage_Map against product.md and the defined Pathways (Req 5.1, 5.2,
//      5.4, 5.5, 5.6).
//
// Each is its own test so one run reports every problem the owner has to fix. All
// decisions go through the pure `decidePreflight` / `checkCoverageMap`; messages name
// variables and masked emails, never a value.
//
// Read-only: nothing here writes a row, an auth user or a Stripe object.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test as setup } from '@playwright/test';

import { SEED_RECORDS, requireSeed } from './backend/seed';
import { checkCoverageMap, extractProductFunctions } from './core/coverageMap';
import { decidePreflight, maskEmail, type PreflightInput } from './core/preflight';
import { COVERAGE_MAP } from './coverage';
import {
  CLIENT_ENV_STAMP,
  auxWebhookSecret,
  harnessEnvironment,
  readBuiltClientEnv,
  ship24WebhookSecret,
} from './harnessEnv';
import { readPathwayUniverse } from './pathwayUniverse';
import { describePreflightProblem } from './preflightMessages';
import { getAuthUser, isSandboxAccount } from '../support/db';
import { SEED_CHECK_USERS, appServerUrl, type AppServer } from '../support/users';

/** Secrets the run needs on top of the static checks (design, "Safety preflight"). */
const REQUIRED_SECRETS = [
  'JOBS_SECRET',
  'SHIP24_WEBHOOK_SECRET',
  // Checked as the AUX server runs with it (see `envForChecks`).
  'WEBHOOK_SECRET',
  'E2E_SEED_PASSWORD',
  'SUPABASE_PAT',
] as const;

const PRODUCT_MD = path.join('.kiro', 'steering', 'product.md');
const HEALTH_TIMEOUT_MS = 15_000;

const ROOT = process.cwd();
const HARNESS_ENV = harnessEnvironment(ROOT);
const HARNESS_SCHEMA = HARNESS_ENV.NEXT_PUBLIC_SUPABASE_SCHEMA?.trim() || undefined;

/**
 * The environment the secret check reads: the harness environment, with
 * `WEBHOOK_SECRET` as the aux server receives it (`playwright.config.ts` gives the aux
 * server the same value). Only the mock binding on the aux server verifies with it.
 */
function envForChecks(): Record<string, string | undefined> {
  return {
    ...HARNESS_ENV,
    WEBHOOK_SECRET: auxWebhookSecret(HARNESS_ENV),
    // As the main server receives it (`playwright.config.ts`, `ship24WebhookSecret`).
    SHIP24_WEBHOOK_SECRET: ship24WebhookSecret(HARNESS_ENV),
  };
}

function fail(heading: string, lines: readonly string[]): never {
  throw new Error(`${heading}\n${lines.map((line) => `  - ${line}`).join('\n')}`);
}

type ServerReport = NonNullable<PreflightInput['servers']>[number];

/** What one App_Server reports about itself. `schema` / `paymentsMode` may be absent. */
async function probeServer(name: AppServer): Promise<ServerReport> {
  const url = `${appServerUrl(name)}/api/health`;
  const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Server ${name}: GET ${url} -> ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  return {
    name,
    schema: text(body.schema),
    paymentsMode: text(body.paymentsMode),
    payments: text(body.payments),
  };
}

setup('servers report the sandbox and the expected payments mode, the build is current and secrets are set', async () => {
  const servers = await Promise.all((['main', 'aux'] as const).map(probeServer));
  const builtClientEnv = readBuiltClientEnv(ROOT);

  const lines: string[] = [];
  if (builtClientEnv === null) {
    lines.push(`No build stamp at ${CLIENT_ENV_STAMP}; rebuild with \`node scripts/e2e/build-for-e2e.mjs\`.`);
  }

  const verdict = decidePreflight({
    harnessSchema: HARNESS_SCHEMA,
    env: envForChecks(),
    servers,
    expectedServerModes: { main: 'test', aux: 'mock' },
    builtClientEnv: builtClientEnv ?? undefined,
    requiredSecrets: REQUIRED_SECRETS,
  });
  if (!verdict.ok) lines.push(...verdict.problems.map(describePreflightProblem));

  if (lines.length > 0) fail('Preflight: the servers or the environment are not ready for an audit run:', lines);
});

setup('the seed rows the Pathways rely on exist', async () => {
  // Every record a Pathway can name, members (including HEIDI_SIGNOUT) and items alike.
  // A missing one fails here naming it and `npm run dev:db:reset` (Req 34.5).
  await requireSeed(SEED_RECORDS.map((record) => record.name));
});

setup('every seeded account the run signs in as is a Sandbox_Account', async () => {
  const accounts: NonNullable<PreflightInput['accounts']> = [];
  const absent: string[] = [];
  for (const user of SEED_CHECK_USERS) {
    const authUser = await getAuthUser(user.id);
    if (!authUser) {
      // Not silently skipped: an account the run signs in as that does not exist has
      // no flag to check, and the Pathway that signs in as it would fail later and
      // less clearly. The seed check above names the same record.
      absent.push(
        `Account ${maskEmail(user.email)} (${user.id}) has no auth user, so its sandbox flag cannot be checked. ` +
          'Run `npm run dev:db:reset`, or add it to the sandbox seed.',
      );
      continue;
    }
    accounts.push({ email: authUser.email ?? user.email, sandbox: isSandboxAccount(authUser) });
  }

  const verdict = decidePreflight({ harnessSchema: HARNESS_SCHEMA, env: {}, accounts });
  const lines = [...absent, ...(verdict.ok ? [] : verdict.problems.map(describePreflightProblem))];
  if (lines.length > 0) fail('Preflight: not every account the run signs in as is a flagged Sandbox_Account:', lines);
});

setup('the Coverage_Map covers every product function and maps only defined Pathways', async () => {
  const productFunctions = extractProductFunctions(readFileSync(path.join(ROOT, PRODUCT_MD), 'utf8'));
  if (productFunctions.length === 0) {
    fail('Preflight: the Coverage_Map check read no product functions:', [
      `${PRODUCT_MD} has no "Features and functionality" or "Transaction models" headings the parser recognises.`,
    ]);
  }

  const universe = readPathwayUniverse(ROOT);
  setup.info().annotations.push({
    type: 'pathway-universe',
    description:
      universe.source === 'list-file'
        ? `${universe.ids.length} Pathway id(s) from audit-artifacts/.pathways.json`
        : `${universe.ids.length} Pathway id(s) from the pathway({ id }) literals in tests/e2e/specs ` +
          '(no audit-artifacts/.pathways.json; `npm run audit` writes it)',
  });

  const problems = checkCoverageMap(COVERAGE_MAP, productFunctions, universe.ids);
  if (problems.length > 0) {
    fail(
      'Preflight: the Coverage_Map has problems:',
      problems.map((problem) => `[${problem.code}] ${problem.message}`),
    );
  }
});
