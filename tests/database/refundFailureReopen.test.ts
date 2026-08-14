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
import {
  createCashSaleFixture,
  destroyCashSaleFixtures,
  type CashSaleFixture,
} from './support/cashSaleFixture';

const enabled = databaseTestsEnabled();

let fixtures: CashSaleFixture[] = [];

/**
 * A settled full refund, differing by ONE field.
 *
 * `return_carrier_delivered_at` is the entire subject of the fix — a carrier saying the
 * goods reached the seller is what makes reopening wrong — so the two scenarios are built
 * from one place with that as the only variable.
 */
async function bouncedRefund(returned: boolean): Promise<CashSaleFixture> {
  const fixture = await createCashSaleFixture({
    status: `'REFUNDED'`,
    dispute_resolution: `'REFUND_BUYER'`,
    dispute_resolved_at: 'now()',
    refund_status: `'SETTLED'`,
    // A FULL refund equals what was collected. Taken from the cloned row rather than a
    // literal, because `cash_sales_amount_components` ties the money columns together and
    // an invented figure either violates it or quietly means something else.
    refund_cents: 'source.amount_cents',
    refund_nonce: `'refund:test-' || gen_random_uuid()::text`,
    refund_error: 'null',
    refund_attempts: '0',
    transfer_id: `'transfer-test'`,
    seller_payout_status: `'NOT_DUE'`,
    return_carrier_delivered_at: returned ? 'now()' : 'null',
  });
  fixtures.push(fixture);
  return fixture;
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
    await destroyCashSaleFixtures(fixtures);
    fixtures = [];
  });

  it('reopens a bounced dispute refund, which is what 0045 is for', async () => {
    const { saleId } = await bouncedRefund(false);

    await query(`select cardtrade.record_cash_sale_refund_failure('${saleId}', 'bank returned it')`);

    const sale = await readSale(saleId);
    // Unchanged behaviour: the remedy failed and nothing physical moved, so the case is
    // decided again from scratch.
    expect(sale.status).toBe('DISPUTED');
    expect(sale.dispute_resolution).toBeNull();
    expect(sale.refund_cents).toBe(0);
    expect(sale.refund_nonce).toBeNull();
  }, 30_000);

  it('does NOT reopen a bounced refund once the goods came back', async () => {
    const { saleId } = await bouncedRefund(true);

    await query(`select cardtrade.record_cash_sale_refund_failure('${saleId}', 'bank returned it')`);

    const sale = await readSale(saleId);
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
    const { saleId, itemId } = await bouncedRefund(true);

    await query(`select cardtrade.record_cash_sale_refund_failure('${saleId}', 'bank returned it')`);

    const rows = await query<{ status: string }>(
      `select status from cardtrade.items where id = '${itemId}'`,
    );
    // Re-reserving would pull a seller's live listing out of the catalog over a payment
    // problem, for goods they are holding.
    expect(rows[0].status).toBe('AVAILABLE');
  }, 30_000);

  it('records the failure under a name that does not imply an open dispute', async () => {
    const { saleId } = await bouncedRefund(true);

    await query(`select cardtrade.record_cash_sale_refund_failure('${saleId}', null)`);

    const rows = await query<{ event: string }>(`
      select event from cardtrade.cash_sale_events
      where cash_sale_id = '${saleId}' order by created_at desc limit 1
    `);
    expect(rows[0].event).toBe('RETURN_REFUND_FAILED');
  }, 30_000);
});
