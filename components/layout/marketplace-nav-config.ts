// Shared marketplace section map for the desktop rail and mobile bottom hubs.
// Keep labels/hrefs in one place so active-state logic cannot drift.

import type { IconSvgElement } from '@hugeicons/react';
import { BellIcon, CheckmarkBadge01Icon, HandCoinsIcon, HeartIcon, LayoutGridIcon, Login03Icon, MessageCircleIcon, PackagePlusIcon, RepeatIcon, ScaleIcon, Search01Icon, ShieldCheckIcon, ShoppingBag01Icon, Tag01Icon, TagsIcon, UserRoundIcon } from '@hugeicons/core-free-icons';

export type MarketplaceNavLink = {
  href: string;
  label: string;
  icon: IconSvgElement;
};

export type MarketplaceNavGroup = {
  label: string;
  links: readonly MarketplaceNavLink[];
};

/**
 * The staff group, appended to the rail only for a caller who may arbitrate.
 *
 * Kept separate from {@link MARKETPLACE_NAV_GROUPS} rather than merged into it, because
 * every consumer of that constant renders it unconditionally — {@link CONTRACT_LINKS}
 * reads its group by index (`MARKETPLACE_NAV_GROUPS[1]`), so inserting a conditional
 * member would silently repoint the phone's Account hub and its contract rows.
 *
 * WHY THE RAIL NEEDS THIS AT ALL. Arbitration was the only workspace surface absent
 * from the rail, so a support worker looking at a dispute saw member navigation with no
 * item active, and had no way to their own queue except the browser's back button.
 * Moderation has the same problem and gets the same fix.
 */
// "Cases" and "Operations", not "Arbitration" and "Moderation". The old pair told you
// nothing about which one you wanted — both sound like "deal with a problem" — and the
// two surfaces genuinely split on a different axis: Cases is where someone is waiting on
// your JUDGEMENT and money is frozen; Operations is where the system is waiting on your
// ATTENTION. `arbitration` remains the data-model term (arbitration_assignments,
// arbitration_case_kind) and the route; this is the label a human reads.
export const STAFF_NAV_GROUP = {
  label: 'Staff',
  links: [
    { href: '/admin/arbitration', label: 'Cases', icon: ScaleIcon },
    { href: '/admin', label: 'Operations', icon: ShieldCheckIcon },
  ],
} as const satisfies MarketplaceNavGroup;

/** The staff links a given capability may see. Admins get both; support gets one. */
export function staffNavLinksFor(capability: {
  isStaff: boolean;
  isAdmin: boolean;
}): readonly MarketplaceNavLink[] {
  if (!capability.isStaff && !capability.isAdmin) return [];
  // Moderation is admin-only, and a link a support worker cannot use would be a dead
  // end dressed as navigation.
  return capability.isAdmin
    ? STAFF_NAV_GROUP.links
    : STAFF_NAV_GROUP.links.filter((link) => link.href === '/admin/arbitration');
}

/** Rail sections — same order and glossary as the desktop workspace. */
export const MARKETPLACE_NAV_GROUPS = [
  {
    label: 'Marketplace',
    links: [
      // The catalog is the homepage. Listing detail pages stayed under
      // `/listings/[id]`, which is why the active-state helper below cannot
      // simply prefix-match this href.
      { href: '/', label: 'Browse all', icon: LayoutGridIcon },
      // The heart, the same glyph `WatchButton` saves with. It was a bookmark, so
      // members saved with one symbol and found their saves under another.
      { href: '/saved', label: 'Saved', icon: HeartIcon },
    ],
  },
  {
    label: 'Contracts',
    links: [
      { href: '/purchases', label: 'Purchases', icon: ShoppingBag01Icon },
      { href: '/sales', label: 'Sales', icon: Tag01Icon },
      // Private deals are invites that open a Cash_Sale or a Trade. Pending
      // unused invites sit in those inboxes; the rooms themselves are unchanged.
      { href: '/trades', label: 'Trades', icon: RepeatIcon },
    ],
  },
  {
    label: 'Selling',
    links: [
      { href: '/listings/new', label: 'Sell an item', icon: PackagePlusIcon },
      { href: '/listings/mine', label: 'My listings', icon: TagsIcon },
      { href: '/offers', label: 'Offers', icon: HandCoinsIcon },
    ],
  },
  {
    label: 'You',
    links: [
      { href: '/messages', label: 'Messages', icon: MessageCircleIcon },
      { href: '/notifications', label: 'Notifications', icon: BellIcon },
      { href: '/profile', label: 'Account', icon: UserRoundIcon },
    ],
  },
] as const satisfies readonly MarketplaceNavGroup[];

