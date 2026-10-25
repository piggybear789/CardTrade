import 'server-only';

// lib/arbitration/approvals.ts
//
// ESC-23: the two-person gate the money-moving staff actions pass through.
//
// Not a 'use server' module on purpose: every export of one is a public endpoint, and
// "execute this approved proposal" must only ever be reached from inside an action
// that has already checked `requireStaff()`.
//
// The flow:
//   1. A staff action computes the value it would move and calls `gateResolution`.
//      A staff member who is a party to the case is refused whatever the value.
//      Below the threshold (and not fraud) it proceeds.
//   2. Above it, a PENDING proposal is written, the staff who could approve it are
//      notified, and the action returns `approval-required`. Nothing moves. The cases
//      queue and the case page list it (`loadPendingApprovals`, `PendingApprovals`).
//   3. A second staff member calls `approveStaffResolution`, which checks
//      `canApprove`, marks the row APPROVED and re-runs the same action with the
//      proposal id and the STORED payload. `gateResolution` then claims the row
//      (APPROVED -> EXECUTED) only if the caller is the approver and the payload is
//      the one approved, so an approval id cannot carry a different decision.
//   4. A failed execution returns the row to PENDING, so it can be approved again
//      rather than sitting APPROVED (a reusable window) or blocking a new proposal.
//
// FAILS CLOSED. Every fact this reads (participants, staff count, value) is an
// authorization input, so a read error refuses the decision rather than defaulting to
// "no constraint applies".

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { formatMoney } from '@/lib/format';
import { createNotification } from '@/lib/notifications/createNotification';
import {
  canApprove,
  isRecused,
  otherApproversFor,
  requiresSecondApproval,
  selfApprovableAt,
  type ApprovalRefusal,
  type ResolutionAction,
} from '@/domain/arbitration/approvalPolicy';
import { FALLBACK_REGION, regionCurrency } from '@/domain/region';

/** What `gateResolution` tells the action to do. */
export type GateDecision =
  | { proceed: true; settle: (succeeded: boolean) => Promise<void> }
  | {
      proceed: false;
      error: 'approval-required' | 'approval-invalid' | 'RECUSED' | 'persistence-error';
      message: string;
    };

/** Raised when an authorization fact could not be read. */
export class ApprovalFactUnavailable extends Error {}

// The table is not in the hand-maintained types' Insert unions for every column, so
// the client is used untyped here and every write checks its returned error.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proposals = () => (createAdminClient() as any).from('staff_resolution_proposals');

/** A key-order-independent rendering of a payload, for comparing two of them. */
export function canonicalPayload(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalPayload(v)}`).join(',')}}`;
}

/** Return a proposal to PENDING so a fresh approval can be given. */
export async function reopenProposal(proposalId: string): Promise<void> {
  await proposals()
    .update({ status: 'PENDING', executed_at: null, decided_by: null, decided_at: null })
    .eq('id', proposalId)
    .in('status', ['APPROVED', 'EXECUTED']);
}

/**
 * Decide whether a staff decision may run now.
 *
 * `approvalId` is set only when `approveStaffResolution` re-runs an approved
 * proposal. The claim succeeds only for the staff member who approved it and only
 * with the payload that was approved.
 */
