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
//      Below the threshold (and not fraud) it proceeds.
//   2. Above it, a PENDING proposal is written and the action returns
//      `approval-required`. Nothing moves.
//   3. A second staff member calls `approveStaffResolution`, which checks
//      `canApprove`, marks the row APPROVED and re-runs the same action with the
//      proposal id. `gateResolution` then CLAIMS the row (APPROVED -> EXECUTED in one
//      statement) so it executes once, and releases it back if execution fails.

import { createAdminClient } from '@/lib/supabase/admin';
import {
  requiresSecondApproval,
  type ResolutionAction,
} from '@/domain/arbitration/approvalPolicy';

/** What `gateResolution` tells the action to do. */
export type GateDecision =
  | { proceed: true; settle: (succeeded: boolean) => Promise<void> }
  | { proceed: false; error: 'approval-required' | 'approval-invalid'; message: string };

// The table is not in the hand-maintained types' Insert unions for every column, so
// the client is used untyped here and every write checks its returned error.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proposals = () => (createAdminClient() as any).from('staff_resolution_proposals');

/**
 * Decide whether a staff decision may run now.
 *
 * `approvalId` is set only when `approveStaffResolution` re-runs an approved
 * proposal. Any other caller passing one gets nothing it could not already do: the
 * row must be APPROVED, for this action and case, and is consumed by the claim.
 */
export async function gateResolution(params: {
  action: ResolutionAction;
  caseRef: string;
  valueMinor: number;
  payload: Record<string, unknown>;
  staffId: string;
  approvalId?: string;
  fraud?: boolean;
}): Promise<GateDecision> {
  if (params.approvalId) {
    const { data, error } = await proposals()
      .update({ status: 'EXECUTED', executed_at: new Date().toISOString() })
      .eq('id', params.approvalId)
      .eq('action', params.action)
      .eq('case_ref', params.caseRef)
      .eq('status', 'APPROVED')
      .select('id');
    if (error || !data || data.length === 0) {
      return { proceed: false, error: 'approval-invalid', message: 'That approval is not valid for this decision.' };
    }
    return {
      proceed: true,
      settle: async (succeeded) => {
        // A failed execution hands the approval back rather than consuming it.
        if (!succeeded) {
          await proposals()
            .update({ status: 'APPROVED', executed_at: null })
            .eq('id', params.approvalId)
            .eq('status', 'EXECUTED');
        }
      },
    };
  }

  if (!requiresSecondApproval({ action: params.action, valueMinor: params.valueMinor }, { fraud: params.fraud })) {
    return { proceed: true, settle: async () => undefined };
  }

  const { error } = await proposals().insert({
    action: params.action,
    case_ref: params.caseRef,
    value_minor: Math.max(0, Math.trunc(params.valueMinor)),
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

/** The members a case belongs to, for recusal. */
export async function caseParticipants(action: ResolutionAction, caseRef: string): Promise<string[]> {
  const admin = createAdminClient();
  if (action === 'RESOLVE_TRADE_DISPUTE') {
    const { data } = await admin.from('trades').select('initiator_id, counterpart_id').eq('id', caseRef).maybeSingle();
    return [data?.initiator_id, data?.counterpart_id].filter((id): id is string => Boolean(id));
  }
  const { data } = await admin.from('cash_sales').select('buyer_id, seller_id').eq('id', caseRef).maybeSingle();
  return [data?.buyer_id, data?.seller_id].filter((id): id is string => Boolean(id));
}

/** How many staff accounts exist; one means the solo cooling-off rule applies. */
export async function staffCount(): Promise<number> {
  const { count } = await createAdminClient()
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .or('is_admin.eq.true,is_support.eq.true');
  return count ?? 0;
}

/** The value a cash-sale decision moves: what the platform collected. */
export async function cashSaleValueMinor(cashSaleId: string): Promise<number> {
  const { data } = await createAdminClient()
    .from('cash_sales')
    .select('amount_cents')
    .eq('id', cashSaleId)
    .maybeSingle();
  return Number(data?.amount_cents ?? 0);
}

/** The value a trade decision moves: every live or captured collateral hold on it. */
export async function tradeValueMinor(tradeId: string): Promise<number> {
  const { data } = await createAdminClient()
    .from('pre_auth_holds')
    .select('amount_cents')
    .eq('trade_id', tradeId);
  return (data ?? []).reduce((sum: number, row: { amount_cents: number | null }) => sum + Number(row.amount_cents ?? 0), 0);
}
