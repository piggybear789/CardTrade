// domain/fees/betaFeeWaiver.ts
//
// The ONE switch that waives every platform fee during the beta: the Cash_Sale
// Platform_Fee and the per-trader Trade_Fee both read it, through `effectiveFeeBps`.
// The standard rates (`PLATFORM_FEE_BPS`, `TRADE_FEE_BPS`, 5% each) stay defined.
//
// WHY A CODE CONSTANT, NOT AN ENV VAR. The fee is DISCLOSED on the client and
// CHARGED on the server. An environment variable can differ between the two (or
// between deployments), which would show one fee and charge another. A constant
// compiles into both from the same source.
//
// ENDING THE BETA means flipping this constant AND `Money.betaFeeWaiver` in
// `flutter_app/lib/core/money.dart`; `tests/unit/mobileDomainAgreement.test.ts` pins
// the two together. Members must be told before standard fees apply (Terms page).
//
// ACCEPTED COST. While waived the platform absorbs Stripe's card and payout costs on
// every sale, with no fee revenue to cover them. Contracts that already stored a fee
// keep it; nothing here rewrites a stored fee.
//
// Pure module: no I/O, no provider types.

/** True while every platform fee is waived for the beta. */
export const BETA_FEE_WAIVER = true;

/**
 * The fee rate actually applied: 0 while waived, otherwise `standardBps`.
 *
 * `waived` defaults to the switch and exists so tests can cover both sides of it
 * without mocking a module.
 */
export function effectiveFeeBps(standardBps: number, waived: boolean = BETA_FEE_WAIVER): number {
  return waived ? 0 : standardBps;
}
