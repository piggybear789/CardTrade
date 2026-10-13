// tests/unit/migrationTrackingClock.test.ts
//
// ESC-02 text guard. The newest `apply_cash_sale_tracking` must start the inspection
// window from now(), never from the carrier's timestamp, must refuse to advance a
// flagged sale, and must flag a delivery dated before the shipment.

import { describe, expect, it } from 'vitest';

import { newestFunctionDefinition } from '@/scripts/lib/migrationText';

describe('apply_cash_sale_tracking (newest definition)', () => {
  const def = newestFunctionDefinition('apply_cash_sale_tracking');

  it('is defined in 0134 or later', () => {
    expect(Number(def.file.slice(0, 4))).toBeGreaterThanOrEqual(134);
  });

  it('computes the deadline from now(), never from the delivered instant', () => {
    expect(def.body).toMatch(/v_deadline\s*:=\s*now\(\)/);
    expect(def.body).not.toMatch(/v_delivered_at\s*\+/);
  });

  it('never advances a flagged, unresolved sale', () => {
    expect(def.body).toMatch(/tracking_flagged_at is not null and v_sale\.tracking_flag_resolved_at is null/);
  });

  it('flags a delivery dated before the shipment or payment', () => {
    expect(def.body).toMatch(/coalesce\(v_sale\.shipped_at, v_sale\.payment_settled_at\)/);
    expect(def.body).toMatch(/'DELIVERED_BEFORE_SHIPMENT'/);
    expect(def.body).toMatch(/'TRACKING_FLAGGED'/);
  });
});
