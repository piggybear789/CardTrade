// tests/unit/tradeFulfilment.test.ts
//
// The two routes a 2-way Trade takes to INSPECTION, one per fulfilment method, and
// the inspection clock that ends it.
//
// These are the behaviours 0057 added, and each one closed a hole that was reachable
// in production:
//
//   * A face-to-face trade used to be walked through BOTH_SHIPPED / BOTH_RECEIVED, so
//     two people meeting in a car park were asked to record a shipment each.
//   * Confirming a face-to-face handover must NOT complete the trade. A trader who
//     has just been robbed, coerced, or handed a convincing fake at a meeting point
//     needs a remedy afterwards, which is why both confirmations land on INSPECTION.
//   * An IN_TRANSIT trade had no exit at all: a parcel that never arrived left both
//     traders' collateral sitting until the card authorisation lapsed.
//   * Nothing ever ended an INSPECTION, so an unresponsive counterpart parked
//     collateral indefinitely.
//
// Pure domain, so no database and no provider.

import { describe, expect, it } from 'vitest';

import { canTransition, transition } from '@/domain/state-machine/machine';
import { deriveEvent } from '@/domain/state-machine/guards';
import { availableActions } from '@/domain/state-machine/actions';
import type { TradeFacts } from '@/domain/state-machine/types';
import {
  TRADE_INSPECTION_FLOOR_HOURS,
  TRADE_INSPECTION_HOURS,
  deriveTradeInspectionDeadline,
  inspectionExpired,
  inspectionHoldRisk,
} from '@/domain/fulfilment';

const HOUR_MS = 3_600_000;

/** A facts snapshot with every leg unset. Overridden per test. */
function facts(overrides: Partial<TradeFacts> = {}): TradeFacts {
  return {
    termsAccepted: { initiator: false, counterpart: false },
    shipped: { initiator: false, counterpart: false },
    received: { initiator: false, counterpart: false },
    accepted: { initiator: false, counterpart: false },
    handoverConfirmed: { initiator: false, counterpart: false },
    holdsActive: { initiator: false, counterpart: false },
    fulfilmentMethod: null,
    ...overrides,
  };
}

const both = { initiator: true, counterpart: true };
const onlyInitiator = { initiator: true, counterpart: false };

describe('face-to-face trades reach INSPECTION, never COMPLETED directly', () => {
  it('moves COLLATERAL_LOCKED to INSPECTION on both handover confirmations', () => {
    const result = transition('COLLATERAL_LOCKED', 'BOTH_HANDOVER_CONFIRMED');
    expect(result.ok).toBe(true);
    // The whole safety argument: a meeting-point confirmation must not be able to
    // sign the trade off, because a trader under duress would sign anything.
    expect(result.nextState).toBe('INSPECTION');
    expect(result.nextState).not.toBe('COMPLETED');
  });

  it('derives BOTH_HANDOVER_CONFIRMED only when both traders have confirmed', () => {
    const inPerson = { fulfilmentMethod: 'IN_PERSON' as const };
    expect(
      deriveEvent('COLLATERAL_LOCKED', facts({ ...inPerson, handoverConfirmed: onlyInitiator })),
    ).toBeNull();
    expect(
      deriveEvent('COLLATERAL_LOCKED', facts({ ...inPerson, handoverConfirmed: both })),
    ).toBe('BOTH_HANDOVER_CONFIRMED');
  });

  it('ignores shipment legs on a face-to-face trade', () => {
    // Both "shipped" flags set on an IN_PERSON trade must not advance it. Before the
    // method was part of the facts snapshot, this is exactly what happened.
    expect(
      deriveEvent(
        'COLLATERAL_LOCKED',
        facts({ fulfilmentMethod: 'IN_PERSON', shipped: both }),
      ),
    ).toBeNull();
  });

  it('ignores handover legs on a posted trade', () => {
    expect(
      deriveEvent(
        'COLLATERAL_LOCKED',
        facts({ fulfilmentMethod: 'DELIVERY', handoverConfirmed: both }),
      ),
    ).toBeNull();
    expect(
      deriveEvent('COLLATERAL_LOCKED', facts({ fulfilmentMethod: 'DELIVERY', shipped: both })),
    ).toBe('BOTH_SHIPPED');
  });

  it('treats an unagreed method as posted, matching pre-0057 behaviour', () => {
    // A trade whose method is still null cannot advance anyway — neither leg is
    // written until a method is agreed — but it must not silently become in-person.
    expect(deriveEvent('COLLATERAL_LOCKED', facts({ shipped: both }))).toBe('BOTH_SHIPPED');
  });
});

