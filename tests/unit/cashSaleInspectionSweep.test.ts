// tests/unit/cashSaleInspectionSweep.test.ts
//
// The hourly cash-sale sweep's notices and staff flags (0088, 0089, 0095, 0132).
//
// WHAT THIS PINS. Two of the six steps flag a sale for staff by stamping a marker
// conditionally, `update({ col: now }).is(col, null)`, and then telling both members.
// When two passes overlap (a repeated cron delivery, or a manual trigger of the jobs
// route) only the pass whose stamp took effect may send those notices. Step 6 (ship-by,
// 0132) asked for the row back and checked it. Step 4 (return lapse, 0089) did not: a
// bare update answers `{ data: null, error: null }` whether it matched the row or not,
// so a pass that lost the race still sent "Return not posted" and "Return deadline
// passed" a second time and counted the sale twice (lapsed-sale-case-fix, Bug 3).
//
// Nothing in this sweep moves money, and every write it makes is one stamp column, so
// the preservation block pins that too.
//
// The admin client is the shared FakeAdmin. The six candidate reads are queued in the
// order the sweep runs them, and `respond` scripts each lapse stamp as WON, LOST or
// ERROR by sale id.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import {
  createFakeAdmin,
  type FakeAdmin,
  type QueuedResult,
  type RecordedCall,
} from './fakes/supabaseChain';

let admin: FakeAdmin;

interface Note {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

interface FailureLog {
  name: string;
  errorCode: string;
  message?: string;
  error?: unknown;
  context?: Record<string, unknown>;
}

const createNotification = vi.fn(async (_input: Note) => true);
const logBackgroundFailure = vi.fn(async (_input: FailureLog) => {});
const inspectionDeadlineWarning = vi.fn(async (_params: unknown) => {});
const returnDeadlineWarning = vi.fn(async (_params: unknown) => {});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin.client,
}));

vi.mock('@/lib/notifications/createNotification', () => ({
  createNotification: (input: Note) => createNotification(input),
}));

vi.mock('@/lib/email', () => ({
  emailNotify: {
    inspectionDeadlineWarning: (params: unknown) => inspectionDeadlineWarning(params),
    returnDeadlineWarning: (params: unknown) => returnDeadlineWarning(params),
  },
}));

vi.mock('@/lib/errors/errorLog', () => ({
  logBackgroundFailure: (input: FailureLog) => logBackgroundFailure(input),
}));

const { sweepCashSaleInspections } = await import('@/lib/trades/cashSaleInspectionSweep');

/** A candidate row, with only the columns the sweep reads. */
function sale(id: string) {
  return { id, buyer_id: `buyer-${id}`, seller_id: `seller-${id}` };
}

type SaleRow = ReturnType<typeof sale>;

const STEPS = [
  'completed',
  'inspectionClosing',
  'returnClosing',
  'returnLapsed',
  'shipSoon',
  'shipLapsed',
] as const;

type Step = (typeof STEPS)[number];

/** How one lapse stamp lands: it took effect, another pass beat it, or the write failed. */
type Stamp = { kind: 'WON' } | { kind: 'LOST' } | { kind: 'ERROR'; code?: string };

/** Answer each lapse stamp (`return_lapsed_at` or `ship_lapsed_at`) as scripted. */
function stamps(script: Record<string, Stamp>) {
  return (call: RecordedCall): QueuedResult | undefined => {
    if (call.table !== 'cash_sales' || call.op !== 'update') return undefined;
    const payload = call.payload as Record<string, unknown>;
    if (!('return_lapsed_at' in payload) && !('ship_lapsed_at' in payload)) return undefined;
    const stamp = script[String(call.match.id)];
    if (!stamp) return undefined;
    if (stamp.kind === 'WON') return { data: { id: call.match.id }, error: null };
    if (stamp.kind === 'LOST') return { data: null, error: null };
    return {
      data: null,
      error: stamp.code ? { message: 'write refused', code: stamp.code } : { message: 'write refused' },
    };
  };
}

/** One sweep pass over the given candidate rows, read in step order. */
function sweep(rows: Partial<Record<Step, SaleRow[]>>, script: Record<string, Stamp> = {}) {
  admin = createFakeAdmin({
    selects: { cash_sales: STEPS.map((step) => ({ data: rows[step] ?? [] })) },
    respond: stamps(script),
  });
  return sweepCashSaleInspections();
}

