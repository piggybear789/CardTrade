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
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import type { Tables } from '@/lib/supabase/database.types';
import type { CatalogItem, CatalogSeller } from '@/lib/actions/listings';
import { friendlyWriteFailure } from '@/lib/actions/writeFailure';

/** A persisted watchlist row. */
export type WatchlistRow = Tables<'watchlist'>;

/** A failed action result carrying a typed error code and optional detail. */
export interface ActionFailure<E extends string> {
  ok: false;
  error: E;
  detail?: string;
}

/**
 * Resolve the current authenticated user id, or `null`.
 *
 * Reads through the request-cached lookup rather than `client.auth.getUser()`.
 * `getUser` revalidates the JWT against the auth server on every call, and a
 * single page render reaches this helper from the page body, the shell, and
 * sibling actions — previously one network round trip each.
 */
async function getUserId(): Promise<string | null> {
  const user = await getCachedAuthUser();
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

  const me = await getUserId();
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
      return {
        ok: false,
        error: 'persistence-error',
        detail: friendlyWriteFailure(error, 'Failed to update watchlist'),
      };
    }
    return { ok: true, watching: false };
  }

  const { error } = await supabase
    .from('watchlist')
    .insert({ user_id: me, item_id: itemId });
  if (error) {
    return {
      ok: false,
      error: 'persistence-error',
      detail: friendlyWriteFailure(error, 'Failed to update watchlist'),
    };
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

  const me = await getUserId();
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
// getWatchCount
// ---------------------------------------------------------------------------

/**
 * The number of users who have saved `itemId`. Returns `0` on any read error so
 * server components can call it without try/catch.
 *
 * THIS READS THE DENORMALISED COUNTER ON `items`, NOT A COUNT OVER `watchlist`.
 * The previous implementation counted `watchlist` rows and documented that "a plain
 * `count` aggregate does not expose any row contents and is permitted, so this
 * reflects the true total across all users". That is not how RLS works: the policy
 * `watchlist_owner_all` is `for all using (user_id = auth.uid())`, and Postgres
 * applies it BEFORE aggregation, so the count only ever included rows the caller
 * could already see. Probed against the live database as a member who was not the
 * watcher, the old query returned 0 on an item whose real count was 1 — so the
 * listing page showed "no saves" on every listing except ones the viewer had saved
 * themselves, and the figure was silently self-referential rather than social.
 *
 * `items.watch_count` (0097) is maintained by a trigger on `watchlist` and is granted
 * to `authenticated` and `anon`, which is what makes a public total both correct and
 * readable without weakening the row policy.
 */
export async function getWatchCount(itemId: string): Promise<number> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('items')
    .select('watch_count')
    .eq('id', itemId)
    .maybeSingle();

  if (error || data?.watch_count == null) return 0;
  return data.watch_count;
}

/**
 * Resolve which of the given item ids the current user is watching. Returns an
 * empty set when unauthenticated or on any read error. Used to decorate catalog
 * cards with a save affordance without an extra per-card query.
 */
export async function getWatchingSet(itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const watching = await getMyWatchingSet();
  return new Set(itemIds.filter((id) => watching.has(id)));
}

/** Every listing the caller has saved. Safe to start before catalog IDs exist. */
export async function getMyWatchingSet(): Promise<Set<string>> {
  const supabase = await createClient();
  const me = await getUserId();
  if (!me) return new Set();

  const { data } = await supabase
    .from('watchlist')
    .select('item_id')
    .eq('user_id', me);

  return new Set((data ?? []).map((r) => r.item_id as string));
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

  const me = await getUserId();
  if (!me) return { ok: false, error: 'unauthenticated' };

  // ONE QUERY FOR THE SAVED ROWS AND THEIR ITEMS. This was two: read the
  // watchlist, collect the ids, then read the items. The second could not start
  // until the first landed, so /saved paid a round trip for a join Postgres can
  // do itself — `watchlist_item_id_fkey` is what lets PostgREST embed here.
  //
  // `!inner` preserves the previous behaviour: a saved row whose item RLS no
  // longer exposes drops out of the results rather than rendering empty.
  const { data: rows, error } = await supabase
    .from('watchlist')
    .select('item_id, created_at, items!inner(*)')
    .eq('user_id', me)
    .order('created_at', { ascending: false });

  if (error) {
    return {
      ok: false,
      error: 'persistence-error',
      detail: friendlyWriteFailure(error, 'Failed to load watchlist'),
    };
  }

  const watchRows = (rows ?? []) as unknown as {
    item_id: string;
    created_at: string;
    items: Tables<'items'>;
  }[];

  const savedAtByItem = new Map<string, string>(
    watchRows.map((r) => [r.item_id, r.created_at]),
  );
  const items = watchRows.map((r) => r.items);

  if (items.length === 0) {
    return { ok: true, items: [] };
  }

  // Enrich with each item's seller public profile (display name + rating).
  const ownerIds = Array.from(new Set(items.map((i) => i.owner_id)));
  const { data: sellersData } = await supabase
    .from('public_profiles')
    .select(
      'id, display_name, rating, rating_count, is_verified, identity_first_name, avatar_path',
    )
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
        identityFirstName: (s.identity_first_name as string | null) ?? null,
        avatarPath: (s.avatar_path as string | null) ?? null,
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
