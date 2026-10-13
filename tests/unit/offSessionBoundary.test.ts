// tests/unit/offSessionBoundary.test.ts
//
// ESC-29: off-session charging is for collateral holds and the Trade_Fee only. Money
// forwarded to a member (`merchantRef`) must be collected with the payer present.
// Every binding refuses the combination before any provider call, unless the legacy
// trade-cash flag is set, and that flag may appear in exactly one caller.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { MockService } from '@/domain/services/mock/MockService';

const base = { payerId: 'payer_1', amount: 1_000, ref: 'r', nonce: 'n' };

describe.each([
  ['InMemoryService', () => new InMemoryService()],
  ['MockService', () => new MockService({ isolatedLedger: true } as never)],
])('%s off-session boundary', (_name, make) => {
  it('refuses merchantRef without presence', async () => {
    const result = await make().requestTransfer({ ...base, merchantRef: 'acct_1' });
    expect(result.status).toBe('FAILED');
  });
  it('allows the legacy flag', async () => {
    const result = await make().requestTransfer({ ...base, nonce: 'n2', merchantRef: 'acct_1', legacyOffSessionToMember: true });
    expect(result.status).toBe('SETTLED');
  });
  it('allows a fee charge with neither (no merchantRef)', async () => {
    const result = await make().requestTransfer({ ...base, nonce: 'n3' });
    expect(result.status).toBe('SETTLED');
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe('legacyOffSessionToMember is used in one place', () => {
  it('appears only in lib/trades/completion.ts and domain/services/**', () => {
    const root = process.cwd();
    const users = ['app', 'components', 'domain', 'lib']
      .flatMap((dir) => walk(join(root, dir)))
      .filter((path) => readFileSync(path, 'utf8').includes('legacyOffSessionToMember'))
      .map((path) => relative(root, path).replace(/\\/g, '/'))
      .filter((path) => !path.startsWith('domain/services/'));
    expect(users).toEqual(['lib/trades/completion.ts']);
  });
});