/** Every notice sent, as `recipient: title`, in order. */
function sent(): string[] {
  return createNotification.mock.calls.map(([note]) => `${note.userId}: ${note.title}`);
}

/** What one won return-lapse stamp sends: the seller first, then the buyer. */
function returnLapseNotices(id: string): string[] {
  return [
    `seller-${id}: Return not posted \u2014 we are reviewing it`,
    `buyer-${id}: Return deadline passed`,
  ];
}

/** The failures logged, reduced to what identifies them. */
function logged() {
  return logBackgroundFailure.mock.calls.map(([log]) => ({
    name: log.name,
    errorCode: log.errorCode,
    context: log.context,
  }));
}

const ERROR_CODE = fc.option(fc.constantFrom('23505', '40001', '57014'), { nil: undefined });

beforeEach(() => {
  createNotification.mockReset();
  createNotification.mockImplementation(async () => true);
  logBackgroundFailure.mockClear();
  inspectionDeadlineWarning.mockClear();
  returnDeadlineWarning.mockClear();
});

describe('Property 5: a lost return-lapse stamp is silent', () => {
  it('sends nothing and counts nothing when another pass stamped the return first', async () => {
    const result = await sweep({ returnLapsed: [sale('r1')] }, { r1: { kind: 'LOST' } });

    expect(sent()).toEqual([]);
    expect(result.returnLapsed).toBe(0);
    expect(logBackgroundFailure).not.toHaveBeenCalled();
  });

  it('asks for the stamped row back, which is what makes a lost race visible', async () => {
    await sweep({ returnLapsed: [sale('r1')] }, { r1: { kind: 'WON' } });

    const stamp = admin.writes.find(
      (write) => write.table === 'cash_sales' && 'return_lapsed_at' in (write.payload as object),
    );
    expect(stamp?.columns).toBe('id');
    expect(stamp?.match).toMatchObject({ id: 'r1' });
  });

  it('notifies and counts only the passes that won, whatever the mix', async () => {
    const outcome: fc.Arbitrary<Stamp> = fc.oneof(
      fc.constant<Stamp>({ kind: 'WON' }),
      fc.constant<Stamp>({ kind: 'LOST' }),
      ERROR_CODE.map((code): Stamp => (code ? { kind: 'ERROR', code } : { kind: 'ERROR' })),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(outcome, { minLength: 1, maxLength: 8 }), async (outcomes) => {
        createNotification.mockClear();
        logBackgroundFailure.mockClear();
        const ids = outcomes.map((_, index) => `r${index}`);

        const result = await sweep(
          { returnLapsed: ids.map(sale) },
          Object.fromEntries(ids.map((id, index) => [id, outcomes[index]])),
        );

        const won = ids.filter((_, index) => outcomes[index].kind === 'WON');
        expect(sent()).toEqual(won.flatMap(returnLapseNotices));
        expect(result.returnLapsed).toBe(won.length);
        expect(logged()).toEqual(
          outcomes.flatMap((stamp, index) =>
            stamp.kind === 'ERROR'
              ? [
                  {
                    name: 'cash-sale.return-lapse',
                    errorCode: stamp.code ?? 'UPDATE_ERROR',
                    context: { cashSaleId: ids[index] },
                  },
                ]
              : [],
          ),
        );
      }),
      { numRuns: 60 },
    );
  });
});

