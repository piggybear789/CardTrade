// tests/unit/e2eAudit/cronTimeTravel.test.ts
//
// Examples for the audit suite's Cron_Function allow-list and timestamp rewind
// planner (Req 26.3, 26.4). The universal properties (25, 26) live in
// tests/property/e2eAudit/.
import { describe, expect, it } from 'vitest';
import { CRON_ALLOW_LIST, CRON_JOB_NAMES, cronInvocationSql } from '../../e2e/audit/core/cron';
import { planRewind, rewindPatch } from '../../e2e/audit/core/timeTravel';

describe('cronInvocationSql', () => {
  it('qualifies every allow-listed name with the sandbox schema', () => {
    for (const name of CRON_ALLOW_LIST) {
      expect(cronInvocationSql(name)).toBe(`select cardtrade_dev.${name}()`);
      expect(CRON_JOB_NAMES[name]).toMatch(/^cardtrade_[a-z_]+$/);
    }
  });

  it.each([
    'prune_rate_limits',
    ' expire_lapsed_holds',
    'expire_lapsed_holds ',
    'cardtrade.expire_lapsed_holds',
    'expire_lapsed_holds();',
    '"expire_lapsed_holds"',
    'EXPIRE_LAPSED_HOLDS',
    '',
  ])('refuses %j', (name) => {
    expect(() => cronInvocationSql(name)).toThrow(/Refusing/);
  });
});

describe('rewindPatch', () => {
  const row = {
    id: 'sale-1',
    inspection_deadline_at: '2026-12-08T10:00:00.000Z',
    created_at: '2026-12-01T10:00:00.000Z',
    tracking_flagged_at: null,
  };

  it('moves only the named columns, by exactly the duration', () => {
    const patch = rewindPatch(row, ['inspection_deadline_at'], 7 * 24 * 3_600_000);
    expect(patch).toEqual({ inspection_deadline_at: '2026-12-01T10:00:00.000Z' });
  });

  it('reads the Postgres timestamptz form', () => {
    expect(rewindPatch({ t: '2026-12-01 10:00:00.5+00' }, ['t'], 500)).toEqual({ t: '2026-12-01T10:00:00.000Z' });
  });

  it('accepts a zero duration and collapses repeated names', () => {
    expect(rewindPatch(row, ['created_at', 'created_at'], 0)).toEqual({ created_at: row.created_at });
  });

  it('rejects a negative or fractional duration', () => {
    expect(() => rewindPatch(row, ['created_at'], -1)).toThrow(/non-negative/);
    expect(() => rewindPatch(row, ['created_at'], 1.5)).toThrow(/non-negative/);
  });

  it('rejects an unknown, non-timestamp or empty column list', () => {
    expect(() => rewindPatch(row, ['pay_by'], 1000)).toThrow(/no such column/);
    expect(() => rewindPatch(row, ['tracking_flagged_at'], 1000)).toThrow(/timestamp/);
    expect(() => rewindPatch(row, ['id'], 1000)).toThrow(/timestamp/);
    expect(() => rewindPatch(row, [], 1000)).toThrow(/no column/);
  });
});

describe('planRewind', () => {
  it('pins the plan to cardtrade_dev and refuses any other schema', () => {
    const base = { table: 'cash_sales', id: 'sale-1', row: { created_at: '2026-12-01T10:00:00.000Z' }, columns: ['created_at'], durationMs: 1000 };
    expect(planRewind(base).schema).toBe('cardtrade_dev');
    expect(() => planRewind({ ...base, schema: 'cardtrade' })).toThrow(/only "cardtrade_dev"/);
    expect(() => planRewind({ ...base, table: 'cardtrade.cash_sales' })).toThrow(/table/);
  });
});