export async function gateResolution(params: {
  action: ResolutionAction;
  caseRef: string;
  /** What the decision moves, or a reader for it (a read failure refuses). */
  valueMinor: number | (() => Promise<number>);
  payload: Record<string, unknown>;
  staffId: string;
  approvalId?: string;
  fraud?: boolean;
}): Promise<GateDecision> {
  // ESC-23 / review #6: a party to the case never decides it, at any value.
  let participants: string[];
  try {
    participants = await caseParticipants(params.action, params.caseRef);
  } catch {
    return { proceed: false, error: 'persistence-error', message: 'Could not check who this case belongs to. Try again.' };
  }
  if (isRecused(params.staffId, participants)) {
    return { proceed: false, error: 'RECUSED', message: 'You are a party to this case, so you cannot decide it.' };
  }

  if (params.approvalId) {
    const { data: row, error: readError } = await proposals()
      .select('id, payload, decided_by, status')
      .eq('id', params.approvalId)
      .eq('action', params.action)
      .eq('case_ref', params.caseRef)
      .maybeSingle();
    if (
      readError ||
      !row ||
      row.status !== 'APPROVED' ||
      row.decided_by !== params.staffId ||
      canonicalPayload(row.payload) !== canonicalPayload(params.payload)
    ) {
      return { proceed: false, error: 'approval-invalid', message: 'That approval is not valid for this decision.' };
    }
    const { data, error } = await proposals()
      .update({ status: 'EXECUTED', executed_at: new Date().toISOString() })
      .eq('id', params.approvalId)
      .eq('status', 'APPROVED')
      .eq('decided_by', params.staffId)
      .select('id');
    if (error || !data || data.length === 0) {
      return { proceed: false, error: 'approval-invalid', message: 'That approval is not valid for this decision.' };
    }
    const approvalId = params.approvalId;
    return {
      proceed: true,
      settle: async (succeeded) => {
        // A failed execution goes back to PENDING: never a reusable APPROVED row.
        if (!succeeded) await reopenProposal(approvalId);
      },
    };
  }

  let valueMinor: number;
  try {
    valueMinor = typeof params.valueMinor === 'function' ? await params.valueMinor() : params.valueMinor;
  } catch {
    return { proceed: false, error: 'persistence-error', message: 'Could not read what this decision moves. Try again.' };
  }

  if (!requiresSecondApproval({ action: params.action, valueMinor }, { fraud: params.fraud })) {
    return { proceed: true, settle: async () => undefined };
  }

  const { error } = await proposals().insert({
    action: params.action,
    case_ref: params.caseRef,
    value_minor: Math.max(0, Math.trunc(valueMinor)),
    payload: params.payload,
    proposed_by: params.staffId,
  });
  if (error) {
    const duplicate = error.code === '23505';
    return {
      proceed: false,
      error: 'approval-required',
      message: duplicate
        ? 'This decision is already waiting for a second staff member.'
        : `The proposal could not be saved: ${error.message}`,
    };
  }
  // The queue and the case page list it from now on.
  revalidatePath('/admin/arbitration', 'layout');
  // And whoever could approve it is told: on a team this small, a proposal nobody hears
  // about sits unseen, with the money behind it.
  const staff = await staffIds().catch(() => [] as string[]);
  const link = proposalHref(params.action, params.caseRef);
  await Promise.all(
    staff
      .filter((id) => id !== params.staffId && !isRecused(id, participants))
      .map((userId) =>
        createNotification({
          userId,
          type: 'SYSTEM',
          title: 'A decision needs your approval',
          body: 'Another staff member proposed a decision that moves money. Nothing moves until you approve or reject it.',
          link,
        }),
      ),
  );
  return {
    proceed: false,
    error: 'approval-required',
    message: 'Sent for a second staff member to approve. Nothing has moved yet.',
  };
}

/** The case page a proposal is decided from, or the queue for one that is not an open case. */
function proposalHref(action: ResolutionAction, caseRef: string): string {
  if (action === 'RESOLVE_TRADE_DISPUTE') return `/admin/arbitration/TRADE/${caseRef}`;
  if (action === 'REVERSE_CASH_SALE_PAYOUT') return '/admin/arbitration';
  return `/admin/arbitration/CASH_SALE/${caseRef}`;
}

/** The members a case belongs to, for recusal. Throws when it cannot be read. */
export async function caseParticipants(action: ResolutionAction, caseRef: string): Promise<string[]> {
  const admin = createAdminClient();
  if (action === 'RESOLVE_TRADE_DISPUTE') {
    const { data, error } = await admin
      .from('trades')
      .select('initiator_id, counterpart_id')
      .eq('id', caseRef)
      .maybeSingle();
    if (error || !data) throw new ApprovalFactUnavailable('trade participants');
    return [data.initiator_id, data.counterpart_id].filter((id): id is string => Boolean(id));
  }
  const { data, error } = await admin
    .from('cash_sales')
    .select('buyer_id, seller_id')
    .eq('id', caseRef)
    .maybeSingle();
  if (error || !data) throw new ApprovalFactUnavailable('sale participants');
  return [data.buyer_id, data.seller_id].filter((id): id is string => Boolean(id));
}

/** Every staff account, to count who else could approve (`otherApproversFor`). */
export async function staffIds(): Promise<string[]> {
  const { data, error } = await createAdminClient()
    .from('profiles')
    .select('id')
    .or('is_admin.eq.true,is_support.eq.true');
  if (error || !data) throw new ApprovalFactUnavailable('staff');
  return data.map((row) => row.id as string);
}

/** A decision waiting for a second staff member, as the case pages show it. */
export interface PendingApproval {
  id: string;
  action: ResolutionAction;
  caseRef: string;
  /** What approving it does, in words. */
  decision: string;
  valueMinor: number;
  currency: string;
  proposedById: string;
  proposedByName: string;
  proposedAt: string;
  /** Why the viewer may not approve it; null when they may. */
  refusal: Exclude<ApprovalRefusal, 'NOT_PENDING'> | null;
  /** When the proposer may approve it themself: set only when nobody else can. */
  selfApprovableAt: string | null;
}

