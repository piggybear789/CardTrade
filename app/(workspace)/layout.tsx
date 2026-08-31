// app/(workspace)/layout.tsx
//
// The signed-in marketplace workspace: browse, listings, contracts, messages,
// account, admin. Everything that is IDENTICAL from one workspace route to the
// next lives here, so a navigation swaps the content column and nothing else.
//
// WHAT MOVED HERE, AND WHY IT MATTERS. Two things used to be re-derived by every
// page through `MarketplaceShell`:
//
//   1. The viewer's identity and staff capability. The shell is the JSX root of
//      ~20 pages, so its `auth.getUser()` + `profiles` read ran AFTER the page
//      had already awaited all of its own data — two round trips appended to the
//      end of every critical path. Reading them once in the layout, through the
//      React-cached helpers, means the shell's own reads are cache hits.
//   2. `MobileBottomNav`. A layout is not re-rendered by a child segment's
//      navigation and is not replaced by its `loading.tsx`, so mounting the hub
//      bar here is what actually makes it persist. Rendered from the page it was
//      unmounted and rebuilt on every route change.
//
// The desktop rail still lives in `MarketplaceShell` because its title, primary
// action and filters are per-page, and the catalog's filters read
// `CatalogViewProvider` context that only the page can mount. What stops the
// rail flashing is that `MarketplaceShellSkeleton` now draws the real
// `MarketplaceNav`, reading capability from the provider below.

import type { ReactNode } from 'react';
import { cookies } from 'next/headers';

import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import {
  VIEWPORT_HINT_COOKIE,
  WorkspaceChromeProvider,
} from '@/components/layout/WorkspaceChrome';
import { getCachedAuthUser, getCachedProfile } from '@/lib/supabase/cachedAuth';

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // Both helpers are `React.cache`-wrapped, so this is the single auth round
  // trip for the request. `SiteHeader` in the root layout and every action
  // below share the same resolved values.
  const [user, cookieStore] = await Promise.all([getCachedAuthUser(), cookies()]);
  const profile = user ? await getCachedProfile(user.id) : null;

  // Written by the browser on the previous render. Absent on a first-ever visit,
  // in which case both hooks fall back to the phone shape exactly as before.
  const hint = cookieStore.get(VIEWPORT_HINT_COOKIE)?.value;
  const viewport = hint
    ? { isDesktop: hint.includes('d'), isSplit: hint.includes('s') }
    : undefined;

  const staff = profile
    ? {
        isAdmin: Boolean(profile.is_admin),
        isStaff: Boolean(profile.is_support),
      }
    : undefined;

  return (
    <WorkspaceChromeProvider staff={staff} viewport={viewport}>
      {children}
      {/* Fixed to the viewport, so it sits outside the page's flex chain.
          Mounted for guests too: the catalog and listing detail are public, and
          they were the only screens in the app with no bottom navigation. The bar
          points a signed-out visitor's gated taps at sign-in rather than hiding. */}
      <MobileBottomNav isAuthenticated={Boolean(user)} />
    </WorkspaceChromeProvider>
  );
}
