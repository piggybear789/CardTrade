// lib/trades/disputeOrchestrator.ts
//
// The ONE production wiring of the trade dispute coordinator (design §1.2), shared by
// the participant actions (`raiseDispute`, `reportFraud`), the staff actions
// (`resolveTradeDispute`) and the custody backstop sweep.
//
// It binds the lib-side dependencies the pure coordinator cannot reach itself:
//   * the trade orchestrator, with failed audit inserts logged (R4-M1);
//   * the WP1 cash-leg port, over the legacy `settleTradeCash`;
//   * the Trade_Fee refund for NO_EXCHANGE, with a failure logged as
//     `trade.fee_refund` and left for `drainFailedTradeFees`;
//   * the member notifications.
//
// `server-only`, not a Server Action module: nothing here is an endpoint.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import { createDefaultDisputeResolutionOrchestrator } from '@/domain/orchestrator/supabaseDisputeResolutionRepository';
import type {
  DisputeNotifier,
  DisputeResolutionOrchestrator,
} from '@/domain/orchestrator/disputeResolution';
import {
  createLegacyTradeCashLeg,
  createSettlementTableTradeCashLeg,
} from '@/domain/orchestrator/tradeCashLeg';
import {
  closeUncollectedTradeCash,
  queueTradeCashRefund,
  queueTradeCashRelease,
} from '@/domain/orchestrator/tradeCashSettlement';
import { createDefaultTradeCashDeps } from '@/domain/orchestrator/supabaseTradeCashSettlementRepository';
import { createNotification } from '@/lib/notifications/createNotification';
import { formatMoney } from '@/lib/format';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { refundTradeFees } from '@/lib/actions/tradeFees';
import { settleTradeCash } from './completion';
import { createLoggedTradeOrchestrator } from './tradeOrchestrator';
import type { Tables } from '@/lib/supabase/database.types';

/** Member notifications for custody, an unwound trade and restored listings. */
export function createDisputeNotifier(): DisputeNotifier {
  return {
    async custodyCaptured({ tradeId, ownerId, otherId, amountCents, currency }) {
      const link = `/trades/${tradeId}`;
      await createNotification({
        userId: ownerId,
        type: 'TRADE',
        title: 'Your trade collateral is being held',
        body:
          `We've charged your trade collateral of ${formatMoney(amountCents, currency)} to your card ` +
          "as a safeguard while staff review. It's refunded or paid out when the case is decided.",
        link,
      });
      await createNotification({
        userId: otherId,
        type: 'TRADE',
        title: 'Trade collateral held while staff review',
        body: "The other trader's collateral is now held by NoDitto while staff review.",
        link,
      });
    },

    async tradeUnwound({ tradeId, traderIds, cashRefunded }) {
      for (const userId of traderIds) {
        if (!userId) continue;
        await createNotification({
          userId,
          type: 'TRADE',
          title: 'Trade cancelled by support',
          body:
            "Support found the exchange didn't happen, so the trade has been cancelled. " +
            `Your trade collateral has been released${cashRefunded ? ', your cash has been refunded' : ''} ` +
            'and the fee refunded.',
          link: `/trades/${tradeId}`,
        });
      }
    },

    async listingsRestored({ itemIds }) {
      if (itemIds.length === 0) return;
      const { data } = await createAdminClient().from('items').select('id, owner_id, title').in('id', itemIds);
      for (const item of (data ?? []) as Array<{ id: string; owner_id: string; title: string | null }>) {
        await createNotification({
          userId: item.owner_id,
          type: 'TRADE',
          title: 'Your listing is back on sale',
          body:
            `${item.title ? `"${item.title}"` : 'Your card'} is listed again because the trade it was ` +
            "reserved for was cancelled. If you no longer have it, take the listing down.",
          link: `/listings/${item.id}`,
        });
      }
    },
  };
}

/** Settle the legacy cash leg of a trade by id, as a completion would. */
async function settleLegacyCashLeg(tradeId: string): Promise<void> {
  const { data } = await createAdminClient().from('trades').select('*').eq('id', tradeId).maybeSingle();
  if (!data) return;
  await settleTradeCash(data as Tables<'trades'>);
}

/** The settlement-table cash leg (ESC-06), with the legacy leg as its fallback. */
function tradeCashLegFor(payments: ReturnType<typeof getPaymentService>) {
  const deps = createDefaultTradeCashDeps(payments);
  return createSettlementTableTradeCashLeg({
    async loadSettlement(tradeId) {
      const row = await deps.repository.load(tradeId);
      return row ? { payerId: row.payerId, receiverId: row.receiverId, status: row.status } : null;
    },
    queueRelease: (tradeId) => queueTradeCashRelease(deps, { tradeId }),
    queueRefund: (tradeId) => queueTradeCashRefund(deps, { tradeId }),
    closeUncollected: (tradeId) => closeUncollectedTradeCash(deps, { tradeId }),
    legacy: createLegacyTradeCashLeg({ settleTradeCash: settleLegacyCashLeg }),
  });
}

/** Refund both Trade_Fees; a failure is logged and retried by the fee drain. */
async function refundFeesLogged(tradeId: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    await refundTradeFees(tradeId);
    return { ok: true };
  } catch (error) {
    await logBackgroundFailure({
      name: 'trade.fee_refund',
      errorCode: 'THREW',
      error,
      context: { tradeId },
    });
    return { ok: false, detail: error instanceof Error ? error.message : undefined };
  }
}

/** The production dispute coordinator for one region's platform account. */
export function createLoggedDisputeOrchestrator(region?: string | null): DisputeResolutionOrchestrator {
  const payments = getPaymentService(region);
  return createDefaultDisputeResolutionOrchestrator({
    orchestrator: createLoggedTradeOrchestrator({ payments }),
    payments,
    // ESC-06: the collected cash is routed by the outcome. A trade agreed before the
    // switch has no settlement row and keeps the legacy leg.
    cashLeg: tradeCashLegFor(payments),
    refundFees: refundFeesLogged,
    notifier: createDisputeNotifier(),
  });
}
