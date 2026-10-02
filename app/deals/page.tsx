// Compose a private deal. Open to signed-out visitors: the composer asks for an
// account at Get link, after the deal is written, and keeps the draft through the
// sign-in. Bookmarks and the header action land here so the form, and the browser
// Supabase client it uses to upload a photo, stay off the catalog's first load.

import { DealComposeDialog } from '@/components/deals/DealComposeDialog';
import { regionCurrency } from '@/domain/region';
import { listSelectableRegions } from '@/lib/actions/regionOptions';
import { DEAL_RESUME_PARAM } from '@/lib/deals/paths';
import { automaticBrowseRegion } from '@/lib/location/resolveRegion';
import { getCachedAuthUser, getCachedProfile } from '@/lib/supabase/cachedAuth';

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, regions, browse, params] = await Promise.all([
    getCachedAuthUser(),
    listSelectableRegions(),
    automaticBrowseRegion(),
    searchParams,
  ]);
  const profile = user ? await getCachedProfile(user.id) : null;

  // The member's own trading region when they have one. Otherwise the region they
  // browse from, if a deal can be written there, so a guest's price is quoted in the
  // currency they will most likely trade in. This is a starting point for the
  // picker, never a trading region: that is only ever what the member chooses.
  const selectable = new Set(regions.map((region) => region.code));
  const suggestedRegion =
    profile?.region_code ??
    (browse.code && selectable.has(browse.code) ? browse.code : (regions[0]?.code ?? null));

  const resumeParam = params[DEAL_RESUME_PARAM];

  return (
    <DealComposeDialog
      viewer={{
        signedIn: Boolean(user),
        needsOnboarding: Boolean(user) && (!profile?.onboarding_completed_at || !profile.region_code),
        displayName: profile?.display_name ?? null,
      }}
      regions={regions}
      suggestedRegion={suggestedRegion}
      quoteCurrency={regionCurrency(suggestedRegion) ?? 'aud'}
      resume={(Array.isArray(resumeParam) ? resumeParam[0] : resumeParam) === '1'}
    />
  );
}
