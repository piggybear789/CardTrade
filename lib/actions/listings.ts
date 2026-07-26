'use server';

// lib/actions/listings.ts
//
// Server Actions for collectible Item listings (Req 3): create, update, delete,
// and catalog reads. These are THIN wrappers that combine authentication + the
// VERIFIED gate + Storage image upload + the pure validation/orchestration core.
//
// - Owner authorization is enforced twice over: RLS on the cookie-bound client
//   (owner_id = auth.uid()) AND the item orchestrator's owner guard.
// - Image uploads go to the `item-images` Storage bucket via the service-role
//   admin client (created on demand). Object paths are stored in `image_paths`.
// - Money is integer AUD cents end-to-end (`fmvCents` -> `fmv_cents`).
//
// Every export is an async Server Action; shared shapes are `export type` only
// (type exports are erased and permitted in a 'use server' module).

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createDefaultItemOrchestrator } from '@/domain/orchestrator/supabaseItemRepository';
import {
  validateItemSubmission,
  IMAGES_MIN,
  IMAGES_MAX,
} from '@/domain/validation';
import {
  removeImages,
  uploadImages,
  type ImageUpload,
} from '@/lib/storage/itemImages';
import { loadSellerIdentityDisclosure } from '@/lib/sellerIdentity';
import type { Tables } from '@/lib/supabase/database.types';

/** A persisted item row as returned to callers. */
export type ItemRow = Tables<'items'>;

/**
 * An image supplied to create/update. Either raw binary (`Blob`/`File`) or a
 * base64 payload (optionally a `data:` URL). During an update, a plain `string`
 * is treated as an already-stored object path and passed through unchanged.
 */
export type { ImageUpload };

/** Fields accepted when creating an Item (images are uploaded, then validated). */
export interface CreateItemInput {
  title: string;
  description: string;
  category: string;
  condition: string;
  fmvCents: number;
  images: ImageUpload[];
}

/** Fields accepted when updating an Item. Images may mix kept paths + new uploads. */
export interface UpdateItemInput {
  title: string;
  description: string;
  category: string;
  condition: string;
  fmvCents: number;
  images: (string | ImageUpload)[];
}

/** Discriminated result returned by every listing action. */
export type ListingActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** Machine-readable error code (see below). */
      error: ListingActionError;
      /** For `validation-error`: the offending field. */
      field?: string;
      /** Human-readable detail for surfacing inline. */
      message?: string;
    };

/**
 * Listing action error codes.
 * - `not-authenticated` — no signed-in user.
 * - `not-verified`      — the caller is not VERIFIED (provider-approved Managed
 *   Merchant with settlements enabled). Blocks listing and trade-item creation
 *   entirely; never returned on the buy/trade paths.
 * - `seller-not-verified` — reserved; unused. Retained so existing error
 *   mapping stays exhaustive.
 * - `validation-error`  — the submission failed schema validation (Req 3.2, 3.3).
 * - `upload-failed`     — an image failed to upload to Storage.
 * - `not-found`         — the target Item does not exist (or is not visible).
 * - `unauthorized`      — the caller does not own the target Item (Req 3.7).
 * - `item-not-available`— the Item is not AVAILABLE and cannot be modified (Req 3.5).
 * - `fmv-immutable`     — the Item is RESERVED; its FMV cannot change (Req 3.6).
 * - `persistence-error` — the database insert/delete failed.
 */
export type ListingActionError =
  | 'not-authenticated'
  | 'not-verified'
  | 'seller-not-verified'
  | 'validation-error'
  | 'upload-failed'
  | 'not-found'
  | 'unauthorized'
  | 'item-not-available'
  | 'fmv-immutable'
  | 'persistence-error';

