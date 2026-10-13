// tests/unit/migrationTrackingBinding.test.ts
//
// Text guard for 0144 (ESC-12): the rules that make one number one contract.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/0144_tracking_number_binding.sql'),
  'utf8',
);

describe('0144 tracking number binding', () => {
  it('exempts only the same seller and buyer on the outbound leg', () => {
    expect(sql).toMatch(/not \(cs\.seller_id = p_pair_seller and cs\.buyer_id = p_pair_buyer\)/);
  });

  it('refuses a return number that equals any outbound number', () => {
    expect(sql).toMatch(/where p_is_return\s+and cardtrade\.normalize_tracking\(cs\.tracking_number\) = p_norm/);
  });

  it('applies the 90-day recency window to cash sales and trades', () => {
    expect(sql).toContain("coalesce(cs.completed_at, cs.cancelled_at, cs.updated_at) > now() - interval '90 days'");
    expect(sql).toContain("coalesce(t.cancelled_at, t.updated_at) > now() - interval '90 days'");
  });

  it('binds both tables with triggers that raise tracking-in-use', () => {
    expect(sql).toMatch(/create trigger cash_sales_tracking_binding/);
    expect(sql).toMatch(/create trigger trades_tracking_binding/);
    expect(sql.match(/raise exception 'tracking-in-use'/g)?.length).toBe(4);
  });
});
