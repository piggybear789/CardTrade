// tests/database/support/cashSaleFixture.ts
//
// Build real `items` and `cash_sales` rows in a chosen state, for tests that must
// exercise SQL rather than a fake repository.
//
// WHY THIS EXISTS. The unit suite injects a fake repository, which is right for
// orchestration logic and useless for anything decided in plpgsql. Two money bugs got
// through precisely there: `mark_cash_sale_refund_due` silently queued nothing from a
// return state (0090), and `record_cash_sale_refund_failure` reopened a settled return and
// dropped the refund out of the drain (0092). Both were invisible to 500+ passing tests
// because the fake reproduced the same mistake, or never modelled the function at all.
//
// EVERY FIXTURE CREATES ITS OWN ITEM. An earlier version borrowed a seed item and put its
// status back afterwards, which failed for two separate reasons worth recording:
//
//   1. Two test files picked the SAME "first available item" and fought over it — one set
//      it RESERVED while the other was asserting it was visible. The failure looked like a
//      bug in the catalog policy and was nothing of the kind.
//   2. Restoring a borrowed row means knowing what it was, and the seed data contains
//      legitimately RESERVED items with no live contract. Forcing them AVAILABLE
//      afterwards had the fixture quietly editing the dev environment.
//
// Creating and deleting its own rows costs one extra statement and removes both. Tests
// that share mutable global state are not independent, however carefully they clean up.
//
// CLONING RATHER THAN CONSTRUCTING. `items` and `cash_sales` carry denormalised NOT NULL
// columns and several foreign keys, so hand-written INSERTs would need updating every time
// either table grows a column — and a fixture that breaks on unrelated changes gets
// deleted, after which nothing tests the SQL. The column lists are read from the database
// and only the fields under test are overridden.

import { query } from './sql';

/** Column name to SQL expression. Anything absent is copied from the cloned row. */
export type ColumnOverrides = Record<string, string>;

export interface ItemFixture {
  itemId: string;
}

export interface CashSaleFixture extends ItemFixture {
  saleId: string;
}

/**
 * Column lists, cached for the run.
 *
 * Every `query` here is an HTTP round trip to the Management API, which rate-limits.
 * Re-reading `information_schema` for each fixture was enough to earn a 429 mid-suite —
 * a failure that reads exactly like a broken assertion. The schema cannot change while
 * the suite runs, so reading it once per table is both faster and no less correct.
 */
const columnCache = new Map<string, string[]>();

/** Column names for a table, excluding anything the database generates itself. */
async function columnsOf(table: string): Promise<string[]> {
  const cached = columnCache.get(table);
  if (cached) return cached;

  const rows = await query<{ column_name: string }>(`
    select column_name from information_schema.columns
    where table_schema = 'cardtrade' and table_name = '${table}'
      and is_generated = 'NEVER'
    order by ordinal_position
  `);
  if (rows.length === 0) throw new Error(`no columns found for cardtrade.${table}`);

  const names = rows.map((row) => row.column_name);
  columnCache.set(table, names);
  return names;
}

/** Clone one row of a table with the given columns overridden, returning the new id. */
async function cloneRow(
  table: string,
  overrides: ColumnOverrides,
  sourceFilter = 'true',
): Promise<string> {
  const names = await columnsOf(table);
  const resolved: ColumnOverrides = { id: 'gen_random_uuid()', ...overrides };
  const values = names.map((name) => resolved[name] ?? `source.${name}`);

  const rows = await query<{ id: string }>(`
    insert into cardtrade.${table} (${names.join(', ')})
    select ${values.join(', ')}
    from cardtrade.${table} source
    where ${sourceFilter}
    limit 1
    returning id
  `);
  if (rows.length === 0) throw new Error(`no cardtrade.${table} row to clone as a fixture`);
  return rows[0].id;
}

/**
 * Create a throwaway SINGLE listing, cloned from a real one.
 *
 * AVAILABLE and open by default, which is what makes it visible to the catalog policy —
 * the state most of these tests want to observe changing.
 */
export async function createItemFixture(
  overrides: ColumnOverrides = {},
): Promise<ItemFixture> {
  const itemId = await cloneRow(
    'items',
    {
      status: `'AVAILABLE'`,
      listing_kind: `'SINGLE'`,
      closed_at: 'null',
      ...overrides,
    },
    `source.listing_kind = 'SINGLE'`,
  );
  return { itemId };
}

/**
 * Create a throwaway sale on a throwaway item.
 *
 * Both rows are new, so `cash_sales_one_active_per_item` cannot be tripped by the row this
 * was cloned from and no other test can move the item underneath.
 */
export async function createCashSaleFixture(
  overrides: ColumnOverrides,
  itemOverrides: ColumnOverrides = {},
): Promise<CashSaleFixture> {
  const { itemId } = await createItemFixture(itemOverrides);
  const saleId = await cloneRow('cash_sales', {
    item_id: `'${itemId}'`,
    ...overrides,
  });
  return { saleId, itemId };
}

/**
 * Delete fixture rows.
 *
 * Written to run from `afterEach` even when an expectation threw. Deletion rather than
 * restoration is deliberate: nothing was borrowed, so there is nothing to put back.
 *
 * Batched into ONE statement per table. Each round trip counts against the Management
 * API's rate limit, and a teardown that 429s leaves exactly the litter it exists to
 * prevent — the failure mode is worse than the slowness it was avoiding.
 */
export async function destroyCashSaleFixtures(
  fixtures: Array<Partial<CashSaleFixture>>,
): Promise<void> {
  const saleIds = fixtures.map((f) => f.saleId).filter((id): id is string => Boolean(id));
  const itemIds = fixtures.map((f) => f.itemId).filter((id): id is string => Boolean(id));
  if (saleIds.length === 0 && itemIds.length === 0) return;

  const list = (ids: string[]) => ids.map((id) => `'${id}'`).join(', ');
  const statements: string[] = [];
  if (saleIds.length > 0) {
    statements.push(
      `delete from cardtrade.cash_sale_events where cash_sale_id in (${list(saleIds)});`,
      `delete from cardtrade.cash_sales where id in (${list(saleIds)});`,
    );
  }
  if (itemIds.length > 0) {
    // Items last: a sale references its item.
    statements.push(`delete from cardtrade.items where id in (${list(itemIds)});`);
  }
  await query(statements.join('\n'));
}
