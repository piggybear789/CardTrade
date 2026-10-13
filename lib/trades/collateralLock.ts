// lib/trades/collateralLock.ts
//
// The Supabase/provider binding of `domain/orchestrator/collateralReconcile.ts`
// (ESC-08): the ONE way a trade's collateral locks, whoever noticed it was complete —
// the Stripe webhook, the synchronous sync after placement, the process-died path, the
// retry, or the demo panel.
//
// `server-only`, not a Server Action.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import {
  confirmCollateralIfComplete,
  reconcileHoldStatus,
  type CollateralReconcileDeps,
  type ConfirmCollateralResult,
  type ReconcileHoldResult,
} from '@/domain/orchestrator/collateralReconcile';
import {
  createSupabaseCollateralSideEffects,
  createSupabaseTradeProposalRepository,
} from '@/domain/orchestrator/supabaseTradeProposalRepository';
import { createLoggedTradeOrchestrator } from './tradeOrchestrator';
import { regionForTrade } from '@/lib/regionBinding';
import { notifyTradeCollateralLocked } from '@/lib/notifications/settlementNotifier';

type AdminClient = ReturnType<typeof createAdminClient>;

/** Build the reconcile dependencies for one trade, bound to its own platform account. */
export async function collateralReconcileDeps(
  tradeId: string,
  client: AdminClient = createAdminClient(),
): Promise<CollateralReconcileDeps> {
  const repository = createSupabaseTradeProposalRepository(client);
  // Bound to the trade's own platform account (0068): HOLDS_FAILED's side effects VOID
  // authorisations, and an authorisation belongs to the account that created it.
  const orchestrator = createLoggedTradeOrchestrator({
    payments: getPaymentService(await regionForTrade(tradeId)),
    runSideEffects: createSupabaseCollateralSideEffects(client),
  });
  return {
    repository: {
      getHolds: (id) => repository.getHolds(id),
      markHoldStatus: (holdRef, status) => repository.markHoldStatus(holdRef, status),
    },
    applyEvent: (params) => orchestrator.applyEvent(params),
    async loadTrade(id) {
      const { data, error } = await client
        .from('trades')
        .select('id, state, initiator_id, counterpart_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`[collateral lock] load trade: ${error.message}`);
      return data as Awaited<ReturnType<CollateralReconcileDeps['loadTrade']>>;
    },
    async notifyLocked(params) {
      try {
        await notifyTradeCollateralLocked(params);
      } catch (error) {
        console.error('[collateral lock] notification failed', error);
      }
    },
    // ESC-05: a trade with a cash leg never locks until the platform holds the cash.
    // A cash trade with no settlement row is refused too: placement creates the row,
    // so its absence means placement has not checked the cash yet.
    async isCashLegCollected(id) {
      const { data: trade, error } = await client
        .from('trades')
        .select('cash_amount_cents')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`[collateral lock] load cash: ${error.message}`);
      if (Number((trade as { cash_amount_cents?: number } | null)?.cash_amount_cents ?? 0) <= 0) return true;
      const { data: row, error: rowError } = await client
        .from('trade_cash_settlements')
        .select('status')
        .eq('trade_id', id)
        .maybeSingle();
      if (rowError) throw new Error(`[collateral lock] load cash leg: ${rowError.message}`);
      return (row as { status?: string } | null)?.status === 'COLLECTED';
    },
    // ESC-29: the Trade_Fee is a lock precondition. Every fee row on the trade must
    // be SETTLED, and there must be one: placement writes them after the holds, so
    // an early hold webhook cannot lock a trade before its fees are charged.
    async areFeesSettled(id) {
      const { data, error } = await client
        .from('trade_fees')
        .select('status')
        .eq('trade_id', id);
      if (error) throw new Error(`[collateral lock] load fees: ${error.message}`);
      const rows = (data ?? []) as Array<{ status: string }>;
      return rows.length > 0 && rows.every((row) => row.status === 'SETTLED');
    },
  };
}

/** Lock the trade if its collateral is complete. Notifies exactly once on a lock. */
export async function confirmTradeCollateral(params: {
  tradeId: string;
  actorId: string;
  noBondsRequired?: boolean;
}): Promise<ConfirmCollateralResult> {
  return confirmCollateralIfComplete(await collateralReconcileDeps(params.tradeId), params);
}

/** Apply a provider statement about one hold (the webhook / demo path). */
export async function reconcileTradeHoldStatus(params: {
  tradeId: string;
  holdId: string;
  status: 'ACTIVE' | 'FAILED';
  actorId: string;
  client?: AdminClient;
}): Promise<ReconcileHoldResult> {
  return reconcileHoldStatus(await collateralReconcileDeps(params.tradeId, params.client), params);
}
