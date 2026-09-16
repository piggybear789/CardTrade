// tests/unit/addressesAction.test.ts
//
// The saved-address book actions (0113). What is worth pinning about these thin
// actions is exactly the part that is NOT the database's job:
//
//   1. Ownership comes from the SESSION, never from an argument. Every export is an
//      attacker-reachable endpoint, so an unauthenticated call must refuse before it
//      touches the table, and every write must be filtered to `owner_id = user.id`
//      (belt-and-braces on top of RLS).
//   2. A place that is not provider-resolved (`text:`/`legacy:` id, or missing
//      coordinates) is refused before it is persisted — the same rule that guards a
//      contract's delivery address.
//   3. An over-length label is refused.
//   4. Setting a default demotes the previous default first, so the
//      one-default-per-owner index cannot be violated.
//
// The persistence itself and RLS are covered by the migration + the DB project; this
// file does not re-assert them.

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The user the mocked cookie-bound client reports, or null for no session. */
let sessionUser: { id: string } | null = null;

/** Every builder call, in order, so ownership filters and sequencing can be asserted. */
interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  filters: Array<{ column: string; value: unknown }>;
  payload?: unknown;
}
let calls: RecordedCall[] = [];

/** Queued results keyed by `${table}:${op}`, consumed in order. */
let results: Record<string, Array<{ data: unknown; error: unknown }>> = {};

function nextResult(key: string): { data: unknown; error: unknown } {
  const queue = results[key];
  if (queue && queue.length > 0) return queue.shift()!;
  return { data: null, error: null };
}

class Builder {
  private call: RecordedCall;
  constructor(private readonly table: string) {
    this.call = { table, op: 'select', filters: [], payload: undefined };
  }
  select() {
    return this;
  }
  insert(payload: unknown) {
    this.call.op = 'insert';
    this.call.payload = payload;
    return this;
  }
  update(payload: unknown) {
    this.call.op = 'update';
    this.call.payload = payload;
    return this;
  }
  delete() {
    this.call.op = 'delete';
    return this;
  }
  eq(column: string, value: unknown) {
    this.call.filters.push({ column, value });
    return this;
  }
  order() {
    return this;
  }
  private settle() {
    calls.push(this.call);
    return nextResult(`${this.table}:${this.call.op}`);
  }
  single() {
    return Promise.resolve(this.settle());
  }
  maybeSingle() {
    return Promise.resolve(this.settle());
  }
  then(onfulfilled: (v: { data: unknown; error: unknown }) => unknown) {
    return Promise.resolve(this.settle()).then(onfulfilled);
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser }, error: null }) },
    from: (table: string) => new Builder(table),
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { listMyAddresses, saveAddress, deleteAddress, setDefaultAddress } = await import(
  '@/lib/actions/addresses'
);

const MEMBER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const RESOLVED_PLACE = {
  label: '1 Test St, Fitzroy VIC 3065',
  placeId: 'ChIJresolved123',
  countryCode: 'AU',
  lat: -37.8,
  lng: 144.97,
};

beforeEach(() => {
  sessionUser = { id: MEMBER };
  calls = [];
  results = {};
});

function ownerFilters(call: RecordedCall) {
  return call.filters.filter((f) => f.column === 'owner_id').map((f) => f.value);
}

describe('listMyAddresses', () => {
  it('lists only the caller-owned rows, scoped by session id', async () => {
    results['member_addresses:select'] = [
      {
        data: [
          {
            id: 'a1',
            label: 'Home',
            address_label: RESOLVED_PLACE.label,
            place_id: RESOLVED_PLACE.placeId,
            country_code: 'AU',
            latitude: -37.8,
            longitude: 144.97,
            is_default: true,
          },
        ],
        error: null,
      },
    ];

    const result = await listMyAddresses();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ id: 'a1', label: 'Home', isDefault: true });
    }
    // The read was filtered to the SESSION id, never an argument.
    expect(ownerFilters(calls[0])).toEqual([MEMBER]);
  });

  it('refuses an unauthenticated caller without touching the table', async () => {
    sessionUser = null;
    const result = await listMyAddresses();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('not-authenticated');
    expect(calls).toHaveLength(0);
  });
});

