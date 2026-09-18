// domain/statement/accountStatement.ts
//
// THE ACCOUNT STATEMENT: every movement of money on a member's account, in one
// list, in both directions.
//
// The Payouts tab used to answer one question — "what is the platform sending
// me?" — as a list of sentences, with arbitration outcomes in a separate section
// and nothing at all about money the member SPENT. A member who bought two cards,
// sold one, and posted collateral on a trade saw one row. This is the ledger a
// bank statement is: date, what, how much, which way, where it stands.
//
// ONE ROW PER MONEY EVENT, NOT PER CONTRACT. A completed sale is one row (the
// proceeds); a purchase that was later refunded is TWO rows (the payment out, the
// refund back). A trade can produce a fee row, a collateral row, and a capture
// row. The reader sums rows, not contracts.
//
// THREE DIRECTIONS. `IN` and `OUT` are money that moved or is moving. `HOLD` is
// an authorisation — collateral on a card — which is neither: it is money the
// member cannot spend for a while and gets back in full unless something goes
// wrong. Summing holds into "out" would overstate what a trade costs by the whole
// value of the card, so they carry their own total.
//
// FIGURES ARE FROM THE ROWS THE MEMBER CAN READ. Everything here derives from
// columns RLS already lets the caller select on their own contracts. There is no
// provider balance and no second source of truth; a statement row and the
// contract room it links to are built from the same numbers.
//
// Pure module: no I/O, no provider types. All amounts are integer minor units.

import type { Cents } from '../services/types';

export type StatementDirection = 'IN' | 'OUT' | 'HOLD';

export type StatementKind =
  /** You paid for a card. */
  | 'PURCHASE'
  /** A purchase was refunded to you. */
  | 'REFUND'
  /** Proceeds from a card you sold. */
  | 'SALE'
  /** The platform fee on a trade, charged to you at commitment. */
  | 'TRADE_FEE'
  /** Collateral authorised on your card for a trade. */
  | 'COLLATERAL'
  /** Part of your collateral captured after a condition dispute. */
  | 'RESOLUTION_FEE'
  /** All of your collateral captured after a fraud finding. */
  | 'COLLATERAL_CAPTURED'
  /** Captured collateral or the return-shipping share paid TO you. */
  | 'RESTITUTION'
  /** A payment reversed by the payer's bank. */
  | 'CHARGEBACK';

export type StatementStatus =
  /** Queued or awaiting the other side; nothing final yet. */
  | 'PENDING'
  /** Money collected but not yet released — escrow, or a hold on a card. */
  | 'HELD'
  /** Sent to your payout account. */
  | 'SENT'
  /** Charged to you and settled. */
  | 'PAID'
  /** A hold voided in full. */
  | 'RELEASED'
  /** A hold captured (in part or whole). */
  | 'CAPTURED'
  /** The provider could not complete it; being retried or under review. */
  | 'FAILED'
  /** Returned to the payer. */
  | 'REFUNDED'
  /** A chargeback found against you. */
  | 'REVERSED'
  /** A hold that lapsed before it was released — the guarantee was lost. */
  | 'EXPIRED'
  /** A chargeback found in your favour. */
  | 'DISMISSED';

export interface StatementEntry {
  /** Stable, unique within the statement. */
  id: string;
  occurredAt: string;
  kind: StatementKind;
  direction: StatementDirection;
  /** The headline figure, unsigned. For `HOLD` the amount authorised. */
  amountCents: Cents;
  /** Gross / fee / net, where the entry has a breakdown (purchases, sales). */
  grossCents: Cents | null;
  feeCents: Cents | null;
  /** What you actually paid or received. Equals `amountCents` when set. */
  netCents: Cents | null;
  /** The card, or "Trade with <name>". */
  label: string;
  counterpartyName: string | null;
  status: StatementStatus;
  /** The contract room. */
  href: string;
  /** True once the row can no longer change: sent, paid, released, refunded… */
  settled: boolean;
}

