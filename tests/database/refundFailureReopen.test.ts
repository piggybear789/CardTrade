// tests/database/refundFailureReopen.test.ts
//
// A bounced refund must reopen a DISPUTE but never a completed RETURN (0045 vs 0092).
//
// WHY THIS IS A DATABASE TEST. The whole decision lives in one plpgsql function reached
// from the webhook pipeline. The unit fakes do not model it, which is precisely how the
// bug survived: `record_cash_sale_refund_failure` reverts a bounced full refund to
// DISPUTED and re-reserves the item, and a finalised return leaves exactly the state it
// looks for — REFUNDED, resolution REFUND_BUYER, no seller payout. Reopening then asked
// the buyer to post back goods they had already returned, and dropped the refund out of
// the drain so their money stopped being retried at all.
//
// Both branches are asserted, because a fix that stopped reopening ANYTHING would pass a
// test that only checked the return case while quietly breaking dispute handling.

import { afterEach, describe, expect, it } from 'vitest';

import { databaseTestsEnabled, query } from './support/sql';

const enabled = databaseTestsEnabled();

/** Rows created per test, torn down even when an expectation throws. */
let saleIds: string[] = [];
/** Items whose status this test changed, restored alongside the rows. */
let itemIds: string[] = [];

/**
 * The state under test, as column overrides on a cloned row.
 *
 * A finalised return and a plain disputed refund differ by ONE field —
 * `return_carrier_delivered_at` — which is the entire point of the fix, so the two
 * scenarios are built from one place with that as the only variable.
 */
function overridesFor(returned: boolean): Record<string, string> {
  return {
    id: 'gen_random_uuid()',
    status: `'REFUNDED'`,
    dispute_resolution: `'REFUND_BUYER'`,
    dispute_resolved_at: 'now()',
    refund_cents: '10000',
    refund_status: `'SETTLED'`,
    refund_nonce: `'refund:test-' || gen_random_uuid()::text`,
    refund_error: 'null',
    refund_attempts: '0',
    transfer_id: `'transfer-test'`,
    seller_payout_status: `'NOT_DUE'`,
    return_carrier_delivered_at: returned ? 'now()' : 'null',
  };
}

async function scenario(returned: boolean): Promise<string> {
  // CLONE A WHOLE REAL ROW, with the column list read from the database rather than
  // written here. `cash_sales` carries denormalised NOT NULL columns (item_title among
  // them) that this test has no business knowing about, and hard-coding the list would
  // break it every time one is added.
  const columns = await query<{ column_name: string }>(`
    select column_name from information_schema.columns
    where table_schema = 'cardtrade' and table_name = 'cash_sales'
      and is_generated = 'NEVER'
    order by ordinal_position
  `);

  // THE CLONE NEEDS AN ITEM WITH NO LIVE CONTRACT. `cash_sales_one_active_per_item`
  // forbids two active sales on one SINGLE listing, and the dispute case deliberately
  // ends in DISPUTED — which is active. Reusing the source row's item would collide with
  // the source itself, which is a fixture problem rather than anything about the fix.
  const free = await query<{ id: string }>(`
    select item.id from cardtrade.items item
    where item.listing_kind = 'SINGLE'
      and not exists (
        select 1 from cardtrade.cash_sales sale
        where sale.item_id = item.id
          and sale.status not in ('COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED')
      )
    limit 1
  `);
  if (free.length === 0) throw new Error('no item without a live contract to test against');

  const overrides: Record<string, string> = {
    ...overridesFor(returned),
    item_id: `'${free[0].id}'`,
  };
  const names = columns.map((c) => c.column_name);
  const values = names.map((name) => overrides[name] ?? `source.${name}`);

  const rows = await query<{ id: string; item_id: string }>(`
    insert into cardtrade.cash_sales (${names.join(', ')})
    select ${values.join(', ')}
    from cardtrade.cash_sales source
    limit 1
    returning id, item_id
  `);
  if (rows.length === 0) throw new Error('no fixture sale to clone');
  saleIds.push(rows[0].id);
  itemIds.push(rows[0].item_id);
  // The reopen re-reserves the item, so start from AVAILABLE to make that observable.
  await query(`update cardtrade.items set status = 'AVAILABLE' where id = '${rows[0].item_id}'`);
  return rows[0].id;
}

