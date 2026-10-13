// tests/unit/migrationTradeCashTerminalRefund.test.ts
//
// Text guard on the newest definition of the 0139 trigger function: a collection that
// lands on an ENDED trade is rewritten to REFUND_PENDING for each terminal state, and
// only on the transition INTO collected [R4-N2], so the trigger binds every writer
// (the admin client bypasses RLS) without rewriting later moves of a collected row.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'supabase', 'migrations');

function newestDefinition(name: string): string {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files.reverse()) {
    const text = readFileSync(join(DIR, file), 'utf8');
    const start = text.indexOf(`create or replace function cardtrade.${name}(`);
    if (start === -1) continue;
    const end = text.indexOf('$function$;', start);
    if (end === -1) throw new Error(`${file}: unterminated ${name}`);
    return text.slice(start, end);
  }
  throw new Error(`no migration defines ${name}`);
}

describe('trade_cash_settlements_refund_if_trade_terminal', () => {
  const body = newestDefinition('trade_cash_settlements_refund_if_trade_terminal');

  it('fires only on the transition into COLLECTED [R4-N2]', () => {
    expect(body).toMatch(/old\.status in \('NOT_COLLECTED',\s*'COLLECTING'\)\s+and new\.status = 'COLLECTED'/);
  });

  it.each(['CANCELLED', 'COMPLETED', 'FRAUD_RESOLVED'])('rewrites to REFUND_PENDING on %s', (state) => {
    expect(body).toContain(`'${state}'`);
    expect(body).toContain("new.status := 'REFUND_PENDING'");
    expect(body).toContain("'trade-cash:refund:' || new.trade_id");
  });

  it('is security definer with an empty search path', () => {
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = ''/);
  });
});
