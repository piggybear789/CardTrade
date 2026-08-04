// tests/property/payoutReadModel.test.ts
//
// Property tests for the Payouts_Dashboard read model (Req 12).
//
// These pin the arithmetic a member's money depends on: that no sale is counted
// twice, that a settled release is never presented as owed, that the totals
// reconcile against the rows they summarise, and that no provider-shaped value
// leaks into the output.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  bucketFor,
  derivePayoutReadModel,
  sellerNetCents,
  MAX_RELEASE_ATTEMPTS,
  type CashSaleStatus,
  type ChargeDisputeInput,
  type PayoutEventInput,
  type ReleaseStatus,
  type SellerCashSaleInput,
  type TradeArbitrationInput,
} from '@/domain/payouts/payoutReadModel';

const STATUSES: CashSaleStatus[] = [
  'AGREEMENT',
  'PAYMENT_PENDING',
  'ESCROW_HELD',
  'IN_TRANSIT',
  'HANDOVER',
  'INSPECTION',
  'COMPLETED',
  'DISPUTED',
  'CANCELLED',
  'FAILED',
  'REFUNDED',
];

const RELEASE_STATUSES: ReleaseStatus[] = ['NOT_DUE', 'PENDING', 'SETTLED', 'FAILED'];

/** Cents kept well inside the safe integer range so sums cannot overflow. */
const cents = fc.integer({ min: 0, max: 5_000_000 });

const isoDate = fc
  .integer({ min: 0, max: 60 * 60 * 24 * 365 })
  .map((s) => new Date(Date.UTC(2026, 0, 1) + s * 1000).toISOString());

const saleArb: fc.Arbitrary<SellerCashSaleInput> = fc.record({
  id: fc.uuid(),
  itemTitle: fc.string({ minLength: 1, maxLength: 40 }),
  status: fc.constantFrom(...STATUSES),
  amountCents: cents,
  platformFeeCents: cents,
  refundCents: cents,
  releaseStatus: fc.constantFrom(...RELEASE_STATUSES),
  releaseAttempts: fc.integer({ min: 0, max: 12 }),
  failureCause: fc.constantFrom(
    null,
    'NOT_PAYABLE' as const,
    'PROVIDER_REJECTED' as const,
    'RETRIES_EXHAUSTED' as const,
  ),
  completedAt: fc.option(isoDate, { nil: null }),
  disputeReason: fc.option(fc.string({ maxLength: 60 }), { nil: null }),
  disputeRaisedByMe: fc.boolean(),
});

const salesArb = fc.uniqueArray(saleArb, { selector: (s) => s.id, maxLength: 12 });

/** Events referencing the supplied sales, plus some orphans that must be dropped. */
function eventsFor(sales: readonly SellerCashSaleInput[]): fc.Arbitrary<PayoutEventInput[]> {
  const ids = sales.map((s) => s.id);
  const ref = ids.length > 0 ? fc.constantFrom(...ids) : fc.uuid();
  return fc.uniqueArray(
    fc.record({
      id: fc.uuid(),
      cashSaleId: fc.oneof(ref, fc.uuid()),
      event: fc.constantFrom(
        'SELLER_PAYOUT_QUEUED',
        'SELLER_PAYOUT_SETTLED',
        'SELLER_PAYOUT_FAILED',
        'AGREEMENT_ACCEPTED',
        'SHIPMENT_RECORDED',
      ),
      createdAt: isoDate,
    }),
    { selector: (e) => e.id, maxLength: 16 },
  );
}

const tradeArb: fc.Arbitrary<TradeArbitrationInput> = fc.record({
  id: fc.uuid(),
  state: fc.constantFrom(
    'COLLATERAL_PENDING' as const,
    'COLLATERAL_LOCKED' as const,
    'IN_TRANSIT' as const,
    'INSPECTION' as const,
    'COMPLETED' as const,
    'DISPUTED' as const,
    'FRAUD_RESOLVED' as const,
  ),
  myBondCents: cents,
  iAmFraudVictim: fc.boolean(),
  counterpartBondCents: cents,
  frictionTaxApplied: fc.boolean(),
  createdAt: isoDate,
});

