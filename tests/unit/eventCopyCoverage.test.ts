// tests/unit/eventCopyCoverage.test.ts
//
// Every contract event code has chat copy (design §1.13).
//
// Event codes are written from two places — TypeScript (`logEvent`, the trade audit
// writer) and SQL functions — and rendered by two others: `describe_trade_event` and
// `describe_cash_sale_event`. A code with no branch printed "The contract was updated."
// (or, before 0116, a raw detail). This reads every code from both writers and checks
// the NEWEST describe function has a `when '<CODE>'` branch for it, or that the newest
// mirror trigger skips it. A staff-only code on the skip list must also be hidden by the
// participant read policy, because the room subscribes to the event table directly.
//
// STRICT. A target it cannot find, or an event value it cannot read as a literal, THROWS
// unless the value is listed in `NON_LITERAL_EVENTS` with what it expands to. Never fix a
// failure here by loosening the test: write the copy.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR, migrationFiles, tsUnionMembers } from '@/scripts/lib/mobileContract';
import { functionDefinitionsIn, migrationSql, newestFunctionDefinition } from '@/scripts/lib/migrationText';

/** A writer whose event is an expression rather than a literal, and what it can be. */
const NON_LITERAL_EVENTS: Record<string, string[]> = {
  // cashSaleOrchestrator: `DISPUTE_RESOLVED_${outcome}` (CashSaleEventCode).
  'DISPUTE_RESOLVED_${CashSaleDisputeOutcome}': ['DISPUTE_RESOLVED_REFUND_BUYER', 'DISPUTE_RESOLVED_PARTIAL_REFUND', 'DISPUTE_RESOLVED_RELEASE_SELLER'],
  // 0092 record_cash_sale_refund_failure (whitespace-normalised).
  "case when v_returned then 'RETURN_REFUND_FAILED' else 'DISPUTE_REFUND_FAILED' end": ['RETURN_REFUND_FAILED', 'DISPUTE_REFUND_FAILED'],
};

/** Codes written by TypeScript, from the narrowed unions. */
function tsCashSaleCodes(): string[] {
  const members = tsUnionMembers('CashSaleEventCode', 'domain/orchestrator/cashSaleEvents.ts');
  const source = readFileSync(path.join(process.cwd(), 'domain/orchestrator/cashSaleEvents.ts'), 'utf8');
  if (!source.includes('`DISPUTE_RESOLVED_${CashSaleDisputeOutcome}`')) {
    throw new Error('CashSaleEventCode no longer has the DISPUTE_RESOLVED template; update NON_LITERAL_EVENTS');
  }
  return [...members, ...NON_LITERAL_EVENTS['DISPUTE_RESOLVED_${CashSaleDisputeOutcome}']];
}

function tsTradeCodes(): string[] {
  return [
    ...tsUnionMembers('TradeEvent', 'domain/state-machine/types.ts'),
    ...tsUnionMembers('TradeAuditEvent', 'domain/state-machine/types.ts'),
  ];
}

/** Split a parenthesised SQL tuple body on top-level commas, respecting quotes. */
function splitTuple(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      current += ch;
      if (ch === "'" && body[i + 1] === "'") {
        current += "'";
        i += 1;
      } else if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** The parenthesised text starting at `open` (an index of '('), without the parens. */
function parenBody(text: string, open: number): string {
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "'" && text[i + 1] === "'") i += 1;
      else if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced parentheses');
}

/**
 * Event literals the NEWEST definition of every SQL function inserts into `table`.
 * Throws on a non-literal event value it does not recognise.
 */
