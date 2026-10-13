// tests/unit/sellerIdentityDisclosure.test.ts
//
// ESC-25: the Connect-name fallback is for the members 0069 grandfathered, recorded in
// `identity_grandfathered_at`, and nobody else. Shares its case table with
// `identityLegalName.test.ts` so the buy-path disclosure and the contract-room name
// stay the same rule.

import { describe, expect, it } from 'vitest';

import {
  disclosedLegalName,
  sellerIdentityDisclosure,
  type MerchantRecord,
} from '@/domain/orchestrator/merchantOnboarding';
import { LEGAL_NAME_CASES } from './fixtures/legalNameCases';

function merchant(c: (typeof LEGAL_NAME_CASES)[number]): MerchantRecord {
  return {
    profileId: 'seller-1',
    merchantRef: 'acct_1',
    merchantStatus: 'APPROVED',
    liveEnabled: true,
    transactionsEnabled: true,
    settlementsEnabled: true,
    legalEntityName: c.connectLegalName,
    identityDisclosureConsentedAt: '2026-01-01T00:00:00.000Z',
    identityVerifiedAt: '2026-01-01T00:00:00.000Z',
    identityCheckStatus: 'VERIFIED',
    identityCheckName: c.identityCheckName,
    identityCheckVerifiedAt: '2026-01-01T00:00:00.000Z',
    identityGrandfatheredAt: c.identityGrandfatheredAt,
  };
}

describe('sellerIdentityDisclosure legal name (ESC-25)', () => {
  it.each(LEGAL_NAME_CASES)('$name', (c) => {
    expect(disclosedLegalName({
      identityCheckName: c.identityCheckName,
      connectLegalName: c.connectLegalName,
      identityGrandfatheredAt: c.identityGrandfatheredAt,
    })).toBe(c.expected);
    const disclosure = sellerIdentityDisclosure(merchant(c));
    expect(disclosure?.legalEntityName ?? null).toBe(c.expected);
  });
});
