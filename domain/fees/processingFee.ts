// domain/fees/processingFee.ts
//
// The cash-sale Service_Fee: what a BUYER pays on top of the price, so the seller
// receives price plus postage in full.
//
// CLEAN RATES. The fee is a round percentage of price plus postage, plus a round fixed
// amount, per currency and per way of paying (`CARD_FEES` and its two tiers, `BANK_FEES`),
// e.g. "3% + A$0.60" by an Australian card in Australia. What the buyer is shown is
// exactly what they are charged: there is no gross-up and no "about".
//
// HOW EACH RATE WAS SET. Stripe's own cost for the rail (the `STRIPE_*_COSTS` tables below: payment
// processing on the whole charge, plus the Connect payout to the seller), plus NoDitto's
// 1% (`NODITTO_FEE_BPS`), grossed up for Stripe charging on the fee too, then rounded to
// the nearest half percent; the fixed part is rounded UP to the next 10 minor units. So
// NoDitto keeps roughly 1% (between about 0.85% and 1.6% of a sale over 20.00, depending
// on how far the rail's rate was rounded) and every rate covers Stripe's cost on any sale
// of 1.00 or more. `tests/unit/platformFee.test.ts` pins that property, so a Stripe price
// change that breaks it fails the build instead of quietly eating the margin.
//
// WHERE THE CARD WAS ISSUED (0159). Stripe prices a card by the issuing country against
// the settlement merchant's own country: an Australian card on the AU platform costs
// 1.65%, a US card 3.5%; an EEA seller pays 1.5% on an EEA card, 2.5% on a UK card and
// 3.15% on anything else. So card has three rates per currency, picked by
// `cardTierFor` from the saved card's issuing country: domestic (`CARD_FEES`), across
// the UK–EEA line (`CARD_UK_EEA_FEES`) and international (`CARD_INTERNATIONAL_FEES`).
// The buyer sees the rate for their own card before paying, and the server re-reads the
// card and charges the same figure.
//
// WHAT IT DOES NOT COVER, absorbed by NoDitto's share: Stripe's A$2 per monthly active
// Connect account; a premium card (Stripe charges 1.9% for a premium EEA or UK card,
// and nothing on the card says it is one); dispute fees; refunds.
//
// TUNE THE TABLES, NOT THE CALL SITES. When Stripe's pricing changes, update the
// `STRIPE_*_COSTS` tables and re-derive the clean rate for that row. The Flutter app
// mirrors the domestic `CARD_FEES` (`Money.serviceFeeRates`, pinned by
// `tests/unit/mobileDomainAgreement.test.ts`).
//
// Pure module: no I/O, no provider types.

import { percentageFeeMinor } from './percentageFee';
// Type-only, so the method catalog can price itself from this module without a cycle.
import type { PaymentMethodKind } from '@/domain/payments/paymentMethods';

/**
 * NoDitto's target share of a cash sale, in basis points. The clean rates below are set
 * so NoDitto keeps about this much once Stripe has been paid; it is not added on top.
 */
export const NODITTO_FEE_BPS = 100;

// --- What the buyer pays ---------------------------------------------------

/** A clean service-fee rate: `bps` of price plus postage, plus `fixedMinor`. */
export interface ServiceFeeRate {
  bps: number;
  /** In the contract currency's minor units. */
  fixedMinor: number;
}

/**
 * Card issued inside the contract's domestic card zone (`CARD_ZONES`), per contract
 * currency. AUD is the AU platform; USD the US platform's own currency; every other
 * currency is a cross-border seller charged on behalf of their account at their
 * country's card pricing (`domain/payments/onBehalfOf.ts`).
 */
