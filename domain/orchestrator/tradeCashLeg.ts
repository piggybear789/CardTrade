// domain/orchestrator/tradeCashLeg.ts
//
// What a dispute outcome does to a trade's CASH LEG (design §1.2 step 5).
//
// One injected port so the dispute orchestrator does not depend on how the cash leg
// is collected. In WP1 the cash is still the legacy leg: never collected by the
// platform, charged from the payer straight to the receiver at completion by
// `settleTradeCash`. WP2 replaces this binding with one over `trade_cash_settlements`,
// where the platform collects the cash up front and the outcome only decides who it
// is released or refunded to.
//
// Pure: the settle function is injected by the lib caller.

/** The staff outcome a dispute was resolved with. */
export type TradeDisputeOutcomeKind = 'UNFOUNDED' | 'CONDITION' | 'FRAUD' | 'NO_EXCHANGE';

/** What the port did, so the orchestrator can persist it. */
export interface TradeCashLegResult {
  /**
   * The cash leg could not be routed automatically and needs an operator. Set on a
   * legacy FRAUD outcome, where there is no collected cash to route to the victim.
   */
  manualReconciliation: boolean;
}

/** Settles a trade's cash leg for a dispute outcome. */
export interface TradeCashLegPort {
  settleForOutcome(
    tradeId: string,
    outcome: TradeDisputeOutcomeKind,
    /** FRAUD only: the wronged trader, who the collected cash is routed to. */
    context?: { victimId?: string | null },
  ): Promise<TradeCashLegResult>;
}

/**
 * The WP2 binding over `trade_cash_settlements` (ESC-05/06), with the legacy binding
 * as the fallback for a trade agreed before the switch (a cash leg with no row).
 *
 * - UNFOUNDED / CONDITION: the trade completes, so the collected cash is queued for
 *   release to the receiver (the `:47` drain pays it through the release policy).
 * - FRAUD: the cash goes to the wronged side. Payer wronged: refunded. Receiver
 *   wronged: released to them. Victim unknown: left for an operator.
 * - NO_EXCHANGE: a collected leg is refunded; an uncollected one is closed.
 */
export function createSettlementTableTradeCashLeg(deps: {
  /** Null when the trade has no settlement row (agreed before the switch). */
  loadSettlement(tradeId: string): Promise<{ payerId: string; receiverId: string; status: string } | null>;
  queueRelease(tradeId: string): Promise<boolean>;
  queueRefund(tradeId: string): Promise<boolean>;
  closeUncollected(tradeId: string): Promise<boolean>;
  legacy: TradeCashLegPort;
}): TradeCashLegPort {
  return {
    async settleForOutcome(tradeId, outcome, context) {
      const row = await deps.loadSettlement(tradeId);
      if (!row) return deps.legacy.settleForOutcome(tradeId, outcome, context);

      if (outcome === 'NO_EXCHANGE') {
        if (row.status === 'COLLECTED') {
          return { manualReconciliation: !(await deps.queueRefund(tradeId)) };
        }
        if (row.status === 'NOT_COLLECTED') {
          return { manualReconciliation: !(await deps.closeUncollected(tradeId)) };
        }
        // COLLECTING (a payment in flight) or already moving: a human decides.
        return { manualReconciliation: row.status !== 'REFUND_PENDING' && row.status !== 'REFUNDED' };
      }

      if (row.status !== 'COLLECTED') {
        // A lock requires a COLLECTED leg, so anything else here is an anomaly.
        return { manualReconciliation: true };
      }

      if (outcome === 'FRAUD') {
        if (context?.victimId === row.payerId) {
          return { manualReconciliation: !(await deps.queueRefund(tradeId)) };
        }
        if (context?.victimId === row.receiverId) {
          return { manualReconciliation: !(await deps.queueRelease(tradeId)) };
        }
        return { manualReconciliation: true };
      }

      return { manualReconciliation: !(await deps.queueRelease(tradeId)) };
    },
  };
}

/**
 * The WP1 binding.
 *
 * - UNFOUNDED / CONDITION: the trade completes, so the legacy leg settles exactly as
 *   a completion would. On a never-inspected trade the orchestrator only reaches this
 *   with the staff attestation that the goods changed hands.
 * - FRAUD: nothing. The legacy cash was never collected, so there is nothing for the
 *   platform to route to the victim; the case is flagged for a human instead.
 * - NO_EXCHANGE: nothing. Nothing was collected and nothing is owed.
 */
export function createLegacyTradeCashLeg(deps: {
  /** Settle the trade's cash leg the way a completion does (`settleTradeCash`). */
  settleTradeCash: (tradeId: string) => Promise<void>;
}): TradeCashLegPort {
  return {
    async settleForOutcome(tradeId, outcome) {
      if (outcome === 'UNFOUNDED' || outcome === 'CONDITION') {
        await deps.settleTradeCash(tradeId);
        return { manualReconciliation: false };
      }
      if (outcome === 'FRAUD') return { manualReconciliation: true };
      return { manualReconciliation: false };
    },
  };
}