/** Resolve the current authenticated user id, or `null`. */
async function getUserId(
  client: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

/**
 * Read whether a profile is bond-exempt: provider-approved Managed Merchant
 * onboarding with settlements enabled (used by the VERIFIED gate, Req 2.4).
 * Reads the `public_profiles` view rather than `profiles` directly so this
 * stays readable under the caller's own RLS session.
 */
async function isVerified(
  client: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const { data } = await client
    .from('public_profiles')
    .select('is_verified')
    .eq('id', userId)
    .maybeSingle();
  return Boolean(data?.is_verified);
}

/**
 * Create an Item (Req 3.1, 3.2, 3.3).
 *
 * Requires an authenticated, VERIFIED user. Verification is provider-approved
 * Managed Merchant onboarding (`merchant_status = APPROVED` with settlements
 * enabled) — listing is blocked entirely without it, unlike buying/trading,
 * which never gate on verification (unverified traders bond collateral
 * instead, per Req 5.4). Validates the submission (uploading images first,
 * then validating the resulting object paths), inserts the Item with
 * `owner_id = caller` and status AVAILABLE via the cookie-bound client (RLS
 * re-checks ownership). Returns field-level validation errors.
 */
export async function createItem(
  input: CreateItemInput,
): Promise<ListingActionResult<ItemRow>> {
  const supabase = await createClient();

  const userId = await getUserId(supabase);
  if (!userId) {
    return { ok: false, error: 'not-authenticated' };
  }

  // VERIFICATION GATE: listing requires an approved Managed Merchant, full
  // stop. This is stricter than the Trade/Cash_Sale paths, which never block on
  // verification — only listing does.
  const verified = await isVerified(supabase, userId);
  if (!verified) {
    return {
      ok: false,
      error: 'not-verified',
      message: 'Verify your identity before listing an item.',
    };
  }

  // Guard the image count before any upload work (Req 3.3) so we never upload
  // an out-of-range batch. Field-level validation of the rest happens below.
  const imageCount = Array.isArray(input.images) ? input.images.length : 0;
  if (imageCount < IMAGES_MIN || imageCount > IMAGES_MAX) {
    return {
      ok: false,
      error: 'validation-error',
      field: 'images',
      message: `Between ${IMAGES_MIN} and ${IMAGES_MAX} images are required`,
    };
  }

  // Pre-validate the text/number fields using placeholder image paths so an
  // invalid title/description/category/condition/fmv is caught before upload.
  const preValidation = validateItemSubmission({
    title: input.title,
    description: input.description,
    category: input.category,
    condition: input.condition,
    fmvCents: input.fmvCents,
    images: Array.from({ length: imageCount }, (_, i) => `pending-${i}`),
  });
  if (!preValidation.ok) {
    return {
      ok: false,
      error: 'validation-error',
      field: preValidation.field,
      message: preValidation.message,
    };
  }

  // Upload images to Storage and collect their object paths.
  const admin = createAdminClient();
  let imagePaths: string[];
  try {
    imagePaths = await uploadImages(admin, userId, input.images);
  } catch (e) {
    return {
      ok: false,
      error: 'upload-failed',
      message: e instanceof Error ? e.message : 'Image upload failed',
    };
  }

  // Final validation over the real submission (with uploaded paths).
  const validated = validateItemSubmission({
    title: input.title,
    description: input.description,
    category: input.category,
    condition: input.condition,
    fmvCents: input.fmvCents,
    images: imagePaths,
  });
  if (!validated.ok) {
    await removeImages(admin, imagePaths);
    return {
      ok: false,
      error: 'validation-error',
      field: validated.field,
      message: validated.message,
    };
  }

  // Insert via the cookie-bound client so RLS enforces owner_id = auth.uid().
  const { data, error } = await supabase
    .from('items')
    .insert({
      owner_id: userId,
      title: validated.value.title,
      description: validated.value.description,
      category: validated.value.category,
      condition: validated.value.condition,
      fmv_cents: validated.value.fmvCents,
      image_paths: validated.value.images,
      status: 'AVAILABLE',
    })
    .select('*')
    .single();

  if (error || !data) {
    await removeImages(admin, imagePaths);
    return {
      ok: false,
      error: 'persistence-error',
      message: error?.message ?? 'Failed to create item',
    };
  }

  return { ok: true, data: data as ItemRow };
}

/**
 * Create a privately offered trade Item (`hidden = true`).
 *
 * Used by the Trade_Proposal flow so a Trader can put up a collectible without
 * publishing it to the catalog. The Item is owned, valued, and inspectable by
 * the Counterpart of a proposal it is attached to, but never appears in catalog
 * search or facets, and is never republished.
 *
 * Two deliberate differences from {@link createItem}:
 *  - No Seller identity disclosure gate. That gate exists so every *published*
 *    listing has a payable legal seller (Req 3.9); a trade swaps goods for goods
 *    and moves no money to the offerer, so payout setup is not required.
 *  - The VERIFIED gate still applies, because trading is gated on identity
 *    (Req 2.4) and the Bond in Req 5.4 is sized from this Item's own FMV.
 */
export async function createPrivateTradeItem(
  input: CreateItemInput,
): Promise<ListingActionResult<ItemRow>> {
  const supabase = await createClient();

  const userId = await getUserId(supabase);
  if (!userId) {
    return { ok: false, error: 'not-authenticated' };
  }

  const verified = await isVerified(supabase, userId);
  if (!verified) {
    return {
      ok: false,
      error: 'not-verified',
      message: 'Identity verification must be completed before offering a trade.',
    };
  }

  const imageCount = Array.isArray(input.images) ? input.images.length : 0;
  if (imageCount < IMAGES_MIN || imageCount > IMAGES_MAX) {
    return {
      ok: false,
      error: 'validation-error',
      field: 'images',
      message: `Between ${IMAGES_MIN} and ${IMAGES_MAX} images are required`,
    };
  }

  // Validate text/number fields against placeholder paths before uploading.
  const preValidation = validateItemSubmission({
    title: input.title,
    description: input.description,
    category: input.category,
    condition: input.condition,
    fmvCents: input.fmvCents,
    images: Array.from({ length: imageCount }, (_, i) => `pending-${i}`),
  });
  if (!preValidation.ok) {
    return {
      ok: false,
      error: 'validation-error',
      field: preValidation.field,
      message: preValidation.message,
    };
  }

  const admin = createAdminClient();
  let imagePaths: string[];
  try {
    imagePaths = await uploadImages(admin, userId, input.images);
  } catch (e) {
    return {
      ok: false,
      error: 'upload-failed',
      message: e instanceof Error ? e.message : 'Image upload failed',
    };
  }

  const validated = validateItemSubmission({
    title: input.title,
    description: input.description,
    category: input.category,
    condition: input.condition,
    fmvCents: input.fmvCents,
    images: imagePaths,
  });
  if (!validated.ok) {
    await removeImages(admin, imagePaths);
    return {
      ok: false,
      error: 'validation-error',
      field: validated.field,
      message: validated.message,
    };
  }

  const { data, error } = await supabase
    .from('items')
    .insert({
      owner_id: userId,
      title: validated.value.title,
      description: validated.value.description,
      category: validated.value.category,
      condition: validated.value.condition,
      fmv_cents: validated.value.fmvCents,
      image_paths: validated.value.images,
      status: 'AVAILABLE',
      hidden: true,
    })
    .select('*')
    .single();

  if (error || !data) {
    await removeImages(admin, imagePaths);
    return {
      ok: false,
      error: 'persistence-error',
      message: error?.message ?? 'Failed to create item',
    };
  }

  return { ok: true, data: data as ItemRow };
}

/**
 * Update an Item (Req 3.4, 3.5, 3.6, 3.7).
 *
 * Owner-only. New image uploads are resolved to object paths (kept string paths
 * pass through), then the guarded update is delegated to the item orchestrator,
 * which enforces: only AVAILABLE items are mutable (Req 3.5), FMV is immutable
 * while RESERVED (Req 3.6), and owner authorization (Req 3.7).
 */
export async function updateItem(
  itemId: string,
  input: UpdateItemInput,
): Promise<ListingActionResult<ItemRow>> {
  const supabase = await createClient();

  const userId = await getUserId(supabase);
  if (!userId) {
    return { ok: false, error: 'not-authenticated' };
  }

  // Resolve images: keep existing string paths, upload any new binary/base64.
  const admin = createAdminClient();
  const keptPaths: string[] = [];
  const newUploads: ImageUpload[] = [];
  for (const image of input.images ?? []) {
    if (typeof image === 'string') {
      keptPaths.push(image);
    } else {
      newUploads.push(image);
    }
  }

  let uploadedPaths: string[] = [];
  if (newUploads.length > 0) {
    try {
      uploadedPaths = await uploadImages(admin, userId, newUploads);
    } catch (e) {
      return {
        ok: false,
        error: 'upload-failed',
        message: e instanceof Error ? e.message : 'Image upload failed',
      };
    }
  }

  const resolvedImages = [...keptPaths, ...uploadedPaths];

  const orchestrator = createDefaultItemOrchestrator();
  const result = await orchestrator.updateItem({
    itemId,
    actorId: userId,
    update: {
      title: input.title,
      description: input.description,
      category: input.category,
      condition: input.condition,
      fmvCents: input.fmvCents,
      images: resolvedImages,
    },
  });

  if (!result.ok) {
    // Roll back freshly uploaded images since the update did not persist.
    await removeImages(admin, uploadedPaths);
    switch (result.error) {
      case 'ITEM_NOT_FOUND':
        return { ok: false, error: 'not-found' };
      case 'NOT_ITEM_OWNER':
        return { ok: false, error: 'unauthorized' };
      case 'ITEM_NOT_AVAILABLE':
        return {
          ok: false,
          error: 'item-not-available',
          message: 'This item cannot be modified in its current status.',
        };
      case 'FMV_IMMUTABLE':
        return {
          ok: false,
          error: 'fmv-immutable',
          message: 'Fair market value cannot change while the item is reserved.',
        };
      case 'VALIDATION_ERROR':
        return {
          ok: false,
          error: 'validation-error',
          field: result.field,
          message: result.detail,
        };
      default:
        return { ok: false, error: 'persistence-error' };
    }
  }

  return { ok: true, data: result.item as unknown as ItemRow };
}

/**
 * Delete an Item (owner-only). The cookie-bound client's RLS delete policy
 * enforces `owner_id = auth.uid()`, so a non-owner delete affects no rows and
 * yields `unauthorized`. Stored images are cleaned up best-effort.
 */
export async function deleteItem(
  itemId: string,
): Promise<ListingActionResult<{ id: string }>> {
  const supabase = await createClient();

  const userId = await getUserId(supabase);
  if (!userId) {
    return { ok: false, error: 'not-authenticated' };
  }

  // Load first (RLS returns AVAILABLE-or-owned) so we can clean up images and
  // distinguish not-found from not-owned.
  const { data: existing } = await supabase
    .from('items')
    .select('id, owner_id, image_paths')
    .eq('id', itemId)
    .maybeSingle();

  if (!existing) {
    return { ok: false, error: 'not-found' };
  }
  if (existing.owner_id !== userId) {
    return { ok: false, error: 'unauthorized' };
  }

  const { data: deleted, error } = await supabase
    .from('items')
    .delete()
    .eq('id', itemId)
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }
  if (!deleted) {
    // RLS prevented the delete (not the owner) or the row vanished concurrently.
    return { ok: false, error: 'unauthorized' };
  }

  const admin = createAdminClient();
  await removeImages(admin, (existing.image_paths as string[] | null) ?? []);

  return { ok: true, data: { id: deleted.id } };
}

