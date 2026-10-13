// tests/unit/holdExpiryReestimate.test.ts
//
// R4-M5 / ESC-17a. Holds flagged by 0133 (`expires_at_estimated`) get the provider's
// real `capture_before`, or a floored estimate, and the flag cleared. The pass runs
// BEFORE the custody backstop in the `:17` job, because the backstop keys on
// `expires_at`.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/errors/errorLog', () => ({ logBackgroundFailure: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import {
  reestimateHoldExpiries,
  type EstimatedHold,
  type HoldExpiryStore,
} from '@/lib/trades/holdExpiryReestimate';
import {
  CUSTODY_CAPTURE_MARGIN_HOURS,
  REESTIMATE_FLOOR_HOURS,
  reestimatedExpiry,
} from '@/domain/dispute/custodyEscalation';
import { CARD_AUTHORISATION_HOURS } from '@/domain/fulfilment/inspection';
import type { PaymentService } from '@/domain/services/types';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-13T12:00:00.000Z');

function store(holds: EstimatedHold[]) {
  const writes: Array<{ holdRef: string; expiresAt: string }> = [];
  const value: HoldExpiryStore = {
    listEstimated: async () => holds,
    writeExpiry: async (params) => {
      writes.push(params);
    },
  };
  return { value, writes };
}

function payments(expiry: (ref: string) => string | null | Error): PaymentService {
  return {
    readHoldExpiry: async (holdId: string) => {
      const result = expiry(holdId);
      if (result instanceof Error) throw result;
      return { expiresAt: result };
    },
  } as unknown as PaymentService;
}

const hold = (ref: string, createdHoursAgo: number): EstimatedHold => ({
  holdRef: ref,
  tradeId: `trade-${ref}`,
  createdAt: new Date(NOW.getTime() - createdHoursAgo * HOUR).toISOString(),
  currency: 'aud',
});

describe('reestimatedExpiry', () => {
  it('uses the provider date verbatim', () => {
    const provider = '2026-10-15T01:02:03.000Z';
    expect(reestimatedExpiry({ createdAt: hold('a', 10).createdAt, providerExpiresAt: provider, now: NOW })).toBe(provider);
  });

  it('estimates created + CARD_AUTHORISATION_HOURS when the provider is silent', () => {
    const created = hold('a', 10).createdAt;
    const expected = new Date(Date.parse(created) + CARD_AUTHORISATION_HOURS * HOUR).toISOString();
    expect(reestimatedExpiry({ createdAt: created, providerExpiresAt: null, now: NOW })).toBe(expected);
  });

  it('never estimates earlier than now + the floor', () => {
    const created = hold('a', 150).createdAt; // created + 114h is already in the past
    const expected = new Date(NOW.getTime() + REESTIMATE_FLOOR_HOURS * HOUR).toISOString();
    expect(reestimatedExpiry({ createdAt: created, providerExpiresAt: null, now: NOW })).toBe(expected);
  });

  it('floors above the capture margin, so the backstop always gets an attempt', () => {
    expect(REESTIMATE_FLOOR_HOURS).toBeGreaterThan(CUSTODY_CAPTURE_MARGIN_HOURS);
  });
});

describe('reestimateHoldExpiries', () => {
  it('writes the provider date, or the floored estimate, and clears each flag', async () => {
    const s = store([hold('pi_known', 20), hold('pi_silent', 150)]);
    const result = await reestimateHoldExpiries({
      store: s.value,
      paymentsFor: () => payments((ref) => (ref === 'pi_known' ? '2026-10-16T00:00:00.000Z' : null)),
      now: () => NOW,
    });
    expect(result).toEqual({ considered: 2, fromProvider: 1, estimated: 1, failed: 0 });
    expect(s.writes).toEqual([
      { holdRef: 'pi_known', expiresAt: '2026-10-16T00:00:00.000Z' },
      { holdRef: 'pi_silent', expiresAt: new Date(NOW.getTime() + REESTIMATE_FLOOR_HOURS * HOUR).toISOString() },
    ]);
  });

  it('treats a provider read that throws as silent, still clearing the flag', async () => {
    const s = store([hold('pi_err', 10)]);
    const result = await reestimateHoldExpiries({
      store: s.value,
      paymentsFor: () => payments(() => new Error('network')),
      now: () => NOW,
    });
    expect(result.estimated).toBe(1);
    expect(s.writes).toHaveLength(1);
  });

  it('counts a failed write without stopping the pass', async () => {
    const writes: string[] = [];
    const failing: HoldExpiryStore = {
      listEstimated: async () => [hold('pi_1', 10), hold('pi_2', 10)],
      writeExpiry: async ({ holdRef }) => {
        if (holdRef === 'pi_1') throw new Error('db down');
        writes.push(holdRef);
      },
    };
    const result = await reestimateHoldExpiries({ store: failing, paymentsFor: () => payments(() => null), now: () => NOW });
    expect(result.failed).toBe(1);
    expect(writes).toEqual(['pi_2']);
  });
});

describe('the :17 job order', () => {
  it('re-estimates expiries before the custody backstop, and both before the inspections', async () => {
    vi.resetModules();
    vi.doMock('@/lib/trades/inspectionSweep', () => ({ flagStaleCollateralTrades: vi.fn(), sweepTradeInspections: vi.fn() }));
    vi.doMock('@/lib/trades/bondPlacementSweep', () => ({ advanceDueHandovers: vi.fn(), placeDueTradeCollateral: vi.fn() }));
    vi.doMock('@/lib/trades/cashSaleInspectionSweep', () => ({ sweepCashSaleInspections: vi.fn() }));
    vi.doMock('@/lib/trades/holdExpiryReestimate', () => ({ reestimateHoldExpiries: vi.fn() }));
    vi.doMock('@/lib/trades/custodyEscalationSweep', () => ({ sweepCustodyEscalation: vi.fn() }));
    vi.doMock('@/lib/trades/handoverChanges', () => ({ expireHandoverChangeProposals: vi.fn() }));
    vi.doMock('@/lib/actions/tradeFees', () => ({ drainFailedTradeFees: vi.fn() }));
    const { TRADE_INSPECTION_JOB_STEPS } = await import('@/lib/trades/tradeInspectionJob');
    const keys = TRADE_INSPECTION_JOB_STEPS.map((step) => step.key);
    expect(keys.indexOf('holdExpiry')).toBe(0);
    expect(keys.indexOf('custody')).toBe(1);
    expect(keys.indexOf('inspections')).toBeGreaterThan(keys.indexOf('custody'));
    expect(TRADE_INSPECTION_JOB_STEPS.find((step) => step.key === 'inspections')?.critical).toBe(true);
  });
});
