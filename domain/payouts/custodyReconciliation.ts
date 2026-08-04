// domain/payouts/custodyReconciliation.ts
//
// CUSTODY RECONCILIATION: does the platform actually hold the money it owes?
//
// WHY THIS EXISTS. Every other money figure in this system is a statement about our own
// database — what we BELIEVE we owe. None of them can tell us whether the funds to pay
// it are there. Cash_Sale proceeds are collected into the platform's own Stripe balance,
// commingled with fee revenue, and three things can drain that balance without touching
// a single row:
//
//   1. A chargeback. The platform is `losses_collector`, so a reversal comes out of the
//      platform balance. If the sale was already released to the Seller, the platform
//      has paid the Seller AND lost the Buyer's money, and `cash_sales` never learns.
//   2. Provider fees.
//   3. An automatic payout sweeping the balance into the platform's own bank account —
//      which, because the balance is commingled, takes members' money with it.
//
// So the check has to compare a figure we own against a figure the PROVIDER owns. Any
// reconciliation computed purely from our own tables is circular and would agree with
// itself while the account was empty.
//
// WHAT COUNTS AS HELD FOR MEMBERS. Only money actually COLLECTED. Trade and deal
// collateral are uncaptured card authorisations — that money never enters the platform
// balance, so counting it would invent a shortfall on every open trade. This is the one
// place the difference between "we have a claim on it" and "we have it" is load-bearing.
//
// Pure module: no I/O, no Supabase, no provider types. Integer AUD cents throughout.

/** Integer AUD cents. */
export type Cents = number;

/**
 * One Cash_Sale's contribution to what the platform is holding.
 *
 * Deliberately not the whole row: reconciliation needs four facts, and passing the row
 * would let presentation concerns leak into an arithmetic module.
 */
export interface HeldSaleInput {
  /** Cash_Sale id, for attributing a discrepancy to a record. */
  id: string;
  /** Total collected from the Buyer, in cents. Zero when nothing was ever collected. */
  collectedCents: Cents;
  /** Refunds that have actually SETTLED — money already returned. */
  settledRefundCents: Cents;
  /**
   * True once the platform holds nothing further for this sale: the Seller release
   * SETTLED, or the sale ended REFUNDED with the refund settled.
   *
   * Modelled as a flag rather than derived here because "resolved" is a status
   * question, and duplicating the status machine in an arithmetic module is how the
   * two drift apart.
   */
  fullyDisbursed: boolean;
}

/** What the platform holds with the provider. Mirrors `PlatformBalance` on the seam. */
export interface ProviderBalanceInput {
  availableCents: Cents;
  pendingCents: Cents;
  /** False when the balance could not be read; the verdict is then UNKNOWN. */
  readable: boolean;
}

/**
 * The reconciliation verdict.
 *
 * - `SOLVENT`   — the provider holds at least what we owe members.
 * - `SHORTFALL` — it does not. Someone's money is missing. Investigate immediately.
 * - `UNKNOWN`   — the balance could not be read. NOT solvent-by-default.
 */
export type CustodyState = 'SOLVENT' | 'SHORTFALL' | 'UNKNOWN';

/** The full position, as an operator needs to see it. */
export interface CustodyPosition {
  state: CustodyState;
  /** Money collected from members and not yet disbursed. */
  heldForMembersCents: Cents;
  /** What the provider says we hold: available + pending. Zero when unreadable. */
  providerBalanceCents: Cents;
  /** How much we are short. Zero unless SHORTFALL. */
  shortfallCents: Cents;
  /** Headroom above what we owe. Zero unless SOLVENT. */
  surplusCents: Cents;
  /** How many sales contribute to `heldForMembersCents`. */
  saleCount: number;
}

/**
 * What the platform is holding for one sale.
 *
 * A live sale counts its WHOLE collected amount, not the Seller's net. The platform fee
 * is only the platform's once no refund is possible — while a sale can still be refunded
 * in full, that fee is money that may have to go back to the Buyer. Counting only the
 * net would understate the obligation, and understating it is the direction that hides
 * an insolvency.
 *
 * A fully disbursed sale contributes nothing: the Seller has their net and the platform
 * has kept its fee, so the remaining balance is genuinely the platform's own.
 */
export function heldForSale(sale: HeldSaleInput): Cents {
  if (sale.fullyDisbursed) return 0;
  const collected = Math.max(Math.trunc(sale.collectedCents), 0);
  const refunded = Math.max(Math.trunc(sale.settledRefundCents), 0);
  return Math.max(collected - refunded, 0);
}

/**
 * Reconcile what we owe against what the provider holds.
 *
 * An unreadable balance yields UNKNOWN with a zero shortfall — never SOLVENT. A panel
 * that cannot see the balance must say so rather than imply an all-clear it did not
 * verify, which is the whole failure this module exists to prevent.
 */
export function reconcileCustody(params: {
  sales: readonly HeldSaleInput[];
  balance: ProviderBalanceInput;
}): CustodyPosition {
  const contributions = params.sales.map(heldForSale);
  const heldForMembersCents = contributions.reduce((total, cents) => total + cents, 0);
  const saleCount = contributions.filter((cents) => cents > 0).length;

  if (!params.balance.readable) {
    return {
      state: 'UNKNOWN',
      heldForMembersCents,
      providerBalanceCents: 0,
      shortfallCents: 0,
      surplusCents: 0,
      saleCount,
    };
  }

  // Pending counts as held. Card funds clear over days, so a platform that took a
  // payment this morning genuinely has that money even though it cannot pay it out yet.
  // Excluding it would report a shortfall on every healthy account.
  const providerBalanceCents =
    Math.trunc(params.balance.availableCents) + Math.trunc(params.balance.pendingCents);
  const delta = providerBalanceCents - heldForMembersCents;

  return {
    state: delta < 0 ? 'SHORTFALL' : 'SOLVENT',
    heldForMembersCents,
    providerBalanceCents,
    shortfallCents: delta < 0 ? -delta : 0,
    surplusCents: delta > 0 ? delta : 0,
    saleCount,
  };
}
