'use client';

// components/layout/MarketplaceNav.tsx
//
// Desktop rail navigation for the shared marketplace workspace. Below `lg`,
// section links are hidden — MobileBottomNav owns hubs — but catalog filters
// (primaryExtras) still render here so they mount once under Marketplace.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';

import {
  MARKETPLACE_NAV_GROUPS,
  STAFF_NAV_GROUP,
  isMarketplaceSectionActive,
  staffNavLinksFor,
  type MarketplaceNavGroup,
} from '@/components/layout/marketplace-nav-config';
import { useWorkspaceChrome } from '@/components/layout/WorkspaceChrome';
import { cn } from '@/lib/utils';

export function MarketplaceNav({
  primaryExtras,
}: {
  /**
   * Controls belonging to the Marketplace group — the catalog filters. Rendered
   * directly beneath it so the section and the thing that narrows it stay
   * together. Visible on mobile even when the section links are not.
   */
  primaryExtras?: ReactNode;
} = {}) {
  const pathname = usePathname();
  // Read from the workspace provider rather than a prop, so the loading
  // skeleton can draw this same nav without a profile read of its own. See
  // `components/layout/WorkspaceChrome.tsx`.
  const { staff } = useWorkspaceChrome();

  const staffLinks = staff ? staffNavLinksFor(staff) : [];
  const groups: readonly MarketplaceNavGroup[] =
    staffLinks.length > 0
      ? [...MARKETPLACE_NAV_GROUPS, { ...STAFF_NAV_GROUP, links: staffLinks }]
      : MARKETPLACE_NAV_GROUPS;

  // Browse already has Marketplace + catalog filters in this rail. Contracts
  // through You are reachable from the header and the bottom hubs; keeping them
  // here crowds the filters on the one page that needs the space.
  const onCatalogBrowse = pathname === '/';

  return (
    // `gap-3`, not `gap-5`. Eleven links across four labelled groups is 613px of
    // rail on its own — before the title, the CTA, or any filters — which
    // overflowed a 1366x768 laptop by itself. Each group already announces
    // itself with an uppercase label, so the extra 8px per boundary was
    // separating things that were not in danger of running together.
    <nav aria-label="Marketplace sections" className="flex flex-col gap-3">
      {groups.map((group) => {
        const isMarketplace = group.label === 'Marketplace';
        if (onCatalogBrowse && (group.label === 'Contracts' || group.label === 'Selling' || group.label === 'You')) {
          return null;
        }
        return (
          // Non-Marketplace groups are desktop-only. Keeping empty wrappers in
          // the flex column used to burn `gap-5` strips of whitespace on mobile.
          <div
            key={group.label}
            className={cn(!isMarketplace && 'hidden md:block')}
          >
            <div className="hidden md:block">
              <p className="market-label px-3 pb-1 text-muted-foreground">
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
                          // `py-2` gives a 40px row. The rail is desktop-only
                          // (`hidden md:block`), where WCAG 2.2 asks 24px of a
                          // pointer target, so this clears the floor comfortably
                          // and the rows stay easy to hit while scanning.
                          // `text-nav`, not `text-body`: the rail holds 15px while
                          // the body scale sits at 13px. See the token's note.
                          'relative flex items-center gap-3 rounded-lg px-3 py-2 text-nav transition-colors border border-transparent focus:outline-none focus-visible:border-iris',
                          // A NEUTRAL SURFACE AND A 2px VIOLET MARKER, not a
                          // violet slab. The accent pair reads the state in
                          // lilac text on a lilac wash, which was legible
                          // enough — but the rail stacks up to eleven of these
                          // and the one that is active should not be the
                          // loudest colour on the page. Violet is for the
                          // section's action button and for money.
                          //
                          // The earlier note against a low-alpha wash still
                          // holds and is why this is not `iris/10`: that
                          // measured 1.12:1 on the rail and was invisible.
                          // `foreground/6` is a tint of the INK, so it darkens
                          // the surface ~5% against `--sidebar` and reads as a
                          // step, with weight and full-strength text carrying
                          // the rest.
                          active
                            ? 'bg-foreground/[0.06] font-semibold text-foreground before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-iris before:content-[""]'
                            : 'font-medium text-foreground/85 hover:bg-muted/70 hover:text-foreground',
                        )}
                      >
                        <HugeiconsIcon icon={Icon}
                          className={cn(
                            'size-[1.125rem] shrink-0',
                            active ? 'text-foreground' : 'text-muted-foreground',
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
