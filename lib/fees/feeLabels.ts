// lib/fees/feeLabels.ts
//
// How NoDitto's fees read to members. The ONLY fee wording, so every surface says the
// same thing.
//
// THE MODEL. A cash-sale buyer pays one Service_Fee on top of the price
// (`domain/fees/processingFee.ts`): a clean rate per currency and way of paying, e.g.
// "3% + A$0.60" by an Australian card in Australia, which covers Stripe's payment and
// payout costs and leaves NoDitto about 1% (NODITTO_FEE_BPS). A card issued outside the
// seller's card zone pays a dearer rate (0159), named by `otherCardRatesNote`. The seller receives exactly their price plus
// postage. Trades carry no fee: their collateral is a card hold that costs nothing. A
// trade's cash leg in a converted currency also pays the Currency_Conversion fee
// (`domain/fees/fxFee.ts`); a cash sale does not, because it is charged on behalf of the
// seller.
//
// The rate labels are read from the same table the charge uses, so the copy cannot drift
// from what is collected, and they are EXACT: the fee is the label's rate applied to
// price plus postage, rounded to the cent. Copy never says "about" a rate.

import { NODITTO_FEE_BPS, bpsLabel, processingRateParts } from '@/domain/fees/processingFee';
import {
  cardTierPhrase,
  isCardMethod,
  paymentMethodDefinition,
  type PaymentMethodKind,
} from '@/domain/payments/paymentMethods';
import { formatMoney } from '@/lib/format';

/** The fee's name in money tables and breakdowns. */
export const PROCESSING_FEE_NAME = 'Buyer protection fee';

/** "1%": NoDitto's own share of the fee, approximately (the rates are rounded). */
export function nodittoFeeRateLabel(): string {
  return bpsLabel(NODITTO_FEE_BPS);
}

/**
 * "3% + A$0.60": the whole fee for a sale in `currency` paid with `method` (card by
 * default), of price plus postage. Exact.
 */
export function processingFeeRateLabel(
  currency?: string | null,
  method: PaymentMethodKind = 'CARD',
): string {
  const code = currency?.trim().toLowerCase() || 'aud';
  const { percent, fixedMinor } = processingRateParts(code, method);
  // No fixed part since 2026-11-24 (NoDitto absorbs Stripe's per-sale fixed fee), so the
  // label is the plain percentage. Kept conditional in case a rail ever needs one again.
  return fixedMinor === 0 ? percent : `${percent} + ${formatMoney(fixedMinor, code)}`;
}

/**
 * The dearer card rates on a contract in `currency` (0159), e.g. "Cards issued outside
 * Australia: 5% + $0.60 AUD." Stripe charges more for a card from outside the seller's
 * card zone, and so does the fee. Empty for a currency with no card zone.
 */
export function otherCardRatesNote(currency?: string | null): string {
  return (['CARD_UK_EEA', 'CARD_INTERNATIONAL'] as const)
    .map((method) => {
      const cards = cardTierPhrase(currency, method);
      if (!cards) return null;
      return `Cards ${cards}: ${processingFeeRateLabel(currency, method)}.`;
    })
    .filter((line): line is string => Boolean(line))
    .join(' ');
}

/**
 * Which cards a card tier's rate is for, as a clause: "the rate for a card issued
 * outside Australia". Empty for a domestic card or a bank rail, which need no clause.
 */
export function cardTierClause(currency: string | null | undefined, method: PaymentMethodKind): string {
  if (!isCardMethod(method) || method === 'CARD') return '';
  const cards = cardTierPhrase(currency, method);
  return cards ? `the rate for a card ${cards}` : '';
}

/** What the fee is, in a few sentences, for prose and popovers. */
export function processingFeeExplanation(currency?: string | null): string {
  const domestic = cardTierPhrase(currency, 'CARD');
  const others = otherCardRatesNote(currency);
  return `The buyer protection fee is ${processingFeeRateLabel(currency)} of the price and postage by ${domestic ? `a card ${domestic}` : 'card'}.${others ? ` ${others}` : ''} Most of it goes to Stripe for taking the payment and paying the seller. NoDitto keeps about ${nodittoFeeRateLabel()} on larger sales, less on small ones. Paying from your bank, where offered, can cost less.`;
}

/**
 * The fee in two short sentences, for the SELLER's popover beside the fee row in the
 * deal composer. The seller needs the rate, who pays it and what it is for; the
 * other card tiers and the bank rails are the buyer's choice, made at Pay, where the
 * Pay dialog prices them. `processingFeeExplanation` keeps the full version for Help.
 */
export function processingFeeShortNote(currency?: string | null): string {
  return `Paid by the buyer on top of your price: ${processingFeeRateLabel(currency)} by card. Most of it goes to Stripe. NoDitto keeps about ${nodittoFeeRateLabel()} on larger sales, less on small ones.`;
}

/** Hint beside the fee row in a contract's money table. */
export const PROCESSING_FEE_HINT = `Most of it goes to Stripe for the payment and payout. NoDitto keeps about ${bpsLabel(NODITTO_FEE_BPS)} on larger sales, less on small ones. Returned if the sale is refunded in full.`;

/**
 * What a dispute means on a rail, said to the BUYER, whose protection is NoDitto's
 * escrow on every rail. The difference is only what their bank can do on top.
 */
export function paymentMethodProtectionNote(method: PaymentMethodKind): string {
  switch (paymentMethodDefinition(method).disputes) {
    case 'NONE':
      return 'Final once approved in your bank. Your protection is the NoDitto hold: the seller is paid only after you accept the item.';
    case 'FINAL':
      return 'Your protection is the NoDitto hold: the seller is paid only after you accept the item.';
    case 'CONTESTABLE':
    default:
      return 'The seller is paid only after you accept the item.';
  }
}

/** Where a trade would show a fee. */
export const TRADE_NO_FEE_NOTE =
  "Trades have no NoDitto fee. The collateral is a card hold, which costs nothing.";

/** Terms page, Fees section. */
export function termsFeeSentence(): string {
  return (
    'On a cash sale the buyer pays a buyer protection fee on top of the price: a fixed rate of the ' +
    `price and postage for each way of paying (for example ${processingFeeRateLabel('aud')} ` +
    'by an Australian card in Australia). A card issued outside the seller\'s country, or ' +
    'for a European seller outside the EEA or the UK, pays a higher rate, because Stripe ' +
    'charges more for it. Most of it goes to Stripe for taking the payment and paying the ' +
    `seller. NoDitto keeps about ${nodittoFeeRateLabel()} on larger sales, less on small ones. Every way of paying is shown ` +
    'with its rate and total before the buyer pays. The seller receives their price and ' +
    'postage in full. Trades have no fee. Cash paid as part of a cross-border trade also ' +
    'pays the currency conversion fee, which covers the conversion at cost. If Stripe ' +
    'changes its pricing, the rates may change for sales agreed after that.'
  );
}
