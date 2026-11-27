// lib/fees/feeLabels.ts
//
// How NoDitto's fees read to members. The ONLY fee wording, so every surface says the
// same thing.
//
// THE MODEL. A cash-sale buyer pays one Service_Fee on top of the price
// (`domain/fees/processingFee.ts`): a clean rate per currency and way of paying, e.g.
// "4%" by an Australian card in Australia, which covers Stripe's payment and
// payout costs and leaves NoDitto about 2% (NODITTO_FEE_BPS). A card issued outside the
// seller's card zone pays a dearer rate (0159), named by `otherCardRatesNote`. The seller receives exactly their price plus
// postage. Each trader pays a Trade_Fee of TRADE_FEE_BPS (2%) of the value they receive. A
// trade's cash leg in a converted currency also pays the Currency_Conversion fee
// (`domain/fees/fxFee.ts`); a cash sale does not, because it is charged on behalf of the
// seller.
//
// The rate labels are read from the same table the charge uses, so the copy cannot drift
// from what is collected, and they are EXACT: the fee is the label's rate applied to
// price plus postage, rounded to the cent. Copy never says "about" a rate.

import { NODITTO_FEE_BPS, bpsLabel, processingRateParts } from '@/domain/fees/processingFee';
import { TRADE_FEE_BPS } from '@/domain/trade/tradeFee';
import {
  cardTierPhrase,
  isCardMethod,
  paymentMethodDefinition,
  type PaymentMethodKind,
} from '@/domain/payments/paymentMethods';
import { formatMoney } from '@/lib/format';

/** The fee's name in money tables and breakdowns. */
export const PROCESSING_FEE_NAME = 'Buyer protection fee';

/** "2%": NoDitto's own share of the fee, approximately (the rates are rounded). */
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
  const domestic = processingFeeRateLabel(currency);
  return (['CARD_UK_EEA', 'CARD_INTERNATIONAL'] as const)
    .map((method) => {
      const cards = cardTierPhrase(currency, method);
      if (!cards) return null;
      // A tier that rounds to the domestic rate (Canada, Switzerland) is not dearer.
      if (processingFeeRateLabel(currency, method) === domestic) return null;
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
  return `The buyer protection fee is ${processingFeeRateLabel(currency)} of the price and postage by ${domestic ? `a card ${domestic}` : 'card'}.${others ? ` ${others}` : ''} Paying from your bank, where offered, can cost less.`;
}

/**
 * The fee in two short sentences, for the SELLER's popover beside the fee row in the
 * deal composer. The seller needs the rate, who pays it and what it is for; the
 * other card tiers and the bank rails are the buyer's choice, made at Pay, where the
 * Pay dialog prices them. `processingFeeExplanation` keeps the full version for Help.
 */
export function processingFeeShortNote(currency?: string | null): string {
  return `Paid by the buyer on top of your price: ${processingFeeRateLabel(currency)} by card.`;
}

/** Hint beside the fee row in a contract's money table. */
export const PROCESSING_FEE_HINT = `Returned if the sale is refunded in full.`;

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

/** "2%": the Trade_Fee each trader pays, of the value they receive. */
export function tradeFeeRateLabel(): string {
  return bpsLabel(TRADE_FEE_BPS);
}

/** Beside a trade's fee row. */
export const TRADE_FEE_NOTE =
  `NoDitto's fee is ${bpsLabel(TRADE_FEE_BPS)} of the value you receive, charged to your card once both holds are in place and refunded if the swap doesn't go ahead. Very small trades have no fee. The collateral is a card hold, so nothing is charged for it.`;

/**
 * The trade fee beside its row in the accept dialog: one line. The longer
 * {@link TRADE_FEE_NOTE} is for the trade terms, where there is room (UX review
 * 2026-11-26: the dialog stated the hold three times and pushed Accept below the fold).
 */
export const TRADE_FEE_SHORT_NOTE = `${bpsLabel(TRADE_FEE_BPS)} of the value you receive. Refunded if the swap doesn't go ahead.`;

/** The fee in one sentence, for the accept dialog and the trade terms. */
export const TRADE_FEE_SENTENCE = `Each trader pays NoDitto ${bpsLabel(TRADE_FEE_BPS)} of the value they receive.`;

/** Terms page, Fees section. */
export function termsFeeSentence(): string {
  return (
    'On a cash sale the buyer pays a buyer protection fee on top of the price: a fixed rate of the ' +
    `price and postage for each way of paying (for example ${processingFeeRateLabel('aud')} ` +
    'by an Australian card in Australia). A card issued outside the seller\'s country, or ' +
    'for a European seller outside the EEA or the UK, may pay a higher rate, because Stripe ' +
    'charges more for it. Every way of paying is shown ' +
    'with its rate and total before the buyer pays. The seller receives their price and ' +
    `postage in full. On a trade, each trader pays NoDitto ${bpsLabel(TRADE_FEE_BPS)} of the value ` +
    'they receive (the other side, plus any cash coming to them), charged once both card ' +
    'holds are in place and refunded if the exchange does not go ahead; a fee too small for ' +
    'Stripe to charge is not charged. Cash paid as part of a cross-border trade also ' +
    'pays the currency conversion fee, which covers the conversion at cost. If Stripe ' +
    'changes its pricing, the rates may change for sales agreed after that.'
  );
}
