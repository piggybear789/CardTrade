// tests/unit/regionCurrencyAgreement.test.ts
//
// Pins `cardtrade.regions` (migration 0068) to `domain/region/regions.ts`.
//
// WHY THIS EXISTS. Region → currency is defined twice, and it has to be: the
// TypeScript registry is what the app reads, and the SQL table is what the
// `set_row_currency_from_region` trigger reads when a row is inserted by an RPC or a
// seed rather than by an orchestrator. Neither can import the other.
//
// Two copies of a money rule silently drifting is the failure mode this codebase has
// been bitten by before — which is why `replace_cash_sale_items` re-derives the
// line-item total in SQL and aborts when it disagrees, and why
// `tests/property/identityGate.test.ts` reads the Identity_Gate expression back out of
// the newest migration that defines it. This test is the same pattern: it parses the
// INSERT in 0068, applies the `trading_enabled` changes made by later migrations, and
// asserts every row matches the registry exactly.
//
// A drift here would mean a contract charged in one currency and displayed in
// another, with nothing at runtime able to notice.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { minorUnitDigits, REGIONS } from '@/domain/region';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

const SEED_MIGRATION_FILE = '0068_multi_region_currency.sql';

const MIGRATION = path.join(MIGRATIONS_DIR, SEED_MIGRATION_FILE);

interface SqlRegionRow {
  code: string;
  label: string;
  currency: string;
  minorUnitDigits: number;
  tradingEnabled: boolean;
}

/**
 * Extract the seeded region rows from the migration.
 *
 * Deliberately strict: it matches the exact tuple shape the migration writes and
 * fails loudly if it finds nothing, rather than passing vacuously on a file it could
 * not understand. A test that silently verifies zero rows is worse than no test.
 */
function parseSqlRegions(): SqlRegionRow[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const rowPattern =
    /\('([A-Z]{2})',\s*'([^']*)',\s*'([a-z]{3})',\s*(\d+),\s*(true|false)\s*\)/g;

  const rows: SqlRegionRow[] = [];
  for (const match of sql.matchAll(rowPattern)) {
    rows.push({
      code: match[1],
      label: match[2],
      currency: match[3],
      minorUnitDigits: Number(match[4]),
      tradingEnabled: match[5] === 'true',
    });
  }

  const overrides = parseTradingEnabledOverrides();
  return rows.map((row) =>
    overrides.has(row.code)
      ? { ...row, tradingEnabled: overrides.get(row.code)! }
      : row,
  );
}

/**
 * Per-region `trading_enabled` changes made by migrations AFTER the 0068 seed.
 *
 * WHY THIS LAYER EXISTS. 0068 seeds the flag, but opening a region later is a new
 * migration — 0122 opened US — and an applied migration must not be edited. Reading only
 * the seed would therefore compare a stale `false` against the registry's `true` and fail
 * on a correct change, which trains people to "fix" the test by loosening it. That is the
 * outcome to avoid: this file guards a money rule, and the way it dies is by being edited
 * until it passes.
 *
 * Same shape as the Identity_Gate agreement property, which reads the gate expression out
 * of the NEWEST migration that defines it rather than the one that introduced it.
 *
 * Applied in filename order, so the last migration to touch a region wins — which is also
 * the order Postgres applied them in. A region can therefore be closed again by a later
 * migration and this still tracks it.
 *
 * NOT GUARDED AGAINST FINDING NOTHING, deliberately, unlike {@link parseSqlRegions}. An
 * empty result is the correct answer whenever no migration has moved a flag since the
 * seed. The protection against a statement this cannot parse is the comparison itself: an
 * unreadable override leaves the seed value in place, which then disagrees with the
 * registry and fails loudly. Silence here cannot produce a vacuous pass.
 */
