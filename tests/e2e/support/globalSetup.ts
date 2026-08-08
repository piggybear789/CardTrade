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

const repoRoot = path.resolve(__dirname, '..', '..', '..');

export default async function globalSetup() {
  for (const dir of ['test-results', 'playwright-report']) {
    rmSync(path.join(repoRoot, dir), { recursive: true, force: true });
  }

  execFileSync(
    'npx',
    ['tsx', '--env-file=.env.local', 'scripts/e2e/cleanup-test-data.ts'],
    { cwd: repoRoot, stdio: 'inherit', shell: true },
  );
}