/**
 * Read the catalog of AVAILABLE Items (Req 3.8). RLS additionally exposes the
 * caller's own non-available items, so the query filters to AVAILABLE to return
 * exactly the public catalog.
 */
export async function listAvailableItems(): Promise<ListingActionResult<ItemRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('status', 'AVAILABLE')
    .eq('hidden', false)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }

  return { ok: true, data: (data ?? []) as ItemRow[] };
}

/**
 * Read a single Item by id (Req 3.8). RLS returns the row when it is AVAILABLE
 * or owned by the caller; otherwise the row is invisible and this returns
 * `not-found`.
 *
 * Moderation (Phase 6): a `hidden` item is removed from the public catalog, so
 * it is treated as `not-found` for everyone EXCEPT its owner (who can still see
 * it from their account) and admins (who moderate it from the console). Hiding
 * is independent of `status` (AVAILABLE/RESERVED/SOLD).
 */
export async function getItem(
  itemId: string,
): Promise<ListingActionResult<ItemRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }
  if (!data) {
    return { ok: false, error: 'not-found' };
  }

  const item = data as ItemRow;

  // A hidden item 404s in the catalog flow for non-owners/non-admins.
  if (item.hidden) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isOwner = Boolean(user) && user!.id === item.owner_id;
    let isAdmin = false;
    if (user && !isOwner) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .maybeSingle();
      isAdmin = Boolean(profile?.is_admin);
    }

    if (!isOwner && !isAdmin) {
      return { ok: false, error: 'not-found' };
    }
  }

  return { ok: true, data: item };
}

