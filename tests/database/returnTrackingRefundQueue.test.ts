// tests/database/returnTrackingRefundQueue.test.ts
//
// THE TEST THAT WOULD HAVE CAUGHT THE WORST BUG IN THIS FEATURE.
//
// `apply_cash_sale_return_tracking` is what the Ship24 webhook calls when a carrier
// confirms returned goods reached the seller. It stamps the delivery and queues the
// buyer's refund. For a while it queued nothing: `mark_cash_sale_refund_due` guarded on
// `status = 'DISPUTED'`, the only state that owed a refund when it was written in 0044,
// and this function calls it from RETURN_IN_TRANSIT. The UPDATE matched no rows.
//
// Nothing failed. `refund_status` stayed NOT_DUE, no nonce was assigned, the refund drain
// selects `refund_status in ('PENDING','FAILED')` and so found nothing, the sale moved to
// REFUNDED, the listing came back, and the event row said "The refund is queued". A buyer
// would have posted their goods back, read Refunded, and never been paid.
//
// It survived 522 passing tests because the unit fake carried the same guard — faithfully
// reproducing the bug so both copies agreed — and the return-flow test stamped the carrier
// confirmation directly, bypassing this function entirely. Every assertion was about
// STATUS. None was about MONEY.
//
// So these assertions are about money, and they run against the real function.

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
    // What entering the return flow leaves behind: NOTHING queued yet.
    refund_cents: '0',
    refund_status: `'NOT_DUE'`,
    refund_nonce: 'null',
    refund_error: 'null',
    refund_attempts: '0',
    transfer_id: `'transfer-test'`,
    seller_payout_status: `'NOT_DUE'`,
    // amount_cents is deliberately NOT overridden. `cash_sales_amount_components` ties
    // it to the agreed price and shipping, so inventing a figure produces a row the
    // schema rejects — and a fixture that violates an invariant is not evidence about
    // anything. The assertions read the cloned row's own amount instead.
    return_tracking_number: `'RET-TEST-1'`,
    return_tracking_carrier: `'Australia Post'`,
    return_shipped_at: 'now()',
    return_carrier_delivered_at: 'null',
    return_disputed_at: 'null',
    return_lapsed_at: 'null',
    ...extra,
  });
  fixtures.push(fixture);
  const rows = await query<{ amount_cents: number }>(`
    select amount_cents::int as amount_cents from cardtrade.cash_sales
    where id = '${fixture.saleId}'
  `);
  return { ...fixture, amountCents: rows[0].amount_cents };
}

async function readRefund(saleId: string) {
  const rows = await query<{
    status: string;
    refund_status: string;
    refund_cents: number;
    refund_nonce: string | null;
    return_carrier_delivered_at: string | null;
  }>(`
    select status, refund_status, refund_cents::int as refund_cents, refund_nonce,
           return_carrier_delivered_at
    from cardtrade.cash_sales where id = '${saleId}'
  `);
  return rows[0];
}

/** Exactly the predicate `listDueRefunds` uses, so "the drain would find it" is testable. */
async function drainWouldPickUp(saleId: string): Promise<boolean> {
  const rows = await query<{ c: number }>(`
    select count(*)::int as c from cardtrade.cash_sales
    where id = '${saleId}'
      and refund_status in ('PENDING', 'FAILED')
      and refund_cents > 0
      and transfer_id is not null
      and refund_attempts < 5
      and return_disputed_at is null
  `);
  return rows[0].c === 1;
}

describe.skipIf(!enabled)('apply_cash_sale_return_tracking', () => {
  afterEach(async () => {
    await destroyCashSaleFixtures(fixtures);
    fixtures = [];
  });

  it('QUEUES THE REFUND when a carrier confirms the return arrived', async () => {
    const { saleId, amountCents } = await returnInTransit();

    await query(`
      select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())
    `);

    const sale = await readRefund(saleId);
    // The delivery is recorded...
    expect(sale.return_carrier_delivered_at).not.toBeNull();
    // ...AND THE MONEY IS ACTUALLY OWED, for the whole collected amount. This is the
    // assertion whose absence let a buyer be told they were refunded while nothing was
    // queued.
    expect(sale.refund_status).toBe('PENDING');
    expect(sale.refund_cents).toBe(amountCents);
    expect(sale.refund_cents).toBeGreaterThan(0);
    expect(sale.refund_nonce).not.toBeNull();
  }, 30_000);

  it('leaves the refund somewhere the drain will actually find it', async () => {
    const { saleId } = await returnInTransit();

    await query(`
      select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())
    `);

    // Queuing it is not enough if the drain's predicate excludes it. The original bug
    // failed both halves at once, and either alone strands the money.
    expect(await drainWouldPickUp(saleId)).toBe(true);
  }, 30_000);

  it('does not queue a second refund on a duplicate carrier event', async () => {
    const { saleId } = await returnInTransit();

    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())`);
    const first = await readRefund(saleId);
    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())`);
    const second = await readRefund(saleId);

    // Carriers repeat webhooks. The nonce must be the SAME one, because the provider
    // deduplicates on it — regenerating would authorise a second payment.
    expect(second.refund_nonce).toBe(first.refund_nonce);
    expect(second.refund_cents).toBe(first.refund_cents);
    expect(second.return_carrier_delivered_at).toBe(first.return_carrier_delivered_at);
  }, 30_000);

  it('queues NOTHING when the seller has contested the return', async () => {
    const { saleId } = await returnInTransit({ return_disputed_at: 'now()' });

    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())`);

    const sale = await readRefund(saleId);
    // The contest freezes the money and hands the case to an operator. The delivery is
    // still recorded, because it is evidence either way.
    expect(sale.return_carrier_delivered_at).not.toBeNull();
    expect(sale.refund_status).toBe('NOT_DUE');
    expect(sale.refund_cents).toBe(0);
    expect(await drainWouldPickUp(saleId)).toBe(false);
  }, 30_000);

  it('records a non-delivery update without owing anything', async () => {
    const { saleId } = await returnInTransit();

    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'IN_TRANSIT', null)`);

    const sale = await readRefund(saleId);
    expect(sale.return_carrier_delivered_at).toBeNull();
    expect(sale.refund_status).toBe('NOT_DUE');
  }, 30_000);

  it('ignores a late carrier event on a sale that already closed', async () => {
    const { saleId } = await returnInTransit({
      status: `'REFUNDED'`,
      refund_status: `'SETTLED'`,
      refund_nonce: `'refund:already-settled'`,
      return_carrier_delivered_at: 'now()',
    });

    await query(`select cardtrade.apply_cash_sale_return_tracking('${saleId}', 'DELIVERED', now())`);

    const sale = await readRefund(saleId);
    // A closed sale is not reopened and the settled refund is not disturbed.
    expect(sale.status).toBe('REFUNDED');
    expect(sale.refund_status).toBe('SETTLED');
    expect(sale.refund_nonce).toBe('refund:already-settled');
  }, 30_000);
});
