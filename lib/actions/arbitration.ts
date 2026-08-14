'use server';

// lib/actions/arbitration.ts
//
// Server binding for the arbitration workspace.
//
// Assembles the queue from the three records a case can be a view over — disputed
// Cash_Sales, disputed Trades, Chargebacks — and normalises them through
// `domain/arbitration` so triage ordering and money-at-risk arithmetic stay pure and
// testable.
//
// EVERY EXPORT RE-CHECKS THE GATE. `requireStaff` is called inside each action rather
// than once at the page, because a Server Action is reachable by anyone who knows its
// id — a page-level check protects the page, not the action.
//
// Reads use the SERVICE-ROLE client, deliberately: an arbitrator is not a party to the
// contracts they arbitrate, so RLS on the cookie-bound client would return nothing
// useful. That is the same reasoning the admin console already uses, and it is why the
// gate above it has to be exact.

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireStaff, type StaffGateError } from '@/lib/staffGate';
import {
  getDisputeEvidenceForStaff,
  type DisputeEvidenceEntry,
} from '@/lib/actions/disputeEvidence';
import {
  buildQueue,
  type ArbitrationCase,
  type ArbitrationCaseKind,
  type ArbitrationCaseSituation,
  type ArbitrationGoodsLine,
  type TriagedCase,
} from '@/domain/arbitration/arbitrationCase';
import {
  returnRequiredForRefund,
  sellerNetCentsFor,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { frictionTaxChargeableCents } from '@/domain/dispute/frictionTax';
import { type ActionResult, fail, ok } from './result';

/** Shape of the embedded `cash_sale_items` rows on a disputed-sale read. */
type GoodsRow = {
  description: string | null;
  condition: string | null;
  quantity: number | null;
  unit_price_cents: number | null;
  sort_order: number | null;
};

/**
 * Map a contract's line items into the case model, in the order the parties
 * agreed them (0064).
 *
 * Supabase returns an embedded relation as an array, or null when there is none.
 * A single-item cash sale has no lines and gets an empty list: its goods are
 * fully described by the contract's item snapshot.
 */
function toGoodsLines(rows: unknown): ArbitrationGoodsLine[] {
  if (!Array.isArray(rows)) return [];
  return (rows as GoodsRow[])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((row) => ({
      description: row.description ?? 'Unspecified item',
      condition: row.condition ?? null,
      quantity: Number(row.quantity ?? 1),
      unitPriceCents: Number(row.unit_price_cents ?? 0),
    }));
}

/** Typed failures for arbitration reads and writes. */
export type ArbitrationActionError = StaffGateError | 'not-found' | 'persistence-error';

// The Friction_Tax an unresolved condition dispute would capture. Imported, not
// redeclared: this figure is the "amount at risk" staff triage on, and it used to be a
// third independent `2_000` with no link to the amount the capture actually takes.

/** One internal note, as staff see it. */
export interface ArbitrationNote {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

/**
 * One tracking leg of a Cash_Sale, as staff need to see it.
 *
 * BOTH legs — outbound and return — are contract evidence during arbitration, because
 * the outbound proves the goods reached the buyer and the return proves whether they
 * came back. Neither carrier nor tracking number is PII (they identify a parcel, not a
 * person), so they are safe to show staff.
 */
export interface ArbitrationShipmentLeg {
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  carrierDeliveredAt: string | null;
}

/**
 * Both shipment legs plus the return-specific fields staff triage on.
 */
export interface ArbitrationShipmentEvidence {
  outbound: ArbitrationShipmentLeg;
  returnLeg: ArbitrationShipmentLeg;
  /** Seller's reason for contesting the return. Null when not contested. */
  returnDisputeReason: string | null;
  /** When the seller contested. Null when not contested. */
  returnDisputedAt: string | null;
  /** When the sweep marked the return as lapsed. Null when not lapsed. */
  returnLapsedAt: string | null;
}

/**
 * Exactly what the resolution controls for one case kind need, and nothing else.
 *
 * Kept separate from the triage shape on purpose. The queue needs one comparable
 * number per case so it can be ordered; a decision needs the specific figures the
 * outcome is computed from — the platform fee a release nets off, the collateral a
 * fraud finding captures. Flattening both into `ArbitrationCase` would put money
 * fields on the queue model that only ever mean something for one of the three kinds.
 */
export type ArbitrationResolution =
  | {
      kind: 'CASH_SALE';
      cashSaleId: string;
      amountCents: number;
      platformFeeCents: number;
      refundCents: number;
      /** Set when a refund was attempted and the provider refused: retry is safe. */
      refundStatus: string | null;
      status: string;
      /**
       * Whether the record shows the Buyer received the goods (0088).
       *
       * Decides whether a full refund waits on a return. Derived here with the same
       * rule the orchestrator applies, so the operator is shown the outcome that will
       * actually happen rather than a guess.
       */
      buyerHasGoods: boolean;
      /** A carrier confirmed the returned goods reached the seller (0088). */
      returnConfirmed: boolean;
      /** The dispatch deadline passed unposted (0089), so staff are deciding it. */
      returnLapsed: boolean;
      /**
       * An OPEN chargeback exists against this same sale.
       *
       * Surfaced because the two remedies collide: the buyer has gone to their bank AND
       * the operator is about to refund from the platform balance. Stripe caps total
       * reversals at the original charge, so the buyer cannot literally be paid twice —
       * but the platform still eats a dispute fee for a refund it did not need to issue,
       * and a refund attempted after the reversal lands simply fails, which reads as a
       * provider fault rather than the predictable consequence it is.
       */
      openChargebackRef: string | null;
    }
  | {
      kind: 'TRADE';
      tradeId: string;
      initiator: { id: string; name: string; bondCents: number };
      counterpart: { id: string; name: string; bondCents: number };
      fraudClaimedById: string | null;
      frictionTaxCents: number;
      /**
       * What the counterpart was handing over out of a binder listing (0081), null on
       * a single listing.
       *
       * Present for the same reason `cash_sale_items` is: arbitration reads the
       * contract and never the listing, and a binder's title names an inventory. Without
       * it a disputed binder trade gives staff two party names and a dollar figure with
       * no way to adjudicate "she sent the wrong card".
       */
      counterpartGoodsDescription: string | null;
    }
  | {
      kind: 'CHARGEBACK';
      disputeId: string;
      /** Provider-side status; a chargeback is decided by the bank, not by us. */
      providerStatus: string | null;
      evidenceDueBy: string | null;
      cashSaleId: string | null;
      tradeId: string | null;
      /**
       * The provider's own dispute id, needed to find the case in the Stripe dashboard
       * where the evidence is actually submitted. Carried here because chargebacks are
       * no longer listed on `/admin` — this is the only surface that shows them.
       */
      disputeRef: string | null;
      /** `lost` is the only outcome that means the platform absorbed the amount. */
      outcome: string | null;
    };

/** Everything a case detail page renders. */
export interface ArbitrationCaseDetail {
  case: TriagedCase;
  notes: readonly ArbitrationNote[];
  /** Contract event log, newest last, so the arbitrator can read the sequence. */
  timeline: readonly { event: string; detail: string | null; at: string }[];
  /** The figures the outcome is computed from. Null when the record has vanished. */
  resolution: ArbitrationResolution | null;
  /** Where the underlying contract lives, so staff can read it as the parties do. */
  contractHref: string | null;
  /**
   * What each party filed about the dispute (0082).
   *
   * Empty for a CHARGEBACK, which has no contract room for a party to file from.
   * This is the material the decision is supposed to rest on, so it is part of the
   * detail payload rather than a separate client fetch.
   */
  evidence: readonly DisputeEvidenceEntry[];
  /**
   * Shipment tracking for both legs of a Cash_Sale: the outbound delivery and the
   * return (0088). Null for trades and chargebacks, which have separate tracking.
   * An arbitrator MUST see both legs when deciding a return dispute, because the
   * outbound confirms goods were delivered and the return shows whether they came back.
   */
  shipment: ArbitrationShipmentEvidence | null;
  /** True when the viewer may also moderate. */
  viewerIsAdmin: boolean;
  viewerId: string;
}

/** Resolve display names for a set of profile ids. */
async function namesFor(
  admin: ReturnType<typeof createAdminClient>,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await admin
    .from('profiles')
    .select('id, display_name')
    .in('id', unique);
  return new Map(
    (data ?? []).map((row) => [
      row.id as string,
      ((row.display_name as string | null) ?? 'Unknown member').trim(),
    ]),
  );
}

/**
 * Load every open arbitration case, triaged and ordered.
 *
 * "Open" means an outcome is still owed: a DISPUTED Cash_Sale, a DISPUTED Trade, or a
 * Charge_Dispute with no `closed_at`. A resolved case leaves the queue rather than
 * being filtered client-side, so the counts on the page are the counts that matter.
 */
export async function getArbitrationQueue(): Promise<
  ActionResult<{ cases: TriagedCase[]; viewerId: string; viewerIsAdmin: boolean }, ArbitrationActionError>
> {
  const gate = await requireStaff();
  if (!gate.ok) return fail(gate.error, 'You are not authorized to view arbitration cases.');

  const admin = createAdminClient();

  const [sales, trades, chargebacks, returnCases, assignments, noteCounts] = await Promise.all([
    admin
      .from('cash_sales')
      .select(
        // `from_shopfront` and the nested lines (0064): a shopfront contract's
        // title names the binder, so without its line items an arbitrator cannot
        // tell which of several cases against that listing they are looking at,
        // let alone what was owed.
        'id, item_title, from_shopfront, amount_cents, platform_fee_cents, refund_cents, buyer_id, seller_id, disputed_at, disputed_by, dispute_reason, cash_sale_items(description, condition, quantity, unit_price_cents, sort_order)',
      )
      .eq('status', 'DISPUTED'),
    admin
      .from('trades')
      .select(
        'id, initiator_id, counterpart_id, disputed_at, dispute_raised_by, dispute_reason, fraud_claimed_by, fraud_claim_reason',
      )
      .eq('state', 'DISPUTED'),
    admin
      .from('charge_disputes')
      .select('id, amount_cents, opened_at, evidence_due_by, profile_id, cash_sale_id, trade_id, reason')
      .is('closed_at', null),
    // 0088/0089: return-contested and return-lapsed Cash_Sales. These are NOT in
    // status DISPUTED — they are in RETURN_PENDING or RETURN_IN_TRANSIT and surface
    // as separate situations so staff can tell them apart from condition disputes.
    admin
      .from('cash_sales')
      .select(
        'id, item_title, from_shopfront, amount_cents, platform_fee_cents, refund_cents, buyer_id, seller_id, return_disputed_at, return_dispute_reason, return_lapsed_at, cash_sale_items(description, condition, quantity, unit_price_cents, sort_order)',
      )
      .in('status', ['RETURN_PENDING', 'RETURN_IN_TRANSIT'])
      .or('return_disputed_at.not.is.null,return_lapsed_at.not.is.null'),
    admin.from('arbitration_assignments').select('case_kind, case_ref, assignee_id'),
    admin.from('arbitration_notes').select('case_kind, case_ref'),
  ]);

  const assigneeOf = new Map<string, string>();
  for (const row of assignments.data ?? []) {
    assigneeOf.set(`${row.case_kind}:${row.case_ref}`, row.assignee_id as string);
  }
  const noteCountOf = new Map<string, number>();
  for (const row of noteCounts.data ?? []) {
    const key = `${row.case_kind}:${row.case_ref}`;
    noteCountOf.set(key, (noteCountOf.get(key) ?? 0) + 1);
  }

  // Collateral per trader, so a trade case can state what a fraud finding captures.
  const tradeIds = (trades.data ?? []).map((t) => t.id as string);
  const bondOf = new Map<string, Map<string, number>>();
  if (tradeIds.length > 0) {
    const { data: holds } = await admin
      .from('pre_auth_holds')
      .select('trade_id, trader_id, amount_cents')
      .in('trade_id', tradeIds);
    for (const hold of holds ?? []) {
      const tradeId = hold.trade_id as string;
      const perTrader = bondOf.get(tradeId) ?? new Map<string, number>();
      perTrader.set(hold.trader_id as string, Number(hold.amount_cents ?? 0));
      bondOf.set(tradeId, perTrader);
    }
  }


  const ids: string[] = [];
  for (const s of sales.data ?? []) ids.push(s.buyer_id as string, s.seller_id as string);
  for (const r of returnCases.data ?? []) ids.push(r.buyer_id as string, r.seller_id as string);
  for (const t of trades.data ?? []) ids.push(t.initiator_id as string, t.counterpart_id as string);
  for (const c of chargebacks.data ?? []) if (c.profile_id) ids.push(c.profile_id as string);
  // Assignees resolve through the same lookup as parties. They are staff, not parties,
  // so they would otherwise render as a UUID on the one control that needs a person's
  // name to be useful.
  for (const id of assigneeOf.values()) ids.push(id);
  const names = await namesFor(admin, ids);
  const nameFor = (id: string | null) => (id ? (names.get(id) ?? 'Unknown member') : 'Unattributed');
  const assigneeNameFor = (id: string | null) => (id ? (names.get(id) ?? 'Staff') : null);

  const cases: ArbitrationCase[] = [];

  for (const sale of sales.data ?? []) {
    const id = sale.id as string;
    const net = sellerNetCentsFor({
      amountCents: Number(sale.amount_cents ?? 0),
      platformFeeCents: Number(sale.platform_fee_cents ?? 0),
      refundCents: Number(sale.refund_cents ?? 0),
    });
    cases.push({
      kind: 'CASH_SALE',
      ref: id,
      situation: (sale as Record<string, unknown>).fraud_claimed_by
        ? 'FRAUD_DISPUTE'
        : 'CONDITION_DISPUTE',
      title: (sale.item_title as string | null) ?? 'Untitled item',
      goods: toGoodsLines(sale.cash_sale_items),
      // The whole collected amount is what the outcome decides: it either goes back
      // to the buyer, splits, or releases to the seller.
      amountAtRiskCents: Number(sale.amount_cents ?? 0),
      openedAt: (sale.disputed_at as string | null) ?? null,
      raisedById: (sale.disputed_by as string | null) ?? null,
      claim: (sale.dispute_reason as string | null) ?? null,
      parties: [
        {
          id: sale.buyer_id as string,
          name: nameFor(sale.buyer_id as string),
          stakeCents: Number(sale.amount_cents ?? 0),
          role: 'Buyer',
        },
        {
          id: sale.seller_id as string,
          name: nameFor(sale.seller_id as string),
          stakeCents: net,
          role: 'Seller',
        },
      ],
      assigneeId: assigneeOf.get(`CASH_SALE:${id}`) ?? null,
      assigneeName: assigneeNameFor(assigneeOf.get(`CASH_SALE:${id}`) ?? null),
      noteCount: noteCountOf.get(`CASH_SALE:${id}`) ?? 0,
      hasHardDeadline: false,
      deadlineAt: null,
      fraudAlleged: false,
    });
  }

  // 0088/0089: return-contested and return-lapsed Cash_Sales surface as their own
  // situations. They use the same `CASH_SALE` kind and ref so the detail page reads
  // the same underlying row, but their `openedAt` clock is the return-specific
  // timestamp rather than `disputed_at`.
  for (const rc of returnCases.data ?? []) {
    const id = rc.id as string;
    const returnDisputedAt = (rc.return_disputed_at as string | null) ?? null;
    const returnLapsedAt = (rc.return_lapsed_at as string | null) ?? null;
    // A sale can be BOTH contested and lapsed (seller contests after the buyer also
    // fails to post). Contested takes precedence: a human already said "something is
    // wrong", so it is the claim that matters.
    const situation: ArbitrationCaseSituation = returnDisputedAt
      ? 'RETURN_CONTESTED'
      : 'RETURN_LAPSED';
    const net = sellerNetCentsFor({
      amountCents: Number(rc.amount_cents ?? 0),
      platformFeeCents: Number(rc.platform_fee_cents ?? 0),
      refundCents: Number(rc.refund_cents ?? 0),
    });
    cases.push({
      kind: 'CASH_SALE',
      ref: id,
      situation,
      title: (rc.item_title as string | null) ?? 'Untitled item',
      goods: toGoodsLines(rc.cash_sale_items),
      amountAtRiskCents: Number(rc.amount_cents ?? 0),
      // SLA clock: for a contested return, the seller's dispute timestamp is when the
      // case started waiting. For a lapsed return, `return_lapsed_at` is the moment the
      // sweep flagged it. Both are ISO-8601, both drive priority exactly like
      // `disputed_at` does for a condition dispute.
      openedAt: situation === 'RETURN_CONTESTED' ? returnDisputedAt : returnLapsedAt,
      raisedById: situation === 'RETURN_CONTESTED' ? (rc.seller_id as string) : null,
      claim:
        situation === 'RETURN_CONTESTED'
          ? ((rc.return_dispute_reason as string | null) ?? null)
          : 'The buyer did not post the return within the deadline.',
      parties: [
        {
          id: rc.buyer_id as string,
          name: nameFor(rc.buyer_id as string),
          stakeCents: Number(rc.amount_cents ?? 0),
          role: 'Buyer',
        },
        {
          id: rc.seller_id as string,
          name: nameFor(rc.seller_id as string),
          stakeCents: net,
          role: 'Seller',
        },
      ],
      assigneeId: assigneeOf.get(`CASH_SALE:${id}`) ?? null,
      assigneeName: assigneeNameFor(assigneeOf.get(`CASH_SALE:${id}`) ?? null),
      noteCount: noteCountOf.get(`CASH_SALE:${id}`) ?? 0,
      hasHardDeadline: false,
      deadlineAt: null,
      fraudAlleged: false,
    });
  }

  for (const trade of trades.data ?? []) {
    const id = trade.id as string;
    const bonds = bondOf.get(id) ?? new Map<string, number>();
    const initiatorBond = bonds.get(trade.initiator_id as string) ?? 0;
    const counterpartBond = bonds.get(trade.counterpart_id as string) ?? 0;
    cases.push({
      kind: 'TRADE',
      ref: id,
      situation: Boolean(trade.fraud_claimed_by) ? 'FRAUD_DISPUTE' : 'CONDITION_DISPUTE',
      title: `${nameFor(trade.initiator_id as string)} ⇄ ${nameFor(trade.counterpart_id as string)}`,
      // A trade's goods live in `trade_items` and are not itemised on the trade
      // itself; the exchange panel in the trade room is the place that shows them.
      goods: [],
      // A fraud finding captures one full collateral, so the larger of the two is what
      // the outcome can move. A condition finding moves only the Friction_Tax — CAPPED by
      // the collateral it comes from, because a tax cannot exceed the authorisation
      // backing it. Using the flat $20 reported four times the truth on a $5 trade, and
      // this figure is what staff triage on.
      amountAtRiskCents: Math.max(
        initiatorBond,
        counterpartBond,
        frictionTaxChargeableCents(Math.max(initiatorBond, counterpartBond)),
      ),
      openedAt: (trade.disputed_at as string | null) ?? null,
      raisedById:
        (trade.fraud_claimed_by as string | null) ??
        (trade.dispute_raised_by as string | null) ??
        null,
      // The claimant's own words, preferring the fraud allegation when there is one
      // (0083). A plain condition dispute previously had nothing to show here, because
      // `trades` had no reason column and only a fraud claim carried text — so an
      // arbitrator opening a condition case read an empty claim panel.
      claim:
        (trade.fraud_claim_reason as string | null) ??
        (trade.dispute_reason as string | null) ??
        null,
      parties: [
        {
          id: trade.initiator_id as string,
          name: nameFor(trade.initiator_id as string),
          stakeCents: initiatorBond,
          role: 'Initiator',
        },
        {
          id: trade.counterpart_id as string,
          name: nameFor(trade.counterpart_id as string),
          stakeCents: counterpartBond,
          role: 'Counterpart',
        },
      ],
      assigneeId: assigneeOf.get(`TRADE:${id}`) ?? null,
      assigneeName: assigneeNameFor(assigneeOf.get(`TRADE:${id}`) ?? null),
      noteCount: noteCountOf.get(`TRADE:${id}`) ?? 0,
      hasHardDeadline: false,
      deadlineAt: null,
      fraudAlleged: Boolean(trade.fraud_claimed_by),
    });
  }

  for (const dispute of chargebacks.data ?? []) {
    const id = dispute.id as string;
    cases.push({
      kind: 'CHARGEBACK',
      ref: id,
      situation: 'CHARGEBACK',
      title: 'Chargeback',
      // A chargeback is a bank reversal against a payer, not a claim about goods.
      goods: [],
      amountAtRiskCents: Number(dispute.amount_cents ?? 0),
      openedAt: (dispute.opened_at as string | null) ?? null,
      raisedById: (dispute.profile_id as string | null) ?? null,
      // The provider's reason string, shown to STAFF only. It never reaches a member:
      // members see the member-safe projection from migration 0040.
      claim: (dispute.reason as string | null) ?? null,
      parties: dispute.profile_id
        ? [
            {
              id: dispute.profile_id as string,
              name: nameFor(dispute.profile_id as string),
              stakeCents: Number(dispute.amount_cents ?? 0),
              role: 'Payer',
            },
          ]
        : [],
      assigneeId: assigneeOf.get(`CHARGEBACK:${id}`) ?? null,
      assigneeName: assigneeNameFor(assigneeOf.get(`CHARGEBACK:${id}`) ?? null),
      noteCount: noteCountOf.get(`CHARGEBACK:${id}`) ?? 0,
      // The only case kind with an externally-imposed deadline that forfeits by
      // default. Missing it loses the money with no appeal.
      hasHardDeadline: true,
      deadlineAt: (dispute.evidence_due_by as string | null) ?? null,
      fraudAlleged: false,
    });
  }

  return ok({
    cases: buildQueue(cases),
    viewerId: gate.ctx.userId,
    viewerIsAdmin: gate.ctx.isAdmin,
  });
}

/**
 * Load one case with its notes and contract timeline.
 *
 * Resolved by re-deriving the whole queue and selecting from it, rather than a bespoke
 * per-kind read. That keeps one definition of what a case IS: a case that has left the
 * queue is closed, and asking for it returns `not-found` rather than a detail page for
 * something already decided.
 */
export async function getArbitrationCase(
  kind: ArbitrationCaseKind,
  ref: string,
): Promise<ActionResult<ArbitrationCaseDetail, ArbitrationActionError>> {
  const gate = await requireStaff();
  if (!gate.ok) return fail(gate.error, 'You are not authorized to view arbitration cases.');

  const queue = await getArbitrationQueue();
  if (!queue.ok) return fail(queue.error, queue.message);

  const found = queue.data.cases.find((c) => c.kind === kind && c.ref === ref);
  if (!found) return fail('not-found', 'That case is not open, or does not exist.');

  const admin = createAdminClient();

  const { data: noteRows } = await admin
    .from('arbitration_notes')
    .select('id, author_id, body, created_at')
    .eq('case_kind', kind)
    .eq('case_ref', ref)
    .order('created_at', { ascending: false });

  const authorNames = await namesFor(
    admin,
    (noteRows ?? []).map((n) => n.author_id as string),
  );

  const notes: ArbitrationNote[] = (noteRows ?? []).map((row) => ({
    id: row.id as string,
    authorId: row.author_id as string,
    authorName: authorNames.get(row.author_id as string) ?? 'Staff',
    body: row.body as string,
    createdAt: row.created_at as string,
  }));

  // The contract's own event log. Cash_Sales keep one; trades and
  // chargebacks do not, and those cases show no timeline rather than a fabricated one.
  let timeline: { event: string; detail: string | null; at: string }[] = [];
  if (kind === 'CASH_SALE') {
    const { data: events } = await admin
      .from('cash_sale_events')
      .select('event, detail, created_at')
      .eq('cash_sale_id', ref)
      .order('created_at', { ascending: true });
    timeline = (events ?? []).map((row) => ({
      event: row.event as string,
      detail: (row.detail as string | null) ?? null,
      at: row.created_at as string,
    }));
  }

  const resolution = await readResolution(admin, kind, ref, found);
  const contractHref =
    kind === 'CASH_SALE'
      ? `/sales/${ref}`
      : kind === 'TRADE'
        ? `/trades/${ref}`
        : resolution?.kind === 'CHARGEBACK'
          ? resolution.cashSaleId
            ? `/sales/${resolution.cashSaleId}`
            : resolution.tradeId
              ? `/trades/${resolution.tradeId}`
              : null
          : null;

  // Participant statements and media (0082). A CHARGEBACK has no contract room for a
  // party to file from, so it is skipped rather than queried for nothing.
  const evidence =
    kind === 'CHARGEBACK'
      ? []
      : await getDisputeEvidenceForStaff(kind, ref).then((result) =>
          result.ok ? result.data.entries : [],
        );

  // 0088: shipment tracking for both legs of a Cash_Sale. An arbitrator deciding a
  // return dispute must see whether the outbound arrived and whether the return did.
  let shipment: ArbitrationShipmentEvidence | null = null;
  if (kind === 'CASH_SALE') {
    const { data: shipRow } = await admin
      .from('cash_sales')
      .select(
        'tracking_carrier, tracking_number, shipped_at, carrier_delivered_at, return_tracking_carrier, return_tracking_number, return_shipped_at, return_carrier_delivered_at, return_disputed_at, return_dispute_reason, return_lapsed_at',
      )
      .eq('id', ref)
      .maybeSingle();
    if (shipRow) {
      shipment = {
        outbound: {
          carrier: (shipRow.tracking_carrier as string | null) ?? null,
          trackingNumber: (shipRow.tracking_number as string | null) ?? null,
          shippedAt: (shipRow.shipped_at as string | null) ?? null,
          carrierDeliveredAt: (shipRow.carrier_delivered_at as string | null) ?? null,
        },
        returnLeg: {
          carrier: (shipRow.return_tracking_carrier as string | null) ?? null,
          trackingNumber: (shipRow.return_tracking_number as string | null) ?? null,
          shippedAt: (shipRow.return_shipped_at as string | null) ?? null,
          carrierDeliveredAt: (shipRow.return_carrier_delivered_at as string | null) ?? null,
        },
        returnDisputeReason: (shipRow.return_dispute_reason as string | null) ?? null,
        returnDisputedAt: (shipRow.return_disputed_at as string | null) ?? null,
        returnLapsedAt: (shipRow.return_lapsed_at as string | null) ?? null,
      };
    }
  }

  return ok({
    case: found,
    notes,
    timeline,
    resolution,
    contractHref,
    evidence,
    shipment,
    viewerIsAdmin: gate.ctx.isAdmin,
    viewerId: gate.ctx.userId,
  });
}

/**
 * Read the per-kind figures a decision is computed from.
 *
 * Separate from the queue read deliberately: this is three extra columns on one row,
 * paid for once on a detail page, rather than three extra columns on every row of a
 * queue that only needs one comparable number per case.
 */
async function readResolution(
  admin: ReturnType<typeof createAdminClient>,
  kind: ArbitrationCaseKind,
  ref: string,
  triaged: TriagedCase,
): Promise<ArbitrationResolution | null> {
  if (kind === 'CASH_SALE') {
    // An OPEN chargeback on this same sale, read alongside the sale itself so the
    // operator is warned BEFORE they choose an outcome rather than discovering it when a
    // refund fails. Closed disputes are excluded: a settled one is history, not a
    // collision.
    const { data: openChargeback } = await admin
      .from('charge_disputes')
      .select('dispute_ref')
      .eq('cash_sale_id', ref)
      .is('closed_at', null)
      .maybeSingle();

    const { data } = await admin
      .from('cash_sales')
      // ONE STRING LITERAL, deliberately long. Supabase infers the row type from the
      // literal, so splitting this across concatenated parts collapses `data` to
      // GenericStringError and every field read below stops type-checking.
      .select('id, status, amount_cents, platform_fee_cents, refund_cents, refund_status, carrier_delivered_at, received_at, inspection_accepted_at, buyer_handover_confirmed_at, seller_handover_confirmed_at, return_carrier_delivered_at, return_lapsed_at')
      .eq('id', ref)
      .maybeSingle();
    if (!data) return null;
    return {
      kind: 'CASH_SALE',
      cashSaleId: data.id as string,
      status: data.status as string,
      amountCents: Number(data.amount_cents ?? 0),
      platformFeeCents: Number(data.platform_fee_cents ?? 0),
      refundCents: Number(data.refund_cents ?? 0),
      refundStatus: (data.refund_status as string | null) ?? null,
      // The SAME rule the orchestrator applies, imported rather than restated so the
      // console cannot promise one outcome while the money path takes another.
      buyerHasGoods: returnRequiredForRefund({
        carrierDeliveredAt: (data.carrier_delivered_at as string | null) ?? null,
        receivedAt: (data.received_at as string | null) ?? null,
        inspectionAcceptedAt: (data.inspection_accepted_at as string | null) ?? null,
        buyerHandoverConfirmedAt:
          (data.buyer_handover_confirmed_at as string | null) ?? null,
        sellerHandoverConfirmedAt:
          (data.seller_handover_confirmed_at as string | null) ?? null,
      }),
      returnConfirmed: Boolean(data.return_carrier_delivered_at),
      returnLapsed: Boolean(data.return_lapsed_at),
      openChargebackRef: openChargeback?.dispute_ref ?? null,
    };
  }

  if (kind === 'TRADE') {
    const { data } = await admin
      .from('trades')
      .select(
        // `counterpart_goods_description` (0081): on a binder trade this is the only
        // record of what was actually being swapped, and the listing cannot supply it.
        'id, initiator_id, counterpart_id, fraud_claimed_by, friction_tax_platform_cents, friction_tax_return_cents, counterpart_goods_description',
      )
      .eq('id', ref)
      .maybeSingle();
    if (!data) return null;

    // Reuse the parties the queue already resolved rather than re-reading names: they
    // came from the same row, so a second read could only disagree with itself.
    const partyFor = (id: string) => triaged.parties.find((p) => p.id === id);
    const initiatorId = data.initiator_id as string;
    const counterpartId = data.counterpart_id as string;
    const settled =
      Number(data.friction_tax_platform_cents ?? 0) +
      Number(data.friction_tax_return_cents ?? 0);

    return {
      kind: 'TRADE',
      tradeId: data.id as string,
      initiator: {
        id: initiatorId,
        name: partyFor(initiatorId)?.name ?? 'Initiator',
        bondCents: partyFor(initiatorId)?.stakeCents ?? 0,
      },
      counterpart: {
        id: counterpartId,
        name: partyFor(counterpartId)?.name ?? 'Counterpart',
        bondCents: partyFor(counterpartId)?.stakeCents ?? 0,
      },
      fraudClaimedById: (data.fraud_claimed_by as string | null) ?? null,
      // A trade that has already settled a Friction_Tax reports its own figure; one that
      // has not quotes what COULD be taken — capped by the smaller collateral, since the
      // tax comes out of one trader's hold and cannot exceed it. Quoting the flat $20 on
      // a low-value trade told staff a number the capture could never reach.
      frictionTaxCents:
        settled > 0
          ? settled
          : frictionTaxChargeableCents(
              Math.min(
                partyFor(initiatorId)?.stakeCents ?? 0,
                partyFor(counterpartId)?.stakeCents ?? 0,
              ),
            ),
      counterpartGoodsDescription:
        (data.counterpart_goods_description as string | null) ?? null,
    };
  }


  const { data } = await admin
    .from('charge_disputes')
    .select('id, status, evidence_due_by, cash_sale_id, trade_id, dispute_ref, outcome')
    .eq('id', ref)
    .maybeSingle();
  if (!data) return null;
  return {
    kind: 'CHARGEBACK',
    disputeId: data.id as string,
    providerStatus: (data.status as string | null) ?? null,
    evidenceDueBy: (data.evidence_due_by as string | null) ?? null,
    cashSaleId: (data.cash_sale_id as string | null) ?? null,
    tradeId: (data.trade_id as string | null) ?? null,
    disputeRef: (data.dispute_ref as string | null) ?? null,
    outcome: (data.outcome as string | null) ?? null,
  };
}

/**
 * Take or release a case.
 *
 * Releasing DELETES the row rather than nulling the assignee, so "nobody has picked
 * this up" and "somebody looked and put it back" do not become indistinguishable in
 * the unassigned queue.
 */
export async function assignArbitrationCase(
  kind: ArbitrationCaseKind,
  ref: string,
  /** Pass null to release. */
  assigneeId: string | null,
): Promise<ActionResult<{ assigneeId: string | null }, ArbitrationActionError>> {
  const gate = await requireStaff();
  if (!gate.ok) return fail(gate.error, 'You are not authorized to assign cases.');

  const admin = createAdminClient();

  if (assigneeId === null) {
    const { error } = await admin
      .from('arbitration_assignments')
      .delete()
      .eq('case_kind', kind)
      .eq('case_ref', ref);
    if (error) return fail('persistence-error', 'Could not release the case.');
  } else {
    // THE ASSIGNEE MUST BE STAFF. This wrote whatever id it was handed, and every
    // other actor id in this module comes from the session — so it was the one place a
    // caller chose who a row referred to. The assignee gains no access by being named
    // (the read policy is `is_staff()`), so the harm was to the queue rather than to
    // data: cases parked on accounts that cannot work them, indistinguishable from
    // cases genuinely in progress. A triage queue that lies about who is on a case is
    // the thing this workspace exists to prevent.
    const { data: assignee } = await admin
      .from('profiles')
      .select('is_admin, is_support')
      .eq('id', assigneeId)
      .maybeSingle();
    const assigneeIsStaff = Boolean(assignee?.is_admin || assignee?.is_support);
    if (!assigneeIsStaff) {
      return fail('not-found', 'That person is not a staff member, so cannot take a case.');
    }

    const { error } = await admin.from('arbitration_assignments').upsert(
      {
        case_kind: kind,
        case_ref: ref,
        assignee_id: assigneeId,
        assigned_by: gate.ctx.userId,
        assigned_at: new Date().toISOString(),
      },
      { onConflict: 'case_kind,case_ref' },
    );
    if (error) return fail('persistence-error', 'Could not assign the case.');
  }

  revalidatePath('/admin/arbitration');
  revalidatePath(`/admin/arbitration/${kind}/${ref}`);
  return ok({ assigneeId });
}

/**
 * Append an internal note.
 *
 * Staff-only and append-only: migration 0047 grants no update or delete, because a
 * note is an audit trail of what an arbitrator knew when they decided. The author is
 * taken from the session, never from the payload, so a note cannot be attributed to
 * someone else.
 */
export async function addArbitrationNote(
  kind: ArbitrationCaseKind,
  ref: string,
  body: string,
): Promise<ActionResult<{ id: string }, ArbitrationActionError | 'validation-error'>> {
  const gate = await requireStaff();
  if (!gate.ok) return fail(gate.error, 'You are not authorized to write case notes.');

  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 4_000) {
    return fail('validation-error', 'A note must be between 1 and 4000 characters.');
  }

  const { data, error } = await createAdminClient()
    .from('arbitration_notes')
    .insert({
      case_kind: kind,
      case_ref: ref,
      author_id: gate.ctx.userId,
      body: trimmed,
    })
    .select('id')
    .maybeSingle();

  if (error || !data) return fail('persistence-error', 'The note could not be saved.');

  revalidatePath(`/admin/arbitration/${kind}/${ref}`);
  return ok({ id: data.id as string });
}
