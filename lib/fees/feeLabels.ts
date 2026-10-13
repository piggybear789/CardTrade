// lib/fees/feeLabels.ts
//
// How the Platform_Fee and Trade_Fee RATES read to members, e.g. "5%".
//
// Derived from the same constants the charge uses (`PLATFORM_FEE_BPS`, `TRADE_FEE_BPS`),
// so the copy cannot drift from what is collected. There is no fee minimum, so the
// label is the bare rate.

import { PLATFORM_FEE_BPS } from '@/domain/orchestrator/cashSaleOrchestrator';
import { TRADE_FEE_BPS } from '@/domain/trade/tradeFee';

function rateLabel(rateBps: number): string {
  return `${rateBps / 100}%`;
}

/** The Cash_Sale fee as members read it: "5%". */
export function platformFeeRateLabel(_currency?: string | null): string {
  return rateLabel(PLATFORM_FEE_BPS);
}

/** The Cash_Sale fee as a phrase for prose: "5% of the item price". */
export function platformFeePhrase(_currency?: string | null): string {
  return `${PLATFORM_FEE_BPS / 100}% of the item price`;
}

/** The per-trader Trade_Fee as members read it: "5%". */
export function tradeFeeRateLabel(_currency?: string | null): string {
  return rateLabel(TRADE_FEE_BPS);
}
