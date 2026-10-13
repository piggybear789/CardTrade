// tests/property/lapsedSaleCase.test.ts
//
// The one rule for marker cases in the staff queue, and the buyer control that lines up
// with it (lapsed-sale-case-fix).
//
// `cashSaleMarkerCase` decides from a cash sale's status and three timestamps whether it
// is a "Not shipped", "Return contested" or "Return lapsed" case. STATUS SCOPES EVERY
// MARKER: the ship-by flag counts only in ESCROW_HELD, the return markers only in
// RETURN_PENDING or RETURN_IN_TRANSIT. The old rule read any marker in any of those three
// statuses, and listed a running return as a seller who had not posted (Bug 1).
//
// Properties 1 and 2 hold the rule to the old one: different exactly on the bug
// condition, identical everywhere else. The oracle is the transcription the queue suite
// checks against the real action. Properties 3 and 4 tie `canReportUnpostedSale` to the
// same rule, because the staff guidance on a "Not shipped" case tells the arbitrator the
// buyer can report a problem, and that has to be true of every case it is shown on.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { cashSaleMarkerCase } from '@/domain/arbitration/arbitrationCase';
import { canReportUnpostedSale } from '@/domain/contract/cashSaleStatus';
import {
  CASH_SALE_STATUSES,
  isBugCondition1,
  legacySituationOf,
  type MarkerRow,
} from '../unit/helpers/lapsedSaleOracle';

const BASE = Date.parse('2026-07-01T00:00:00.000Z');

/** An ISO timestamp within two months of BASE, built from an integer so it is always valid. */
const iso = fc
  .integer({ min: 0, max: 60 * 24 * 60 })
  .map((minutes) => new Date(BASE + minutes * 60_000).toISOString());

/** A marker column, set about half the time. */
const marker = fc.option(iso, { nil: null, freq: 2 });

/** Any status, including strings that are not one, which must open no case. */
const anyStatus = fc.oneof(fc.constantFrom(...CASH_SALE_STATUSES), fc.string({ maxLength: 12 }));

const anyRow: fc.Arbitrary<MarkerRow> = fc.record({
  status: anyStatus,
  shipLapsedAt: marker,
  returnDisputedAt: marker,
  returnLapsedAt: marker,
});

/** C1: a running return carrying only an old ship-by flag. */
const c1Row: fc.Arbitrary<MarkerRow> = fc.record({
  status: fc.constantFrom('RETURN_PENDING', 'RETURN_IN_TRANSIT'),
  shipLapsedAt: iso,
  returnDisputedAt: fc.constant(null),
  returnLapsedAt: fc.constant(null),
});

/** C1': an ESCROW_HELD sale carrying a return marker. */
const c1MirrorRow: fc.Arbitrary<MarkerRow> = fc
  .record({
    status: fc.constant('ESCROW_HELD'),
    shipLapsedAt: marker,
    returnDisputedAt: marker,
    returnLapsedAt: marker,
  })
  .filter((row) => row.returnDisputedAt !== null || row.returnLapsedAt !== null);

const RETURN_FLOW: ReadonlySet<string> = new Set(['RETURN_PENDING', 'RETURN_IN_TRANSIT']);

const AT = '2026-07-04T09:00:00.000Z';
const EARLIER = '2026-07-02T09:00:00.000Z';
const LATER = '2026-07-06T09:00:00.000Z';

