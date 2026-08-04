// tests/unit/arbitrationCase.test.ts
//
// Triage ordering for the arbitration queue.
//
// WHAT IS WORTH PINNING HERE. The queue is the whole product for a support worker: it
// decides which dispute a human looks at next, and the two ways it can fail quietly are
// both invisible in a screenshot.
//
//   1. Ordering by money. Sorting or prioritising on `amountAtRiskCents` reads as
//      obviously sensible and systematically abandons small disputes — a $40 case
//      nobody ever answers is a worse outcome than a $4,000 case answered on day three.
//      So there is a test that a large, fresh, unremarkable case does NOT outrank a
//      small one that has blown its SLA.
//   2. Unstable ordering. Two cases raised in the same second with no tiebreak can swap
//      places between renders, and a queue that reshuffles under a worker is one they
//      stop trusting. `compareForTriage` breaks ties on `ref` so the ordering is total.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ARBITRATION_SLA_HOURS,
  buildQueue,
  compareForTriage,
  filterQueue,
  parseCaseKind,
  priorityOf,
  resolveQueueScope,
  summariseQueue,
  triage,
  type ArbitrationCase,
} from '@/domain/arbitration/arbitrationCase';

const NOW = new Date('2026-08-04T12:00:00.000Z');

/** Hours before `NOW`, as an ISO string. */
function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

/** Hours after `NOW`, as an ISO string. */
function hoursAhead(hours: number): string {
  return new Date(NOW.getTime() + hours * 3_600_000).toISOString();
}

function makeCase(overrides: Partial<ArbitrationCase> = {}): ArbitrationCase {
  return {
    kind: 'CASH_SALE',
    ref: 'case-1',
    title: 'A disputed sale',
    amountAtRiskCents: 12_000,
    openedAt: hoursAgo(2),
    raisedById: 'buyer-1',
    claim: 'The card arrived creased.',
    parties: [],
    assigneeId: null,
    assigneeName: null,
    noteCount: 0,
    hasHardDeadline: false,
    deadlineAt: null,
    fraudAlleged: false,
    ...overrides,
  };
}

describe('priorityOf', () => {
  it('treats an imminent hard deadline as critical', () => {
    // A chargeback whose evidence window closes is forfeited automatically. No amount
    // of later attention recovers it, which is why it outranks everything else.
    const priority = priorityOf(
      {
        hasHardDeadline: true,
        deadlineAt: hoursAhead(6),
        fraudAlleged: false,
        openedAt: hoursAgo(1),
      },
      NOW,
    );
    expect(priority).toBe('CRITICAL');
  });

  it('stays critical once a hard deadline has passed', () => {
    // Still critical, not downgraded: the money may be gone, but somebody has to
    // record why it was lost.
    expect(
      priorityOf(
        {
          hasHardDeadline: true,
          deadlineAt: hoursAgo(30),
          fraudAlleged: false,
          openedAt: hoursAgo(40),
        },
        NOW,
      ),
    ).toBe('CRITICAL');
  });

  it('raises an alleged fraud above an ordinary condition dispute', () => {
    expect(
      priorityOf(
        { hasHardDeadline: false, deadlineAt: null, fraudAlleged: true, openedAt: hoursAgo(1) },
        NOW,
      ),
    ).toBe('HIGH');
    expect(
      priorityOf(
        { hasHardDeadline: false, deadlineAt: null, fraudAlleged: false, openedAt: hoursAgo(1) },
        NOW,
      ),
    ).toBe('NORMAL');
  });

  it('raises a case that has blown its SLA', () => {
    expect(
      priorityOf(
        {
          hasHardDeadline: false,
          deadlineAt: null,
          fraudAlleged: false,
          openedAt: hoursAgo(ARBITRATION_SLA_HOURS),
        },
        NOW,
      ),
    ).toBe('HIGH');
  });

  it('does not crash or escalate on an unparseable timestamp', () => {
    // Provider and legacy rows do occasionally carry junk. A queue that throws is
    // worse than a queue that treats an unknown age as brand new.
    expect(
      priorityOf(
        { hasHardDeadline: true, deadlineAt: 'not-a-date', fraudAlleged: false, openedAt: 'nope' },
        NOW,
      ),
    ).toBe('NORMAL');
  });
});

describe('buildQueue', () => {
  it('does not let a large fresh case outrank a small overdue one', () => {
    const queue = buildQueue(
      [
        makeCase({ ref: 'rich', amountAtRiskCents: 400_000, openedAt: hoursAgo(1) }),
        makeCase({ ref: 'poor', amountAtRiskCents: 4_000, openedAt: hoursAgo(200) }),
      ],
      NOW,
    );

    expect(queue.map((c) => c.ref)).toEqual(['poor', 'rich']);
  });

  it('orders critical, then high, then normal, oldest first within a band', () => {
    const queue = buildQueue(
      [
        makeCase({ ref: 'normal-new', openedAt: hoursAgo(1) }),
        makeCase({ ref: 'normal-old', openedAt: hoursAgo(10) }),
        makeCase({ ref: 'fraud', fraudAlleged: true, openedAt: hoursAgo(1) }),
        makeCase({
          ref: 'deadline',
          kind: 'CHARGEBACK',
          hasHardDeadline: true,
          deadlineAt: hoursAhead(3),
          openedAt: hoursAgo(1),
        }),
      ],
      NOW,
    );

    expect(queue.map((c) => c.ref)).toEqual(['deadline', 'fraud', 'normal-old', 'normal-new']);
  });

  it('reports whole hours of age and hours remaining to a deadline', () => {
    const [only] = buildQueue(
      [
        makeCase({
          openedAt: hoursAgo(5),
          hasHardDeadline: true,
          deadlineAt: hoursAhead(10),
        }),
      ],
      NOW,
    );

    expect(only.ageHours).toBe(5);
    expect(only.hoursToDeadline).toBe(10);
  });

  it('never reports a negative age for a future timestamp', () => {
    // Clock skew between the database and the app server is real, and a case listed
    // as "-1h old" is a bug report waiting to happen.
    const [only] = buildQueue([makeCase({ openedAt: hoursAhead(3) })], NOW);
    expect(only.ageHours).toBe(0);
  });
});

