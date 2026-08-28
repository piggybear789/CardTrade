// Route → mobile top-chrome variant. Kept as data so SiteHeader does not grow
// a boolean prop per screen.

export type MobileChromeKind =
  | 'catalog'
  | 'listing-detail'
  | 'hub'
  | 'hierarchical'
  | 'thread'
  | 'marketing'
  | 'auth';

const AUTH_EXACT = new Set([
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/account-suspended',
]);

const HUB_EXACT = new Set([
  '/listings/mine',
  '/saved',
  '/purchases',
  '/sales',
  '/trades',
  '/offers',
  '/messages',
  '/notifications',
  '/profile',
  '/admin',
  '/sellers',
]);

function isAuthRoute(pathname: string): boolean {
  return (
    AUTH_EXACT.has(pathname) ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/onboarding')
  );
}

function isListingDetail(pathname: string): boolean {
  if (pathname === '/listings/new' || pathname === '/listings/mine') return false;
  return /^\/listings\/[^/]+$/.test(pathname);
}

function isThreadRoute(pathname: string): boolean {
  if (/^\/messages\/[^/]+/.test(pathname)) return true;
  if (/^\/sales\/[^/]+/.test(pathname)) return true;
  if (/^\/trades\/[^/]+/.test(pathname) && pathname !== '/trades/new') return true;
  if (pathname.startsWith('/admin/arbitration/')) return true;
  return false;
}

/**
 * Pick the phone chrome for this path.
 *
 * `/` is the catalog, so it gets the search-and-filters bar. That mapping must
 * stay in step with the route: served from `/` with hub or marketing chrome, the
 * catalog would render with no search field and no way to open filters — a
 * silent failure, since the grid itself still paints.
 */
export function resolveMobileChrome(
  pathname: string,
  isAuthenticated: boolean,
): MobileChromeKind {
  if (pathname === '/') return 'catalog';
  if (pathname === '/listings/new' || pathname.endsWith('/edit')) {
    return 'hierarchical';
  }
  if (isListingDetail(pathname)) return 'listing-detail';
  if (isAuthRoute(pathname)) return pathname.startsWith('/onboarding')
    ? 'hierarchical'
    : 'auth';
  if (isThreadRoute(pathname)) return 'thread';
  if (HUB_EXACT.has(pathname) || pathname.startsWith('/admin')) return 'hub';
  if (
    pathname.startsWith('/profile/') ||
    pathname.startsWith('/sellers/') ||
    pathname === '/trades/new' ||
    pathname === '/deals/new'
  ) {
    return 'hierarchical';
  }
  return isAuthenticated ? 'hub' : 'marketing';
}

/** Explicit back target — `router.back()` skips view transitions. */
export function hierarchicalBackHref(pathname: string): string {
  if (pathname.endsWith('/edit')) return pathname.replace(/\/edit$/, '');
  if (pathname.startsWith('/profile/')) return '/profile';
  if (pathname === '/trades/new') return '/trades';
  // Everything else falls back to the catalog, which is now the homepage.
  return '/';
}