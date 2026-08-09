// tests/unit/cashSaleLineItems.test.ts
//
// Contract line items (0064): what a Cash_Sale against a SHOPFRONT listing actually covers.
//
// WHY THIS MATTERS MORE THAN A VALIDATOR USUALLY DOES. `lineItemsTotalCents` is the ONLY
// definition of a shopfront contract's price — `agreed_price_cents` is set from it and by
// no other route, because `proposeCashSalePrice` refuses on a shopfront. So this function
// decides what a buyer is charged.
//
// And the module had no tests at all. Neither did any other file in `domain/validation`.
//
// The bounds here mirror CHECK constraints in migration 0064, and the module says so in a
// comment — but a comment is not a mechanism. The final test in this file reads the
// migration and compares, in the same style as `regionCurrencyAgreement.test.ts`, so the
// two cannot drift apart silently. A drift matters because the TypeScript bound decides
// whether the member gets a field-level message and the SQL bound decides whether the write
// succeeds; when they disagree the member gets a raw persistence error for input the form
// told them was fine.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LINE_DESCRIPTION_MAX_LENGTH,
  LINE_CONDITION_MAX_LENGTH,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  LINE_UNIT_PRICE_MIN_CENTS,
  LINES_MAX,
  MIN_CONTRACT_TOTAL_CENTS,
  lineItemsTotalCents,
  validateCashSaleLineItems,
} from '@/domain/validation/cashSaleLineItems';

/** A valid line, so each test can vary the one field it is about. */
function line(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Charizard ex 199/165 — SV 151',
    condition: 'NM',
    quantity: 1,
    unitPriceCents: 5_000,
    ...overrides,
  };
}

describe('lineItemsTotalCents', () => {
  it('sums quantity times unit price across every line', () => {
    const total = lineItemsTotalCents([
      { quantity: 2, unitPriceCents: 1_500 },
      { quantity: 1, unitPriceCents: 700 },
      { quantity: 3, unitPriceCents: 100 },
    ]);
    expect(total).toBe(2 * 1_500 + 700 + 3 * 100);
  });

  it('is zero for no lines, matching the SQL coalesce', () => {
    // `replace_cash_sale_items` uses `coalesce(sum(...), 0)`, so an empty set is 0 rather
    // than null on both sides. The schema separately refuses an empty contract.
    expect(lineItemsTotalCents([])).toBe(0);
  });

  it('counts a free line as adding nothing rather than refusing it', () => {
    // A seller throwing in a card at no charge is deliberately allowed per line; it is the
    // CONTRACT that cannot be worth nothing.
    const total = lineItemsTotalCents([
      { quantity: 1, unitPriceCents: 0 },
      { quantity: 1, unitPriceCents: 2_500 },
    ]);
    expect(total).toBe(2_500);
  });

  it('stays an exact integer across the maximum line count', () => {
    // Money is integer minor units end to end. A float creeping in here would be invisible
    // until a contract total disagreed with the SQL sum by a cent.
    const lines = Array.from({ length: LINES_MAX }, () => ({
      quantity: LINE_QUANTITY_MAX,
      unitPriceCents: 9_999,
    }));
    const total = lineItemsTotalCents(lines);
    expect(Number.isSafeInteger(total)).toBe(true);
    expect(total).toBe(LINES_MAX * LINE_QUANTITY_MAX * 9_999);
  });
});