const CARD_FEES: Record<string, ServiceFeeRate> = {
  aud: { bps: 300, fixedMinor: 60 },
  usd: { bps: 450, fixedMinor: 60 },
  eur: { bps: 300, fixedMinor: 60 },
  gbp: { bps: 300, fixedMinor: 50 },
  cad: { bps: 450, fixedMinor: 70 },
  chf: { bps: 450, fixedMinor: 60 },
  czk: { bps: 300, fixedMinor: 1320 },
  dkk: { bps: 300, fixedMinor: 410 },
  // Norway is the exception in the EEA: Stripe charges 2.4% there, not 1.5%.
  nok: { bps: 400, fixedMinor: 620 },
  sek: { bps: 300, fixedMinor: 610 },
  pln: { bps: 300, fixedMinor: 240 },
  ron: { bps: 300, fixedMinor: 270 },
  bgn: { bps: 300, fixedMinor: 110 },
};

/**
 * Card issued on the other side of the UK–EEA line: a UK card paying an EEA seller, or
 * an EEA card paying a UK seller. Stripe prices these at 2.5%, between domestic and
 * international. Norway has no such tier (a UK card is international there), and the
 * non-European currencies have no neighbour zone at all.
 */
const CARD_UK_EEA_FEES: Record<string, ServiceFeeRate> = {
  gbp: { bps: 400, fixedMinor: 50 },
  eur: { bps: 400, fixedMinor: 60 },
  czk: { bps: 400, fixedMinor: 1340 },
  dkk: { bps: 400, fixedMinor: 420 },
  sek: { bps: 400, fixedMinor: 620 },
  pln: { bps: 400, fixedMinor: 240 },
  ron: { bps: 400, fixedMinor: 270 },
  bgn: { bps: 400, fixedMinor: 110 },
};

/** Card issued anywhere else: Stripe's international card rate for the seller's country. */
const CARD_INTERNATIONAL_FEES: Record<string, ServiceFeeRate> = {
  aud: { bps: 500, fixedMinor: 60 },
  usd: { bps: 600, fixedMinor: 60 },
  eur: { bps: 500, fixedMinor: 60 },
  gbp: { bps: 500, fixedMinor: 50 },
  cad: { bps: 550, fixedMinor: 70 },
  chf: { bps: 500, fixedMinor: 60 },
  czk: { bps: 500, fixedMinor: 1350 },
  dkk: { bps: 500, fixedMinor: 420 },
  nok: { bps: 500, fixedMinor: 630 },
  sek: { bps: 500, fixedMinor: 620 },
  pln: { bps: 500, fixedMinor: 240 },
  ron: { bps: 500, fixedMinor: 270 },
  bgn: { bps: 500, fixedMinor: 110 },
};

/** Bank rails (`domain/payments/paymentMethods.ts`), keyed `<METHOD>:<currency>`. */
const BANK_FEES: Record<string, ServiceFeeRate> = {
  'US_BANK:usd': { bps: 400, fixedMinor: 60 },
  'PAYTO:aud': { bps: 250, fixedMinor: 60 },
  'IDEAL:eur': { bps: 150, fixedMinor: 60 },
  'BANCONTACT:eur': { bps: 300, fixedMinor: 70 },
  'EPS:eur': { bps: 300, fixedMinor: 70 },
  'P24:eur': { bps: 400, fixedMinor: 70 },
  'P24:pln': { bps: 400, fixedMinor: 270 },
};

/** A currency with no row: the most expensive card case, so it is never under-charged. */
const FALLBACK_FEE: ServiceFeeRate = { bps: 600, fixedMinor: 60 };

/**
 * The clean rate for a contract in `currency` paid with `method` (card by default). No
 * currency is treated as AUD. A card tier with no row for the currency falls back to the
 * next dearer tier, and a bank rail with no row to the domestic card rate.
 */
export function serviceFeeRateFor(
  currency: string | null | undefined,
  method: PaymentMethodKind = 'CARD',
): ServiceFeeRate {
  const code = currency?.trim().toLowerCase() || 'aud';
  switch (method) {
    case 'CARD':
      return CARD_FEES[code] ?? FALLBACK_FEE;
    case 'CARD_UK_EEA':
      return CARD_UK_EEA_FEES[code] ?? CARD_INTERNATIONAL_FEES[code] ?? FALLBACK_FEE;
    case 'CARD_INTERNATIONAL':
      return CARD_INTERNATIONAL_FEES[code] ?? FALLBACK_FEE;
    default:
      return BANK_FEES[`${method}:${code}`] ?? CARD_FEES[code] ?? FALLBACK_FEE;
  }
}

