// tests/unit/migrationHandoverLock.test.ts
//
// The `trades_lock_handover` trigger must watch EXACTLY the handover columns the app
// writes (`HandoverTermsColumns` in lib/handover/terms.ts). A column missing from the
// trigger is a handover edit that slips past the lock; a column that does not exist
// (an earlier draft named `meeting_label`) aborts the migration. Both the `UPDATE OF`
// list and the `is distinct from` no-op guard are compared with the interface.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { migrationFiles } from '@/scripts/lib/mobileContract';
import { migrationSql, newestFunctionDefinition } from '@/scripts/lib/migrationText';

function handoverTermsColumns(): string[] {
  const source = readFileSync(path.join(process.cwd(), 'lib', 'handover', 'terms.ts'), 'utf8');
  const match = source.match(/export interface HandoverTermsColumns\s*\{([\s\S]*?)\n\}/);
  if (!match) throw new Error('Cannot find HandoverTermsColumns in lib/handover/terms.ts');
  const columns = [...match[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]);
  if (columns.length === 0) throw new Error('HandoverTermsColumns has no fields');
  return columns.sort();
}

function triggerUpdateOfColumns(): string[] {
  let found: string[] | null = null;
  for (const file of migrationFiles()) {
    const sql = migrationSql(file);
    const match = sql.match(
      /create\s+trigger\s+trades_lock_handover\s+before\s+update\s+of\s+([\s\S]*?)\s+on\s+cardtrade\.trades/i,
    );
    if (match) found = match[1].split(',').map((c) => c.trim().toLowerCase());
  }
  if (!found) throw new Error('No migration creates the trades_lock_handover trigger');
  return found.sort();
}

describe('trades_lock_handover', () => {
  const columns = handoverTermsColumns();

  it('fires on exactly the HandoverTermsColumns', () => {
    expect(triggerUpdateOfColumns()).toEqual(columns);
  });

  it('compares exactly those columns before refusing', () => {
    const body = newestFunctionDefinition('trades_lock_handover').body;
    const guarded = [...body.matchAll(/new\.([a-z_]+)\s+is\s+not\s+distinct\s+from\s+old\.\1/gi)]
      .map((m) => m[1].toLowerCase())
      .sort();
    expect(guarded).toEqual(columns);
  });

  it('refuses outside NEGOTIATING / COLLATERAL_PENDING and inside the placement lead', () => {
    const body = newestFunctionDefinition('trades_lock_handover').body.toLowerCase();
    expect(body).toContain("old.state not in ('negotiating', 'collateral_pending')");
    expect(body).toContain('cardtrade.bond_placement_lead_hours()');
    expect(body).toContain("raise exception 'handover-locked'");
  });
});
