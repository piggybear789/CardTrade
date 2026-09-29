// app/t/[token]/page.tsx
//
// Public join-by-token invite. Signed-out visitors see a preview and join with
// Google or email, coming straight back here. Signed-in members join — a brand-new
// account answers two questions first — then land in CashSaleView or TradeContract.
// Hosts waiting on an unused invite see their link.

import { redirect } from 'next/navigation';

import {
  DealJoinForm,
  PublicDealInvitePreview,
} from '@/components/deals/DealJoinForm';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { PageShell } from '@/components/layout/PageShell';
import { getDealInvitePreview } from '@/lib/actions/dealInvites';
import { listSelectableRegions } from '@/lib/actions/regionOptions';
import { getCachedAuthUser, getCachedProfile } from '@/lib/supabase/cachedAuth';

export const metadata = {
  title: 'Private deal · NoDitto',
  description: 'Join a private deal on NoDitto.',
};

export default async function DealInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [user, preview] = await Promise.all([
    getCachedAuthUser(),
    getDealInvitePreview(token),
  ]);

  if (preview.status === 'claimed' && preview.contractPath) {
    redirect(preview.contractPath);
  }

  if (!user) {
    // This branch escapes `MarketplaceShell`, which is what normally reserves room
    // for the mobile hub bar — but the bar is mounted by the `(workspace)` layout
    // and renders for guests too. Without the reserve, `centered` optically centred
    // the invite against a container that runs behind the bar, so it sat up to 56px
    // low and a tall preview clipped.
    return (
      <PageShell
        centered
        className="max-w-lg pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-10"
      >
        <PublicDealInvitePreview preview={preview} />
      </PageShell>
    );
  }

  const [profile, regions] = await Promise.all([
    getCachedProfile(user.id),
    listSelectableRegions(),
  ]);
  const needsOnboarding = !profile?.onboarding_completed_at || !profile.region_code;
  // A deal runs inside one region, so a new joiner's picker starts on the host's —
  // when a deal can be written there. Their own region wins once they have one.
  const hostRegionSelectable =
    preview.hostRegion != null && regions.some((region) => region.code === preview.hostRegion);

  return (
    <MarketplaceShell title="Private deal" center>
      <DealJoinForm
        preview={preview}
        viewer={{ needsOnboarding, displayName: profile?.display_name ?? null }}
        regions={regions}
        suggestedRegion={profile?.region_code ?? (hostRegionSelectable ? preview.hostRegion : null)}
      />
    </MarketplaceShell>
  );
}