describe('compareForTriage', () => {
  it('is a total order — equal priority and age still break deterministically', () => {
    const a = triage(makeCase({ ref: 'aaa' }), NOW);
    const b = triage(makeCase({ ref: 'bbb' }), NOW);

    expect(compareForTriage(a, b)).toBeLessThan(0);
    expect(compareForTriage(b, a)).toBeGreaterThan(0);
    expect(compareForTriage(a, a)).toBe(0);
  });

  it('sorts identically regardless of input order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            ref: fc.string({ minLength: 1, maxLength: 6 }),
            ageHours: fc.integer({ min: 0, max: 500 }),
            fraudAlleged: fc.boolean(),
          }),
          { maxLength: 12 },
        ),
        (specs) => {
          // Distinct refs, since two cases cannot share a primary key.
          const unique = specs.filter(
            (spec, index) => specs.findIndex((s) => s.ref === spec.ref) === index,
          );
          const cases = unique.map((spec) =>
            makeCase({
              ref: spec.ref,
              openedAt: hoursAgo(spec.ageHours),
              fraudAlleged: spec.fraudAlleged,
            }),
          );

          const forward = buildQueue(cases, NOW).map((c) => c.ref);
          const reversed = buildQueue([...cases].reverse(), NOW).map((c) => c.ref);

          expect(reversed).toEqual(forward);
        },
      ),
    );
  });
});

describe('summariseQueue', () => {
  it('sums money at risk in exact integer cents', () => {
    const queue = buildQueue(
      [
        makeCase({ ref: 'a', amountAtRiskCents: 1_999 }),
        makeCase({ ref: 'b', amountAtRiskCents: 2_001 }),
        makeCase({ ref: 'c', amountAtRiskCents: 1 }),
      ],
      NOW,
    );

    expect(summariseQueue(queue).amountAtRiskCents).toBe(4_001);
  });

  it('counts critical, unassigned and overdue independently', () => {
    const queue = buildQueue(
      [
        makeCase({ ref: 'a', assigneeId: 'staff-1', assigneeName: 'Sam' }),
        makeCase({ ref: 'b', openedAt: hoursAgo(200) }),
        makeCase({
          ref: 'c',
          kind: 'CHARGEBACK',
          hasHardDeadline: true,
          deadlineAt: hoursAhead(2),
        }),
      ],
      NOW,
    );

    expect(summariseQueue(queue)).toMatchObject({
      total: 3,
      critical: 1,
      unassigned: 2,
      overdue: 1,
    });
  });

  it('ignores a negative amount rather than subtracting from the headline', () => {
    // Defensive: a refund column read as a negative would otherwise make the total
    // smaller than the rows beneath it, which reads as a rendering bug.
    const queue = buildQueue([makeCase({ amountAtRiskCents: -500 })], NOW);
    expect(summariseQueue(queue).amountAtRiskCents).toBe(0);
  });
});

describe('scope and kind narrowing', () => {
  it('defaults an unknown queue scope to all open cases', () => {
    expect(resolveQueueScope(undefined)).toBe('open');
    expect(resolveQueueScope('nonsense')).toBe('open');
    expect(resolveQueueScope(['mine', 'unassigned'])).toBe('mine');
    expect(resolveQueueScope('unassigned')).toBe('unassigned');
  });

  it('filters by viewer for "mine" and by absence for "unassigned"', () => {
    const cases = buildQueue(
      [
        makeCase({ ref: 'mine', assigneeId: 'me', assigneeName: 'Me' }),
        makeCase({ ref: 'theirs', assigneeId: 'them', assigneeName: 'Them' }),
        makeCase({ ref: 'free' }),
      ],
      NOW,
    );

    expect(filterQueue(cases, 'mine', 'me').map((c) => c.ref)).toEqual(['mine']);
    expect(filterQueue(cases, 'unassigned', 'me').map((c) => c.ref)).toEqual(['free']);
    expect(filterQueue(cases, 'open', 'me')).toHaveLength(3);
  });

  it('refuses an unknown case kind instead of defaulting to one', () => {
    // A case kind selects which table gets read and which outcome controls render.
    // Defaulting a mistyped URL would show the wrong money for the wrong record.
    expect(parseCaseKind('CASH_SALE')).toBe('CASH_SALE');
    expect(parseCaseKind('TRADE')).toBe('TRADE');
    expect(parseCaseKind('CHARGEBACK')).toBe('CHARGEBACK');
    expect(parseCaseKind('cash_sale')).toBeNull();
    expect(parseCaseKind('')).toBeNull();
    expect(parseCaseKind(undefined)).toBeNull();
  });
});
