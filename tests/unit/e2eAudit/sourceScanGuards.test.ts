// tests/unit/e2eAudit/sourceScanGuards.test.ts
//
// Source-scan guards for the e2e audit suite (Task 7.19, Req 1.6, 4.7, 34.4).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..', '..');

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (/\.(ts|mts|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('e2e audit source-scan guards', () => {
  const specFiles = walkTs(path.join(ROOT, 'tests', 'e2e', 'specs'));
  const harnessFiles = [
    ...walkTs(path.join(ROOT, 'tests', 'e2e', 'audit')),
    ...walkTs(path.join(ROOT, 'tests', 'e2e', 'support')),
  ];

  it('no waitForLoadState("networkidle") in specs or harness', () => {
    for (const file of [...specFiles, ...harnessFiles]) {
      const text = stripComments(readFileSync(file, 'utf8'));
      expect(text, file).not.toMatch(/waitForLoadState\(\s*['"]networkidle['"]\s*\)/);
    }
  });

  it('no E2E_ALLOW_PRODUCTION_SCHEMA in harness', () => {
    for (const file of harnessFiles) {
      const text = stripComments(readFileSync(file, 'utf8'));
      expect(text, file).not.toContain('E2E_ALLOW_PRODUCTION_SCHEMA');
    }
  });

  it('no @supabase/supabase-js import in Playwright harness or specs', () => {
    for (const file of [...specFiles, ...harnessFiles]) {
      const text = stripComments(readFileSync(file, 'utf8'));
      expect(text, file).not.toContain('@supabase/supabase-js');
    }
  });

  it('no raw force: true or dispatchEvent( in migrated Pathway specs', () => {
    for (const file of specFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\bforce:\s*true\b/);
      expect(text, file).not.toMatch(/\bdispatchEvent\(/);
    }
  });
});
