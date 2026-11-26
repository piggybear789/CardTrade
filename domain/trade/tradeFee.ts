// domain/trade/tradeFee.ts
//
// The Trade_Fee: what each trader pays NoDitto for a 2-way trade. 2% PER TRADER of
// the value that trader RECEIVES (their counterpart's side plus any cash coming their
// way), product decision 2026-11-27. Before that it was 0.
//
// WHAT IT PAYS FOR. The collateral itself is an uncaptured card authorisation Stripe does
// not charge for, but a trade is not free to run: both traders' identity checks, staff
// arbitration of disputes, the custody backstop, and the card processing on a cash leg
// (absorbed by the platform; the payer pays only any Currency_Conversion fee, `fxFee.ts`).
//
// NO MINIMUM, AND NO FEE BELOW WHAT STRIPE CAN CHARGE. The fee is its own off-session card
// charge (it cannot come out of the collateral: a partial capture makes Stripe release the
// rest of the hold). Stripe refuses a charge under its minimum (US$0.50, £0.30, ...), and
// since ESC-29 an uncollected fee blocks the trade from locking, so a fee under
// `STRIPE_MINIMUM_CHARGE_MINOR` is waived to 0 rather than charged. At 2% that is a trader
// receiving less than about A$/US$25.
//
// `chargeTradeFees` skips a zero fee (no row, no provider call), and the charge, the lock
// check and the trade room's disclosure all call `tradeFeeCentsFor`, so they agree.
//
// Pure module: no I/O, no provider types. All amounts are integer minor units of the
// trade's currency.

import { percentageFeeMinor } from '../fees/percentageFee';

/** Trade fee rate per trader, in basis points: 2% of the value each trader receives. */
export const TRADE_FEE_BPS: number = 200;

/**
 * The smallest card charge Stripe accepts, per currency, in minor units (Stripe's
 * "minimum charge amount" table). A currency with no row uses US$0.50.
 */
export const STRIPE_MINIMUM_CHARGE_MINOR: Readonly<Record<string, number>> = {
  aud: 50,
  usd: 50,
  cad: 50,
  eur: 50,
  chf: 50,
  gbp: 30,
  bgn: 100,
  czk: 1500,
  dkk: 250,
  nok: 300,
  pln: 200,
  ron: 200,
  sek: 300,
};

/** Stripe's minimum card charge for `currency`, in its minor units. */
export function stripeMinimumChargeMinor(currency: string | null | undefined): number {
  return STRIPE_MINIMUM_CHARGE_MINOR[currency?.trim().toLowerCase() || 'aud'] ?? 50;
}

/**
 * The fee one Trader owes, in the trade currency's minor units: `rateBps` of the value
 * received, rounded to the nearest minor unit, with no minimum. A fee too small for
 * Stripe to charge is 0 (see the header).
 *
 * @param valueReceivedCents total Trade_Side_Value this Trader receives, including any
 *   cash coming their way.
 * @param currency the trade's ISO 4217 code, which decides Stripe's minimum charge.
 */
export function tradeFeeCentsFor(
  valueReceivedCents: number,
  currency: string | null,
  rateBps: number = TRADE_FEE_BPS,
): number {
  const fee = percentageFeeMinor(valueReceivedCents, rateBps);
  return fee < stripeMinimumChargeMinor(currency) ? 0 : fee;
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
  /** The trade's currency, which decides Stripe's minimum charge. */
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
