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
// are the ONLY beta-fee wording, so every surface says the same thing. Prose never says
// "$0.00 fee": it says there are no fees during beta and names the normal rate. Money
// tables keep the numeric $0.00 so the arithmetic adds up, and put the waiver in the
// row label instead. No end date is promised.

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

/** "No fees during beta (normally 5%)" — the one sentence prose surfaces use. */
export function betaFeeNote(): string {
  return `No fees during beta (normally ${rateLabel(PLATFORM_FEE_BPS)})`;
}

/** Under a listing's price while waived. */
export const LISTING_BETA_FEE_NOTE = 'No buyer fee during beta';

/** Lower-case clause after a figure: "You'd pay $X, no fee during beta". */
export const NO_FEE_DURING_BETA = 'no fee during beta';

/** Catalog tile, replaces "incl. fees" while waived. */
export const TILE_BETA_FEE_NOTE = 'no fees in beta';

/** Hint beside a $0.00 fee row. */
export const FEE_WAIVED_HINT = 'No fee during beta.';

/** FeeInfoPopover while waived. */
export const FEE_POPOVER_WAIVED_TRIGGER = 'No buyer fee during beta. Show breakdown';
export const FEE_POPOVER_WAIVED_TITLE = 'No NoDitto fee during beta';
export const FEE_POPOVER_WAIVED_FOOTNOTE =
  'Fees are waived during the beta. Postage, if any, is agreed with the seller before you pay.';

/** Terms page, one sentence. */
export const TERMS_BETA_FEE_SENTENCE =
  'Platform fees on cash sales and trades are waived during the beta, and members will be told before standard fees apply.';

/**
 * Parenthetical for a Cash_Sale fee row: "waived during beta, normally 5%" when the
 * stored fee is 0, else "5%". Decided by the FIGURE, so a contract that stored a fee
 * before the beta still reads "5%".
 */
export function platformFeeRowRate(feeCents: number): string {
  return feeCents === 0
    ? `waived during beta, normally ${rateLabel(PLATFORM_FEE_BPS)}`
    : rateLabel(PLATFORM_FEE_BPS);
}

/** Same as `platformFeeRowRate`, for a Trade_Fee row. */
export function tradeFeeRowRate(feeCents: number): string {
  return feeCents === 0
    ? `waived during beta, normally ${rateLabel(TRADE_FEE_BPS)}`
    : rateLabel(TRADE_FEE_BPS);
}