export interface AccountStatement {
  entries: readonly StatementEntry[];
  totals: {
    /** Sum of `IN` rows whose money has actually arrived (`SENT`, `PAID`). */
    receivedCents: Cents;
    /**
     * Sum of `OUT` rows whose money has actually left the member — `PAID`,
     * `CAPTURED`, `REVERSED`, and `HELD`: a purchase in escrow has left the buyer's
     * card even though the seller does not have it yet. A later refund shows up
     * as its own `IN` row rather than by un-counting this one.
     */
    spentCents: Cents;
    /** Sum of `HOLD` rows still `HELD`. */
    heldCents: Cents;
  };
}

// ------------------------------------------------------------------ inputs ----

export type CashSaleStatus =
  | 'AGREEMENT'
  | 'PAYMENT_PENDING'
  | 'ESCROW_HELD'
  | 'IN_TRANSIT'
  | 'HANDOVER'
  | 'INSPECTION'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED'
  | 'FAILED'
  | 'REFUNDED'
  | 'RETURN_PENDING'
  | 'RETURN_IN_TRANSIT';

export type PayoutStatus = 'NOT_DUE' | 'PENDING' | 'SETTLED' | 'FAILED';

/** A Cash_Sale the member is a party to, either side. */
export interface StatementCashSaleInput {
  id: string;
  itemTitle: string;
  status: CashSaleStatus;
  /** True when the member is the buyer; false when the seller. */
  iAmBuyer: boolean;
  counterpartyName: string | null;
  /** Buyer's total: price + fee + shipping. */
  amountCents: Cents;
  agreedPriceCents: Cents;
  platformFeeCents: Cents;
  shippingCostCents: Cents;
  refundCents: Cents;
  refundStatus: PayoutStatus;
  sellerPayoutStatus: PayoutStatus;
  /** When the buyer's payment cleared. Null before that — no money has moved. */
  paymentSettledAt: string | null;
  sellerPayoutAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export type TradeFeeStatus = 'PENDING' | 'SETTLED' | 'FAILED' | 'REFUNDED';

export interface StatementTradeFeeInput {
  tradeId: string;
  counterpartyName: string | null;
  amountCents: Cents;
  status: TradeFeeStatus;
  settledAt: string | null;
  createdAt: string;
}

export type HoldStatus =
  | 'ACTIVE'
  | 'VOIDED'
  | 'PARTIALLY_CAPTURED'
  | 'FULLY_CAPTURED'
  | 'FAILED'
  | 'EXPIRED';

/** A collateral hold on the MEMBER's card. */
export interface StatementHoldInput {
  id: string;
  tradeId: string;
  counterpartyName: string | null;
  amountCents: Cents;
  capturedCents: Cents;
  status: HoldStatus;
  createdAt: string;
  updatedAt: string;
}

/** Money paid TO the member out of a trade resolution. */
export interface StatementRestitutionInput {
  tradeId: string;
  counterpartyName: string | null;
  amountCents: Cents;
  /** `FRAUD` = the other party's whole collateral; `RETURN_SHIPPING` = the $10 share. */
  reason: 'FRAUD' | 'RETURN_SHIPPING';
  paidAt: string;
}

export interface StatementChargebackInput {
  id: string;
  amountCents: Cents;
  /** `won` | `lost` | null while open. */
  outcome: string | null;
  openedAt: string;
  closedAt: string | null;
  cashSaleId: string | null;
  tradeId: string | null;
  label: string;
}

export interface AccountStatementInput {
  sales: readonly StatementCashSaleInput[];
  tradeFees: readonly StatementTradeFeeInput[];
  holds: readonly StatementHoldInput[];
  restitutions: readonly StatementRestitutionInput[];
  chargebacks: readonly StatementChargebackInput[];
}

// -------------------------------------------------------------- derivation ----

const SETTLED_STATUSES: ReadonlySet<StatementStatus> = new Set<StatementStatus>([
  'SENT',
  'PAID',
  'RELEASED',
  'CAPTURED',
  'REFUNDED',
  'REVERSED',
  'EXPIRED',
  'DISMISSED',
]);

function tradeLabel(name: string | null): string {
  return name ? `Trade with ${name}` : 'Trade';
}

/** What a buyer's payment is doing now, from the sale's status. */
function purchaseStatus(sale: StatementCashSaleInput): StatementStatus {
  switch (sale.status) {
    case 'COMPLETED':
      return 'PAID';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'CANCELLED':
    case 'FAILED':
      // Money was collected (we only get here with `paymentSettledAt`) and the
      // contract then ended without completing: the refund row says where it went.
      return sale.refundCents > 0 ? 'REFUNDED' : 'PENDING';
    default:
      return 'HELD';
  }
}

/** What a seller's proceeds are doing now. */
function saleStatus(sale: StatementCashSaleInput): StatementStatus {
  switch (sale.sellerPayoutStatus) {
    case 'SETTLED':
      return 'SENT';
    case 'FAILED':
      return 'FAILED';
    case 'PENDING':
      return 'PENDING';
    case 'NOT_DUE':
      break;
  }
  if (sale.status === 'REFUNDED') return 'REFUNDED';
  if (sale.status === 'CANCELLED' || sale.status === 'FAILED') return 'REFUNDED';
  return 'HELD';
}

function payoutStatusToStatement(status: PayoutStatus, sentLabel: StatementStatus): StatementStatus {
  switch (status) {
    case 'SETTLED':
      return sentLabel;
    case 'FAILED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

export function deriveAccountStatement(input: AccountStatementInput): AccountStatement {
  const entries: StatementEntry[] = [];

  for (const sale of input.sales) {
    // Nothing has moved until the buyer's payment cleared; an AGREEMENT row would
    // be a statement line for money that does not exist.
    if (!sale.paymentSettledAt) continue;
    const href = `/sales/${sale.id}`;

    if (sale.iAmBuyer) {
      entries.push({
        id: `purchase:${sale.id}`,
        occurredAt: sale.paymentSettledAt,
        kind: 'PURCHASE',
        direction: 'OUT',
        amountCents: sale.amountCents,
        grossCents: sale.agreedPriceCents,
        // The buyer's fee line is everything on top of the price: platform fee
        // and shipping. Shown as one figure so gross + fee = what they paid.
        feeCents: sale.amountCents - sale.agreedPriceCents,
        netCents: sale.amountCents,
        label: sale.itemTitle,
        counterpartyName: sale.counterpartyName,
        status: purchaseStatus(sale),
        href,
        settled: SETTLED_STATUSES.has(purchaseStatus(sale)),
      });
      if (sale.refundCents > 0) {
        const status = payoutStatusToStatement(sale.refundStatus, 'PAID');
        entries.push({
          id: `refund:${sale.id}`,
          occurredAt: sale.completedAt ?? sale.updatedAt,
          kind: 'REFUND',
          direction: 'IN',
          amountCents: sale.refundCents,
          grossCents: null,
          feeCents: null,
          netCents: sale.refundCents,
          label: sale.itemTitle,
          counterpartyName: sale.counterpartyName,
          status,
          href,
          settled: SETTLED_STATUSES.has(status),
        });
      }
    } else {
      // Seller receives the price plus shipping; the platform fee is the only
      // deduction. `amountCents - platformFeeCents` is exactly what `payoutReadModel`
      // calls the seller's net, so the two surfaces agree.
      const status = saleStatus(sale);
      const net = Math.max(sale.amountCents - sale.platformFeeCents - sale.refundCents, 0);
      entries.push({
        id: `sale:${sale.id}`,
        occurredAt: sale.sellerPayoutAt ?? sale.completedAt ?? sale.paymentSettledAt,
        kind: 'SALE',
        direction: 'IN',
        amountCents: net,
        grossCents: sale.agreedPriceCents + sale.shippingCostCents,
        feeCents: sale.platformFeeCents,
        netCents: net,
        label: sale.itemTitle,
        counterpartyName: sale.counterpartyName,
        status,
        href,
        settled: SETTLED_STATUSES.has(status),
      });
    }
  }

  for (const fee of input.tradeFees) {
    const status: StatementStatus =
      fee.status === 'SETTLED'
        ? 'PAID'
        : fee.status === 'REFUNDED'
          ? 'REFUNDED'
          : fee.status === 'FAILED'
            ? 'FAILED'
            : 'PENDING';
    entries.push({
      id: `trade-fee:${fee.tradeId}`,
      occurredAt: fee.settledAt ?? fee.createdAt,
      kind: 'TRADE_FEE',
      direction: 'OUT',
      amountCents: fee.amountCents,
      grossCents: null,
      feeCents: fee.amountCents,
      netCents: fee.amountCents,
      label: tradeLabel(fee.counterpartyName),
      counterpartyName: fee.counterpartyName,
      status,
      href: `/trades/${fee.tradeId}`,
      settled: SETTLED_STATUSES.has(status),
    });
  }

  for (const hold of input.holds) {
    const href = `/trades/${hold.tradeId}`;
    const label = tradeLabel(hold.counterpartyName);
    const holdStatus: StatementStatus =
      hold.status === 'ACTIVE'
        ? 'HELD'
        : hold.status === 'VOIDED'
          ? 'RELEASED'
          : hold.status === 'EXPIRED'
            ? 'EXPIRED'
            : hold.status === 'FAILED'
              ? 'FAILED'
              : 'CAPTURED';
    entries.push({
      id: `hold:${hold.id}`,
      occurredAt: hold.createdAt,
      kind: 'COLLATERAL',
      direction: 'HOLD',
      amountCents: hold.amountCents,
      grossCents: null,
      feeCents: null,
      netCents: null,
      label,
      counterpartyName: hold.counterpartyName,
      status: holdStatus,
      href,
      settled: SETTLED_STATUSES.has(holdStatus),
    });
    // The capture is its own row: it is the money that actually left.
    if (hold.capturedCents > 0) {
      entries.push({
        id: `capture:${hold.id}`,
        occurredAt: hold.updatedAt,
        kind: hold.status === 'FULLY_CAPTURED' ? 'COLLATERAL_CAPTURED' : 'RESOLUTION_FEE',
        direction: 'OUT',
        amountCents: hold.capturedCents,
        grossCents: null,
        feeCents: null,
        netCents: hold.capturedCents,
        label,
        counterpartyName: hold.counterpartyName,
        status: 'CAPTURED',
        href,
        settled: true,
      });
    }
  }

  for (const r of input.restitutions) {
    entries.push({
      id: `restitution:${r.tradeId}:${r.reason}`,
      occurredAt: r.paidAt,
      kind: 'RESTITUTION',
      direction: 'IN',
      amountCents: r.amountCents,
      grossCents: null,
      feeCents: null,
      netCents: r.amountCents,
      label: r.reason === 'FRAUD' ? tradeLabel(r.counterpartyName) : 'Return shipping',
      counterpartyName: r.counterpartyName,
      status: 'PAID',
      href: `/trades/${r.tradeId}`,
      settled: true,
    });
  }

  for (const cb of input.chargebacks) {
    const status: StatementStatus =
      cb.outcome === 'lost' ? 'REVERSED' : cb.outcome === 'won' ? 'DISMISSED' : 'PENDING';
    entries.push({
      id: `chargeback:${cb.id}`,
      occurredAt: cb.closedAt ?? cb.openedAt,
      kind: 'CHARGEBACK',
      direction: 'OUT',
      amountCents: cb.amountCents,
      grossCents: null,
      feeCents: null,
      netCents: cb.amountCents,
      label: cb.label,
      counterpartyName: null,
      status,
      href: cb.cashSaleId ? `/sales/${cb.cashSaleId}` : cb.tradeId ? `/trades/${cb.tradeId}` : '/profile?tab=payouts',
      settled: SETTLED_STATUSES.has(status),
    });
  }

  // Newest first. A statement is read from the top for "what just happened".
  entries.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));

  let receivedCents = 0;
  let spentCents = 0;
  let heldCents = 0;
  for (const e of entries) {
    if (e.direction === 'IN' && (e.status === 'SENT' || e.status === 'PAID')) {
      receivedCents += e.amountCents;
    } else if (
      e.direction === 'OUT' &&
      (e.status === 'PAID' ||
        e.status === 'CAPTURED' ||
        e.status === 'REVERSED' ||
        e.status === 'HELD')
    ) {
      spentCents += e.amountCents;
    } else if (e.direction === 'HOLD' && e.status === 'HELD') {
      heldCents += e.amountCents;
    }
  }

  return { entries, totals: { receivedCents, spentCents, heldCents } };
}