describe('saveAddress', () => {
  it('creates a new address owned by the session id', async () => {
    results['member_addresses:insert'] = [
      {
        data: {
          id: 'new1',
          label: 'Home',
          address_label: RESOLVED_PLACE.label,
          place_id: RESOLVED_PLACE.placeId,
          country_code: 'AU',
          latitude: -37.8,
          longitude: 144.97,
          is_default: false,
        },
        error: null,
      },
    ];

    const result = await saveAddress({ label: 'Home', place: RESOLVED_PLACE });

    expect(result.ok).toBe(true);
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert).toBeTruthy();
    // The stored owner is the session id, never anything the caller could name.
    expect((insert!.payload as { owner_id: string }).owner_id).toBe(MEMBER);
  });

  it('rejects an unresolved (text:) place before persisting', async () => {
    const result = await saveAddress({
      place: { ...RESOLVED_PLACE, placeId: 'text:1 Test St' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('validation-error');
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('rejects a legacy: place before persisting', async () => {
    const result = await saveAddress({
      place: { ...RESOLVED_PLACE, placeId: 'legacy:abc' },
    });
    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('rejects a place with missing coordinates', async () => {
    const result = await saveAddress({
      place: { ...RESOLVED_PLACE, lat: null, lng: null },
    });
    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('rejects an over-length label', async () => {
    const result = await saveAddress({ label: 'x'.repeat(121), place: RESOLVED_PLACE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('validation-error');
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('scopes an update to both the id and the owner id', async () => {
    results['member_addresses:update'] = [
      {
        data: {
          id: 'a1',
          label: 'Work',
          address_label: RESOLVED_PLACE.label,
          place_id: RESOLVED_PLACE.placeId,
          country_code: 'AU',
          latitude: -37.8,
          longitude: 144.97,
          is_default: false,
        },
        error: null,
      },
    ];

    const result = await saveAddress({ id: 'a1', label: 'Work', place: RESOLVED_PLACE });

    expect(result.ok).toBe(true);
    const update = calls.find((c) => c.op === 'update')!;
    const cols = update.filters.map((f) => f.column);
    expect(cols).toContain('id');
    expect(cols).toContain('owner_id');
    expect(ownerFilters(update)).toEqual([MEMBER]);
  });

  it('demotes the previous default before creating a new default', async () => {
    results['member_addresses:insert'] = [
      {
        data: {
          id: 'new1',
          label: null,
          address_label: RESOLVED_PLACE.label,
          place_id: RESOLVED_PLACE.placeId,
          country_code: 'AU',
          latitude: -37.8,
          longitude: 144.97,
          is_default: true,
        },
        error: null,
      },
    ];

    await saveAddress({ place: RESOLVED_PLACE, isDefault: true });

    // The demote update runs before the insert, and is scoped to the caller.
    const demote = calls.find((c) => c.op === 'update');
    expect(demote).toBeTruthy();
    expect((demote!.payload as { is_default: boolean }).is_default).toBe(false);
    expect(ownerFilters(demote!)).toEqual([MEMBER]);
    expect(calls.indexOf(demote!)).toBeLessThan(calls.findIndex((c) => c.op === 'insert'));
  });

  it('refuses an unauthenticated caller without touching the table', async () => {
    sessionUser = null;
    const result = await saveAddress({ place: RESOLVED_PLACE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('not-authenticated');
    expect(calls).toHaveLength(0);
  });
});

describe('deleteAddress', () => {
  it('deletes scoped to the id and the session owner id', async () => {
    const result = await deleteAddress('a1');
    expect(result.ok).toBe(true);
    const del = calls.find((c) => c.op === 'delete')!;
    expect(del.filters.map((f) => f.column)).toEqual(expect.arrayContaining(['id', 'owner_id']));
    expect(ownerFilters(del)).toEqual([MEMBER]);
  });

  it('refuses an unauthenticated caller', async () => {
    sessionUser = null;
    const result = await deleteAddress('a1');
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('rejects a blank id', async () => {
    const result = await deleteAddress('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('validation-error');
    expect(calls).toHaveLength(0);
  });
});

describe('setDefaultAddress', () => {
  it('demotes the current default then promotes the target, both owner-scoped', async () => {
    results['member_addresses:update'] = [
      { data: null, error: null }, // demote
      { data: { id: 'a2' }, error: null }, // promote
    ];

    const result = await setDefaultAddress('a2');

    expect(result.ok).toBe(true);
    const updates = calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(2);
    // Demote first, promote second.
    expect((updates[0].payload as { is_default: boolean }).is_default).toBe(false);
    expect((updates[1].payload as { is_default: boolean }).is_default).toBe(true);
    // Both scoped to the caller.
    expect(ownerFilters(updates[0])).toEqual([MEMBER]);
    expect(ownerFilters(updates[1])).toEqual([MEMBER]);
    // The promote targets the requested id.
    expect(updates[1].filters.some((f) => f.column === 'id' && f.value === 'a2')).toBe(true);
  });

  it('reports not-found when the target is not the caller-owned row', async () => {
    results['member_addresses:update'] = [
      { data: null, error: null }, // demote
      { data: null, error: null }, // promote matched nothing (e.g. someone else's id)
    ];

    const result = await setDefaultAddress(OTHER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('not-found');
  });

  it('refuses an unauthenticated caller', async () => {
    sessionUser = null;
    const result = await setDefaultAddress('a2');
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
