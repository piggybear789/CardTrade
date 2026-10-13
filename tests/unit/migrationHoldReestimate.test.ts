// tests/unit/migrationHoldReestimate.test.ts
//
// R4-M5: 0133 must only FLAG live holds that carry the old seven-day planning expiry,
// never rewrite `expires_at` itself.
//
// The design's first version assigned `expires_at = greatest(created_at + 114h, ...)`
// in the migration. A hold placed between 114 hours and seven days before deploy would
// then have an expiry in the past, and the `:27` lapse job would mark it EXPIRED and
// tell both traders the collateral was gone before the custody sweep could try it.
// The read-back happens in the `:17` job instead (lib/trades/holdExpiryReestimate.ts).

import { describe, expect, it } from 'vitest';

import { normaliseSql, topLevelStatements } from '@/scripts/lib/migrationText';

const MIGRATION = '0133_trade_dispute_custody.sql';

function holdUpdates(): string[] {
  const statements = topLevelStatements(MIGRATION, /update\s+cardtrade\.pre_auth_holds\b/i);
  if (statements.length === 0) {
    throw new Error(`${MIGRATION} has no top-level update of cardtrade.pre_auth_holds`);
  }
  return statements.map(normaliseSql);
}

describe('0133 hold re-estimate marker', () => {
  it('sets expires_at_estimated = true', () => {
    const updates = holdUpdates();
    expect(updates.some((s) => /set expires_at_estimated = true/.test(s))).toBe(true);
  });

  it('targets only ACTIVE holds whose expiry sits on the seven-day fallback', () => {
    const marker = holdUpdates().find((s) => s.includes('expires_at_estimated = true'))!;
    expect(marker).toContain("status = 'active'");
    expect(marker).toContain('expires_at is not null');
    expect(marker).toContain('604800');
    expect(marker).toMatch(/<\s*600/);
  });

  it('never assigns expires_at', () => {
    for (const statement of holdUpdates()) {
      const setClause = statement.slice(statement.indexOf(' set '), statement.indexOf(' where '));
      expect(setClause, statement).not.toMatch(/\bexpires_at\s*=/);
    }
  });
});