describe('Property 1: a marker outside its own flow opens no case', () => {
  it('opens no case for a running return that carries only a ship-by flag', () => {
    fc.assert(
      fc.property(c1Row, (row) => {
        expect(isBugCondition1(row)).toBe(true);
        expect(cashSaleMarkerCase(row)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it('reads an ESCROW_HELD sale by its ship-by flag alone', () => {
    fc.assert(
      fc.property(c1MirrorRow, (row) => {
        expect(isBugCondition1(row)).toBe(true);
        expect(cashSaleMarkerCase(row)).toEqual(
          row.shipLapsedAt ? { situation: 'SHIP_LAPSED', openedAt: row.shipLapsedAt } : null,
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe('Property 2: everywhere else, the rule is the old one', () => {
  it('agrees with the old read and loop on every row outside the bug condition', () => {
    fc.assert(
      fc.property(
        anyRow.filter((row) => !isBugCondition1(row)),
        (row) => {
          expect(cashSaleMarkerCase(row)).toEqual(legacySituationOf(row));
        },
      ),
      { numRuns: 500 },
    );
  });

  it('only names a situation inside its own statuses, clocked from its own marker', () => {
    fc.assert(
      fc.property(anyRow, (row) => {
        const found = cashSaleMarkerCase(row);
        if (!found) return;
        if (found.situation === 'SHIP_LAPSED') {
          expect(row.status).toBe('ESCROW_HELD');
          expect(found.openedAt).toBe(row.shipLapsedAt);
        } else {
          expect(RETURN_FLOW.has(row.status)).toBe(true);
          expect(found.openedAt).toBe(
            found.situation === 'RETURN_CONTESTED' ? row.returnDisputedAt : row.returnLapsedAt,
          );
        }
      }),
      { numRuns: 500 },
    );
  });

  it('ignores every marker that belongs to another flow', () => {
    fc.assert(
      fc.property(anyRow, marker, marker, marker, (row, ship, disputed, lapsed) => {
        const changed: MarkerRow =
          row.status === 'ESCROW_HELD'
            ? { ...row, returnDisputedAt: disputed, returnLapsedAt: lapsed }
            : RETURN_FLOW.has(row.status)
              ? { ...row, shipLapsedAt: ship }
              : { ...row, shipLapsedAt: ship, returnDisputedAt: disputed, returnLapsedAt: lapsed };
        expect(cashSaleMarkerCase(changed)).toEqual(cashSaleMarkerCase(row));
      }),
      { numRuns: 500 },
    );
  });

  it.each<[string, MarkerRow, ReturnType<typeof cashSaleMarkerCase>]>([
    [
      'contested wins over lapsed',
      { status: 'RETURN_PENDING', shipLapsedAt: EARLIER, returnDisputedAt: LATER, returnLapsedAt: AT },
      { situation: 'RETURN_CONTESTED', openedAt: LATER },
    ],
    [
      'a lapsed return in transit',
      { status: 'RETURN_IN_TRANSIT', shipLapsedAt: null, returnDisputedAt: null, returnLapsedAt: AT },
      { situation: 'RETURN_LAPSED', openedAt: AT },
    ],
    [
      'a lapsed return with an old ship-by flag',
      { status: 'RETURN_PENDING', shipLapsedAt: EARLIER, returnDisputedAt: null, returnLapsedAt: AT },
      { situation: 'RETURN_LAPSED', openedAt: AT },
    ],
    [
      'a running return with only an old ship-by flag',
      { status: 'RETURN_PENDING', shipLapsedAt: EARLIER, returnDisputedAt: null, returnLapsedAt: null },
      null,
    ],
    [
      'a running return with nothing on it',
      { status: 'RETURN_IN_TRANSIT', shipLapsedAt: null, returnDisputedAt: null, returnLapsedAt: null },
      null,
    ],
    [
      'an unposted sale past its ship-by date',
      { status: 'ESCROW_HELD', shipLapsedAt: AT, returnDisputedAt: null, returnLapsedAt: null },
      { situation: 'SHIP_LAPSED', openedAt: AT },
    ],
    [
      'an unposted sale before its ship-by date',
      { status: 'ESCROW_HELD', shipLapsedAt: null, returnDisputedAt: null, returnLapsedAt: null },
      null,
    ],
    [
      'an unposted sale with only a return marker',
      { status: 'ESCROW_HELD', shipLapsedAt: null, returnDisputedAt: AT, returnLapsedAt: null },
      null,
    ],
    [
      'an unposted sale with a return marker and a ship-by flag',
      { status: 'ESCROW_HELD', shipLapsedAt: AT, returnDisputedAt: null, returnLapsedAt: LATER },
      { situation: 'SHIP_LAPSED', openedAt: AT },
    ],
    [
      'a disputed sale, whatever it carries',
      { status: 'DISPUTED', shipLapsedAt: AT, returnDisputedAt: AT, returnLapsedAt: AT },
      null,
    ],
    [
      'a sale that has shipped since its flag',
      { status: 'IN_TRANSIT', shipLapsedAt: AT, returnDisputedAt: null, returnLapsedAt: null },
      null,
    ],
    [
      'a status that is not one',
      { status: 'NOT_A_STATUS', shipLapsedAt: AT, returnDisputedAt: AT, returnLapsedAt: AT },
      null,
    ],
  ])('%s', (_label, row, expected) => {
    expect(cashSaleMarkerCase(row)).toEqual(expected);
  });
});

describe('Property 3: the buyer can report a problem on exactly the sales listed as "Not shipped"', () => {
  it('agrees with the queue rule on every posted sale', () => {
    fc.assert(
      fc.property(anyRow, (row) => {
        const sale = { status: row.status, fulfillmentMethod: 'DELIVERY', shipLapsedAt: row.shipLapsedAt };
        expect(canReportUnpostedSale(sale, 'BUYER')).toBe(
          cashSaleMarkerCase(row)?.situation === 'SHIP_LAPSED',
        );
      }),
      { numRuns: 500 },
    );
  });

  it('lets the buyer of a lapsed, unposted sale report it', () => {
    expect(
      canReportUnpostedSale(
        { status: 'ESCROW_HELD', fulfillmentMethod: 'DELIVERY', shipLapsedAt: AT },
        'BUYER',
      ),
    ).toBe(true);
  });
});

describe('Property 4: nobody else gets the control', () => {
  const method = fc.constantFrom('DELIVERY', 'IN_PERSON', null);

  it('never offers it to the seller, whose remedy is to post', () => {
    fc.assert(
      fc.property(anyStatus, method, marker, (status, fulfillmentMethod, shipLapsedAt) => {
        expect(canReportUnpostedSale({ status, fulfillmentMethod, shipLapsedAt }, 'SELLER')).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('never offers it on a sale that is not posted', () => {
    fc.assert(
      fc.property(
        anyStatus,
        fc.constantFrom('IN_PERSON', null),
        marker,
        fc.constantFrom<'BUYER' | 'SELLER'>('BUYER', 'SELLER'),
        (status, fulfillmentMethod, shipLapsedAt, role) => {
          expect(canReportUnpostedSale({ status, fulfillmentMethod, shipLapsedAt }, role)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it.each<[string, { status: string; fulfillmentMethod: string | null; shipLapsedAt: string | null }]>([
    ['before the ship-by date', { status: 'ESCROW_HELD', fulfillmentMethod: 'DELIVERY', shipLapsedAt: null }],
    ['once it has shipped', { status: 'IN_TRANSIT', fulfillmentMethod: 'DELIVERY', shipLapsedAt: AT }],
    ['once it is disputed', { status: 'DISPUTED', fulfillmentMethod: 'DELIVERY', shipLapsedAt: AT }],
    ['on an in-person sale', { status: 'ESCROW_HELD', fulfillmentMethod: 'IN_PERSON', shipLapsedAt: AT }],
  ])('does not offer it to the buyer %s', (_label, sale) => {
    expect(canReportUnpostedSale(sale, 'BUYER')).toBe(false);
  });
});
