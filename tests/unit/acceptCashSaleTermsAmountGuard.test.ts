// tests/unit/acceptCashSaleTermsAmountGuard.test.ts
//
// ESC-31: the buyer is charged only the total the Pay dialog showed.

import { describe, expect, it } from 'vitest';

import { acceptCashSaleTerms } from '@/domain/orchestrator/cashSaleOrchestrator';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { BUYER } from './fakes/cashSaleRepository';
import { agreedSale } from './helpers/agreedSale';

async function setup() {
  const { deps, id, termsVersion } = await agreedSale(new InMemoryService());
  const sale = await deps.repository.loadCashSale(id);
  return { deps, id, termsVersion, amountCents: sale!.amountCents };
}

describe('acceptCashSaleTerms amount guard (ESC-31)', () => {
  it('refuses when the shown total differs from the contract', async () => {
    const { deps, id, termsVersion, amountCents } = await setup();
    const result = await acceptCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: id,
      termsVersion,
      expectedAmountCents: amountCents - 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('STALE_TERMS');
  });

  it('does not refuse on amount when the shown total matches', async () => {
    const { deps, id, termsVersion, amountCents } = await setup();
    const result = await acceptCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: id,
      termsVersion,
      expectedAmountCents: amountCents,
    });
    if (!result.ok) expect(result.error).not.toBe('STALE_TERMS');
  });
});
