// Compose a private deal. Bookmarks and the header action land here so the
// form, and the browser Supabase client it uses to upload a photo, stay off
// the catalog's first load.

import { redirect } from 'next/navigation';

import { DealComposeDialog } from '@/components/deals/DealComposeDialog';
import { DEAL_OPEN_PATH } from '@/components/deals/dealPaths';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

export default async function DealsPage() {
  const user = await getCachedAuthUser();
  if (!user) {
    redirect(`/sign-in?redirectTo=${encodeURIComponent(DEAL_OPEN_PATH)}`);
  }
  return <DealComposeDialog />;
}
