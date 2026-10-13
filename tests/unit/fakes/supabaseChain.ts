// tests/unit/fakes/supabaseChain.ts
//
// A minimal stand-in for the Supabase admin client, for the modules that talk to it
// directly instead of through a repository: the job sweeps, the fee drain, the webhook
// pipeline and the arbitration queue.
//
// WHY THIS IS NEEDED AT ALL. Most of `domain/` takes a repository interface, so tests
// inject a fake and never see a query builder. `lib/trades/inspectionSweep.ts` and
// `lib/actions/tradeFees.ts` predate that discipline and build their queries inline — and
// they are the ONLY code that moves money unattended, on a schedule, with nobody
// watching. Leaving them untested because they are awkward to test is the wrong trade.
//
// It supports exactly the chain shapes those modules use and nothing more. If a new
// call shape appears, the test fails loudly on an unqueued result rather than silently
// resolving to nothing — a fake that invents an empty result set would make a sweep that
// processes zero rows look healthy.
//
// SCRIPTED ANSWERS. `respond` sees each awaited chain as a `RecordedCall` (its table,
// operation, `.select()` columns and `.eq()` filters) and may answer it. That is how a
// test represents a WON conditional stamp, `update(...).is(col, null).select().maybeSingle()`
// returning the row, against a LOST one that matches nothing and reports no error. It is
// also how a test routes reads by what they ask for rather than by the order they happen
// to run in. A call `respond` leaves alone falls through to the queues, unchanged.

/** One awaited outcome: PostgREST always answers `{ data, error }`, or `{ count, error }`. */
export interface QueuedResult {
  data?: unknown;
  count?: number;
  error?: { message: string; code?: string } | null;
}

/** One awaited chain, as the fake saw it. */
export interface RecordedCall {
  table: string;
  op: 'select' | 'update' | 'insert' | 'upsert' | 'delete';
  /**
   * The argument to `.select()`, `'*'` for a bare call, or null when it was not called.
   * On a write, a non-null value is PostgREST's "return the row" form.
   */
  columns: string | null;
  /** `.eq(column, value)` pairs, so a test can tell calls apart. Recorded, never enforced. */
  match: Readonly<Record<string, unknown>>;
  payload: unknown;
}

export interface RecordedWrite extends RecordedCall {
  op: 'update' | 'insert' | 'upsert' | 'delete';
}

export interface FakeAdminConfig {
  /**
   * Results for `.select()` chains, queued per table and consumed in order. A table that
   * runs out of queued results throws, because the alternative is a test that passes by
   * accident.
   */
  selects?: Record<string, QueuedResult[]>;
  /**
   * Fallback per table, used once its queue is empty.
   *
   * For the repeated bookkeeping reads inside a loop — "read this row's attempt count",
   * once per row — where queueing one result per iteration would say nothing and make a
   * batch-size test unreadable. Deliberately opt-in per table: a table with no default
   * still throws when its queue runs dry, which is what keeps the fake honest.
   */
  defaults?: Record<string, QueuedResult>;
  /** Tables whose write should throw, to exercise per-row error isolation. */
  throwOnWrite?: (write: RecordedWrite) => boolean;
  /**
   * A scripted answer, consulted before anything else. Return `undefined` to fall
   * through to the default behaviour: the select queue, then the table default (which
   * still throws when both are empty), or `{ data: null, error: null }` for a write.
   */
  respond?: (call: RecordedCall) => QueuedResult | undefined;
}

export interface FakeAdmin {
  client: { from: (table: string) => unknown };
  writes: RecordedWrite[];
  /** Every table+op pair awaited, in order, for asserting call sequences. */
  calls: string[];
}

/** Chainable, awaitable query builder covering the subset these modules use. */
class FakeBuilder implements PromiseLike<QueuedResult> {
  private op: RecordedCall['op'] = 'select';
  private payload: unknown = null;
  private columns: string | null = null;
  private readonly match: Record<string, unknown> = {};

  constructor(
    private readonly table: string,
    private readonly config: FakeAdminConfig,
    private readonly writes: RecordedWrite[],
    private readonly calls: string[],
  ) {}

  select(columns?: string): this {
    // `.select()` after a write is PostgREST's "return the row" form, so it must not
    // reclassify the operation. The column list is recorded either way.
    this.columns = columns ?? '*';
    return this;
  }

  update(payload: unknown): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }

  insert(payload: unknown): this {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }

  upsert(payload: unknown): this {
    this.op = 'upsert';
    this.payload = payload;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  // Filters and modifiers are all no-ops that keep the chain going. The fake asserts on
  // what was WRITTEN and how many rows came back, not on how the query was narrowed —
  // pinning filter arguments here would make it a test of PostgREST's builder. `.eq()`
  // is the one exception, and only as a RECORD: a `respond` script reads it to tell one
  // row's stamp from another's, and nothing here filters by it.
  eq(column?: string, value?: unknown): this {
    if (column !== undefined) this.match[column] = value;
    return this;
  }
  neq(): this {
    return this;
  }
  in(): this {
    return this;
  }
  is(): this {
    return this;
  }
  not(): this {
    return this;
  }
  lt(): this {
    return this;
  }
  lte(): this {
    return this;
  }
  gt(): this {
    return this;
  }
  gte(): this {
    return this;
  }
  or(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  maybeSingle(): this {
    return this;
  }
  single(): this {
    return this;
  }

  private resolve(): QueuedResult {
    this.calls.push(`${this.table}:${this.op}`);

    if (this.op === 'select') {
      const scripted = this.config.respond?.(this.recorded());
      if (scripted !== undefined) return scripted;

      const queue = this.config.selects?.[this.table];
      if (queue && queue.length > 0) return queue.shift() as QueuedResult;

      const fallback = this.config.defaults?.[this.table];
      if (fallback) return fallback;

      throw new Error(
        `FakeAdmin: no queued select result for "${this.table}". ` +
          'Queue one (or set a default), or the test would pass on an empty result set ' +
          'it never intended.',
      );
    }

    const write: RecordedWrite = { ...this.recorded(), op: this.op };
    if (this.config.throwOnWrite?.(write)) {
      throw new Error(`FakeAdmin: simulated failure writing ${this.table}`);
    }
    this.writes.push(write);
    return this.config.respond?.(write) ?? { data: null, error: null };
  }

  /** This chain as a `RecordedCall`, for `respond` and the write log. */
  private recorded(): RecordedCall {
    return {
      table: this.table,
      op: this.op,
      columns: this.columns,
      match: { ...this.match },
      payload: this.payload,
    };
  }

  then<TResult1 = QueuedResult, TResult2 = never>(
    onfulfilled?: ((value: QueuedResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let settled: Promise<QueuedResult>;
    try {
      settled = Promise.resolve(this.resolve());
    } catch (err) {
      settled = Promise.reject(err);
    }
    return settled.then(onfulfilled, onrejected);
  }
}

/** Build a fake admin client plus the recorders a test asserts against. */
export function createFakeAdmin(config: FakeAdminConfig = {}): FakeAdmin {
  const writes: RecordedWrite[] = [];
  const calls: string[] = [];
  return {
    client: {
      from: (table: string) => new FakeBuilder(table, config, writes, calls),
    },
    writes,
    calls,
  };
}
