// domain/payouts/releasePolicy.ts
//
// WHEN money held for a member may leave the platform (design §1.1).
//
// Every payout of held money — a cash sale's proceeds, a trade's cash leg, captured
// collateral paid to a wronged trader — goes through `decideRelease`, and the rule
// has this ONE copy. pg_cron still marks a sale's payout due; the drains ask this
// module whether "due" means "now".
//
// Why a policy rather than "pay on completion": money left faster than fraud could be
// detected. A stolen-card buyer and a mule seller complete a sale in a day; the
// chargeback arrives weeks later against a platform that already paid out. Holding
// back new sellers, in-person deals and captured collateral for a few days, and
// freezing anything with an open card dispute or an early fraud warning, is what lets
// the evidence arrive before the money is gone.
//
// - The release instant is the MAX of every applicable floor.
// - HELD beats any instant.
// - A fact the policy needs but does not have FAILS CLOSED: a new seller with no
//   collection instant, or captured collateral with no capture instant, is HELD for
//   staff rather than guessed.
// - An unlisted currency is the strictest case, never a guessed figure.
//
// WP1 uses only `CAPTURED_COLLATERAL` (collateral_disbursements). WP2 adds the
// cash-sale and trade-cash call sites. The module ships complete so those are wiring,
// not new rules. Pure: no Supabase, React or service imports.

/** Completed sales a seller needs before the new-seller holdback stops applying. */
export const NEW_SELLER_COMPLETED_SALES_THRESHOLD = 3;
/** New-seller holdback, from `payment_settled_at`. */
export const NEW_SELLER_HOLDBACK_HOURS = 7 * 24;
/** In-person holdback, from the later of the two handover confirmations. */
export const IN_PERSON_MIN_HOLD_HOURS = 24;
/** Captured collateral paid to a wronged trader, from the capture. */
export const CAPTURED_COLLATERAL_HOLDBACK_HOURS = 7 * 24;
/** Collected-but-unreleased limit for a new seller, per currency (minor units). */
//
// EVERY TRADING CURRENCY NEEDS AN ENTRY. An unlisted currency is refused outright (and
// can never qualify), which made every seller in the 0136 regions unsellable. Round
// local figures near AUD 2,000 / AUD 20, not live conversions, so the limit can be
// stated. `tests/unit/releasePolicyCurrencies.test.ts` fails when a `tradingEnabled`
// region's currency is missing from either table.
export const NEW_SELLER_OPEN_EXPOSURE_MINOR: Readonly<Record<string, number>> = {
  aud: 200_000,
  usd: 150_000,
  eur: 120_000,
  gbp: 100_000,
  cad: 180_000,
  chf: 120_000,
  sek: 1_400_000,
  nok: 1_400_000,
  dkk: 900_000,
  pln: 500_000,
  czk: 3_000_000,
  ron: 600_000,
  bgn: 250_000,
};

/**
 * A Trusted Seller's open-sales limit, as a multiple of the new-seller one (0152).
 *
 * A multiple rather than a second per-currency table, so every trading currency is
 * covered by construction and the two limits cannot drift. AUD 2,000 becomes AUD
 * 10,000. It raises the cap only: the holdback, chargeback holds and every other
 * release rule still apply, and a staff override still replaces it outright.
 */
export const TRUSTED_SELLER_EXPOSURE_MULTIPLIER = 5;

/** A sale must be at least this old to count toward "established". */
export const QUALIFYING_SALE_AGE_DAYS = 14;
/** And at least this much, per currency (minor units). Unlisted never qualifies. */
export const QUALIFYING_SALE_MIN_MINOR: Readonly<Record<string, number>> = {
  aud: 2_000,
  usd: 2_000,
  eur: 1_500,
  gbp: 1_500,
  cad: 2_000,
  chf: 1_500,
  sek: 15_000,
  nok: 15_000,
  dkk: 10_000,
  pln: 6_000,
  czk: 35_000,
  ron: 7_000,
  bgn: 3_000,
};

const HOUR_MS = 3_600_000;

/** What kind of held money is being released. */
export type ReleaseSource = 'CASH_SALE' | 'TRADE_CASH' | 'CAPTURED_COLLATERAL';

/** Everything the policy reads. Each drain's repository loads it in one place. */
export interface ReleaseFacts {
  source: ReleaseSource;
  currency: string;
  /** From {@link countQualifyingSales}; NOT a raw COMPLETED count. */
  qualifyingCompletedSales: number;
  /** Collection instant (cash sale / trade cash). */
  paymentSettledAt: string | null;
  /** CAPTURED_COLLATERAL only: when the hold was captured. */
  capturedAt?: string | null;
  /** The later of the two handover confirmations, for an in-person deal. */
  inPersonConfirmedAt?: string | null;
  openChargeDispute: boolean;
  openFraudWarning: boolean;
  staffHold: boolean;
}

/** The policy's answer. */
export type ReleaseDecision =
  | { kind: 'RELEASE_NOW' }
  | { kind: 'RELEASE_AT'; at: string; reason: 'NEW_SELLER' | 'IN_PERSON' | 'CAPTURED_COLLATERAL' }
  | { kind: 'HELD'; reason: 'CHARGE_DISPUTE' | 'FRAUD_WARNING' | 'STAFF' };

