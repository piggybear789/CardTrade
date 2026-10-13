// tests/unit/migrationRestoreUnclaimed.test.ts
//
// `restore_trade_items_if_unclaimed` is the only way a trade's cards go back on sale
// (NO_EXCHANGE, COLLATERAL_ABANDONED, HOLDS_FAILED). The unfiltered restore it
// replaced could put a SOLD card, or one another live contract held, back in the
// catalog: a staff-triggered double sale. This pins the four filters in the newest
// definition, so a later redefinition cannot quietly drop one.

import { describe, expect, it } from 'vitest';

import { newestFunctionDefinition, normaliseSql } from '@/scripts/lib/migrationText';

const body = normaliseSql(newestFunctionDefinition('restore_trade_items_if_unclaimed').body);

describe('restore_trade_items_if_unclaimed', () => {
  it('only touches RESERVED single listings', () => {
    expect(body).toContain("i.status = 'reserved'");
    expect(body).toContain("i.listing_kind = 'single'");
  });

  it('skips an item any live cash sale holds', () => {
    expect(body).toMatch(/not exists \( select 1 from cardtrade\.cash_sales cs where cs\.item_id = i\.id/);
    expect(body).toContain("cs.status not in ('cancelled', 'failed', 'refunded', 'completed')");
  });

  it('skips an item another live trade holds', () => {
    expect(body).toMatch(/not exists \( select 1 from cardtrade\.trade_items ti2 join cardtrade\.trades t2/);
    expect(body).toContain('t2.id <> p_trade_id');
    for (const state of ['collateral_pending', 'collateral_locked', 'in_transit', 'inspection', 'disputed']) {
      expect(body).toContain(`'${state}'`);
    }
  });

  it('returns the ids it restored', () => {
    expect(body).toMatch(/returning i\.id\s*;?\s*$/);
  });
});
