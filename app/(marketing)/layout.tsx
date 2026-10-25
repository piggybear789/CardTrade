// app/(marketing)/layout.tsx
//
// Help, Safety, Terms, Privacy, References, scam reports and the Trusted Seller
// application.
//
// THE PHONE HUB BAR IS MOUNTED HERE AS WELL AS IN `(workspace)`. These routes sit
// outside the workspace group, so the bar used to stop at their edge: References, now
// the bar's second tab, opened with no bar under it, and a signed-in member there had
// no navigation at all, because a member's phone chrome on these routes is the compact
// strip. Mounted in the layout rather than per page, so moving between these pages
// keeps the one bar.
//
// Below `md` the column is padded by the bar's height (`h-14`, its 1px border and the
// bottom inset), so the footer and the end of every page clear it. A FIXED VALUE, not
// `--mobile-hub-offset`: that variable drops to 0 while the keyboard hides the bar, and
// on a form scrolled to its end the page would shrink by the bar's height, and jump, the
// moment a field took focus. Only the bar sits inside `WorkspaceChromeProvider`, for its
// unread counts; the pages keep the default context they always had.

import type { ReactNode } from 'react';

import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { WorkspaceChromeProvider } from '@/components/layout/WorkspaceChrome';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

import { MarketingFooter } from './marketing-footer';

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  // React-cached and shared with `SiteHeader`. It checks the token's signature locally
  // (`getClaims`), so it normally adds no round trip.
  const user = await getCachedAuthUser();

  return (
    <>
      <div className="auth-backdrop flex min-h-0 flex-1 flex-col max-md:pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))]">
        <div className="flex flex-1 flex-col">{children}</div>
        {/* Client, for its one path check: hidden on phones on the references pages. */}
        <MarketingFooter />
      </div>
      {/* Fixed to the viewport, so it sits outside the column's flex chain. */}
      <WorkspaceChromeProvider userId={user?.id ?? null}>
        <MobileBottomNav isAuthenticated={Boolean(user)} />
      </WorkspaceChromeProvider>
    </>
  );
}
