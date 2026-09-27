// domain/trade/tradeFee.ts
//
// The Trade_Fee: the platform's cut of a 2-way trade.
//
// WHY THIS EXISTS AT ALL. A trade used to generate no revenue, and not by
// oversight — the only money movement on a trade is a collateral authorisation
// that gets voided, and you cannot skim a fee from money you release. So a trade
// fee has to be its own collection.
//
// WHY IT IS NOT TAKEN FROM THE BOND. `partialCapture` on each trader's existing
// hold would reuse a primitive we already have, and it was rejected twice over:
//
//   1. Authorisations lapse in about seven days and extended authorization is not
//      available on this account, so a DELIVERY trade completing on day nine would
//      have nothing left to capture. Fee collection would fail on exactly the
//      trades that take longest.
//   2. It would falsify the promise the product rests on — "your bond is released
//      in full unless something goes wrong". Capturing from the bond on a
//      SUCCESSFUL trade makes that sentence untrue.
//
// So the fee is charged at the Commitment_Point (both sides accepting the same
// terms), separately from the bond, and is refundable if the trade never ships.
//
// SYMMETRY. On a trade there is no seller: both parties give and both receive. The
// fee is therefore charged to BOTH traders, each on the value they RECEIVE, which
// is what each one is getting out of the exchange. The two fees are unequal
// whenever the sides differ in value — that is correct, not a rounding fault.
//
// MINIMUM. The percentage is floored per trader by `TRADE_FEE_MINIMUM_MINOR`
// (`domain/fees/feeMinimums.ts`), because each fee is a separate card charge with a
// fixed provider cost.
//
// Pure module: no I/O, no provider types. All amounts are integer minor units of the
// trade's currency.

import {
  feeMinimumMinor,
  percentageFeeWithMinimum,
  TRADE_FEE_MINIMUM_MINOR,
} from '../fees/feeMinimums';

/**
 * Trade fee rate per trader, in basis points (1 bp = 0.01%), so 500 bp = 5% each.
 *
 * Held in basis points rather than a float percentage for the same reason as
 * `PLATFORM_FEE_BPS`: the fee stays exact integer arithmetic end to end.
 */
export const TRADE_FEE_BPS = 500;

/**
 * The fee one Trader owes, in the trade currency's minor units.
 *
 * `rateBps` of the value received, raised to the currency's per-trader minimum
 * (`TRADE_FEE_MINIMUM_MINOR`, $1.00 in AUD). Each trader's fee is its own card
 * charge with a fixed provider cost, so without a floor a small swap cost more to
 * collect than it earned. A side receiving nothing still owes nothing, and a
 * currency with no floor on file gets the plain percentage.
 *
 * @param valueReceivedCents total Trade_Side_Value this Trader receives, which
 *   includes any cash coming their way — a trader receiving $1,000 of card plus
 *   $150 cash has received $1,150 of value and is charged on all of it.
 * @param currency the trade's ISO 4217 code (`trades.currency`). Required rather
 *   than defaulted, because the floor is a money amount in that currency.
 */
export function tradeFeeCentsFor(
  valueReceivedCents: number,
  currency: string | null,
  rateBps: number = TRADE_FEE_BPS,
): number {
  return percentageFeeWithMinimum(
    valueReceivedCents,
    rateBps,
    feeMinimumMinor(TRADE_FEE_MINIMUM_MINOR, currency),
  );
}

/** What each side of a trade owes the platform. */
export interface TradeFeeSplit {
  initiatorFeeCents: number;
  counterpartFeeCents: number;
}

/**
 * Resolve both Traders' fees from what each one receives.
 *
 * `initiatorReceivesCents` is the value of the COUNTERPART's bundle (plus cash
 * flowing to the initiator), and vice versa — the parameters are named for the
 * recipient, not the contributor, because that is the fee base.
 */
export function resolveTradeFees(params: {
  initiatorReceivesCents: number;
  counterpartReceivesCents: number;
  /** The trade's ISO 4217 code, which selects the per-trader minimum. */
  currency: string | null;
  rateBps?: number;
}): TradeFeeSplit {
  const rate = params.rateBps ?? TRADE_FEE_BPS;
  return {
    initiatorFeeCents: tradeFeeCentsFor(params.initiatorReceivesCents, params.currency, rate),
    counterpartFeeCents: tradeFeeCentsFor(params.counterpartReceivesCents, params.currency, rate),
  };
}

/** Lifecycle of one Trader's fee collection. */
export type TradeFeeStatus = 'PENDING' | 'SETTLED' | 'FAILED' | 'REFUNDED';

/**
 * Whether a fee is owed back to the Trader.
 *
 * Only a SETTLED fee can be refunded: a PENDING one was never collected and a
 * FAILED one took nothing, so refunding either would spend the platform's own
 * money. This mirrors the reasoning on the Cash_Sale refund nonce.
 */
export function isTradeFeeRefundable(status: TradeFeeStatus): boolean {
  return status === 'SETTLED';
}
