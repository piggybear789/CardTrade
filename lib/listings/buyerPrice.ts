// lib/listings/buyerPrice.ts
//
// What a buyer pays for an item at a given asking price, and how that figure is broken
// up for display. One definition, because three surfaces had their own.
//
// WHY THE HEADLINE FIGURE IS FEE-INCLUSIVE. The listing page used to lead with the
// seller's asking price and add the fee underneath — "$845.00" then "+ 5% fee ·
// $887.25 total". Two numbers, the larger one true and the prominent one not: the
// figure set in the biggest type was the only one the buyer would never be charged.
// Leading with what they actually pay means the number never goes up between reading
// and paying, which is the only property of a displayed price that matters.
//
// WHAT IT DELIBERATELY DOES NOT CLAIM. Shipping. On a DELIVERY sale the postage is
// agreed during terms and is a pass-through to the carrier, so it is not knowable at
// browse time and this figure is not a final total. The copy that renders it says
// "includes the fee" rather than "total" for exactly that reason — calling
// price-plus-fee a total is a promise the flow cannot keep.

import {
  PLATFORM_FEE_BPS,
  platformFeeCentsFor,
} from '@/domain/orchestrator/cashSaleOrchestrator';

/**
 * The fee rate as members read it, derived from the bps so the copy cannot drift from
 * what is actually charged.
 *
 * Was declared separately in `ListingDesktopPane` and `ListingDetailStack` as
 * `feePercentLabel`, with the same expression in both.
 */
export const PLATFORM_FEE_LABEL = `${PLATFORM_FEE_BPS / 100}%`;

/**
 * What the buyer is charged for an item listed at `priceCents`: the asking price plus
 * the Platform_Fee, excluding any shipping agreed later.
 *
 * The fee itself comes from `platformFeeCentsFor` — the same function the orchestrator
 * charges with — so a display figure can never disagree with a collected one.
 *
 * NOT MEANINGFUL FOR A SHOPFRONT. A binder's `fmv_cents` is an indicative "from" price
 * for a whole inventory, so a fee computed off it would be a precise number derived
 * from an imprecise one. Callers suppress this for `listing_kind === 'SHOPFRONT'`
 * rather than this function guessing, because it takes cents and not a listing.
 */
export function buyerPaysCents(priceCents: number): number {
  return priceCents + platformFeeCentsFor(priceCents);
}

/**
 * Split a formatted money string into currency symbol, major units, and minor
 * units, so each can be sized independently — the digits that decide the
 * purchase get the weight, and the symbol and cents recede.
 *
 * Operates on the formatted output rather than the raw cents because both the
 * symbol and the decimal separator are locale-dependent. `Intl` has already
 * decided them, and re-deciding here would drift from it.
 *
 * MOVED HERE FROM `ItemCard`, where it was private. The Flutter listing card carries a
 * hand-port of it whose own comment says it uses "the same regex the web's `splitMoney`
 * uses" — so it was already a cross-client rule hidden inside one component, and the
 * listing panes wanted it too.
 */
export function splitMoney(formatted: string): {
  symbol: string;
  major: string;
  minor: string;
} {
  const match = /^(\D*)(.*?)([.,]\d{2})?$/.exec(formatted);
  if (!match) return { symbol: '', major: formatted, minor: '' };
  return { symbol: match[1] ?? '', major: match[2] ?? '', minor: match[3] ?? '' };
}
