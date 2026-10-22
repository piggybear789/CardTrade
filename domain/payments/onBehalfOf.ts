// domain/payments/onBehalfOf.ts
//
// Which cash sales are charged ON BEHALF OF the seller (Stripe `on_behalf_of`).
//
// WHY. A EUR, GBP, CAD, CHF, ... sale lives on the US platform, whose own balance settles
// in USD. Charged as a plain platform charge, every such card is an INTERNATIONAL card to
// Stripe (+1.5%) and the money is converted EUR -> USD on the way in and USD -> EUR on the
// way out, which is what the 2% Currency_Conversion fee paid for. Charged on behalf of the
// seller's own connected account instead, Stripe prices the charge at the SELLER's
// country's rates (1.5% + EUR 0.25 for a standard EEA card) and settles it in the seller's
// currency, so nothing is converted. Verified in test mode on 2026-10-16: a EUR 100.00
// charge on behalf of a German account landed in the platform balance as EUR 100.00 (a
// plain charge landed as USD 112.17), and a EUR transfer against it to that account went
// through.
//
// WHAT DOES NOT CHANGE. It is still a separate charge on the PLATFORM: the money lands in
// the platform balance, is held until the buyer accepts, and is released by an explicit
// transfer. Refunds and disputes still debit the platform. Only the settlement merchant
// and the pricing move.
//
// WHY CURRENCY DECIDES IT. A contract's currency is its seller's region currency (0068),
// and a seller's Connect account country is that same region, fixed at creation. So a
// contract whose currency is not its platform's settlement currency always belongs to a
// seller in another country than the platform, and since 0136 every such seller's account
// carries the `card_payments` capability `on_behalf_of` needs. AUD on the AU platform and
// USD on the US platform are domestic and stay plain platform charges.
//
// THE COST. `on_behalf_of` needs the seller's account to exist and be able to take
// payments, so a cross-border seller must finish payout setup before a buyer can pay
// them. A domestic seller may still be paid later, as before.
//
// Pure module: no I/O, no provider types.

import { chargesCurrencyConversion } from '../fees/fxFee';

/** Whether a cash sale in `currency` is charged on behalf of its seller. */
export function chargesOnBehalfOfSeller(currency: string | null | undefined): boolean {
  return chargesCurrencyConversion(currency);
}
