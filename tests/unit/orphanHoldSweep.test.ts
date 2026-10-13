// tests/unit/orphanHoldSweep.test.ts
//
// ESC-34: a provider hold with no live row is released; a live one is kept; a region
// whose provider search fails is skipped (never treated as "nothing live").

import { describe, expect, it } from 'vitest';

import { ORPHAN_MIN_AGE_MINUTES, sweepOrphanHolds } from '@/domain/orchestrator/orphanHolds';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';

const NOW = new Date('2026-10-13T03:00:00.000Z');

async function withHolds() {
  const payments = new InMemoryService();
  const live = await payments.placeHold({ payerId: 'p1', amount: 1_000, ref: 'hold:t1:p1' });
  const orphan = await payments.placeHold({ payerId: 'p2', amount: 2_000, ref: 'hold:t2:p2' });
  return { payments, live, orphan };
}

describe('sweepOrphanHolds (ESC-34)', () => {
  it('voids a provider hold with no live row and keeps a live one', async () => {
    const { payments, live, orphan } = await withHolds();
    const voided: string[] = [];
    const result = await sweepOrphanHolds(
      {
        listUncaptured: () => payments.listUncapturedHolds(),
        liveHoldIds: async () => new Set([live.holdId]),
        voidHold: (id) => payments.voidHold(id),
        onVoided: async (id) => {
          voided.push(id);
        },
      },
      NOW,
    );
    expect(result).toEqual({ considered: 2, voided: 1, failed: 0 });
    expect(voided).toEqual([orphan.holdId]);
    expect(payments.holds.get(live.holdId)?.status).toBe('ACTIVE');
  });

  it('asks only for holds older than the minimum age', async () => {
    let asked = '';
    await sweepOrphanHolds(
      {
        listUncaptured: async (olderThan) => {
          asked = olderThan;
          return [];
        },
        liveHoldIds: async () => new Set(),
        voidHold: async () => ({ status: 'VOIDED' }),
      },
      NOW,
    );
    expect(Date.parse(asked)).toBe(NOW.getTime() - ORPHAN_MIN_AGE_MINUTES * 60_000);
  });

  it('a provider search error propagates so the region is skipped, not swept', async () => {
    const { payments } = await withHolds();
    payments.failListUncaptured = true;
    let voids = 0;
    await expect(
      sweepOrphanHolds(
        {
          listUncaptured: () => payments.listUncapturedHolds(),
          liveHoldIds: async () => new Set(),
          voidHold: async () => {
            voids += 1;
            return { status: 'VOIDED' };
          },
        },
        NOW,
      ),
    ).rejects.toThrow();
    expect(voids).toBe(0);
  });

  it('a failed void is counted, not hidden', async () => {
    const { payments } = await withHolds();
    const result = await sweepOrphanHolds(
      {
        listUncaptured: () => payments.listUncapturedHolds(),
        liveHoldIds: async () => new Set(),
        voidHold: async () => ({ status: 'FAILED' }),
      },
      NOW,
    );
    expect(result.failed).toBe(2);
  });
});
