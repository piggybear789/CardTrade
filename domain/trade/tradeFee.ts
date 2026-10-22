// domain/trade/tradeFee.ts
//
// The Trade_Fee: what each trader pays NoDitto for a 2-way trade. It is ZERO.
//
// WHY ZERO. NoDitto passes Stripe's costs through and takes no margin of its own
// (`domain/fees/processingFee.ts`). A swap's only money movement is the collateral: an
// uncaptured card authorisation that is voided when the trade completes, which Stripe
// does not charge for. So there is no provider cost on the swap to pass through, and a
// fee charged to cover nothing would itself incur a Stripe card fee.
//
// The machinery stays, at a rate of 0: `chargeTradeFees` skips a zero fee (no row, no
// provider call), and `resolveTradeFees` and the disclosure still call one function, so
// a fee can be reintroduced by changing `TRADE_FEE_BPS` alone.
//
// A trade's CASH LEG is a real card payment and does cost Stripe's card fee. The payer
// already pays any Currency_Conversion fee on it (`fxFee.ts`); the card processing on it
// is absorbed by the platform for now.
//
// Pure module: no I/O, no provider types. All amounts are integer minor units of the
// trade's currency.

import { percentageFeeMinor } from '../fees/percentageFee';

/** Trade fee rate per trader, in basis points. 0: trades carry no NoDitto fee. */
export const TRADE_FEE_BPS: number = 0;

/**
 * The fee one Trader owes, in the trade currency's minor units: `rateBps` of the value
 * received, rounded to the nearest minor unit, with no minimum. 0 at the default rate.
 *
 * @param valueReceivedCents total Trade_Side_Value this Trader receives, including any
 *   cash coming their way.
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