// --- Where a card was issued -------------------------------------------------

/**
 * The European Economic Area: the EU, Iceland, Liechtenstein and Norway. A card issued
 * anywhere in it is a standard EEA card to an EEA seller (ISO 3166-1 alpha-2, as Stripe
 * reports `card.country`).
 */
const EEA_COUNTRIES: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
];

/** How Stripe groups card issuing countries for a seller paid in one currency. */
export interface CardZone {
  /** Issuing countries priced at the domestic rate. */
  domestic: readonly string[];
  /** The domestic zone as members read it: "Australia", "the EEA". */
  domesticName: string;
  /** Issuing countries across the UK–EEA line, priced at the middle rate. */
  ukEea?: readonly string[];
  /** That neighbour zone as members read it: "the UK", "the EEA". */
  ukEeaName?: string;
}

/** An EEA seller: EEA cards are domestic and a UK card is the neighbour tier. */
const EEA_SELLER: CardZone = {
  domestic: EEA_COUNTRIES,
  domesticName: 'the EEA',
  ukEea: ['GB'],
  ukEeaName: 'the UK',
};

/**
 * Card zones per contract currency, which is the seller's own country's currency
 * (0068): AUD sellers are in Australia, EUR sellers in the euro area, and so on.
 * Liechtenstein sells in CHF but is priced as an EEA country by Stripe; its sellers are
 * treated as Swiss here, which only ever over-covers Stripe's cost.
 */
const CARD_ZONES: Record<string, CardZone> = {
  aud: { domestic: ['AU'], domesticName: 'Australia' },
  usd: { domestic: ['US'], domesticName: 'the US' },
  cad: { domestic: ['CA'], domesticName: 'Canada' },
  chf: { domestic: ['CH'], domesticName: 'Switzerland' },
  gbp: { domestic: ['GB'], domesticName: 'the UK', ukEea: EEA_COUNTRIES, ukEeaName: 'the EEA' },
  eur: EEA_SELLER,
  czk: EEA_SELLER,
  dkk: EEA_SELLER,
  sek: EEA_SELLER,
  pln: EEA_SELLER,
  ron: EEA_SELLER,
  bgn: EEA_SELLER,
  // Stripe Norway prices a UK card as international: no neighbour tier.
  nok: { domestic: EEA_COUNTRIES, domesticName: 'the EEA' },
};

/** Which of the three card rates applies. */
export type CardTier = 'DOMESTIC' | 'UK_EEA' | 'INTERNATIONAL';

/** The card zone for a contract in `currency`, or null for a currency with no row. */
export function cardZoneOf(currency: string | null | undefined): CardZone | null {
  return CARD_ZONES[currency?.trim().toLowerCase() || 'aud'] ?? null;
}

/**
 * Which card rate a card issued in `cardCountry` pays on a contract in `currency`.
 *
 * An unknown issuing country is DOMESTIC: Stripe reports a country for practically
 * every card, and a buyer must never be priced up on a guess. A currency with no zone
 * is DOMESTIC too, because its domestic card rate is already the fallback, the dearest
 * rate there is.
 */
export function cardTierFor(
  currency: string | null | undefined,
  cardCountry: string | null | undefined,
): CardTier {
  const zone = cardZoneOf(currency);
  const country = cardCountry?.trim().toUpperCase();
  if (!zone || !country) return 'DOMESTIC';
  if (zone.domestic.includes(country)) return 'DOMESTIC';
  if (zone.ukEea?.includes(country)) return 'UK_EEA';
  return 'INTERNATIONAL';
}

/**
 * The Service_Fee on a cash sale: the clean rate of price plus postage, rounded to the
 * nearest minor unit, plus the fixed part. Zero for a zero base. The ONE definition;
 * `platformFeeCentsFor` is it. `method` is how the buyer pays (card unless they choose a
 * bank rail at Pay).
 */