type ProposalRow = {
  id: string;
  action: ResolutionAction;
  case_ref: string;
  value_minor: number | string;
  payload: Record<string, unknown> | null;
  proposed_by: string;
  proposed_at: string;
};

/** Denomination of last resort, for a pre-0068 contract row that carries none. */
const FALLBACK_CURRENCY = regionCurrency(FALLBACK_REGION) ?? 'aud';

/**
 * The decisions waiting for a second staff member (all of them, or one case's), with
 * what the viewer may do about each. STAFF ONLY: it reads with the service role, so call
 * it behind `requireStaff`. Null when they could not be read, which the page says rather
 * than showing an empty list that hides a stuck decision.
 */
export async function loadPendingApprovals(
  viewerId: string,
  caseRef?: string,
): Promise<PendingApproval[] | null> {
  try {
    const admin = createAdminClient();
    let query = proposals()
      .select('id, action, case_ref, value_minor, payload, proposed_by, proposed_at')
      .eq('status', 'PENDING')
      .order('proposed_at', { ascending: true })
      .limit(100);
    if (caseRef) query = query.eq('case_ref', caseRef);
    const [{ data, error }, staff] = await Promise.all([query, staffIds()]);
    if (error) throw error;
    const rows = (data ?? []) as ProposalRow[];
    if (rows.length === 0) return [];

    const tradeRefs = rows.filter((row) => row.action === 'RESOLVE_TRADE_DISPUTE').map((row) => row.case_ref);
    const saleRefs = rows.filter((row) => row.action !== 'RESOLVE_TRADE_DISPUTE').map((row) => row.case_ref);
    const none = { data: [], error: null };
    const [trades, sales] = await Promise.all([
      tradeRefs.length
        ? admin.from('trades').select('id, initiator_id, counterpart_id, currency').in('id', tradeRefs)
        : Promise.resolve(none),
      saleRefs.length
        ? admin.from('cash_sales').select('id, buyer_id, seller_id, currency').in('id', saleRefs)
        : Promise.resolve(none),
    ]);
    if (trades.error) throw trades.error;
    if (sales.error) throw sales.error;

    const cases = new Map<string, { parties: string[]; currency: string }>();
    for (const row of (trades.data ?? []) as { id: string; initiator_id: string; counterpart_id: string | null; currency: string | null }[]) {
      cases.set(row.id, { parties: [row.initiator_id, row.counterpart_id].filter((id): id is string => Boolean(id)), currency: row.currency ?? FALLBACK_CURRENCY });
    }
    for (const row of (sales.data ?? []) as { id: string; buyer_id: string; seller_id: string; currency: string | null }[]) {
      cases.set(row.id, { parties: [row.buyer_id, row.seller_id], currency: row.currency ?? FALLBACK_CURRENCY });
    }

    const nameIds = new Set<string>(rows.map((row) => row.proposed_by));
    for (const c of cases.values()) for (const id of c.parties) nameIds.add(id);
    const { data: profiles, error: namesError } = await admin
      .from('profiles')
      .select('id, display_name')
      .in('id', [...nameIds]);
    if (namesError) throw namesError;
    const names = new Map((profiles ?? []).map((row) => [row.id as string, (row.display_name as string | null)?.trim() || 'Unknown member']));
    const nameOf = (id: unknown) => (typeof id === 'string' && names.get(id)) || 'a member';

    const now = new Date();
    return rows.map((row) => {
      const { parties, currency } = cases.get(row.case_ref) ?? { parties: [], currency: FALLBACK_CURRENCY };
      const otherApprovers = otherApproversFor(staff, row.proposed_by, parties);
      const refusal = canApprove({
        status: 'PENDING',
        proposedBy: row.proposed_by,
        proposedAt: row.proposed_at,
        approverId: viewerId,
        participantIds: parties,
        otherApprovers,
        now,
      });
      const readyAt = selfApprovableAt(row.proposed_at);
      return {
        id: row.id,
        action: row.action,
        caseRef: row.case_ref,
        decision: describeProposal(row.action, row.payload ?? {}, parties, (minor) => formatMoney(minor, currency), nameOf),
        valueMinor: Number(row.value_minor),
        currency,
        proposedById: row.proposed_by,
        proposedByName: nameOf(row.proposed_by),
        proposedAt: row.proposed_at,
        refusal: refusal === 'NOT_PENDING' ? null : refusal,
        selfApprovableAt: otherApprovers === 0 && Number.isFinite(readyAt) ? new Date(readyAt).toISOString() : null,
      };
    });
  } catch (error) {
    await logBackgroundFailure({ name: 'arbitration.pending_approvals', errorCode: 'READ_FAILED', error });
    return null;
  }
}

