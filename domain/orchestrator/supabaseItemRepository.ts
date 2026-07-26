// domain/orchestrator/supabaseItemRepository.ts
//
// The concrete, production wiring of the item orchestrator's data-access seam.
// It backs the `ItemRepository` interface with the service-role Supabase admin
// client. Owner authorization is enforced by RLS/the server action; this
// trusted binding performs the guarded write once the pure core has validated
// the update and cleared the status guards (Req 3.4, 3.5, 3.6).
//
// This binding is kept OUT of `itemOrchestrator.ts` on purpose: that core must
// stay importable by the domain tests (task 7.17, Property 14) without pulling
// in `server-only`/Supabase. Only this file carries the server-only dependency.

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  createItemOrchestrator,
  type ItemOrchestrator,
  type ItemRecord,
  type ItemRepository,
  type UpdateItemParams,
} from './itemOrchestrator';

/** The Supabase admin client type (service-role, RLS-bypassing). */
type AdminClient = ReturnType<typeof createAdminClient>;

/** Shape of the `items` columns this repository reads/writes. */
interface ItemRow {
  id: string;
  owner_id: string;
  status: ItemRecord['status'];
  fmv_cents: number;
  title: string;
  description: string;
  category: string;
  condition: string;
  image_paths: string[];
  [column: string]: unknown;
}

/** Map a DB row (snake_case) to the domain {@link ItemRecord}. */
function toItemRecord(row: ItemRow): ItemRecord {
  return {
    ...row,
    id: row.id,
    ownerId: row.owner_id,
    status: row.status,
    fmvCents: row.fmv_cents,
  };
}

/**
 * Build an {@link ItemRepository} backed by the Supabase admin client.
 *
 * - `loadItem` reads the Item row (owner, status, FMV, and content fields).
 * - `updateItem` writes the validated submission fields, mapping the domain
 *   `fmvCents`/`images` back to the `fmv_cents`/`image_paths` columns, and
 *   bumps `updated_at`. It re-guards on `status = 'AVAILABLE'` so a Item that
 *   was reserved concurrently is not mutated (returns `null` -> the core maps it
 *   to a not-found/rejected outcome).
 */
export function createSupabaseItemRepository(
  client: AdminClient = createAdminClient(),
): ItemRepository {
  return {
    async loadItem(itemId: string): Promise<ItemRecord | null> {
      const { data } = await client
        .from('items')
        .select('*')
        .eq('id', itemId)
        .maybeSingle();
      return data ? toItemRecord(data as ItemRow) : null;
    },

    async updateItem({ itemId, update }: UpdateItemParams): Promise<ItemRecord | null> {
      const { data } = await client
        .from('items')
        .update({
          title: update.title,
          description: update.description,
          category: update.category,
          condition: update.condition,
          fmv_cents: update.fmvCents,
          image_paths: update.images,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .eq('status', 'AVAILABLE') // re-guard: never mutate a non-available Item
        .select('*')
        .maybeSingle();
      return data ? toItemRecord(data as ItemRow) : null;
    },
  };
}

/**
 * Default production item orchestrator wiring: a Supabase-backed repository.
 * Callers may override the repository (e.g. inject a fake in an integration
 * test).
 */
export function createDefaultItemOrchestrator(
  overrides: Partial<{ repository: ItemRepository }> = {},
): ItemOrchestrator {
  return createItemOrchestrator({
    repository: overrides.repository ?? createSupabaseItemRepository(),
  });
}
