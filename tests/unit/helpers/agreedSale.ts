// Shared setup for the ESC-03 buyer-present payment tests: a sale with agreed
// delivery terms, ready for the buyer to press Pay.

import {
  initiateCashSale,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { BUYER, ITEM, fakeTracking, makeCashSaleRepository } from '../fakes/cashSaleRepository';
import { DELIVERY_TERMS, PURCHASE } from './disputedCashSale';

export async function agreedSale(payments: InMemoryService) {
  const { repository } = makeCashSaleRepository();
  const deps: CashSaleOrchestratorDeps = { repository, payments, tracking: fakeTracking };
  const created = await initiateCashSale(deps, PURCHASE);
  if (!created.ok) throw new Error(`setup: ${created.error}`);
  const id = created.sale.id;
  const priced = await updateCashSaleTerms(deps, {
    cashSaleId: id,
    actorId: ITEM.ownerId,
    expectedTermsVersion: created.sale.termsVersion,
    terms: { ...DELIVERY_TERMS, deliveryAddress: undefined },
  });
  if (!priced.ok) throw new Error('setup: price');
  await updateCashSaleTerms(deps, {
    cashSaleId: id,
    actorId: BUYER.profileId,
    expectedTermsVersion: priced.sale.termsVersion,
    terms: DELIVERY_TERMS,
  });
  const sale = await deps.repository.loadCashSale(id);
  return { deps, id, termsVersion: sale!.termsVersion };
}
