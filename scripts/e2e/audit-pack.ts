// scripts/e2e/audit-pack.ts
//
// Packages `audit-report/` into `audit-report.zip`, refusing any forbidden
// artifact path (Task 17.2, Req 32.4).

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { isForbiddenArtifact } from '../../tests/e2e/audit/core/mask';

const ROOT = process.cwd();
const REPORT_DIR = path.join(ROOT, 'audit-report');
const ZIP_OUT = path.join(ROOT, 'audit-report.zip');

function assertNoForbiddenPaths(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (isForbiddenArtifact(rel)) {
      throw new Error(`Refusing to pack forbidden artifact path: ${rel}`);
    }
    if (entry.isDirectory()) assertNoForbiddenPaths(full);
  }
}

export function packAuditReport(): string {
  if (!existsSync(REPORT_DIR)) {
    throw new Error('audit-report/ does not exist; run `npm run audit:report` first.');
  }
  assertNoForbiddenPaths(REPORT_DIR);
  rmSync(ZIP_OUT, { force: true });

  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${REPORT_DIR}\\*' -DestinationPath '${ZIP_OUT}' -Force`,
    ], { stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-r', ZIP_OUT, '.'], { cwd: REPORT_DIR, stdio: 'inherit' });
  }
  console.log(`[audit-pack] Created ${ZIP_OUT}`);
  return ZIP_OUT;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  packAuditReport();
}
