// domain/payouts/payoutReadModel.ts
//
// The Payouts_Dashboard read model (Req 3, 5, 7, 11, 12).
//
// WHY IT IS PURE. Every figure here is money the platform says it owes someone.
// Keeping the derivation free of Supabase, React and formatting means the
// arithmetic can be pinned by fast-check property tests in the Node-only `domain`
// project — see `tests/property/payoutReadModel.test.ts`. The server binding in
// `lib/actions/payouts.ts` does the reading; this module does the deciding.
//
// THE THREE BUCKETS ARE A STRICT PARTITION. A Cash_Sale lands in at most one of
// Releasing_Now, Upcoming_Proceeds and At_Risk_Proceeds, because a member who
// sees the same sale counted twice has no reason to trust any of the numbers:
//
//   Releasing_Now      release queued or failed — owed, and already in flight
//   Upcoming_Proceeds  funds collected, completion not yet reached
//   At_Risk_Proceeds   DISPUTED — outcome still owed, so neither of the above
//
// Deliberately in NO bucket: AGREEMENT and PAYMENT_PENDING (no money has moved,
// so presenting it as a balance would be a forecast), CANCELLED / FAILED /
// REFUNDED (nothing owed), and anything already SETTLED (paid, not owed).
//
// MONEY IS INTEGER AUD CENTS THROUGHOUT. No floats, no formatting; the caller
// formats via `lib/format.ts`.
//
// NOTHING PROVIDER-SHAPED ESCAPES. No transfer ref, dispute ref, merchant ref,
// raw provider error or retry count appears in any output type. That is asserted
// as a redaction property, because these values are the ones most likely to leak
// into a UI by accident.
//
// The one import is a shared money constant. This module is otherwise dependency-free
// on purpose, but a second copy of the Friction_Tax amount is exactly the kind of
// duplication that makes a member's screen disagree with what was charged.

import { FRICTION_TAX_CENTS } from '../dispute/frictionTax';

/** Integer AUD cents. */
export type Cents = number;

/** `cash_sales.status`. */
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
  | 'REFUNDED';

/** `cash_sales.seller_payout_status`. */
export type ReleaseStatus = 'NOT_DUE' | 'PENDING' | 'SETTLED' | 'FAILED';

/** `trades.state`. */
export type TradeState =
  | 'COLLATERAL_PENDING'
  | 'COLLATERAL_LOCKED'
  | 'IN_TRANSIT'
  | 'INSPECTION'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'FRAUD_RESOLVED';

/**
 * Why a release could not be sent, already reduced to a member-safe cause.
 *
 * The raw `seller_payout_error` never reaches this module: the binding maps it,
 * so the read model cannot leak it even by mistake (Req 6.5).
 */
export type ReleaseFailureCause =
  /** The Member cannot yet receive funds — payout setup is incomplete. */
  | 'NOT_PAYABLE'
  /** The provider rejected the release; automatic retries continue. */
  | 'PROVIDER_REJECTED'
  /** Automatic retries are exhausted; an operator is reviewing. */
  | 'RETRIES_EXHAUSTED';

/** The Member's own side of one Cash_Sale, as the read model needs it. */
export interface SellerCashSaleInput {
  id: string;
  itemTitle: string;
  status: CashSaleStatus;
  /** Total collected from the Buyer, including shipping. */
  amountCents: Cents;
  platformFeeCents: Cents;
  /** Returned to the Buyer by a dispute resolution. Reduces the Seller's net. */
  refundCents: Cents;
  releaseStatus: ReleaseStatus;
  /** Attempts already made, used only to derive `RETRIES_EXHAUSTED`. */
  releaseAttempts: number;
  /** Member-safe cause, when the release has failed. */
  failureCause: ReleaseFailureCause | null;
  completedAt: string | null;
  /** Reason recorded on the contract when a dispute was raised. */
  disputeReason: string | null;
  /** True when the viewing Member raised the dispute. */
  disputeRaisedByMe: boolean;
}

/** One persisted payout state change for a Cash_Sale. */
export interface PayoutEventInput {
  id: string;
  cashSaleId: string;
  /** `SELLER_PAYOUT_QUEUED` | `SELLER_PAYOUT_SETTLED` | `SELLER_PAYOUT_FAILED`. */
  event: string;
  createdAt: string;
}

