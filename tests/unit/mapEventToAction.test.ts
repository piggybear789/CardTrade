// tests/unit/mapEventToAction.test.ts
//
// ESC-08: a provider hold event is a statement about ONE hold, never a trade event.
// It used to map to HOLDS_CONFIRMED, so the first trader's authorisation locked the
// whole trade with the other's collateral still missing.

import { describe, expect, it } from 'vitest';

import { mapEventToAction } from '@/domain/webhook/mapEventToAction';
import type { WebhookEvent } from '@/domain/services/types';

function event(type: WebhookEvent['type'], payload: WebhookEvent['payload'] = {}): WebhookEvent {
  return { eventId: 'evt_1', type, occurredAt: '2026-10-13T00:00:00.000Z', payload };
}

describe('mapEventToAction: collateral holds', () => {
  it.each(['hold.active', 'hold.failed'] as const)('%s never maps to a trade event', (type) => {
    const action = mapEventToAction(event(type, { tradeId: 't1', holdId: 'pi_1' }));
    expect(action.kind).not.toBe('TRADE_EVENT');
    expect(action).toEqual({
      kind: 'HOLD_STATUS',
      status: type === 'hold.active' ? 'ACTIVE' : 'FAILED',
      holdId: 'pi_1',
      tradeId: 't1',
    });
  });

  it('is a NO_OP without a hold id, rather than being applied to a guess', () => {
    expect(mapEventToAction(event('hold.active', { tradeId: 't1' }))).toEqual({ kind: 'NO_OP' });
  });
});
