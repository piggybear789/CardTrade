'use client';

// components/layout/MarketplaceNav.tsx
//
// Desktop rail navigation for the shared marketplace workspace. Below `lg`,
// section links are hidden — MobileBottomNav owns hubs — but catalog filters
// (primaryExtras) still render here so they mount once under Marketplace.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  MARKETPLACE_NAV_GROUPS,
  STAFF_NAV_GROUP,
  isMarketplaceSectionActive,
  staffNavLinksFor,
  type MarketplaceNavGroup,
} from '@/components/layout/marketplace-nav-config';
import { cn } from '@/lib/utils';

export function MarketplaceNav({
  primaryExtras,
  staff,
}: {
  /**
   * Controls belonging to the Marketplace group — the catalog filters. Rendered
   * directly beneath it so the section and the thing that narrows it stay
   * together. Visible on mobile even when the section links are not.
   */
  primaryExtras?: ReactNode;
  /**
   * The caller's staff capability, as two BOOLEANS.
   *
   * WHY NOT THE RESOLVED LINKS. This is a Client Component, so anything the server
   * hands it has to survive serialization — and a nav link carries `icon`, which is a
   * Lucide component (`{$$typeof, render}`), not data. Passing the array threw
   * "Only plain objects can be passed to Client Components from Server Components" on
   * every page that mounts the shell. Booleans cross the boundary; the icons are
   * resolved here from this module's own import, which never leaves the client bundle.
   *
   * Navigation only. A capability decided in the browser is a suggestion, not a gate —
   * every staff surface re-checks `requireStaff` server-side.
   */
  staff?: { isStaff: boolean; isAdmin: boolean };
} = {}) {
  const pathname = usePathname();

  const staffLinks = staff ? staffNavLinksFor(staff) : [];
  const groups: readonly MarketplaceNavGroup[] =
    staffLinks.length > 0
      ? [...MARKETPLACE_NAV_GROUPS, { ...STAFF_NAV_GROUP, links: staffLinks }]
      : MARKETPLACE_NAV_GROUPS;

  return (
    <nav aria-label="Marketplace sections" className="flex flex-col gap-5">
      {groups.map((group) => {
        const isMarketplace = group.label === 'Marketplace';
        return (
          // Non-Marketplace groups are desktop-only. Keeping empty wrappers in
          // the flex column used to burn `gap-5` strips of whitespace on mobile.
          <div
            key={group.label}
            className={cn(!isMarketplace && 'hidden lg:block')}
          >
            <div className="hidden lg:block">
              <p className="market-label px-3 pb-1.5 text-muted-foreground">
                {group.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.links.map((link) => {
                  const active = isMarketplaceSectionActive(
                    pathname,
                    link.href,
                  );
                  const Icon = link.icon;
                  return (
                    <li key={link.href} className="w-full">
                      <Link
                        href={link.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          active
                            ? 'bg-gold/10 font-semibold text-foreground'
                            : 'font-medium text-foreground/85 hover:bg-muted/70 hover:text-foreground',
                        )}
                      >
                        <Icon
                          className={cn(
                            'size-4 shrink-0',
                            active ? 'text-gold' : 'text-muted-foreground',
                          )}
                          aria-hidden="true"
                        />
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>

            {primaryExtras && isMarketplace ? primaryExtras : null}
          </div>
        );
      })}
    </nav>
  );
}