/** A Trade the Member participated in, for arbitration reporting. */
export interface TradeArbitrationInput {
  id: string;
  state: TradeState;
  /** Collateral held against the Member for this Trade. */
  myBondCents: Cents;
  /** True when the Member is recorded as the fraud victim. */
  iAmFraudVictim: boolean;
  /** Collateral captured from the counterparty and paid to the victim. */
  counterpartBondCents: Cents;
  /** True when the resolution was a Condition_Dispute (Friction_Tax). */
  frictionTaxApplied: boolean;
  createdAt: string;
}

/** A chargeback attributable to the Member, in its member-safe projection. */
export interface ChargeDisputeInput {
  id: string;
  amountCents: Cents;
  openedAt: string;
  closedAt: string | null;
  /** `won` | `lost` | `warning_closed` | null while open. */
  outcome: string | null;
  cashSaleId: string | null;
  tradeId: string | null;
}

/** Everything the read model derives from. */
export interface PayoutReadModelInput {
  sales: readonly SellerCashSaleInput[];
  events: readonly PayoutEventInput[];
  trades: readonly TradeArbitrationInput[];
  disputes: readonly ChargeDisputeInput[];
}

/**
 * The fixed Friction_Tax on a Condition_Dispute, in cents.
 *
 * Taken from the single source rather than redeclared: this module drives what a member
 * sees on their payouts screen, and it previously carried its own `2000` with no link
 * to the amount actually captured. Re-exported so existing importers still resolve it
 * from here.
 */
export { FRICTION_TAX_CENTS };

/** Automatic-retry cap for a release. Mirrors `MAX_PAYOUT_ATTEMPTS`. */
export const MAX_RELEASE_ATTEMPTS = 8;

/** Which bucket a Cash_Sale contributes to, if any. */
export type PayoutBucket = 'RELEASING' | 'UPCOMING' | 'AT_RISK' | 'NONE';

/** Statuses in which the Buyer's funds are collected but completion has not landed. */
const COLLECTED_NOT_COMPLETE: ReadonlySet<CashSaleStatus> = new Set<CashSaleStatus>([
  'ESCROW_HELD',
  'IN_TRANSIT',
  'HANDOVER',
  'INSPECTION',
]);

/**
 * The amount owed to the Seller for one Cash_Sale.
 *
 * Clamped at zero so a fee larger than the collected amount can never present as
 * a negative balance, and never exceeds what was collected.
 */
export function sellerNetCents(sale: {
  amountCents: Cents;
  platformFeeCents: Cents;
  refundCents?: Cents;
}): Cents {
  const amount = Math.max(Math.trunc(sale.amountCents), 0);
  const fee = Math.max(Math.trunc(sale.platformFeeCents), 0);
  // Anything refunded to the Buyer is no longer the Seller's. A PARTIAL_REFUND
  // dispute resolution completes the sale at a reduced price, so without this the
  // dashboard would promise the Seller money the platform had already sent back.
  const refunded = Math.max(Math.trunc(sale.refundCents ?? 0), 0);
  return Math.max(amount - fee - refunded, 0);
}

/**
 * Assign a Cash_Sale to exactly one bucket.
 *
 * Order matters. SETTLED is tested first because a paid sale is never owed
 * whatever its status, then DISPUTED, because money under dispute must not appear
 * in a balance the Member might spend against.
 */
export function bucketFor(sale: SellerCashSaleInput): PayoutBucket {
  if (sale.releaseStatus === 'SETTLED') return 'NONE';
  if (sale.status === 'DISPUTED') return 'AT_RISK';
  if (sale.releaseStatus === 'PENDING' || sale.releaseStatus === 'FAILED') {
    return 'RELEASING';
  }
  if (sale.releaseStatus === 'NOT_DUE' && COLLECTED_NOT_COMPLETE.has(sale.status)) {
    return 'UPCOMING';
  }
  return 'NONE';
}

/** One line in the Transfer_History. */
export interface TransferHistoryEntry {
  id: string;
  cashSaleId: string | null;
  /** What happened, already reduced to a member-safe kind. */
  kind: 'QUEUED' | 'SENT' | 'FAILED' | 'FRAUD_RESTITUTION';
  amountCents: Cents;
  itemTitle: string | null;
  occurredAt: string;
  /** Member-safe cause, on a failure entry. */
  failureCause: ReleaseFailureCause | null;
}