/** What approving a proposal does, from the payload its action stored. */
function describeProposal(
  action: ResolutionAction,
  payload: Record<string, unknown>,
  parties: readonly string[],
  money: (minor: number) => string,
  nameOf: (id: unknown) => string,
): string {
  switch (action) {
    case 'RESOLVE_CASH_SALE_DISPUTE':
      if (payload.outcome === 'PARTIAL_REFUND') {
        return `Refund the buyer ${money(Number(payload.refundCents))}; the rest goes to the seller`;
      }
      if (payload.outcome === 'RELEASE_SELLER') return 'Release the money to the seller';
      return payload.requireReturn === false
        ? 'Refund the buyer in full, with no return owed'
        : 'Refund the buyer in full';
    case 'RESOLVE_CASH_SALE_RETURN':
      return payload.outcome === 'RELEASE_SELLER'
        ? 'Refuse the return and release the money to the seller'
        : 'Accept the return and refund the buyer';
    case 'RESOLVE_TRACKING_FLAG':
      return payload.decision === 'START_CLOCK'
        ? "Accept the tracking and start the buyer's inspection"
        : 'Refund the buyer: the tracking is not this parcel';
    case 'REVERSE_CASH_SALE_PAYOUT':
      return `Claw back ${money(Number(payload.amountMinor))} of the seller's payout`;
    case 'RESOLVE_TRADE_DISPUTE': {
      const outcome = (payload.outcome ?? {}) as {
        kind?: string;
        victimId?: string;
        wrongedTraderId?: string;
        compensationMinor?: number;
      };
      switch (outcome.kind) {
        case 'FRAUD':
          return `Fraud: ban ${nameOf(parties.find((id) => id !== outcome.victimId))} and pay their collateral to ${nameOf(outcome.victimId)}`;
        case 'CONDITION':
          return `Condition: pay ${nameOf(outcome.wrongedTraderId)} ${money(Number(outcome.compensationMinor))} from the other trader's collateral`;
        case 'NO_EXCHANGE':
          return 'No exchange: release every hold, refund both fees and cancel the trade';
        default:
          return 'Unfounded: release both card holds and complete the trade';
      }
    }
  }
}

/** The value a cash-sale decision moves: what the platform collected. */
export async function cashSaleValueMinor(cashSaleId: string): Promise<number> {
  const { data, error } = await createAdminClient()
    .from('cash_sales')
    .select('amount_cents')
    .eq('id', cashSaleId)
    .maybeSingle();
  if (error || !data) throw new ApprovalFactUnavailable('sale value');
  return Number(data.amount_cents ?? 0);
}

/**
 * The value a trade decision can move: all collateral on it, the collected cash leg,
 * and both Trade_Fees (a NO_EXCHANGE refunds them). Valued by the money, never by the
 * outcome label, so an unwind of a large cash leg still needs a second approver.
 */
export async function tradeValueMinor(tradeId: string): Promise<number> {
  const admin = createAdminClient();
  const [holds, cash, fees] = await Promise.all([
    admin.from('pre_auth_holds').select('amount_cents').eq('trade_id', tradeId),
    admin.from('trade_cash_settlements').select('amount_minor, status').eq('trade_id', tradeId).maybeSingle(),
    admin.from('trade_fees').select('amount_cents, status').eq('trade_id', tradeId),
  ]);
  if (holds.error || cash.error || fees.error) throw new ApprovalFactUnavailable('trade value');
  const holdSum = (holds.data ?? []).reduce(
    (sum: number, row: { amount_cents: number | null }) => sum + Number(row.amount_cents ?? 0),
    0,
  );
  const cashRow = cash.data as { amount_minor: number | null; status: string } | null;
  const cashHeld =
    cashRow && ['COLLECTED', 'RELEASE_PENDING', 'REFUND_PENDING'].includes(cashRow.status)
      ? Number(cashRow.amount_minor ?? 0)
      : 0;
  const feeSum = (fees.data ?? []).reduce(
    (sum: number, row: { amount_cents: number | null; status: string }) =>
      sum + (row.status === 'SETTLED' ? Number(row.amount_cents ?? 0) : 0),
    0,
  );
  return holdSum + cashHeld + feeSum;
}