const disputeArb: fc.Arbitrary<ChargeDisputeInput> = fc.record({
  id: fc.uuid(),
  amountCents: cents,
  openedAt: isoDate,
  closedAt: fc.option(isoDate, { nil: null }),
  outcome: fc.constantFrom(null, 'won', 'lost', 'warning_closed'),
  cashSaleId: fc.option(fc.uuid(), { nil: null }),
  tradeId: fc.option(fc.uuid(), { nil: null }),
});

/** A full input, with events constrained to reference the generated sales. */
const inputArb = salesArb.chain((sales) =>
  fc.record({
    sales: fc.constant(sales),
    events: eventsFor(sales),
    trades: fc.uniqueArray(tradeArb, { selector: (t) => t.id, maxLength: 8 }),
    disputes: fc.uniqueArray(disputeArb, { selector: (d) => d.id, maxLength: 8 }),
  }),
);

describe('sellerNetCents', () => {
  it('is never negative (non-negativity property)', () => {
    fc.assert(
      fc.property(cents, cents, cents, (amountCents, platformFeeCents, refundCents) => {
        expect(
          sellerNetCents({ amountCents, platformFeeCents, refundCents }),
        ).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('never exceeds the amount collected (bounded-net property)', () => {
    fc.assert(
      fc.property(cents, cents, cents, (amountCents, platformFeeCents, refundCents) => {
        expect(
          sellerNetCents({ amountCents, platformFeeCents, refundCents }),
        ).toBeLessThanOrEqual(amountCents);
      }),
    );
  });

  it('is an integer for any integer input', () => {
    fc.assert(
      fc.property(cents, cents, cents, (amountCents, platformFeeCents, refundCents) => {
        expect(
          Number.isInteger(sellerNetCents({ amountCents, platformFeeCents, refundCents })),
        ).toBe(true);
      }),
    );
  });

  // A refund is money the platform has already sent back to the Buyer, so it can
  // never still be owed to the Seller. Without this the dashboard would promise a
  // partially-refunded seller their full pre-dispute net.
  it('never counts refunded money as owed to the seller', () => {
    fc.assert(
      fc.property(cents, cents, cents, (amountCents, platformFeeCents, refundCents) => {
        const withRefund = sellerNetCents({ amountCents, platformFeeCents, refundCents });
        const withoutRefund = sellerNetCents({ amountCents, platformFeeCents });
        expect(withRefund).toBeLessThanOrEqual(withoutRefund);
      }),
    );
  });

  it('leaves nothing owed once the whole amount is refunded', () => {
    fc.assert(
      fc.property(cents, cents, (amountCents, platformFeeCents) => {
        expect(
          sellerNetCents({ amountCents, platformFeeCents, refundCents: amountCents }),
        ).toBe(0);
      }),
    );
  });
});

describe('bucketFor', () => {
  it('assigns each sale to exactly one bucket (partition property)', () => {
    fc.assert(
      fc.property(saleArb, (sale) => {
        const bucket = bucketFor(sale);
        expect(['RELEASING', 'UPCOMING', 'AT_RISK', 'NONE']).toContain(bucket);
      }),
    );
  });

  it('never presents a settled release as owed (settled-is-never-owed property)', () => {
    fc.assert(
      fc.property(saleArb, (sale) => {
        if (sale.releaseStatus !== 'SETTLED') return;
        expect(bucketFor(sale)).toBe('NONE');
      }),
    );
  });

  it('keeps disputed money out of both balances', () => {
    fc.assert(
      fc.property(saleArb, (sale) => {
        if (sale.status !== 'DISPUTED' || sale.releaseStatus === 'SETTLED') return;
        expect(bucketFor(sale)).toBe('AT_RISK');
      }),
    );
  });

  it('excludes sales before funds are collected', () => {
    fc.assert(
      fc.property(saleArb, (sale) => {
        if (sale.status !== 'AGREEMENT' && sale.status !== 'PAYMENT_PENDING') return;
        if (sale.releaseStatus === 'PENDING' || sale.releaseStatus === 'FAILED') return;
        expect(bucketFor(sale)).toBe('NONE');
      }),
    );
  });
});

describe('derivePayoutReadModel', () => {
  it('totals reconcile against the rows presented (reconciliation property)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const model = derivePayoutReadModel(input);
        const sum = model.releasing.reduce((acc, r) => acc + r.netCents, 0);
        expect(model.releasingNowCents).toBe(sum);
      }),
    );
  });

  it('never double-counts a sale across buckets (partition property)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const expected = { releasing: 0, upcoming: 0, atRisk: 0 };
        for (const sale of input.sales) {
          const net = sellerNetCents(sale);
          switch (bucketFor(sale)) {
            case 'RELEASING':
              expected.releasing += net;
              break;
            case 'UPCOMING':
              expected.upcoming += net;
              break;
            case 'AT_RISK':
              expected.atRisk += net;
              break;
            default:
              break;
          }
        }
        const model = derivePayoutReadModel(input);
        expect(model.releasingNowCents).toBe(expected.releasing);
        expect(model.upcomingProceedsCents).toBe(expected.upcoming);
        // At_Risk additionally carries open chargebacks, so it is a lower bound.
        expect(model.atRiskProceedsCents).toBeGreaterThanOrEqual(expected.atRisk);
      }),
    );
  });

  it('orders history newest-first (ordering property)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const { history } = derivePayoutReadModel(input);
        for (let i = 1; i < history.length; i += 1) {
          expect(history[i - 1].occurredAt >= history[i].occurredAt).toBe(true);
        }
      }),
    );
  });

  it('is independent of input order (order-independence property)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const reversed = {
          sales: [...input.sales].reverse(),
          events: [...input.events].reverse(),
          trades: [...input.trades].reverse(),
          disputes: [...input.disputes].reverse(),
        };
        expect(derivePayoutReadModel(reversed)).toEqual(derivePayoutReadModel(input));
      }),
    );
  });

  it('is idempotent under repeated derivation (idempotence property)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(derivePayoutReadModel(input)).toEqual(derivePayoutReadModel(input));
      }),
    );
  });

  it('ignores another member\u2019s records (isolation property)', () => {
    fc.assert(
      fc.property(inputArb, salesArb, (mine, theirs) => {
        // Their sales are not in `sales`, so their events must not surface.
        const foreignEvents: PayoutEventInput[] = theirs.map((s, i) => ({
          id: `foreign-${i}`,
          cashSaleId: s.id,
          event: 'SELLER_PAYOUT_SETTLED',
          createdAt: '2026-06-01T00:00:00.000Z',
        }));
        const withForeign = { ...mine, events: [...mine.events, ...foreignEvents] };

        const base = derivePayoutReadModel(mine);
        const polluted = derivePayoutReadModel(withForeign);

        expect(polluted.releasingNowCents).toBe(base.releasingNowCents);
        expect(polluted.upcomingProceedsCents).toBe(base.upcomingProceedsCents);
        const mineIds = new Set(mine.sales.map((s) => s.id));
        for (const entry of polluted.history) {
          if (entry.cashSaleId !== null) expect(mineIds.has(entry.cashSaleId)).toBe(true);
        }
      }),
    );
  });

  it('leaks no provider-shaped value (redaction property)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const serialised = JSON.stringify(derivePayoutReadModel(input));
        // Stripe object prefixes and our internal provider fields.
        for (const forbidden of [
          'pi_',
          'py_',
          'tr_',
          'acct_',
          'cus_',
          'dp_',
          'du_',
          'ch_',
          'whsec_',
          'sk_',
          'seller_payout_ref',
          'seller_payout_error',
          'dispute_ref',
          'charge_ref',
          'merchantRef',
          'releaseAttempts',
        ]) {
          expect(serialised).not.toContain(forbidden);
        }
      }),
    );
  });

  it('reports a blocked release whenever one has failed', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const model = derivePayoutReadModel(input);
        const anyFailed = input.sales.some(
          (s) => bucketFor(s) === 'RELEASING' && s.releaseStatus === 'FAILED',
        );
        expect(model.hasBlockedRelease).toBe(anyFailed);
      }),
    );
  });

  it('escalates to retries-exhausted at the cap', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const model = derivePayoutReadModel(input);
        for (const row of model.releasing) {
          const sale = input.sales.find((s) => s.id === row.cashSaleId);
          if (!sale || !row.blocked) continue;
          if (sale.releaseAttempts >= MAX_RELEASE_ATTEMPTS) {
            expect(row.failureCause).toBe('RETRIES_EXHAUSTED');
          }
        }
      }),
    );
  });

  it('reports noSales only when the member has never sold', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(derivePayoutReadModel(input).noSales).toBe(input.sales.length === 0);
      }),
    );
  });
});
