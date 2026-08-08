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
  buildQueue,
  type ArbitrationCase,
  type ArbitrationCaseKind,
  type ArbitrationGoodsLine,
  type TriagedCase,
} from '@/domain/arbitration/arbitrationCase';
import { sellerNetCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import { FRICTION_TAX_CENTS } from '@/domain/dispute/frictionTax';
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
    }
  | {
      kind: 'TRADE';
      tradeId: string;
      initiator: { id: string; name: string; bondCents: number };
      counterpart: { id: string; name: string; bondCents: number };
      fraudClaimedById: string | null;
      frictionTaxCents: number;
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

  const [sales, trades, chargebacks, assignments, noteCounts] = await Promise.all([
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
        'id, initiator_id, counterpart_id, disputed_at, dispute_raised_by, fraud_claimed_by, fraud_claim_reason',
      )
      .eq('state', 'DISPUTED'),
    admin
      .from('charge_disputes')
      .select('id, amount_cents, opened_at, evidence_due_by, profile_id, cash_sale_id, trade_id, reason')
      .is('closed_at', null),
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

  for (const trade of trades.data ?? []) {
    const id = trade.id as string;
    const bonds = bondOf.get(id) ?? new Map<string, number>();
    const initiatorBond = bonds.get(trade.initiator_id as string) ?? 0;
    const counterpartBond = bonds.get(trade.counterpart_id as string) ?? 0;
    cases.push({
      kind: 'TRADE',
      ref: id,
      title: `${nameFor(trade.initiator_id as string)} ⇄ ${nameFor(trade.counterpart_id as string)}`,
      // A trade's goods live in `trade_items` and are not itemised on the trade
      // itself; the exchange panel in the trade room is the place that shows them.
      goods: [],
      // A fraud finding captures one full collateral, so the larger of the two is what
      // the outcome can move. A condition finding moves only the Friction_Tax.
      amountAtRiskCents: Math.max(initiatorBond, counterpartBond, FRICTION_TAX_CENTS),
      openedAt: (trade.disputed_at as string | null) ?? null,
      raisedById:
        (trade.fraud_claimed_by as string | null) ??
        (trade.dispute_raised_by as string | null) ??
        null,
      claim: (trade.fraud_claim_reason as string | null) ?? null,
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

  return ok({
    case: found,
    notes,
    timeline,
    resolution,
    contractHref,
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
    const { data } = await admin
      .from('cash_sales')
      .select('id, status, amount_cents, platform_fee_cents, refund_cents, refund_status')
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
    };
  }

  if (kind === 'TRADE') {
    const { data } = await admin
      .from('trades')
      .select(
        'id, initiator_id, counterpart_id, fraud_claimed_by, friction_tax_platform_cents, friction_tax_return_cents',
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
      // A trade that has already settled a Friction_Tax reports its own figure; one
      // that has not falls back to the standard $20 (Req 7.3).
      frictionTaxCents: settled > 0 ? settled : FRICTION_TAX_CENTS,
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
