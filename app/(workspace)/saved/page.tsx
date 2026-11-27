// app/saved/page.tsx
//
// SAVED IS A CATALOG FILTER (2026-11-27): the marketplace with `?saved=1`, so a
// member's saves are browsed, sorted and filtered like every other listing. This
// route stays so old links, emails and bookmarks still land in the right place.

import { redirect } from 'next/navigation';

import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

export default async function SavedPage() {
  const user = await getCachedAuthUser();
  if (!user) redirect('/sign-in?redirectTo=%2F%3Fsaved%3D1');
  redirect('/?saved=1');
}