/** One arbitration affecting the Member's money. */
export interface ArbitrationRecord {
  id: string;
  kind: 'CASH_SALE_DISPUTE' | 'TRADE_DISPUTE' | 'TRADE_FRAUD' | 'CHARGEBACK';
  /** Money implicated, in cents. */
  amountCents: Cents;
  /** True while an outcome is still owed. */
  open: boolean;
  occurredAt: string;
  /** Where the Member can go to see it. */
  cashSaleId: string | null;
  tradeId: string | null;
  /**
   * Contract-recorded dispute reason, only for a Cash_Sale the Member is party
   * to. Never a provider reason string.
   */
  reason: string | null;
  raisedByMe: boolean;
  /** Terminal money effect, once known. */
  effect:
    | 'PROCEEDS_HELD'
    | 'FRICTION_TAX_CAPTURED'
    | 'COLLATERAL_CAPTURED_FROM_ME'
    | 'COLLATERAL_PAID_TO_ME'
    | 'FUNDS_REVERSED'
    | 'NO_FUNDS_MOVED'
    | 'AWAITING_OUTCOME';
}

/** The full dashboard payload. */
export interface PayoutReadModel {
  releasingNowCents: Cents;
  upcomingProceedsCents: Cents;
  atRiskProceedsCents: Cents;
  /** True when part of Releasing_Now is blocked by a failed release. */
  hasBlockedRelease: boolean;
  /** Sales contributing to Releasing_Now, with their member-safe cause. */
  releasing: readonly {
    cashSaleId: string;
    itemTitle: string;
    netCents: Cents;
    blocked: boolean;
    failureCause: ReleaseFailureCause | null;
  }[];
  history: readonly TransferHistoryEntry[];
  arbitrations: readonly ArbitrationRecord[];
  /** True when the Member has never sold anything. */
  noSales: boolean;
}

/** Map a persisted event name to a history kind, or null when irrelevant. */
function historyKindFor(event: string): TransferHistoryEntry['kind'] | null {
  switch (event) {
    case 'SELLER_PAYOUT_QUEUED':
      return 'QUEUED';
    case 'SELLER_PAYOUT_SETTLED':
      return 'SENT';
    case 'SELLER_PAYOUT_FAILED':
      return 'FAILED';
    default:
      return null;
  }
}

/**
 * Sort history newest-first, breaking ties on id.
 *
 * The id tiebreak is what makes the ordering total rather than merely
 * non-increasing, which is what lets the order-independence property hold: two
 * events sharing a timestamp must not swap places depending on input order.
 */
