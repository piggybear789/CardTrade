// tests/e2e/support/globalSetup.ts
//
// Runs once before the whole suite (including the `setup` project's
// auth.setup.ts). Two jobs:
//   1. Heal whatever a crashed previous run left behind, by running the same
//      marker-based cleanup that globalTeardown runs after a clean run. This is
//      what makes cleanup self-healing without any "detect a stale run" logic.
//   2. Wipe artifact directories from the previous run so a failure you're
//      looking at is always from *this* run, not a stale one.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { e2eSchema } from './db';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

export default async function globalSetup() {
  // THE SUITE RUNS ON THE DEV SANDBOX, and nowhere else. It seeds accounts, creates
  // listings and contracts, and its cleanup deletes rows by marker, all with the
  // service role. `e2eSchema()` throws unless the schema is exactly `cardtrade_dev`;
  // there is no override (Req 1.1, 1.2, 1.6). `npm run dev:db:reset` builds the sandbox.
  e2eSchema();

  for (const dir of ['test-results', 'playwright-report']) {
    rmSync(path.join(repoRoot, dir), { recursive: true, force: true });
  }

  execFileSync(
    'npx',
    ['tsx', '--env-file=.env.local', 'scripts/e2e/cleanup-test-data.ts'],
    { cwd: repoRoot, stdio: 'inherit', shell: true },
  );
}
