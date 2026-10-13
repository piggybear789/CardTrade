// tests/unit/arbitrationPriorityHoldExpiry.test.ts
//
// ESC-21: a disputed trade whose collateral lapses soon goes to the top of the queue,
// because once the hold expires there is nothing to capture whatever staff decide.
// It is a DEADLINE input, never an amount.

import { describe, expect, it } from 'vitest';

import { DEADLINE_WARNING_HOURS, priorityReasonOf, triage } from '@/domain/arbitration/arbitrationCase';

const NOW = new Date('2026-10-13T00:00:00.000Z');
const base = {
  hasHardDeadline: false,
  deadlineAt: null,
  fraudAlleged: false,
  openedAt: NOW.toISOString(),
};
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

describe('hold expiry in triage (ESC-21)', () => {
  it('a hold lapsing inside the window is CRITICAL', () => {
    expect(priorityReasonOf({ ...base, earliestHoldExpiryAt: inHours(DEADLINE_WARNING_HOURS - 1) }, NOW)).toBe(
      'HOLD_EXPIRING',
    );
  });

  it('outranks alleged fraud', () => {
    expect(
      priorityReasonOf({ ...base, fraudAlleged: true, earliestHoldExpiryAt: inHours(10) }, NOW),
    ).toBe('HOLD_EXPIRING');
  });

  it('a distant expiry does not escalate', () => {
    expect(priorityReasonOf({ ...base, earliestHoldExpiryAt: inHours(DEADLINE_WARNING_HOURS + 1) }, NOW)).toBe(
      'IN_ORDER',
    );
  });

  it('maps to CRITICAL through triage', () => {
    const triaged = triage(
      {
        kind: 'TRADE',
        ref: 't1',
        earliestHoldExpiryAt: inHours(5),
        ...base,
      } as unknown as Parameters<typeof triage>[0],
      NOW,
    );
    expect(triaged.priority).toBe('CRITICAL');
  });
});
