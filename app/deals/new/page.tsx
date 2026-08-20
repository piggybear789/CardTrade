// app/deals/new/page.tsx
//
// Compose lives in a dialog now. Old bookmarks and e2e still hit this path,
// so it opens that dialog on the homepage (or sign-up, then the dialog).

import { redirect } from 'next/navigation';

import { DEAL_OPEN_PATH } from '@/components/deals/dealPaths';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

export const dynamic = 'force-dynamic';

export default async function NewDealPage() {
  const user = await getCachedAuthUser();
  if (!user) {
    redirect(`/sign-in?redirectTo=${encodeURIComponent(DEAL_OPEN_PATH)}`);
  }
  redirect(DEAL_OPEN_PATH);
}