function parseTradingEnabledOverrides(): Map<string, boolean> {
  // Matches the single-line form 0122 writes. A migration that reformats this across
  // newlines will not be seen, and the resulting disagreement is the failure that tells
  // you so.
  const pattern =
    /update\s+cardtrade\.regions\s+set\s+trading_enabled\s*=\s*(true|false)\s+where\s+code\s*=\s*'([A-Z]{2})'/gi;

  const overrides = new Map<string, boolean>();

  const later = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql') && file > SEED_MIGRATION_FILE)
    .sort();

  for (const file of later) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    for (const match of sql.matchAll(pattern)) {
      overrides.set(match[2].toUpperCase(), match[1].toLowerCase() === 'true');
    }
  }

  return overrides;
}

describe('cardtrade.regions agrees with the TypeScript region registry', () => {
  const sqlRows = parseSqlRegions();

  it('found the seeded rows at all', () => {
    // Guards against a silently-empty comparison, e.g. after the migration is
    // reformatted in a way the pattern above no longer matches.
    expect(sqlRows.length).toBeGreaterThan(30);
  });

  it('covers exactly the same set of region codes', () => {
    const sqlCodes = sqlRows.map((row) => row.code).sort();
    const tsCodes = REGIONS.map((region) => region.code).sort();
    expect(sqlCodes).toEqual(tsCodes);
  });

  it('agrees on every currency', () => {
    // The one that actually moves money: the trigger writes `cash_sales.currency`
    // from this table, and every Stripe call for that contract reads the registry.
    for (const row of sqlRows) {
      const region = REGIONS.find((candidate) => candidate.code === row.code);
      expect(region, `no TypeScript region for ${row.code}`).toBeDefined();
      expect(region!.currency, `currency mismatch for ${row.code}`).toBe(row.currency);
    }
  });

  it('agrees on every label', () => {
    for (const row of sqlRows) {
      const region = REGIONS.find((candidate) => candidate.code === row.code);
      expect(region!.label, `label mismatch for ${row.code}`).toBe(row.label);
    }
  });

  it('agrees on every trading_enabled flag', () => {
    for (const row of sqlRows) {
      const region = REGIONS.find((candidate) => candidate.code === row.code);
      expect(
        region!.tradingEnabled,
        `trading_enabled mismatch for ${row.code}`,
      ).toBe(row.tradingEnabled);
    }
  });

  it('agrees on minor-unit digits, which is where a mismatch is worst', () => {
    // A wrong digit count is a factor-of-100 error in a money amount that still
    // looks like a plausible number. JPY is the only zero-decimal currency in the
    // set, so this is the row that matters.
    for (const row of sqlRows) {
      const region = REGIONS.find((candidate) => candidate.code === row.code);
      expect(
        minorUnitDigits(region!.currency),
        `minor_unit_digits mismatch for ${row.code} (${region!.currency})`,
      ).toBe(row.minorUnitDigits);
    }
  });

  it('tracks a region opened by a migration after the seed', () => {
    // US is seeded false in 0068 and opened by 0122. Pinned by name rather than only by
    // the loop above, because this is the one row that exercises the override layer at
    // all: if that layer silently stopped working — a reformatted statement, a renamed
    // table, a regex that no longer matches — every other row would still agree and the
    // loop would pass. This is what makes the mechanism's failure visible.
    //
    // It is NOT asserting that US is live. `trading_enabled` is product intent on both
    // sides; `operationalRegions()` decides the runtime answer and needs
    // STRIPE_SECRET_KEY_US on top of this.
    const us = sqlRows.find((row) => row.code === 'US');
    expect(us, 'no US row parsed out of the migrations').toBeDefined();
    expect(us!.currency).toBe('usd');
    expect(us!.tradingEnabled, 'migration 0122 opens US; did its update statement change shape?').toBe(true);
    expect(REGIONS.find((region) => region.code === 'US')!.tradingEnabled).toBe(true);
  });

  it('records JPY as zero-decimal on both sides', () => {
    // Pinned explicitly rather than only by the loop above, so deleting Japan from
    // the registry cannot quietly remove the only case that exercises the
    // zero-decimal path.
    const jp = sqlRows.find((row) => row.code === 'JP');
    expect(jp?.currency).toBe('jpy');
    expect(jp?.minorUnitDigits).toBe(0);
    expect(minorUnitDigits('jpy')).toBe(0);
  });
});
