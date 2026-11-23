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
import { dealHostPath } from '@/lib/deals/paths';
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

  // THE HOST'S OWN DEAL OPENS IN THE COMPOSER, filled in, with this link above its
  // preview: one page to send it from and to change it on. The same rule the composer
  // applies the other way round (an open deal it can edit), so the two cannot bounce a
  // host between them. A legacy deal with nothing to edit keeps the share view below.
  if (preview.isHost && preview.status === 'open' && preview.editable) {
    redirect(dealHostPath(token));
  }

  if (!user) {
    // This branch escapes `MarketplaceShell`, which is what normally reserves room
    // for the mobile hub bar — but the bar is mounted by the `(workspace)` layout
    // and renders for guests too. Without the reserve, `centered` optically centred
    // the invite against a container that runs behind the bar, so it sat up to 56px
    // low and a tall preview clipped.
    // TOP-ALIGNED, NOT CENTRED, here and in the member branch below. What the card
    // holds depends on the invite — a wanted description, a note, a row for the
    // joiner's own card on a trade — and the loader cannot know which. Centred, every
    // extra row re-centred the whole card on arrival, so its top edge jumped by half
    // the difference; top-aligned, extra rows only extend the card downward.
    return (
      <PageShell
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

  // NO `loading.tsx` FOR THIS ROUTE, on purpose. One URL draws three different pages:
  // a guest's preview, a member's join form, and the host's "link ready" screen, and a
  // placeholder cannot know which. The one it drew was the join card, so the host,
  // who lands here straight from Get link, saw that card and then watched it swap for
  // a different shape. With no loader a client navigation holds the page it came from
  // (the composer, reading "Creating link…") until this one is ready, and a hard load
  // paints the finished page once (the structure steering doc's own rule).
  return (
    // The host's share view is short and is the whole page, so it sits centred; the
    // joiner's form is long and reads from the top.
    <MarketplaceShell title="Private deal" center={preview.isHost && preview.status === 'open'}>
      <DealJoinForm
        preview={preview}
        viewer={{ needsOnboarding, displayName: profile?.display_name ?? null }}
        regions={regions}
        suggestedRegion={profile?.region_code ?? (hostRegionSelectable ? preview.hostRegion : null)}
      />
    </MarketplaceShell>
  );
}