type FloorReason = 'NEW_SELLER' | 'IN_PERSON' | 'CAPTURED_COLLATERAL';

function instantMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Decide whether held money may be released now, later, or not until someone acts.
 *
 * The new-seller floor applies to money a member EARNED (a cash sale, a trade's cash
 * leg). Captured collateral has its own floor from the capture, because the payee
 * there is a wronged trader, not a seller, and has no collection instant.
 */
export function decideRelease(facts: ReleaseFacts, now: Date): ReleaseDecision {
  if (facts.openChargeDispute) return { kind: 'HELD', reason: 'CHARGE_DISPUTE' };
  if (facts.openFraudWarning) return { kind: 'HELD', reason: 'FRAUD_WARNING' };
  if (facts.staffHold) return { kind: 'HELD', reason: 'STAFF' };

  const floors: Array<{ at: number; reason: FloorReason }> = [];

  if (facts.source === 'CAPTURED_COLLATERAL') {
    const captured = instantMs(facts.capturedAt);
    if (captured === null) return { kind: 'HELD', reason: 'STAFF' };
    floors.push({
      at: captured + CAPTURED_COLLATERAL_HOLDBACK_HOURS * HOUR_MS,
      reason: 'CAPTURED_COLLATERAL',
    });
  } else {
    if (facts.qualifyingCompletedSales < NEW_SELLER_COMPLETED_SALES_THRESHOLD) {
      const settled = instantMs(facts.paymentSettledAt);
      if (settled === null) return { kind: 'HELD', reason: 'STAFF' };
      floors.push({ at: settled + NEW_SELLER_HOLDBACK_HOURS * HOUR_MS, reason: 'NEW_SELLER' });
    }
    const confirmed = instantMs(facts.inPersonConfirmedAt);
    if (confirmed !== null) {
      floors.push({ at: confirmed + IN_PERSON_MIN_HOLD_HOURS * HOUR_MS, reason: 'IN_PERSON' });
    }
  }

  if (floors.length === 0) return { kind: 'RELEASE_NOW' };
  const latest = floors.reduce((a, b) => (b.at > a.at ? b : a));
  if (latest.at <= now.getTime()) return { kind: 'RELEASE_NOW' };
  return { kind: 'RELEASE_AT', at: new Date(latest.at).toISOString(), reason: latest.reason };
}

/**
 * Whether collecting `addMinor` more would put a new seller over their open-exposure
 * limit (collected but not yet released).
 *
 * A non-null `overrideMinor` (`profiles.exposure_limit_override_minor`, staff-set) is
 * the limit whatever the currency or history; 0 pauses the seller. Otherwise an
 * established seller is never limited, a Trusted Seller (0152) gets
 * {@link TRUSTED_SELLER_EXPOSURE_MULTIPLIER} times the new-seller limit, and a new
 * seller in an unlisted currency is always refused.
 */
export function exceedsNewSellerExposure(p: {
  qualifyingCompletedSales: number;
  openCollectedMinor: number;
  addMinor: number;
  currency: string;
  overrideMinor?: number | null;
  /** `profiles.trusted_seller_at` is set. */
  trustedSeller?: boolean;
}): boolean {
  const total = p.openCollectedMinor + p.addMinor;
  if (p.overrideMinor !== null && p.overrideMinor !== undefined) {
    return total > p.overrideMinor;
  }
  if (p.qualifyingCompletedSales >= NEW_SELLER_COMPLETED_SALES_THRESHOLD) return false;
  const base = NEW_SELLER_OPEN_EXPOSURE_MINOR[p.currency.toLowerCase()];
  if (base === undefined) return true;
  const limit = p.trustedSeller ? base * TRUSTED_SELLER_EXPOSURE_MULTIPLIER : base;
  return total > limit;
}

/** One of a seller's COMPLETED sales, as the qualifying count reads it. */
export interface CompletedSaleFact {
  buyerId: string;
  agreedPriceMinor: number;
  currency: string;
  paymentSettledAt: string;
  chargeDisputed: boolean;
  /** The buyer is related to the seller (ESC-03 layer 3). False until WP2's signals exist. */
  buyerRelated: boolean;
}

/**
 * How many DISTINCT, independent buyers have each completed a sale that may count
 * toward "established": at least 14 days old, at least the per-currency minimum, never
 * charge-disputed, and not to a related account. Three sales to one buyer count once,
 * so a Sybil pair cannot self-deal its way past the holdback in a day.
 */
export function countQualifyingSales(sales: CompletedSaleFact[], now: Date): number {
  const ageCutoff = now.getTime() - QUALIFYING_SALE_AGE_DAYS * 24 * HOUR_MS;
  const buyers = new Set<string>();
  for (const sale of sales) {
    const min = QUALIFYING_SALE_MIN_MINOR[sale.currency.toLowerCase()];
    if (min === undefined || sale.agreedPriceMinor < min) continue;
    const settled = instantMs(sale.paymentSettledAt);
    if (settled === null || settled > ageCutoff) continue;
    if (sale.chargeDisputed || sale.buyerRelated) continue;
    buyers.add(sale.buyerId);
  }
  return buyers.size;
}