// ---------------------------------------------------------------------------
// Marketplace catalog (items enriched with public seller info)
// ---------------------------------------------------------------------------

/** Public, catalog-safe seller info (from the cardtrade.public_profiles view). */
export interface CatalogSeller {
  id: string;
  displayName: string | null;
  rating: number | null;
  ratingCount: number;
  /** Whether the seller's KYC status is VERIFIED (drives the Verified badge). */
  isVerified: boolean;
}

/** An AVAILABLE item plus its seller's public profile for the marketplace grid. */
export type CatalogItem = ItemRow & { seller: CatalogSeller | null };

/**
 * Load the AVAILABLE catalog enriched with each item's seller (display name +
 * rating) for the Facebook-Marketplace-style browse experience (Req 3.8).
 *
 * Seller fields come from the `public_profiles` view, which exposes only the
 * catalog-safe columns (never contact email / KYC status), so this works for
 * items owned by other users despite the owner-only RLS on `profiles`.
 */
export async function listCatalogItems(): Promise<ListingActionResult<CatalogItem[]>> {
  const supabase = await createClient();

  const { data: itemsData, error } = await supabase
    .from('items')
    .select('*')
    .eq('status', 'AVAILABLE')
    .eq('hidden', false)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }

  const items = (itemsData ?? []) as ItemRow[];
  if (items.length === 0) {
    return { ok: true, data: [] };
  }

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

  const enriched: CatalogItem[] = items.map((item) => ({
    ...item,
    seller: sellerById.get(item.owner_id) ?? null,
  }));

  return { ok: true, data: enriched };
}