export function cashSaleFeeMinor(
  priceMinor: number,
  shippingMinor: number,
  currency: string | null | undefined,
  method: PaymentMethodKind = 'CARD',
): number {
  const base = Math.max(Math.trunc(priceMinor), 0) + Math.max(Math.trunc(shippingMinor), 0);
  if (base === 0) return 0;
  const rate = serviceFeeRateFor(currency, method);
  return percentageFeeMinor(base, rate.bps) + rate.fixedMinor;
}

/**
 * The rate as members read it, e.g. "3%" and A$0.60 for "3% + A$0.60". Exact: the fee
 * shown beside it is this rate applied to price plus postage.
 */
export function processingRateParts(
  currency: string | null | undefined,
  method: PaymentMethodKind = 'CARD',
): {
  percent: string;
  fixedMinor: number;
} {
  const rate = serviceFeeRateFor(currency, method);
  return { percent: bpsLabel(rate.bps), fixedMinor: rate.fixedMinor };
}

/** "1%" or "4.5%" from basis points. */
export function bpsLabel(bps: number): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, '')}%`;
}

// --- What Stripe charges us ------------------------------------------------
//
// Reference costs the clean rates are derived from and checked against. Not charged to
// anyone directly.

/** One rail's Stripe costs. Basis points are hundredths of a percent. */
export interface ProcessingRate {
  /** The rail's processing percentage, charged on everything the buyer pays (fee included). */
  cardBps: number;
  /** The Connect payout to the seller, charged on what the seller receives. */
  payoutBps: number;
  /** Processing fixed fee plus about US$0.25 for the payout, in the contract's minor units. */
  fixedMinor: number;
}

/** A non-USD seller on the US platform: payout 0.25% plus 0.25% cross-border. */
const CROSS_BORDER_PAYOUT_BPS = 25 + 25;

/**
 * Domestic card costs at Stripe's published standard pricing (checked 2026-10-21), per
 * contract currency: AU 1.65% + A$0.30, US 2.9% + US$0.30, and for sellers charged on
 * behalf of, their own country's pricing (standard EEA card 1.5% + EUR 0.25, Norway
 * 2.4% + NOK 2, UK 1.5% + 20p, Canada and Switzerland 2.9% + 0.30). The payout is
 * 0.25% + 0.25.
 */
const STRIPE_CARD_COSTS: Record<string, ProcessingRate> = {
  aud: { cardBps: 165, payoutBps: 25, fixedMinor: 55 },
  usd: { cardBps: 290, payoutBps: 25, fixedMinor: 55 },
  eur: { cardBps: 150, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 50 },
  gbp: { cardBps: 150, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 40 },
  cad: { cardBps: 290, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 65 },
  chf: { cardBps: 290, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 55 },
  czk: { cardBps: 150, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 1300 },
  dkk: { cardBps: 150, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 400 },
  nok: { cardBps: 240, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 600 },
  sek: { cardBps: 150, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 600 },
  pln: { cardBps: 150, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 230 },
  ron: { cardBps: 150, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 260 },
  bgn: { cardBps: 150, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 100 },
};

/** A UK card paying an EEA seller, or an EEA card paying a UK seller: 2.5% everywhere. */
const STRIPE_CARD_UK_EEA_COSTS: Record<string, ProcessingRate> = {
  gbp: { cardBps: 250, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 40 },
  eur: { cardBps: 250, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 50 },
  czk: { cardBps: 250, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 1300 },
  dkk: { cardBps: 250, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 400 },
  sek: { cardBps: 250, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 600 },
  pln: { cardBps: 250, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 230 },
  ron: { cardBps: 250, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 260 },
  bgn: { cardBps: 250, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 100 },
};

/**
 * International card costs (checked 2026-10-21): AU 3.5%; US 2.9% + 1.5%; Canada 2.9% +
 * 0.8%; Switzerland, Norway and Poland 3.25%; the UK and the rest of the EEA 3.15%. EUR
 * takes the dearer 3.25% because a euro seller may be in any euro country.
 */
const STRIPE_CARD_INTERNATIONAL_COSTS: Record<string, ProcessingRate> = {
  aud: { cardBps: 350, payoutBps: 25, fixedMinor: 55 },
  usd: { cardBps: 440, payoutBps: 25, fixedMinor: 55 },
  eur: { cardBps: 325, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 50 },
  gbp: { cardBps: 315, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 40 },
  cad: { cardBps: 370, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 65 },
  chf: { cardBps: 325, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 55 },
  czk: { cardBps: 315, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 1300 },
  dkk: { cardBps: 315, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 400 },
  nok: { cardBps: 325, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 600 },
  sek: { cardBps: 315, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 600 },
  pln: { cardBps: 325, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 230 },
  ron: { cardBps: 315, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 260 },
  bgn: { cardBps: 315, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 100 },
};

/**
 * Bank-rail costs, keyed `<METHOD>:<currency>`, rounded UP where Stripe's page gives a
 * range: Instant Bank Payments 2.6% + 30¢; PayTo 1% + A$0.30; iDEAL about EUR 0.35 flat;
 * Bancontact 1.4%, EPS 1.6% and Przelewy24 2.2%, each plus about EUR 0.35. Re-check
 * these against the Dashboard before going live.
 */
const STRIPE_BANK_COSTS: Record<string, ProcessingRate> = {
  'US_BANK:usd': { cardBps: 260, payoutBps: 25, fixedMinor: 55 },
  'PAYTO:aud': { cardBps: 100, payoutBps: 25, fixedMinor: 55 },
  'IDEAL:eur': { cardBps: 0, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 60 },
  'BANCONTACT:eur': { cardBps: 140, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 60 },
  'EPS:eur': { cardBps: 160, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 60 },
  'P24:eur': { cardBps: 220, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 60 },
  'P24:pln': { cardBps: 220, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 260 },
};

/** An unknown currency: the US international card rate (2.9% + 1.5%), the worst case. */
const STRIPE_FALLBACK_COST: ProcessingRate = { cardBps: 440, payoutBps: CROSS_BORDER_PAYOUT_BPS, fixedMinor: 55 };

/** Stripe's costs for a contract in `currency` paid with `method` (card by default). */
export function processingRateFor(
  currency: string | null | undefined,
  method: PaymentMethodKind = 'CARD',
): ProcessingRate {
  const code = currency?.trim().toLowerCase() || 'aud';
  switch (method) {
    case 'CARD':
      return STRIPE_CARD_COSTS[code] ?? STRIPE_FALLBACK_COST;
    case 'CARD_UK_EEA':
      return STRIPE_CARD_UK_EEA_COSTS[code] ?? STRIPE_CARD_INTERNATIONAL_COSTS[code] ?? STRIPE_FALLBACK_COST;
    case 'CARD_INTERNATIONAL':
      return STRIPE_CARD_INTERNATIONAL_COSTS[code] ?? STRIPE_FALLBACK_COST;
    default:
      return STRIPE_BANK_COSTS[`${method}:${code}`] ?? STRIPE_CARD_COSTS[code] ?? STRIPE_FALLBACK_COST;
  }
}

/**
 * What Stripe takes on a sale whose seller is owed `baseMinor` (price plus postage) when
 * the buyer also pays `feeMinor`: processing on the whole charge, the payout percentage
 * on what the seller receives, and the fixed parts, each rounded up. NoDitto keeps
 * `feeMinor` minus this.
 */
export function stripeCostMinor(
  baseMinor: number,
  feeMinor: number,
  currency: string | null | undefined,
  method: PaymentMethodKind = 'CARD',
): number {
  const base = Math.max(Math.trunc(baseMinor), 0);
  if (base === 0) return 0;
  const rate = processingRateFor(currency, method);
  return (
    Math.ceil(((base + Math.max(feeMinor, 0)) * rate.cardBps) / 10_000) +
    Math.ceil((base * rate.payoutBps) / 10_000) +
    rate.fixedMinor
  );
}
