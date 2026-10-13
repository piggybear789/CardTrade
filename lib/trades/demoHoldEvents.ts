// lib/trades/demoHoldEvents.ts
//
// The simulated collateral webhooks the demo panel fires (ESC-08).
//
// Since hold events stopped mapping to a trade event, a `hold.active` is a statement
// about ONE hold and is only applied when it names that trader's CURRENT attempt. The
// panel used to send a single status-only event per trade, which would now be an
// unroutable NO_OP and the demo would stop locking trades. It sends one event per
// trader instead, each carrying that trader's current `holdRef`:
//
//   confirm-holds -> hold.active (per trader, current holdRef) -> HOLD_STATUS
//                 -> confirmCollateralIfComplete
//
// Pure: kept out of the `'use server'` demo module, which may only export async
// Server Actions, so it can be tested.

import { currentHold, type HoldLike } from '@/domain/bond/currentHolds';
import type { WebhookEvent } from '@/domain/services/types';

export type DemoHoldKind = 'confirm-holds' | 'fail-holds';

/** One event per trader that has a hold, in trader order. */
export function demoHoldEvents(params: {
  tradeId: string;
  kind: DemoHoldKind;
  traderIds: readonly string[];
  holds: readonly HoldLike[];
  now?: Date;
}): WebhookEvent[] {
  const occurredAt = (params.now ?? new Date()).toISOString();
  const events: WebhookEvent[] = [];
  for (const traderId of params.traderIds) {
    const hold = currentHold(params.holds, traderId);
    if (!hold) continue;
    events.push({
      // Stable per (attempt, kind), so re-firing is idempotent (Req 10.5) while a
      // retried hold gets its own event.
      eventId: `evt_demo_${params.kind}_${params.tradeId}_${hold.holdRef}`,
      type: params.kind === 'confirm-holds' ? 'hold.active' : 'hold.failed',
      occurredAt,
      payload: {
        tradeId: params.tradeId,
        holdId: hold.holdRef,
        status: params.kind === 'confirm-holds' ? 'ACTIVE' : 'FAILED',
        ...(params.kind === 'fail-holds' ? { reason: 'Simulated pre-auth hold failure' } : {}),
      },
    });
  }
  return events;
}
