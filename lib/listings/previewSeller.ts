import 'server-only';

// lib/listings/previewSeller.ts
//
// The seller line the listing editor's live preview draws: the member's own public
// profile, read from `public_profiles` exactly as the catalog reads every other
// seller (`listCatalogItems`), so the preview tile shows the name, avatar, rating and
// Trusted Seller seal buyers will see. Never throws: a failed read is a preview with
// no seller row, which the tile already handles.

import type { createClient } from '@/lib/supabase/server';
import type { CatalogSeller } from '@/lib/actions/listings';

export async function readPreviewSeller(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<CatalogSeller | null> {
  const { data } = await supabase
    .from('public_profiles')
    .select(
      'id, display_name, rating, rating_count, is_verified, identity_first_name, avatar_path, is_trusted_seller',
    )
    .eq('id', userId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    displayName: (data.display_name as string | null) ?? null,
    rating: (data.rating as number | null) ?? null,
    ratingCount: (data.rating_count as number | null) ?? 0,
    isVerified: Boolean(data.is_verified),
    identityFirstName: (data.identity_first_name as string | null) ?? null,
    avatarPath: (data.avatar_path as string | null) ?? null,
    isTrustedSeller: Boolean(data.is_trusted_seller),
  };
}