describe('permitted controls follow the fulfilment method', () => {
  it('offers a handover confirmation, not a shipment, to a face-to-face trader', () => {
    const actions = availableActions('COLLATERAL_LOCKED', {
      role: 'INITIATOR',
      facts: facts({ fulfilmentMethod: 'IN_PERSON' }),
    });
    expect(actions).toContain('CONFIRM_HANDOVER');
    expect(actions).not.toContain('RECORD_SHIPMENT');
  });

  it('offers a shipment, not a handover confirmation, to a posted trader', () => {
    const actions = availableActions('COLLATERAL_LOCKED', {
      role: 'INITIATOR',
      facts: facts({ fulfilmentMethod: 'DELIVERY' }),
    });
    expect(actions).toContain('RECORD_SHIPMENT');
    expect(actions).not.toContain('CONFIRM_HANDOVER');
  });

  it('suppresses a confirmation the trader has already given', () => {
    const actions = availableActions('COLLATERAL_LOCKED', {
      role: 'INITIATOR',
      facts: facts({
        fulfilmentMethod: 'IN_PERSON',
        handoverConfirmed: onlyInitiator,
      }),
    });
    expect(actions).not.toContain('CONFIRM_HANDOVER');
  });

  it('always lets either trader report that the exchange failed', () => {
    for (const method of ['IN_PERSON', 'DELIVERY'] as const) {
      expect(
        availableActions('COLLATERAL_LOCKED', {
          role: 'COUNTERPART',
          facts: facts({ fulfilmentMethod: method }),
        }),
      ).toContain('REPORT_HANDOVER_FAILED');
    }
    // A parcel that never arrives. This state used to offer nothing but "record
    // receipt", so a trader with no parcel had nothing to press.
    expect(
      availableActions('IN_TRANSIT', {
        role: 'COUNTERPART',
        facts: facts({ fulfilmentMethod: 'DELIVERY' }),
      }),
    ).toContain('REPORT_HANDOVER_FAILED');
  });
});

describe('a failed exchange freezes without capturing', () => {
  it('is reachable from both pre-inspection states', () => {
    expect(canTransition('COLLATERAL_LOCKED', 'HANDOVER_FAILED')).toBe(true);
    expect(canTransition('IN_TRANSIT', 'HANDOVER_FAILED')).toBe(true);
    expect(transition('IN_TRANSIT', 'HANDOVER_FAILED').nextState).toBe('DISPUTED');
  });

  it('is NOT the same event as a condition dispute', () => {
    // CONDITION_DISPUTE settles a $20 Friction_Tax against the other trader. At
    // COLLATERAL_LOCKED nobody has necessarily done anything wrong, and a lost
    // parcel is nobody's fault, so these must stay distinct transitions.
    expect(canTransition('COLLATERAL_LOCKED', 'CONDITION_DISPUTE')).toBe(false);
    expect(canTransition('IN_TRANSIT', 'CONDITION_DISPUTE')).toBe(false);
    expect(canTransition('INSPECTION', 'CONDITION_DISPUTE')).toBe(true);
  });

  it('is never derived from facts — it takes a human decision', () => {
    for (const state of ['COLLATERAL_LOCKED', 'IN_TRANSIT'] as const) {
      expect(deriveEvent(state, facts({ fulfilmentMethod: 'DELIVERY' }))).not.toBe(
        'HANDOVER_FAILED',
      );
    }
  });
});

describe('the inspection window ends the trade', () => {
  it('completes an expired INSPECTION', () => {
    expect(transition('INSPECTION', 'INSPECTION_EXPIRED').nextState).toBe('COMPLETED');
  });

  it('is never derived from facts — a clock drives it, not a trader', () => {
    expect(deriveEvent('INSPECTION', facts())).toBeNull();
    expect(deriveEvent('INSPECTION', facts({ accepted: both }))).toBe('BOTH_ACCEPTED');
  });

  it('cannot expire a DISPUTED trade, so raising a dispute stops the clock', () => {
    expect(canTransition('DISPUTED', 'INSPECTION_EXPIRED')).toBe(false);
  });
});

