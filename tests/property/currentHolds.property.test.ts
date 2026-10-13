// tests/property/currentHolds.property.test.ts
//
// ESC-07 / ESC-08: which hold row counts.
//
// A trader's hold history on one trade is a sequence of attempts, each its own row and
// its own idempotency key: `hold:<trade>:<trader>` first, then `:2`, `:3` after a
// decline. The bug was picking the FIRST row — usually a FAILED attempt — so a dispute
// captured a key that held nothing while the live authorisation lapsed. These
// properties pin the single helper every caller now uses.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  currentHold,
  currentHoldsCoverTraders,
  currentLiveHold,
  type HoldLike,
} from '@/domain/bond/currentHolds';

type Status = 'FAILED' | 'VOIDED' | 'ACTIVE';

/** One trader's attempt history, as rows with the real key scheme. */
function history(traderId: string, statuses: Status[], baseMs = 1_700_000_000_000): HoldLike[] {
  return statuses.map((status, i) => ({
    traderId,
    holdRef: `pi_${traderId}_${i + 1}`,
    status,
    // The idempotency key is not the provider ref; keep the scheme visible so a
    // property can assert the helper never hands back a FAILED attempt.
    createdAt: new Date(baseMs + i * 60_000).toISOString(),
  }));
}

const statuses = fc.array(fc.constantFrom<Status>('FAILED', 'VOIDED', 'ACTIVE'), {
  minLength: 1,
  maxLength: 6,
});

describe('currentLiveHold', () => {
  it('returns the latest ACTIVE attempt, never a FAILED one', () => {
    fc.assert(
      fc.property(statuses, (seq) => {
        const rows = history('alice', seq);
        const live = currentLiveHold(rows, 'alice');
        const lastActive = seq.lastIndexOf('ACTIVE');
        if (lastActive === -1) {
          expect(live).toBeUndefined();
        } else {
          expect(live?.holdRef).toBe(`pi_alice_${lastActive + 1}`);
          expect(live?.status).toBe('ACTIVE');
        }
      }),
    );
  });

  it('is independent of the order the rows were read in', () => {
    fc.assert(
      fc.property(statuses, fc.integer({ min: 0, max: 1000 }), (seq, seed) => {
        const rows = history('alice', seq);
        // A deterministic shuffle: the helper orders by createdAt, not by position.
        const shuffled = [...rows].sort(
          (a, b) => ((a.holdRef.length * 31 + seed) % 7) - ((b.holdRef.length * 31 + seed) % 7) || a.holdRef.localeCompare(b.holdRef) * (seed % 2 ? 1 : -1),
        );
        expect(currentLiveHold(shuffled, 'alice')?.holdRef).toBe(
          currentLiveHold(rows, 'alice')?.holdRef,
        );
        expect(currentHold(shuffled, 'alice')?.holdRef).toBe(currentHold(rows, 'alice')?.holdRef);
      }),
    );
  });

  it("never returns another trader's hold", () => {
    fc.assert(
      fc.property(statuses, statuses, (a, b) => {
        const rows = [...history('alice', a), ...history('bob', b, 1_700_000_500_000)];
        const live = currentLiveHold(rows, 'alice');
        if (live) expect(live.traderId).toBe('alice');
      }),
    );
  });

  it('treats a custody-captured hold as live and a finished fraud capture as not', () => {
    const custody: HoldLike = {
      traderId: 'alice', holdRef: 'pi_c', status: 'FULLY_CAPTURED',
      createdAt: '2026-01-01T00:00:00.000Z', custodyCapturedAt: '2026-01-03T00:00:00.000Z',
    };
    const fraud: HoldLike = { ...custody, holdRef: 'pi_f', custodyCapturedAt: null };
    expect(currentLiveHold([custody], 'alice')?.holdRef).toBe('pi_c');
    expect(currentLiveHold([fraud], 'alice')).toBeUndefined();
  });
});

describe('currentHoldsCoverTraders', () => {
  it('is false whenever a listed trader has no row', () => {
    fc.assert(
      fc.property(statuses, (seq) => {
        expect(currentHoldsCoverTraders(history('alice', seq), ['alice', 'bob'])).toBe(false);
      }),
    );
  });

  it("is true exactly when every trader's latest row is ACTIVE", () => {
    fc.assert(
      fc.property(statuses, statuses, (a, b) => {
        const rows = [...history('alice', a), ...history('bob', b, 1_700_000_500_000)];
        const expected = a[a.length - 1] === 'ACTIVE' && b[b.length - 1] === 'ACTIVE';
        expect(currentHoldsCoverTraders(rows, ['alice', 'bob'])).toBe(expected);
      }),
    );
  });

  it('is false for an empty trader list', () => {
    expect(currentHoldsCoverTraders([], [])).toBe(false);
  });
});
