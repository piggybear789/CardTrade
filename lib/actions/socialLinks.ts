'use server';

// lib/actions/socialLinks.ts
//
// Server action for updating a member's profile links (social handles + one
// website URL). Validation is per-platform kind — a store URL must not go
// through the handle rules.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  buildSocialLinksPayload,
  isValidLinkValue,
  normalizeLinkValue,
  platformBySlug,
} from '@/domain/social/socialLinks';
import { type ActionResult, fail, ok } from './result';

export type UpdateSocialLinksError = 'not-authenticated' | 'validation-error' | 'persistence-error';

export async function updateSocialLinks(
  entries: { slug: string; value: string }[],
): Promise<ActionResult<null, UpdateSocialLinksError>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to update your socials.');

  if (!Array.isArray(entries) || entries.length > 20) {
    return fail('validation-error', 'Maximum 20 social link entries allowed.');
  }

  for (const entry of entries) {
    if (!platformBySlug(entry.slug)) {
      return fail('validation-error', `Unknown platform: ${entry.slug}`);
    }
    const normalized = normalizeLinkValue(entry.slug, entry.value);
    if (normalized && !isValidLinkValue(entry.slug, normalized)) {
      return fail('validation-error', `Invalid value for ${entry.slug}`);
    }
  }

  const payload = buildSocialLinksPayload(entries);

  const { error } = await supabase
    .from('profiles')
    .update({ social_links: payload })
    .eq('id', user.id);

  if (error) {
    return fail('persistence-error', 'Could not save your social links.');
  }

  revalidatePath('/profile');
  revalidatePath(`/sellers/${user.id}`);
  return ok(null);
}
