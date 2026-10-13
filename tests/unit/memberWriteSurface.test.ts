// tests/unit/memberWriteSurface.test.ts
//
// The member write surface on the tables the red-team review found holes in
// (ESC-13, ESC-22, ESC-26). Folds every GRANT/REVOKE in applied order and asserts the
// effective `authenticated` privileges:
//
//   * items                    — no INSERT (a direct insert skipped the Identity_Gate)
//   * offers                   — no UPDATE (status could be forged or revived)
//   * cash_sale_return_details — no INSERT/UPDATE (a buyer could squat the address)
//   * dispute_evidence, messages — today's set exactly, so any widening fails here
//
// The parser is strict (`scripts/lib/migrationGrants.ts`): grant syntax it cannot read
// throws instead of being skipped.

import { describe, expect, it } from 'vitest';

import { effectiveMemberPrivileges, memberCan } from '@/scripts/lib/migrationGrants';

function snapshot(table: string) {
  const state = effectiveMemberPrivileges(table);
  return {
    table: [...state.table].sort(),
    columns: Object.fromEntries(
      [...state.columns.entries()]
        .filter(([, cols]) => cols.size > 0)
        .map(([privilege, cols]) => [privilege, [...cols].sort()]),
    ),
  };
}

describe('member write surface', () => {
  it('members cannot insert items (ESC-26)', () => {
    expect(memberCan('items', 'insert')).toBe(false);
  });

  it('members cannot update offers (ESC-22), but can still insert them', () => {
    expect(memberCan('offers', 'update')).toBe(false);
    expect(memberCan('offers', 'insert')).toBe(true);
  });

  it('members cannot write return details (ESC-13), but sellers and returning buyers can read', () => {
    expect(memberCan('cash_sale_return_details', 'insert')).toBe(false);
    expect(memberCan('cash_sale_return_details', 'update')).toBe(false);
    expect(memberCan('cash_sale_return_details', 'select')).toBe(true);
  });

  it('dispute_evidence is not widened', () => {
    const s = snapshot('dispute_evidence');
    expect(s.table).not.toContain('update');
    expect(s.table).not.toContain('delete');
    expect(s).toMatchSnapshot();
  });

  it('messages is not widened', () => {
    const s = snapshot('messages');
    expect(s.table).not.toContain('update');
    expect(s).toMatchSnapshot();
  });
});
