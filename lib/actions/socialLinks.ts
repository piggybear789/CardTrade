'use server';

// lib/actions/socialLinks.ts
//
// Server action for updating a member's social media links.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { buildSocialLinksPayload, normalizeHandle, SOCIAL_PLATFORMS } from '@/domain/social/socialLinks';
import { type ActionResult, fail, ok } from './result';

export type UpdateSocialLinksError = 'not-authenticated' | 'validation-error' | 'persistence-error';

export async function updateSocialLinks(
  entries: { slug: string; handle: string }[],
): Promise<ActionResult<null, UpdateSocialLinksError>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to update your socials.');

  // Validate: only known platforms, reasonable handles
  const validSlugs: Set<string> = new Set(SOCIAL_PLATFORMS.map((p) => p.slug));
  for (const entry of entries) {
    if (!validSlugs.has(entry.slug)) {
      return fail('validation-error', `Unknown platform: ${entry.slug}`);
    }
    const normalized = normalizeHandle(entry.handle);
    if (normalized && (normalized.length > 100 || /\s/.test(normalized))) {
      return fail('validation-error', `Invalid handle for ${entry.slug}`);
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
