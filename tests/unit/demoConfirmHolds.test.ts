// tests/unit/demoConfirmHolds.test.ts
//
// ESC-08: the demo panel's simulated hold webhooks carry each trader's CURRENT hold
// id, one event per trader. A status-only event would now be an unroutable NO_OP.

import { describe, expect, it } from 'vitest';

import { demoHoldEvents } from '@/lib/trades/demoHoldEvents';
import { mapEventToAction } from '@/domain/webhook/mapEventToAction';

const holds = [
  { traderId: 'a', holdRef: 'pi_a', status: 'ACTIVE' as const, createdAt: '2026-10-01T00:00:00Z' },
  { traderId: 'b', holdRef: 'pi_b_old', status: 'FAILED' as const, createdAt: '2026-10-01T00:00:00Z' },
  { traderId: 'b', holdRef: 'pi_b_new', status: 'ACTIVE' as const, createdAt: '2026-10-02T00:00:00Z' },
];

describe('demoHoldEvents', () => {
  it('sends one hold.active per trader with that trader\'s current holdRef', () => {
    const events = demoHoldEvents({ tradeId: 't1', kind: 'confirm-holds', traderIds: ['a', 'b'], holds });
    expect(events.map((e) => [e.type, e.payload.holdId])).toEqual([
      ['hold.active', 'pi_a'],
      ['hold.active', 'pi_b_new'],
    ]);
    // Each one routes to a per-hold reconcile, not a trade event.
    expect(events.map((e) => mapEventToAction(e).kind)).toEqual(['HOLD_STATUS', 'HOLD_STATUS']);
  });

  it('gives each attempt its own idempotent event id', () => {
    const [a, b] = demoHoldEvents({ tradeId: 't1', kind: 'fail-holds', traderIds: ['a', 'b'], holds });
    expect(a.eventId).toBe('evt_demo_fail-holds_t1_pi_a');
    expect(b.eventId).toBe('evt_demo_fail-holds_t1_pi_b_new');
    expect(b.type).toBe('hold.failed');
  });

  it('skips a trader with no hold', () => {
    expect(demoHoldEvents({ tradeId: 't1', kind: 'confirm-holds', traderIds: ['a', 'c'], holds })).toHaveLength(1);
  });
});