// ---------------------------------------------------------------------------
// Server-side catalog search + filtering + pagination (Phase 7)
// ---------------------------------------------------------------------------

/** Supported catalog sort orders. */
export type CatalogSort = 'newest' | 'price-asc' | 'price-desc' | 'rating';

/** Parameters accepted by {@link searchCatalog} (all optional). */
export interface SearchCatalogParams {
  /** Free-text query, matched via full-text search over `search_tsv`. */
  q?: string;
  /** Restrict to these categories (OR-ed together). */
  categories?: string[];
  /** Restrict to a single condition. */
  condition?: string;
  /** Minimum fair market value, in integer AUD cents (inclusive). */
  minCents?: number;
  /** Maximum fair market value, in integer AUD cents (inclusive). */
  maxCents?: number;
  /** When true, restrict results to items whose seller is KYC VERIFIED. */
  verifiedOnly?: boolean;
  /** Result ordering (defaults to `newest`). */
  sort?: CatalogSort;
  /** 1-based page number (defaults to 1). */
  page?: number;
  /** Page size (defaults to {@link DEFAULT_PAGE_SIZE}, clamped to a sane max). */
  pageSize?: number;
}

/** A page of catalog results plus pagination metadata. */
export interface CatalogPage {
  items: CatalogItem[];
  /** Total number of matches across all pages. */
  total: number;
  /** The (sanitized) 1-based page number that was returned. */
  page: number;
  /** The (sanitized) page size that was applied. */
  pageSize: number;
  /** Whether at least one more page exists after this one. */
  hasMore: boolean;
}

/** Discriminated result for {@link searchCatalog}. */
export type SearchCatalogResult =
  | ({ ok: true } & CatalogPage)
  | { ok: false; error: ListingActionError; message?: string };

/** Default and maximum page sizes for catalog pagination. */
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 96;

/** Clamp a possibly-undefined value to `[min, max]`, falling back to `fallback`. */
function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const int = Math.trunc(value);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

/**
 * Enrich a set of item rows with each item's public seller info from the
 * `public_profiles` view (shared by {@link listCatalogItems} and
 * {@link searchCatalog}). Returns the items in the same order they were given.
 */
async function enrichWithSellers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  items: ItemRow[],
): Promise<CatalogItem[]> {
  if (items.length === 0) return [];

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

  return items.map((item) => ({
    ...item,
    seller: sellerById.get(item.owner_id) ?? null,
  }));
}

/**
 * Server-side catalog search, filtering, sorting, and pagination (Phase 7).
 *
 * Replaces the previous client-side "filter over the entire list" approach so
 * the marketplace scales: every predicate is pushed into the `cardtrade.items`
 * query and only a single page of rows is materialized + enriched per request.
 *
 * Base filters always applied: `status = 'AVAILABLE'` AND `hidden = false`
 * (matches {@link listCatalogItems}). On top of that:
 *   * `q` (non-empty) → full-text search over the generated `search_tsv`
 *     tsvector using websearch syntax + the english config (backed by a GIN
 *     index). Whitespace-only queries are ignored.
 *   * `categories` → `category IN (...)`.
 *   * `condition`  → `condition = ...`.
 *   * `minCents` / `maxCents` → `fmv_cents >= / <=` (integer AUD cents).
 *
 * Sorting: `newest` orders by `created_at desc`; `price-asc`/`price-desc` order
 * by `fmv_cents`; `rating` orders by the denormalized `items.seller_rating`
 * column (kept in sync with each seller's profile rating by DB triggers), so it
 * is a GLOBAL ordering that paginates correctly.
 *
 * Pagination uses `.range(from, to)` with an exact count so callers get an
 * accurate `total` and `hasMore`. `page`/`pageSize` are clamped to sane bounds.
 */
