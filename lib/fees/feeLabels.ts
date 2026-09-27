// lib/fees/feeLabels.ts
//
// How the Platform_Fee and Trade_Fee RATES read to members, e.g. "5%, min $1.50".
//
// Derived from the same constants the charge uses (`PLATFORM_FEE_BPS`, `TRADE_FEE_BPS`
// and the per-currency minimums in `domain/fees/feeMinimums.ts`), so the copy cannot
// drift from what is collected. Lives in `lib/` rather than `domain/` only because it
// formats money, and `formatMoney` is framework glue that `domain/` may not import.

import { PLATFORM_FEE_BPS } from '@/domain/orchestrator/cashSaleOrchestrator';
import { TRADE_FEE_BPS } from '@/domain/trade/tradeFee';
import {
  feeMinimumMinor,
  PLATFORM_FEE_MINIMUM_MINOR,
  TRADE_FEE_MINIMUM_MINOR,
} from '@/domain/fees/feeMinimums';
import { formatMoney } from '@/lib/format';

function rateLabel(
  rateBps: number,
  table: Readonly<Record<string, number>>,
  currency: string | null | undefined,
): string {
  const percent = `${rateBps / 100}%`;
  const minimum = feeMinimumMinor(table, currency);
  return minimum > 0 && currency ? `${percent}, min ${formatMoney(minimum, currency)}` : percent;
}

/** The Cash_Sale fee as members read it: "5%, min $1.50" (or "5%" with no floor). */
export function platformFeeRateLabel(currency: string | null | undefined): string {
  return rateLabel(PLATFORM_FEE_BPS, PLATFORM_FEE_MINIMUM_MINOR, currency);
}

/**
 * The Cash_Sale fee as a phrase for prose: "5% of the item price, with a minimum of
 * $1.50" (or "5% of the item price" with no floor).
 */
export function platformFeePhrase(currency: string | null | undefined): string {
  const base = `${PLATFORM_FEE_BPS / 100}% of the item price`;
  const minimum = feeMinimumMinor(PLATFORM_FEE_MINIMUM_MINOR, currency);
  return minimum > 0 && currency
    ? `${base}, with a minimum of ${formatMoney(minimum, currency)}`
    : base;
}

/** The per-trader Trade_Fee as members read it: "5%, min $1.00" (or "5%"). */
export function tradeFeeRateLabel(currency: string | null | undefined): string {
  return rateLabel(TRADE_FEE_BPS, TRADE_FEE_MINIMUM_MINOR, currency);
}
