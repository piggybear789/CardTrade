'use server';

// lib/actions/listingDrafts.ts
//
// Save, list, open and discard listing drafts (0131).
//
// A draft is the listing form's fields as JSON, owned by the seller and protected by
// RLS. It is never a listing: it becomes one only by being submitted through
// `createItem`, which validates as it always has.

import { revalidatePath } from 'next/cache';

import { withActionLog } from '@/lib/errors/withActionLog';
import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import type { Json } from '@/lib/supabase/database.types';
import type { ItemFormDraftFields } from '@/lib/listings/useItemFormDraft';

/** How many drafts one seller may keep. A draft list is a shelf, not an archive. */
const DRAFTS_MAX = 20;

/** A draft as the My listings tab shows it. */
export interface ListingDraftSummary {
  id: string;
  title: string;
  game: string;
  updatedAt: string;
}

export type ListingDraftResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'not-authenticated' | 'not-found' | 'limit-reached' | 'persistence-error'; message: string };

/** Keep only the known draft fields, as strings, so the row is the form's shape and nothing else. */
function sanitize(fields: ItemFormDraftFields): Record<string, Json> {
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
  return {
    title: text(fields.title, 120),
    description: text(fields.description, 2000),
    game: text(fields.game, 60),
    condition: text(fields.condition, 40),
    listingKind: fields.listingKind === 'SHOPFRONT' ? 'SHOPFRONT' : 'SINGLE',
    fmvDollars: text(fields.fmvDollars, 20),
    grader: text(fields.grader, 20),
    grade: text(fields.grade, 20),
    certNumber: text(fields.certNumber, 20),
    location: (fields.location ?? null) as Json,
  };
}

/** Save a new draft, or overwrite the caller's draft `id`. Returns the draft's id. */
export const saveListingDraft = withActionLog('listingDrafts.saveListingDraft', async function saveListingDraft(
  id: string | null,
  fields: ItemFormDraftFields,
): Promise<ListingDraftResult<{ id: string }>> {
  const user = await getCachedAuthUser();
  if (!user) return { ok: false, error: 'not-authenticated', message: 'Sign in to save a draft.' };
  const supabase = await createClient();
  const payload = sanitize(fields);

  if (id) {
    const { data, error } = await supabase
      .from('listing_drafts')
      .update({ fields: payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) return { ok: false, error: 'persistence-error', message: 'Could not save your draft.' };
    if (!data) return { ok: false, error: 'not-found', message: 'That draft no longer exists.' };
    revalidatePath('/listings/mine');
    return { ok: true, data: { id: data.id as string } };
  }

  const { count } = await supabase
    .from('listing_drafts')
    .select('id', { count: 'exact', head: true });
  if ((count ?? 0) >= DRAFTS_MAX) {
    return {
      ok: false,
      error: 'limit-reached',
      message: `You can keep ${DRAFTS_MAX} drafts. Finish or delete one first.`,
    };
  }

  const { data, error } = await supabase
    .from('listing_drafts')
    .insert({ owner_id: user.id, fields: payload })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'persistence-error', message: 'Could not save your draft.' };
  revalidatePath('/listings/mine');
  return { ok: true, data: { id: data.id as string } };
});

/** The caller's drafts, newest first. */
export const listMyListingDrafts = withActionLog('listingDrafts.listMyListingDrafts', async function listMyListingDrafts(): Promise<ListingDraftResult<ListingDraftSummary[]>> {
  const user = await getCachedAuthUser();
  if (!user) return { ok: false, error: 'not-authenticated', message: 'Sign in to see your drafts.' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('listing_drafts')
    .select('id, fields, updated_at')
    .order('updated_at', { ascending: false })
    .limit(DRAFTS_MAX);
  if (error) return { ok: false, error: 'persistence-error', message: 'Could not load your drafts.' };
  return {
    ok: true,
    data: (data ?? []).map((row) => {
      const fields = (row.fields ?? {}) as Record<string, unknown>;
      const title = typeof fields.title === 'string' ? fields.title.trim() : '';
      const description = typeof fields.description === 'string' ? fields.description.trim() : '';
      return {
        id: row.id as string,
        title: title || description.slice(0, 60) || 'Untitled draft',
        game: typeof fields.game === 'string' ? fields.game : '',
        updatedAt: row.updated_at as string,
      };
    }),
  };
});

/** One of the caller's drafts, as form fields, or null when it is not theirs or gone. */
export const getListingDraft = withActionLog('listingDrafts.getListingDraft', async function getListingDraft(
  id: string,
): Promise<{ id: string; fields: ItemFormDraftFields } | null> {
  const user = await getCachedAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('listing_drafts')
    .select('id, fields')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const f = (data.fields ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    id: data.id as string,
    fields: {
      title: text(f.title),
      description: text(f.description),
      game: text(f.game),
      condition: text(f.condition),
      listingKind: f.listingKind === 'SHOPFRONT' ? 'SHOPFRONT' : 'SINGLE',
      fmvDollars: text(f.fmvDollars),
      grader: text(f.grader),
      grade: text(f.grade),
      certNumber: text(f.certNumber),
      location: f.location ?? null,
    },
  };
});

/** Discard one of the caller's drafts. Also called once a draft has been published. */
export const deleteListingDraft = withActionLog('listingDrafts.deleteListingDraft', async function deleteListingDraft(
  id: string,
): Promise<ListingDraftResult<null>> {
  const user = await getCachedAuthUser();
  if (!user) return { ok: false, error: 'not-authenticated', message: 'Sign in to manage drafts.' };
  const supabase = await createClient();
  const { error } = await supabase.from('listing_drafts').delete().eq('id', id);
  if (error) return { ok: false, error: 'persistence-error', message: 'Could not delete the draft.' };
  revalidatePath('/listings/mine');
  return { ok: true, data: null };
});