describe('validateCashSaleLineItems', () => {
  it('accepts a well-formed contract', () => {
    const result = validateCashSaleLineItems([line(), line({ description: 'Pikachu VMAX' })]);
    expect(result.ok).toBe(true);
  });

  it('refuses a contract with no lines', () => {
    const result = validateCashSaleLineItems([]);
    expect(result.ok).toBe(false);
  });

  it(`refuses more than ${LINES_MAX} lines`, () => {
    const tooMany = Array.from({ length: LINES_MAX + 1 }, () => line());
    expect(validateCashSaleLineItems(tooMany).ok).toBe(false);
    // And accepts exactly the limit, so the boundary is inclusive as the CHECK is.
    expect(validateCashSaleLineItems(Array.from({ length: LINES_MAX }, () => line())).ok).toBe(
      true,
    );
  });

  it('refuses a contract worth nothing even though a single free line is fine', () => {
    // The whole point of MIN_CONTRACT_TOTAL_CENTS: every line may be free, the contract
    // may not be. It mirrors `cash_sales_agreed_price_positive`.
    const allFree = [line({ unitPriceCents: 0 }), line({ unitPriceCents: 0 })];
    expect(lineItemsTotalCents(allFree)).toBeLessThan(MIN_CONTRACT_TOTAL_CENTS);
    expect(validateCashSaleLineItems(allFree).ok).toBe(false);
  });

  it('refuses a fractional or negative quantity or price', () => {
    expect(validateCashSaleLineItems([line({ quantity: 1.5 })]).ok).toBe(false);
    expect(validateCashSaleLineItems([line({ quantity: 0 })]).ok).toBe(false);
    expect(validateCashSaleLineItems([line({ unitPriceCents: -1 })]).ok).toBe(false);
    expect(validateCashSaleLineItems([line({ unitPriceCents: 10.5 })]).ok).toBe(false);
  });

  it('names the offending ROW so a form can highlight it', () => {
    // A single error against the whole set is unusable on a 50-row editor.
    const result = validateCashSaleLineItems([line(), line({ unitPriceCents: -5 })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('1.unitPriceCents');
  });

  it('treats a blank condition as absent rather than as an empty grade', () => {
    const result = validateCashSaleLineItems([line({ condition: '   ' })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.condition).toBeNull();
  });

  it('enforces the description and condition lengths', () => {
    expect(
      validateCashSaleLineItems([line({ description: 'x'.repeat(LINE_DESCRIPTION_MAX_LENGTH) })])
        .ok,
    ).toBe(true);
    expect(
      validateCashSaleLineItems([
        line({ description: 'x'.repeat(LINE_DESCRIPTION_MAX_LENGTH + 1) }),
      ]).ok,
    ).toBe(false);
    expect(
      validateCashSaleLineItems([line({ condition: 'x'.repeat(LINE_CONDITION_MAX_LENGTH + 1) })])
        .ok,
    ).toBe(false);
  });
});

describe('agreement with migration 0064', () => {
  const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
  const migration = readFileSync(
    path.join(migrationsDir, '0064_shopfront_listings_and_contract_line_items.sql'),
    'utf8',
  );

  /**
   * The NEWEST migration whose text matches `pattern`, and that match.
   *
   * A bound defined in 0064 can be widened by a later migration — 0080 widened the
   * description — so pinning a constant to 0064 alone would fail on a change that is
   * perfectly correct. Reading the newest definition keeps the assertion strict:
   * it still compares the TypeScript constant against SQL, just against the SQL that
   * is actually in force.
   */
  function newestMatch(pattern: RegExp): RegExpExecArray | null {
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const name of [...files].reverse()) {
      const match = pattern.exec(readFileSync(path.join(migrationsDir, name), 'utf8'));
      if (match) return match;
    }
    return null;
  }

  it('derives the contract total with the same expression the RPC does', () => {
    // The SQL re-derives the sum and RAISES when it disagrees with the caller's figure, so
    // the two definitions have to be the same arithmetic. If this assertion stops finding
    // the expression, the SQL has been reshaped and `lineItemsTotalCents` needs rechecking
    // against whatever replaced it — do not delete the test.
    expect(migration).toMatch(/coalesce\(\s*sum\(\s*quantity\s*\*\s*unit_price_cents\s*\)/i);
  });

  it('matches the quantity bounds the database enforces', () => {
    const match = /check\s*\(\s*quantity\s+between\s+(\d+)\s+and\s+(\d+)\s*\)/i.exec(migration);
    expect(match, 'quantity CHECK not found in 0064').toBeTruthy();
    expect(Number(match?.[1])).toBe(LINE_QUANTITY_MIN);
    expect(Number(match?.[2])).toBe(LINE_QUANTITY_MAX);
  });

  it('matches the unit price floor the database enforces', () => {
    const match = /check\s*\(\s*unit_price_cents\s*>=\s*(\d+)\s*\)/i.exec(migration);
    expect(match, 'unit_price_cents CHECK not found in 0064').toBeTruthy();
    expect(Number(match?.[1])).toBe(LINE_UNIT_PRICE_MIN_CENTS);
  });

  it('matches the description and condition length bounds', () => {
    // Description is read from the newest migration that defines it (0080 widened it
    // from 200 so a binder request can be written as prose); condition is still 0064's.
    const description = newestMatch(
      /char_length\(description\)\s+between\s+(\d+)\s+and\s+(\d+)/i,
    );
    expect(description, 'description length CHECK not found in any migration').toBeTruthy();
    expect(Number(description?.[2])).toBe(LINE_DESCRIPTION_MAX_LENGTH);

    const condition = /char_length\(condition\)\s+between\s+(\d+)\s+and\s+(\d+)/i.exec(migration);
    expect(condition, 'condition length CHECK not found in 0064').toBeTruthy();
    expect(Number(condition?.[2])).toBe(LINE_CONDITION_MAX_LENGTH);
  });
});
