// lib/fees/feeLabels.ts
//
// How the Platform_Fee and Trade_Fee read to members, e.g. "5%".
//
// Derived from the same constants the charge uses (`PLATFORM_FEE_BPS`, `TRADE_FEE_BPS`),
// so the copy cannot drift from what is collected. There is no fee minimum, so the
// label is the bare rate.
//
// BETA WAIVER. Every fee is waived while `BETA_FEE_WAIVER` (`domain/fees/betaFeeWaiver.ts`)
// is on. The rate labels below still return the STANDARD rate; the strings after them
// are the ONLY fee-waiver wording, so every surface says the same thing. Member copy
// says NoDitto is in OPEN BETA and that NoDitto's fees are waived, and names the normal
// rate. It never says "all fees": the Currency_Conversion fee (`domain/fees/fxFee.ts`)
// is a provider cost passed through and is still charged on a cross-border purchase.
// Never "$0.00 fee" in prose either. Money tables keep the numeric $0.00 so the arithmetic adds up,
// and put the waiver in the row label instead. No end date is promised.

import { BETA_FEE_WAIVER } from '@/domain/fees/betaFeeWaiver';
import { PLATFORM_FEE_BPS } from '@/domain/orchestrator/cashSaleOrchestrator';
import { TRADE_FEE_BPS } from '@/domain/trade/tradeFee';

function rateLabel(rateBps: number): string {
  return `${rateBps / 100}%`;
}

/** The Cash_Sale fee as members read it: "5%". */
export function platformFeeRateLabel(_currency?: string | null): string {
  return rateLabel(PLATFORM_FEE_BPS);
}

/** The Cash_Sale fee as a phrase for prose: "5% of the item price". */
export function platformFeePhrase(_currency?: string | null): string {
  return `${PLATFORM_FEE_BPS / 100}% of the item price`;
}

/** The per-trader Trade_Fee as members read it: "5%". */
export function tradeFeeRateLabel(_currency?: string | null): string {
  return rateLabel(TRADE_FEE_BPS);
}

/** Whether fees are waived for the beta. Read at call time, from the one switch. */
export function feesWaivedForBeta(): boolean {
  return BETA_FEE_WAIVER;
}

/** "Open beta: NoDitto fees waived (normally 5%)" — the sentence prose surfaces use. */
export function betaFeeNote(): string {
  return `Open beta: NoDitto fees waived (normally ${rateLabel(PLATFORM_FEE_BPS)})`;
}

/**
 * The explanatory form, for the popover and help: "We're waiving fees for now. The
 * standard fee is 5%, and we'll tell you before it applies."
 */
export function feeWaiverExplanation(): string {
  return `NoDitto is in open beta, so NoDitto fees are waived. We'll tell you before standard fees apply.`;
}

/** Under a listing's price while waived: the waiver explanation alone. */
export const LISTING_BETA_FEE_NOTE = feeWaiverExplanation();

/** Lower-case clause after a figure: "You'd pay $X, no fees for now (normally 5%)". */
export const NO_FEE_DURING_BETA = `NoDitto fees waived in open beta (normally ${rateLabel(PLATFORM_FEE_BPS)})`;

/** Catalog tile, replaces "incl. fees" while waived. Short form: no room for the rate. */
export const TILE_BETA_FEE_NOTE = 'no fees in open beta';

/** Hint beside a $0.00 fee row, whose label already names the normal rate. */
export const FEE_WAIVED_HINT = 'Waived during open beta.';

/** FeeInfoPopover while waived. */
export const FEE_POPOVER_WAIVED_TRIGGER = 'Fees waived in open beta. Show breakdown';
export const FEE_POPOVER_WAIVED_TITLE = 'NoDitto fees waived in open beta';
export const FEE_POPOVER_WAIVED_FOOTNOTE = `${feeWaiverExplanation()} Postage, if any, is agreed with the seller before you pay. A cross-border purchase still pays the currency conversion fee, which covers the conversion at cost.`;

/** Terms page. Keeps the notice that members will be told before standard fees apply. */
export const TERMS_BETA_FEE_SENTENCE = `NoDitto is in open beta, and NoDitto's platform fees on cash sales and trades are waived. The standard fee is ${rateLabel(PLATFORM_FEE_BPS)}, and members will be told before standard fees apply. The currency conversion fee on a cross-border purchase is a cost passed through and still applies.`;

/**
 * Parenthetical for a Cash_Sale fee row: "waived for now, normally 5%" when the
 * stored fee is 0, else "5%". Decided by the FIGURE, so a contract that stored a fee
 * before the waiver still reads "5%".
 */
export function platformFeeRowRate(feeCents: number): string {
  return feeCents === 0
    ? `waived in open beta, normally ${rateLabel(PLATFORM_FEE_BPS)}`
    : rateLabel(PLATFORM_FEE_BPS);
}

/** Same as `platformFeeRowRate`, for a Trade_Fee row. */
export function tradeFeeRowRate(feeCents: number): string {
  return feeCents === 0
    ? `waived in open beta, normally ${rateLabel(TRADE_FEE_BPS)}`
    : rateLabel(TRADE_FEE_BPS);
}