describe('deriveTradeInspectionDeadline', () => {
  const entered = new Date('2026-03-10T00:00:00.000Z');

  it('measures a face-to-face window from the agreed meeting instant', () => {
    // The meeting both traders accepted IS the exchange, so the clock starts there
    // rather than whenever the second person got round to tapping confirm.
    const meetingAt = '2026-03-09T10:00:00.000Z';
    const deadline = deriveTradeInspectionDeadline(
      { method: 'IN_PERSON', meetingAt },
      entered,
    );
    expect(new Date(deadline).getTime()).toBe(
      new Date(meetingAt).getTime() + TRADE_INSPECTION_HOURS * HOUR_MS,
    );
  });

  it('never leaves less than the floor, however late the confirmation', () => {
    // A meeting four days ago would otherwise produce a deadline in the past and
    // auto-complete on the spot, so nobody would ever get to dispute.
    const deadline = deriveTradeInspectionDeadline(
      { method: 'IN_PERSON', meetingAt: '2026-03-01T00:00:00.000Z' },
      entered,
    );
    expect(new Date(deadline).getTime()).toBe(
      entered.getTime() + TRADE_INSPECTION_FLOOR_HOURS * HOUR_MS,
    );
  });

  it('measures a posted window from the LATER carrier delivery', () => {
    // The exchange is only complete once both parcels have landed.
    const first = '2026-03-08T00:00:00.000Z';
    const second = '2026-03-09T12:00:00.000Z';
    const deadline = deriveTradeInspectionDeadline(
      {
        method: 'DELIVERY',
        initiatorCarrierDeliveredAt: first,
        counterpartCarrierDeliveredAt: second,
      },
      entered,
    );
    expect(new Date(deadline).getTime()).toBe(
      new Date(second).getTime() + TRADE_INSPECTION_HOURS * HOUR_MS,
    );
  });

  it('falls back to the entry instant when a carrier confirmation is missing', () => {
    // A trader's own word that a parcel arrived must not start a clock that can end
    // in a payout against them.
    const deadline = deriveTradeInspectionDeadline(
      { method: 'DELIVERY', initiatorCarrierDeliveredAt: '2026-03-09T00:00:00.000Z' },
      entered,
    );
    expect(new Date(deadline).getTime()).toBe(
      entered.getTime() + TRADE_INSPECTION_HOURS * HOUR_MS,
    );
  });

  it('is shorter than the Cash_Sale window, because collateral expires', () => {
    // A Cash_Sale gets 7 days from delivery; a trade cannot, because its collateral
    // is a ~7-day authorisation that started when the trade did.
    expect(TRADE_INSPECTION_HOURS).toBeLessThan(7 * 24);
  });
});

describe('inspectionHoldRisk', () => {
  it('flags a window that outlives the collateral behind it', () => {
    expect(
      inspectionHoldRisk('2026-03-13T00:00:00.000Z', '2026-03-11T00:00:00.000Z'),
    ).toBe('expired-first');
  });

  it('warns when the margin is under a day', () => {
    expect(
      inspectionHoldRisk('2026-03-11T00:00:00.000Z', '2026-03-11T06:00:00.000Z'),
    ).toBe('tight');
  });

  it('is safe with room to spare, or with nothing to compare', () => {
    expect(
      inspectionHoldRisk('2026-03-11T00:00:00.000Z', '2026-03-20T00:00:00.000Z'),
    ).toBe('safe');
    expect(inspectionHoldRisk('2026-03-11T00:00:00.000Z', null)).toBe('safe');
    expect(inspectionHoldRisk(null, '2026-03-11T00:00:00.000Z')).toBe('safe');
  });
});

describe('inspectionExpired', () => {
  it('is false without a deadline, so a legacy row never auto-completes', () => {
    expect(inspectionExpired(null)).toBe(false);
    expect(inspectionExpired(undefined)).toBe(false);
  });

  it('is true once the instant has passed', () => {
    const now = new Date('2026-03-10T00:00:00.000Z');
    expect(inspectionExpired('2026-03-09T23:59:59.000Z', now)).toBe(true);
    expect(inspectionExpired('2026-03-10T00:00:01.000Z', now)).toBe(false);
  });
});
