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
// NO MINIMUM. Each trader pays a plain percentage of what they receive. A per-trader
// floor existed briefly and was removed deliberately (`domain/fees/percentageFee.ts`).
//
// Pure module: no I/O, no provider types. All amounts are integer minor units of the
// trade's currency.

import { percentageFeeMinor } from '../fees/percentageFee';

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
 * `rateBps` of the value received, rounded to the nearest minor unit, with no
 * minimum. A side receiving nothing owes nothing.
 *
 * @param valueReceivedCents total Trade_Side_Value this Trader receives, which
 *   includes any cash coming their way — a trader receiving $1,000 of card plus
 *   $150 cash has received $1,150 of value and is charged on all of it.
 * @param _currency the trade's ISO 4217 code. It does not affect the result and is
 *   kept so callers keep their signature.
 */
export function tradeFeeCentsFor(
  valueReceivedCents: number,
  _currency: string | null,
  rateBps: number = TRADE_FEE_BPS,
): number {
  return percentageFeeMinor(valueReceivedCents, rateBps);
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
  rateBps?: number;
}): TradeFeeSplit {
  const rate = params.rateBps ?? TRADE_FEE_BPS;
  return {
    initiatorFeeCents: tradeFeeCentsFor(params.initiatorReceivesCents, null, rate),
    counterpartFeeCents: tradeFeeCentsFor(params.counterpartReceivesCents, null, rate),
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
