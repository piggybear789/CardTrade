// Shared marketplace section map for the desktop rail and mobile bottom hubs.
// Keep labels/hrefs in one place so active-state logic cannot drift.

import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  BookmarkCheck,
  HandCoins,
  Handshake,
  MessageCircle,
  Package,
  Repeat2,
  Scale,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tag,
  Tags,
  UserRound,
} from 'lucide-react';

export type MarketplaceNavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type MarketplaceNavGroup = {
  label: string;
  links: readonly MarketplaceNavLink[];
};

/**
 * The staff group, appended to the rail only for a caller who may arbitrate.
 *
 * Kept separate from {@link MARKETPLACE_NAV_GROUPS} rather than merged into it, because
 * every consumer of that constant renders it unconditionally â€” the mobile hubs read
 * groups by index (`MARKETPLACE_NAV_GROUPS[1]`, `[2]`), so inserting a conditional
 * member would silently repoint the Contracts and Sell sheets.
 *
 * WHY THE RAIL NEEDS THIS AT ALL. Arbitration was the only workspace surface absent
 * from the rail, so a support worker looking at a dispute saw member navigation with no
 * item active, and had no way to their own queue except the browser's back button.
 * Moderation has the same problem and gets the same fix.
 */
// "Cases" and "Operations", not "Arbitration" and "Moderation". The old pair told you
// nothing about which one you wanted â€” both sound like "deal with a problem" â€” and the
// two surfaces genuinely split on a different axis: Cases is where someone is waiting on
// your JUDGEMENT and money is frozen; Operations is where the system is waiting on your
// ATTENTION. `arbitration` remains the data-model term (arbitration_assignments,
// arbitration_case_kind) and the route; this is the label a human reads.
export const STAFF_NAV_GROUP = {
  label: 'Staff',
  links: [
    { href: '/admin/arbitration', label: 'Cases', icon: Scale },
    { href: '/admin', label: 'Operations', icon: ShieldCheck },
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

/** Rail sections â€” same order and glossary as the desktop workspace. */
export const MARKETPLACE_NAV_GROUPS = [
  {
    label: 'Marketplace',
    links: [
      { href: '/listings', label: 'Browse All', icon: Sparkles },
      { href: '/saved', label: 'Saved', icon: BookmarkCheck },
    ],
  },
  {
    label: 'Contracts',
    links: [
      { href: '/purchases', label: 'Purchases', icon: ShoppingBag },
      { href: '/sales', label: 'Sales', icon: Tag },
      // Deals are withdrawn: a private deal WAS a trade, negotiated in its own
      // room, which is what a Trade now does natively (Req 12).
      { href: '/trades', label: 'Trades', icon: Repeat2 },
    ],
  },
  {
    label: 'Selling',
    links: [
      { href: '/listings/mine', label: 'My Listings', icon: Tags },
      { href: '/offers', label: 'Offers', icon: HandCoins },
    ],
  },
  {
    label: 'You',
    links: [
      { href: '/messages', label: 'Messages', icon: MessageCircle },
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/profile', label: 'Account', icon: UserRound },
    ],
  },
] as const satisfies readonly MarketplaceNavGroup[];

/** Returns true when `href` is the active marketplace section. */
export function isMarketplaceSectionActive(
  pathname: string,
  href: string,
): boolean {
  if (href === '/listings') {
    // Browsing owns listing detail pages; selling, editing, and the caller's own
    // listings are separate sections and must not light up Browse All.
    if (
      pathname === '/listings/new' ||
      pathname === '/listings/mine' ||
      pathname.endsWith('/edit')
    ) {
      return false;
    }
    return pathname === '/listings' || pathname.startsWith('/listings/');
  }
  if (href === '/admin') {
    // Moderation owns /admin itself, not the arbitration workspace beneath it.
    // Without this both staff links light up together on every case page, the same
    // way Browse would light up on My Listings.
    return pathname === '/admin';
  }
  if (href === '/listings/mine') {
    // Create + edit listing flows belong to Selling (My Listings), not Browse.
    // Desktop rail and mobile Sell hub both use this helper, so keep them aligned.
    return (
      pathname === '/listings/mine' ||
      pathname.startsWith('/listings/mine/') ||
      pathname === '/listings/new' ||
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
      icon: LucideIcon;
      isActive: (pathname: string) => boolean;
    }
  | {
      id: MobileHubId;
      kind: 'sheet';
      label: string;
      icon: LucideIcon;
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
    href: '/listings',
    label: 'Browse',
    icon: Sparkles,
    isActive: (pathname) =>
      isMarketplaceSectionActive(pathname, '/listings') ||
      pathname.startsWith('/sellers/'),
  },
  {
    id: 'contracts',
    kind: 'sheet',
    label: 'Contracts',
    icon: Handshake,
    title: 'Contracts',
    description: 'Live escrow rooms for cash, trades, and private deals.',
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
    icon: Package,
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
    icon: MessageCircle,
    isActive: (pathname) =>
      isMarketplaceSectionActive(pathname, '/messages'),
  },
  {
    id: 'account',
    kind: 'link',
    href: '/profile',
    label: 'Account',
    icon: UserRound,
    isActive: (pathname) =>
      isMarketplaceSectionActive(pathname, '/profile') ||
      isMarketplaceSectionActive(pathname, '/notifications') ||
      isMarketplaceSectionActive(pathname, '/saved') ||
      pathname.startsWith('/admin'),
  },
];