function sqlWrittenCodes(table: 'cash_sale_events' | 'trade_state_transitions'): Map<string, string> {
  // name/argCount -> newest definition
  const newest = new Map<string, ReturnType<typeof functionDefinitionsIn>[number]>();
  for (const file of migrationFiles()) {
    for (const def of functionDefinitionsIn(file)) newest.set(`${def.name}/${def.argCount}`, def);
  }
  const codes = new Map<string, string>();
  const head = new RegExp(`insert\\s+into\\s+cardtrade\\.${table}\\s*\\(`, 'gi');
  for (const def of newest.values()) {
    for (const match of def.body.matchAll(head)) {
      const columnsOpen = match.index! + match[0].length - 1;
      const columns = splitTuple(parenBody(def.body, columnsOpen)).map((c) => c.toLowerCase());
      const eventIndex = columns.indexOf('event');
      if (eventIndex === -1) throw new Error(`${def.file} ${def.name}: insert into ${table} with no event column`);
      const afterColumns = def.body.slice(columnsOpen);
      const valuesMatch = afterColumns.match(/\)\s*(values|select)\s*/i);
      if (!valuesMatch || valuesMatch.index === undefined) throw new Error(`${def.file} ${def.name}: cannot read values`);
      let valueExprs: string[];
      if (valuesMatch[1].toLowerCase() === 'values') {
        const open = columnsOpen + valuesMatch.index + valuesMatch[0].length;
        if (def.body[open] !== '(') throw new Error(`${def.file} ${def.name}: values without a tuple`);
        valueExprs = splitTuple(parenBody(def.body, open));
      } else {
        const start = columnsOpen + valuesMatch.index + valuesMatch[0].length;
        const end = def.body.slice(start).search(/\bfrom\b|;/i);
        valueExprs = splitTuple(def.body.slice(start, end === -1 ? undefined : start + end));
      }
      const expr = valueExprs[eventIndex];
      if (expr === undefined) throw new Error(`${def.file} ${def.name}: no value for the event column`);
      const literal = expr.match(/^'([A-Z0-9_]+)'$/);
      if (literal) {
        codes.set(literal[1], `${def.file} ${def.name}`);
        continue;
      }
      const known = NON_LITERAL_EVENTS[expr.replace(/\s+/g, ' ').trim()];
      if (!known) throw new Error(`${def.file} ${def.name}: non-literal event value ${expr}; add it to NON_LITERAL_EVENTS`);
      for (const code of known) codes.set(code, `${def.file} ${def.name}`);
    }
  }
  return codes;
}

function whenBranches(body: string): Set<string> {
  const set = new Set([...body.matchAll(/when\s+'([A-Z0-9_]+)'/g)].map((m) => m[1]));
  if (set.size === 0) throw new Error('describe function has no when branches');
  return set;
}

function mirrorSkipList(): Set<string> {
  const def = newestFunctionDefinition('mirror_cash_sale_event_to_chat', { argCount: 0 });
  const match = def.body.match(/new\.event\s+in\s*\(([^)]*)\)/i);
  if (!match) throw new Error(`${def.file}: cannot find the mirror skip list`);
  return new Set([...match[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]));
}

function newestParticipantPolicy(): { file: string; text: string } {
  let found: { file: string; text: string } | null = null;
  for (const file of migrationFiles()) {
    const sql = migrationSql(file);
    const idx = sql.search(/create\s+policy\s+cash_sale_events_participant_select/i);
    if (idx === -1) continue;
    const end = sql.indexOf(';', idx);
    found = { file, text: sql.slice(idx, end) };
  }
  if (!found) throw new Error('no migration creates cash_sale_events_participant_select');
  return found;
}

const PAYOUT_CODES = new Set(['SELLER_PAYOUT_QUEUED', 'SELLER_PAYOUT_SETTLED', 'SELLER_PAYOUT_FAILED']);

describe('event copy coverage', () => {
  it('every cash-sale code has a describe branch or is skipped by the mirror', () => {
    const branches = whenBranches(newestFunctionDefinition('describe_cash_sale_event', { argCount: 5 }).body);
    const skipped = mirrorSkipList();
    const codes = new Set([...tsCashSaleCodes(), ...sqlWrittenCodes('cash_sale_events').keys()]);
    const missing = [...codes].filter((code) => !branches.has(code) && !skipped.has(code)).sort();
    expect(missing).toEqual([]);
  });

  it('every trade code has a describe_trade_event branch', () => {
    const branches = whenBranches(newestFunctionDefinition('describe_trade_event').body);
    const codes = new Set([...tsTradeCodes(), ...sqlWrittenCodes('trade_state_transitions').keys()]);
    const missing = [...codes].filter((code) => !branches.has(code)).sort();
    expect(missing).toEqual([]);
  });

  it('every non-payout skipped code is hidden from participants by the read policy', () => {
    const policy = newestParticipantPolicy();
    for (const code of mirrorSkipList()) {
      if (PAYOUT_CODES.has(code)) continue;
      expect(policy.text, `${code} in ${policy.file}`).toMatch(new RegExp(`event\\s*<>\\s*'${code}'`));
    }
  });

  it('FRAUD_WARNING_REFUND is never written or rendered', () => {
    const roots = ['domain', 'lib', 'app', 'components'];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|sql)$/.test(entry) && readFileSync(full, 'utf8').includes('FRAUD_WARNING_REFUND')) hits.push(full);
      }
    };
    for (const root of roots) walk(path.join(process.cwd(), root));
    walk(MIGRATIONS_DIR);
    expect(hits).toEqual([]);
  });
});
