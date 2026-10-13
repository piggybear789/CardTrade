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
  settleForOutcome(tradeId: string, outcome: TradeDisputeOutcomeKind): Promise<TradeCashLegResult>;
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