async function readSale(id: string) {
  const rows = await query<{
    status: string;
    dispute_resolution: string | null;
    refund_status: string;
    refund_cents: number;
    refund_nonce: string | null;
  }>(`
    select status, dispute_resolution, refund_status, refund_cents::int as refund_cents,
           refund_nonce
    from cardtrade.cash_sales where id = '${id}'
  `);
  return rows[0];
}

describe.skipIf(!enabled)('record_cash_sale_refund_failure', () => {
  afterEach(async () => {
    for (const id of saleIds) {
      await query(`delete from cardtrade.cash_sale_events where cash_sale_id = '${id}'`);
      await query(`delete from cardtrade.cash_sales where id = '${id}'`);
    }
    // The reopen branch re-reserves the item. Put it back, or a later browse test sees
    // a listing this test quietly took out of the catalog.
    for (const id of itemIds) {
      await query(`update cardtrade.items set status = 'AVAILABLE' where id = '${id}'`);
    }
    saleIds = [];
    itemIds = [];
  });

  it('reopens a bounced dispute refund, which is what 0045 is for', async () => {
    const id = await scenario(false);

    await query(`select cardtrade.record_cash_sale_refund_failure('${id}', 'bank returned it')`);

    const sale = await readSale(id);
    // Unchanged behaviour: the remedy failed and nothing physical moved, so the case is
    // decided again from scratch.
    expect(sale.status).toBe('DISPUTED');
    expect(sale.dispute_resolution).toBeNull();
    expect(sale.refund_cents).toBe(0);
    expect(sale.refund_nonce).toBeNull();
  }, 30_000);

  it('does NOT reopen a bounced refund once the goods came back', async () => {
    const id = await scenario(true);

    await query(`select cardtrade.record_cash_sale_refund_failure('${id}', 'bank returned it')`);

    const sale = await readSale(id);
    // THE FINDING STANDS. Only the payment failed.
    expect(sale.status).toBe('REFUNDED');
    expect(sale.dispute_resolution).toBe('REFUND_BUYER');
    // AND IT STAYS RETRYABLE. The drain needs refund_cents > 0 and reuses the nonce, so
    // zeroing either would strand the buyer's money with nothing looking wrong.
    expect(sale.refund_status).toBe('FAILED');
    expect(sale.refund_cents).toBeGreaterThan(0);
    expect(sale.refund_nonce).not.toBeNull();
  }, 30_000);

  it('leaves the relisted item alone when the goods came back', async () => {
    const id = await scenario(true);

    await query(`select cardtrade.record_cash_sale_refund_failure('${id}', 'bank returned it')`);

    const rows = await query<{ status: string }>(`
      select item.status from cardtrade.items item
      join cardtrade.cash_sales sale on sale.item_id = item.id
      where sale.id = '${id}'
    `);
    // Re-reserving would pull a seller's live listing out of the catalog over a payment
    // problem, for goods they are holding.
    expect(rows[0].status).toBe('AVAILABLE');
  }, 30_000);

  it('records the failure under a name that does not imply an open dispute', async () => {
    const id = await scenario(true);

    await query(`select cardtrade.record_cash_sale_refund_failure('${id}', null)`);

    const rows = await query<{ event: string }>(`
      select event from cardtrade.cash_sale_events
      where cash_sale_id = '${id}' order by created_at desc limit 1
    `);
    expect(rows[0].event).toBe('RETURN_REFUND_FAILED');
  }, 30_000);
});