/** Returns true when `href` is the active marketplace section. */
export function isMarketplaceSectionActive(
  pathname: string,
  href: string,
): boolean {
  if (href === '/') {
    // Browsing owns the catalog at `/` and the listing detail pages still served
    // from `/listings/[id]`; selling, editing, and the caller's own listings are
    // separate sections and must not light up Browse All.
    if (
      pathname === '/listings/new' ||
      pathname === '/listings/mine' ||
      pathname.endsWith('/edit')
    ) {
      return false;
    }
    return pathname === '/' || pathname.startsWith('/listings/');
  }
  if (href === '/admin') {
    // Moderation owns /admin itself, not the arbitration workspace beneath it.
    // Without this both staff links light up together on every case page, the same
    // way Browse would light up on My Listings.
    return pathname === '/admin';
  }
  if (href === '/listings/new') {
    return pathname === '/listings/new';
  }
  if (href === '/listings/mine') {
    // Edit listing flows belong to Selling (My Listings), not Browse.
    // Desktop rail and mobile Sell hub both use this helper, so keep them aligned.
    return (
      pathname === '/listings/mine' ||
      pathname.startsWith('/listings/mine/') ||
      (pathname.startsWith('/listings/') && pathname.endsWith('/edit'))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type MobileHubId =
  | 'browse'
  | 'references'
  | 'sell'
  | 'messages'
  | 'account'
  | 'search'
  | 'sign-in';

/**
 * Whether a hub is reachable without a session.
 *
 * Declared per hub rather than inferred, because the bar is now mounted for guests
 * too and "which of these five can a signed-out visitor actually use" is a product
 * decision that has to be made once, here, instead of re-derived at each call site.
 */
type HubAudience = { requiresAuth: boolean };

/**
 * One tab on the phone bar. EVERY HUB IS A LINK: Contracts was the one that opened a
 * sheet, and its rows moved to the Account screen when References took its slot.
 */
export type MobileHub = HubAudience & {
  id: MobileHubId;
  href: string;
  label: string;
  icon: IconSvgElement;
  isActive: (pathname: string) => boolean;
};

/**
 * Where signing in should land a guest who tapped this hub.
 *
 * Their destination, not the page they were standing on: someone who taps "Inbox"
 * wants the inbox once they are through, and bouncing them back to the listing they
 * were reading makes them tap it a second time.
 */
export function mobileHubDestination(hub: MobileHub): string {
  return hub.href;
}

/**
 * Purchases, Sales and Trades. The desktop rail lists them as its Contracts group; on a
 * phone they are rows on the Account screen (`app/(workspace)/profile`), which is why
 * the Account hub owns their sections, contract rooms included.
 */
export const CONTRACT_LINKS = MARKETPLACE_NAV_GROUPS[1].links;

/**
 * The seller's own pages, which the phone files under Account rather than under a
 * Sell sheet. The Sell tab is the form itself; what a seller already has — listings,
 * offers — is activity, and activity lives on the Account hub with the rest of it.
 */
const SELLER_ACTIVITY_PATHS = ['/listings/mine', '/offers'] as const;

const BROWSE_HUB: MobileHub = {
  id: 'browse',
  href: '/',
  label: 'Browse',
  // The catalog is public, so a guest can use this hub as-is.
  requiresAuth: false,
  icon: LayoutGridIcon,
  isActive: (pathname) =>
    isMarketplaceSectionActive(pathname, '/') ||
    pathname.startsWith('/sellers/'),
};

/**
 * THE SECOND TAB, for members and guests alike. References are public — a buyer checks
 * a seller here before a deal, and a visitor following a reference link from Instagram
 * usually arrives signed out — so the tab needs no session. The glyph is the one the
 * desktop menu gives References.
 */
const REFERENCES_HUB: MobileHub = {
  id: 'references',
  href: '/references',
  label: 'References',
  requiresAuth: false,
  icon: CheckmarkBadge01Icon,
  isActive: (pathname) => isMarketplaceSectionActive(pathname, '/references'),
};

/**
 * STRAIGHT TO THE FORM. Sell opened a sheet whose first row was "Sell an item", so
 * selling took two taps and the tab named an action it did not perform.
 */
const SELL_HUB: MobileHub = {
  id: 'sell',
  href: '/listings/new',
  label: 'Sell',
  requiresAuth: true,
  icon: PackagePlusIcon,
  isActive: (pathname) => pathname === '/listings/new',
};

/** Five thumb-reach hubs for a member, every one a single tap. */
export const MOBILE_HUBS: readonly MobileHub[] = [
  BROWSE_HUB,
  REFERENCES_HUB,
  SELL_HUB,
  {
    id: 'messages',
    href: '/messages',
    label: 'Inbox',
    requiresAuth: true,
    icon: MessageCircleIcon,
    isActive: (pathname) =>
      isMarketplaceSectionActive(pathname, '/messages'),
  },
  {
    id: 'account',
    href: '/profile',
    label: 'Account',
    requiresAuth: true,
    icon: UserRoundIcon,
    isActive: (pathname) =>
      isMarketplaceSectionActive(pathname, '/profile') ||
      isMarketplaceSectionActive(pathname, '/notifications') ||
      isMarketplaceSectionActive(pathname, '/saved') ||
      SELLER_ACTIVITY_PATHS.some((path) => isMarketplaceSectionActive(pathname, path)) ||
      CONTRACT_LINKS.some((link) => isMarketplaceSectionActive(pathname, link.href)) ||
      pathname.startsWith('/admin'),
  },
];

/**
 * A guest's hubs. Inbox and Account only ever led a guest to sign-in, so they were the
 * same door with different labels. A guest gets what they can use — browse, References
 * and search — plus Sell (which still asks them to sign in, because wanting to sell is
 * the reason many sign up) and one honest Sign in.
 */
export const GUEST_MOBILE_HUBS: readonly MobileHub[] = [
  BROWSE_HUB,
  REFERENCES_HUB,
  {
    id: 'search',
    // `?search=1` focuses the catalog's search field on arrival; on a page that
    // already shows one, the bar focuses it in place instead.
    href: '/?search=1',
    label: 'Search',
    requiresAuth: false,
    icon: Search01Icon,
    isActive: () => false,
  },
  SELL_HUB,
  {
    id: 'sign-in',
    href: '/sign-in',
    label: 'Sign in',
    requiresAuth: false,
    icon: Login03Icon,
    isActive: (pathname) => pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up'),
  },
];
