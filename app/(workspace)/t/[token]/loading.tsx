// app/t/[token]/loading.tsx
//
// Private-deal fallback. This route resolves to either a guest preview in a bare
// `PageShell` or the signed-in workspace in `MarketplaceShell center`, so it must not
// inherit the catalog grid — and it must not pick one shell for both. The choice is made
// by `DealInviteSkeleton` from the workspace chrome context, which the layout has
// already mounted; see that file for why that is safe to read in a placeholder.

import { DealInviteSkeleton } from '@/components/deals/DealInviteSkeleton';

export default function DealInviteLoading() {
  return <DealInviteSkeleton />;
}
