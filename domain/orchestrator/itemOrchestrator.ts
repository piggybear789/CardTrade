// domain/orchestrator/itemOrchestrator.ts
//
// The pure, injectable core of the item-update orchestration (Req 3.4, 3.5,
// 3.6). It combines the existing item validation schema with a data-access seam
// (`ItemRepository`) and depends only on interfaces - never on
// `server-only`/Supabase - so it stays exhaustively testable against a fake
// (task 7.17, Property 14). The concrete Supabase binding lives in
// `supabaseItemRepository.ts`.
//
// Money is integer AUD cents end-to-end (`fmvCents`), matching the validation
// schema and the `fmv_cents` column.

import {
  validateItemSubmission,
  type ItemSubmission,
} from '../validation';

/** Availability status of an Item (mirrors the `item_status` enum). */
export type ItemStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD';

/**
 * The subset of an Item the update core reads. `ownerId` supports the owner
 * guard; `status` drives the mutability guards (Req 3.5, 3.6); `fmvCents` is
 * compared to detect an attempted FMV change on a reserved Item (Req 3.6). The
 * index signature carries the remaining columns through untouched.
 */
export interface ItemRecord {
  id: string;
  ownerId: string;
  status: ItemStatus;
  fmvCents: number;
  [column: string]: unknown;
}

/** Parameters for persisting a validated item update. */
export interface UpdateItemParams {
  itemId: string;
  update: ItemSubmission;
}

/**
 * Data-access seam for the item update core. Implemented by the Supabase admin
 * binding (`supabaseItemRepository.ts`) in production and by an in-memory fake
 * in tests.
 */
export interface ItemRepository {
  /** Load an Item (including `owner_id`, `status`, `fmv_cents`), or `null`. */
  loadItem(itemId: string): Promise<ItemRecord | null>;
  /** Persist the validated update and return the updated row (or `null`). */
  updateItem(params: UpdateItemParams): Promise<ItemRecord | null>;
}

/**
 * Typed failure codes for an item update.
 * - `ITEM_NOT_FOUND`     - no Item exists for the id.
 * - `NOT_ITEM_OWNER`     - the actor does not own the Item (Req 3.7 defense in
 *                          depth; primary enforcement is RLS/server action).
 * - `FMV_IMMUTABLE`      - the Item is RESERVED and the update changes
 *                          `fmvCents`, which is immutable while reserved (Req 3.6).
 * - `ITEM_NOT_AVAILABLE` - the Item's status is not AVAILABLE, so it cannot be
 *                          modified; existing fields are preserved (Req 3.5).
 * - `VALIDATION_ERROR`   - the update payload failed schema validation (Req 3.2,
 *                          3.3); `field`/`detail` identify the invalid field.
 */
export type ItemUpdateError =
  | 'ITEM_NOT_FOUND'
  | 'NOT_ITEM_OWNER'
  | 'FMV_IMMUTABLE'
  | 'ITEM_NOT_AVAILABLE'
  | 'VALIDATION_ERROR';

/** Discriminated result of {@link updateItem}. */
export type UpdateItemResult =
  | { ok: true; item: ItemRecord }
  | { ok: false; error: ItemUpdateError; field?: string; detail?: string };

/** Dependencies injected into the item update core. */
export interface ItemOrchestratorDeps {
  repository: ItemRepository;
}

/**
 * Guarded item update (Req 3.4, 3.5, 3.6).
 *
 * Steps:
 * 1. Load the Item. Missing -> `ITEM_NOT_FOUND`.
 * 2. Owner guard: only the owning User may update (Req 3.7 defense in depth).
 * 3. Status guards on the *guarded fields*, evaluated before persistence so
 *    existing fields are preserved on rejection:
 *    - RESERVED + attempted `fmvCents` change -> `FMV_IMMUTABLE` (Req 3.6).
 *    - status !== AVAILABLE -> `ITEM_NOT_AVAILABLE` (Req 3.5).
 * 4. Validate the update payload via the shared item schema. Invalid ->
 *    `VALIDATION_ERROR` identifying the field (Req 3.2, 3.3).
 * 5. Persist the update (Req 3.4).
 *
 * The `FMV_IMMUTABLE` check is ordered ahead of the general availability guard
 * so a reserved Item reports the specific FMV-immutability reason for an FMV
 * change, while any other change to a non-available Item reports the general
 * "cannot be modified" reason. Both paths leave the stored Item untouched.
 */
export async function updateItem(
  deps: ItemOrchestratorDeps,
  params: { itemId: string; actorId: string; update: unknown },
): Promise<UpdateItemResult> {
  const { repository } = deps;

  // 1. Load the Item including its owner, status, and current FMV.
  const item = await repository.loadItem(params.itemId);
  if (!item) {
    return { ok: false, error: 'ITEM_NOT_FOUND' };
  }

  // 2. Only the owning User may modify the Item.
  if (item.ownerId !== params.actorId) {
    return { ok: false, error: 'NOT_ITEM_OWNER' };
  }

  // 3. Validate the payload up front so we can compare the requested FMV, but
  //    apply the status guards before any persistence so fields are preserved.
  const validated = validateItemSubmission(params.update);
  if (!validated.ok) {
    return {
      ok: false,
      error: 'VALIDATION_ERROR',
      field: validated.field,
      detail: validated.message,
    };
  }

  // 3a. A RESERVED Item's FMV is immutable (Req 3.6).
  if (item.status === 'RESERVED' && validated.value.fmvCents !== item.fmvCents) {
    return { ok: false, error: 'FMV_IMMUTABLE' };
  }

  // 3b. Only AVAILABLE Items may be modified at all (Req 3.5); preserve fields.
  if (item.status !== 'AVAILABLE') {
    return { ok: false, error: 'ITEM_NOT_AVAILABLE' };
  }

  // 4. Persist the validated update (Req 3.4).
  const updated = await repository.updateItem({
    itemId: item.id,
    update: validated.value,
  });
  if (!updated) {
    // The row disappeared or a concurrent write changed it out from under us.
    return { ok: false, error: 'ITEM_NOT_FOUND' };
  }

  return { ok: true, item: updated };
}

/** A bound item orchestrator with its dependencies already wired. */
export interface ItemOrchestrator {
  updateItem(params: {
    itemId: string;
    actorId: string;
    update: unknown;
  }): Promise<UpdateItemResult>;
}

/**
 * Bind the item update core to a set of dependencies. Tests wire an in-memory
 * fake repository here; production wires the Supabase admin binding (see
 * `supabaseItemRepository.ts`).
 */
export function createItemOrchestrator(deps: ItemOrchestratorDeps): ItemOrchestrator {
  return {
    updateItem: (params) => updateItem(deps, params),
  };
}
