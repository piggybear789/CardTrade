// tests/database/returnTrackingRefundQueue.test.ts
//
// THE TEST THAT WOULD HAVE CAUGHT THE WORST BUG IN THIS FEATURE.
//
// `apply_cash_sale_return_tracking` is what the Ship24 webhook calls when a carrier
// confirms returned goods reached the seller. For a while the refund it was meant to
// lead to was never queued, and every assertion at the time was about STATUS rather
// than MONEY, so a buyer could read Refunded and never be paid.
//
// SINCE 0143 (ESC-11) delivery opens the seller's 72-hour window to check the parcel and
// queues nothing itself. The refund is released by `releaseDueReturnRefunds` in the :47
// job, which reads `listDueReturnRefunds`. These assertions run against the real function
// and pin that predicate, so "the job would find it" stays testable.

import { afterEach, describe, expect, it } from 'vitest';

import { databaseTestsEnabled, query } from './support/sql';
import {
  createCashSaleFixture,
  destroyCashSaleFixtures,
  type CashSaleFixture,
} from './support/cashSaleFixture';

const enabled = databaseTestsEnabled();
let fixtures: CashSaleFixture[] = [];

/** A sale the buyer has posted back, awaiting the carrier's word. */
async function returnInTransit(extra: Record<string, string> = {}) {
  const fixture = await createCashSaleFixture({
    status: `'RETURN_IN_TRANSIT'`,
    dispute_resolution: `'REFUND_BUYER'`,
    dispute_resolved_at: 'now()',
    refund_cents: '0',
    refund_status: `'NOT_DUE'`,
    refund_nonce: 'null',
    refund_error: 'null',
    refund_attempts: '0',
    transfer_id: `'transfer-test'`,
    seller_payout_status: `'NOT_DUE'`,
    // A per-fixture number: 0144 binds a tracking number to one contract.
    return_tracking_number: `'RET-TEST-' || gen_random_uuid()::text`,
    return_tracking_carrier: `'Australia Post'`,
    return_shipped_at: 'now()',
    return_carrier_delivered_at: 'null',
    return_disputed_at: 'null',
    return_lapsed_at: 'null',
    ...extra,
  });
  fixtures.push(fixture);
  return fixture;
}

async function readSale(saleId: string) {
  const rows = await query<{
    status: string;
    refund_status: string;
    refund_nonce: string | null;
    return_carrier_delivered_at: string | null;
    deadline: string | null;
    hours: number | null;
  }>(`
    select status, refund_status, refund_nonce, return_carrier_delivered_at,
           return_inspection_deadline_at as deadline,
           round(extract(epoch from (return_inspection_deadline_at - now())) / 3600)::int as hours
    from cardtrade.cash_sales where id = '${saleId}'
  `);
  return rows[0];
}

/** Exactly the predicate `listDueReturnRefunds` uses. */
async function releaseWouldPickUp(saleId: string, at = 'now()'): Promise<boolean> {
  const rows = await query<{ c: number }>(`
    select count(*)::int as c from cardtrade.cash_sales
    where id = '${saleId}'
      and status = 'RETURN_IN_TRANSIT'
      and return_disputed_at is null
      and return_carrier_delivered_at is not null
      and return_inspection_deadline_at <= ${at}
  `);
  return rows[0].c === 1;
}

describe.skipIf(!enabled)('apply_cash_sale_return_tracking', () => {
  afterEach(async () => {
    await destroyCashSaleFixtures(fixtures);
    fixtures = [];
  });

  it('opens the seller window on carrier delivery and queues no refund yet (ESC-11)', async () => {
    const { saleId } = await returnInTransit();
    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())`);
    const sale = await readSale(saleId);
    expect(sale.return_carrier_delivered_at).not.toBeNull();
    expect(sale.deadline).not.toBeNull();
    expect(sale.hours).toBe(72);
    // Nothing is owed until the seller has had the chance to open the parcel.
    expect(sale.refund_status).toBe('NOT_DUE');
  }, 30_000);

  it('is found by the :47 release only once the window has closed', async () => {
    const { saleId } = await returnInTransit();
    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())`);
    expect(await releaseWouldPickUp(saleId)).toBe(false);
    expect(await releaseWouldPickUp(saleId, `now() + interval '73 hours'`)).toBe(true);
  }, 30_000);

  it('does not move the window on a duplicate carrier event', async () => {
    const { saleId } = await returnInTransit();
    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())`);
    const first = await readSale(saleId);
    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())`);
    const second = await readSale(saleId);
    expect(second.deadline).toBe(first.deadline);
    expect(second.return_carrier_delivered_at).toBe(first.return_carrier_delivered_at);
  }, 30_000);

  it('is never released when the seller has contested the return', async () => {
    const { saleId } = await returnInTransit({ return_disputed_at: 'now()' });
    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())`);
    const sale = await readSale(saleId);
    // The delivery is still recorded, because it is evidence either way.
    expect(sale.return_carrier_delivered_at).not.toBeNull();
    expect(sale.refund_status).toBe('NOT_DUE');
    expect(await releaseWouldPickUp(saleId, `now() + interval '73 hours'`)).toBe(false);
  }, 30_000);

  it('records a non-delivery update without opening a window', async () => {
    const { saleId } = await returnInTransit();
    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'IN_TRANSIT', null)`);
    const sale = await readSale(saleId);
    expect(sale.return_carrier_delivered_at).toBeNull();
    expect(sale.deadline).toBeNull();
  }, 30_000);

  it('ignores a late carrier event on a sale that already closed', async () => {
    const { saleId } = await returnInTransit({
      status: `'REFUNDED'`,
      refund_status: `'SETTLED'`,
      refund_nonce: `'refund:already-settled'`,
      return_carrier_delivered_at: 'now()',
    });
    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())`);
    const sale = await readSale(saleId);
    expect(sale.status).toBe('REFUNDED');
    expect(sale.refund_status).toBe('SETTLED');
    expect(sale.refund_nonce).toBe('refund:already-settled');
  }, 30_000);
});
