// tests/unit/createPrivateTradeItem.test.ts
//
// ESC-26: items are inserted only by the server (0136). A private-deal card stays
// UNGATED — identity is asked for where money or a hold moves, not to create an
// invite — so the fields that keep it out of the catalog are forced server-side, never
// read from input. A public listing still refuses an unverified member.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/cachedAuth', () => ({ getCachedAuthUser: async () => ({ id: 'member-1' }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/public', () => ({ publicCatalogClient: () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: 'item-1', ...row }, error: null }) }) };
      },
    }),
  }),
}));
vi.mock('@/lib/storage/itemImages', () => ({
  uploadImages: async (_admin: unknown, _user: string, images: unknown[]) =>
    images.map((_, i) => ({ path: `member-1/img-${i}.jpg`, width: 100, height: 100 })),
  removeImages: vi.fn(),
  verifyStoredImages: vi.fn(),
  ITEM_IMAGES_BUCKET: 'item-images',
}));
const readListingGate = vi.fn(async () => ({ ok: false, error: 'not-verified', message: 'Verify your identity first.' }));
vi.mock('@/lib/sellerListingGate', () => ({ readListingGate: () => readListingGate() }));
vi.mock('@/lib/location/resolveRegion', () => ({ resolveBrowseRegion: vi.fn() }));
vi.mock('@/domain/orchestrator/supabaseItemRepository', () => ({ createDefaultItemOrchestrator: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/errors/withActionLog', () => ({ withActionLog: (_n: string, fn: unknown) => fn }));

const hostile = {
  title: 'Charizard',
  description: 'Base set holo, light whitening on the back corners.',
  category: 'Pokémon',
  condition: 'Near Mint',
  fmvCents: 50_000,
  images: ['data:image/jpeg;base64,AAAA'],
  // Everything below is an attempt to publish a public, shopfront, sold listing as
  // someone else. None of it may reach the row.
  listingKind: 'SHOPFRONT',
  hidden: false,
  status: 'SOLD',
  ownerId: 'someone-else',
} as never;

beforeEach(() => {
  inserts.length = 0;
});

describe('createPrivateTradeItem (ESC-26)', () => {
  it('succeeds for an unverified member and forces the private fields', async () => {
    const { createPrivateTradeItem } = await import('@/lib/actions/listings');
    const result = await createPrivateTradeItem(hostile);
    expect(result.ok).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ owner_id: 'member-1', hidden: true, status: 'AVAILABLE', listing_kind: 'SINGLE' });
    expect(readListingGate).not.toHaveBeenCalled();
  });
});

describe('createItem (ESC-26)', () => {
  it('still refuses an unverified member before inserting anything', async () => {
    const { createItem } = await import('@/lib/actions/listings');
    const result = await createItem(hostile);
    expect(result.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});
