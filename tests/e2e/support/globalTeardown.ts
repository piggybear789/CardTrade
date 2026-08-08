// tests/e2e/support/globalTeardown.ts
//
// Runs once after the whole suite finishes (pass or fail), removing every
// [E2E]-marked row this run created. See globalSetup.ts and
// scripts/e2e/cleanup-test-data.ts for why this is marker-based deletion
// rather than in-memory ID tracking.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

export default async function globalTeardown() {
  execFileSync(
    'npx',
    ['tsx', '--env-file=.env.local', 'scripts/e2e/cleanup-test-data.ts'],
    { cwd: repoRoot, stdio: 'inherit', shell: true },
  );
}
