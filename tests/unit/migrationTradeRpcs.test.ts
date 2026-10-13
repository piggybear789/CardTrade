// tests/unit/migrationTradeRpcs.test.ts
//
// Text guards on the newest trade RPCs and the FMV trigger (ESC-18, ESC-19, 0141).
// A later full-body redefinition must not quietly drop one of these predicates.

import { describe, expect, it } from 'vitest';
import { newestFunctionDefinition, normaliseSql } from '@/scripts/lib/migrationText';

const body = (name: string) => normaliseSql(newestFunctionDefinition(name).body);

describe('open_trade_negotiation (ESC-19)', () => {
  it('refuses an offered card that is not AVAILABLE', () => {
    const sql = body('open_trade_negotiation');
    expect(sql).toContain("status <> 'available'");
    expect(sql).toContain('initiator-item-unavailable');
  });
  it('still refuses a closed binder target', () => {
    expect(body('open_trade_negotiation')).toContain('v_target.closed_at is not null');
  });
});

describe('begin_trade_collateral (ESC-19, ESC-04)', () => {
  const sql = body('begin_trade_collateral');
  it('records which trade owns each reservation', () => {
    expect(sql).toContain('reserved_by_trade_id = p_trade_id');
  });
  it('raises short-reservation and terms-incomplete', () => {
    expect(sql).toContain('short-reservation');
    expect(sql).toContain('terms-incomplete');
  });
});

describe('restore_trade_items_if_unclaimed (ESC-19)', () => {
  it('restores only this trade’s own reservations, or a pre-0141 one', () => {
    expect(body('restore_trade_items_if_unclaimed')).toContain(
      '(i.reserved_by_trade_id = p_trade_id or i.reserved_by_trade_id is null)',
    );
  });
});

describe('items_fmv_trade_guard (ESC-18)', () => {
  const sql = body('items_fmv_trade_guard');
  it('looks the trades up through trade_items and refuses the five live states', () => {
    expect(sql).toContain('cardtrade.trade_items');
    for (const state of ['collateral_pending', 'collateral_locked', 'in_transit', 'inspection', 'disputed']) {
      expect(sql).toContain(`'${state}'`);
    }
    expect(sql).toContain('item-in-live-trade');
  });
  it('voids both acceptances on a NEGOTIATING trade', () => {
    expect(sql).toContain('initiator_terms_accepted_version = null');
    expect(sql).toContain('counterpart_terms_accepted_version = null');
    expect(sql).toContain('terms_version = t.terms_version + 1');
  });
});
