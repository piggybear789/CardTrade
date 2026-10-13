// Settlement parameters bound to a sale's own collection (ESC-37).
//
// `settleCashSale` refuses a settlement whose payment ref or amount does not match
// the sale's recorded `transferId` and `amountCents`, so a test that drives the
// webhook half of payment reads both back from the repository first.

import type { CashSaleOrchestratorDeps } from '@/domain/orchestrator/cashSaleOrchestrator';

export async function settlementFor(
  deps: CashSaleOrchestratorDeps,
  cashSaleId: string,
): Promise<{ cashSaleId: string; paymentRef: string; amountReceived: number }> {
  const sale = await deps.repository.loadCashSale(cashSaleId);
  return {
    cashSaleId,
    paymentRef: sale?.transferId ?? '',
    amountReceived: sale?.amountCents ?? -1,
  };
}
