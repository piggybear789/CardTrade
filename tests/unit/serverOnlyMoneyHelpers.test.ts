// tests/unit/serverOnlyMoneyHelpers.test.ts
//
// ESC-32 / ESC-35: every export of a `'use server'` module is a public endpoint,
// addressable by anyone who learns its id. Two helpers were exported that way and
// should not have been:
//
//   * `proposeTrade` — the legacy one-step proposal that forced a counterparty
//     straight into collateral. Deleted; the negotiation flow replaced it.
//   * `pushVerifiedIdentityToConnect(profileId)` — took ANY profile id with no session
//     read. Moved to `lib/identity/pushVerifiedIdentity.ts` (`server-only`).
//
// The third check is a HEURISTIC, listed so it can be relaxed knowingly: no
// `'use server'` export may take a first parameter named `profileId` unless its body
// reads the session. A Server Action acts as its caller; a profile id from the caller
// is the shape of "act on behalf of whoever I name".

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function useServerModules(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) {
        const head = readFileSync(full, 'utf8').slice(0, 400);
        if (/^\s*['"]use server['"]/m.test(head)) out.push(full);
      }
    }
  };
  walk(path.join(ROOT, 'lib'));
  walk(path.join(ROOT, 'app'));
  if (out.length === 0) throw new Error('found no use-server modules; the scan is broken');
  return out;
}

describe('server-only money helpers', () => {
  it('pushVerifiedIdentity.ts is server-only', () => {
    const source = readFileSync(path.join(ROOT, 'lib/identity/pushVerifiedIdentity.ts'), 'utf8');
    expect(source).toMatch(/^\s*(\/\/[^\n]*\n|\s)*import 'server-only';/);
  });

  it('no use-server module exports proposeTrade or pushVerifiedIdentityToConnect', () => {
    const offenders: string[] = [];
    for (const file of useServerModules()) {
      const source = readFileSync(file, 'utf8');
      if (/export\s+(const|async\s+function|function)\s+(proposeTrade|pushVerifiedIdentityToConnect)\b/.test(source)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no use-server export takes a caller-supplied profileId without reading the session', () => {
    const offenders: string[] = [];
    const head = /export const (\w+) = withActionLog\([^,]+,\s*async function \w+\(\s*profileId\b/g;
    for (const file of useServerModules()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(head)) {
        // The body up to the next top-level export.
        const rest = source.slice(match.index!);
        const next = rest.slice(1).search(/\nexport /);
        const body = next === -1 ? rest : rest.slice(0, next + 1);
        if (!/getUser\(|getCachedAuthUser\(|getUserId\(|requireStaff\(|requireAdmin\(/.test(body)) {
          offenders.push(`${path.relative(ROOT, file)}: ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