describe('Property 6: won stamps, failed writes and every other step behave as before', () => {
  it('runs every step once, with the same notices, emails and stamps', async () => {
    const result = await sweep(
      {
        completed: [sale('c1')],
        inspectionClosing: [sale('i1')],
        returnClosing: [sale('w1')],
        returnLapsed: [sale('r1')],
        shipSoon: [sale('s1')],
        shipLapsed: [sale('l1')],
      },
      { r1: { kind: 'WON' }, l1: { kind: 'WON' } },
    );

    expect(result).toEqual({
      completionNotified: 1,
      warned: 1,
      returnWarned: 1,
      returnLapsed: 1,
      shipWarned: 1,
      shipLapsed: 1,
    });
    expect(sent()).toEqual([
      'buyer-c1: Purchase completed automatically',
      'seller-c1: Sale completed \u2014 payout queued',
      'buyer-i1: Inspection window closing',
      'buyer-w1: Post your return within 24 hours',
      ...returnLapseNotices('r1'),
      'seller-s1: Post it within 24 hours',
      'seller-l1: Ship-by date passed',
      'buyer-l1: Your seller has not posted yet',
    ]);
    expect(inspectionDeadlineWarning).toHaveBeenCalledTimes(1);
    expect(returnDeadlineWarning).toHaveBeenCalledTimes(1);
    expect(logBackgroundFailure).not.toHaveBeenCalled();

    // NOTHING ELSE IS WRITTEN. Each write sets one stamp column, all to the pass's one
    // timestamp: no status changes, no refunds, no releases, and no marker cleared.
    const writes = admin.writes.filter((write) => write.table === 'cash_sales');
    expect(
      writes.map((write) => ({ id: write.match.id, columns: Object.keys(write.payload as object) })),
    ).toEqual([
      { id: 'i1', columns: ['inspection_warned_at'] },
      { id: 'w1', columns: ['return_warned_at'] },
      { id: 'r1', columns: ['return_lapsed_at'] },
      { id: 's1', columns: ['ship_warned_at'] },
      { id: 'l1', columns: ['ship_lapsed_at'] },
    ]);
    const stampedAt = new Set(writes.map((write) => Object.values(write.payload as object)[0]));
    expect(stampedAt.size).toBe(1);
    expect(admin.writes.every((write) => write.op === 'update')).toBe(true);
  });

  it('logs a failed return-lapse write with its code and sends nothing for it', async () => {
    const result = await sweep(
      { returnLapsed: [sale('r1'), sale('r2')] },
      { r1: { kind: 'ERROR', code: '40001' }, r2: { kind: 'ERROR' } },
    );

    expect(sent()).toEqual([]);
    expect(result.returnLapsed).toBe(0);
    expect(logged()).toEqual([
      { name: 'cash-sale.return-lapse', errorCode: '40001', context: { cashSaleId: 'r1' } },
      { name: 'cash-sale.return-lapse', errorCode: 'UPDATE_ERROR', context: { cashSaleId: 'r2' } },
    ]);
  });

  it('logs a notice that throws as THREW and carries on with the next row', async () => {
    createNotification.mockImplementationOnce(async () => {
      throw new Error('notifications are down');
    });

    const result = await sweep(
      { returnLapsed: [sale('r1'), sale('r2')] },
      { r1: { kind: 'WON' }, r2: { kind: 'WON' } },
    );

    expect(result.returnLapsed).toBe(1);
    expect(sent()).toEqual([returnLapseNotices('r1')[0], ...returnLapseNotices('r2')]);
    expect(logged()).toEqual([
      { name: 'cash-sale.return-lapse', errorCode: 'THREW', context: { cashSaleId: 'r1' } },
    ]);
  });

  it('keeps the ship-by flag silent on a lost stamp and logs a failed one', async () => {
    const result = await sweep(
      { shipLapsed: [sale('l1'), sale('l2'), sale('l3')] },
      { l1: { kind: 'LOST' }, l2: { kind: 'ERROR', code: '57014' }, l3: { kind: 'ERROR' } },
    );

    expect(sent()).toEqual([]);
    expect(result.shipLapsed).toBe(0);
    expect(logged()).toEqual([
      { name: 'cash-sale.ship-lapse', errorCode: '57014', context: { cashSaleId: 'l2' } },
      { name: 'cash-sale.ship-lapse', errorCode: 'UPDATE_ERROR', context: { cashSaleId: 'l3' } },
    ]);
  });

  it('notifies won stamps and logs failed writes in any mix without a lost race', async () => {
    const outcome: fc.Arbitrary<Stamp> = fc.oneof(
      fc.constant<Stamp>({ kind: 'WON' }),
      ERROR_CODE.map((code): Stamp => (code ? { kind: 'ERROR', code } : { kind: 'ERROR' })),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(outcome, { minLength: 1, maxLength: 8 }), async (outcomes) => {
        createNotification.mockClear();
        logBackgroundFailure.mockClear();
        const ids = outcomes.map((_, index) => `r${index}`);

        const result = await sweep(
          { returnLapsed: ids.map(sale) },
          Object.fromEntries(ids.map((id, index) => [id, outcomes[index]])),
        );

        const won = ids.filter((_, index) => outcomes[index].kind === 'WON');
        expect(sent()).toEqual(won.flatMap(returnLapseNotices));
        expect(result.returnLapsed).toBe(won.length);
        expect(logged().map((log) => log.context)).toEqual(
          ids.filter((_, index) => outcomes[index].kind === 'ERROR').map((id) => ({ cashSaleId: id })),
        );
      }),
      { numRuns: 60 },
    );
  });
});
