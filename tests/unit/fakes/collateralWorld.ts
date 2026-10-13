// tests/unit/fakes/collateralWorld.ts
//
// A tiny in-memory trade + holds + guarded transition for the ESC-08 lock rule.

import type { CollateralReconcileDeps } from '@/domain/orchestrator/collateralReconcile';
import type { HoldLike } from '@/domain/bond/currentHolds';
import type { TradeEvent, TradeState } from '@/domain/state-machine/types';

export const A = 'trader-a';
export const B = 'trader-b';

/** A tiny in-memory world: one trade, its holds, and a guarded transition. */
export function world(initial: { state?: TradeState; holds?: HoldLike[] } = {}) {
  const trade = { id: 't1', state: (initial.state ?? 'COLLATERAL_PENDING') as TradeState, initiator_id: A, counterpart_id: B };
  const holds: HoldLike[] = [...(initial.holds ?? [])];
  const notified: string[] = [];
  const events: TradeEvent[] = [];

  const deps: CollateralReconcileDeps = {
    repository: {
      getHolds: async () => holds.map((h) => ({ ...h })),
      markHoldStatus: async (holdRef, status) => {
        const row = holds.find((h) => h.holdRef === holdRef);
        if (row) row.status = status;
      },
    },
    loadTrade: async () => ({ ...trade }),
    applyEvent: async ({ event }) => {
      events.push(event);
      if (event === 'HOLDS_CONFIRMED') {
        if (trade.state !== 'COLLATERAL_PENDING') return { ok: false, error: 'INVALID_TRANSITION' };
        trade.state = 'COLLATERAL_LOCKED';
      }
      if (event === 'HOLDS_FAILED') {
        if (trade.state !== 'COLLATERAL_PENDING') return { ok: false, error: 'INVALID_TRANSITION' };
      }
      return { ok: true, trade: { ...trade } as never };
    },
    notifyLocked: async ({ tradeId }) => {
      notified.push(tradeId);
    },
  };
  return { trade, holds, notified, events, deps };
}

export const hold = (traderId: string, holdRef: string, status: HoldLike['status'], createdAt: string): HoldLike => ({
  traderId,
  holdRef,
  status,
  createdAt,
});