export async function searchCatalog(
  params: SearchCatalogParams = {},
): Promise<SearchCatalogResult> {
  const supabase = await createClient();

  const sort: CatalogSort = params.sort ?? 'newest';
  const page = clampInt(params.page, 1, Number.MAX_SAFE_INTEGER, 1);
  const pageSize = clampInt(params.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Base query: public catalog only, with an exact total for pagination.
  let query = supabase
    .from('items')
    .select('*', { count: 'exact' })
    .eq('status', 'AVAILABLE')
    .eq('hidden', false);

  // Full-text search (skip empty / whitespace-only queries).
  const q = params.q?.trim();
  if (q) {
    query = query.textSearch('search_tsv', q, {
      type: 'websearch',
      config: 'english',
    });
  }

  // Category multi-select.
  const categories = (params.categories ?? []).filter((c) => c.trim() !== '');
  if (categories.length > 0) {
    query = query.in('category', categories);
  }

  // Condition.
  if (params.condition && params.condition.trim() !== '') {
    query = query.eq('condition', params.condition);
  }

  // Price range (integer AUD cents).
  if (params.minCents != null && Number.isFinite(params.minCents)) {
    query = query.gte('fmv_cents', Math.trunc(params.minCents));
  }
  if (params.maxCents != null && Number.isFinite(params.maxCents)) {
    query = query.lte('fmv_cents', Math.trunc(params.maxCents));
  }

  // Verified-seller-only. Backed by the denormalized `seller_verified` column
  // (kept in sync with the owner's kyc_status by DB triggers, mirroring
  // seller_rating) so this is pushed into the query rather than filtered after
  // the page is fetched, which would break `total`/`hasMore`.
  if (params.verifiedOnly) {
    query = query.eq('seller_verified', true);
  }

  // Sorting. `rating` orders by the denormalized `seller_rating` column (kept in
  // sync with each seller's profile rating by DB triggers), so the ordering is
  // GLOBAL and paginates correctly — not just within a page.
  switch (sort) {
    case 'price-asc':
      query = query.order('fmv_cents', { ascending: true });
      break;
    case 'price-desc':
      query = query.order('fmv_cents', { ascending: false });
      break;
    case 'rating':
      query = query
        .order('seller_rating', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      break;
    case 'newest':
    default:
      query = query.order('created_at', { ascending: false });
      break;
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    return { ok: false, error: 'persistence-error', message: error.message };
  }

  const rows = (data ?? []) as ItemRow[];
  const enriched = await enrichWithSellers(supabase, rows);

  const total = count ?? enriched.length;
  const hasMore = from + enriched.length < total;

  return {
    ok: true,
    items: enriched,
    total,
    page,
    pageSize,
    hasMore,
  };
}

/** Distinct filter option lists for the catalog filter UI. */
export interface CatalogFacets {
  categories: string[];
  conditions: string[];
}

/**
 * Fetch the distinct `category` and `condition` values among AVAILABLE,
 * non-hidden items to populate the filter rail. Dedupe happens in JS — simple
 * and sufficient for MVP scale (a dedicated aggregate/RPC can replace this if
 * the catalog grows large).
 */
export async function getCatalogFacets(): Promise<CatalogFacets> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('items')
    .select('category, condition')
    .eq('status', 'AVAILABLE')
    .eq('hidden', false);

  if (error || !data) {
    return { categories: [], conditions: [] };
  }

  const categories = new Set<string>();
  const conditions = new Set<string>();
  for (const row of data) {
    const category = row.category as string | null;
    const condition = row.condition as string | null;
    if (category) categories.add(category);
    if (condition) conditions.add(condition);
  }

  return {
    categories: Array.from(categories).sort(),
    conditions: Array.from(conditions).sort(),
  };
}
