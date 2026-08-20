import { cache } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from './server';

export interface CachedProfile {
  id: string;
  is_admin: boolean | null;
  is_support: boolean | null;
  display_name: string | null;
  region_code: string | null;
  avatar_path: string | null;
  onboarding_completed_at: string | null;
}

/**
 * Per-request cached lookup of the current authenticated user.
 * Deduplicates multiple `supabase.auth.getUser()` calls in a single SSR request.
 */
export const getCachedAuthUser = cache(async (): Promise<User | null> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ?? null;
  } catch {
    return null;
  }
});

/**
 * Per-request cached lookup of a user profile.
 * Defaults to the currently authenticated user's profile if `userId` is omitted.
 */
export const getCachedProfile = cache(
  async (userId?: string): Promise<CachedProfile | null> => {
    try {
      let targetId = userId;
      if (!targetId) {
        const user = await getCachedAuthUser();
        if (!user) return null;
        targetId = user.id;
      }
      const supabase = await createClient();
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, is_admin, is_support, display_name, region_code, avatar_path, onboarding_completed_at')
        .eq('id', targetId)
        .maybeSingle();
      return profile ?? null;
    } catch {
      return null;
    }
  },
);
