// tests/unit/actionLogCoverage.test.ts
//
// Every Server Action is exported through `withActionLog`, so a failed action lands in
// `cardtrade.error_logs` (0123) without anyone remembering to log it.
//
// WHY A SOURCE CHECK. The wrapper is only as complete as its adoption: one action
// added as a plain `export async function` is one action whose failures are invisible,
// and nothing else would notice. The check also pins each name to `<module>.<export>`,
// because that name is the group key on the console — a copy-pasted name would file
// one action's failures under another.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ACTIONS_DIR = path.resolve(__dirname, '../../lib/actions');

/**
 * Modules deliberately NOT wrapped, each with its reason.
 * - `errorReports.ts`: a report that fails to save would only log itself into the
 *   same table it just failed to write.
 */
const NOT_WRAPPED = new Set(['errorReports.ts']);

function useServerModules(): { file: string; source: string }[] {
  return readdirSync(ACTIONS_DIR)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ file, source: readFileSync(path.join(ACTIONS_DIR, file), 'utf8') }))
    .filter(({ source }) => /^\s*['"]use server['"];?/.test(source));
}

describe('Server Action error logging coverage', () => {
  const modules = useServerModules();

  it('finds the action modules at all', () => {
    // A vacuous pass is worse than no check: if the directory moves, fail loudly.
    expect(modules.length).toBeGreaterThan(20);
  });

  it('exports every action through withActionLog', () => {
    const unwrapped: string[] = [];
    for (const { file, source } of modules) {
      if (NOT_WRAPPED.has(file)) continue;
      for (const match of source.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) {
        unwrapped.push(`${file}: ${match[1]}`);
      }
    }
    expect(unwrapped, 'wrap these as `export const X = withActionLog(...)`').toEqual([]);
  });

  it('names each action <module>.<export>', () => {
    const misnamed: string[] = [];
    for (const { file, source } of modules) {
      const moduleName = file.replace(/\.ts$/, '');
      for (const match of source.matchAll(
        /^export\s+const\s+(\w+)\s*=\s*withActionLog\(\s*'([^']+)'/gm,
      )) {
        const expected = `${moduleName}.${match[1]}`;
        if (match[2] !== expected) misnamed.push(`${file}: ${match[2]} should be ${expected}`);
      }
    }
    expect(misnamed).toEqual([]);
  });
});
