// domain/fees/fxFee.ts
//
// The Currency_Conversion fee: what a BUYER pays on top of the price when the contract's
// currency is not the currency its Stripe platform settles in.
//
// WHY IT EXISTS. The US platform's balance holds USD only (verified in test mode,
// 2026-10-13). A EUR contract on it is converted EUR -> USD when the buyer is charged and
// USD -> EUR when the seller is paid, and Stripe takes a margin on each leg (the FX quote
// reported `fx_fee_rate: 0.01` for the payout leg). The product decision is that the
// BUYER absorbs that cost and the SELLER receives exactly the agreed amount, so the buyer
// is charged this fee and the payout is sized from a locked FX quote
// (`StripeService.payoutToMerchant`).
//
// NOT WAIVED BY THE BETA. `BETA_FEE_WAIVER` waives NoDitto's own fee. This one passes a
// provider cost through, the same way shipping does; waiving it would make every
// cross-currency sale a loss.
//
// WHY A CURRENCY AND NOT A PLATFORM ARGUMENT. Every currency maps to exactly one
// platform (AUD only to AU; USD, EUR, GBP, CAD, CHF, ... only to US), so the currency
// alone decides. That keeps this callable from the browser for the disclosure and from
// the orchestrator for the charge, with nothing to pass that the two could disagree on.
//
// Pure module: no I/O, no provider types.

import { REGIONS, needsCurrencyConversion } from '@/domain/region/regions';

/**
 * The fee rate in basis points: Stripe's ~1% on each of the two conversions.
 *
 * Rounded UP per contract (see {@link currencyConversionFeeFor}) so the platform is
 * never short. Tune this, not the call sites, if Stripe's FX pricing changes.
 */
export const FX_FEE_BPS = 200;

/** The platform whose balance holds money in `currency`, or null when no trading region uses it. */
export function platformForCurrency(currency: string | null | undefined): string | null {
  const code = currency?.trim().toLowerCase();
  if (!code) return null;
  const region = REGIONS.find((r) => r.tradingEnabled && r.currency === code);
  return region?.platform ?? null;
}

/** Whether a contract in `currency` is converted by its platform, so the fee applies. */
export function chargesCurrencyConversion(currency: string | null | undefined): boolean {
  return needsCurrencyConversion(currency, platformForCurrency(currency));
}

/**
 * The Currency_Conversion fee on `amountMinor` (the contract total the buyer pays),
 * in the contract's own minor units. Zero when no conversion happens.
 *
 * Rounded UP rather than to nearest, because this covers a cost rather than earning a
 * margin: rounding down would leave the platform a fraction short on every sale.
 */
export function currencyConversionFeeFor(
  amountMinor: number,
  currency: string | null | undefined,
): number {
  if (!chargesCurrencyConversion(currency)) return 0;
  const base = Math.max(Math.trunc(amountMinor), 0);
  if (base === 0) return 0;
  return Math.ceil((base * FX_FEE_BPS) / 10_000);
}

/** What the buyer's card is actually charged: the contract total plus the conversion fee. */
export function buyerChargeMinorFor(amountMinor: number, currency: string | null | undefined): number {
  return Math.max(Math.trunc(amountMinor), 0) + currencyConversionFeeFor(amountMinor, currency);
}
