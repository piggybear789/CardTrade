'use server';

// lib/actions/watchlist.ts
//
// Server Actions for the buyer's WATCHLIST (saved items, Phase 4). These are
// THIN wrappers that authenticate the caller and operate through the
// cookie-bound Supabase client so RLS enforces the owner-only access rules on
// the `watchlist` table end-to-end (a user may only see/modify their own saved
// rows). The composite primary key is (user_id, item_id), so a save is a single
// row per user per item.
//
// Money is integer AUD cents end-to-end (`fmv_cents`); the UI formats via
// `formatAud`. Every export is an async Server Action; shared shapes are
// `export type` only (type exports are erased and permitted in a 'use server'
// module).

import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/lib/supabase/database.types';
import type { CatalogItem, CatalogSeller } from '@/lib/actions/listings';

/** A persisted watchlist row. */
export type WatchlistRow = Tables<'watchlist'>;

/** A failed action result carrying a typed error code and optional detail. */
export interface ActionFailure<E extends string> {
  ok: false;
  error: E;
  detail?: string;
}

/** Resolve the current authenticated user id, or `null`. */
async function getUserId(
  client: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

// ---------------------------------------------------------------------------
// toggleWatch
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link toggleWatch}. */
export type ToggleWatchError = 'unauthenticated' | 'persistence-error';

/** Result of {@link toggleWatch}: reflects the new watching state. */
export type ToggleWatchResult =
  | { ok: true; watching: boolean }
  | ActionFailure<ToggleWatchError>;

/**
 * Toggle whether the caller is watching `itemId`. If a row already exists for
 * (me, item) it is deleted (returns `watching: false`); otherwise a row is
 * inserted (returns `watching: true`). Authentication is required; RLS scopes
 * every read/write to the caller's own rows.
 */
export async function toggleWatch(itemId: string): Promise<ToggleWatchResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  // Is the item already saved by this user?
  const { data: existing } = await supabase
    .from('watchlist')
    .select('item_id')
    .eq('user_id', me)
    .eq('item_id', itemId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('watchlist')
      .delete()
      .eq('user_id', me)
      .eq('item_id', itemId);
    if (error) {
      return { ok: false, error: 'persistence-error', detail: error.message };
    }
    return { ok: true, watching: false };
  }

  const { error } = await supabase
    .from('watchlist')
    .insert({ user_id: me, item_id: itemId });
  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }
  return { ok: true, watching: true };
}

// ---------------------------------------------------------------------------
// isWatching
// ---------------------------------------------------------------------------

/**
 * Whether the current user is watching `itemId`. Returns `false` when the caller
 * is unauthenticated or on any read error, so server components can call this
 * without try/catch to decide the initial toggle state.
 */
export async function isWatching(itemId: string): Promise<boolean> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return false;

  const { data } = await supabase
    .from('watchlist')
    .select('item_id')
    .eq('user_id', me)
    .eq('item_id', itemId)
    .maybeSingle();

  return Boolean(data);
}

// ---------------------------------------------------------------------------
// listMyWatchlist
// ---------------------------------------------------------------------------

/** Errors surfaced by {@link listMyWatchlist}. */
export type ListWatchlistError = 'unauthenticated' | 'persistence-error';

/** A saved item, enriched to a catalog-like entry so it renders with ItemCard. */
export type WatchlistEntry = CatalogItem & {
  /** ISO timestamp of when the caller saved the item (newest first). */
  savedAt: string;
};

/** Result of {@link listMyWatchlist}. */
export type ListMyWatchlistResult =
  | { ok: true; items: WatchlistEntry[] }
  | ActionFailure<ListWatchlistError>;

/**
 * List the caller's saved items, newest-saved first, joined to the item data
 * (title, fmv_cents, image_paths, status) and enriched with the seller's public
 * display name + rating (via `public_profiles`). Entries are catalog-shaped so
 * the existing {@link ItemCard} can render them directly.
 *
 * RLS scopes the `watchlist` read to the caller's own rows. Items are read via
 * the cookie-bound client too, so an item that is no longer visible under RLS
 * is simply dropped from the results.
 */
export async function listMyWatchlist(): Promise<ListMyWatchlistResult> {
  const supabase = await createClient();

  const me = await getUserId(supabase);
  if (!me) return { ok: false, error: 'unauthenticated' };

  const { data: rows, error } = await supabase
    .from('watchlist')
    .select('item_id, created_at')
    .eq('user_id', me)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, error: 'persistence-error', detail: error.message };
  }

  const watchRows = (rows ?? []) as Pick<WatchlistRow, 'item_id' | 'created_at'>[];
  if (watchRows.length === 0) {
    return { ok: true, items: [] };
  }

  const itemIds = watchRows.map((r) => r.item_id);
  const savedAtByItem = new Map<string, string>(
    watchRows.map((r) => [r.item_id, r.created_at]),
  );

  // Load the underlying items (RLS returns those still visible to the caller).
  const { data: itemsData } = await supabase
    .from('items')
    .select('*')
    .in('id', itemIds);

  const items = (itemsData ?? []) as Tables<'items'>[];
  if (items.length === 0) {
    return { ok: true, items: [] };
  }

  // Enrich with each item's seller public profile (display name + rating).
  const ownerIds = Array.from(new Set(items.map((i) => i.owner_id)));
  const { data: sellersData } = await supabase
    .from('public_profiles')
    .select('id, display_name, rating, rating_count, is_verified')
    .in('id', ownerIds);

  const sellerById = new Map<string, CatalogSeller>(
    (sellersData ?? []).map((s) => [
      s.id as string,
      {
        id: s.id as string,
        displayName: (s.display_name as string | null) ?? null,
        rating: (s.rating as number | null) ?? null,
        ratingCount: (s.rating_count as number | null) ?? 0,
        isVerified: Boolean(s.is_verified),
      },
    ]),
  );

  const entries: WatchlistEntry[] = items
    .map((item) => ({
      ...item,
      seller: sellerById.get(item.owner_id) ?? null,
      savedAt: savedAtByItem.get(item.id) ?? item.created_at,
    }))
    // Preserve newest-saved-first ordering (the `items` query does not order).
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));

  return { ok: true, items: entries };
}
