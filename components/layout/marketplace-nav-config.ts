// Shared marketplace section map for the desktop rail and mobile bottom hubs.
// Keep labels/hrefs in one place so active-state logic cannot drift.

import type { IconSvgElement } from '@hugeicons/react';
import { BellIcon, BookmarkCheck01Icon, HandCoinsIcon, HandshakeIcon, LayoutGridIcon, MessageCircleIcon, PackageIcon, PackagePlusIcon, RepeatIcon, ScaleIcon, ShieldCheckIcon, ShoppingBag01Icon, Tag01Icon, TagsIcon, UserRoundIcon } from '@hugeicons/core-free-icons';

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
 * every consumer of that constant renders it unconditionally — the mobile hubs read
 * groups by index (`MARKETPLACE_NAV_GROUPS[1]`, `[2]`), so inserting a conditional
 * member would silently repoint the Contracts and Sell sheets.
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
      { href: '/', label: 'Browse All', icon: LayoutGridIcon },
      { href: '/saved', label: 'Saved', icon: BookmarkCheck01Icon },
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
      { href: '/listings/mine', label: 'My Listings', icon: TagsIcon },
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
  | 'contracts'
  | 'sell'
  | 'messages'
  | 'account';

export type MobileHub =
  | {
      id: MobileHubId;
      kind: 'link';
      href: string;
      label: string;
      icon: IconSvgElement;
      isActive: (pathname: string) => boolean;
    }
  | {
      id: MobileHubId;
      kind: 'sheet';
      label: string;
      icon: IconSvgElement;
      title: string;
      description: string;
      links: readonly MarketplaceNavLink[];
      isActive: (pathname: string) => boolean;
    };

const CONTRACT_LINKS = MARKETPLACE_NAV_GROUPS[1].links;
const SELL_LINKS = MARKETPLACE_NAV_GROUPS[2].links;

/** Five thumb-reach hubs; Contracts and Sell expand into short sheets. */
export const MOBILE_HUBS: readonly MobileHub[] = [
  {
    id: 'browse',
    kind: 'link',
    href: '/',
    label: 'Browse',
    icon: LayoutGridIcon,
    isActive: (pathname) =>
      isMarketplaceSectionActive(pathname, '/') ||
      pathname.startsWith('/sellers/'),
  },
  {
    id: 'contracts',
    kind: 'sheet',
    label: 'Contracts',
    icon: HandshakeIcon,
    title: 'Contracts',
    description: 'Start a private deal, or open purchases, sales, and trades.',
    links: CONTRACT_LINKS,
    isActive: (pathname) =>
      CONTRACT_LINKS.some((link) =>
        isMarketplaceSectionActive(pathname, link.href),
      ),
  },
  {
    id: 'sell',
    kind: 'sheet',
    label: 'Sell',
    icon: PackageIcon,
    title: 'Selling',
    description: 'Your listings and incoming offers.',
    links: SELL_LINKS,
    isActive: (pathname) =>
      SELL_LINKS.some((link) =>
        isMarketplaceSectionActive(pathname, link.href),
      ),
  },
  {
    id: 'messages',
    kind: 'link',
    href: '/messages',
    label: 'Inbox',
    icon: MessageCircleIcon,
    isActive: (pathname) =>
      isMarketplaceSectionActive(pathname, '/messages'),
  },
  {
    id: 'account',
    kind: 'link',
    href: '/profile',
    label: 'Account',
    icon: UserRoundIcon,
    isActive: (pathname) =>
      isMarketplaceSectionActive(pathname, '/profile') ||
      isMarketplaceSectionActive(pathname, '/notifications') ||
      isMarketplaceSectionActive(pathname, '/saved') ||
      pathname.startsWith('/admin'),
  },
];
