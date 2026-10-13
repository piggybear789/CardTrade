// tests/unit/custodyEscalation.test.ts
//
// The custody backstop's selection (ESC-01, design §1.2 "Custody backstop sweep").
// Every live hold on a DISPUTED trade by default, whatever opened the dispute; staff
// may narrow to the accused; a hold with no expiry is never taken; the margin boundary
// is inclusive.

import { describe, expect, it } from 'vitest';

import {
  CUSTODY_CAPTURE_MARGIN_HOURS,
  CUSTODY_WARNING_HOURS,
  holdsToEscalate,
  holdsToWarn,
  type EscalationHold,
  type EscalationTrade,
} from '@/domain/dispute/custodyEscalation';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-13T12:00:00.000Z');
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * HOUR).toISOString();

const A = 'trader-a';
const B = 'trader-b';

function trade(overrides: Partial<EscalationTrade> = {}): EscalationTrade {
  return { state: 'DISPUTED', initiatorId: A, counterpartId: B, custodyScope: 'ALL', accusedId: null, ...overrides };
}

function hold(traderId: string, expiresInHours: number | null, overrides: Partial<EscalationHold> = {}): EscalationHold {
  return {
    traderId,
    holdRef: `pi_${traderId}`,
    status: 'ACTIVE',
    createdAt: at(-100),
    custodyCapturedAt: null,
    expiresAt: expiresInHours === null ? null : at(expiresInHours),
    ...overrides,
  };
}

describe('holdsToEscalate', () => {
  // The three ways a trade becomes DISPUTED all look the same to the backstop: the
  // trade state is the only input, so whoever filed cannot choose whose hold survives.
  it.each(['HANDOVER_FAILED', 'FRAUD_CLAIMED', 'CONDITION_DISPUTE'])(
    'takes BOTH traders\' lapsing holds by default (entered via %s)',
    () => {
      const holds = [hold(A, 2), hold(B, 3)];
      expect(holdsToEscalate(trade(), holds, NOW).sort()).toEqual(['pi_trader-a', 'pi_trader-b']);
    },
  );

  it('narrows to the accused only when staff set ACCUSED_ONLY', () => {
    const holds = [hold(A, 2), hold(B, 2)];
    expect(holdsToEscalate(trade({ custodyScope: 'ACCUSED_ONLY', accusedId: B }), holds, NOW)).toEqual(['pi_trader-b']);
  });

  it('ignores ACCUSED_ONLY with no accused recorded (falls back to all)', () => {
    const holds = [hold(A, 2), hold(B, 2)];
    expect(holdsToEscalate(trade({ custodyScope: 'ACCUSED_ONLY', accusedId: null }), holds, NOW)).toHaveLength(2);
  });

  it('never takes a hold with no expiry', () => {
    expect(holdsToEscalate(trade(), [hold(A, null), hold(B, null)], NOW)).toEqual([]);
  });

  it('is empty unless the trade is DISPUTED', () => {
    const holds = [hold(A, 1), hold(B, 1)];
    for (const state of ['COLLATERAL_LOCKED', 'INSPECTION', 'COMPLETED', 'CANCELLED'] as const) {
      expect(holdsToEscalate(trade({ state }), holds, NOW)).toEqual([]);
    }
  });

  it('treats the margin boundary as inclusive', () => {
    expect(holdsToEscalate(trade(), [hold(A, CUSTODY_CAPTURE_MARGIN_HOURS)], NOW)).toEqual(['pi_trader-a']);
    expect(holdsToEscalate(trade(), [hold(A, CUSTODY_CAPTURE_MARGIN_HOURS + 0.01)], NOW)).toEqual([]);
  });

  it('skips a hold already taken into custody', () => {
    const captured = hold(A, 1, { status: 'FULLY_CAPTURED', custodyCapturedAt: at(-1) });
    expect(holdsToEscalate(trade(), [captured], NOW)).toEqual([]);
  });

  it('only considers the latest attempt, never a dead earlier one', () => {
    const dead = hold(A, 1, { holdRef: 'pi_dead', status: 'FAILED', createdAt: at(-90) });
    const live = hold(A, 50, { holdRef: 'pi_live', createdAt: at(-10) });
    expect(holdsToEscalate(trade(), [dead, live], NOW)).toEqual([]);
  });
});

describe('holdsToWarn', () => {
  it('warns inside the day before the capture point, not after it', () => {
    const warnable = hold(A, CUSTODY_CAPTURE_MARGIN_HOURS + CUSTODY_WARNING_HOURS - 1);
    const due = hold(B, CUSTODY_CAPTURE_MARGIN_HOURS - 1);
    expect(holdsToWarn(trade(), [warnable, due], NOW)).toEqual(['pi_trader-a']);
  });

  it('does not warn about a far-off expiry', () => {
    expect(holdsToWarn(trade(), [hold(A, 100)], NOW)).toEqual([]);
  });
});
