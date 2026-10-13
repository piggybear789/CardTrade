// tests/unit/arbitrationQueue.test.ts
//
// Which cash sales the staff arbitration queue lists, driven through the real
// `getArbitrationQueue` and `getArbitrationCase`, with only the database, the staff gate
// and the evidence read replaced.
//
// THE DEFECT THIS PINS (lapsed-sale-case-fix, Bug 1). Three timestamps open a case
// without a DISPUTED status: `ship_lapsed_at` (0132), `return_disputed_at` (0088) and
// `return_lapsed_at` (0089). The queue read them in any of three statuses and labelled
// everything without a return marker "Not shipped". `ship_lapsed_at` is never cleared,
// so a sale that posted late and was later sent back by an arbitrator was listed, for
// the whole return, as a seller who had not posted: aged from the old flag, ranked
// overdue, and impossible to clear, because the return decision refuses a return that is
// neither contested nor lapsed. Status now scopes every marker (`cashSaleMarkerCase`).
//
// The candidate read is unchanged by the fix, so the fake answers it with the filter the
// database applies. `helpers/lapsedSaleOracle.ts` holds that filter and the old loop, and
// the Property 2 block checks the oracle against the real queue on generated rows.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { summariseQueue } from '@/domain/arbitration/arbitrationCase';
import {
  createFakeAdmin,
  type FakeAdmin,
  type QueuedResult,
  type RecordedCall,
} from './fakes/supabaseChain';
import {
  isBugCondition1,
  legacyCandidate,
  legacySituationOf,
  type MarkerRow,
} from './helpers/lapsedSaleOracle';

let admin: FakeAdmin;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin.client,
}));

vi.mock('@/lib/staffGate', () => ({
  requireStaff: async () => ({ ok: true, ctx: { userId: 'staff-1', isAdmin: false } }),
}));

