import { TRADE_INSPECTION_MIN_HOURS } from '@/domain/fulfilment/inspection';
// tests/unit/inspectionDeadline.test.ts
//
// ESC-17b: a trade's inspection window never outlives the collateral behind it. The
// clamp (earliest live hold expiry minus the capture margin) BEATS the 24-hour floor,
// in TypeScript and in the 0142 trigger alike.

import { describe, expect, it } from 'vitest';

import {
  COLLATERAL_MARGIN_HOURS,
  TRADE_INSPECTION_FLOOR_HOURS,
  TRADE_INSPECTION_HOURS,
  deriveTradeInspectionDeadline,
} from '@/domain/fulfilment';
import { newestFunctionDefinition, normaliseSql } from '@/scripts/lib/migrationText';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-13T00:00:00.000Z');
const facts = { method: 'IN_PERSON' as const, meetingAt: new Date(T0).toISOString() };

describe('deriveTradeInspectionDeadline clamp (ESC-17b)', () => {
  it('no live expiry: no clamp', () => {
    expect(Date.parse(deriveTradeInspectionDeadline(facts, new Date(T0)))).toBe(T0 + TRADE_INSPECTION_HOURS * HOUR);
  });

  it('clamps to the earliest expiry less the margin', () => {
    const expiry = new Date(T0 + 48 * HOUR).toISOString();
    expect(Date.parse(deriveTradeInspectionDeadline(facts, new Date(T0), expiry))).toBe(
      T0 + (48 - COLLATERAL_MARGIN_HOURS) * HOUR,
    );
  });

  it('the clamp beats the floor', () => {
    // Entered late, so the floor alone would push the deadline a day out; the
    // collateral lapses sooner than that.
    const entered = new Date(T0 + 60 * HOUR);
    const expiry = new Date(entered.getTime() + (COLLATERAL_MARGIN_HOURS + 8) * HOUR).toISOString();
    const deadline = Date.parse(deriveTradeInspectionDeadline(facts, entered, expiry));
    expect(deadline).toBe(entered.getTime() + 8 * HOUR);
    expect(deadline).toBeLessThan(entered.getTime() + TRADE_INSPECTION_FLOOR_HOURS * HOUR);
  });

  it('never leaves less than the minimum window, even when the clamp would (review #16)', () => {
    const entered = new Date(T0 + 200 * HOUR);
    // The collateral's last useful moment is already behind entry.
    const expiry = new Date(entered.getTime() + (COLLATERAL_MARGIN_HOURS - 10) * HOUR).toISOString();
    const deadline = Date.parse(deriveTradeInspectionDeadline(facts, entered, expiry));
    expect(deadline).toBe(entered.getTime() + TRADE_INSPECTION_MIN_HOURS * HOUR);
  });
  it('the floor still applies when the clamp does not bind', () => {
    const entered = new Date(T0 + 70 * HOUR);
    const deadline = Date.parse(deriveTradeInspectionDeadline(facts, entered, new Date(T0 + 400 * HOUR).toISOString()));
    expect(deadline).toBe(entered.getTime() + TRADE_INSPECTION_FLOOR_HOURS * HOUR);
  });
});

describe('0142 SQL mirrors the clamp and warns both traders (ESC-17b, ESC-33)', () => {
  it('set_trade_inspection_deadline reads the earliest live hold and the margin', () => {
    const sql = normaliseSql(newestFunctionDefinition('set_trade_inspection_deadline').body);
    expect(sql).toContain('min(h.expires_at)');
    expect(sql).toContain("h.status = 'active'");
    expect(sql).toContain('collateral_margin_hours()');
  });

  it('warn_expiring_holds notifies both traders', () => {
    const sql = normaliseSql(newestFunctionDefinition('warn_expiring_holds').body);
    expect(sql).toContain('initiator_id');
    expect(sql).toContain('counterpart_id');
    expect(sql).toContain("'disputed'");
  });
});
