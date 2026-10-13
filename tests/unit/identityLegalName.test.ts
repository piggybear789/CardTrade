// tests/unit/identityLegalName.test.ts
//
// ESC-25: the contract room's counterparty name (`lib/actions/identity.ts`) must apply
// the SAME rule as the buy-path disclosure. Both call `disclosedLegalName`; this test
// pins that call site by reading the source, and runs the shared case table.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { disclosedLegalName } from '@/domain/orchestrator/merchantOnboarding';
import { LEGAL_NAME_CASES } from './fixtures/legalNameCases';

describe('contract-room legal name (ESC-25)', () => {
  it('lib/actions/identity.ts derives the name through disclosedLegalName with the grandfather column', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'actions', 'identity.ts'), 'utf8');
    expect(source).toContain('disclosedLegalName({');
    expect(source).toContain('identity_grandfathered_at');
    // The old unconditional fallback must not come back.
    expect(source).not.toMatch(/identity_check_name as string \| null\) \?\?\s*\(data\.merchant_legal_entity_name/);
  });

  it.each(LEGAL_NAME_CASES)('$name', (c) => {
    expect(
      disclosedLegalName({
        identityCheckName: c.identityCheckName,
        connectLegalName: c.connectLegalName,
        identityGrandfatheredAt: c.identityGrandfatheredAt,
      }),
    ).toBe(c.expected);
  });
});