vi.mock('@/lib/actions/disputeEvidence', () => ({
  getDisputeEvidenceForStaff: async () => ({ ok: true, data: { entries: [] } }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

const { getArbitrationCase, getArbitrationQueue } = await import('@/lib/actions/arbitration');

const NOW = Date.now();
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

/** A `cash_sales` row with every column the queue and the case page read. */
type SaleRow = {
  id: string;
  status: string;
  currency: string;
  ship_by_at: string | null;
  ship_lapsed_at: string | null;
  return_disputed_at: string | null;
  return_lapsed_at: string | null;
  [column: string]: unknown;
};

function saleRow(id: string, overrides: Partial<SaleRow> = {}): SaleRow {
  return {
    id,
    status: 'ESCROW_HELD',
    currency: 'aud',
    item_title: `Card ${id}`,
    from_shopfront: false,
    amount_cents: 10_000,
    platform_fee_cents: 0,
    refund_cents: 0,
    refund_status: null,
    buyer_id: `buyer-${id}`,
    seller_id: `seller-${id}`,
    disputed_at: null,
    disputed_by: null,
    dispute_reason: null,
    return_disputed_at: null,
    return_dispute_reason: null,
    return_lapsed_at: null,
    ship_by_at: null,
    ship_lapsed_at: null,
    tracking_carrier: null,
    tracking_number: null,
    shipped_at: null,
    carrier_delivered_at: null,
    received_at: null,
    inspection_accepted_at: null,
    buyer_handover_confirmed_at: null,
    seller_handover_confirmed_at: null,
    return_tracking_carrier: null,
    return_tracking_number: null,
    return_shipped_at: null,
    return_carrier_delivered_at: null,
    cash_sale_items: [],
    ...overrides,
  };
}

function markersOf(row: SaleRow): MarkerRow {
  return {
    status: row.status,
    shipLapsedAt: row.ship_lapsed_at,
    returnDisputedAt: row.return_disputed_at,
    returnLapsedAt: row.return_lapsed_at,
  };
}

function rowFrom(id: string, markers: MarkerRow): SaleRow {
  return saleRow(id, {
    status: markers.status,
    ship_lapsed_at: markers.shipLapsedAt,
    return_disputed_at: markers.returnDisputedAt,
    return_lapsed_at: markers.returnLapsedAt,
  });
}

let sales: SaleRow[] = [];
let chargebacks: Record<string, unknown>[] = [];
let reads: RecordedCall[] = [];

/** Answer every read the two actions make, by table and by what the read asks for. */
function respond(call: RecordedCall): QueuedResult | undefined {
  if (call.op !== 'select') return undefined;
  reads.push(call);
  switch (call.table) {
    case 'cash_sales':
      if (call.match.status === 'DISPUTED') {
        return { data: sales.filter((row) => row.status === 'DISPUTED') };
      }
      // The case page's shipment and resolution reads, by primary key.
      if (typeof call.match.id === 'string') {
        return { data: sales.find((row) => row.id === call.match.id) ?? null };
      }
      // The marker-case candidate read, filtered as the database filters it.
      return { data: sales.filter((row) => legacyCandidate(markersOf(row))) };
    case 'charge_disputes':
      // By sale on the case page (an open chargeback colliding with a refund), else the
      // queue's list of open chargebacks.
      return { data: typeof call.match.cash_sale_id === 'string' ? null : chargebacks };
    case 'trades':
    case 'pre_auth_holds':
    case 'arbitration_assignments':
    case 'arbitration_notes':
    case 'cash_sale_events':
    case 'profiles':
      return { data: [] };
    default:
      return undefined;
  }
}

function world(rows: SaleRow[], disputes: Record<string, unknown>[] = []) {
  sales = rows;
  chargebacks = disputes;
  reads = [];
  admin = createFakeAdmin({ respond });
}

async function queue() {
  const result = await getArbitrationQueue();
  if (!result.ok) throw new Error(`queue refused: ${result.error}`);
  return result.data.cases;
}

function indexed<T extends { ref: string }>(cases: readonly T[]): Record<string, T> {
  return Object.fromEntries(cases.map((c) => [c.ref, c]));
}

/** What each listed case is, by ref: the part this suite is about. */
function listed(cases: readonly { ref: string; situation: string; openedAt: string | null }[]) {
  return Object.fromEntries(
    cases.map((c) => [c.ref, { situation: c.situation, openedAt: c.openedAt }]),
  );
}

const NOT_OPEN = {
  ok: false,
  error: 'not-found',
  message: 'That case is not open, or does not exist.',
};

const BASE = Date.parse('2026-07-01T00:00:00.000Z');
const iso = fc
  .integer({ min: 0, max: 60 * 24 * 60 })
  .map((minutes) => new Date(BASE + minutes * 60_000).toISOString());
const marker = fc.option(iso, { nil: null, freq: 2 });

beforeEach(() => world([]));

describe('Property 1: a marker outside its own flow opens no case', () => {
  it('does not list a running return as "Not shipped" because of an old ship-by flag', async () => {
    world([
      saleRow('rp1', {
        status: 'RETURN_PENDING',
        ship_by_at: hoursAgo(200),
        ship_lapsed_at: hoursAgo(192),
      }),
    ]);

    const cases = await queue();

    expect(cases.map((c) => c.ref)).toEqual([]);
    expect(summariseQueue(cases)).toMatchObject({ total: 0, overdue: 0, amountAtRiskCents: 0 });
  });

  it('does not list a posted return whose lapse was cleared when it shipped', async () => {
    world([
      saleRow('rit1', {
        status: 'RETURN_IN_TRANSIT',
        ship_lapsed_at: hoursAgo(192),
        return_lapsed_at: null,
      }),
    ]);

    expect((await queue()).map((c) => c.ref)).toEqual([]);
  });

  it('reports such a sale as not open rather than opening a case nobody can decide', async () => {
    world([saleRow('rp1', { status: 'RETURN_PENDING', ship_lapsed_at: hoursAgo(192) })]);

    expect(await getArbitrationCase('CASH_SALE', 'rp1')).toEqual(NOT_OPEN);
  });

  it('reads an ESCROW_HELD sale by its ship-by flag alone, ignoring return markers', async () => {
    world([
      saleRow('eh1', {
        status: 'ESCROW_HELD',
        return_lapsed_at: hoursAgo(10),
        ship_lapsed_at: hoursAgo(5),
      }),
      saleRow('eh2', { status: 'ESCROW_HELD', return_disputed_at: hoursAgo(10) }),
    ]);

    expect(listed(await queue())).toEqual({
      eh1: { situation: 'SHIP_LAPSED', openedAt: hoursAgo(5) },
    });
  });

  it('lists every generated bug-condition row only by the marker of its own flow', async () => {
    const c1: fc.Arbitrary<MarkerRow> = fc.record({
      status: fc.constantFrom('RETURN_PENDING', 'RETURN_IN_TRANSIT'),
      shipLapsedAt: iso,
      returnDisputedAt: fc.constant(null),
      returnLapsedAt: fc.constant(null),
    });
    const c1Mirror: fc.Arbitrary<MarkerRow> = fc
      .record({
        status: fc.constant('ESCROW_HELD'),
        shipLapsedAt: marker,
        returnDisputedAt: marker,
        returnLapsedAt: marker,
      })
      .filter((row) => row.returnDisputedAt !== null || row.returnLapsedAt !== null);

    await fc.assert(
      fc.asyncProperty(fc.array(fc.oneof(c1, c1Mirror), { minLength: 1, maxLength: 4 }), async (rows) => {
        world(rows.map((row, index) => rowFrom(`s${index}`, row)));

        expect(listed(await queue())).toEqual(
          Object.fromEntries(
            rows.flatMap((row, index) =>
              row.status === 'ESCROW_HELD' && row.shipLapsedAt
                ? [[`s${index}`, { situation: 'SHIP_LAPSED', openedAt: row.shipLapsedAt }]]
                : [],
            ),
          ),
        );
      }),
      { numRuns: 40 },
    );
  });
});

describe('Property 2: in-flow markers keep their situation, clock and claim', () => {
  it('lists an unshipped ESCROW_HELD sale as "Not shipped", clocked from the flag', async () => {
    world([
      saleRow('eh1', { status: 'ESCROW_HELD', ship_by_at: hoursAgo(30), ship_lapsed_at: hoursAgo(6) }),
    ]);

    const cases = await queue();

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      kind: 'CASH_SALE',
      ref: 'eh1',
      situation: 'SHIP_LAPSED',
      openedAt: hoursAgo(6),
      raisedById: null,
      claim: "The seller has not posted the item by the ship-by date. The buyer's payment is still held.",
      amountAtRiskCents: 10_000,
      priority: 'NORMAL',
    });
    expect(cases[0].parties.map((party) => [party.id, party.role])).toEqual([
      ['buyer-eh1', 'Buyer'],
      ['seller-eh1', 'Seller'],
    ]);
  });

  it('keeps a contested return contested, with or without an old ship-by flag', async () => {
    world([
      saleRow('c1', {
        status: 'RETURN_PENDING',
        return_disputed_at: hoursAgo(4),
        return_dispute_reason: 'The box was empty',
        ship_lapsed_at: hoursAgo(300),
      }),
      saleRow('c2', {
        status: 'RETURN_IN_TRANSIT',
        return_disputed_at: hoursAgo(3),
        return_dispute_reason: 'Wrong card came back',
        return_lapsed_at: hoursAgo(50),
      }),
    ]);

    const byRef = indexed(await queue());

    expect(byRef.c1).toMatchObject({
      situation: 'RETURN_CONTESTED',
      openedAt: hoursAgo(4),
      raisedById: 'seller-c1',
      claim: 'The box was empty',
    });
    // Contested AND lapsed: contested wins, because a person already said so.
    expect(byRef.c2).toMatchObject({
      situation: 'RETURN_CONTESTED',
      openedAt: hoursAgo(3),
      raisedById: 'seller-c2',
      claim: 'Wrong card came back',
    });
  });

  it('keeps a lapsed return lapsed, with or without an old ship-by flag', async () => {
    world([
      saleRow('l1', {
        status: 'RETURN_PENDING',
        return_lapsed_at: hoursAgo(80),
        ship_lapsed_at: hoursAgo(400),
      }),
      saleRow('l2', { status: 'RETURN_PENDING', return_lapsed_at: hoursAgo(2) }),
    ]);

    const byRef = indexed(await queue());

    expect(byRef.l1).toMatchObject({
      situation: 'RETURN_LAPSED',
      openedAt: hoursAgo(80),
      raisedById: null,
      claim: 'The buyer did not post the return within the deadline.',
      priority: 'HIGH',
    });
    expect(byRef.l2).toMatchObject({ situation: 'RETURN_LAPSED', openedAt: hoursAgo(2), priority: 'NORMAL' });
  });

  it('lists a disputed sale once, as a dispute, whatever its ship-by history', async () => {
    world([
      saleRow('d1', {
        status: 'DISPUTED',
        disputed_at: hoursAgo(5),
        disputed_by: 'buyer-d1',
        dispute_reason: 'It never arrived',
        ship_by_at: hoursAgo(40),
        ship_lapsed_at: hoursAgo(20),
      }),
    ]);

    expect((await queue()).map((c) => [c.ref, c.situation])).toEqual([['d1', 'CONDITION_DISPUTE']]);
  });

  it('leaves out a sale that has shipped since it was flagged', async () => {
    world([
      saleRow('t1', { status: 'IN_TRANSIT', ship_lapsed_at: hoursAgo(20), tracking_number: 'AP1' }),
    ]);

    expect(await queue()).toEqual([]);
  });

  it('keeps a chargeback in the currency of the sale it reverses, listed or not', async () => {
    world(
      [saleRow('c1', { status: 'RETURN_PENDING', currency: 'usd', ship_lapsed_at: hoursAgo(100) })],
      [
        {
          id: 'cb1',
          amount_cents: 10_000,
          opened_at: hoursAgo(1),
          evidence_due_by: hoursAgo(-200),
          profile_id: 'buyer-c1',
          cash_sale_id: 'c1',
          trade_id: null,
          reason: 'fraudulent',
        },
      ],
    );

    expect(indexed(await queue()).cb1).toMatchObject({ kind: 'CHARGEBACK', currency: 'usd' });
  });

  it('still reads status alongside every marker, which the rule decides from', async () => {
    await queue();

    const candidateRead = reads.find(
      (read) =>
        read.table === 'cash_sales' && read.match.status === undefined && read.match.id === undefined,
    );
    const columns = (candidateRead?.columns ?? '').split(',').map((column) => column.trim());
    for (const column of ['status', 'ship_lapsed_at', 'return_disputed_at', 'return_lapsed_at']) {
      expect(columns).toContain(column);
    }
  });

  it('opens every listed case, and reports anything else as not open', async () => {
    world([
      saleRow('eh1', { status: 'ESCROW_HELD', ship_by_at: hoursAgo(30), ship_lapsed_at: hoursAgo(6) }),
      saleRow('l1', { status: 'RETURN_PENDING', return_lapsed_at: hoursAgo(8) }),
      saleRow('quiet', { status: 'ESCROW_HELD' }),
    ]);

    const cases = await queue();
    expect(cases.map((c) => c.ref).sort()).toEqual(['eh1', 'l1']);
    for (const c of cases) {
      expect((await getArbitrationCase('CASH_SALE', c.ref)).ok).toBe(true);
    }
    expect(await getArbitrationCase('CASH_SALE', 'quiet')).toEqual(NOT_OPEN);
  });

  it('agrees with the old rule on every generated row outside the bug condition', async () => {
    const candidate: fc.Arbitrary<MarkerRow> = fc
      .record({
        status: fc.constantFrom('RETURN_PENDING', 'RETURN_IN_TRANSIT', 'ESCROW_HELD'),
        shipLapsedAt: marker,
        returnDisputedAt: marker,
        returnLapsedAt: marker,
      })
      .filter((row) => legacyCandidate(row) && !isBugCondition1(row));

    await fc.assert(
      fc.asyncProperty(fc.array(candidate, { minLength: 1, maxLength: 4 }), async (rows) => {
        world(rows.map((row, index) => rowFrom(`s${index}`, row)));

        expect(listed(await queue())).toEqual(
          Object.fromEntries(rows.map((row, index) => [`s${index}`, legacySituationOf(row)])),
        );
      }),
      { numRuns: 50 },
    );
  });
});

describe('Property 3: a "Not shipped" case carries the dates staff need', () => {
  it('puts the ship-by date and the flag time on the case payload', async () => {
    world([
      saleRow('eh1', { status: 'ESCROW_HELD', ship_by_at: hoursAgo(30), ship_lapsed_at: hoursAgo(6) }),
    ]);

    const result = await getArbitrationCase('CASH_SALE', 'eh1');
    if (!result.ok) throw new Error(result.message);

    expect(result.data.shipment).toMatchObject({ shipByAt: hoursAgo(30), shipLapsedAt: hoursAgo(6) });
    expect(result.data.resolution).toMatchObject({
      kind: 'CASH_SALE',
      status: 'ESCROW_HELD',
      buyerHasGoods: false,
    });
  });
});