function byRecencyThenId(a: TransferHistoryEntry, b: TransferHistoryEntry): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Same total ordering for arbitrations. */
function arbitrationOrder(a: ArbitrationRecord, b: ArbitrationRecord): number {
  if (a.open !== b.open) return a.open ? -1 : 1;
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Terminal money effect of a chargeback outcome. */
function chargebackEffect(outcome: string | null): ArbitrationRecord['effect'] {
  switch (outcome) {
    case 'lost':
      return 'FUNDS_REVERSED';
    case 'warning_closed':
    case 'won':
      return 'NO_FUNDS_MOVED';
    default:
      return 'AWAITING_OUTCOME';
  }
}

/**
 * Derive the whole dashboard from the Member's own records.
 *
 * Deterministic and idempotent: the same input yields the same output, and the
 * output does not depend on the order records are supplied in.
 */
export function derivePayoutReadModel(input: PayoutReadModelInput): PayoutReadModel {
  const titleById = new Map<string, string>();
  for (const sale of input.sales) titleById.set(sale.id, sale.itemTitle);

  let releasingNowCents = 0;
  let upcomingProceedsCents = 0;
  let atRiskProceedsCents = 0;
  const releasing: {
    cashSaleId: string;
    itemTitle: string;
    netCents: Cents;
    blocked: boolean;
    failureCause: ReleaseFailureCause | null;
  }[] = [];

  for (const sale of input.sales) {
    const net = sellerNetCents(sale);
    switch (bucketFor(sale)) {
      case 'RELEASING': {
        releasingNowCents += net;
        const blocked = sale.releaseStatus === 'FAILED';
        releasing.push({
          cashSaleId: sale.id,
          itemTitle: sale.itemTitle,
          netCents: net,
          blocked,
          // Retries exhausted outranks the recorded cause: it changes what the
          // Member should do (wait for an operator, not fix their setup).
          failureCause: blocked
            ? sale.releaseAttempts >= MAX_RELEASE_ATTEMPTS
              ? 'RETRIES_EXHAUSTED'
              : (sale.failureCause ?? 'PROVIDER_REJECTED')
            : null,
        });
        break;
      }
      case 'UPCOMING':
        upcomingProceedsCents += net;
        break;
      case 'AT_RISK':
        atRiskProceedsCents += net;
        break;
      default:
        break;
    }
  }

  // History from persisted events only. An event for a sale the Member does not
  // own is dropped rather than rendered without a title, so another member's
  // record cannot influence this Member's history (isolation property).
  const history: TransferHistoryEntry[] = [];
  for (const event of input.events) {
    const kind = historyKindFor(event.event);
    if (!kind) continue;
    const sale = input.sales.find((s) => s.id === event.cashSaleId);
    if (!sale) continue;

    history.push({
      id: event.id,
      cashSaleId: event.cashSaleId,
      kind,
      amountCents: sellerNetCents(sale),
      itemTitle: titleById.get(event.cashSaleId) ?? null,
      occurredAt: event.createdAt,
      failureCause:
        kind === 'FAILED'
          ? sale.releaseAttempts >= MAX_RELEASE_ATTEMPTS
            ? 'RETRIES_EXHAUSTED'
            : (sale.failureCause ?? 'PROVIDER_REJECTED')
          : null,
    });
  }

  // Captured collateral paid to the Member as a fraud victim is money that
  // arrived, so it belongs in the history even though it is not a Cash_Sale
  // release (Req 5.8).
  for (const trade of input.trades) {
    if (trade.state === 'FRAUD_RESOLVED' && trade.iAmFraudVictim) {
      history.push({
        id: `trade-restitution:${trade.id}`,
        cashSaleId: null,
        kind: 'FRAUD_RESTITUTION',
        amountCents: Math.max(Math.trunc(trade.counterpartBondCents), 0),
        itemTitle: null,
        occurredAt: trade.createdAt,
        failureCause: null,
      });
    }
  }

  const arbitrations: ArbitrationRecord[] = [];

  for (const sale of input.sales) {
    if (sale.status !== 'DISPUTED') continue;
    arbitrations.push({
      id: `cash-sale:${sale.id}`,
      kind: 'CASH_SALE_DISPUTE',
      amountCents: sellerNetCents(sale),
      open: true,
      occurredAt: sale.completedAt ?? '',
      cashSaleId: sale.id,
      tradeId: null,
      reason: sale.disputeReason,
      raisedByMe: sale.disputeRaisedByMe,
      effect: 'PROCEEDS_HELD',
    });
  }

  for (const trade of input.trades) {
    if (trade.state !== 'DISPUTED' && trade.state !== 'FRAUD_RESOLVED') continue;
    const fraud = trade.state === 'FRAUD_RESOLVED';
    arbitrations.push({
      id: `trade:${trade.id}`,
      kind: fraud ? 'TRADE_FRAUD' : 'TRADE_DISPUTE',
      amountCents: fraud
        ? trade.iAmFraudVictim
          ? Math.max(Math.trunc(trade.counterpartBondCents), 0)
          : Math.max(Math.trunc(trade.myBondCents), 0)
        : trade.frictionTaxApplied
          ? FRICTION_TAX_CENTS
          : Math.max(Math.trunc(trade.myBondCents), 0),
      open: !fraud,
      occurredAt: trade.createdAt,
      cashSaleId: null,
      tradeId: trade.id,
      reason: null,
      raisedByMe: false,
      effect: fraud
        ? trade.iAmFraudVictim
          ? 'COLLATERAL_PAID_TO_ME'
          : 'COLLATERAL_CAPTURED_FROM_ME'
        : trade.frictionTaxApplied
          ? 'FRICTION_TAX_CAPTURED'
          : 'AWAITING_OUTCOME',
    });
  }

  for (const dispute of input.disputes) {
    arbitrations.push({
      id: `chargeback:${dispute.id}`,
      kind: 'CHARGEBACK',
      amountCents: Math.max(Math.trunc(dispute.amountCents), 0),
      open: dispute.closedAt === null,
      occurredAt: dispute.openedAt,
      cashSaleId: dispute.cashSaleId,
      tradeId: dispute.tradeId,
      reason: null,
      raisedByMe: false,
      effect: chargebackEffect(dispute.outcome),
    });
    // An open chargeback is money at risk that is not in either balance.
    if (dispute.closedAt === null) {
      atRiskProceedsCents += Math.max(Math.trunc(dispute.amountCents), 0);
    }
  }

  return {
    releasingNowCents,
    upcomingProceedsCents,
    atRiskProceedsCents,
    hasBlockedRelease: releasing.some((r) => r.blocked),
    releasing: releasing.sort((a, b) =>
      a.cashSaleId < b.cashSaleId ? -1 : a.cashSaleId > b.cashSaleId ? 1 : 0,
    ),
    history: history.sort(byRecencyThenId),
    arbitrations: arbitrations.sort(arbitrationOrder),
    noSales: input.sales.length === 0,
  };
}
