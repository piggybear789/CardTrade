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
//   2. Above it, a PENDING proposal is written and the action returns
//      `approval-required`. Nothing moves.
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

import { createAdminClient } from '@/lib/supabase/admin';
import {
  isRecused,
  requiresSecondApproval,
  type ResolutionAction,
} from '@/domain/arbitration/approvalPolicy';

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
  return {
    proceed: false,
    error: 'approval-required',
    message: 'Sent for a second staff member to approve. Nothing has moved yet.',
  };
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

/** How many staff accounts exist; one means the solo cooling-off rule applies. */
export async function staffCount(): Promise<number> {
  const { count, error } = await createAdminClient()
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .or('is_admin.eq.true,is_support.eq.true');
  if (error || count === null) throw new ApprovalFactUnavailable('staff count');
  return count;
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
