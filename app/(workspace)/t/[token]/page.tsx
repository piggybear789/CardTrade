// app/t/[token]/page.tsx
//
// Public join-by-token invite. Signed-out visitors see a preview and sign in.
// Signed-in members fill the missing side, then land in CashSaleView or
// TradeContract. Hosts waiting on an unused invite can copy or cancel.

import { redirect } from 'next/navigation';

import {
  DealJoinForm,
  PublicDealInvitePreview,
} from '@/components/deals/DealJoinForm';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { PageShell } from '@/components/layout/PageShell';
import { getDealInvitePreview } from '@/lib/actions/dealInvites';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

export const dynamic = 'force-dynamic';

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
    const signInHref = `/sign-in?redirectTo=${encodeURIComponent(`/t/${token}`)}`;
    return (
      <PageShell centered className="max-w-lg">
        <PublicDealInvitePreview preview={preview} signInHref={signInHref} />
      </PageShell>
    );
  }

  return (
    <MarketplaceShell title="Private deal" center>
      <DealJoinForm preview={preview} />
    </MarketplaceShell>
  );
}
